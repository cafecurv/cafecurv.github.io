# CURV Kiosk V2 — local review draft

Not deployed, enrolled or activated. `config.js` is disabled and both migration drafts install with kiosk mode off. The `?kiosk=1` URL selects the interface only; it grants no authority.

## Customer flow

Nickname (1–80 Unicode characters, trimmed, control characters rejected), FOR HERE (`dine_in`) or TO GO (`pickup`), existing menu/options/cart, authoritative review, counter/unpaid order, confirmed server number, Done / New Customer. No phone/email/address or saved customer profile is requested. Actual absence is stored as the existing empty-phone representation, with no fabricated number.

The public checkout controller and v1/v2 canonicalizers are unchanged. Kiosk uses its own contract, device Auth client and session-storage keys. Do not replace public checkout with the kiosk RPC.

## Draft installation dependencies

Review `admin/KIOSK_V2_SCHEMA.sql`, followed by `admin/KIOSK_V2_BACKEND.sql`, against the actual installed schema before any separately approved installation. They depend on the existing public submission foundation/v2, authoritative product configuration pricing, POS authorization helpers, Auth sessions and D1-compatible orders schema. Historical migrations are untouched. The shared pricing metadata constraint is widened additively for submission fingerprint version 3; a deferred trigger requires trusted kiosk provenance. Existing versions 1/2 and their fingerprints remain unchanged.

The backend exposes narrow context, begin, quote, admit, submit, confirm-price, recover and close RPCs. No client receives raw private-table access. New SECURITY DEFINER functions pin search_path. Every device operation checks a live nonstaff principal, live Auth session, allowlist, device lease and mode. A device may submit only its current generation's frozen request. Global order-key uniqueness remains enforced by the existing unique index; shared v2/D1 advisory locks are reused, while legacy-v1 races are handled by the unique index and atomic rollback.

## Provisioning and revocation (requires separate approval)

Use a dedicated nonstaff Auth identity in a clean managed kiosk profile. Never sign the kiosk into an owner/staff account. Owner-only device approval rejects admin/POS membership, limits each lease to 24 hours and can revoke or drain immediately. Renewal is an explicit owner action. Setup uses the dedicated identity's password; it stores no password and embeds no privileged key. Only a public project URL/publishable key belongs in `config.js`. Device tokens use the separate `curv-kiosk-v2:device-auth` session-storage key, never URL parameters.

`kiosk_owner_device`, `kiosk_owner_mode`, `kiosk_owner_recover` and `kiosk_owner_provenance` require the existing owner check plus a live owner Auth session. There is no public owner setup/recovery UI. No provisioning, activation or production commands are supplied by this draft.

Already admitted transactions hold shared device/mode locks: revocation waits for them, then blocks subsequent calls. Drain blocks new admission but permits existing admitted attempts to finish. Off, expired lease, deleted Auth session and revocation deny device recovery too; owner-assisted verification is then required. JWT expiry alone is not revocation.

## Privacy and recovery

One customer tab is enforced with Web Locks; unsupported browsers fail closed. Draft nickname/cart remain in memory. Reload resets an unsubmitted draft. Two-minute draft inactivity closes it only when the server verifies no admitted attempt exists. Tab hiding masks and scrubs customer UI; return revalidates server state. Back/page restoration is masked and revalidated. This favors privacy over preserving an abandoned draft.

Before admission, the exact request/key is stored in kiosk-only session storage. Timeout, lost response, signout, revoked access or corrupt storage never silently discard it or invent success. Retry is explicit and retains its key/body. Known price changes require another authoritative review with the same intent/key. Accepted replay happens before repricing or the ordering gate. Server generation state permits recovery after tab loss without returning the saved personal request. Old keys cannot retrieve closed receipts.

Verified acceptance strips the frozen personal body, retaining a minimal recovery pointer. Done or 60 seconds of success inactivity first verifies server closure, then clears only kiosk customer state and replaces the page. Device Auth is retained. Failed cleanup locks the tablet. Unresolved attempts cannot be reset; catalog removal or a permanently invalid admitted attempt needs owner investigation and a separately designed audited resolution path. No speculative deletion is provided.

## Security and operational limits

Browser-readable device tokens can be stolen by same-origin script, extensions or physical compromise and used remotely until live revocation/lease expiry. HttpOnly credentials would reduce extraction but not same-origin script abuse. Use a clean managed profile, restricted navigation/extensions and physical kiosk controls; this application does not implement OS lock-down. An authenticated device inherits existing public/authenticated APIs, including the intentionally public staff-name picker and public checkout. It receives no admin membership; least-privilege tests must be rerun against the effective target grants before activation. The disposable schema is not proof of production permissions.

Nickname and order number appear in existing Incoming Orders as website orders with counter/unpaid state. Immutable provenance is stored privately and available through an owner-only lookup; no new admin badge is implemented. D1/P5 presentation and lifecycle sources are untouched; their separate release blockers remain.

## Maintained local tests

`tests/public-kiosk-browser.cjs` runs the V2 browser suite; `tests/public-kiosk-v2-browser.cjs` is its implementation. `tests/public-kiosk-incoming-integration.cjs` uses disposable SQL plus the existing Incoming Orders UI. `tests/kiosk-v2-real-auth.cjs` uses real GoTrue JWTs and PostgREST in newly labelled local Docker containers with loopback ports and a temporary database. It removes only its own resources and verifies preservation of existing containers/volumes. Dependencies: Node, Playwright/Edge, pg, PGlite and cached Supabase Docker images. No real orders are submitted.

Before tablet use: independent migration/security QA, effective-grant verification, approved project configuration/provisioning, portrait/landscape touch/keyboard and accessibility checks, real sleep/wake/BFCache and network-loss tests, operational owner recovery runbook and separate deployment/activation approval.

## Rollback boundary

First drain admitted attempts, verify uncertain outcomes with an owner, disable kiosk and revoke the dedicated identity. Keep accepted orders, provenance and version-3 constraint support; dropping them would invalidate historical kiosk rows. Restoring public assets does not require rewriting historical checkout. Removing the additive schema requires a separately reviewed data-retention migration, not an automated rollback in this task.

## Isolated release candidate

Based on the verified 79e8ff59cc978da586f311f1d392d145f2d14cf1 public-menu hotfix. No new D1/P5 code or migrations are introduced. Existing production Incoming Orders and tracking files are byte-identical to that base. Public checkout behavior is retained; only its matched asset marker changes to 2026-10-28.2. Both menu and setup pin Supabase JS 2.118.0 with the verified SRI digest. Ordinary fulfillment defaults/choices are preserved exactly from the production base (Dine In is the selected markup default).

SQL drafts remain disabled and byte-identical to the previously reviewed integration. Production namespace/grants, metadata constraint definition, catalog and operator recovery remain separate approval gates. See RELEASE_READINESS.md; no production SQL or provisioning is authorized by these files.
