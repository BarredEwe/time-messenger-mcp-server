import { z } from 'zod';
import type { TimeClient } from '../client/time-client.js';
import type { Post, PostList } from '../types/time-api.js';
import { resolveUsernames } from './usernames.js';

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
    description:
      'Get messages from a channel with pagination. NOTE: returns root messages and thread replies mixed together in one flat list; use list_channel_threads to see them grouped by thread',
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
    name: 'list_channel_threads',
    description:
      'List thread starters from a channel: only the first (root) message of each thread, chronological order like get_channel_messages (oldest first), no thread replies. Use get_thread_messages with a Post ID to read that thread in full',
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
          description:
            'Root messages per page (default: 30, max: 200). Threads with no replies are treated as roots too',
        },
      },
      required: ['channel_id'],
    },
    handler: async (client: TimeClient, args: unknown) => {
      const schema = z
        .object({
          channel_id: z.string(),
          page: z.number().int().min(0).default(0),
          per_page: z.number().int().min(1).max(200).default(30),
        })
        .strict();

      const params = schema.parse(args);
      // collapsedThreads=true: the server filters out thread replies, so one
      // request returns a page of pure root posts.
      const postList = await client.getRootPostsForChannel(
        params.channel_id,
        params.page,
        params.per_page
      );
      const posts = extractPosts(postList);
      // CRT hides replies, but if a deployment ignores the flag and returns
      // some anyway, surface their roots instead of silently dropping them.
      // Roots already shown on this page need no extra mention.
      const rootIds = new Set(
        posts.filter((p) => !p.root_id).map((p) => p.id)
      );
      const detachedRootIds = [
        ...new Set(
          posts
            .filter((p) => p.root_id && !rootIds.has(p.root_id))
            .map((p) => p.root_id)
        ),
      ];
      const authors = await resolveAuthors(client, posts);

      return {
        content: [
          {
            type: 'text',
            text: formatChannelThreadRoots(posts, authors, detachedRootIds),
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

export async function resolveAuthors(
  client: TimeClient,
  posts: Post[]
): Promise<Map<string, string>> {
  return resolveUsernames(
    client,
    posts.map((post) => post.user_id)
  );
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

/**
 * Roots-only view of channel threads: one block per root (thread-starting)
 * message, no reply bodies. `posts` should already be root-only (the CRT
 * server filter); replies included by mistake are kept out of the output
 * but their root ids are listed so no thread is silently lost.
 */
export function formatChannelThreadRoots(
  posts: Post[],
  authors?: Map<string, string>,
  detachedRootIds: string[] = []
): string {
  const roots = posts.filter((p) => !p.root_id);

  if (roots.length === 0 && detachedRootIds.length === 0) {
    return 'No threads found.';
  }

  const lines = roots.map((post) => {
    const date = new Date(post.create_at).toLocaleString();
    return `[${date}] ${formatAuthor(post, authors)}\n${post.message}\nPost ID: ${post.id}`;
  });

  const parts: string[] = [];
  if (roots.length > 0) {
    parts.push(`Found ${roots.length} thread starter(s):\n\n${lines.join('\n\n---\n\n')}`);
  }

  if (detachedRootIds.length > 0) {
    const count = detachedRootIds.length;
    const noun = count === 1 ? 'reply belongs to a thread' : 'replies belong to threads';
    parts.push(`${count} ${noun} whose root post${count === 1 ? ' is' : 's are'} not shown: ${detachedRootIds.join(', ')}`);
  }

  parts.push('Pass a Post ID to get_thread_messages to read its thread.');

  return parts.join('\n\n---\n\n');
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
