# Stockroom — private office inventory

Next.js App Router, TypeScript, Tailwind CSS, and Supabase Auth/PostgreSQL/Realtime. All seven pages are implemented: dashboard, inventory, item details, stock movements, storage locations, reports, and team/settings. No public signup, commerce, or billing.

## Incremental delivery

1. **Database and access:** migration includes office members, locations, items, and an immutable movement ledger. Only active members read data. Staff/admins change stock through RPC; only admins manage memberships and create locations. Atomic row locks protect stock writes; PostgreSQL derives the actor from `auth.uid()`.
2. **Inventory workflows:** searchable and filterable inventory, item creation, storage locations, details, stock-in/out/count adjustments, required reasons, actor history, and CSV exports. New items start at zero; opening balances use the movement workflow.
3. **Dashboard and reports:** current stock and value, stock status distribution, restock alerts, category totals, 30-day movement summaries, team roles, and membership activation/deactivation.
4. **Live production:** password sign-in for provisioned users, member-scoped queries, realtime subscriptions and focus refresh. Requires the Supabase setup below. With no configured project, the app presents an explicitly labeled, in-memory demo. Sample data never seeds production and resets on reload.

## Local development

```sh
npm ci
npm run dev
```

Open http://localhost:3000. With no environment variables, only isolated sample data is available. Demo writes remain in browser memory. Production never falls back to demo when login or database queries fail.

## Production Supabase setup

1. Create a dedicated Supabase project. Run `supabase/migrations/001_inventory.sql` in its SQL Editor, or apply with Supabase CLI migrations. It adds the four tables to the Realtime publication.
2. In Authentication settings, **disable Allow new users to sign up**. Do not enable anonymous sign-in. Create the first account in the Auth Users dashboard with a secure password. Configure recovery through your office's administrator.
3. Copy that user's UUID and bootstrap the first admin in the SQL Editor:

```sql
insert into public.members (id, name, role)
values ('REPLACE_WITH_AUTH_USER_UUID', 'Office Administrator', 'admin');
```

4. Copy `.env.example` to `.env.local` and set `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` (a Supabase publishable key also works). These are intentionally browser-visible; RLS protects records. Never use a service-role/secret key. Environment values are baked into the static build, so rebuild after changing them.
5. Run `npm run build` and deploy the `out/` folder behind private hosting access. The Sites deployment is owner-private by default; team access to the hosting layer must be configured separately before coworkers can use it. Supabase membership still controls data access.
6. Add office locations, then items, then opening stock through **Record movement**. For additional users, provision each Auth account first; use **Team & settings → Manage member** with their UUID and chosen role. This does not send invitation emails or create Auth accounts. You cannot change your own membership in the UI.
7. Verify with two provisioned users that a stock change appears live on the other session. Check anonymous, non-member, viewer, and disabled-user access before connecting real office data.

## Validation

```sh
npm run typecheck
npm run build
sh scripts/test-database.sh
```

The database test uses installed PostgreSQL binaries (`initdb`, `pg_ctl`, `psql`), a fresh temporary cluster on a private Unix socket, and mock Supabase Auth roles/identity. It applies the actual migration and checks member restrictions, viewer and anonymous denial, actor attribution, atomic add/remove/adjust, negative-stock prevention, required reasons, immutable history, staff role-escalation denial, and disabled-member access. It deletes its temporary cluster after testing. It does not connect to production.

The Auth service and Supabase Realtime transport require verification against your connected project; the temporary PostgreSQL test does not emulate them.

## Database design

- One office per Supabase project; all active office members can read all office inventory.
- A viewer has read-only access; staff can create items and record stock; admins also manage locations and members.
- Quantity has no direct client write privilege. `record_stock` locks the item row, validates availability, updates quantity, and appends its ledger row in one transaction. An adjustment is a physical counted total, not a delta.
- Movements record previous/next quantities, delta, reason, server timestamp, and authenticated actor. No client can update/delete the ledger or assign an actor.
- Disabling membership blocks future reads and mutations. Already-delivered records cannot be retracted from a user's browser.
- CSV reports use current loaded data and escape spreadsheet formula prefixes.
- No demo SQL seed is applied to production. Sample fixtures are in `lib/data.ts` and used exclusively in unconfigured demo mode.

Supabase behavior follows its official [RLS documentation](https://supabase.com/docs/guides/database/postgres/row-level-security) and [Postgres Changes documentation](https://supabase.com/docs/guides/realtime/postgres-changes).
