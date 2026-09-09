import { z } from 'zod';
import type { TimeClient } from '../client/time-client.js';
import type { Channel, ChannelCategory } from '../types/time-api.js';
import { channelCategoryMembershipTools } from './channel-category-membership.js';

const teamIdSchema = z.string().min(1);
const categoryIdSchema = z.string().min(1);
const displayNameSchema = z.string().min(1);
const categoryIdsSchema = z.array(z.string().min(1)).min(1);
const sortingSchema = z.enum(['', 'manual', 'recent', 'alpha']);

const listSchema = z.object({ team_id: teamIdSchema }).strict();
const createSchema = z.object({ team_id: teamIdSchema, display_name: displayNameSchema }).strict();
const updateSchema = z.object({
  team_id: teamIdSchema,
  category_id: categoryIdSchema,
  display_name: displayNameSchema.optional(),
  sorting: sortingSchema.optional(),
  muted: z.boolean().optional(),
  collapsed: z.boolean().optional(),
}).strict().refine(
  ({ display_name, sorting, muted, collapsed }) =>
    display_name !== undefined || sorting !== undefined || muted !== undefined || collapsed !== undefined,
  { message: 'At least one category metadata field is required.' }
);
const deleteSchema = z.object({ team_id: teamIdSchema, category_id: categoryIdSchema }).strict();
const reorderSchema = z.object({ team_id: teamIdSchema, category_ids: categoryIdsSchema }).strict();

const strictObject = { type: 'object', additionalProperties: false } as const;

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

function formatChannelSummary(channel: Channel): string {
  const type = channel.type === 'O' ? 'Public' : channel.type === 'P' ? 'Private' : channel.type === 'D' ? 'Direct' : 'Group';
  const lastPost = channel.last_post_at === 0 ? 'Never' : new Date(channel.last_post_at).toLocaleString();
  return `[${type}] ${channel.display_name}\nID: ${channel.id}\nName: ${channel.name}\nLast post: ${lastPost}`;
}

function formatCategoryList(categories: readonly ChannelCategory[], channels: readonly Channel[]): string {
  if (categories.length === 0) {
    return 'No channel categories found.';
  }

  const channelsById = new Map(channels.map((channel) => [channel.id, channel]));
  return categories.map((category) => {
    const channelSummaries = category.channel_ids.map((channelId) => {
      const channel = channelsById.get(channelId);
      return channel === undefined ? `Unknown channel ID: ${channelId}` : formatChannelSummary(channel);
    });
    const channelText = channelSummaries.length === 0 ? 'No channels.' : channelSummaries.join('\n\n');
    return `Category: ${category.display_name}\nID: ${category.id}\nType: ${category.type}\nSort order: ${category.sort_order}\nSorting: ${category.sorting}\nMuted: ${category.muted}\nCollapsed: ${category.collapsed}\nChannels:\n${channelText}`;
  }).join('\n\n');
}

function requireMutableCategory(categories: readonly ChannelCategory[], categoryId: string): ChannelCategory {
  const category = categories.find((candidate) => candidate.id === categoryId);
  if (category === undefined) {
    throw new Error(`Channel category not found: ${categoryId}`);
  }
  if (category.type === 'managed') {
    throw new Error(`Managed channel category cannot be updated: ${categoryId}`);
  }
  return category;
}

export const channelCategoryTools = [
  {
    name: 'time_list_channel_categories',
    description: 'List the authenticated user\'s ordered channel sidebar categories for a team.',
    inputSchema: {
      ...strictObject,
      properties: { team_id: { type: 'string', minLength: 1, description: 'Team ID.' } },
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
    name: 'time_create_channel_category',
    description: 'Create an empty custom channel sidebar category for the authenticated user.',
    inputSchema: {
      ...strictObject,
      properties: {
        team_id: { type: 'string', minLength: 1, description: 'Team ID.' },
        display_name: { type: 'string', minLength: 1, description: 'Category display name.' },
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
    name: 'time_update_channel_category',
    description: 'Update metadata on one existing non-managed channel sidebar category.',
    inputSchema: {
      ...strictObject,
      properties: {
        team_id: { type: 'string', minLength: 1, description: 'Team ID.' },
        category_id: { type: 'string', minLength: 1, description: 'Category ID.' },
        display_name: { type: 'string', minLength: 1, description: 'New category display name.' },
        sorting: { enum: ['', 'manual', 'recent', 'alpha'], description: 'Channel sorting mode.' },
        muted: { type: 'boolean', description: 'Whether the category is muted.' },
        collapsed: { type: 'boolean', description: 'Whether the category is collapsed.' },
      },
      required: ['team_id', 'category_id'],
      anyOf: [
        { required: ['display_name'] },
        { required: ['sorting'] },
        { required: ['muted'] },
        { required: ['collapsed'] },
      ],
    },
    handler: async (client: TimeClient, args: unknown, userId: string) => {
      const params = updateSchema.parse(args);
      const categoryList = await client.getChannelCategories(userId, params.team_id);
      const category = requireMutableCategory(categoryList.categories, params.category_id);
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
    name: 'time_delete_channel_category',
    description: 'Delete one channel sidebar category through the current category route.',
    inputSchema: {
      ...strictObject,
      properties: {
        team_id: { type: 'string', minLength: 1, description: 'Team ID.' },
        category_id: { type: 'string', minLength: 1, description: 'Category ID.' },
      },
      required: ['team_id', 'category_id'],
    },
    handler: async (client: TimeClient, args: unknown, userId: string) => {
      const params = deleteSchema.parse(args);
      await client.deleteChannelCategory(userId, params.team_id, params.category_id);
      return textResult(`Deleted channel category: ${params.category_id}`);
    },
  },
  {
    name: 'time_reorder_channel_categories',
    description: 'Set the complete ordered list of channel sidebar category IDs for a team.',
    inputSchema: {
      ...strictObject,
      properties: {
        team_id: { type: 'string', minLength: 1, description: 'Team ID.' },
        category_ids: {
          type: 'array',
          minItems: 1,
          items: { type: 'string', minLength: 1 },
          description: 'Complete category ID order.',
        },
      },
      required: ['team_id', 'category_ids'],
    },
    handler: async (client: TimeClient, args: unknown, userId: string) => {
      const params = reorderSchema.parse(args);
      const categoryIds = await client.reorderChannelCategories(userId, params.team_id, params.category_ids);
      return textResult(`Reordered channel categories:\n${categoryIds.join('\n')}`);
    },
  },
  ...channelCategoryMembershipTools,
];
