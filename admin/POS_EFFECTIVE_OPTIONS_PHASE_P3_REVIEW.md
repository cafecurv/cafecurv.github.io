# POS effective options compatibility — local review draft

Status: POS EFFECTIVE OPTIONS DATABASE ACCEPTANCE PASSED (2026-10-17, Asia/Manila). Ready for owner migration review and coordinated rollout; nothing deployed by this task.
No production connection, production SQL execution, deployment, commit, or push occurred. The owner explicitly authorized disposable local SQL acceptance.
Fresh PGlite fixtures exercised PostgreSQL migration/runtime behavior. A fresh native PostgreSQL cluster bound only to 127.0.0.1 exercised independent overlapping psql transactions. No production credentials or connection environment were used.

## Scope and review files

- `admin/POS_EFFECTIVE_OPTIONS_PHASE_P3.sql`: first-application replacement of `public.pos_get_catalog()` and `pos_private.resolve_line(uuid,uuid[])` only.
- `admin/pos.js`: additive effective catalog interpretation and current-size selection/price validation.
- `tests/pos-effective-options-data.cjs`: synthetic offline browser catalog.
- `tests/pos-effective-options-core.cjs`: pure contract and migration source/static checks.
- `tests/pos-effective-options-browser.cjs`: actual POS UI with intercepted mock transport.
- `tests/pos-effective-options-database.cjs`: disposable database integration/history/security test.

Additional acceptance suites: `tests/pos-effective-options-preflight.cjs`, `tests/pos-effective-options-parity.cjs`, and `tests/pos-effective-options-concurrency.cjs`. Pre-existing Phase 3B files were not modified. No application or migration correction was required by acceptance.

## Backend draft

Single BEGIN/COMMIT; local lock_timeout 5s, statement_timeout 60s during installation. First-application source hashes check both original P1A functions and Phase 3A effective helpers plus the Phase 3B reconciliation helper. Executing role must own these functions. Unexpected source/ownership/security drift aborts; successful reapplication also aborts. Hashes normalize whitespace only; do not override a mismatch without reviewing the deployed source.

CREATE OR REPLACE retains existing function OIDs/owner/ACL. Postflight compares those and SECURITY DEFINER/search_path/volatility, plus the existing public quote/submission function definitions. No new grants or mutation RPCs. No persistent table writes, catalog backfill, certification writes, or order changes at installation. A temporary security-baseline table is used only inside the transaction.

Catalog reads retain POS visibility (available, unarchived, active category; unpublished counter products are still eligible), not public-menu visibility. Effective choices come from the existing Phase 3A helper, so product-disabled choices are omitted and a product TRUE policy cannot resurrect an inactive shared choice.

At resolution, catalog tables are SHARE locked in the product-save writer's relative order, covering absent policy/override rows as well as existing rows. Catalog saves can briefly wait while a POS line is resolved. Existing POS command order locks, auth, revision checks, lifecycle checks and replay handling are unchanged. Both runtime lock directions passed independent-session validation. Installation timeout settings are not runtime function timeout settings. A caller-configured 100ms lock timeout was separately verified to return SQLSTATE 55P03 and persist no partial order.

`validate_product_coverage` rejects broken defaults/coverage. Selected choices must belong to active product assignments and be allowed. Temperature must have an active size tuple. The existing effective price helper supplies size override > product override > shared price. Missing contextual coverage, nonfinite/out-of-range/fractional-cent prices fail closed. Snapshot fields contain these resolved effective prices.

## Additive catalog fields

Existing product/group/choice names and IDs remain.

- Product `effective_options_version: 1` identifies the new contract.
- Product `configuration_valid` is false for an ineffective configured default. This is not a complete readiness certificate; server coverage validation is authoritative.
- Product `temperature_compatibility`: array of `{size_id, choice_id}` active effective tuples.
- Choice `price_by_size`: size UUID to authoritative effective numeric charge, or null for missing coverage.
- Existing `price_delta` remains the product-level charge; it must not substitute for a missing size price in version 1.

The browser uses the selected size map, disables incompatible choices and clears checked incompatible temperatures. It does not invent a replacement default; the cashier chooses a valid required option. The Add action remains blocked until valid. Legacy unversioned responses remain understood for old fixtures/transition, but do not provide Phase 3B safety: install reviewed backend before frontend and refresh all POS sessions before using the Phase 3B editor.

## History and security boundaries

Only new-line creation/addition and intentional reconfiguration call the replaced resolver. Quantity/note edits still use saved unit prices. No changes to held-order reads, kitchen snapshots, kitchen reprint payloads, Order Copy renderers, actor/auth functions, command dispatch, website isolation, or idempotency code. Migration draft does not reprice saved lines. Disposable tests verified saved item snapshots, held-order prices, kitchen reprints and Order Copy item prices/totals after later catalog edits. Explicit reconfiguration uses the new effective price.

## Checks executed for this acceptance

| Suite (tests/*.cjs) | Passed assertions/checks |
|---|---:|
| pos-effective-options-core | 39 |
| pos-effective-options-browser | 17 |
| pos-effective-options-database | 48 |
| pos-effective-options-preflight | 26 |
| pos-effective-options-parity | 24 |
| pos-effective-options-concurrency | 13 |
| pos-schema-preflight | 11 |
| pos-database | 51 |
| pos-core | 11 |
| pos-browser | 13 |
| pos-kitchen-database | 45 |
| pos-kitchen-browser | 28 |
| pos-customer-print | 29 |
| pos-customer-print-browser | 20 |
| public-pricing-model | 92 |
| public-pricing-preflight | 28 |
| public-pricing-engine | 122 |
| public-pricing-engine-preflight | 17 |
| public-pricing-preview | 148 |
| public-pricing-preview-preflight | 39 |
| public-submission-v2 | 162 |
| public-submission-v2-preflight | 21 |
| public-submission-v2-consumers | 14 |
| public-checkout-browser | 65 |
| public-menu-effective-choices-browser | 12 |
| public-menu-renderers | 813 |
| public-menu-item-panels | 45 |
| public-menu-geometry | 3450 |
| public-checkout-assets | 71 |
| Total (29 suites; repeated runs counted once) | 5574 |

New effective-options acceptance: 167 checks. Existing POS regression: 208 checks. Public pricing/submission/effective-choice regression: 820 checks. Public menu/assets: 4379 checks.

All POS effective-options CJS files and admin/pos.js pass node --check. Two inline POS/public-menu scripts parse. git diff --check passes. Browser requests were intercepted; no live services were contacted. Physical printers were not tested.

## Acceptance evidence

- First migration installation passed both embedded and native PostgreSQL; native output reached COMMIT. Second application rejected with POS_EFFECTIVE_PREREQUISITE and rolled back.
- Deliberately changed source, owner, SECURITY DEFINER mode, search_path and missing helper each aborted without partial function replacement or historical writes. Security metadata/ACLs preserved; public quote and submission definitions unchanged.
- Nonempty pre-install order/kitchen history and catalog structures unchanged by installation.
- Product override, size override, shared fallback and simultaneous product/size overrides verified. Required size coverage cannot fall back to a product override when the required size override is absent.
- Real POS browser displayed the same totals as PostgreSQL resolution: shared drink 125, included-Oat product override 100, contextual Takoyaki sizes 130/240/340, compatible Hot drink 90. Size changes update charges; incompatible default is cleared and both browser and server block it.
- Genuine independent sessions: POS waits for an owner save, then resolves at committed charge 21 (total 121); catalog reads while the writer is open still see committed charge 25. In the reverse direction, the owner save waits for POS, then commits charge 22; saved POS totals remain 121. Both directions finish without deadlock.
- A blocked POS call with 100ms lock_timeout returns expected 55P03, leaves no order, and the rolled-back writer leaks no price change. Native migration held zero locks on orders/order_items.
- Native evidence retained at D:/curv-phase3b-tests/curv-pos-effective-S1YZUr. The disposable server was stopped in finally cleanup.

## Rollout recommendation

No local acceptance blocker remains. POS is technically compatible with the Phase 3B editor once this reviewed backend and matching POS frontend are deployed together and POS sessions refreshed. It is not fixed in production merely because local tests passed.

Owner review still required for POS_EFFECTIVE_OPTIONS_PHASE_P3.sql and admin/pos.js. Deploy the reviewed migration first, matching POS frontend second, refresh all active POS sessions, verify representative product/size/temperature selections and historical reprints, then enable/deploy the Phase 3B editor. Existing unversioned/old POS clients cannot preview contextual charges correctly; avoid using them during cutover. Do not weaken deployed-source drift guards or rerun blindly.

Runtime catalog SHARE locks can briefly delay owner saves and vice versa. The tested schedules establish controlled behavior for those scenarios, not a claim that every possible external writer is deadlock-free. Production drift is intentionally checked at installation, not inferred from local results.
