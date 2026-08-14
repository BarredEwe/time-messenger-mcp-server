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
      const authors = await resolveAuthors(client, extractPosts(postList));

      return {
        content: [
          {
            type: 'text',
            text: formatPostList(postList, authors),
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
      const authors = await resolveAuthors(client, extractPosts(postList));

      return {
        content: [
          {
            type: 'text',
            text: formatPostList(postList, authors),
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
      const authors = await resolveAuthors(client, Object.values(result.posts));

      return {
        content: [
          {
            type: 'text',
            text: formatSearchResult(result, authors),
          },
        ],
      };
    },
  },
];

/**
 * Flattens a PostList into oldest-first posts, dropping duplicates and ids
 * present in `order` but missing from `posts`.
 */
export function extractPosts(postList: PostList): Post[] {
  const seen = new Set<string>();

  return postList.order
    .map((id) => postList.posts[id])
    .filter((post): post is Post => {
      if (!post || seen.has(post.id)) return false;
      seen.add(post.id);
      return true;
    })
    .reverse();
}

/**
 * user_id → username. Cached for the process lifetime: usernames rarely
 * change, and without a cache a 100-message page would issue 100 API calls.
 */
const usernameCache = new Map<string, string>();

export async function resolveAuthors(
  client: TimeClient,
  posts: Post[]
): Promise<Map<string, string>> {
  const userIds = [...new Set(posts.map((post) => post.user_id).filter(Boolean))];
  const unknownIds = userIds.filter((id) => !usernameCache.has(id));

  await Promise.all(
    unknownIds.map(async (id) => {
      try {
        const user = await client.getUser(id);
        usernameCache.set(id, user.username || user.nickname || id);
      } catch {
        // A deleted user or a profile we cannot read must not break the
        // message listing, so fall back to the raw id.
        usernameCache.set(id, id);
      }
    })
  );

  return new Map(userIds.map((id) => [id, usernameCache.get(id) ?? id]));
}

function formatAuthor(post: Post, authors?: Map<string, string>): string {
  const username = authors?.get(post.user_id);
  return username ? `@${username}` : post.user_id;
}

function formatIds(post: Post): string {
  const root = post.root_id ? ` | Root ID: ${post.root_id}` : '';
  return `Post ID: ${post.id}${root}`;
}

export function formatPostList(
  postList: PostList,
  authors?: Map<string, string>
): string {
  const posts = extractPosts(postList);

  if (posts.length === 0) {
    return 'No messages found.';
  }

  const lines = posts.map((post) => {
    const date = new Date(post.create_at).toLocaleString();
    const isReply = post.root_id ? ' (reply)' : '';
    return `[${date}]${isReply} ${formatAuthor(post, authors)}\n${post.message}\n${formatIds(post)}\n---`;
  });

  return lines.join('\n\n');
}

export function formatSearchResult(
  result: { order: string[]; posts: Record<string, Post> },
  authors?: Map<string, string>
): string {
  // The search API returns matches newest-first; reverse them so the order
  // matches get_channel_messages (latest message last).
  const posts = result.order
    .map((id) => result.posts[id])
    .filter((post): post is Post => Boolean(post))
    .reverse();

  if (posts.length === 0) {
    return 'No messages found matching your search.';
  }

  const lines = posts.map((post) => {
    const date = new Date(post.create_at).toLocaleString();
    return `[${date}] Channel: ${post.channel_id} ${formatAuthor(post, authors)}\n${post.message}\n${formatIds(post)}\n---`;
  });

  return `Found ${posts.length} message(s):\n\n${lines.join('\n\n')}`;
}
