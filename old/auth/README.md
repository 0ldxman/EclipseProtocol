# aether-auth

Discord OAuth2 authorization microservice. Users log in with Discord; the
service figures out which organizations they belong to and what role they
hold in each (multiple organizations at once are supported), plus whether
they're a global admin — then issues an RS256-signed JWT that downstream
services (Wiki, Command Center) validate locally against the published
public key, no network call back to this service required.

## How it works

1. `GET /auth/login` redirects the browser to Discord's OAuth2 consent screen
   (scopes: `identify guilds.members.read`).
2. Discord redirects back to `GET /auth/callback`. The service exchanges the
   code for a Discord access token, fetches the user's profile and their
   member info (Discord role IDs) on `DISCORD_GUILD_ID`.
3. Those Discord role IDs are matched against the org/org-access/access-roles/
   admin-roles stored in SQLite (`aether_auth.db`) to build the access
   result: `is_admin` + a list of `{organization, level, label, permissions}`.
4. A short-lived JWT access token is issued with that access result baked
   into its claims, plus an httpOnly refresh-token cookie (held in an
   in-process memory store, see below).
5. `POST /auth/refresh` rotates the refresh token and issues a new access
   token without re-querying Discord (the access snapshot from login is
   reused — log the user out / wait for the next full login if their Discord
   roles changed and you need it reflected immediately).
6. `POST /auth/logout` revokes the refresh token.
7. `GET /.well-known/jwt-public-key` serves the PEM public key for Wiki /
   Command Center to verify tokens locally (`alg=RS256`, check `iss`/`aud`).

## Access model

- **Organizations** (`org`, e.g. "Эдем", "Аполлон") are identified by a
  `tag` and a single Discord role ID (`role_id`) that marks membership.
- **Access tiers** (`org_access`) belong to one organization and describe
  how deep into that organization's content a holder can see: a `label`
  (display name, e.g. "Совет"), a `lvl` (numeric — this is what downstream
  services like Wiki compare against to gate read access to content), and a
  list of `permissions` string keys (e.g. `staff:manage_roster`) for
  finer-grained unlocks within services like the Command Center.
- **Access roles** (`access_roles`) map a raw Discord role ID to one
  `org_access` tier. A user can hold several Discord roles that map to
  tiers within the same organization — the highest `lvl` among them wins.
  Holding the org's membership role but no matching access tier falls back
  to a bare "member" tier (`level: 0`, no permissions).
- **Admin roles** are global Discord role IDs, not tied to any organization;
  holding one sets `is_admin: true` regardless of org membership. Editing
  content in downstream services (e.g. the Wiki) is gated on this flag
  alone, not on any per-organization permission.
- A user can belong to several organizations simultaneously; the JWT's
  `organizations` claim is a list, one entry per matched organization:
  `{tag, name, level, label, permissions}`.

Raw Discord role IDs never leave this service — they're resolved into
`level`/`label`/`permissions` here, and downstream services only ever see
that resolved result in the JWT.

All of this is configured at runtime — no restart needed — via the REST API
under `/admin/*` (requires a JWT with `is_admin: true`): `/admin/orgs`,
`/admin/orgs/{org_tag}/access`, `/admin/access/{access_id}/roles`,
`/admin/admin-roles`. There's no bundled UI here on purpose: a separate
ecosystem-wide admin service is expected to call this API (and the
equivalent admin APIs of Wiki/Command Center/etc.) rather than each service
growing its own admin frontend.

## Setup

```bash
cp .env.example .env       # fill in Discord app credentials
./scripts/gen_keys.sh      # generates keys/private.pem + keys/public.pem
pip install -e .
uvicorn app.main:app --reload
```

Register the redirect URI in the Discord Developer Portal
(OAuth2 → Redirects) so it matches `DISCORD_REDIRECT_URI`. Then log in once
through `/auth/login` to get a token (after bootstrapping the first admin —
see below) and manage orgs/access tiers/permissions through `/admin/*`.

### Bootstrapping the first admin

Before anyone holds an admin role, `/admin/*` has nobody who can call it.
Add the first admin role ID straight into the SQLite file once:

```bash
sqlite3 aether_auth.db "INSERT INTO admin_roles (discord_role_id) VALUES ('<your_discord_role_id>');"
```

After that, log in via `/auth/login` — your JWT will carry `is_admin: true`
and you can manage everything else from `/admin/console`.

## Notes on scale

- **No Redis** — refresh sessions live in an in-process dict with TTLs
  (`app/core/memory_store.py`). Fine for a single `uvicorn` process; sessions
  are lost on restart and not shared across workers/instances. If this ever
  needs to run as more than one process, swap that module for a shared
  store.
- **SQLite, not Postgres** — orgs/access tiers/permissions are small,
  low-write data; SQLite is enough and needs no separate server. Accessed
  through `aiosqlite`, so DB calls don't block the event loop alongside the
  async Discord HTTP calls.
- Access tokens are short-lived (default 15 min) and carry the access
  snapshot from the last login/refresh; revoking a refresh token (logout) or
  removing an access-tier Discord role from a user takes effect the next
  time they actually log back in through Discord, not before their current
  access token expires.
