# Phase 3B — local implementation review

Status: resumed Phase 3B implementation completed and locally verified, 2026-10-16 (Asia/Manila).
No production connection, migration execution, deployment, commit or push was performed.
Phase 3A is the owner-confirmed production baseline. Phase 3B SQL remains a review draft.

## Resume audit and completed gaps

Existing local work already contained the atomic writer, inline editor, reconciliation, inventory
replay and a native concurrency harness. It was retained rather than rebuilt. This pass completed:

- Recipe-filtered existing-set selection from the same owner-only backend recipe contract, including
  semantic alias deduplication, product renames, UUID precedence and pending name edits.
- Friendly pre-save validation for prohibited/missing sets, disabled/missing defaults, insufficient
  choices, unavailable Temperature sizes and incomplete per-size charges. Server validation remains authoritative.
  Initial hidden drafts with unchanged/omitted options can save their first sizes; publishing still requires
  the complete recipe. Backend and browser tests cover this two-step contextual-size workflow.
- Server rejection of an enabled Temperature with no usable serving size, with full rollback.
- Exact source/security/configuration guards for six additional Phase 3A helpers, locked catalog/ledger
  preservation snapshots, and postflight checks preserving endpoint ownership, ACLs, security and checkout definitions.
- Real overlapping same-key retries in addition to stale-editor concurrency; expanded initial-install drift,
  rollback, cross-product ownership, default identity, unchanged-option and browser acceptance tests.

## Save contract

The existing owner-only `public.menu_manager_save_product(p_request jsonb)` accepts optional `options`:

- Omitted: preserve current option configuration.
- `[]`: explicitly remove assignments, subject to recipe validation.
- Array: complete intended active configuration. Each group carries `option_group_id`,
  `is_required`, `min_selections`, `max_selections`, `choices`, and `compatibility`.
- Each choice carries `option_choice_id`, `enabled`, `default`, `product_price_delta`
  (null means shared fallback), and `price_by_size` (existing size UUID to explicit amount).
- Compatibility maps existing size UUIDs to enabled Temperature choice UUIDs.
- Existing request ID, expected version, action, product and sizes remain part of the same request.
  No browser-supplied certification, readiness flag or structure snapshot is accepted.

The owner editor read adds `options_version: 1`, editable options and an existing-set library.
The response also includes `option_recipes`, sourced directly from the backend recipe validator.
A null product ID loads that library for creation. Its opaque version is required when creating
a product with options. Existing-product versions include the shared library as well as the
complete product configuration, preventing stale option-library edits from being accepted.

## Transaction and validation

The existing Save authorizes the owner, locks configuration sources, checks replay/version,
saves product and sizes, reconciles options, validates recipe and coverage, refreshes readiness,
and records the request result. Every failure rolls back the complete operation.

Assignment IDs and existing override/requirement IDs are reused. Removing a group deactivates
its assignment and contextual dependencies and removes defaults. Disabling a choice records
its product policy and retires its default and contextual dependencies. Re-enabling cannot
silently discard remembered required prices. Shared groups and choices are never changed.

Validation rejects duplicate groups/choices and semantic aliases, reserved panel keys,
foreign group/choice/size IDs, unavailable shared choices, invalid rules/defaults, incomplete
Temperature coverage and missing contextual prices. Known Takoyaki Add Cheese prices require
explicit size coverage; no amounts are inferred. Reviewed public recipes are frozen in the
backend and statically compared with all 43 public approved rows and 14 Matcha recipe entries.

Ordinary product-specific charges may return to the shared price by clearing the override.
Required contextual charges may not silently fall back. Complete per-size pricing is required
when using a per-size schedule. Public effective-choice reads and authoritative pricing continue
to use the Phase 3A resolution path.

Published products must pass coverage and readiness before commit. Draft option edits still
receive recipe/coverage validation, but saving a draft does not publish it. Unedited drafts
retain the existing Phase 1 behavior. Pre-existing uncertified option drift is not silently blessed.

Same request ID and identical payload replay the original response; changed payloads are rejected.
The native test uses two independent overlapping PostgreSQL sessions, observes actual lock waiting,
and verifies stale rejection, preservation of the winner, and replay without another ledger row.

## Editor

Customer Options cards show required/optional state, defaults, available choices and charges.
Edit opens a focused inline panel. Add uses existing sets only. All changes stay in the draft
until the main Save; there is no separate browser option-write RPC or direct table mutation.
Required state, defaults, availability, product charges, per-size charges and Temperature/size
checkboxes are supported. Failed saves retain the draft and display mapped human-readable errors.
The new selector uses existing field styling. Light/dark overflow checks cover 320/390/768/1280px.

Still gated: shared library changes, shared choice labels/values, new keys, per-product selection
mode, mass updates, and adding/removing sizes already tied to contextual configuration. For a new
product, save ordinary draft sizes first before configuring size-specific options. This retains
the reviewed Phase 1 safety boundary rather than guessing new size identities or contextual prices.

## Verification

| Suite (`tests/*.cjs`) | Assertions/checks passed |
|---|---:|
| menu-manager-options-writer-static | 75 |
| menu-manager-options-writer-preflight | 12 |
| menu-manager-options-writer-database | 69 |
| menu-manager-options-writer-inventory | 364 |
| menu-manager-options-writer-browser | 44 |
| menu-manager-options-writer-concurrency | 14 |
| menu-manager-product-save-static | 46 |
| menu-manager-product-save-database | 75 |
| menu-manager-product-save-browser | 13 |
| menu-manager-product-editor-browser | 66 |
| menu-manager-option-policies-static | 95 |
| menu-manager-option-policies-database | 44 |
| menu-manager-option-policies-inventory | 185 |
| menu-manager-auth-browser | 24 |
| menu-manager-options-browser | 18 |
| menu-manager-sections-browser | 21 |
| menu-manager-option-delete-static | 42 |
| product-image-upload | 49 |
| public-menu-renderers | 813 |
| public-menu-item-panels | 45 |
| public-menu-geometry | 3450 |
| public-menu-option-bridge | 39 |
| public-menu-options-hydration | 49 |
| public-menu-customize-browser | 66 |
| public-menu-effective-choices-browser | 12 |
| public-checkout-browser | 65 |
| public-checkout-assets | 71 |
| public-pricing-model | 92 |
| public-pricing-engine | 122 |
| public-pricing-preview | 148 |
| public-submission-foundation | 134 |
| public-submission-v2 | 162 |
| pos-schema-preflight | 11 |
| pos-database | 51 |
| pos-core | 11 |
| pos-browser | 13 |
| pos-kitchen-database | 45 |
| pos-kitchen-browser | 28 |
| pos-customer-print | 29 |
| pos-customer-print-browser | 20 |

Total: 6732 assertions/checks across 40 suites.

All 59 reviewed product structures remain exactly unchanged with options omitted. All 59 quotes
remain unchanged after both omitted and complete round-trip saves. All 19 defaults and their IDs
remain unchanged, along with 117 assignments, 24 temperature tuples, 17 overrides and 17 requirements.
New writer tests exercise updated effective charges, quote success and a local v2 submission.

Native concurrency used the existing portable PostgreSQL runtime in a new disposable loopback cluster
on D:. The installed Windows command-line distribution lacks postgres.bki and could not initialize
its own cluster; no test was substituted for genuine concurrency. Final native evidence is at
D:\curv-phase3b-tests\curv-product-save-0ARzW8. The cluster was shut down after testing.

Browser network traffic was intercepted. Responsive light/dark checks cover 320/390/768/1280px;
light 320px and dark 1280px screenshots were also inspected. Test evidence lives outside the repo at
D:\curv-phase3b-tests\visuals\phase3b-resume. No test result dumps are added to Git.

POS tests are regression checks, not proof of a new POS effective-option reader. Phase 3B does not
integrate POS with product-specific option policies; review that consumer separately before relying
on product-specific changes in POS. Physical printer output is not part of this acceptance.

JavaScript/inline syntax and git diff --check passed. No staged files, commit, push or deployment.

## Production review boundary

No new owner recipe or price decisions are needed for this scope. Review the exact migration and
perform owner browser acceptance before approving production rollout. Installation requires the
reviewed Phase 3A/Phase 1 function sources and matching ownership; it aborts on collisions/drift.
The migration has one BEGIN/COMMIT, a 5-second lock timeout and a 60-second statement timeout.
Installation locks configuration sources and the save ledger for preservation checks. These short
write-blocking locks permit normal reads but can delay owner edits; use a quiet maintenance window.
Runtime saves retain the short configuration-table locks and 3-second lock timeout from Phase 1;
they do not lock order tables. The shared library version deliberately rejects stale editors after
any library change. Install the reviewed backend before exposing the new editor. Do not rerun
a successful installation automatically. Public checkout contracts and frontend aliases remain intact.
