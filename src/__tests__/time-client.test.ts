import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TimeClient } from '../client/time-client.js';
import { TimeApiError } from '../types/time-api.js';

function mockFetchResponse(data: unknown, status = 200, headers: Record<string, string> = {}) {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    headers: {
      get: (name: string) => headers[name] ?? null,
    },
    json: () => Promise.resolve(data),
  } as unknown as Response);
}

describe('TimeClient', () => {
  let client: TimeClient;
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    client = new TimeClient('https://time.test.com', 'test-token');
  });

  describe('constructor', () => {
    it('strips trailing slash from base URL', () => {
      const c = new TimeClient('https://time.test.com/', 'token');
      expect(c.baseUrlValue).toBe('https://time.test.com');
    });

    it('stores token', () => {
      expect(client.tokenValue).toBe('test-token');
    });
  });

  describe('login', () => {
    it('creates a client on successful login', async () => {
      fetchSpy.mockReturnValue(mockFetchResponse({}, 200, { Token: 'new-token' }));
      const c = await TimeClient.login('https://time.test.com', 'user', 'pass');
      expect(c.tokenValue).toBe('new-token');
      expect(fetchSpy).toHaveBeenCalledWith(
        'https://time.test.com/api/v4/users/login',
        expect.objectContaining({ method: 'POST' })
      );
    });

    it('sends mfaToken when provided', async () => {
      fetchSpy.mockReturnValue(mockFetchResponse({}, 200, { Token: 'new-token' }));
      await TimeClient.login('https://time.test.com', 'user', 'pass', '123456');
      const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
      expect(body.token).toBe('123456');
    });

    it('throws MFA_REQUIRED when mfa.totp_required', async () => {
      fetchSpy.mockReturnValue(mockFetchResponse({ id: 'mfa.totp_required' }, 401));
      try {
        await TimeClient.login('https://time.test.com', 'user', 'pass');
        expect.unreachable('Should have thrown');
      } catch (err) {
        expect((err as Error).message).toBe('MFA_REQUIRED');
        expect((err as Error & { mfaRequired: boolean }).mfaRequired).toBe(true);
      }
    });

    it('throws MFA_REQUIRED when mfa.challenge', async () => {
      fetchSpy.mockReturnValue(mockFetchResponse({ id: 'mfa.challenge' }, 401));
      try {
        await TimeClient.login('https://time.test.com', 'user', 'pass');
        expect.unreachable('Should have thrown');
      } catch (err) {
        expect((err as Error).message).toBe('MFA_REQUIRED');
      }
    });

    it('throws MFA_REQUIRED for any mfa.* id when no token supplied (e.g. mfa.validate_token.authenticate)', async () => {
      fetchSpy.mockReturnValue(mockFetchResponse({ id: 'mfa.validate_token.authenticate.app_error', message: 'Invalid MFA token.' }, 401));
      await expect(TimeClient.login('https://time.test.com', 'user', 'pass')).rejects.toThrow('MFA_REQUIRED');
    });

    it('does NOT treat mfa.* as MFA_REQUIRED when a token was supplied (wrong-code path)', async () => {
      fetchSpy.mockReturnValue(mockFetchResponse({ id: 'mfa.validate_token.authenticate.app_error', message: 'Invalid MFA token.' }, 401));
      await expect(TimeClient.login('https://time.test.com', 'user', 'pass', '000000')).rejects.toThrow('Login failed');
    });

    it('sends a browser-like User-Agent on login (WAF bypass)', async () => {
      fetchSpy.mockReturnValue(mockFetchResponse({}, 200, { Token: 'new-token' }));
      await TimeClient.login('https://time.test.com', 'user', 'pass');
      expect(fetchSpy.mock.calls[0][1].headers['User-Agent']).toMatch(/Mozilla\/5\.0/);
    });

    it('throws on login failure without MFA', async () => {
      fetchSpy.mockReturnValue(mockFetchResponse({ message: 'Invalid credentials' }, 401));
      await expect(TimeClient.login('https://time.test.com', 'user', 'wrong')).rejects.toThrow('Login failed');
    });

    it('throws when token header is missing on success', async () => {
      fetchSpy.mockReturnValue(mockFetchResponse({}, 200, {}));
      await expect(TimeClient.login('https://time.test.com', 'user', 'pass')).rejects.toThrow('no token received');
    });
  });

  describe('request method', () => {
    it('sends Authorization header', async () => {
      fetchSpy.mockReturnValue(mockFetchResponse({ id: 'me' }));
      await client.getMe();
      expect(fetchSpy).toHaveBeenCalledWith(
        'https://time.test.com/api/v4/users/me',
        expect.objectContaining({
          headers: expect.objectContaining({ Authorization: 'Bearer test-token' }),
        })
      );
    });

    it('sends a browser-like User-Agent header (WAF bypass)', async () => {
      fetchSpy.mockReturnValue(mockFetchResponse({ id: 'me' }));
      await client.getMe();
      expect(fetchSpy.mock.calls[0][1].headers['User-Agent']).toMatch(/Mozilla\/5\.0/);
    });

    it('returns parsed JSON on 200', async () => {
      fetchSpy.mockReturnValue(mockFetchResponse({ id: 'me', username: 'test' }));
      const result = await client.getMe();
      expect(result).toEqual({ id: 'me', username: 'test' });
    });

    it('returns empty object on 204', async () => {
      fetchSpy.mockReturnValue(Promise.resolve({
        ok: true,
        status: 204,
        statusText: 'No Content',
        headers: { get: () => null },
        json: () => Promise.resolve({}),
      } as unknown as Response));
      const result = await client.startFollowingThread('u1', 't1');
      expect(result).toEqual({});
    });

    it('throws TimeApiError on non-2xx', async () => {
      fetchSpy.mockReturnValue(mockFetchResponse(
        { id: 'error', message: 'Not Found', request_id: 'r1', status_code: 404, where: 'handler' },
        404
      ));
      try {
        await client.getTeam('bad-id');
        expect.unreachable('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(TimeApiError);
        expect((err as TimeApiError).statusCode).toBe(404);
        expect((err as TimeApiError).message).toBe('Not Found');
      }
    });
  });

  describe('User methods', () => {
    it('getMe calls GET /users/me', async () => {
      fetchSpy.mockReturnValue(mockFetchResponse({ id: 'u1' }));
      await client.getMe();
      expect(fetchSpy).toHaveBeenCalledWith(
        'https://time.test.com/api/v4/users/me',
        expect.objectContaining({ method: 'GET' })
      );
    });

    it('getUser calls GET /users/{id}', async () => {
      fetchSpy.mockReturnValue(mockFetchResponse({ id: 'u1' }));
      await client.getUser('u1');
      expect(fetchSpy).toHaveBeenCalledWith(
        'https://time.test.com/api/v4/users/u1',
        expect.anything()
      );
    });

    it('getUser percent-encodes ids so they cannot traverse the path', async () => {
      fetchSpy.mockReturnValue(mockFetchResponse({ id: 'x' }));
      await client.getUser('../admin/secret');
      expect(fetchSpy).toHaveBeenCalledWith(
        'https://time.test.com/api/v4/users/..%2Fadmin%2Fsecret',
        expect.anything()
      );
    });

    it('searchUsers calls POST /users/search', async () => {
      fetchSpy.mockReturnValue(mockFetchResponse([]));
      await client.searchUsers('john');
      const call = fetchSpy.mock.calls[0];
      expect(call[1].method).toBe('POST');
      expect(call[0]).toContain('/users/search');
      expect(JSON.parse(call[1].body)).toEqual({ term: 'john' });
    });
  });

  describe('Team methods', () => {
    it('getTeamsForUser calls correct path', async () => {
      fetchSpy.mockReturnValue(mockFetchResponse([]));
      await client.getTeamsForUser('u1');
      expect(fetchSpy).toHaveBeenCalledWith(
        'https://time.test.com/api/v4/users/u1/teams',
        expect.anything()
      );
    });

    it('getTeam calls correct path', async () => {
      fetchSpy.mockReturnValue(mockFetchResponse({ id: 't1' }));
      await client.getTeam('t1');
      expect(fetchSpy).toHaveBeenCalledWith(
        'https://time.test.com/api/v4/teams/t1',
        expect.anything()
      );
    });

    it('getTeamsUnread calls correct path', async () => {
      fetchSpy.mockReturnValue(mockFetchResponse([]));
      await client.getTeamsUnread('u1');
      expect(fetchSpy).toHaveBeenCalledWith(
        'https://time.test.com/api/v4/users/u1/teams/unread',
        expect.anything()
      );
    });

    it('getTeamUnread calls correct path', async () => {
      fetchSpy.mockReturnValue(mockFetchResponse({ team_id: 't1', msg_count: 5, mention_count: 1 }));
      await client.getTeamUnread('u1', 't1');
      expect(fetchSpy).toHaveBeenCalledWith(
        'https://time.test.com/api/v4/users/u1/teams/t1/unread',
        expect.anything()
      );
    });
  });

  describe('Channel methods', () => {
    it('getChannelsForUser calls correct path', async () => {
      fetchSpy.mockReturnValue(mockFetchResponse([]));
      await client.getChannelsForUser('u1', 't1');
      expect(fetchSpy).toHaveBeenCalledWith(
        'https://time.test.com/api/v4/users/u1/teams/t1/channels',
        expect.anything()
      );
    });

    it('getChannel calls correct path', async () => {
      fetchSpy.mockReturnValue(mockFetchResponse({ id: 'ch1' }));
      await client.getChannel('ch1');
      expect(fetchSpy).toHaveBeenCalledWith(
        'https://time.test.com/api/v4/channels/ch1',
        expect.anything()
      );
    });

    it('searchChannels calls POST with term', async () => {
      fetchSpy.mockReturnValue(mockFetchResponse([]));
      await client.searchChannels('t1', 'dev');
      const call = fetchSpy.mock.calls[0];
      expect(call[1].method).toBe('POST');
      expect(call[0]).toContain('/teams/t1/channels/search');
      expect(JSON.parse(call[1].body)).toEqual({ term: 'dev' });
    });

    it('getChannelUnread calls correct path', async () => {
      fetchSpy.mockReturnValue(mockFetchResponse({ channel_id: 'ch1', msg_count: 0, mention_count: 0 }));
      await client.getChannelUnread('u1', 'ch1');
      expect(fetchSpy).toHaveBeenCalledWith(
        'https://time.test.com/api/v4/users/u1/channels/ch1/unread',
        expect.anything()
      );
    });
  });

  describe('Post methods', () => {
    it('createPost calls POST /posts with body', async () => {
      fetchSpy.mockReturnValue(mockFetchResponse({ id: 'p1' }));
      await client.createPost('ch1', 'Hello', 'r1');
      const call = fetchSpy.mock.calls[0];
      expect(call[1].method).toBe('POST');
      expect(call[0]).toContain('/posts');
      const body = JSON.parse(call[1].body);
      expect(body).toEqual({ channel_id: 'ch1', message: 'Hello', root_id: 'r1' });
    });

    it('createPost sends empty root_id when not provided', async () => {
      fetchSpy.mockReturnValue(mockFetchResponse({ id: 'p1' }));
      await client.createPost('ch1', 'Hello');
      const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
      expect(body.root_id).toBe('');
    });

    it('getPostsForChannel calls correct path with pagination', async () => {
      fetchSpy.mockReturnValue(mockFetchResponse({ order: [], posts: {} }));
      await client.getPostsForChannel('ch1', 1, 30);
      expect(fetchSpy).toHaveBeenCalledWith(
        'https://time.test.com/api/v4/channels/ch1/posts?page=1&per_page=30',
        expect.anything()
      );
    });

    it('getPostsForChannel defaults page=0, per_page=60', async () => {
      fetchSpy.mockReturnValue(mockFetchResponse({ order: [], posts: {} }));
      await client.getPostsForChannel('ch1');
      expect(fetchSpy).toHaveBeenCalledWith(
        'https://time.test.com/api/v4/channels/ch1/posts?page=0&per_page=60',
        expect.anything()
      );
    });

    it('getPost calls GET /posts/{id}', async () => {
      fetchSpy.mockReturnValue(mockFetchResponse({ id: 'p1' }));
      await client.getPost('p1');
      expect(fetchSpy).toHaveBeenCalledWith(
        'https://time.test.com/api/v4/posts/p1',
        expect.anything()
      );
    });

    it('getPostThread calls GET /posts/{id}/thread', async () => {
      fetchSpy.mockReturnValue(mockFetchResponse({ order: [], posts: {} }));
      await client.getPostThread('p1');
      expect(fetchSpy).toHaveBeenCalledWith(
        'https://time.test.com/api/v4/posts/p1/thread',
        expect.anything()
      );
    });

    it('searchPosts calls POST /teams/{id}/posts/search', async () => {
      fetchSpy.mockReturnValue(mockFetchResponse({ order: [], posts: {} }));
      await client.searchPosts('t1', 'hello');
      const call = fetchSpy.mock.calls[0];
      expect(call[1].method).toBe('POST');
      expect(call[0]).toContain('/teams/t1/posts/search');
      expect(JSON.parse(call[1].body)).toEqual({ terms: 'hello' });
    });
  });

  describe('Thread methods', () => {
    it('getUserThreads calls correct path', async () => {
      fetchSpy.mockReturnValue(mockFetchResponse([]));
      await client.getUserThreads('u1', 't1');
      expect(fetchSpy).toHaveBeenCalledWith(
        'https://time.test.com/api/v4/users/u1/teams/t1/threads',
        expect.anything()
      );
    });

    it('getThreadsStats calls correct path', async () => {
      fetchSpy.mockReturnValue(mockFetchResponse({ total_unread_threads: 3, total_unread_mentions: 1 }));
      await client.getThreadsStats('u1', 't1');
      expect(fetchSpy).toHaveBeenCalledWith(
        'https://time.test.com/api/v4/users/u1/teams/t1/threads/stats',
        expect.anything()
      );
    });

    it('getUserThread calls correct path', async () => {
      fetchSpy.mockReturnValue(mockFetchResponse({ id: 'th1' }));
      await client.getUserThread('u1', 't1', 'th1');
      expect(fetchSpy).toHaveBeenCalledWith(
        'https://time.test.com/api/v4/users/u1/teams/t1/threads/th1',
        expect.anything()
      );
    });

    it('startFollowingThread calls POST', async () => {
      fetchSpy.mockReturnValue(Promise.resolve({ ok: true, status: 204, headers: { get: () => null } } as unknown as Response));
      await client.startFollowingThread('u1', 'th1');
      const call = fetchSpy.mock.calls[0];
      expect(call[1].method).toBe('POST');
      expect(call[0]).toContain('/users/u1/threads/th1/following');
    });

    it('stopFollowingThread calls DELETE', async () => {
      fetchSpy.mockReturnValue(Promise.resolve({ ok: true, status: 204, headers: { get: () => null } } as unknown as Response));
      await client.stopFollowingThread('u1', 'th1');
      const call = fetchSpy.mock.calls[0];
      expect(call[1].method).toBe('DELETE');
      expect(call[0]).toContain('/users/u1/threads/th1/following');
    });

    it('updateThreadRead calls PUT with timestamp', async () => {
      fetchSpy.mockReturnValue(Promise.resolve({ ok: true, status: 204, headers: { get: () => null } } as unknown as Response));
      await client.updateThreadRead('u1', 't1', 'th1', 1700000000000);
      const call = fetchSpy.mock.calls[0];
      expect(call[1].method).toBe('PUT');
      expect(call[0]).toContain('/users/u1/teams/t1/threads/th1/read/1700000000000');
    });
  });
});
