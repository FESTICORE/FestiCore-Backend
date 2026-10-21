# Metrics API

Source: Festival app API specification v0.1, page 27.

## POST `/api/v1/metrics/events`

- Public ingestion; `X-Device-Id` is a required UUID v4. Access JWT is optional.
- Body: `{ "events": [{ "name": EventName, "at": ISO8601, "festivalId"?: string, "value"?: number, "props"?: Record<string, string | number | boolean> }] }`.
- `EventName`: `app.cold_start`, `live.poll`, `live.offline_banner`, `pack.download`, `screen.open`, `offline.open`, `status.update`, `push.received`.
- `app.cold_start` and `pack.download` require `value` in milliseconds. `live.poll` requires `props.status` of 200, 304, or `err`. `screen.open` and `offline.open` require `props.screen`. `status.update` requires `props.kind` of `flag` or `crew` and boolean `props.queued`. `push.received` requires `props.type`.
- One to 100 events per request. Unknown body and event fields, non-finite values, oversized properties, and malformed timestamps are rejected with 400. Events older than seven days or more than five minutes in the future are rejected.
- `202` has no response body. Global rate limit applies; this route is further limited to 30 requests/minute per client IP.
- Stored data excludes IP addresses and raw HTTP headers, including Authorization. Sensitive property names are rejected. Device IDs are retained solely for distinct-device counts; the endpoint does not grant access to a device record.

## GET `/api/v1/admin/metrics`

- 일반 로그인 Bearer access JWT와 활성 관리자 `viewer` 이상 권한.
- Query: required `festivalId`; optional `from` and `to` ISO8601 timestamps, defaulting to the festival's first and last published day; `bucket=1h|1d` (default `1h`). The end must follow the start.
- `200`: `{ "buckets": [{ "at", "activeDevices", "liveRequests", "live304Rate", "liveErrorRate", "statusUpdates", "follows", "crewJoins", "offlineOpens", "coldStartP95Ms" }] }` inside the standard `code/data/message` envelope.
- Rates are fractions between zero and one; P95 is milliseconds or null when no cold-start sample exists. `follows` and `crewJoins` come from server-owned follow and crew-member timestamps, not client claims.
- Buckets use the festival's `Asia/Seoul` timezone. The `at` field is the corresponding bucket start expressed as an ISO8601 UTC instant.
