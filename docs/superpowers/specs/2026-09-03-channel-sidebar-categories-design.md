# Channel Sidebar Categories Design

## Scope

Add seven MCP tools for the authenticated user's Mattermost sidebar categories in a selected team:

- `time_list_channel_categories`
- `time_create_channel_category`
- `time_update_channel_category`
- `time_delete_channel_category`
- `time_reorder_channel_categories`
- `time_move_channel_to_category`
- `time_set_channel_favorite`

The implementation uses only the current sidebar category API. It never reads or writes legacy `favorite_channel` preferences.

## Architecture

Add Mattermost sidebar category models to `src/types/time-api.ts`, client methods to the existing `TimeClient`, and a focused `src/tools/channel-categories.ts` tool module registered through `src/index.ts`. The existing authenticated user ID resolved by `getMe()` is passed to every category method, matching all current user-scoped client calls.

The client exposes direct methods for listing, creating, updating, deleting, reordering, and collection-updating categories. It preserves the existing request path, authorization, ID encoding, timeout, and `TimeApiError` translation.

## Tool Contracts

All tools require `team_id`. Category and channel references are IDs, matching existing tools.

`time_list_channel_categories` lists the ordered categories and renders category metadata plus channel summaries. It fetches categories and the user's team channels, then maps `channel_ids` onto the existing channel summary fields. Unknown channel IDs remain visible as IDs rather than being dropped.

`time_create_channel_category` accepts `display_name` and creates a `custom` category with no initial channels. Channel placement remains the responsibility of the move tool.

`time_update_channel_category` accepts `category_id` plus at least one of `display_name`, `sorting`, `muted`, or `collapsed`. It first lists categories, merges the requested metadata into the matching category, and sends the complete category object to the individual update route. It does not accept `channel_ids`.

`time_delete_channel_category` accepts `category_id` and invokes the current delete route. Mattermost enforces that only custom categories can be deleted.

`time_reorder_channel_categories` accepts an ordered `category_ids` array and sends it directly to the order route. Mattermost validates ownership and completeness.

`time_move_channel_to_category` accepts `channel_id` and `category_id`. It lists categories, locates the channel's current explicit category and the destination, removes the channel from every submitted source category, appends it once to the destination, and sends all changed categories in one collection-level `PUT`. Direct-message categories are not valid explicit destinations.

`time_set_channel_favorite` accepts `channel_id` and `favorite`. It lists categories, locates the protected `favorites` category and the channel's current explicit category, then uses one collection-level `PUT`. Favoriting moves the channel into Favorites; unfavoriting removes it from Favorites and places it in the standard `channels` category. No preference API is consulted.

## API Models

The category model contains `id`, `user_id`, `team_id`, `sort_order`, `sorting`, `type`, `display_name`, `muted`, `collapsed`, and `channel_ids`. Supported sorting values are `""`, `manual`, `recent`, and `alpha`. Personal category types are `channels`, `custom`, `direct_messages`, and `favorites`; `managed` is represented for list compatibility but never mutated by these tools.

The list response is `{ categories, order }`. Collection update responses are arrays, following the current server and official client rather than the incorrect single-object OpenAPI response declaration.

## Errors

Zod rejects malformed MCP inputs before any network request. Missing category IDs, missing required system categories, or invalid explicit destinations produce clear errors. Mattermost authorization, membership filtering, protected-category rules, and invalid-order errors continue through the existing `TimeApiError` and MCP error envelope.

## Testing

Client contract tests cover every HTTP method, encoded path, and JSON body. Tool tests cover schema rejection, metadata-only updates, ordered rendering, atomic source/destination moves, favorite and unfavorite behavior, duplicate prevention, and missing-category failures. Existing tests, type checking, and the production build must remain green.

Manual verification drives the built stdio MCP server against a local fake Mattermost HTTP server and asserts tool discovery plus representative list, move, and favorite calls at the wire boundary.
