import { z } from 'zod';
import type { TimeClient } from '../client/time-client.js';
import type { Channel, MarkChannelsReadResult } from '../types/time-api.js';

function formatMarkChannelsReadResult(result: MarkChannelsReadResult): string {
  if (result.failures.length === 0) {
    return `Marked ${result.successes.length} channel(s) as read.`;
  }

  const attemptedCount = result.successes.length + result.failures.length;
  const summary = result.successes.length === 0
    ? `Failed to mark ${attemptedCount} channel(s) as read.`
    : `Marked ${result.successes.length} of ${attemptedCount} channel(s) as read.`;
  const failures = result.failures.map((failure) => {
    const status = failure.statusCode === undefined ? '' : ` (status ${failure.statusCode})`;
    return `- ${failure.channelId}: ${failure.message}${status}`;
  });

  return `${summary}\nFailed channels:\n${failures.join('\n')}`;
}

export const channelTools = [
  {
    name: 'list_channels',
    description: 'List all channels for the user in a team',
    inputSchema: {
      type: 'object',
      properties: {
        team_id: {
          type: 'string',
          description: 'Team ID',
        },
      },
      required: ['team_id'],
    },
    handler: async (client: TimeClient, args: unknown, userId: string) => {
      const schema = z.object({
        team_id: z.string(),
      });

      const params = schema.parse(args);
      const channels = await client.getChannelsForUser(userId, params.team_id);

      return {
        content: [
          {
            type: 'text',
            text: formatChannels(channels),
          },
        ],
      };
    },
  },

  {
    name: 'get_channel',
    description: 'Get information about a specific channel',
    inputSchema: {
      type: 'object',
      properties: {
        channel_id: {
          type: 'string',
          description: 'Channel ID',
        },
      },
      required: ['channel_id'],
    },
    handler: async (client: TimeClient, args: unknown) => {
      const schema = z.object({
        channel_id: z.string(),
      });

      const params = schema.parse(args);
      const channel = await client.getChannel(params.channel_id);

      return {
        content: [
          {
            type: 'text',
            text: formatChannel(channel),
          },
        ],
      };
    },
  },

  {
    name: 'search_channels',
    description: 'Search channels in a team by name',
    inputSchema: {
      type: 'object',
      properties: {
        team_id: {
          type: 'string',
          description: 'Team ID',
        },
        term: {
          type: 'string',
          description: 'Search term',
        },
      },
      required: ['team_id', 'term'],
    },
    handler: async (client: TimeClient, args: unknown) => {
      const schema = z.object({
        team_id: z.string(),
        term: z.string(),
      });

      const params = schema.parse(args);
      const channels = await client.searchChannels(params.team_id, params.term);

      return {
        content: [
          {
            type: 'text',
            text: formatChannels(channels),
          },
        ],
      };
    },
  },

  {
    name: 'get_channel_unread',
    description: 'Get unread message count and mentions for a channel',
    inputSchema: {
      type: 'object',
      properties: {
        channel_id: {
          type: 'string',
          description: 'Channel ID',
        },
      },
      required: ['channel_id'],
    },
    handler: async (client: TimeClient, args: unknown, userId: string) => {
      const schema = z.object({
        channel_id: z.string(),
      });

      const params = schema.parse(args);
      const unread = await client.getChannelUnread(userId, params.channel_id);

      return {
        content: [
          {
            type: 'text',
            text: `Unread messages: ${unread.msg_count}\nUnread mentions: ${unread.mention_count}`,
          },
        ],
      };
    },
  },

  {
    name: 'mark_channels_read',
    description: 'Mark all available channels or selected channel IDs as read; this action cannot be undone. The all mode includes public, private, DM, and group channels. Followed threads are excluded; use mark_thread_read for threads.',
    inputSchema: {
      type: 'object',
      properties: {
        mode: {
          type: 'string',
          enum: ['all', 'selected'],
        },
        channel_ids: {
          type: 'array',
          minItems: 1,
          maxItems: 100,
          items: { type: 'string', minLength: 1, maxLength: 128 },
        },
      },
      required: ['mode'],
      additionalProperties: false,
    },
    handler: async (client: TimeClient, args: unknown, userId: string) => {
      const schema = z.discriminatedUnion('mode', [
        z.object({ mode: z.literal('all') }).strict(),
        z.object({
          mode: z.literal('selected'),
          channel_ids: z.array(z.string().trim().min(1).max(128)).min(1).max(100),
        }).strict(),
      ]);

      const params = schema.parse(args);

      switch (params.mode) {
        case 'selected': {
          const channelIds = [...new Set(params.channel_ids)];
          const result = await client.markChannelsRead(userId, channelIds);
          return {
            content: [{ type: 'text', text: formatMarkChannelsReadResult(result) }],
          };
        }
        case 'all': {
          const channels = await client.getAllChannelsForUser(userId);
          const channelIds = [...new Set(channels.map((channel) => channel.id))];
          if (channelIds.length === 0) {
            return {
              content: [{ type: 'text', text: 'No channels available to mark as read.' }],
            };
          }

          const result = await client.markChannelsRead(userId, channelIds);
          return {
            content: [{ type: 'text', text: formatMarkChannelsReadResult(result) }],
          };
        }
        default: {
          const exhaustiveInput: never = params;
          return exhaustiveInput;
        }
      }
    },
  },
];

export function formatChannels(channels: Channel[]): string {
  if (channels.length === 0) {
    return 'No channels found.';
  }

  const lines = channels.map((channel) => {
    const type = channel.type === 'O' ? 'Public' : channel.type === 'P' ? 'Private' : channel.type === 'D' ? 'Direct' : 'Group';
    const lastPost = channel.last_post_at ? new Date(channel.last_post_at).toLocaleString() : 'Never';
    return `[${type}] ${channel.display_name}\nID: ${channel.id}\nName: ${channel.name}\nLast post: ${lastPost}`;
  });

  return `Found ${channels.length} channel(s):\n\n${lines.join('\n\n')}`;
}

export function formatChannel(channel: Channel): string {
  const type = channel.type === 'O' ? 'Public' : channel.type === 'P' ? 'Private' : channel.type === 'D' ? 'Direct' : 'Group';
  
  let text = `Channel: ${channel.display_name}\n`;
  text += `Type: ${type}\n`;
  text += `ID: ${channel.id}\n`;
  text += `Name: ${channel.name}\n`;
  text += `Team ID: ${channel.team_id}\n`;
  text += `Total messages: ${channel.total_msg_count}\n`;
  
  if (channel.header) {
    text += `\nHeader:\n${channel.header}`;
  }
  
  if (channel.purpose) {
    text += `\nPurpose: ${channel.purpose}`;
  }

  return text;
}
