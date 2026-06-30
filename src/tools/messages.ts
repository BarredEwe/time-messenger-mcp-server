import { z } from 'zod';
import type { TimeClient } from '../client/time-client.js';
import type { Post, PostList } from '../types/time-api.js';

export const messageTools = [
  {
    name: 'send_message',
    description: 'Send a message to a channel or reply in a thread',
    inputSchema: {
      type: 'object',
      properties: {
        channel_id: {
          type: 'string',
          description: 'Channel ID to send message to',
        },
        message: {
          type: 'string',
          description: 'Message text (supports Markdown)',
        },
        root_id: {
          type: 'string',
          description: 'Optional: Post ID to reply in a thread',
        },
      },
      required: ['channel_id', 'message'],
    },
    handler: async (client: TimeClient, args: unknown) => {
      const schema = z.object({
        channel_id: z.string(),
        message: z.string(),
        root_id: z.string().optional(),
      });

      const params = schema.parse(args);
      const post = await client.createPost(
        params.channel_id,
        params.message,
        params.root_id
      );

      return {
        content: [
          {
            type: 'text',
            text: `Message sent successfully!\n\nPost ID: ${post.id}\nCreated at: ${new Date(post.create_at).toISOString()}`,
          },
        ],
      };
    },
  },

  {
    name: 'get_channel_messages',
    description: 'Get messages from a channel with pagination',
    inputSchema: {
      type: 'object',
      properties: {
        channel_id: {
          type: 'string',
          description: 'Channel ID',
        },
        page: {
          type: 'number',
          description: 'Page number (default: 0)',
        },
        per_page: {
          type: 'number',
          description: 'Messages per page (default: 60, max: 200)',
        },
      },
      required: ['channel_id'],
    },
    handler: async (client: TimeClient, args: unknown) => {
      const schema = z.object({
        channel_id: z.string(),
        page: z.number().int().min(0).default(0),
        per_page: z.number().int().min(1).max(200).default(60),
      });

      const params = schema.parse(args);
      const postList = await client.getPostsForChannel(
        params.channel_id,
        params.page,
        params.per_page
      );

      return {
        content: [
          {
            type: 'text',
            text: formatPostList(postList),
          },
        ],
      };
    },
  },

  {
    name: 'get_thread_messages',
    description: 'Get all messages in a thread',
    inputSchema: {
      type: 'object',
      properties: {
        post_id: {
          type: 'string',
          description: 'Post ID (root post of the thread)',
        },
      },
      required: ['post_id'],
    },
    handler: async (client: TimeClient, args: unknown) => {
      const schema = z.object({
        post_id: z.string(),
      });

      const params = schema.parse(args);
      const postList = await client.getPostThread(params.post_id);

      return {
        content: [
          {
            type: 'text',
            text: formatPostList(postList),
          },
        ],
      };
    },
  },

  {
    name: 'search_messages',
    description: 'Search messages in a team',
    inputSchema: {
      type: 'object',
      properties: {
        team_id: {
          type: 'string',
          description: 'Team ID to search in',
        },
        terms: {
          type: 'string',
          description: 'Search terms',
        },
      },
      required: ['team_id', 'terms'],
    },
    handler: async (client: TimeClient, args: unknown) => {
      const schema = z.object({
        team_id: z.string(),
        terms: z.string(),
      });

      const params = schema.parse(args);
      const result = await client.searchPosts(params.team_id, params.terms);

      return {
        content: [
          {
            type: 'text',
            text: formatSearchResult(result),
          },
        ],
      };
    },
  },
];

export function formatPostList(postList: PostList): string {
  const seen = new Set<string>();
  const posts = postList.order
    .map((id) => postList.posts[id])
    .filter((post): post is Post => {
      if (!post || seen.has(post.id)) return false;
      seen.add(post.id);
      return true;
    })
    .reverse();

  if (posts.length === 0) {
    return 'No messages found.';
  }

  const lines = posts.map((post) => {
    const date = new Date(post.create_at).toLocaleString();
    const isReply = post.root_id ? ' (reply)' : '';
    return `[${date}]${isReply}\n${post.message}\n---`;
  });

  return lines.join('\n\n');
}

export function formatSearchResult(result: { order: string[]; posts: Record<string, Post> }): string {
  const posts = result.order
    .map((id) => result.posts[id])
    .filter(Boolean);

  if (posts.length === 0) {
    return 'No messages found matching your search.';
  }

  const lines = posts.map((post) => {
    const date = new Date(post.create_at).toLocaleString();
    return `[${date}] Channel: ${post.channel_id}\n${post.message}\n---`;
  });

  return `Found ${posts.length} message(s):\n\n${lines.join('\n\n')}`;
}
