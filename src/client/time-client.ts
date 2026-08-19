import type {
  User,
  Team,
  Channel,
  Post,
  PostList,
  Reaction,
  Thread,
  UserThreads,
  ThreadStats,
  ChannelUnread,
  TeamUnread,
  SearchResult,
  ErrorInfo,
} from '../types/time-api.js';
import { TimeApiError } from '../types/time-api.js';

// Encode every caller-supplied id before it is interpolated into a URL path,
// so a value containing `/`, `?`, `#` or `..` cannot redirect the request to a
// different API endpoint. Simple ids are unaffected (encode is identity).
const enc = encodeURIComponent;

const DEFAULT_TIMEOUT_MS = 30_000;

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
      const error = new TimeApiError(
        `Time API Error: ${response.status} ${response.statusText}`,
        response.status
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

  // ========== Reactions ==========

  async addReaction(
    userId: string,
    postId: string,
    emojiName: string
  ): Promise<Reaction> {
    return this.request<Reaction>('POST', '/reactions', {
      user_id: userId,
      post_id: postId,
      emoji_name: emojiName,
    });
  }

  async removeReaction(
    userId: string,
    postId: string,
    emojiName: string
  ): Promise<void> {
    return this.request<void>(
      'DELETE',
      `/users/${enc(userId)}/posts/${enc(postId)}/reactions/${enc(emojiName)}`
    );
  }

  async getReactions(postId: string): Promise<Reaction[]> {
    return this.request<Reaction[]>('GET', `/posts/${enc(postId)}/reactions`);
  }

  // ========== Threads ==========

  async getUserThreads(userId: string, teamId: string): Promise<UserThreads> {
    return this.request<UserThreads>(
      'GET',
      `/users/${enc(userId)}/teams/${enc(teamId)}/threads`
    );
  }

  async getThreadsStats(
    userId: string,
    teamId: string
  ): Promise<ThreadStats> {
    return this.request<ThreadStats>(
      'GET',
      `/users/${enc(userId)}/teams/${enc(teamId)}/threads/stats`
    );
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
