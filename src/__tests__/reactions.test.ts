import { describe, it, expect, vi, beforeEach } from 'vitest';
import { reactionTools, normalizeEmojiName, formatReactions } from '../tools/reactions.js';
import { clearUsernameCache } from '../tools/usernames.js';
import type { TimeClient } from '../client/time-client.js';
import type { Reaction } from '../types/time-api.js';

const userId = 'user123';

function createMockClient(): TimeClient {
  return {
    addReaction: vi.fn().mockResolvedValue({
      user_id: userId,
      post_id: 'p1',
      emoji_name: 'thumbsup',
      create_at: 1000,
    } as Reaction),
    removeReaction: vi.fn().mockResolvedValue(undefined),
    getReactions: vi.fn().mockResolvedValue([] as Reaction[]),
  } as unknown as TimeClient;
}

const findTool = (name: string) =>
  (reactionTools as { name: string; handler: Function }[]).find((t) => t.name === name)!;

describe('normalizeEmojiName', () => {
  it('keeps a bare name as is', () => {
    expect(normalizeEmojiName('eyes')).toBe('eyes');
  });

  it('strips colons and lowercases', () => {
    expect(normalizeEmojiName(':Tada:')).toBe('tada');
  });

  it('maps a known emoji character to its canonical name', () => {
    expect(normalizeEmojiName('👍')).toBe('+1');
    expect(normalizeEmojiName('👎')).toBe('-1');
    expect(normalizeEmojiName('💯')).toBe('100');
    expect(normalizeEmojiName('💩')).toBe('hankey');
    expect(normalizeEmojiName('🤔')).toBe('thinking_face');
    expect(normalizeEmojiName('🤣')).toBe('rolling_on_the_floor_laughing');
    expect(normalizeEmojiName(' 🎉 ')).toBe('tada');
  });

  it('folds a well-known alias into the canonical name', () => {
    // Otherwise the reaction would land next to the pill the native client
    // writes: reactions are unique per (user_id, post_id, emoji_name).
    expect(normalizeEmojiName('thumbsup')).toBe('+1');
    expect(normalizeEmojiName(':thumbsdown:')).toBe('-1');
    expect(normalizeEmojiName('one_hundred')).toBe('100');
    expect(normalizeEmojiName('poop')).toBe('hankey');
  });

  it('accepts canonical names that are not plain words', () => {
    expect(normalizeEmojiName('+1')).toBe('+1');
    expect(normalizeEmojiName(':100:')).toBe('100');
  });

  it('rejects an unknown emoji character', () => {
    expect(() => normalizeEmojiName('🫠')).toThrow(/Unsupported emoji/);
  });

  it('rejects a name with invalid characters', () => {
    expect(() => normalizeEmojiName('thumbs up!')).toThrow(/Unsupported emoji/);
  });
});

describe('reactionTools handlers', () => {
  let client: TimeClient;

  beforeEach(() => {
    client = createMockClient();
    clearUsernameCache();
  });

  it('add_reaction calls addReaction with the normalized name', async () => {
    const tool = findTool('add_reaction');
    const result = await tool.handler(client, { post_id: 'p1', emoji_name: '👍' }, userId);
    expect(client.addReaction).toHaveBeenCalledWith(userId, 'p1', '+1');
    expect(result.content[0].text).toContain(':+1:');
  });

  it('remove_reaction calls removeReaction with the normalized name', async () => {
    const tool = findTool('remove_reaction');
    await tool.handler(client, { post_id: 'p1', emoji_name: ':tada:' }, userId);
    expect(client.removeReaction).toHaveBeenCalledWith(userId, 'p1', 'tada');
  });

  it('get_reactions reports an empty list', async () => {
    const tool = findTool('get_reactions');
    const result = await tool.handler(client, { post_id: 'p1' }, userId);
    expect(client.getReactions).toHaveBeenCalledWith('p1');
    expect(result.content[0].text).toBe('No reactions on this message.');
  });

  it('get_reactions resolves reaction authors to usernames', async () => {
    const withReactions = {
      getReactions: vi.fn().mockResolvedValue([
        { user_id: 'u1', post_id: 'p1', emoji_name: 'eyes', create_at: 1 },
        { user_id: 'u2', post_id: 'p1', emoji_name: 'eyes', create_at: 2 },
      ] as Reaction[]),
      getUsersByIds: vi.fn().mockResolvedValue([
        { id: 'u1', username: 'alice' },
        { id: 'u2', username: 'bob' },
      ]),
    } as unknown as TimeClient;

    const tool = findTool('get_reactions');
    const result = await tool.handler(withReactions, { post_id: 'p1' }, userId);

    expect(withReactions.getUsersByIds).toHaveBeenCalledWith(['u1', 'u2']);
    expect(result.content[0].text).toContain(':eyes: x2 (@alice, @bob)');
  });

  it('get_reactions prints the raw id when a reacting profile cannot be resolved', async () => {
    const withReactions = {
      getReactions: vi.fn().mockResolvedValue([
        { user_id: 'u1', post_id: 'p1', emoji_name: 'eyes', create_at: 1 },
        { user_id: 'u_missing', post_id: 'p1', emoji_name: 'eyes', create_at: 2 },
      ] as Reaction[]),
      getUsersByIds: vi.fn().mockResolvedValue([{ id: 'u1', username: 'alice' }]),
    } as unknown as TimeClient;

    const tool = findTool('get_reactions');
    const result = await tool.handler(withReactions, { post_id: 'p1' }, userId);

    expect(result.content[0].text).toContain(':eyes: x2 (@alice, u_missing)');
  });

  it('get_reactions survives a failed profile lookup', async () => {
    const withReactions = {
      getReactions: vi.fn().mockResolvedValue([
        { user_id: 'u1', post_id: 'p1', emoji_name: 'tada', create_at: 1 },
      ] as Reaction[]),
      getUsersByIds: vi.fn().mockRejectedValue(new Error('503 Service Unavailable')),
    } as unknown as TimeClient;

    const tool = findTool('get_reactions');
    const result = await tool.handler(withReactions, { post_id: 'p1' }, userId);

    expect(result.content[0].text).toContain(':tada: x1 (u1)');
  });

  it('add_reaction rejects a missing post_id', async () => {
    const tool = findTool('add_reaction');
    await expect(tool.handler(client, { emoji_name: '+1' }, userId)).rejects.toThrow();
  });
});

describe('formatReactions', () => {
  const reaction = (user: string, emoji: string): Reaction => ({
    user_id: user,
    post_id: 'p1',
    emoji_name: emoji,
    create_at: 1000,
  });

  it('groups reactions by emoji', () => {
    const text = formatReactions([
      reaction('u1', '+1'),
      reaction('u2', '+1'),
      reaction('u3', 'tada'),
    ]);

    expect(text).toContain('Reactions (3):');
    expect(text).toContain(':+1: x2 (u1, u2)');
    expect(text).toContain(':tada: x1 (u3)');
  });

  it('prints usernames when an authors map is supplied', () => {
    const text = formatReactions(
      [reaction('u1', 'eyes'), reaction('u2', 'eyes')],
      new Map([['u1', 'alice']])
    );

    // u2 has no resolved profile, so its raw id stays readable in the output.
    expect(text).toContain(':eyes: x2 (@alice, u2)');
  });

  it('handles null from the API', () => {
    expect(formatReactions(null)).toBe('No reactions on this message.');
  });
});
