# Channel Sidebar Categories Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add exactly seven MCP tools for the authenticated user's Mattermost sidebar categories.

**Architecture:** Add typed category models, six route methods on the existing `TimeClient`, and one focused tool module. Category metadata uses individual routes; moves and Favorites use one collection-level `PUT` containing every changed source and destination category.

**Tech Stack:** TypeScript ESM, Zod 3, MCP SDK 1.x, Vitest, Node.js 20.

## Global Constraints

- Expose exactly the seven approved tools and no arbitrary bulk replacement tool.
- Use the authenticated `userId` already resolved by `getMe()`; never expose `user_id` as tool input.
- Use only current sidebar category routes; never read or write `favorite_channel` preferences.
- Preserve the existing HTTP request, authentication, encoding, timeout, and error path.
- Keep category updates metadata-only; channel membership changes only through move/favorite.
- Do not add dependencies or refactor unrelated code.

---

### Task 1: Restore Baseline

**Files:** No changes.

- [ ] Run `npm ci`.
- [ ] Run `npm test`, `npm run typecheck`, and `npm run build`.
- [ ] Confirm `package.json` and `package-lock.json` remain unchanged.

### Task 2: Category Models And Client

**Files:**
- Modify: `src/types/time-api.ts`
- Modify: `src/client/time-client.ts`
- Test: `src/__tests__/time-client.test.ts`

**Produces:** `ChannelCategory`, `ChannelCategoryList`, sorting/type unions, and `TimeClient` methods for get/create/update/delete/reorder/collection-update.

- [ ] Add failing HTTP contract tests for all six routes, encoded IDs, raw array bodies, 204 delete handling, and `TimeApiError` propagation.
- [ ] Run `npm test -- src/__tests__/time-client.test.ts -t "Channel category methods"`; expect missing-method failures.
- [ ] Add the typed models and minimal client methods through `this.request()`.
- [ ] Re-run the focused test and full client test file; expect PASS.

### Task 3: Seven Tool Contracts

**Files:**
- Create: `src/tools/channel-categories.ts`
- Modify: `src/__tests__/tool-handlers.test.ts`

**Consumes:** Category client methods from Task 2.

**Produces:** `channelCategoryTools` with exactly the seven approved definitions.

- [ ] Add failing tests for exact tool names, strict schemas, no `user_id`, list ordering/rendering, create payload, metadata-only update, direct delete, and raw reorder array.
- [ ] Run `npm test -- src/__tests__/tool-handlers.test.ts -t "channel categor"`; expect absent-tool/schema failures.
- [ ] Implement strict JSON Schemas and matching Zod schemas.
- [ ] Implement ordered list rendering with category metadata, existing channel summary fields, and visible unknown channel IDs.
- [ ] Implement create as `{ display_name, type: 'custom', channel_ids: [] }`.
- [ ] Implement update by reading the category, merging only supplied metadata, and preserving all remaining fields and channels.
- [ ] Implement delete and reorder as narrow direct operations.
- [ ] Re-run focused tests; expect PASS.

### Task 4: Atomic Move And Favorites

**Files:**
- Modify: `src/tools/channel-categories.ts`
- Test: `src/__tests__/tool-handlers.test.ts`

- [ ] Add failing tests for missing/invalid destinations, duplicate removal, preserved metadata, and one collection `PUT` containing changed source/destination categories.
- [ ] Add failing tests for favorite/unfavorite, missing Favorites/Channels categories, no managed-category mutation, and no legacy preference request.
- [ ] Run focused move/favorite tests; expect missing behavior failures.
- [ ] Implement one shared category-move transformation for mutable explicit categories.
- [ ] Make move reject `direct_messages` and `managed` destinations.
- [ ] Make favorite target `favorites`; make unfavorite target `channels`.
- [ ] Submit only changed complete categories in one `updateChannelCategories()` call; skip the request when state is already normalized.
- [ ] Re-run focused and full handler tests; expect PASS.

### Task 5: Registration

**Files:**
- Modify: `src/index.ts`

- [ ] Build before registration and verify stdio `tools/list` lacks the seven names.
- [ ] Import and spread `channelCategoryTools` into `allTools` without changing dispatch/authentication.
- [ ] Rebuild and verify `tools/list` contains exactly the seven requested names and no bulk category tool.

### Task 6: Verification

**Files:** No repository changes.

- [ ] Run `npm test -- src/__tests__/time-client.test.ts` and `npm test -- src/__tests__/tool-handlers.test.ts`.
- [ ] Run `npm test`, `npm run typecheck`, and `npm run build`.
- [ ] Run `git diff --check` and confirm no package, auth, or tool-type changes.
- [ ] Confirm `rg -n "favorite_channel" src` and `rg -n "user_id" src/tools/channel-categories.ts` return no matches.
- [ ] Drive the built stdio server against an ephemeral local fake Mattermost server.
- [ ] Assert tool discovery and representative list, move, favorite, and unfavorite results plus exact wire paths/bodies/auth header.
- [ ] Close the MCP client/transport and fake HTTP server in `finally`; confirm no process, port, or temporary-file leak.
- [ ] Submit the scoped diff and verification evidence to the high-rigor reviewer and resolve all blocking findings.
