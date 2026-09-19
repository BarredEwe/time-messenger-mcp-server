import type { TimeClient } from '../client/time-client.js';

/**
 * user_id → username, shared by every formatter that prints an author.
 *
 * Cached for the process lifetime because usernames rarely change and an
 * uncached 200-message page would resolve the same authors over and over.
 * Only *answered* lookups land here: a profile the server refuses to return
 * (network error, 5xx, timeout) stays uncached so the next listing retries it,
 * otherwise a single blip would pin an author to a raw id until restart.
 *
 * `null` is the negative entry: the server answered and has no name for that
 * id. It is kept out of the returned map so formatters print the raw id rather
 * than an `@id` that looks like a username.
 */
const usernameCache = new Map<string, string | null>();

// POST /users/ids takes the whole batch at once; chunked anyway so a channel
// with hundreds of distinct authors cannot build an unbounded request body.
const BATCH_SIZE = 100;

/**
 * Maps ids to usernames. Ids without a known username are **absent** from the
 * result — every caller already falls back to the raw id, and putting them in
 * would render a deleted profile as `@<id>`.
 */
export async function resolveUsernames(
  client: TimeClient,
  userIds: string[]
): Promise<Map<string, string>> {
  const uniqueIds = [...new Set(userIds.filter(Boolean))];
  const unknownIds = uniqueIds.filter((id) => !usernameCache.has(id));

  for (let i = 0; i < unknownIds.length; i += BATCH_SIZE) {
    const batch = unknownIds.slice(i, i + BATCH_SIZE);

    try {
      const users = await client.getUsersByIds(batch);

      for (const user of users) {
        usernameCache.set(user.id, user.username || user.nickname || null);
      }

      // Ids the server answered about but did not return are deleted or
      // unreadable profiles — the batch equivalent of a 404. Cache them
      // negatively: asking again would return nothing either.
      for (const id of batch) {
        if (!usernameCache.has(id)) {
          usernameCache.set(id, null);
        }
      }
    } catch {
      // Transport error or 5xx: the profiles may well exist, so leave the
      // batch uncached and let the next call try again.
    }
  }

  const resolved = new Map<string, string>();
  for (const id of uniqueIds) {
    const username = usernameCache.get(id);
    if (username) {
      resolved.set(id, username);
    }
  }

  return resolved;
}

/** Test seam: the cache lives for the whole process, tests need a clean one. */
export function clearUsernameCache(): void {
  usernameCache.clear();
}
