import { z } from 'zod';
import type { TimeClient } from '../client/time-client.js';
import type { Thread, UserThreads } from '../types/time-api.js';

/**
 * Normalizes the threads endpoint response to an array. The API answers with a
 * `{ total, threads }` wrapper whose `threads` is null when nothing is
 * followed; a bare array is still accepted in case other API versions send one.
 */
export function extractThreads(
  response: UserThreads | Thread[] | null | undefined
): Thread[] {
  if (Array.isArray(response)) {
    return response;
  }

  return response?.threads ?? [];
}

export const threadTools = [
  {
    name: 'list_threads',
    description: 'List all threads that the user is following in a team',
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
      const response = await client.getUserThreads(userId, params.team_id);

      return {
        content: [
          {
            type: 'text',
            text: formatThreads(extractThreads(response)),
          },
        ],
      };
    },
  },

  {
    name: 'get_thread_stats',
    description: 'Get unread threads count and mentions for a team',
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
      const stats = await client.getThreadsStats(userId, params.team_id);

      return {
        content: [
          {
            type: 'text',
            text: `Thread Statistics:\n\nTotal unread threads: ${stats.total_unread_threads}\nTotal unread mentions: ${stats.total_unread_mentions}`,
          },
        ],
      };
    },
  },

  {
    name: 'get_thread',
    description: 'Get information about a specific thread',
    inputSchema: {
      type: 'object',
      properties: {
        team_id: {
          type: 'string',
          description: 'Team ID',
        },
        thread_id: {
          type: 'string',
          description: 'Thread ID (root post ID)',
        },
      },
      required: ['team_id', 'thread_id'],
    },
    handler: async (client: TimeClient, args: unknown, userId: string) => {
      const schema = z.object({
        team_id: z.string(),
        thread_id: z.string(),
      });

      const params = schema.parse(args);
      const thread = await client.getUserThread(
        userId,
        params.team_id,
        params.thread_id
      );

      return {
        content: [
          {
            type: 'text',
            text: formatThread(thread),
          },
        ],
      };
    },
  },

  {
    name: 'follow_thread',
    description: 'Start following a thread to receive notifications',
    inputSchema: {
      type: 'object',
      properties: {
        thread_id: {
          type: 'string',
          description: 'Thread ID (root post ID)',
        },
      },
      required: ['thread_id'],
    },
    handler: async (client: TimeClient, args: unknown, userId: string) => {
      const schema = z.object({
        thread_id: z.string(),
      });

      const params = schema.parse(args);
      await client.startFollowingThread(userId, params.thread_id);

      return {
        content: [
          {
            type: 'text',
            text: `Now following thread ${params.thread_id}`,
          },
        ],
      };
    },
  },

  {
    name: 'unfollow_thread',
    description: 'Stop following a thread',
    inputSchema: {
      type: 'object',
      properties: {
        thread_id: {
          type: 'string',
          description: 'Thread ID (root post ID)',
        },
      },
      required: ['thread_id'],
    },
    handler: async (client: TimeClient, args: unknown, userId: string) => {
      const schema = z.object({
        thread_id: z.string(),
      });

      const params = schema.parse(args);
      await client.stopFollowingThread(userId, params.thread_id);

      return {
        content: [
          {
            type: 'text',
            text: `Stopped following thread ${params.thread_id}`,
          },
        ],
      };
    },
  },

  {
    name: 'mark_thread_read',
    description: 'Mark a thread as read up to a specific timestamp',
    inputSchema: {
      type: 'object',
      properties: {
        team_id: {
          type: 'string',
          description: 'Team ID',
        },
        thread_id: {
          type: 'string',
          description: 'Thread ID (root post ID)',
        },
        timestamp: {
          type: 'number',
          description: 'Unix timestamp in milliseconds (optional, defaults to now)',
        },
      },
      required: ['team_id', 'thread_id'],
    },
    handler: async (client: TimeClient, args: unknown, userId: string) => {
      const schema = z.object({
        team_id: z.string(),
        thread_id: z.string(),
        timestamp: z.number().optional(),
      });

      const params = schema.parse(args);
      const timestamp = params.timestamp || Date.now();

      await client.updateThreadRead(
        userId,
        params.team_id,
        params.thread_id,
        timestamp
      );

      return {
        content: [
          {
            type: 'text',
            text: `Thread marked as read at ${new Date(timestamp).toISOString()}`,
          },
        ],
      };
    },
  },
];

export function formatThreads(threads: Thread[]): string {
  if (threads.length === 0) {
    return 'No threads found.';
  }

  const lines = threads.map((thread) => {
    const date = new Date(thread.last_reply_at).toLocaleString();
    const replies = thread.reply_count || 0;
    const preview = thread.post?.message?.substring(0, 100) || 'No content';
    return `[${date}] ${replies} replies\n${preview}...\nThread ID: ${thread.id}`;
  });

  return `Found ${threads.length} thread(s):\n\n${lines.join('\n\n')}`;
}

export function formatThread(thread: Thread): string {
  const lastReply = new Date(thread.last_reply_at).toLocaleString();
  const created = new Date(thread.create_at).toLocaleString();
  
  let text = `Thread ID: ${thread.id}\n`;
  text += `Created: ${created}\n`;
  text += `Last reply: ${lastReply}\n`;
  text += `Reply count: ${thread.reply_count}\n\n`;
  
  if (thread.post) {
    text += `Root message:\n${thread.post.message}`;
  }

  return text;
}
