import { z } from 'zod';
import type { TimeClient } from '../client/time-client.js';
import type { Reaction } from '../types/time-api.js';

/**
 * The API accepts only emoji *names* (`thumbsup`), never the character itself.
 * Clients naturally pass `👍` or `:thumbsup:`, so the most common characters are
 * translated here and the surrounding colons are stripped.
 */
const EMOJI_CHAR_TO_NAME: Record<string, string> = {
  '👍': 'thumbsup',
  '👎': 'thumbsdown',
  '❤️': 'heart',
  '❤': 'heart',
  '😀': 'grinning',
  '😁': 'grin',
  '😂': 'joy',
  '🤣': 'rofl',
  '😊': 'blush',
  '😉': 'wink',
  '😍': 'heart_eyes',
  '🤔': 'thinking',
  '😐': 'neutral_face',
  '😢': 'cry',
  '😭': 'sob',
  '😱': 'scream',
  '😡': 'rage',
  '🙏': 'pray',
  '👏': 'clap',
  '🙌': 'raised_hands',
  '👌': 'ok_hand',
  '🤝': 'handshake',
  '💪': 'muscle',
  '🔥': 'fire',
  '✨': 'sparkles',
  '🎉': 'tada',
  '🚀': 'rocket',
  '💯': 'one_hundred',
  '✅': 'white_check_mark',
  '☑️': 'ballot_box_with_check',
  '✔️': 'heavy_check_mark',
  '❌': 'x',
  '⚠️': 'warning',
  '👀': 'eyes',
  '🤡': 'clown_face',
  '💩': 'poop',
  '🍕': 'pizza',
  '☕': 'coffee',
  '🤯': 'exploding_head',
  '🥹': 'pleading_face',
};

const EMOJI_NAME_PATTERN = /^[a-z0-9_+-]+$/;

/**
 * Normalizes user input to an emoji name accepted by the API: `:tada:`, `tada`
 * and `🎉` all become `tada`. Unknown characters are rejected explicitly rather
 * than sent through, so the caller gets an actionable message instead of an
 * opaque 400 from the API.
 */
export function normalizeEmojiName(input: string): string {
  const trimmed = input.trim();
  const mapped = EMOJI_CHAR_TO_NAME[trimmed];
  if (mapped) {
    return mapped;
  }

  const name = trimmed.replace(/^:+/, '').replace(/:+$/, '').toLowerCase();

  if (!EMOJI_NAME_PATTERN.test(name)) {
    throw new Error(
      `Unsupported emoji "${input}". Pass the emoji name instead, e.g. "thumbsup" or ":tada:".`
    );
  }

  return name;
}

export const reactionTools = [
  {
    name: 'add_reaction',
    description:
      'Add an emoji reaction to a message. Accepts an emoji name ("thumbsup", ":tada:") or a common emoji character ("👍")',
    inputSchema: {
      type: 'object',
      properties: {
        post_id: {
          type: 'string',
          description: 'Post ID of the message to react to',
        },
        emoji_name: {
          type: 'string',
          description:
            'Emoji name without colons (e.g. "thumbsup", "tada"); ":tada:" and common emoji characters are also accepted',
        },
      },
      required: ['post_id', 'emoji_name'],
    },
    handler: async (client: TimeClient, args: unknown, userId: string) => {
      const schema = z.object({
        post_id: z.string(),
        emoji_name: z.string(),
      });

      const params = schema.parse(args);
      const emojiName = normalizeEmojiName(params.emoji_name);
      await client.addReaction(userId, params.post_id, emojiName);

      return {
        content: [
          {
            type: 'text',
            text: `Reaction :${emojiName}: added to post ${params.post_id}`,
          },
        ],
      };
    },
  },

  {
    name: 'remove_reaction',
    description: 'Remove your own emoji reaction from a message',
    inputSchema: {
      type: 'object',
      properties: {
        post_id: {
          type: 'string',
          description: 'Post ID of the message',
        },
        emoji_name: {
          type: 'string',
          description: 'Emoji name of the reaction to remove',
        },
      },
      required: ['post_id', 'emoji_name'],
    },
    handler: async (client: TimeClient, args: unknown, userId: string) => {
      const schema = z.object({
        post_id: z.string(),
        emoji_name: z.string(),
      });

      const params = schema.parse(args);
      const emojiName = normalizeEmojiName(params.emoji_name);
      await client.removeReaction(userId, params.post_id, emojiName);

      return {
        content: [
          {
            type: 'text',
            text: `Reaction :${emojiName}: removed from post ${params.post_id}`,
          },
        ],
      };
    },
  },

  {
    name: 'get_reactions',
    description: 'List all emoji reactions on a message',
    inputSchema: {
      type: 'object',
      properties: {
        post_id: {
          type: 'string',
          description: 'Post ID of the message',
        },
      },
      required: ['post_id'],
    },
    handler: async (client: TimeClient, args: unknown) => {
      const schema = z.object({
        post_id: z.string(),
      });

      const params = schema.parse(args);
      const reactions = await client.getReactions(params.post_id);

      return {
        content: [
          {
            type: 'text',
            text: formatReactions(reactions),
          },
        ],
      };
    },
  },
];

/**
 * Groups reactions by emoji so the output reads like the messenger UI
 * (`:thumbsup: x3`) instead of one line per user.
 */
export function formatReactions(reactions: Reaction[] | null | undefined): string {
  if (!reactions || reactions.length === 0) {
    return 'No reactions on this message.';
  }

  const byEmoji = new Map<string, string[]>();
  for (const reaction of reactions) {
    const users = byEmoji.get(reaction.emoji_name) ?? [];
    users.push(reaction.user_id);
    byEmoji.set(reaction.emoji_name, users);
  }

  const lines = [...byEmoji.entries()].map(
    ([emoji, users]) => `:${emoji}: x${users.length} (${users.join(', ')})`
  );

  return `Reactions (${reactions.length}):\n${lines.join('\n')}`;
}
