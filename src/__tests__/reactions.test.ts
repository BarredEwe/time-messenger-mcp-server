import { describe, it, expect, vi, beforeEach } from 'vitest';
import { reactionTools, normalizeEmojiName, formatReactions } from '../tools/reactions.js';
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
    expect(normalizeEmojiName('thumbsup')).toBe('thumbsup');
  });

  it('strips colons and lowercases', () => {
    expect(normalizeEmojiName(':Tada:')).toBe('tada');
  });

  it('maps a known emoji character to its name', () => {
    expect(normalizeEmojiName('👍')).toBe('thumbsup');
    expect(normalizeEmojiName(' 🎉 ')).toBe('tada');
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
  });

  it('add_reaction calls addReaction with the normalized name', async () => {
    const tool = findTool('add_reaction');
    const result = await tool.handler(client, { post_id: 'p1', emoji_name: '👍' }, userId);
    expect(client.addReaction).toHaveBeenCalledWith(userId, 'p1', 'thumbsup');
    expect(result.content[0].text).toContain(':thumbsup:');
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

  it('add_reaction rejects a missing post_id', async () => {
    const tool = findTool('add_reaction');
    await expect(tool.handler(client, { emoji_name: 'thumbsup' }, userId)).rejects.toThrow();
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
      reaction('u1', 'thumbsup'),
      reaction('u2', 'thumbsup'),
      reaction('u3', 'tada'),
    ]);

    expect(text).toContain('Reactions (3):');
    expect(text).toContain(':thumbsup: x2 (u1, u2)');
    expect(text).toContain(':tada: x1 (u3)');
  });

  it('handles null from the API', () => {
    expect(formatReactions(null)).toBe('No reactions on this message.');
  });
});
