export interface User {
  id: string
  create_at: number
  update_at: number
  delete_at: number
  username: string
  first_name: string
  last_name: string
  nickname: string
  email: string
  auth_data: string
  auth_service: string
  roles: string
  locale: string
  notify_props: Record<string, any>
}

export interface Team {
  id: string
  create_at: number
  update_at: number
  delete_at: number
  display_name: string
  name: string
  description: string
  email: string
  type: string
  invite_id: string
  scheme_id: string
  allow_open_invite: boolean
}

export interface Channel {
  id: string
  create_at: number
  update_at: number
  delete_at: number
  team_id: string
  type: string
  display_name: string
  name: string
  header: string
  purpose: string
  last_post_at: number
  total_msg_count: number
  extra_update_at: number
  creator_id: string
  scheme_id: string
  group_constrained: boolean
  shared: boolean
}

export interface Post {
  id: string
  create_at: number
  update_at: number
  delete_at: number
  edit_at: number
  user_id: string
  channel_id: string
  root_id: string
  parent_id: string
  original_id: string
  message: string
  type: string
  props: Record<string, any>
  hashtags: string
  pending_post_id: string
  metadata: Record<string, any>
}

export interface PostList {
  order: string[]
  posts: Record<string, Post>
  next_post_id: string
  prev_post_id: string
}

export interface Thread {
  id: string
  create_at: number
  update_at: number
  delete_at: number
  reply_count: number
  last_reply_at: number
  last_viewed_at: number
  participants: User[]
  post: Post
}

/**
 * Response of GET /users/{user_id}/teams/{team_id}/threads. The endpoint
 * returns a wrapper object rather than a bare array, and `threads` is null
 * when the user follows no threads.
 */
export interface UserThreads {
  total: number
  total_unread_threads: number
  total_unread_mentions: number
  threads: Thread[] | null
}

export interface ThreadStats {
  total_unread_threads: number
  total_unread_mentions: number
}

export interface ChannelUnread {
  channel_id: string
  msg_count: number
  mention_count: number
}

export interface TeamUnread {
  team_id: string
  msg_count: number
  mention_count: number
}

export interface SearchResult {
  order: string[]
  posts: Record<string, Post>
}

export interface ErrorInfo {
  id: string
  message: string
  request_id: string
  status_code: number
  where: string
}

export class TimeApiError extends Error {
  statusCode: number
  errorInfo?: ErrorInfo

  constructor(message: string, statusCode: number) {
    super(message)
    this.name = 'TimeApiError'
    this.statusCode = statusCode
  }
}
