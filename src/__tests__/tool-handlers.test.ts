import { describe, it, expect, vi, beforeEach } from 'vitest';
import { messageTools } from '../tools/messages.js';
import { threadTools } from '../tools/threads.js';
import { channelTools } from '../tools/channels.js';
import { teamTools } from '../tools/teams.js';
import { userTools } from '../tools/users.js';
import type { TimeClient } from '../client/time-client.js';
import type { Post, PostList, Channel, Team, User, Thread, ThreadStats, ChannelUnread, MarkChannelsReadResponse, TeamUnread, SearchResult } from '../types/time-api.js';

const markChannelsReadResponse = {
  status: 'OK',
  last_viewed_at_times: {},
} satisfies MarkChannelsReadResponse;

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
    markChannelsRead: vi.fn().mockResolvedValue(markChannelsReadResponse),
    getChannel: vi.fn().mockResolvedValue({ id: 'ch1', display_name: 'General' } as Channel),
    searchChannels: vi.fn().mockResolvedValue([] as Channel[]),
    getChannelUnread: vi.fn().mockResolvedValue({ channel_id: 'ch1', msg_count: 3, mention_count: 0 } as ChannelUnread),
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
  (tools as { name: string; inputSchema: Record<string, unknown>; handler: Function }[]).find((t) => t.name === name)!;

const userId = 'user123';

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

  it('exposes a closed two-branch schema for explicit all and selected modes', () => {
    const tool = findTool(channelTools, 'time_mark_channels_read');

    expect(tool.inputSchema).toEqual({
      type: 'object',
      oneOf: [
        {
          type: 'object',
          properties: { mode: { type: 'string', const: 'all' } },
          required: ['mode'],
          additionalProperties: false,
        },
        {
          type: 'object',
          properties: {
            mode: { type: 'string', const: 'selected' },
            channel_ids: {
              type: 'array',
              minItems: 1,
              items: { type: 'string', minLength: 1 },
            },
          },
          required: ['mode', 'channel_ids'],
          additionalProperties: false,
        },
      ],
    });
  });

  it('selected mode trims, deduplicates, preserves order, and sends one bulk request', async () => {
    const tool = findTool(channelTools, 'time_mark_channels_read');

    const result = await tool.handler(client, {
      mode: 'selected',
      channel_ids: [' ch1 ', 'ch2', 'ch1', '  ch2  ', 'ch3'],
    }, userId);

    expect(client.getAllChannelsForUser).not.toHaveBeenCalled();
    expect(client.markChannelsRead).toHaveBeenCalledTimes(1);
    expect(client.markChannelsRead).toHaveBeenCalledWith(userId, ['ch1', 'ch2', 'ch3']);
    expect(result.content[0].text).toContain('3');
  });

  it('all mode discovers O, P, D, and G channels, deduplicates, and sends one bulk request', async () => {
    const tool = findTool(channelTools, 'time_mark_channels_read');
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
    expect(result.content[0].text).toContain('4');
  });

  it('all mode with no channels returns a no-op without a bulk request', async () => {
    const tool = findTool(channelTools, 'time_mark_channels_read');

    const result = await tool.handler(client, { mode: 'all' }, userId);

    expect(client.getAllChannelsForUser).toHaveBeenCalledTimes(1);
    expect(client.markChannelsRead).not.toHaveBeenCalled();
    expect(result.content[0].text).toBe('No channels available to mark as read.');
  });

  it('propagates all-mode discovery failures without mutation or fallback calls', async () => {
    const tool = findTool(channelTools, 'time_mark_channels_read');
    const discoveryError = new Error('discovery failed');
    vi.mocked(client.getAllChannelsForUser).mockRejectedValue(discoveryError);

    await expect(tool.handler(client, { mode: 'all' }, userId)).rejects.toBe(discoveryError);

    expect(client.getAllChannelsForUser).toHaveBeenCalledTimes(1);
    expect(client.markChannelsRead).not.toHaveBeenCalled();
    expect(client.getChannelsForUser).not.toHaveBeenCalled();
    expect(client.getTeamsForUser).not.toHaveBeenCalled();
  });

  it('propagates bulk failures without discovery or fallback calls', async () => {
    const tool = findTool(channelTools, 'time_mark_channels_read');
    const bulkError = new Error('bulk failed');
    vi.mocked(client.markChannelsRead).mockRejectedValue(bulkError);

    await expect(tool.handler(client, {
      mode: 'selected',
      channel_ids: ['ch1'],
    }, userId)).rejects.toBe(bulkError);

    expect(client.markChannelsRead).toHaveBeenCalledTimes(1);
    expect(client.getAllChannelsForUser).not.toHaveBeenCalled();
    expect(client.getChannelsForUser).not.toHaveBeenCalled();
    expect(client.getTeamsForUser).not.toHaveBeenCalled();
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
    const tool = findTool(channelTools, 'time_mark_channels_read');

    await expect(tool.handler(client, input, userId)).rejects.toThrow();

    expect(client.getAllChannelsForUser).not.toHaveBeenCalled();
    expect(client.markChannelsRead).not.toHaveBeenCalled();
  });
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
