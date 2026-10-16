# Phase 3A — product-specific choice model

Local implementation, 2026-10-14 (Asia/Manila). The owner authorized disposable local database tests. The migration and regression fixtures have now been executed only in disposable PGlite databases; no Supabase connection or production SQL was used. Production installation remains subject to separate review/approval.

Audit correction: the checkout browser suite executed disposable local SQL before that permission arrived. Work was stopped and the mistake disclosed. Subsequent database testing proceeded after explicit owner authorization; the earlier “no SQL executed” statement is superseded by this record.

## Model

Add only `public.product_option_choice_policies(product_id, option_group_id, option_choice_id, is_enabled_for_product)`.

- Primary key: product + choice. Composite foreign keys bind the choice to its shared group and the group to the product assignment.
- No policy means inherit shared availability. Explicit false disables only that product's choice. True never enables a globally inactive choice, inactive group, or inactive assignment.
- No duplicate charge/default/selection-mode fields. Group identity and shared single/multiple behavior remain unchanged.
- RLS enabled, no API policies or direct API grants. The existing private save capability guards policy writes. Shared-library writes remain gated.

Reuse product assignments and defaults; reuse price overrides with NULL size for product charges and a size UUID for contextual charges; reuse override requirements and temperature compatibility.

## Single effective interpretation

`choice_allowed(product, choice)` is the eligibility predicate for readiness, engine, compatibility projection, and effective public choices. `effective_choice_price(product, size, choice)` applies size override → product override → shared charge. Missing mandatory overrides, ambiguous prices, or disabled choices return NULL, never zero. `choice_delta` retains its size/temperature validation and delegates price resolution. The engine retains its own existing cart cardinality, compatibility, and error contract.

`effective_product_choices(product)` is the private read used by the owner editor response and the narrow public read function. It returns unchanged choice/group UUIDs and display fields, effective product-level price, and `price_by_size`, a JSON object keyed by size UUID. Temperature compatibility remains a separate existing rule: a price entry does not authorize a temperature/size combination.

The public `public_menu_option_choices` view keeps its existing columns and appends `price_by_size`, delegating to a narrow SECURITY DEFINER read with explicit anon/authenticated EXECUTE and PUBLIC revoked. Products retain the existing published/available/not-archived projection. No private notes or policy rows are returned. Underlying policy/override tables gain no public access. Defaults remain in their existing projection: a disabled default becomes an unresolved default and fails closed, rather than silently becoming another choice.

The menu requests the appended field. When effective maps are present, selected-size prices replace the transitional included-milk and cheese calculations. Missing/null entries block ordering; they do not become free. Existing recipe-key validation, identity, quote, and submission contracts remain unchanged.

## Readiness and preservation

`catalog_structure` remains structure version 1 with an additive `choice_policies` member only when policy rows exist. The engine builds the exact same member through the same helper. Empty policy state contributes `{}`, so every existing snapshot remains byte-for-byte JSONB-equal. Explicit policies, even explicit true, change the snapshot and editor version. Existing charges/defaults/compatibility already participate in that snapshot.

Coverage counts only allowed choices and rejects a disabled default. An active set with no enabled choices is invalid: the current public renderer cannot render an empty set. Disable/remove the attachment in a future atomic save instead of leaving an empty active set.

Installation does not seed policies, reconfigure products, backfill, refresh certificates, or touch orders. A locked before/after comparison checks every existing product structure and certificate. The source inventory has 59 candidates, 24 active compatibility tuples, 17 active overrides, 17 active requirements, and 19 defaults. Static inventory checks are not proof of production or PostgreSQL runtime behavior.

## Phase 1 integration and later save contract

This draft adds the policy table to the existing save's locks, includes policies automatically in its existing editor-version hash, and returns `option_configuration` from the owner-only editor read. Phase 1's request allowlist, idempotency ledger, and mutations remain unchanged. It still rejects an `options` request until the later atomic writer is implemented. There is no separate browser policy-write API.

The next save extension should accept an optional `options` array of complete intended active attachments. Omitted means preserve; an empty array means explicit removal subject to recipe validation. Each entry should identify an existing group, required/minimum/maximum behavior, choice policies, defaults, temperature compatibility, and product/size charges. IDs and prices must be validated server-side; array order supplies display order. The browser must never submit a certification snapshot.

Required transaction sequence:

1. Authorize owner; validate bounds and exact request keys; lock all configuration sources including policies; resolve idempotent replay.
2. Check editor version and existing certification. Do not bless unrelated pre-existing drift.
3. Validate complete intended configuration, shared identities/selection mode, and the existing public product-specific recipe expectations. A database-valid set is not sufficient if the public recipe rejects it.
4. Reconcile stable size IDs. Require explicit complete coverage for added contextual sizes; never infer prices.
5. Reconcile assignments, policies, defaults, compatibility, overrides and requirements under the same product capability. Enforce ownership for both old and new row identities; never reparent another product's rows.
6. Validate effective coverage, refresh the authoritative snapshot internally, assert readiness for live saves, then record the replay result and commit. Any failure rolls back all product/configuration/certificate/ledger writes.

Removing/disabling a choice must also remove its default and deactivate/remove dependent active price/compatibility rows in that same intended save, or reject. Existing tuple/default/override IDs should survive unchanged values. Do not change shared choices to achieve a product-only edit.

## Gated behavior

- No Customer Options editor or options mutation API in this model phase.
- No shared-library edits, group cloning, new semantic keys, per-product selection mode, or generic non-temperature compatibility.
- No inferred CURV recipes or changed approved defaults/prices.
- Phase 3B still needs the complete atomic options writer and its rollback/concurrency tests before owner editing can be enabled.
- POS is not integrated with product-specific policies in this phase. Keep policy editing disabled for products sold through POS until its separate reader is reviewed; do not claim POS effective-choice support.

## Migration and rollout gates

The first-application draft checks reviewed function bodies/owners/search paths and the reviewed public choice-view definition; unexpected drift aborts. It uses one BEGIN/COMMIT, 5-second lock timeout, 60-second statement timeout, catalog locks, explicit RLS/ACL, and preservation postflight. Existing function owner/grants are retained by replacement; no checkout RPC is replaced.

Local verification completed:

- Phase 3A static/source/inventory checks: 95 assertions.
- Phase 3A database behavior/security/rollback checks: 44 assertions.
- Reviewed 59-product database snapshot replay: 185 assertions. Every product retains its exact before/after catalog structure and certificate; all 59 remain ready and return identical authoritative quotes. Counts remain 117 assignments, 19 defaults, 24 temperature tuples, 17 overrides, and 17 requirements. Anonymous effective reads succeed.
- Effective-price browser checks: 12 assertions, including size changes, missing-price rejection and responsive widths.
- Existing Menu Manager checks: 200 assertions; pricing/model/preview/submission checks: 524; checkout browser/assets: 136; public-menu regressions: 4,462. Total distinct current-suite assertions: 5,658.
- JavaScript syntax and `git diff --check` passed.

These are local snapshot/fixture results, not a fresh production audit or native PostgreSQL concurrency proof. Before production approval, inspect the actual deployed prerequisite definitions/ACLs against this first-run preflight and review representative query performance. The Phase 3B writer and its concurrency acceptance remain gated.

Future reviewed deployment order: backend model first, then the public-menu consumer, verify representative quotes, and only later enable a separately tested atomic options writer. Old frontend consumers cannot represent per-size policy changes safely, so policy writes must stay gated during this transition. Do not rerun after any failure without review. No automatic production commands are supplied here.
