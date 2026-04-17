# Spec: Paginated table browser for D1 (datasette-lite via CFW)

## Problem

Right now the only way to browse the archive's D1 tables is:
1. Download `archive.db` (~XX MB SQLite file, daily) and `sqlite3`
   against it locally, or
2. Construct specific queries via the app's typed endpoints
   (`/api/channels`, `/api/messages`, etc.)

There's no general "show me all rows in table X with pagination and
filtering" surface. Would be useful for:
- Exploration by power-users
- Ad-hoc data questions without standing up a new API route
- Validating pipeline runs (did X rows land?)

## Goal

A datasette-style table browser served by the Cloudflare Worker, over
the existing D1 database. Minimal HTML + paginated JSON.

## Shape

New endpoints:

- `GET /tables` — list of tables + row counts.
- `GET /tables/:table?limit=&offset=&order_by=&desc=` — JSON rows.
- `GET /tables/:table/ui?...` — HTML page rendering the above, with
  pagination controls, column sort, and a simple "jump to row ID"
  input.

Column-specific filtering (v2):
- `?where.column=value&where.column.op=eq|ne|gt|lt|like`
- Encoded safely (bind params, not interpolated).

Schema introspection: `SELECT name, sql FROM sqlite_schema WHERE type='table'`.

## Security

- Read-only. No DDL, no writes. The Worker's D1 binding is `.prepare()`
  with user-supplied fragments only going into bind params — never
  string-concatenated into SQL.
- Column names and table names validated against a regex like
  `^[A-Za-z_][A-Za-z0-9_]*$` and checked against the live schema
  before use.
- Max `limit` clamped (e.g. 1000).

## UI

Minimal server-rendered HTML (no React — keep the bundle separate).
Columns: table picker → row table → pagination → filter row.

Optional: link back to individual records via the main viewer's hash
format for known tables (e.g. `messages` row → `#channel/msg`).

## Reusable shape

Factor the browser as its own TS module so it can be dropped into
future CF Worker APIs. Input: a `D1Database` handle + a list of
allowed tables (or `*` for all). Output: a fetch-style handler.

```ts
const browser = createD1Browser({ db: env.DB, tables: '*' })
if (path.startsWith('/tables')) return browser.handle(request)
```

Candidate for extracting into a standalone package later
(`@rdub/cfw-d1-browser` or similar).

## Effect on `archive.db` S3 mirror

Once this ships, cowo users who want tabular exploration have a
first-party browser they can hit. `archive.db` S3 mirror becomes
strictly for bulk / offline use — still worth keeping, but with
reduced visibility in the freshness tooltip.

## Non-goals

- Write endpoints (INSERT / UPDATE / DELETE).
- Arbitrary SQL execution (would need sandboxing).
- Cross-table joins beyond simple foreign-key navigation.
