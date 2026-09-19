import { z } from 'zod';
import type { TimeClient } from '../client/time-client.js';
import type { Reaction } from '../types/time-api.js';
import { resolveUsernames } from './usernames.js';

/**
 * The API accepts only emoji *names*, never the character itself, and the name
 * has to be the canonical one — the first short name the server would return
 * for that character (`👍` is `+1`, not `thumbsup`; `💯` is `100`, not
 * `one_hundred`). A non-canonical spelling either 400s or, where the alias also
 * exists, lands as a *separate* reaction: reactions are unique per
 * (user_id, post_id, emoji_name), so `thumbsup` would sit next to the `+1`
 * pill the native client writes instead of joining it.
 */
const EMOJI_CHAR_TO_NAME: Record<string, string> = {
  '👍': '+1',
  '👎': '-1',
  '❤️': 'heart',
  '❤': 'heart',
  '😀': 'grinning',
  '😁': 'grin',
  '😂': 'joy',
  '🤣': 'rolling_on_the_floor_laughing',
  '😊': 'blush',
  '😉': 'wink',
  '😍': 'heart_eyes',
  '🤔': 'thinking_face',
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
  '💯': '100',
  '✅': 'white_check_mark',
  '☑️': 'ballot_box_with_check',
  '✔️': 'heavy_check_mark',
  '❌': 'x',
  '⚠️': 'warning',
  '👀': 'eyes',
  '🤞': 'crossed_fingers',
  '🤡': 'clown_face',
  '💩': 'hankey',
  '🍕': 'pizza',
  '☕': 'coffee',
  '🤯': 'exploding_head',
  '🥹': 'face_holding_back_tears',
};

/**
 * Same problem from the other side: a caller who types a well-known alias by
 * name would create a second pill next to the canonical reaction, so the
 * aliases of the characters above are folded into the canonical name too.
 */
const EMOJI_ALIAS_TO_NAME: Record<string, string> = {
  thumbsup: '+1',
  thumbsdown: '-1',
  rofl: 'rolling_on_the_floor_laughing',
  thinking: 'thinking_face',
  one_hundred: '100',
  poop: 'hankey',
  shit: 'hankey',
};

const EMOJI_NAME_PATTERN = /^[a-z0-9_+-]+$/;

/**
 * Normalizes user input to the canonical emoji name: `:tada:`, `tada` and `🎉`
 * all become `tada`, `👍` and `thumbsup` both become `+1`. Unknown characters
 * are rejected explicitly rather than sent through, so the caller gets an
 * actionable message instead of an opaque 400 from the API.
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
      `Unsupported emoji "${input}". Pass the emoji name instead, e.g. "+1" or ":tada:".`
    );
  }

  return EMOJI_ALIAS_TO_NAME[name] ?? name;
}

export const reactionTools = [
  {
    name: 'add_reaction',
    description:
      'Add an emoji reaction to a message. Accepts an emoji name ("+1", ":tada:") or a common emoji character ("👍")',
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
            'Emoji name without colons (e.g. "+1", "tada"); ":tada:", well-known aliases ("thumbsup") and common emoji characters are also accepted',
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
      const authors = await resolveUsernames(
        client,
        (reactions ?? []).map((reaction) => reaction.user_id)
      );

      return {
        content: [
          {
            type: 'text',
            text: formatReactions(reactions, authors),
          },
        ],
      };
    },
  },
];

/**
 * Groups reactions by emoji so the output reads like the messenger UI
 * (`:+1: x3`) instead of one line per user.
 */
export function formatReactions(
  reactions: Reaction[] | null | undefined,
  authors?: Map<string, string>
): string {
  if (!reactions || reactions.length === 0) {
    return 'No reactions on this message.';
  }

  const byEmoji = new Map<string, string[]>();
  for (const reaction of reactions) {
    const users = byEmoji.get(reaction.emoji_name) ?? [];
    const username = authors?.get(reaction.user_id);
    users.push(username ? `@${username}` : reaction.user_id);
    byEmoji.set(reaction.emoji_name, users);
  }

  const lines = [...byEmoji.entries()].map(
    ([emoji, users]) => `:${emoji}: x${users.length} (${users.join(', ')})`
  );

  return `Reactions (${reactions.length}):\n${lines.join('\n')}`;
}
