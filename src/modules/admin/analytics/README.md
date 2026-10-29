# Admin analytics

`GET /api/v1/admin/analytics/sentry?from=YYYY-MM-DD&to=YYYY-MM-DD&project=ios|backend`
and `GET /api/v1/admin/analytics/mixpanel?from=YYYY-MM-DD&to=YYYY-MM-DD`
require an administrator with `viewer` or higher role. Dates are inclusive KST calendar dates, limited to 31 days and today or earlier. Responses use the global `{code,data,message}` envelope.

## Configuration

- `ANALYTICS_ENVIRONMENT`: `stage` or `production`; required for Sentry queries.
- `SENTRY_IOS_PROJECT_ID`, `SENTRY_BACKEND_PROJECT_ID`: numeric Sentry project IDs.
- `SENTRY_ANALYTICS_READ_TOKEN`: Sentry read token with `org:read` and `event:read` scopes. Keep separate from SDK DSNs and upload tokens.
- `MIXPANEL_SERVICE_ACCOUNT_USERNAME`, `MIXPANEL_SERVICE_ACCOUNT_SECRET`: read capable service account for project `4078612` in US data residency.

Missing or invalid configuration produces `unconfigured` with `totalEvents: null`; upstream errors produce `error` or `rate_limited`. Sentry's exact `Unknown environments selected` 404 is treated as a real zero only when both Sentry lookups agree or the other lookup returns an empty issue list. Other 404s and auth errors remain errors. Partial Sentry data produces `partial`. Sentry `series` and `totalEvents` count error events in the selected project/environment; issue titles are generic to avoid exposing exception text. Mixpanel export is capped at 10,000 rows and 2 MB. If it reaches the row cap, `status: partial` and `truncated: true`; returned counts are observed lower bounds. If the size cap is exceeded, the response is `error` with no counts. No event properties or raw issue text are returned. Results are cached in memory for 60 seconds on success and 10 seconds otherwise; concurrent identical queries share one upstream request.

The Sentry [timeseries](https://docs.sentry.io/api/explore/query-explore-events-in-timeseries-format/) and [issues](https://docs.sentry.io/api/events/list-an-organizations-issues/) APIs and Mixpanel [raw export](https://docs.mixpanel.com/reference/raw-event-export) API define the upstream formats. Credential backed live results require separate validation after configuration.
