import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
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

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
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
    it('getAllChannelsForUser calls the user-scoped channel endpoint', async () => {
      const channels = [{ id: 'ch1', type: 'O' }, { id: 'ch2', type: 'D' }];
      fetchSpy.mockReturnValue(mockFetchResponse(channels));

      const result = await client.getAllChannelsForUser('user/one');

      expect(result).toEqual(channels);
      expect(fetchSpy).toHaveBeenCalledWith(
        'https://time.test.com/api/v4/users/user%2Fone/channels',
        expect.objectContaining({ method: 'GET' })
      );
    });

    it('posts one Time view request per unique channel when marking channels read', async () => {
      fetchSpy.mockReturnValue(mockFetchResponse({}, 204));

      const result = await client.markChannelsRead('user/one', ['ch1', 'ch1', 'ch2']);

      expect(result).toEqual({ successes: ['ch1', 'ch2'], failures: [] });
      expect(fetchSpy).toHaveBeenCalledTimes(2);
      expect(fetchSpy.mock.calls).toEqual([
        [
          'https://time.test.com/api/v4/channels/members/user%2Fone/view',
          expect.objectContaining({
            method: 'POST',
            headers: expect.objectContaining({
              Authorization: 'Bearer test-token',
              'Content-Type': 'application/json',
            }),
            body: JSON.stringify({ channel_id: 'ch1' }),
          }),
        ],
        [
          'https://time.test.com/api/v4/channels/members/user%2Fone/view',
          expect.objectContaining({
            method: 'POST',
            body: JSON.stringify({ channel_id: 'ch2' }),
          }),
        ],
      ]);
    });

    it('starts at most five requests and waits for the current ordered chunk', async () => {
      vi.useFakeTimers();
      let activeRequests = 0;
      let maximumActiveRequests = 0;
      fetchSpy.mockImplementation(async () => {
        activeRequests += 1;
        maximumActiveRequests = Math.max(maximumActiveRequests, activeRequests);
        await new Promise(resolve => setTimeout(resolve, 10));
        activeRequests -= 1;
        return mockFetchResponse({}, 204);
      });

      const resultPromise = client.markChannelsRead('u1', ['ch1', 'ch2', 'ch3', 'ch4', 'ch5', 'ch6']);
      await vi.advanceTimersByTimeAsync(0);

      expect(fetchSpy).toHaveBeenCalledTimes(5);
      expect(maximumActiveRequests).toBe(5);

      await vi.runAllTimersAsync();
      await expect(resultPromise).resolves.toEqual({
        successes: ['ch1', 'ch2', 'ch3', 'ch4', 'ch5', 'ch6'],
        failures: [],
      });
      expect(maximumActiveRequests).toBe(5);
    });

    it('waits for started siblings before propagating an unexpected chunk error', async () => {
      const programmingError = new RangeError('broken test adapter');
      let settleSibling = () => {};
      const pendingSibling = new Promise<Response>(resolve => {
        settleSibling = () => resolve(mockFetchResponse({}, 204));
      });
      fetchSpy.mockImplementation((_url: string, options: RequestInit) => {
        const body = String(options.body);
        if (body === JSON.stringify({ channel_id: 'ch1' })) {
          return Promise.reject(programmingError);
        }
        if (body === JSON.stringify({ channel_id: 'ch2' })) {
          return pendingSibling;
        }
        return mockFetchResponse({}, 204);
      });

      const resultPromise = client.markChannelsRead(
        'u1',
        ['ch1', 'ch2', 'ch3', 'ch4', 'ch5', 'ch6']
      );
      const settlementSpy = vi.fn();
      void resultPromise.then(settlementSpy, settlementSpy);
      await new Promise(resolve => setTimeout(resolve, 0));

      expect(settlementSpy).not.toHaveBeenCalled();
      expect(fetchSpy).toHaveBeenCalledTimes(5);

      settleSibling();
      await expect(resultPromise).rejects.toBe(programmingError);
      expect(fetchSpy).toHaveBeenCalledTimes(5);
    });

    it.each([429, 502, 503, 504])('retries status %i before returning success', async status => {
      vi.useFakeTimers();
      vi.spyOn(Math, 'random').mockReturnValue(0);
      fetchSpy
        .mockReturnValueOnce(mockFetchResponse({ message: 'Temporary failure' }, status))
        .mockReturnValueOnce(mockFetchResponse({}, 204));

      const resultPromise = client.markChannelsRead('u1', ['ch1']);
      await vi.runAllTimersAsync();

      await expect(resultPromise).resolves.toEqual({ successes: ['ch1'], failures: [] });
      expect(fetchSpy).toHaveBeenCalledTimes(2);
    });

    it.each([400, 401, 403, 404])('does not retry status %i and returns the failure as data', async status => {
      fetchSpy.mockReturnValue(mockFetchResponse({ message: 'Permanent failure' }, status));

      const result = await client.markChannelsRead('u1', ['ch1']);

      expect(result).toEqual({
        successes: [],
        failures: [{ channelId: 'ch1', message: 'Permanent failure', statusCode: status }],
      });
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    it('retries network TypeError at most three total attempts', async () => {
      vi.useFakeTimers();
      vi.spyOn(Math, 'random').mockReturnValue(0);
      fetchSpy.mockRejectedValue(new TypeError('network unavailable'));

      const resultPromise = client.markChannelsRead('u1', ['ch1']);
      await vi.runAllTimersAsync();

      await expect(resultPromise).resolves.toEqual({
        successes: [],
        failures: [{ channelId: 'ch1', message: 'network unavailable' }],
      });
      expect(fetchSpy).toHaveBeenCalledTimes(3);
    });

    it('honors Retry-After delta seconds before retrying', async () => {
      vi.useFakeTimers();
      fetchSpy
        .mockReturnValueOnce(mockFetchResponse(
          { message: 'Rate limited' },
          429,
          { 'Retry-After': '2' }
        ))
        .mockReturnValueOnce(mockFetchResponse({}, 204));

      const resultPromise = client.markChannelsRead('u1', ['ch1']);
      await vi.advanceTimersByTimeAsync(1_999);

      expect(fetchSpy).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(1);
      await expect(resultPromise).resolves.toEqual({ successes: ['ch1'], failures: [] });
      expect(fetchSpy).toHaveBeenCalledTimes(2);
    });

    it('honors Retry-After HTTP dates before retrying', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-09-07T12:00:00.000Z'));
      fetchSpy
        .mockReturnValueOnce(mockFetchResponse(
          { message: 'Unavailable' },
          503,
          { 'Retry-After': 'Mon, 07 Sep 2026 12:00:02 GMT' }
        ))
        .mockReturnValueOnce(mockFetchResponse({}, 204));

      const resultPromise = client.markChannelsRead('u1', ['ch1']);
      await vi.advanceTimersByTimeAsync(1_999);

      expect(fetchSpy).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(1);
      await expect(resultPromise).resolves.toEqual({ successes: ['ch1'], failures: [] });
      expect(fetchSpy).toHaveBeenCalledTimes(2);
    });

    it('caps huge numeric Retry-After delays at thirty seconds', async () => {
      vi.useFakeTimers();
      fetchSpy
        .mockReturnValueOnce(mockFetchResponse(
          { message: 'Rate limited' },
          429,
          { 'Retry-After': '86400' }
        ))
        .mockReturnValueOnce(mockFetchResponse({}, 204));

      const resultPromise = client.markChannelsRead('u1', ['ch1']);
      await vi.advanceTimersByTimeAsync(29_999);

      expect(fetchSpy).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(1);
      await expect(resultPromise).resolves.toEqual({ successes: ['ch1'], failures: [] });
      expect(fetchSpy).toHaveBeenCalledTimes(2);
    });

    it('caps far-future Retry-After dates at thirty seconds', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-09-07T12:00:00.000Z'));
      fetchSpy
        .mockReturnValueOnce(mockFetchResponse(
          { message: 'Unavailable' },
          503,
          { 'Retry-After': 'Tue, 07 Sep 2027 12:00:00 GMT' }
        ))
        .mockReturnValueOnce(mockFetchResponse({}, 204));

      const resultPromise = client.markChannelsRead('u1', ['ch1']);
      await vi.advanceTimersByTimeAsync(29_999);

      expect(fetchSpy).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(1);
      await expect(resultPromise).resolves.toEqual({ successes: ['ch1'], failures: [] });
      expect(fetchSpy).toHaveBeenCalledTimes(2);
    });

    it('uses exponential backoff with jitter when Retry-After is absent', async () => {
      vi.useFakeTimers();
      const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0);
      fetchSpy
        .mockReturnValueOnce(mockFetchResponse({ message: 'Unavailable' }, 503))
        .mockReturnValueOnce(mockFetchResponse({ message: 'Unavailable' }, 503))
        .mockReturnValueOnce(mockFetchResponse({}, 204));

      const resultPromise = client.markChannelsRead('u1', ['ch1']);
      await vi.advanceTimersByTimeAsync(99);
      expect(fetchSpy).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(1);
      expect(fetchSpy).toHaveBeenCalledTimes(2);

      await vi.advanceTimersByTimeAsync(199);
      expect(fetchSpy).toHaveBeenCalledTimes(2);

      await vi.advanceTimersByTimeAsync(1);
      await expect(resultPromise).resolves.toEqual({ successes: ['ch1'], failures: [] });
      expect(fetchSpy).toHaveBeenCalledTimes(3);
      expect(randomSpy).toHaveBeenCalledTimes(2);
    });

    it('returns successes and terminal failures in input order', async () => {
      vi.useFakeTimers();
      fetchSpy.mockImplementation((url: string, options: RequestInit) => {
        const body = String(options.body);
        const delay = body === JSON.stringify({ channel_id: 'ch1' })
          ? 20
          : body === JSON.stringify({ channel_id: 'ch2' })
            ? 10
            : 0;
        const status = body === JSON.stringify({ channel_id: 'ch2' }) ? 403 : 204;
        return new Promise(resolve => {
          setTimeout(() => resolve(mockFetchResponse({ message: 'Forbidden' }, status)), delay);
        });
      });

      const resultPromise = client.markChannelsRead('u1', ['ch1', 'ch2', 'ch3']);
      await vi.runAllTimersAsync();

      await expect(resultPromise).resolves.toEqual({
        successes: ['ch1', 'ch3'],
        failures: [{ channelId: 'ch2', message: 'Forbidden', statusCode: 403 }],
      });
    });

    it('returns exhausted request timeouts as status 504 failures', async () => {
      vi.useFakeTimers();
      vi.stubEnv('TIME_REQUEST_TIMEOUT_MS', '10');
      vi.spyOn(Math, 'random').mockReturnValue(0);
      fetchSpy.mockImplementation((_url: string, options: RequestInit) => new Promise((_resolve, reject) => {
        options.signal?.addEventListener('abort', () => {
          const error = new Error('aborted');
          error.name = 'AbortError';
          reject(error);
        });
      }));

      const resultPromise = client.markChannelsRead('u1', ['ch1']);
      await vi.runAllTimersAsync();

      await expect(resultPromise).resolves.toEqual({
        successes: [],
        failures: [{
          channelId: 'ch1',
          message: 'Time API request timed out after 10ms',
          statusCode: 504,
        }],
      });
      expect(fetchSpy).toHaveBeenCalledTimes(3);
    });

    it('propagates unexpected programming errors without retrying', async () => {
      const programmingError = new RangeError('broken test adapter');
      fetchSpy.mockRejectedValue(programmingError);

      await expect(client.markChannelsRead('u1', ['ch1'])).rejects.toBe(programmingError);
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

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

  describe('Channel category methods', () => {
    const category = {
      id: 'category#value',
      user_id: 'user/value',
      team_id: 'team?value',
      sort_order: 10,
      sorting: 'manual',
      type: 'custom',
      display_name: 'Projects',
      muted: false,
      collapsed: false,
      channel_ids: ['channel-1'],
    } as const;

    it('getChannelCategories calls the encoded user and team route', async () => {
      const response = { categories: [category], order: [category.id] };
      fetchSpy.mockReturnValue(mockFetchResponse(response));

      const result = await client.getChannelCategories(category.user_id, category.team_id);

      expect(result).toEqual(response);
      expect(fetchSpy).toHaveBeenCalledWith(
        'https://time.test.com/api/v4/users/user%2Fvalue/teams/team%3Fvalue/channels/categories',
        expect.objectContaining({ method: 'GET' })
      );
    });

    it('createChannelCategory posts the category request with path IDs', async () => {
      const request = {
        display_name: category.display_name,
        type: category.type,
        channel_ids: [],
      } as const;
      fetchSpy.mockReturnValue(mockFetchResponse(category));

      const result = await client.createChannelCategory(category.user_id, category.team_id, request);

      expect(result).toEqual(category);
      expect(fetchSpy).toHaveBeenCalledWith(
        'https://time.test.com/api/v4/users/user%2Fvalue/teams/team%3Fvalue/channels/categories',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ ...request, user_id: category.user_id, team_id: category.team_id }),
        })
      );
    });

    it('updateChannelCategory puts the complete category on the encoded category route', async () => {
      const updatedCategory = { ...category, display_name: 'Renamed Projects' };
      fetchSpy.mockReturnValue(mockFetchResponse(updatedCategory));

      const result = await client.updateChannelCategory(
        category.user_id,
        category.team_id,
        category.id,
        updatedCategory
      );

      expect(result).toEqual(updatedCategory);
      expect(fetchSpy).toHaveBeenCalledWith(
        'https://time.test.com/api/v4/users/user%2Fvalue/teams/team%3Fvalue/channels/categories/category%23value',
        expect.objectContaining({
          method: 'PUT',
          body: JSON.stringify(updatedCategory),
        })
      );
    });

    it('deleteChannelCategory uses the encoded category route and existing 204 handling', async () => {
      fetchSpy.mockReturnValue(mockFetchResponse({}, 204));

      const result = await client.deleteChannelCategory(category.user_id, category.team_id, category.id);

      expect(result).toEqual({});
      expect(fetchSpy).toHaveBeenCalledWith(
        'https://time.test.com/api/v4/users/user%2Fvalue/teams/team%3Fvalue/channels/categories/category%23value',
        expect.objectContaining({ method: 'DELETE' })
      );
    });

    it('reorderChannelCategories puts a raw category ID array', async () => {
      const categoryIds = ['category-2', category.id] as const;
      fetchSpy.mockReturnValue(mockFetchResponse(categoryIds));

      const result = await client.reorderChannelCategories(category.user_id, category.team_id, categoryIds);

      expect(result).toEqual(categoryIds);
      expect(fetchSpy).toHaveBeenCalledWith(
        'https://time.test.com/api/v4/users/user%2Fvalue/teams/team%3Fvalue/channels/categories/order',
        expect.objectContaining({
          method: 'PUT',
          body: JSON.stringify(categoryIds),
        })
      );
    });

    it('updateChannelCategories puts and returns a raw category array', async () => {
      const categories = [category] as const;
      fetchSpy.mockReturnValue(mockFetchResponse(categories));

      const result = await client.updateChannelCategories(category.user_id, category.team_id, categories);

      expect(result).toEqual(categories);
      expect(fetchSpy).toHaveBeenCalledWith(
        'https://time.test.com/api/v4/users/user%2Fvalue/teams/team%3Fvalue/channels/categories',
        expect.objectContaining({
          method: 'PUT',
          body: JSON.stringify(categories),
        })
      );
    });

    it('propagates TimeApiError details from category requests', async () => {
      fetchSpy.mockReturnValue(mockFetchResponse(
        {
          id: 'api.context.permissions.app_error',
          message: 'Forbidden',
          request_id: 'request-1',
          status_code: 403,
          where: 'GetSidebarCategoriesForTeamForUser',
        },
        403
      ));

      await expect(client.getChannelCategories(category.user_id, category.team_id)).rejects.toMatchObject({
        name: 'TimeApiError',
        statusCode: 403,
        message: 'Forbidden',
        errorInfo: {
          id: 'api.context.permissions.app_error',
          request_id: 'request-1',
          status_code: 403,
        },
      });
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

    it('getThreadsStats requests totals only and returns nonzero unread totals', async () => {
      fetchSpy.mockReturnValue(mockFetchResponse({
        threads: [],
        total: 3,
        total_unread_threads: 3,
        total_unread_mentions: 1,
      }));
      const result = await client.getThreadsStats('u1', 't1');
      expect(fetchSpy).toHaveBeenCalledWith(
        'https://time.test.com/api/v4/users/u1/teams/t1/threads?totalsOnly=true',
        expect.anything()
      );
      expect(result).toEqual({ total_unread_threads: 3, total_unread_mentions: 1 });
    });

    it('getThreadsStats preserves numeric zero unread totals', async () => {
      fetchSpy.mockReturnValue(mockFetchResponse({
        threads: [],
        total: 0,
        total_unread_threads: 0,
        total_unread_mentions: 0,
      }));
      const result = await client.getThreadsStats('u1', 't1');
      expect(fetchSpy).toHaveBeenCalledWith(
        'https://time.test.com/api/v4/users/u1/teams/t1/threads?totalsOnly=true',
        expect.anything()
      );
      expect(result).toEqual({ total_unread_threads: 0, total_unread_mentions: 0 });
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
