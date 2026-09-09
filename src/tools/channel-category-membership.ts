import { z } from 'zod';
import type { TimeClient } from '../client/time-client.js';
import type { ChannelCategory } from '../types/time-api.js';

const teamIdSchema = z.string().min(1);
const channelIdSchema = z.string().min(1);
const categoryIdSchema = z.string().min(1);
const moveSchema = z.object({
  team_id: teamIdSchema,
  channel_id: channelIdSchema,
  category_id: categoryIdSchema,
}).strict();
const favoriteSchema = z.object({
  team_id: teamIdSchema,
  channel_id: channelIdSchema,
  favorite: z.boolean(),
}).strict();

const strictObject = { type: 'object', additionalProperties: false } as const;
const mutableExplicitTypes = new Set(['channels', 'custom', 'favorites']);

class ChannelCategoryMembershipError extends Error {
  readonly name = 'ChannelCategoryMembershipError';

  constructor(message: string) {
    super(message);
  }
}

type MoveResult = {
  readonly changedCategories: readonly ChannelCategory[];
  readonly changed: boolean;
};

function textResult(text: string) {
  return { content: [{ type: 'text' as const, text }] };
}

function sameChannelIds(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((channelId, index) => channelId === right[index]);
}

function requireCategory(categories: readonly ChannelCategory[], categoryId: string): ChannelCategory {
  const category = categories.find((candidate) => candidate.id === categoryId);
  if (category === undefined) {
    throw new ChannelCategoryMembershipError(`Channel category not found: ${categoryId}`);
  }
  return category;
}

function requireSystemCategory(categories: readonly ChannelCategory[], type: 'channels' | 'favorites'): ChannelCategory {
  const category = categories.find((candidate) => candidate.type === type);
  if (category === undefined) {
    throw new ChannelCategoryMembershipError(`Required ${type} channel category is missing.`);
  }
  return category;
}

function requireUpdatedMembership(
  categories: readonly ChannelCategory[],
  destinationId: string,
  channelId: string
): void {
  const destinations = categories.filter((category) => category.id === destinationId);
  if (destinations.length !== 1 || !destinations[0].channel_ids.includes(channelId)) {
    throw new ChannelCategoryMembershipError(
      `Channel category update did not confirm channel ${channelId} in destination ${destinationId}.`
    );
  }
}

export function moveChannelToCategory(
  categories: readonly ChannelCategory[],
  channelId: string,
  destinationId: string
): MoveResult {
  const destination = requireCategory(categories, destinationId);
  if (!mutableExplicitTypes.has(destination.type)) {
    throw new ChannelCategoryMembershipError(
      `${destination.type === 'direct_messages' ? 'Direct messages' : 'Managed'} channel categories cannot be destinations.`
    );
  }

  const changedCategories = categories.flatMap((category) => {
    if (!mutableExplicitTypes.has(category.type)) {
      return [];
    }
    const withoutChannel = category.channel_ids.filter((candidate) => candidate !== channelId);
    const channelIds = category.id === destination.id ? [...withoutChannel, channelId] : withoutChannel;
    return sameChannelIds(category.channel_ids, channelIds) ? [] : [{ ...category, channel_ids: channelIds }];
  });
  return { changedCategories, changed: changedCategories.length > 0 };
}

export const channelCategoryMembershipTools = [
  {
    name: 'time_move_channel_to_category',
    description: 'Atomically move one channel into an existing mutable sidebar category.',
    inputSchema: {
      ...strictObject,
      properties: {
        team_id: { type: 'string', minLength: 1, description: 'Team ID.' },
        channel_id: { type: 'string', minLength: 1, description: 'Channel ID.' },
        category_id: { type: 'string', minLength: 1, description: 'Destination category ID.' },
      },
      required: ['team_id', 'channel_id', 'category_id'],
    },
    handler: async (client: TimeClient, args: unknown, userId: string) => {
      const params = moveSchema.parse(args);
      const categoryList = await client.getChannelCategories(userId, params.team_id);
      const destination = requireCategory(categoryList.categories, params.category_id);
      const move = moveChannelToCategory(categoryList.categories, params.channel_id, destination.id);
      if (!move.changed) {
        return textResult(`Channel ${params.channel_id} is already in category ${destination.display_name}.`);
      }
      const updatedCategories = await client.updateChannelCategories(userId, params.team_id, move.changedCategories);
      requireUpdatedMembership(updatedCategories, destination.id, params.channel_id);
      return textResult(`Moved channel ${params.channel_id} to category ${destination.display_name}.`);
    },
  },
  {
    name: 'time_set_channel_favorite',
    description: 'Favorite or unfavorite one channel through sidebar category membership.',
    inputSchema: {
      ...strictObject,
      properties: {
        team_id: { type: 'string', minLength: 1, description: 'Team ID.' },
        channel_id: { type: 'string', minLength: 1, description: 'Channel ID.' },
        favorite: { type: 'boolean', description: 'True to favorite, false to unfavorite.' },
      },
      required: ['team_id', 'channel_id', 'favorite'],
    },
    handler: async (client: TimeClient, args: unknown, userId: string) => {
      const params = favoriteSchema.parse(args);
      const categoryList = await client.getChannelCategories(userId, params.team_id);
      const destination = requireSystemCategory(categoryList.categories, params.favorite ? 'favorites' : 'channels');
      const move = moveChannelToCategory(categoryList.categories, params.channel_id, destination.id);
      if (!move.changed) {
        return textResult(`Channel ${params.channel_id} is already ${params.favorite ? 'favorited' : 'unfavorited'}.`);
      }
      const updatedCategories = await client.updateChannelCategories(userId, params.team_id, move.changedCategories);
      requireUpdatedMembership(updatedCategories, destination.id, params.channel_id);
      return textResult(`Channel ${params.channel_id} ${params.favorite ? 'favorited' : 'unfavorited'}.`);
    },
  },
];
