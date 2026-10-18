# Neon setup

This app uses Neon PostgreSQL for inventory, memberships/permissions, immutable stock transactions, counts, reports/imports, office-password sessions and rate limiting, and private item-image bytes. Supabase remains **only the staff identity provider and invitation email service**. No Supabase database/Storage/Edge Function is used by the app's data endpoints. No passwords, database URLs or service keys belong in frontend code or Git.

## Linked project

- Organization: `org-dawn-mud-44689891`
- Project: `stockroom` (`purple-truth-70667458`)
- Branch: `production` (`br-steep-bird-arjlkess`)
- Config: `neon.ts` (Postgres only; Neon Auth is not enabled)

`neon init -y --org-id org-dawn-mud-44689891 --project-id purple-truth-70667458 --branch production --services postgres` linked this directory. `neon deploy` verified the branch and pulled `DATABASE_URL`, `DATABASE_URL_UNPOOLED` and `NEON_BRANCH` into ignored `.env.local`. The production schema was installed with `npm run neon:migrate` (11 migrations) after the full end-to-end suite passed on the disposable `inventory-neon-migration` branch. Production starts empty; it has no sample inventory or synthetic staff. (The project previously linked here, `winter-rice-28831472`, is no longer used.)

## Runtime and migrations

The app uses `@neondatabase/serverless` over HTTP, suitable for Netlify serverless/edge execution. Application calls use the pooled `DATABASE_URL`. Identity, office session context and `SET LOCAL ROLE authenticated` are set in one HTTP transaction, so current staff membership, roles, RLS, cost isolation and actor audit rules stay enforced and context does not leak between requests. Named database calls and endpoints are allowlisted; browser-supplied SQL, identities and roles are never executed.

Migrations are checked in under `neon/migrations`. They preserve the existing audited SQL functions, adapt identity/Storage metadata for plain Postgres, and omit Supabase publication/PostgREST configuration. The runner uses direct `DATABASE_URL_UNPOOLED`, records checksums, skips applied migrations, and rejects edits to already-applied migrations:

```sh
npm run neon:migrate
```

`neon deploy` provisions services and pulls env; it does not apply SQL migrations. Test schema changes on a Neon child branch before applying them to production.

### Pull-request preview branches

`.github/workflows/neon-preview-branch.yml` creates a Neon branch `preview/pr-<number>-<git-branch>` from `production` for every opened/updated pull request, runs `npm run neon:migrate` against it using the branch's direct connection, posts a schema-diff comment to the PR, and deletes the branch when the PR closes (branches also auto-expire after 14 days). Configure in the GitHub repository:

- Variable `NEON_PROJECT_ID`: `purple-truth-70667458`
- Secret `NEON_API_KEY`: a Neon API key with access to the project

Connection strings are passed only as step environment variables and are never logged. Preview branches contain a copy of production data at creation time; treat them with the same care as production.

## Staff accounts and first admin

Existing staff authentication code remains intact. Configure `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` for the existing identity provider. A staff token is validated with that provider for every inventory/file request. Only verified identity metadata is mirrored into Neon; credentials remain with the provider. Merely having a staff Auth account does not grant office membership.

For a new empty office, create and email-verify the first administrator in staff Auth. Put `SUPABASE_SERVICE_ROLE_KEY`, `NEON_ADMIN_USER_ID`, and `NEON_ADMIN_NAME` in ignored local environment settings, then run:

```sh
npm run neon:bootstrap-admin
```

This verifies the account with Auth and grants the initial membership only when no active administrator exists. There is no HTTP bootstrap endpoint. Later members are invited through the admin team-settings screen. Invite preparation, roles, revocation and acceptance live in Neon; only sending the invitation uses the existing Auth provider. The Supabase service key is not used for office sessions or inventory.

## Office gate and Netlify

In Netlify production environment settings, configure:

- `DATABASE_URL`: copy the pooled value from `.env.local`; include **Functions** scope. Never prefix this name with `NEXT_PUBLIC_`.
- `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`: the staff identity provider; available at build time and to Functions.
- `OFFICE_PASSWORD`: at least 12 characters; server-only.
- `OFFICE_SESSION_SECRET`: at least 32 random characters; server-only.
- `OFFICE_APP_ORIGIN`: `https://inventory-tracker-gluska.netlify.app`.
- Optional `OFFICE_SESSION_TTL_SECONDS` (default 28800) and `SUPABASE_SERVICE_ROLE_KEY` for invitations.

Keep `DATABASE_URL_UNPOOLED` in trusted migration/CLI settings; the web server does not need it. The checked-in `netlify.toml` sets the Next.js build command, `.next` publish directory, and Node 22. Build with `npm run build` (or `build:production` after configuring staff Auth), Node 22, using Netlify's Next.js adapter. Never deploy `out/` as a static app. Changing environment values requires a redeploy.

Office cookies remain `HttpOnly`, `Secure`, `SameSite=Strict`, with absolute expiry. Logout deletes the Neon session. Changing the password invalidates existing session generations; rotate the session secret when changing/restoring a password, and restart all replicas together. Trusted-owner SQL `delete from office_security.sessions` revokes every office session.

Private images remain limited to JPEG/PNG/WebP, 5 MB each. Bytes and metadata are stored in Neon and served through authenticated handlers under the existing Storage RLS. No public or signed bearer URLs are returned. For large media workloads, a dedicated object store can be added later; none was provisioned for this Postgres-only setup.

## Verification

`npm run build`, `npm run test:office`, and the existing inventory/CSV/realtime/access tests pass. The actual Next server was started and exercised against the real disposable Neon branch by:

```sh
neon checkout inventory-neon-migration --create
npm run neon:migrate
npm run verify:neon
neon checkout production
```

The test refuses to run against production, uses a local **fixture identity provider**, and verifies real Neon session cookies, unauthorized URL/API/file denial, database reads and writes, staff stock receipts/audit attribution, viewer restrictions, cost isolation, image upload/download, SSE closure on session revocation, and replay denial after logout. Fixture accounts/data never enter production. The disposable test branch was deleted after the successful run; newly created test branches also auto-expire in seven days. `npm run verify:neon-office` starts the built app against the currently linked production branch and checks office login, session enforcement and logout without creating staff or inventory.

Real staff sign-in and invitation email require real identity-provider credentials and verified accounts, which were not available locally during setup. Hosted Netlify verification requires setting its `DATABASE_URL` and deploying the new code. Neither is substituted by the fixture test.

References: [Neon serverless driver](https://neon.com/docs/serverless/serverless-driver), [Neon connection methods](https://neon.com/docs/connect/choose-connection).
