import { describe, it, expect, vi, beforeEach } from 'vitest';
import { messageTools } from '../tools/messages.js';
import { threadTools } from '../tools/threads.js';
import { channelTools } from '../tools/channels.js';
import { channelCategoryTools } from '../tools/channel-categories.js';
import { teamTools } from '../tools/teams.js';
import { userTools } from '../tools/users.js';
import type { TimeClient } from '../client/time-client.js';
import type { Post, PostList, Channel, ChannelCategory, Team, User, Thread, ThreadStats, ChannelUnread, MarkChannelsReadResult, TeamUnread, SearchResult } from '../types/time-api.js';

const markChannelsReadResult = {
  successes: [],
  failures: [],
} satisfies MarkChannelsReadResult;

function createMockClient(overrides: Partial<TimeClient> = {}): TimeClient {
  return {
    getMe: vi.fn().mockResolvedValue({ id: 'me', username: 'me' } as User),
    getUser: vi.fn().mockResolvedValue({ id: 'u1', username: 'user1' } as User),
    searchUsers: vi.fn().mockResolvedValue([] as User[]),
    getTeamsForUser: vi.fn().mockResolvedValue([] as Team[]),
    getTeam: vi.fn().mockResolvedValue({ id: 't1', display_name: 'Team' } as Team),
    getTeamsUnread: vi.fn().mockResolvedValue([] as TeamUnread[]),
    getTeamUnread: vi.fn().mockResolvedValue({ team_id: 't1', msg_count: 5, mention_count: 1 } as TeamUnread),
    getChannelsForUser: vi.fn().mockResolvedValue([] as Channel[]),
    getAllChannelsForUser: vi.fn().mockResolvedValue([] as Channel[]),
    markChannelsRead: vi.fn().mockResolvedValue(markChannelsReadResult),
    getChannel: vi.fn().mockResolvedValue({ id: 'ch1', display_name: 'General' } as Channel),
    searchChannels: vi.fn().mockResolvedValue([] as Channel[]),
    getChannelUnread: vi.fn().mockResolvedValue({ channel_id: 'ch1', msg_count: 3, mention_count: 0 } as ChannelUnread),
    getChannelCategories: vi.fn().mockResolvedValue({ categories: [], order: [] }),
    createChannelCategory: vi.fn().mockResolvedValue(undefined),
    updateChannelCategory: vi.fn().mockResolvedValue(undefined),
    deleteChannelCategory: vi.fn().mockResolvedValue(undefined),
    reorderChannelCategories: vi.fn().mockResolvedValue([]),
    updateChannelCategories: vi.fn().mockResolvedValue([]),
    createPost: vi.fn().mockResolvedValue({ id: 'p1', create_at: 1000 } as Post),
    getPostsForChannel: vi.fn().mockResolvedValue({ order: [], posts: {}, next_post_id: '', prev_post_id: '' } as PostList),
    getPostThread: vi.fn().mockResolvedValue({ order: [], posts: {}, next_post_id: '', prev_post_id: '' } as PostList),
    searchPosts: vi.fn().mockResolvedValue({ order: [], posts: {} } as SearchResult),
    getUserThreads: vi.fn().mockResolvedValue([] as Thread[]),
    getThreadsStats: vi.fn().mockResolvedValue({ total_unread_threads: 2, total_unread_mentions: 1 } as ThreadStats),
    getUserThread: vi.fn().mockResolvedValue({ id: 'th1', reply_count: 3 } as Thread),
    startFollowingThread: vi.fn().mockResolvedValue(undefined),
    stopFollowingThread: vi.fn().mockResolvedValue(undefined),
    updateThreadRead: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as TimeClient;
}

const findTool = (tools: unknown[], name: string) =>
  (tools as { name: string; description: string; inputSchema: Record<string, unknown>; handler: Function }[]).find((t) => t.name === name)!;

const userId = 'user123';

function createCategory(overrides: Partial<ChannelCategory> = {}): ChannelCategory {
  return {
    id: 'category-1',
    user_id: userId,
    team_id: 'team-1',
    sort_order: 0,
    sorting: 'manual',
    type: 'custom',
    display_name: 'Projects',
    muted: false,
    collapsed: false,
    channel_ids: ['channel-1'],
    ...overrides,
  };
}

function findChannelCategoryTool(name: string) {
  const tool = channelCategoryTools.find((candidate) => candidate.name === name);
  if (tool === undefined) {
    throw new TypeError(`Missing channel category tool: ${name}`);
  }
  return tool;
}

describe('messageTools handlers', () => {
  let client: TimeClient;

  beforeEach(() => {
    client = createMockClient();
  });

  it('send_message calls createPost with correct args', async () => {
    const tool = findTool(messageTools, 'send_message');
    await tool.handler(client, { channel_id: 'ch1', message: 'Hi' });
    expect(client.createPost).toHaveBeenCalledWith('ch1', 'Hi', undefined);
  });

  it('send_message with root_id calls createPost with root_id', async () => {
    const tool = findTool(messageTools, 'send_message');
    await tool.handler(client, { channel_id: 'ch1', message: 'Reply', root_id: 'p1' });
    expect(client.createPost).toHaveBeenCalledWith('ch1', 'Reply', 'p1');
  });

  it('send_message rejects missing channel_id', async () => {
    const tool = findTool(messageTools, 'send_message');
    await expect(tool.handler(client, { message: 'Hi' })).rejects.toThrow();
  });

  it('send_message rejects missing message', async () => {
    const tool = findTool(messageTools, 'send_message');
    await expect(tool.handler(client, { channel_id: 'ch1' })).rejects.toThrow();
  });

  it('get_channel_messages calls getPostsForChannel', async () => {
    const tool = findTool(messageTools, 'get_channel_messages');
    await tool.handler(client, { channel_id: 'ch1', page: 2, per_page: 10 });
    expect(client.getPostsForChannel).toHaveBeenCalledWith('ch1', 2, 10);
  });

  it('get_channel_messages uses defaults', async () => {
    const tool = findTool(messageTools, 'get_channel_messages');
    await tool.handler(client, { channel_id: 'ch1' });
    expect(client.getPostsForChannel).toHaveBeenCalledWith('ch1', 0, 60);
  });

  it('get_channel_messages rejects per_page over the 200 cap', async () => {
    const tool = findTool(messageTools, 'get_channel_messages');
    await expect(
      tool.handler(client, { channel_id: 'ch1', per_page: 100000 })
    ).rejects.toThrow();
    expect(client.getPostsForChannel).not.toHaveBeenCalled();
  });

  it('get_channel_messages accepts per_page at the 200 cap', async () => {
    const tool = findTool(messageTools, 'get_channel_messages');
    await tool.handler(client, { channel_id: 'ch1', per_page: 200 });
    expect(client.getPostsForChannel).toHaveBeenCalledWith('ch1', 0, 200);
  });

  it('get_thread_messages calls getPostThread', async () => {
    const tool = findTool(messageTools, 'get_thread_messages');
    await tool.handler(client, { post_id: 'p1' });
    expect(client.getPostThread).toHaveBeenCalledWith('p1');
  });

  it('search_messages calls searchPosts', async () => {
    const tool = findTool(messageTools, 'search_messages');
    await tool.handler(client, { team_id: 't1', terms: 'hello' });
    expect(client.searchPosts).toHaveBeenCalledWith('t1', 'hello');
  });
});

describe('threadTools handlers', () => {
  let client: TimeClient;

  beforeEach(() => {
    client = createMockClient();
  });

  it('list_threads calls getUserThreads', async () => {
    const tool = findTool(threadTools, 'list_threads');
    await tool.handler(client, { team_id: 't1' }, userId);
    expect(client.getUserThreads).toHaveBeenCalledWith(userId, 't1');
  });

  it('get_thread_stats calls getThreadsStats', async () => {
    const tool = findTool(threadTools, 'get_thread_stats');
    const result = await tool.handler(client, { team_id: 't1' }, userId);
    expect(client.getThreadsStats).toHaveBeenCalledWith(userId, 't1');
    expect(result.content[0].text).toContain('2');
    expect(result.content[0].text).toContain('1');
  });

  it('get_thread calls getUserThread', async () => {
    const tool = findTool(threadTools, 'get_thread');
    await tool.handler(client, { team_id: 't1', thread_id: 'th1' }, userId);
    expect(client.getUserThread).toHaveBeenCalledWith(userId, 't1', 'th1');
  });

  it('follow_thread calls startFollowingThread', async () => {
    const tool = findTool(threadTools, 'follow_thread');
    await tool.handler(client, { thread_id: 'th1' }, userId);
    expect(client.startFollowingThread).toHaveBeenCalledWith(userId, 'th1');
  });

  it('unfollow_thread calls stopFollowingThread', async () => {
    const tool = findTool(threadTools, 'unfollow_thread');
    await tool.handler(client, { thread_id: 'th1' }, userId);
    expect(client.stopFollowingThread).toHaveBeenCalledWith(userId, 'th1');
  });

  it('mark_thread_read calls updateThreadRead with timestamp', async () => {
    const tool = findTool(threadTools, 'mark_thread_read');
    await tool.handler(client, { team_id: 't1', thread_id: 'th1', timestamp: 1700000000000 }, userId);
    expect(client.updateThreadRead).toHaveBeenCalledWith(userId, 't1', 'th1', 1700000000000);
  });

  it('mark_thread_read defaults timestamp to now', async () => {
    const tool = findTool(threadTools, 'mark_thread_read');
    const before = Date.now();
    await tool.handler(client, { team_id: 't1', thread_id: 'th1' }, userId);
    const after = Date.now();
    const calledTs = (client.updateThreadRead as ReturnType<typeof vi.fn>).mock.calls[0][3];
    expect(calledTs).toBeGreaterThanOrEqual(before);
    expect(calledTs).toBeLessThanOrEqual(after);
  });
});

describe('channelTools handlers', () => {
  let client: TimeClient;

  beforeEach(() => {
    client = createMockClient();
  });

  it('list_channels calls getChannelsForUser', async () => {
    const tool = findTool(channelTools, 'list_channels');
    await tool.handler(client, { team_id: 't1' }, userId);
    expect(client.getChannelsForUser).toHaveBeenCalledWith(userId, 't1');
  });

  it('get_channel calls getChannel', async () => {
    const tool = findTool(channelTools, 'get_channel');
    await tool.handler(client, { channel_id: 'ch1' });
    expect(client.getChannel).toHaveBeenCalledWith('ch1');
  });

  it('search_channels calls searchChannels', async () => {
    const tool = findTool(channelTools, 'search_channels');
    await tool.handler(client, { team_id: 't1', term: 'dev' });
    expect(client.searchChannels).toHaveBeenCalledWith('t1', 'dev');
  });

  it('get_channel_unread calls getChannelUnread', async () => {
    const tool = findTool(channelTools, 'get_channel_unread');
    await tool.handler(client, { channel_id: 'ch1' }, userId);
    expect(client.getChannelUnread).toHaveBeenCalledWith(userId, 'ch1');
  });

  it('publishes the renamed tool with a host-friendly root schema', () => {
    const tool = findTool(channelTools, 'mark_channels_read');

    expect(channelTools.map((candidate) => candidate.name)).toContain('mark_channels_read');
    expect(channelTools.map((candidate) => candidate.name)).not.toContain('time_mark_channels_read');
    expect(tool.description).toContain('cannot be undone');
    expect(tool.description).toMatch(/public.*private.*DM.*group/i);
    expect(tool.description).toMatch(/followed threads.*excluded/i);
    expect(tool.description).toContain('mark_thread_read');

    expect(tool.inputSchema).toEqual({
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
    });
  });

  it('selected mode trims, deduplicates, preserves order, and sends one request per channel', async () => {
    const tool = findTool(channelTools, 'mark_channels_read');
    vi.mocked(client.markChannelsRead).mockResolvedValue({
      successes: ['ch1', 'ch2', 'ch3'],
      failures: [],
    });

    const result = await tool.handler(client, {
      mode: 'selected',
      channel_ids: [' ch1 ', 'ch2', 'ch1', '  ch2  ', 'ch3'],
    }, userId);

    expect(client.getAllChannelsForUser).not.toHaveBeenCalled();
    expect(client.markChannelsRead).toHaveBeenCalledTimes(1);
    expect(client.markChannelsRead).toHaveBeenCalledWith(userId, ['ch1', 'ch2', 'ch3']);
    expect(client.getUserThreads).not.toHaveBeenCalled();
    expect(client.updateThreadRead).not.toHaveBeenCalled();
    expect(result.content[0].text).toBe('Marked 3 channel(s) as read.');
  });

  it('all mode discovers O, P, D, and G channels, deduplicates, and sends one request per channel', async () => {
    const tool = findTool(channelTools, 'mark_channels_read');
    const channel = {
      id: 'base',
      create_at: 0,
      update_at: 0,
      delete_at: 0,
      team_id: '',
      type: 'O',
      display_name: '',
      name: '',
      header: '',
      purpose: '',
      last_post_at: 0,
      total_msg_count: 0,
      extra_update_at: 0,
      creator_id: '',
      scheme_id: '',
      group_constrained: false,
      shared: false,
    } satisfies Channel;
    vi.mocked(client.getAllChannelsForUser).mockResolvedValue([
      { ...channel, id: 'public', type: 'O' },
      { ...channel, id: 'private', type: 'P' },
      { ...channel, id: 'direct', type: 'D' },
      { ...channel, id: 'group', type: 'G' },
      { ...channel, id: 'private', type: 'P' },
    ]);
    vi.mocked(client.markChannelsRead).mockResolvedValue({
      successes: ['public', 'private', 'direct'],
      failures: [{ channelId: 'group', message: 'service unavailable', statusCode: 503 }],
    });

    const result = await tool.handler(client, { mode: 'all' }, userId);

    expect(client.getAllChannelsForUser).toHaveBeenCalledTimes(1);
    expect(client.getAllChannelsForUser).toHaveBeenCalledWith(userId);
    expect(client.getChannelsForUser).not.toHaveBeenCalled();
    expect(client.getTeamsForUser).not.toHaveBeenCalled();
    expect(client.markChannelsRead).toHaveBeenCalledTimes(1);
    expect(client.markChannelsRead).toHaveBeenCalledWith(
      userId,
      ['public', 'private', 'direct', 'group']
    );
    expect(client.getUserThreads).not.toHaveBeenCalled();
    expect(client.getThreadsStats).not.toHaveBeenCalled();
    expect(client.getUserThread).not.toHaveBeenCalled();
    expect(client.startFollowingThread).not.toHaveBeenCalled();
    expect(client.stopFollowingThread).not.toHaveBeenCalled();
    expect(client.updateThreadRead).not.toHaveBeenCalled();
    expect(result.content[0].text).toBe(
      'Marked 3 of 4 channel(s) as read.\nFailed channels:\n- group: service unavailable (status 503)'
    );
    expect(result).not.toHaveProperty('isError');
  });

  it('reports successful channels and every failed channel for a partial result', async () => {
    const tool = findTool(channelTools, 'mark_channels_read');
    vi.mocked(client.markChannelsRead).mockResolvedValue({
      successes: ['ch1', 'ch3'],
      failures: [
        { channelId: 'ch2', message: 'forbidden', statusCode: 403 },
        { channelId: 'ch4', message: 'network timeout' },
      ],
    });

    const result = await tool.handler(client, {
      mode: 'selected',
      channel_ids: ['ch1', 'ch2', 'ch3', 'ch4'],
    }, userId);

    expect(result.content[0].text).toBe(
      'Marked 2 of 4 channel(s) as read.\nFailed channels:\n- ch2: forbidden (status 403)\n- ch4: network timeout'
    );
    expect(result).not.toHaveProperty('isError');
  });

  it('reports every channel failure when no channel was marked read', async () => {
    const tool = findTool(channelTools, 'mark_channels_read');
    vi.mocked(client.markChannelsRead).mockResolvedValue({
      successes: [],
      failures: [
        { channelId: 'ch1', message: 'forbidden', statusCode: 403 },
        { channelId: 'ch2', message: 'request timed out' },
      ],
    });

    const result = await tool.handler(client, {
      mode: 'selected',
      channel_ids: ['ch1', 'ch2'],
    }, userId);

    expect(result.content[0].text).toBe(
      'Failed to mark 2 channel(s) as read.\nFailed channels:\n- ch1: forbidden (status 403)\n- ch2: request timed out'
    );
    expect(result).not.toHaveProperty('isError');
  });

  it('all mode with no channels returns a no-op without channel requests', async () => {
    const tool = findTool(channelTools, 'mark_channels_read');

    const result = await tool.handler(client, { mode: 'all' }, userId);

    expect(client.getAllChannelsForUser).toHaveBeenCalledTimes(1);
    expect(client.markChannelsRead).not.toHaveBeenCalled();
    expect(result.content[0].text).toBe('No channels available to mark as read.');
  });

  it('propagates all-mode discovery failures without mutation or fallback calls', async () => {
    const tool = findTool(channelTools, 'mark_channels_read');
    const discoveryError = new Error('discovery failed');
    vi.mocked(client.getAllChannelsForUser).mockRejectedValue(discoveryError);

    await expect(tool.handler(client, { mode: 'all' }, userId)).rejects.toBe(discoveryError);

    expect(client.getAllChannelsForUser).toHaveBeenCalledTimes(1);
    expect(client.markChannelsRead).not.toHaveBeenCalled();
    expect(client.getChannelsForUser).not.toHaveBeenCalled();
    expect(client.getTeamsForUser).not.toHaveBeenCalled();
  });

  it('propagates channel-read failures without discovery or fallback calls', async () => {
    const tool = findTool(channelTools, 'mark_channels_read');
    const readError = new Error('channel read failed');
    vi.mocked(client.markChannelsRead).mockRejectedValue(readError);

    await expect(tool.handler(client, {
      mode: 'selected',
      channel_ids: ['ch1'],
    }, userId)).rejects.toBe(readError);

    expect(client.markChannelsRead).toHaveBeenCalledTimes(1);
    expect(client.getAllChannelsForUser).not.toHaveBeenCalled();
    expect(client.getChannelsForUser).not.toHaveBeenCalled();
    expect(client.getTeamsForUser).not.toHaveBeenCalled();
  });

  it.each([
    ['101 channel IDs', Array.from({ length: 101 }, (_, index) => `channel-${index}`)],
    ['a 129-character channel ID', ['x'.repeat(129)]],
  ])('rejects selected mode with %s before any downstream call', async (_label, channelIds) => {
    const tool = findTool(channelTools, 'mark_channels_read');

    await expect(tool.handler(client, {
      mode: 'selected',
      channel_ids: channelIds,
    }, userId)).rejects.toThrow();

    expect(client.markChannelsRead).not.toHaveBeenCalled();
    expect(client.getAllChannelsForUser).not.toHaveBeenCalled();
    expect(client.getUserThreads).not.toHaveBeenCalled();
    expect(client.getThreadsStats).not.toHaveBeenCalled();
    expect(client.getUserThread).not.toHaveBeenCalled();
    expect(client.startFollowingThread).not.toHaveBeenCalled();
    expect(client.stopFollowingThread).not.toHaveBeenCalled();
    expect(client.updateThreadRead).not.toHaveBeenCalled();
  });

  it.each([
    ['missing mode', {}],
    ['invalid mode', { mode: 'invalid' }],
    ['channel_ids in all mode', { mode: 'all', channel_ids: ['ch1'] }],
    ['missing channel_ids in selected mode', { mode: 'selected' }],
    ['empty channel_ids in selected mode', { mode: 'selected', channel_ids: [] }],
    ['whitespace-only channel ID', { mode: 'selected', channel_ids: ['   '] }],
    ['unexpected property', { mode: 'selected', channel_ids: ['ch1'], unexpected: true }],
  ])('rejects %s before calling the client', async (_label, input) => {
    const tool = findTool(channelTools, 'mark_channels_read');

    await expect(tool.handler(client, input, userId)).rejects.toThrow();

    expect(client.getAllChannelsForUser).not.toHaveBeenCalled();
    expect(client.markChannelsRead).not.toHaveBeenCalled();
  });
});

describe('channel category tools', () => {
  let client: TimeClient;

  beforeEach(() => {
    client = createMockClient();
  });

  it('exposes exactly the seven complete channel category tools', () => {
    expect(channelCategoryTools.map((tool) => tool.name)).toEqual([
      'time_list_channel_categories',
      'time_create_channel_category',
      'time_update_channel_category',
      'time_delete_channel_category',
      'time_reorder_channel_categories',
      'time_move_channel_to_category',
      'time_set_channel_favorite',
    ]);
  });

  it('publishes strict channel category JSON schemas without user_id', () => {
    for (const tool of channelCategoryTools) {
      expect(tool.inputSchema.type).toBe('object');
      expect(tool.inputSchema.additionalProperties).toBe(false);
      expect(JSON.stringify(tool.inputSchema)).not.toContain('user_id');
    }

    expect(findChannelCategoryTool('time_list_channel_categories').inputSchema).toMatchObject({
      properties: { team_id: { type: 'string', minLength: 1 } },
      required: ['team_id'],
    });
    expect(findChannelCategoryTool('time_create_channel_category').inputSchema).toMatchObject({
      properties: {
        team_id: { type: 'string', minLength: 1 },
        display_name: { type: 'string', minLength: 1 },
      },
      required: ['team_id', 'display_name'],
    });
    expect(findChannelCategoryTool('time_update_channel_category').inputSchema).toMatchObject({
      properties: {
        team_id: { type: 'string', minLength: 1 },
        category_id: { type: 'string', minLength: 1 },
        sorting: { enum: ['', 'manual', 'recent', 'alpha'] },
      },
      required: ['team_id', 'category_id'],
      anyOf: [
        { required: ['display_name'] },
        { required: ['sorting'] },
        { required: ['muted'] },
        { required: ['collapsed'] },
      ],
    });
    expect(findChannelCategoryTool('time_delete_channel_category').inputSchema).toMatchObject({
      properties: {
        team_id: { type: 'string', minLength: 1 },
        category_id: { type: 'string', minLength: 1 },
      },
      required: ['team_id', 'category_id'],
    });
    expect(findChannelCategoryTool('time_reorder_channel_categories').inputSchema).toMatchObject({
      properties: {
        team_id: { type: 'string', minLength: 1 },
        category_ids: {
          type: 'array',
          minItems: 1,
          items: { type: 'string', minLength: 1 },
        },
      },
      required: ['team_id', 'category_ids'],
    });
    expect(findChannelCategoryTool('time_move_channel_to_category').inputSchema).toMatchObject({
      properties: {
        team_id: { type: 'string', minLength: 1 },
        channel_id: { type: 'string', minLength: 1 },
        category_id: { type: 'string', minLength: 1 },
      },
      required: ['team_id', 'channel_id', 'category_id'],
    });
    expect(findChannelCategoryTool('time_set_channel_favorite').inputSchema).toMatchObject({
      properties: {
        team_id: { type: 'string', minLength: 1 },
        channel_id: { type: 'string', minLength: 1 },
        favorite: { type: 'boolean' },
      },
      required: ['team_id', 'channel_id', 'favorite'],
    });
  });

  it('rejects unknown, empty, and metadata-free channel category inputs', async () => {
    await expect(
      findChannelCategoryTool('time_list_channel_categories').handler(
        client,
        { team_id: 'team-1', user_id: 'someone-else' },
        userId
      )
    ).rejects.toThrow();
    await expect(
      findChannelCategoryTool('time_create_channel_category').handler(
        client,
        { team_id: 'team-1', display_name: '' },
        userId
      )
    ).rejects.toThrow();
    await expect(
      findChannelCategoryTool('time_update_channel_category').handler(
        client,
        { team_id: 'team-1', category_id: 'category-1' },
        userId
      )
    ).rejects.toThrow();
    await expect(
      findChannelCategoryTool('time_update_channel_category').handler(
        client,
        { team_id: 'team-1', category_id: 'category-1', channel_ids: ['channel-2'] },
        userId
      )
    ).rejects.toThrow();
    await expect(
      findChannelCategoryTool('time_reorder_channel_categories').handler(
        client,
        { team_id: 'team-1', category_ids: [] },
        userId
      )
    ).rejects.toThrow();
  });

  it('lists categories in response order with channel summaries and unknown IDs', async () => {
    const firstCategory = createCategory({ id: 'category-1', display_name: 'First' });
    const secondCategory = createCategory({
      id: 'category-2',
      display_name: 'Second',
      sort_order: 42,
      collapsed: true,
      channel_ids: ['channel-1', 'unknown-channel'],
    });
    const channel: Channel = {
      id: 'channel-1',
      create_at: 0,
      update_at: 0,
      delete_at: 0,
      team_id: 'team-1',
      type: 'O',
      display_name: 'Town Square',
      name: 'town-square',
      header: '',
      purpose: '',
      last_post_at: 0,
      total_msg_count: 42,
      extra_update_at: 0,
      creator_id: 'creator-1',
      scheme_id: '',
      group_constrained: false,
      shared: false,
    };
    client = createMockClient({
      getChannelCategories: vi.fn().mockResolvedValue({
        categories: [firstCategory, secondCategory],
        order: ['category-2', 'category-1'],
      }),
      getChannelsForUser: vi.fn().mockResolvedValue([channel]),
    });

    const result = await findChannelCategoryTool('time_list_channel_categories').handler(
      client,
      { team_id: 'team-1' },
      userId
    );
    const text = result.content[0].text;

    expect(client.getChannelCategories).toHaveBeenCalledWith(userId, 'team-1');
    expect(client.getChannelsForUser).toHaveBeenCalledWith(userId, 'team-1');
    expect(text.indexOf('Second')).toBeLessThan(text.indexOf('First'));
    expect(text).toContain('category-2');
    expect(text).toContain('manual');
    expect(text).toContain('Sort order: 42');
    expect(text).toContain('Collapsed: true');
    expect(text).toContain('[Public] Town Square');
    expect(text).toContain('channel-1');
    expect(text).toContain('town-square');
    expect(text).toContain('Last post: Never');
    expect(text).toContain('unknown-channel');
  });

  it('creates a custom category with no initial channels', async () => {
    const created = createCategory({ display_name: 'Planning', channel_ids: [] });
    client = createMockClient({ createChannelCategory: vi.fn().mockResolvedValue(created) });

    const result = await findChannelCategoryTool('time_create_channel_category').handler(
      client,
      { team_id: 'team-1', display_name: 'Planning' },
      userId
    );

    expect(client.createChannelCategory).toHaveBeenCalledWith(userId, 'team-1', {
      display_name: 'Planning',
      type: 'custom',
      channel_ids: [],
    });
    expect(result.content[0]).toMatchObject({ type: 'text' });
    expect(result.content[0].text).toContain('category-1');
  });

  it('updates supplied metadata while preserving the complete category', async () => {
    const existing = createCategory({ collapsed: true, channel_ids: ['channel-1', 'channel-2'] });
    const updated = createCategory({ display_name: 'Renamed', muted: true, collapsed: true, channel_ids: ['channel-1', 'channel-2'] });
    client = createMockClient({
      getChannelCategories: vi.fn().mockResolvedValue({ categories: [existing], order: [existing.id] }),
      updateChannelCategory: vi.fn().mockResolvedValue(updated),
    });

    const result = await findChannelCategoryTool('time_update_channel_category').handler(
      client,
      { team_id: 'team-1', category_id: existing.id, display_name: 'Renamed', muted: true },
      userId
    );

    expect(client.updateChannelCategory).toHaveBeenCalledWith(userId, 'team-1', existing.id, {
      ...existing,
      display_name: 'Renamed',
      muted: true,
    });
    expect(result.content[0]).toMatchObject({ type: 'text' });
    expect(result.content[0].text).toContain('Renamed');
  });

  it('rejects missing and managed categories before update', async () => {
    const managed = createCategory({ id: 'managed-1', type: 'managed' });
    client = createMockClient({
      getChannelCategories: vi.fn().mockResolvedValue({ categories: [managed], order: [managed.id] }),
    });
    const tool = findChannelCategoryTool('time_update_channel_category');

    await expect(
      tool.handler(client, { team_id: 'team-1', category_id: 'missing', muted: true }, userId)
    ).rejects.toThrow(/not found/i);
    await expect(
      tool.handler(client, { team_id: 'team-1', category_id: managed.id, muted: true }, userId)
    ).rejects.toThrow(/managed/i);
    expect(client.updateChannelCategory).not.toHaveBeenCalled();
  });

  it('deletes one category through the direct route', async () => {
    const result = await findChannelCategoryTool('time_delete_channel_category').handler(
      client,
      { team_id: 'team-1', category_id: 'category-1' },
      userId
    );

    expect(client.deleteChannelCategory).toHaveBeenCalledWith(userId, 'team-1', 'category-1');
    expect(result.content[0]).toMatchObject({ type: 'text' });
  });

  it('sends the requested category order as a raw array', async () => {
    client = createMockClient({
      reorderChannelCategories: vi.fn().mockResolvedValue(['category-2', 'category-1']),
    });

    const result = await findChannelCategoryTool('time_reorder_channel_categories').handler(
      client,
      { team_id: 'team-1', category_ids: ['category-2', 'category-1'] },
      userId
    );

    expect(client.reorderChannelCategories).toHaveBeenCalledWith(
      userId,
      'team-1',
      ['category-2', 'category-1']
    );
    expect(result.content[0]).toMatchObject({ type: 'text' });
    expect(result.content[0].text).toContain('category-2');
  });

  it('rejects malformed move input before listing categories', async () => {
    const tool = findChannelCategoryTool('time_move_channel_to_category');

    await expect(
      tool.handler(client, { team_id: 'team-1', channel_id: '', category_id: 'category-1' }, userId)
    ).rejects.toThrow();
    await expect(
      tool.handler(
        client,
        { team_id: 'team-1', channel_id: 'channel-1', category_id: 'category-1', user_id: 'other' },
        userId
      )
    ).rejects.toThrow();
    expect(client.getChannelCategories).not.toHaveBeenCalled();
  });

  it('rejects malformed favorite input before listing categories', async () => {
    const tool = findChannelCategoryTool('time_set_channel_favorite');

    await expect(
      tool.handler(client, { team_id: 'team-1', channel_id: 'channel-1', favorite: 'yes' }, userId)
    ).rejects.toThrow();
    await expect(
      tool.handler(client, { team_id: 'team-1', channel_id: 'channel-1' }, userId)
    ).rejects.toThrow();
    expect(client.getChannelCategories).not.toHaveBeenCalled();
  });

  it('rejects a missing move destination without issuing an update', async () => {
    const channels = createCategory({ id: 'channels', type: 'channels' });
    client = createMockClient({
      getChannelCategories: vi.fn().mockResolvedValue({ categories: [channels], order: [channels.id] }),
    });

    await expect(
      findChannelCategoryTool('time_move_channel_to_category').handler(
        client,
        { team_id: 'team-1', channel_id: 'channel-1', category_id: 'missing' },
        userId
      )
    ).rejects.toThrow(/not found.*missing/i);
    expect(client.getChannelCategories).toHaveBeenCalledTimes(1);
    expect(client.getChannelCategories).toHaveBeenCalledWith(userId, 'team-1');
    expect(client.updateChannelCategories).not.toHaveBeenCalled();
  });

  it.each(['direct_messages', 'managed'] as const)(
    'rejects a %s move destination without issuing an update',
    async (type) => {
      const destination = createCategory({ id: `${type}-category`, type });
      client = createMockClient({
        getChannelCategories: vi.fn().mockResolvedValue({
          categories: [destination],
          order: [destination.id],
        }),
      });

      await expect(
        findChannelCategoryTool('time_move_channel_to_category').handler(
          client,
          { team_id: 'team-1', channel_id: 'channel-1', category_id: destination.id },
          userId
        )
      ).rejects.toThrow(new RegExp(type.replace('_', ' '), 'i'));
      expect(client.updateChannelCategories).not.toHaveBeenCalled();
    }
  );

  it('moves atomically by removing all explicit duplicates and preserving complete metadata', async () => {
    const channels = createCategory({
      id: 'channels',
      type: 'channels',
      display_name: 'Channels',
      sorting: 'alpha',
      muted: true,
      channel_ids: ['channel-1', 'channel-2', 'channel-1'],
    });
    const destination = createCategory({
      id: 'destination',
      display_name: 'Destination',
      sort_order: 8,
      collapsed: true,
      channel_ids: ['channel-3', 'channel-1', 'channel-1'],
    });
    const favorites = createCategory({
      id: 'favorites',
      type: 'favorites',
      display_name: 'Favorites',
      channel_ids: ['channel-1', 'channel-4'],
    });
    const managed = createCategory({
      id: 'managed',
      type: 'managed',
      display_name: 'Managed',
      channel_ids: ['channel-1'],
    });
    client = createMockClient({
      getChannelCategories: vi.fn().mockResolvedValue({
        categories: [channels, destination, favorites, managed],
        order: [channels.id, destination.id, favorites.id, managed.id],
      }),
      updateChannelCategories: vi.fn().mockResolvedValue([
        { ...favorites, channel_ids: ['channel-4'] },
        { ...destination, channel_ids: ['channel-3', 'channel-1'] },
        { ...channels, channel_ids: ['channel-2'] },
      ]),
    });

    await findChannelCategoryTool('time_move_channel_to_category').handler(
      client,
      { team_id: 'team-1', channel_id: 'channel-1', category_id: destination.id },
      userId
    );

    expect(client.getChannelCategories).toHaveBeenCalledTimes(1);
    expect(client.getChannelCategories).toHaveBeenCalledWith(userId, 'team-1');
    expect(client.updateChannelCategories).toHaveBeenCalledTimes(1);
    expect(client.updateChannelCategories).toHaveBeenCalledWith(userId, 'team-1', [
      { ...channels, channel_ids: ['channel-2'] },
      { ...destination, channel_ids: ['channel-3', 'channel-1'] },
      { ...favorites, channel_ids: ['channel-4'] },
    ]);
  });

  it('accepts a reordered normalized response with the exact move destination', async () => {
    const source = createCategory({ id: 'source', display_name: 'Shared name', channel_ids: ['channel-1'] });
    const destination = createCategory({ id: 'destination', display_name: 'Shared name', channel_ids: [] });
    client = createMockClient({
      getChannelCategories: vi.fn().mockResolvedValue({
        categories: [source, destination],
        order: [source.id, destination.id],
      }),
      updateChannelCategories: vi.fn().mockResolvedValue([
        { ...destination, channel_ids: ['channel-1'] },
        { ...source, channel_ids: [] },
      ]),
    });

    const result = await findChannelCategoryTool('time_move_channel_to_category').handler(
      client,
      { team_id: 'team-1', channel_id: 'channel-1', category_id: destination.id },
      userId
    );

    expect(result.content[0].text).toMatch(/moved/i);
  });

  it.each([
    {
      label: 'missing',
      response: [createCategory({ id: 'other', display_name: 'Destination', channel_ids: ['channel-1'] })],
    },
    {
      label: 'duplicated',
      response: [
        createCategory({ id: 'destination', channel_ids: ['channel-1'] }),
        createCategory({ id: 'destination', type: 'favorites', channel_ids: ['channel-1'] }),
      ],
    },
  ])('rejects a normalized move response with a $label exact destination', async ({ response }) => {
    const source = createCategory({ id: 'source', channel_ids: ['channel-1'] });
    const destination = createCategory({ id: 'destination', display_name: 'Destination', channel_ids: [] });
    client = createMockClient({
      getChannelCategories: vi.fn().mockResolvedValue({
        categories: [source, destination],
        order: [source.id, destination.id],
      }),
      updateChannelCategories: vi.fn().mockResolvedValue(response),
    });

    await expect(
      findChannelCategoryTool('time_move_channel_to_category').handler(
        client,
        { team_id: 'team-1', channel_id: 'channel-1', category_id: destination.id },
        userId
      )
    ).rejects.toThrow();
  });

  it('rejects a sole exact move destination when normalization filters the channel', async () => {
    const source = createCategory({ id: 'source', channel_ids: ['channel-1'] });
    const destination = createCategory({ id: 'destination', channel_ids: [] });
    client = createMockClient({
      getChannelCategories: vi.fn().mockResolvedValue({
        categories: [source, destination],
        order: [source.id, destination.id],
      }),
      updateChannelCategories: vi.fn().mockResolvedValue([{ ...destination, channel_ids: [] }]),
    });

    await expect(
      findChannelCategoryTool('time_move_channel_to_category').handler(
        client,
        { team_id: 'team-1', channel_id: 'channel-1', category_id: destination.id },
        userId
      )
    ).rejects.toThrow();
  });

  it('skips the collection update when a move is already normalized', async () => {
    const channels = createCategory({ id: 'channels', type: 'channels', channel_ids: ['channel-2'] });
    const destination = createCategory({ id: 'destination', channel_ids: ['channel-1'] });
    const managed = createCategory({ id: 'managed', type: 'managed', channel_ids: ['channel-1'] });
    client = createMockClient({
      getChannelCategories: vi.fn().mockResolvedValue({
        categories: [channels, destination, managed],
        order: [channels.id, destination.id, managed.id],
      }),
    });

    const result = await findChannelCategoryTool('time_move_channel_to_category').handler(
      client,
      { team_id: 'team-1', channel_id: 'channel-1', category_id: destination.id },
      userId
    );

    expect(client.getChannelCategories).toHaveBeenCalledTimes(1);
    expect(client.updateChannelCategories).not.toHaveBeenCalled();
    expect(result.content[0].text).toMatch(/already/i);
  });

  it('favorites a channel by moving it to the required Favorites category', async () => {
    const source = createCategory({ id: 'source', channel_ids: ['channel-1', 'channel-2'] });
    const favorites = createCategory({
      id: 'favorites',
      type: 'favorites',
      display_name: 'Favorites',
      channel_ids: [],
    });
    client = createMockClient({
      getChannelCategories: vi.fn().mockResolvedValue({
        categories: [source, favorites],
        order: [source.id, favorites.id],
      }),
      updateChannelCategories: vi.fn().mockResolvedValue([
        { ...favorites, channel_ids: ['channel-1'] },
        { ...source, channel_ids: ['channel-2'] },
      ]),
    });

    await findChannelCategoryTool('time_set_channel_favorite').handler(
      client,
      { team_id: 'team-1', channel_id: 'channel-1', favorite: true },
      userId
    );

    expect(client.getChannelCategories).toHaveBeenCalledTimes(1);
    expect(client.updateChannelCategories).toHaveBeenCalledTimes(1);
    expect(client.updateChannelCategories).toHaveBeenCalledWith(userId, 'team-1', [
      { ...source, channel_ids: ['channel-2'] },
      { ...favorites, channel_ids: ['channel-1'] },
    ]);
  });

  it('unfavorites a channel by moving it to the required Channels category', async () => {
    const favorites = createCategory({
      id: 'favorites',
      type: 'favorites',
      channel_ids: ['channel-1', 'channel-1'],
    });
    const channels = createCategory({
      id: 'channels',
      type: 'channels',
      display_name: 'Channels',
      channel_ids: ['channel-2'],
    });
    client = createMockClient({
      getChannelCategories: vi.fn().mockResolvedValue({
        categories: [favorites, channels],
        order: [favorites.id, channels.id],
      }),
      updateChannelCategories: vi.fn().mockResolvedValue([
        { ...channels, channel_ids: ['channel-2', 'channel-1'] },
        { ...favorites, channel_ids: [] },
      ]),
    });

    await findChannelCategoryTool('time_set_channel_favorite').handler(
      client,
      { team_id: 'team-1', channel_id: 'channel-1', favorite: false },
      userId
    );

    expect(client.updateChannelCategories).toHaveBeenCalledTimes(1);
    expect(client.updateChannelCategories).toHaveBeenCalledWith(userId, 'team-1', [
      { ...favorites, channel_ids: [] },
      { ...channels, channel_ids: ['channel-2', 'channel-1'] },
    ]);
  });

  it.each([
    { favorite: true, destinationType: 'favorites' },
    { favorite: false, destinationType: 'channels' },
  ] as const)(
    'rejects a normalized favorite=$favorite response that filters the channel',
    async ({ favorite, destinationType }) => {
      const source = createCategory({
        id: favorite ? 'channels' : 'favorites',
        type: favorite ? 'channels' : 'favorites',
        channel_ids: ['channel-1'],
      });
      const destination = createCategory({ id: destinationType, type: destinationType, channel_ids: [] });
      client = createMockClient({
        getChannelCategories: vi.fn().mockResolvedValue({
          categories: [source, destination],
          order: [source.id, destination.id],
        }),
        updateChannelCategories: vi.fn().mockResolvedValue([{ ...destination, channel_ids: [] }]),
      });

      await expect(
        findChannelCategoryTool('time_set_channel_favorite').handler(
          client,
          { team_id: 'team-1', channel_id: 'channel-1', favorite },
          userId
        )
      ).rejects.toThrow();
    }
  );

  it.each([
    { favorite: true, requiredType: 'favorites', label: 'Favorites' },
    { favorite: false, requiredType: 'channels', label: 'Channels' },
  ] as const)(
    'errors clearly when the required $label category is missing',
    async ({ favorite, requiredType }) => {
      const otherCategory = createCategory({ id: 'other', type: favorite ? 'channels' : 'favorites' });
      client = createMockClient({
        getChannelCategories: vi.fn().mockResolvedValue({
          categories: [otherCategory],
          order: [otherCategory.id],
        }),
      });

      await expect(
        findChannelCategoryTool('time_set_channel_favorite').handler(
          client,
          { team_id: 'team-1', channel_id: 'channel-1', favorite },
          userId
        )
      ).rejects.toThrow(new RegExp(`required.*${requiredType}`, 'i'));
      expect(client.updateChannelCategories).not.toHaveBeenCalled();
    }
  );
});

describe('teamTools handlers', () => {
  let client: TimeClient;

  beforeEach(() => {
    client = createMockClient();
  });

  it('list_teams calls getTeamsForUser', async () => {
    const tool = findTool(teamTools, 'list_teams');
    await tool.handler(client, {}, userId);
    expect(client.getTeamsForUser).toHaveBeenCalledWith(userId);
  });

  it('get_team calls getTeam', async () => {
    const tool = findTool(teamTools, 'get_team');
    await tool.handler(client, { team_id: 't1' });
    expect(client.getTeam).toHaveBeenCalledWith('t1');
  });

  it('get_teams_unread calls getTeamsUnread', async () => {
    const tool = findTool(teamTools, 'get_teams_unread');
    await tool.handler(client, {}, userId);
    expect(client.getTeamsUnread).toHaveBeenCalledWith(userId);
  });

  it('get_team_unread calls getTeamUnread', async () => {
    const tool = findTool(teamTools, 'get_team_unread');
    await tool.handler(client, { team_id: 't1' }, userId);
    expect(client.getTeamUnread).toHaveBeenCalledWith(userId, 't1');
  });
});

describe('userTools handlers', () => {
  let client: TimeClient;

  beforeEach(() => {
    client = createMockClient();
  });

  it('get_me calls getMe', async () => {
    const tool = findTool(userTools, 'get_me');
    await tool.handler(client, {});
    expect(client.getMe).toHaveBeenCalled();
  });

  it('get_user calls getUser', async () => {
    const tool = findTool(userTools, 'get_user');
    await tool.handler(client, { user_id: 'u1' });
    expect(client.getUser).toHaveBeenCalledWith('u1');
  });

  it('search_users calls searchUsers', async () => {
    const tool = findTool(userTools, 'search_users');
    await tool.handler(client, { term: 'john' });
    expect(client.searchUsers).toHaveBeenCalledWith('john');
  });
});
