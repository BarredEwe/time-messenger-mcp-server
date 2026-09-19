import { describe, it, expect } from 'vitest';
import { extractThreads, formatThread, formatThreads } from '../tools/threads.js';
import type { Thread, Post, User, UserThreads } from '../types/time-api.js';

const makePost = (overrides: Partial<Post> & { id: string; message: string }): Post => ({
  create_at: 1000,
  update_at: 0,
  delete_at: 0,
  edit_at: 0,
  user_id: 'u1',
  channel_id: 'ch1',
  root_id: '',
  parent_id: '',
  original_id: '',
  type: '',
  props: {},
  hashtags: '',
  pending_post_id: '',
  metadata: {},
  ...overrides,
});

const makeUser = (id: string): User => ({
  id,
  create_at: 0,
  update_at: 0,
  delete_at: 0,
  username: `user_${id}`,
  first_name: '',
  last_name: '',
  nickname: '',
  email: `${id}@test.com`,
  auth_data: '',
  auth_service: '',
  roles: '',
  locale: 'en',
  notify_props: {},
});

const makeThread = (overrides: Partial<Thread> & { id: string }): Thread => ({
  create_at: 1000,
  update_at: 0,
  delete_at: 0,
  reply_count: 3,
  last_reply_at: 5000,
  last_viewed_at: 0,
  participants: [makeUser('u1')],
  post: makePost({ id: 'p1', message: 'Root' }),
  ...overrides,
});

describe('extractThreads', () => {
  it('unwraps the object response returned by the threads endpoint', () => {
    const thread = makeThread({ id: 't1' });
    const response: UserThreads = {
      total: 1,
      total_unread_threads: 0,
      total_unread_mentions: 0,
      threads: [thread],
    };
    expect(extractThreads(response)).toEqual([thread]);
  });

  it('returns an empty array when threads is null', () => {
    const response: UserThreads = {
      total: 0,
      total_unread_threads: 0,
      total_unread_mentions: 0,
      threads: null,
    };
    expect(extractThreads(response)).toEqual([]);
  });

  it('accepts a bare array', () => {
    const thread = makeThread({ id: 't1' });
    expect(extractThreads([thread])).toEqual([thread]);
  });

  it('returns an empty array for null/undefined', () => {
    expect(extractThreads(null)).toEqual([]);
    expect(extractThreads(undefined)).toEqual([]);
  });
});

describe('formatThread', () => {
  it('formats a thread with all fields', () => {
    const thread = makeThread({ id: 't1' });
    const result = formatThread(thread);
    expect(result).toContain('Thread ID: t1');
    expect(result).toContain('Reply count: 3');
    expect(result).toContain('Root message');
    expect(result).toContain('Root');
  });

  it('formats thread without post', () => {
    const thread = makeThread({ id: 't2', post: undefined as unknown as Post });
    const result = formatThread(thread);
    expect(result).toContain('Thread ID: t2');
    expect(result).not.toContain('Root message');
  });
});

describe('formatThreads', () => {
  it('returns "No threads found." for empty list', () => {
    expect(formatThreads([])).toBe('No threads found.');
  });

  it('formats a list of threads', () => {
    const t1 = makeThread({ id: 't1', reply_count: 2, post: makePost({ id: 'p1', message: 'Hello world from thread one' }) });
    const t2 = makeThread({ id: 't2', reply_count: 5, post: makePost({ id: 'p2', message: 'Another thread message here' }) });
    const result = formatThreads([t1, t2]);
    expect(result).toContain('Found 2 thread(s)');
    expect(result).toContain('2 replies');
    expect(result).toContain('5 replies');
    expect(result).toContain('Thread ID: t1');
    expect(result).toContain('Thread ID: t2');
  });

  it('handles thread without post gracefully', () => {
    const thread = makeThread({ id: 't1', post: undefined as unknown as Post });
    const result = formatThreads([thread]);
    expect(result).toContain('No content');
  });

  it('truncates long messages to 100 chars', () => {
    const longMessage = 'A'.repeat(200);
    const thread = makeThread({ id: 't1', post: makePost({ id: 'p1', message: longMessage }) });
    const result = formatThreads([thread]);
    const preview = longMessage.substring(0, 100);
    expect(result).toContain(preview);
    expect(result).toContain('...');
  });
});
