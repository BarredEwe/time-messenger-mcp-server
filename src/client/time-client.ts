import type {
  User,
  Team,
  Channel,
  ChannelCategory,
  ChannelCategoryList,
  ChannelCategoryOrder,
  CreateChannelCategoryRequest,
  Post,
  PostList,
  Thread,
  ThreadStats,
  ThreadsResponse,
  ChannelUnread,
  MarkChannelReadFailure,
  MarkChannelsReadResult,
  TeamUnread,
  UpdateChannelCategoriesRequest,
  UpdateChannelCategoryRequest,
  SearchResult,
  ErrorInfo,
} from '../types/time-api.js';
import { TimeApiError } from '../types/time-api.js';

// Encode every caller-supplied id before it is interpolated into a URL path,
// so a value containing `/`, `?`, `#` or `..` cannot redirect the request to a
// different API endpoint. Simple ids are unaffected (encode is identity).
const enc = encodeURIComponent;

const DEFAULT_TIMEOUT_MS = 30_000;
const MARK_READ_CONCURRENCY = 5;
const MARK_READ_MAX_ATTEMPTS = 3;
const MARK_READ_RETRY_BASE_DELAY_MS = 100;
const MARK_READ_MAX_RETRY_DELAY_MS = 30_000;
const MARK_READ_RETRYABLE_STATUSES = new Set([429, 502, 503, 504]);

function requestTimeoutMs(): number {
  const parsed = Number.parseInt(process.env.TIME_REQUEST_TIMEOUT_MS ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_TIMEOUT_MS;
}

// Some Time Messenger deployments sit behind a WAF that silently drops requests
// whose User-Agent is a non-browser default (curl/node), so we send a
// browser-like UA. Override with TIME_USER_AGENT if needed.
const DEFAULT_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

function userAgent(): string {
  return process.env.TIME_USER_AGENT || DEFAULT_USER_AGENT;
}

// All network egress goes through here so every request is bounded by a timeout
// and a hung upstream can never wedge the MCP call indefinitely.
async function fetchWithTimeout(url: string, options: RequestInit): Promise<Response> {
  const timeoutMs = requestTimeoutMs();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new TimeApiError(`Time API request timed out after ${timeoutMs}ms`, 504);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

export class TimeClient {
  private baseUrl: string;
  private token: string;

  constructor(baseUrl: string, token: string) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.token = token;
  }

  get baseUrlValue(): string {
    return this.baseUrl;
  }

  get tokenValue(): string {
    return this.token;
  }

  static async login(baseUrl: string, loginId: string, password: string, mfaToken?: string): Promise<TimeClient> {
    const url = `${baseUrl.replace(/\/$/, '')}/api/v4/users/login`;
    const body: Record<string, string> = { login_id: loginId, password };
    if (mfaToken) {
      body.token = mfaToken;
    }

    const response = await fetchWithTimeout(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': userAgent() },
      body: JSON.stringify(body),
    });

    if (response.ok) {
      const token = response.headers.get('Token') || '';
      if (!token) {
        throw new Error('Login succeeded but no token received');
      }
      return new TimeClient(baseUrl, token);
    }

    const errorBody = await response.json().catch(() => ({})) as Record<string, string>;
    const reason = errorBody.id || '';

    // When no MFA token was supplied and the server rejects with any mfa.* error,
    // it means MFA is required; signal the caller to prompt for a code.
    // (Different Time/Mattermost builds use mfa.totp_required, mfa.challenge, or
    // mfa.validate_token.authenticate.app_error for a missing token.)
    if (!mfaToken && reason.startsWith('mfa.')) {
      const err = new Error('MFA_REQUIRED') as Error & { mfaRequired: true };
      err.mfaRequired = true;
      throw err;
    }

    throw new Error(`Login failed: ${response.status} - ${errorBody.message || response.statusText}`);
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown
  ): Promise<T> {
    const url = `${this.baseUrl}/api/v4${path}`;

    const headers: Record<string, string> = {
      'Authorization': `Bearer ${this.token}`,
      'Content-Type': 'application/json',
      'User-Agent': userAgent(),
    };

    const response = await fetchWithTimeout(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      const retryAfterHeader = response.headers.get('Retry-After');
      const retryAfterSeconds = retryAfterHeader === null ? Number.NaN : Number(retryAfterHeader);
      const retryAfterDate = retryAfterHeader === null ? Number.NaN : Date.parse(retryAfterHeader);
      let retryAfterMs: number | undefined;
      if (Number.isFinite(retryAfterSeconds) && retryAfterSeconds >= 0) {
        retryAfterMs = Math.min(retryAfterSeconds * 1_000, MARK_READ_MAX_RETRY_DELAY_MS);
      } else if (!Number.isNaN(retryAfterDate)) {
        retryAfterMs = Math.min(
          Math.max(0, retryAfterDate - Date.now()),
          MARK_READ_MAX_RETRY_DELAY_MS
        );
      }
      const error = new TimeApiError(
        `Time API Error: ${response.status} ${response.statusText}`,
        response.status,
        retryAfterMs
      );
      try {
        const errorBody = (await response.json()) as ErrorInfo;
        error.errorInfo = errorBody;
        error.message = errorBody.message || error.message;
      } catch {
        // ignore
      }
      throw error;
    }

    if (response.status === 204) {
      return {} as T;
    }

    return response.json() as Promise<T>;
  }

  // ========== Users ==========

  async getMe(): Promise<User> {
    return this.request<User>('GET', '/users/me');
  }

  async getUser(userId: string): Promise<User> {
    return this.request<User>('GET', `/users/${enc(userId)}`);
  }

  async searchUsers(term: string): Promise<User[]> {
    return this.request<User[]>('POST', '/users/search', { term });
  }

  // ========== Teams ==========

  async getTeamsForUser(userId: string): Promise<Team[]> {
    return this.request<Team[]>('GET', `/users/${enc(userId)}/teams`);
  }

  async getTeam(teamId: string): Promise<Team> {
    return this.request<Team>('GET', `/teams/${enc(teamId)}`);
  }

  async getTeamsUnread(userId: string): Promise<TeamUnread[]> {
    return this.request<TeamUnread[]>('GET', `/users/${enc(userId)}/teams/unread`);
  }

  async getTeamUnread(userId: string, teamId: string): Promise<TeamUnread> {
    return this.request<TeamUnread>(
      'GET',
      `/users/${enc(userId)}/teams/${enc(teamId)}/unread`
    );
  }

  // ========== Channels ==========

  async getChannelsForUser(userId: string, teamId: string): Promise<Channel[]> {
    return this.request<Channel[]>(
      'GET',
      `/users/${enc(userId)}/teams/${enc(teamId)}/channels`
    );
  }

  async getAllChannelsForUser(userId: string): Promise<Channel[]> {
    return this.request<Channel[]>('GET', `/users/${enc(userId)}/channels`);
  }

  private async markChannelRead(
    userId: string,
    channelId: string
  ): Promise<MarkChannelReadFailure | undefined> {
    let attempts = 0;

    while (true) {
      attempts += 1;
      try {
        await this.request<void>(
          'POST',
          `/channels/members/${enc(userId)}/view`,
          { channel_id: channelId }
        );
        return undefined;
      } catch (error) {
        if (error instanceof TimeApiError) {
          if (!MARK_READ_RETRYABLE_STATUSES.has(error.statusCode) || attempts >= MARK_READ_MAX_ATTEMPTS) {
            return {
              channelId,
              message: error.message,
              statusCode: error.statusCode,
            };
          }

          const backoffMs = MARK_READ_RETRY_BASE_DELAY_MS * (2 ** (attempts - 1));
          const delayMs = error.retryAfterMs ?? backoffMs + Math.floor(Math.random() * MARK_READ_RETRY_BASE_DELAY_MS);
          await new Promise(resolve => setTimeout(resolve, delayMs));
          continue;
        }

        if (error instanceof TypeError) {
          if (attempts >= MARK_READ_MAX_ATTEMPTS) {
            return { channelId, message: error.message };
          }

          const backoffMs = MARK_READ_RETRY_BASE_DELAY_MS * (2 ** (attempts - 1));
          await new Promise(resolve => setTimeout(
            resolve,
            backoffMs + Math.floor(Math.random() * MARK_READ_RETRY_BASE_DELAY_MS)
          ));
          continue;
        }

        throw error;
      }
    }
  }

  async markChannelsRead(userId: string, channelIds: string[]): Promise<MarkChannelsReadResult> {
    const uniqueChannelIds = [...new Set(channelIds)];
    const successes: string[] = [];
    const failures: MarkChannelReadFailure[] = [];

    for (let start = 0; start < uniqueChannelIds.length; start += MARK_READ_CONCURRENCY) {
      const chunk = uniqueChannelIds.slice(start, start + MARK_READ_CONCURRENCY);
      const chunkResults = await Promise.allSettled(
        chunk.map(async channelId => ({
          channelId,
          failure: await this.markChannelRead(userId, channelId),
        }))
      );
      let firstUnexpectedError: unknown;
      let hasUnexpectedError = false;

      for (const result of chunkResults) {
        if (result.status === 'rejected') {
          if (!hasUnexpectedError) {
            firstUnexpectedError = result.reason;
            hasUnexpectedError = true;
          }
          continue;
        }

        const { channelId, failure } = result.value;
        if (failure) {
          failures.push(failure);
        } else {
          successes.push(channelId);
        }
      }

      if (hasUnexpectedError) {
        throw firstUnexpectedError;
      }
    }

    return { successes, failures };
  }

  async getChannel(channelId: string): Promise<Channel> {
    return this.request<Channel>('GET', `/channels/${enc(channelId)}`);
  }

  async searchChannels(teamId: string, term: string): Promise<Channel[]> {
    return this.request<Channel[]>(
      'POST',
      `/teams/${enc(teamId)}/channels/search`,
      { term }
    );
  }

  async getChannelUnread(
    userId: string,
    channelId: string
  ): Promise<ChannelUnread> {
    return this.request<ChannelUnread>(
      'GET',
      `/users/${enc(userId)}/channels/${enc(channelId)}/unread`
    );
  }

  async getChannelCategories(userId: string, teamId: string): Promise<ChannelCategoryList> {
    return this.request<ChannelCategoryList>(
      'GET',
      `/users/${enc(userId)}/teams/${enc(teamId)}/channels/categories`
    );
  }

  async createChannelCategory(
    userId: string,
    teamId: string,
    category: CreateChannelCategoryRequest
  ): Promise<ChannelCategory> {
    return this.request<ChannelCategory>(
      'POST',
      `/users/${enc(userId)}/teams/${enc(teamId)}/channels/categories`,
      { ...category, user_id: userId, team_id: teamId }
    );
  }

  async updateChannelCategory(
    userId: string,
    teamId: string,
    categoryId: string,
    category: UpdateChannelCategoryRequest
  ): Promise<ChannelCategory> {
    return this.request<ChannelCategory>(
      'PUT',
      `/users/${enc(userId)}/teams/${enc(teamId)}/channels/categories/${enc(categoryId)}`,
      category
    );
  }

  async deleteChannelCategory(userId: string, teamId: string, categoryId: string): Promise<void> {
    return this.request<void>(
      'DELETE',
      `/users/${enc(userId)}/teams/${enc(teamId)}/channels/categories/${enc(categoryId)}`
    );
  }

  async reorderChannelCategories(
    userId: string,
    teamId: string,
    categoryIds: ChannelCategoryOrder
  ): Promise<ChannelCategoryOrder> {
    return this.request<ChannelCategoryOrder>(
      'PUT',
      `/users/${enc(userId)}/teams/${enc(teamId)}/channels/categories/order`,
      categoryIds
    );
  }

  async updateChannelCategories(
    userId: string,
    teamId: string,
    categories: UpdateChannelCategoriesRequest
  ): Promise<readonly ChannelCategory[]> {
    return this.request<readonly ChannelCategory[]>(
      'PUT',
      `/users/${enc(userId)}/teams/${enc(teamId)}/channels/categories`,
      categories
    );
  }

  // ========== Posts ==========

  async createPost(
    channelId: string,
    message: string,
    rootId?: string
  ): Promise<Post> {
    return this.request<Post>('POST', '/posts', {
      channel_id: channelId,
      message,
      root_id: rootId || '',
    });
  }

  async getPostsForChannel(
    channelId: string,
    page: number = 0,
    perPage: number = 60
  ): Promise<PostList> {
    return this.request<PostList>(
      'GET',
      `/channels/${enc(channelId)}/posts?page=${page}&per_page=${perPage}`
    );
  }

  async getPost(postId: string): Promise<Post> {
    return this.request<Post>('GET', `/posts/${enc(postId)}`);
  }

  async getPostThread(postId: string): Promise<PostList> {
    return this.request<PostList>('GET', `/posts/${enc(postId)}/thread`);
  }

  async searchPosts(teamId: string, terms: string): Promise<SearchResult> {
    return this.request<SearchResult>(
      'POST',
      `/teams/${enc(teamId)}/posts/search`,
      { terms }
    );
  }

  // ========== Threads ==========

  async getUserThreads(userId: string, teamId: string): Promise<Thread[]> {
    return this.request<Thread[]>(
      'GET',
      `/users/${enc(userId)}/teams/${enc(teamId)}/threads`
    );
  }

  async getThreadsStats(userId: string, teamId: string): Promise<ThreadStats> {
    const response = await this.request<ThreadsResponse>(
      'GET',
      `/users/${enc(userId)}/teams/${enc(teamId)}/threads?totalsOnly=true`
    );
    return {
      total_unread_threads: response.total_unread_threads,
      total_unread_mentions: response.total_unread_mentions,
    };
  }

  async getUserThread(
    userId: string,
    teamId: string,
    threadId: string
  ): Promise<Thread> {
    return this.request<Thread>(
      'GET',
      `/users/${enc(userId)}/teams/${enc(teamId)}/threads/${enc(threadId)}`
    );
  }

  async startFollowingThread(userId: string, threadId: string): Promise<void> {
    return this.request<void>(
      'POST',
      `/users/${enc(userId)}/threads/${enc(threadId)}/following`
    );
  }

  async stopFollowingThread(userId: string, threadId: string): Promise<void> {
    return this.request<void>(
      'DELETE',
      `/users/${enc(userId)}/threads/${enc(threadId)}/following`
    );
  }

  async updateThreadRead(
    userId: string,
    teamId: string,
    threadId: string,
    timestamp: number
  ): Promise<void> {
    return this.request<void>(
      'PUT',
      `/users/${enc(userId)}/teams/${enc(teamId)}/threads/${enc(threadId)}/read/${timestamp}`
    );
  }
}
