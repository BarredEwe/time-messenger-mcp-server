import { z } from 'zod';
import type { TimeClient } from '../client/time-client.js';
import type { Channel, ChannelCategory, ChannelCategoryType } from '../types/time-api.js';

const nonEmptyString = z.string().min(1);
const sortingSchema = z.enum(['', 'manual', 'recent', 'alpha']);

const listSchema = z.object({ team_id: nonEmptyString }).strict();
const createSchema = z.object({ team_id: nonEmptyString, display_name: nonEmptyString }).strict();
const updateSchema = z.object({
  team_id: nonEmptyString,
  category_id: nonEmptyString,
  display_name: nonEmptyString.optional(),
  sorting: sortingSchema.optional(),
  muted: z.boolean().optional(),
  collapsed: z.boolean().optional(),
}).strict().refine(
  ({ display_name, sorting, muted, collapsed }) =>
    display_name !== undefined || sorting !== undefined || muted !== undefined || collapsed !== undefined,
  { message: 'At least one category metadata field is required.' }
);
const categoryRefSchema = z.object({ team_id: nonEmptyString, category_id: nonEmptyString }).strict();
const reorderSchema = z.object({ team_id: nonEmptyString, category_ids: z.array(nonEmptyString).min(1) }).strict();
const moveSchema = z.object({ team_id: nonEmptyString, channel_id: nonEmptyString, category_id: nonEmptyString }).strict();
const favoriteSchema = z.object({ team_id: nonEmptyString, channel_id: nonEmptyString, favorite: z.boolean() }).strict();

const strictObject = { type: 'object', additionalProperties: false } as const;
const idProperty = (description: string) => ({ type: 'string', minLength: 1, description });

// Managed categories are server-controlled; every other type holds explicit channel membership.
const MOVE_DESTINATION_TYPES: ReadonlySet<ChannelCategoryType> = new Set(['channels', 'custom', 'favorites']);

function textResult(text: string) {
  return { content: [{ type: 'text' as const, text }] };
}

function orderedCategories(
  categories: readonly ChannelCategory[],
  order: readonly string[]
): readonly ChannelCategory[] {
  const categoriesById = new Map(categories.map((category) => [category.id, category]));
  const ordered = order.flatMap((categoryId) => {
    const category = categoriesById.get(categoryId);
    return category === undefined ? [] : [category];
  });
  const orderedIds = new Set(order);
  return [...ordered, ...categories.filter((category) => !orderedIds.has(category.id))];
}

function formatChannelLine(channelId: string, channel: Channel | undefined): string {
  if (channel === undefined) {
    return `- Unknown channel (${channelId})`;
  }
  const type = channel.type === 'O' ? 'Public' : channel.type === 'P' ? 'Private' : channel.type === 'D' ? 'Direct' : 'Group';
  return `- [${type}] ${channel.display_name || channel.name} (${channel.id})`;
}

function formatCategoryList(categories: readonly ChannelCategory[], channels: readonly Channel[]): string {
  if (categories.length === 0) {
    return 'No channel categories found.';
  }

  const channelsById = new Map(channels.map((channel) => [channel.id, channel]));
  return categories.map((category) => {
    const flags = [
      `type: ${category.type}`,
      `sorting: ${category.sorting || 'default'}`,
      ...(category.muted ? ['muted'] : []),
      ...(category.collapsed ? ['collapsed'] : []),
    ].join(', ');
    const channelLines = category.channel_ids.length === 0
      ? '- No channels.'
      : category.channel_ids.map((channelId) => formatChannelLine(channelId, channelsById.get(channelId))).join('\n');
    return `Category: ${category.display_name} (${category.id})\n${flags}\n${channelLines}`;
  }).join('\n\n');
}

function requireCategory(categories: readonly ChannelCategory[], categoryId: string): ChannelCategory {
  const category = categories.find((candidate) => candidate.id === categoryId);
  if (category === undefined) {
    throw new Error(`Channel category not found: ${categoryId}`);
  }
  return category;
}

function requireCategoryOfType(categories: readonly ChannelCategory[], type: ChannelCategoryType): ChannelCategory {
  const category = categories.find((candidate) => candidate.type === type);
  if (category === undefined) {
    throw new Error(`Required ${type} channel category is missing.`);
  }
  return category;
}

function sameChannelIds(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((channelId, index) => channelId === right[index]);
}

/**
 * Returns the categories whose membership changes when the channel moves to the destination:
 * the channel is removed from every non-managed category and appended to the destination.
 */
export function moveChannelToCategory(
  categories: readonly ChannelCategory[],
  channelId: string,
  destination: ChannelCategory
): readonly ChannelCategory[] {
  return categories.flatMap((category) => {
    if (category.type === 'managed') {
      return [];
    }
    const withoutChannel = category.channel_ids.filter((candidate) => candidate !== channelId);
    const channelIds = category.id === destination.id ? [...withoutChannel, channelId] : withoutChannel;
    return sameChannelIds(category.channel_ids, channelIds) ? [] : [{ ...category, channel_ids: channelIds }];
  });
}

async function applyMove(
  client: TimeClient,
  userId: string,
  teamId: string,
  changedCategories: readonly ChannelCategory[],
  destinationId: string,
  channelId: string
): Promise<void> {
  const updated = await client.updateChannelCategories(userId, teamId, changedCategories);
  const destinations = updated.filter((category) => category.id === destinationId);
  if (destinations.length !== 1 || !destinations[0].channel_ids.includes(channelId)) {
    throw new Error(`Channel category update did not confirm channel ${channelId} in destination ${destinationId}.`);
  }
}

export const channelCategoryTools = [
  {
    name: 'list_channel_categories',
    description: 'List the user\'s channel sidebar categories for a team, in sidebar order, with their channels.',
    inputSchema: {
      ...strictObject,
      properties: { team_id: idProperty('Team ID.') },
      required: ['team_id'],
    },
    handler: async (client: TimeClient, args: unknown, userId: string) => {
      const params = listSchema.parse(args);
      const [categoryList, channels] = await Promise.all([
        client.getChannelCategories(userId, params.team_id),
        client.getChannelsForUser(userId, params.team_id),
      ]);
      return textResult(formatCategoryList(orderedCategories(categoryList.categories, categoryList.order), channels));
    },
  },
  {
    name: 'create_channel_category',
    description: 'Create an empty custom channel sidebar category.',
    inputSchema: {
      ...strictObject,
      properties: {
        team_id: idProperty('Team ID.'),
        display_name: idProperty('Category display name.'),
      },
      required: ['team_id', 'display_name'],
    },
    handler: async (client: TimeClient, args: unknown, userId: string) => {
      const params = createSchema.parse(args);
      const category = await client.createChannelCategory(userId, params.team_id, {
        display_name: params.display_name,
        type: 'custom',
        channel_ids: [],
      });
      return textResult(`Created channel category: ${category.display_name}\nID: ${category.id}`);
    },
  },
  {
    name: 'update_channel_category',
    description: 'Update metadata of a channel sidebar category. Provide at least one of display_name, sorting, muted, collapsed. Only custom categories can be renamed; managed categories cannot be changed.',
    inputSchema: {
      ...strictObject,
      properties: {
        team_id: idProperty('Team ID.'),
        category_id: idProperty('Category ID.'),
        display_name: idProperty('New category display name (custom categories only).'),
        sorting: { type: 'string', enum: ['', 'manual', 'recent', 'alpha'], description: 'Channel sorting mode.' },
        muted: { type: 'boolean', description: 'Whether the category is muted.' },
        collapsed: { type: 'boolean', description: 'Whether the category is collapsed.' },
      },
      required: ['team_id', 'category_id'],
    },
    handler: async (client: TimeClient, args: unknown, userId: string) => {
      const params = updateSchema.parse(args);
      const categoryList = await client.getChannelCategories(userId, params.team_id);
      const category = requireCategory(categoryList.categories, params.category_id);
      if (category.type === 'managed') {
        throw new Error(`Managed channel category cannot be updated: ${category.id}`);
      }
      if (params.display_name !== undefined && category.type !== 'custom') {
        throw new Error(`Only custom channel categories can be renamed; ${category.id} is ${category.type}.`);
      }
      const updated = await client.updateChannelCategory(userId, params.team_id, category.id, {
        ...category,
        ...(params.display_name === undefined ? {} : { display_name: params.display_name }),
        ...(params.sorting === undefined ? {} : { sorting: params.sorting }),
        ...(params.muted === undefined ? {} : { muted: params.muted }),
        ...(params.collapsed === undefined ? {} : { collapsed: params.collapsed }),
      });
      return textResult(`Updated channel category: ${updated.display_name}\nID: ${updated.id}`);
    },
  },
  {
    name: 'delete_channel_category',
    description: 'Delete a custom channel sidebar category. Its channels return to the default categories.',
    inputSchema: {
      ...strictObject,
      properties: {
        team_id: idProperty('Team ID.'),
        category_id: idProperty('Custom category ID.'),
      },
      required: ['team_id', 'category_id'],
    },
    handler: async (client: TimeClient, args: unknown, userId: string) => {
      const params = categoryRefSchema.parse(args);
      const categoryList = await client.getChannelCategories(userId, params.team_id);
      const category = requireCategory(categoryList.categories, params.category_id);
      if (category.type !== 'custom') {
        throw new Error(`Only custom channel categories can be deleted; ${category.id} is ${category.type}.`);
      }
      await client.deleteChannelCategory(userId, params.team_id, category.id);
      return textResult(`Deleted channel category: ${category.display_name}\nID: ${category.id}`);
    },
  },
  {
    name: 'reorder_channel_categories',
    description: 'Set the sidebar order of channel categories. category_ids must list every category of the team exactly once.',
    inputSchema: {
      ...strictObject,
      properties: {
        team_id: idProperty('Team ID.'),
        category_ids: {
          type: 'array',
          minItems: 1,
          items: { type: 'string', minLength: 1 },
          description: 'All category IDs of the team in the desired order.',
        },
      },
      required: ['team_id', 'category_ids'],
    },
    handler: async (client: TimeClient, args: unknown, userId: string) => {
      const params = reorderSchema.parse(args);
      const categoryList = await client.getChannelCategories(userId, params.team_id);
      const existingIds = new Set(categoryList.categories.map((category) => category.id));
      const requestedIds = new Set(params.category_ids);
      const unknown = params.category_ids.filter((categoryId) => !existingIds.has(categoryId));
      const missing = [...existingIds].filter((categoryId) => !requestedIds.has(categoryId));
      if (unknown.length > 0 || missing.length > 0 || requestedIds.size !== params.category_ids.length) {
        const problems = [
          ...(unknown.length > 0 ? [`unknown: ${unknown.join(', ')}`] : []),
          ...(missing.length > 0 ? [`missing: ${missing.join(', ')}`] : []),
          ...(requestedIds.size !== params.category_ids.length ? ['duplicate IDs'] : []),
        ];
        throw new Error(`category_ids must list every category exactly once (${problems.join('; ')}).`);
      }
      const categoryIds = await client.reorderChannelCategories(userId, params.team_id, params.category_ids);
      return textResult(`Reordered channel categories:\n${categoryIds.join('\n')}`);
    },
  },
  {
    name: 'move_channel_to_category',
    description: 'Move one channel into an existing custom, Channels or Favorites sidebar category.',
    inputSchema: {
      ...strictObject,
      properties: {
        team_id: idProperty('Team ID.'),
        channel_id: idProperty('Channel ID.'),
        category_id: idProperty('Destination category ID.'),
      },
      required: ['team_id', 'channel_id', 'category_id'],
    },
    handler: async (client: TimeClient, args: unknown, userId: string) => {
      const params = moveSchema.parse(args);
      const categoryList = await client.getChannelCategories(userId, params.team_id);
      const destination = requireCategory(categoryList.categories, params.category_id);
      if (!MOVE_DESTINATION_TYPES.has(destination.type)) {
        throw new Error(
          `${destination.type === 'direct_messages' ? 'Direct messages' : 'Managed'} channel categories cannot be destinations.`
        );
      }
      const changed = moveChannelToCategory(categoryList.categories, params.channel_id, destination);
      if (changed.length === 0) {
        return textResult(`Channel ${params.channel_id} is already in category ${destination.display_name}.`);
      }
      await applyMove(client, userId, params.team_id, changed, destination.id, params.channel_id);
      return textResult(`Moved channel ${params.channel_id} to category ${destination.display_name}.`);
    },
  },
  {
    name: 'set_channel_favorite',
    description: 'Favorite or unfavorite one channel. Unfavoriting returns a channel to Channels, or a direct/group message to Direct Messages.',
    inputSchema: {
      ...strictObject,
      properties: {
        team_id: idProperty('Team ID.'),
        channel_id: idProperty('Channel ID.'),
        favorite: { type: 'boolean', description: 'True to favorite, false to unfavorite.' },
      },
      required: ['team_id', 'channel_id', 'favorite'],
    },
    handler: async (client: TimeClient, args: unknown, userId: string) => {
      const params = favoriteSchema.parse(args);
      const categoryList = await client.getChannelCategories(userId, params.team_id);
      const favorites = requireCategoryOfType(categoryList.categories, 'favorites');
      const isFavorite = favorites.channel_ids.includes(params.channel_id);
      if (isFavorite === params.favorite) {
        return textResult(`Channel ${params.channel_id} is already ${params.favorite ? 'favorited' : 'not favorited'}.`);
      }

      let destination = favorites;
      if (!params.favorite) {
        const channel = await client.getChannel(params.channel_id);
        const isDirect = channel.type === 'D' || channel.type === 'G';
        destination = requireCategoryOfType(categoryList.categories, isDirect ? 'direct_messages' : 'channels');
      }
      const changed = moveChannelToCategory(categoryList.categories, params.channel_id, destination);
      await applyMove(client, userId, params.team_id, changed, destination.id, params.channel_id);
      return textResult(`Channel ${params.channel_id} ${params.favorite ? 'favorited' : 'unfavorited'}.`);
    },
  },
];
