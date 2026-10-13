# Office release verification

**Decision: HOLD — not production-ready.** The hosted deployment is private and explicitly uses demo data. Production Supabase configuration is absent. No claim of live verification or office-network isolation is made.

## Evidence scope

| Critical workflow | Local evidence | Hosted/browser gate |
| --- | --- | --- |
| Invitation-only access and roles | PostgreSQL role/invitation tests plus mocked Edge handler validate trusted issuer, email/UUID binding, expiration, replay, forged metadata, roles and no anonymous access | Pending: real SMTP delivery, acceptance, reset, logout and hosting allowlist |
| Item creation and archiving | Actual migrations: required/unique identifiers, metadata conflicts, zero opening quantity, preserved ledger/balances and archived write denial | Pending: rendered creation/edit/archive and image upload/download |
| Receive, issue, return, transfer | Actual PostgreSQL RPCs: locations, ledger attribution, atomic quantity changes, reversal links and immutability | Pending: two authenticated hosted sessions and displayed confirmed values |
| Negative stock | Actual quantity constraints and insufficient-stock rejection | Pending: UI failure and unchanged hosted quantity |
| Simultaneous withdrawals | Two independent PostgreSQL connections: only one final-unit withdrawal succeeds | Pending: real browser/service race through `verify:live` |
| Duplicate submissions | Database fingerprint/request-key tests, concurrent retries and guarded UI submit paths | Pending: hosted repeated click and uncertain network outcome |
| Live updates/reconnect | Controller tests cover subscribe acknowledgment, catch-up, stale callbacks, offline gate and cleanup | Pending: actual WebSocket delivery, offline/reconnect and search/sort retention |
| Stock-count reconciliation | Actual snapshot/revision tests, net-zero movement conflicts, recount history, two-admin approval race and all-or-nothing adjustment batch | Pending: hosted count workflow through `verify:office` and UI |
| Import validation/retry | Parser/report tests and actual database row errors, confirmation, uniqueness, concurrent opening imports and later-ledger failure rollback | Pending: hosted CSV selection/preview, correction and unchanged retries |
| Deactivated-user denial | Actual RLS/RPC tests with an existing JWT subject | Pending: hosted existing session/WebSocket removal and cache clearing |
| Diagnostics | Actual structured logging/RLS/rate-limit tests, fixed fields and nonblocking client reporter | Pending: hosted ingestion, owner review and external alert routing |
| Backup restore | Local custom dump restored to a separate database; identical app/Auth/Storage metadata checksum, invariant checks and restored staff cost denial | Pending: managed Supabase restore, actual image bytes, Auth/service configuration and measured recovery time |
| Mobile/keyboard | Source review, responsive CSS, focus containment, inert background/menu, skip link, announcements, labeled native fields and scrollable tables | Pending: hands-on mobile, keyboard and screen-reader/browser testing |

Run `npm run release:demo` to reproduce the local checks and explicit demo artifact. It applies all nine real migrations to a temporary PostgreSQL cluster; no production database is touched. `npm run release:check` intentionally fails until production URL/key are configured. Neither release command runs write tests against hosted production.

## Real-service verification

Use a dedicated disposable Supabase project with migrations 001–009. Provision verified Admin and Staff members for `verify:live`. For `verify:office`, also provision a Viewer and an Auth-only test identity with no membership; do this as the trusted owner while public registration remains disabled.

Place the project's public URL/key and private test account email/passwords in the ignored `.env.local` or trusted process environment. Variable names are listed in `.env.example`. Never commit test passwords, owner credentials or a service-role key. Set `STOCKROOM_TEST_ALLOW_WRITES=disposable-project` only for that disposable environment, then run:

```sh
npm run verify:office
npm run verify:live
```

Both commands return exit code 2 when configuration is absent; that is **NOT RUN**, not PASS. They have not run against hosted Supabase in this checkout. `verify:office` covers service-side role/cost isolation, import/movement retry, count conflicts and approval, archive retention and existing-session deactivation. `verify:live` exercises two independently authenticated sessions, transaction types, final-unit concurrency, confirmed stock/activity, offline gate, reconnect catch-up and cleanup. These scripts create lasting audit fixtures and test locations; successful cleanup archives items rather than deleting history. An interrupted extended test may leave a count open or staff disabled: inspect its disposable project before repeating. They do not send real invitations or replace manual browser testing.

## Manual acceptance before office rollout

Record PASS/FAIL with date, operator, release commit, project reference, browser and evidence. Start with all rows **PENDING**; fill only after observing results.

1. As owner, confirm hosted Auth signup is disabled, service secrets are server-only, migrations are current and fresh production inventory has no fixture records. Authenticate an uninvited account and assert no inventory or cost access. As staff/viewer attempt the protected RPCs directly, not just UI buttons. Confirm the Viewer cannot change stock and Staff cannot adjust, edit, archive, invite or assign roles.
2. Deliver a real staff invitation. Accept it once; retry, revoke and expire test invitations and confirm denial. Test password recovery and logout in separate sessions. Confirm both hosting access and app membership are required. Do not put acceptance URLs or tokens in evidence screenshots.
3. Create an item with barcode zeros and private image. Try duplicate identifiers and invalid numerics. Receive at two locations, issue, return and transfer; inspect reason/user/time and exact location balances. Archive and confirm historical records remain and new stock movements fail. Try insufficient stock and verify no new movement or balance change.
4. Open independent admin/staff browser profiles. Withdraw the last unit simultaneously: one succeeds, one reports insufficient stock, and neither balance becomes negative. Double click and retry a response-lost movement unchanged; only one movement exists. Observe database-confirmed quantities on inventory, details and dashboard plus activity feed.
5. Preserve a search, location filter and sorting while another session posts. Disconnect one browser using Network Offline; posting must be disabled with a reconnect explanation. Post in the other profile, reconnect, and verify the current confirmed data and timestamp recover all missed changes. Navigate away and logout; inspect subscription cleanup and no further data delivery.
6. Start a physical count, save staff measurements, move the same item after its snapshot, then try approval. It must require reconciliation/recount, even if net stock returns to its original quantity. Approve the fresh count, inspect linked ledger adjustments, then retry approval and confirm no second batch.
7. Download both CSV templates. Try malformed quotes, missing fields, duplicate SKUs/barcodes, unknown/ambiguous locations, duplicate location rows and invalid numeric values. Confirm row errors, no overwrite, explicit checkbox/button confirmation and whole-file rollback. Retry a response-lost opening import; stock must not double. Test exports with `=`, `+`, `-`, `@`, leading spaces/tabs/newlines and embedded quotes. Inspect exported rows versus visible filters; staff/viewer files and service responses must contain no costs.
8. Deactivate a signed-in member in the other profile. With the old JWT, attempt table reads, stock RPCs, cost queries and realtime delivery. Deny all office data; the screen must clear on access recheck. A reset password must not restore membership.
9. At 360/390, 768 and 1280 px, inspect every page and dialog. No page-wide horizontal overflow; wide tables scroll independently. Open/close the mobile menu, select a route, scroll forms and confirm action controls are reachable. At keyboard only: skip link, visible focus, labeled controls, table scrolling, Tab/Shift-Tab containment, Escape close, focus return and disabled submission during saves. Use a screen reader for loading, error, success and dialog title announcements. Check 200% zoom. Focus must never reach the closed offscreen sidebar or inert dialog background.
10. Complete a hosted backup/restore drill from [OPERATIONS.md](OPERATIONS.md), including image bytes, preserved Auth UUIDs, access policies and restored service configuration. Record recovery point/time and reapply deactivations/role changes after the snapshot. Confirm approved office/VPN access and rejected unapproved origins if network isolation is required.

Release only after all applicable gates pass. Record any accepted limitation with the owner's explicit decision; do not treat missing configuration or unavailable browser tooling as a passed check.
