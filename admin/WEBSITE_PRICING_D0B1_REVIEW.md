# D0B1 data/model finalization — local draft

No live database was contacted. Strict v2 pricing is not active. Submission,
tracking, frontend, customer linking, payments and structured dine-in timing are
unchanged. This is a model prerequisite, not an authoritative checkout engine.

## Draft migration order

1. Existing C1B and structured dine-in timing baseline.
2. Revised `WEBSITE_CONFIGURATION_D0A1_SCHEMA.sql` (D0A.1 is local-only).
3. `WEBSITE_PRICING_D0B1_SCHEMA.sql`.

Both drafts are transactional and deliberately reject reapplication/collisions.
If any D0A.1 objects already exist in the intended deployment, STOP: export and
review their definitions and prepare a separately reviewed upgrade. Do not drop
populated tables or bypass preflight. No production identifiers or catalog seeds
are included here.

## Availability

The public compatibility projection now requires published AND available AND
not sold out AND not archived, as does the new runtime readiness gate.
Only active assigned temperature choices and active tuples are projected. The
private `choice_delta` helper is a model-level component, not a purchasability
gate: the future engine must call `assert_pricing_ready` in the same database
snapshot before pricing. Certification may be prepared for unpublished products;
that does not make them purchasable.

## Readiness and coverage

`configuration_private.product_pricing_certifications` stores one reviewed
canonical JSONB structure per product, a structure version, review note, database
session identity and timestamp. It is private, with no public certification API.
Full JSONB comparison avoids hash dependencies and keeps the review inspectable.

The structure includes all sizes, assigned groups and selection rules, choices,
defaults, compatibility tuples, explicit override requirements and overrides.
Arrays have stable identifier ordering; JSONB object key order is irrelevant.
Inactive rows are included conservatively. There is no inferred readiness flag.

Operator workflow, for a future separately approved configuration population:

1. Inspect a product's candidate structure from `catalog_structure(uuid)`.
2. Compare it with the recipe/product inventory: exact expected groups, required
   counts/defaults, available size IDs, temperature applicability, allowed pairs,
   and which choices require product or exact-size prices. Review zero-group
   products explicitly as intentionally having no options.
3. Supply that independently reviewed JSONB document and a review note to
   `certify_product(uuid,jsonb,text)`. It verifies coverage and equality before
   storing the certificate. Do not bulk certify the current catalog unchecked.
4. Every future quote/submission must call `assert_pricing_ready(uuid)` alongside
   pricing in a consistent snapshot. It checks availability, exact structure
   equality and coverage. Merely finding a certificate row is insufficient.

Deleting an assignment, default, requirement or compatibility tuple; adding a
size/choice; changing rules/activity/overrides all makes comparison fail. Included
row fields also mean price, label and size-cost changes conservatively require
review again. Product availability is checked independently rather than included
in certification, so temporary sold-out toggles do not require recertification.
No catalog mutation triggers are needed; comparison is the invalidation rule.
The future engine must not cache a readiness boolean across transactions.

Coverage validates sizes and currency bounds, active group cardinality, sufficient
active choices, valid default counts/assignments, temperature applicability and a
valid tuple for every size, and required override presence. Required group
certification currently requires defaults covering its effective minimum; a
required group intended to start without a default needs explicit policy review
before certification, not an invented default. Each temperature group is required
single-select. A default temperature can be size-incompatible (e.g. ICED default
with a HOT-only size); the UI/engine must use that size's allowed tuple and must
validate the customer's actual choice. Certification does not auto-select it.

The database cannot infer an omitted recipe requirement from an already
incomplete initial catalog. Initial certification is an explicit trusted review
of expected configuration. No production products have been certified here.

## Contextual requirements and precedence

`product_option_choice_override_requirements` explicitly declares product scope
(NULL size) or exact-size scope (non-NULL size). The scope/pair CHECK, ownership
FKs, active assignment trigger and partial unique indexes enforce its shape.

Product-scope requirements demand an active product-level rule. Size-scope
requirements demand an active rule for that exact size; a product rule cannot
substitute. If both requirements exist, both must be satisfied. Once requirements
are met, effective pricing remains size override > product override > base delta.
Ordinary choices with no requirement may use the base delta.

Included Oat/Breve/Coconut use explicit product-level zero-price rules plus
product-level requirements. Cheese uses an exact-size requirement/rule per
4/8/12-piece size row (30/60/90 fixture values). None is inferred from names,
default selection, zero prices or mutable labels. Real IDs need human review.

Same-specificity active duplicates are impossible under partial unique indexes.
The private helper additionally rejects duplicate matches if those protections
are ever lost. Currency is finite, nonnegative, at most 999999.99 and exactly
representable to two decimals; invalid precision is rejected, not rounded away.

## Temperature compatibility

`product_size_option_choice_compatibility` authorizes explicit product/size/choice
triples. An active tuple must refer to an active assigned temperature choice.
Composite size/product FKs prevent cross-product sizes. Distinct HOT 12oz, ICED
Regular and ICED Large size/choice identities are exercised in fixtures. No code
uses display labels to authorize combinations. Missing HOT/Large authorization
fails; non-temperature products require no temperature tuples.

## Order metadata and snapshot contract

All added columns have NULL defaults and no backfill:

| Object | Field | Type / meaning |
|---|---|---|
| orders | pricing_contract_version | smallint, NULL/1 legacy, 2 future contract |
| orders | pricing_policy_version | text, per-order pricing policy |
| orders | pricing_fingerprint_version | smallint, 1 = planned review fingerprint format |
| orders | accepted_review_fingerprint | text, lowercase 64-character SHA-256 hex for v2 |
| orders | priced_at | timestamptz, finite pricing checkpoint for v2 |
| orders | submission_fingerprint_version | smallint, NULL/1 legacy, 2 future canonical intent |
| order_items | pricing_configuration_snapshot | JSONB, independently versioned line configuration |

`pricing_contract_version=2` requires complete policy/review/time/submission
metadata and an existing submission key/fingerprint. NULL/1 legacy orders remain
valid. The current RPC writes none of these fields. Version 2 is not enabled by
adding the columns.

Example future line snapshot:

```json
{
  "contract_version": 2,
  "pricing_policy_version": "curv-cart-v2.1",
  "product_id": "00000000-0000-4000-8000-000000000030",
  "product_size_id": "00000000-0000-4000-8000-000000000040",
  "option_choice_ids": ["00000000-0000-4000-8000-000000000060"],
  "options": [{
    "group_id": "00000000-0000-4000-8000-000000000050",
    "choice_id": "00000000-0000-4000-8000-000000000060",
    "group_name": "Milk",
    "label": "Oat",
    "effective_price_delta": 0
  }]
}
```

Snapshot shape, UUIDs, duplicate IDs, option/ID agreement and effective money are
validated by an immutable helper invoked by a narrowly scoped trigger. The
trigger is SECURITY DEFINER so existing ordinary authorized table writers do not
need new access to the private schema. It only validates NEW; it does not query
customer/catalog data or mutate other rows. All direct helper execution is denied
to anon/authenticated. Nullable existing writes continue normally.

Existing readable `options`, product/variant labels, quantity, unit/line totals
remain unchanged. JSON IDs have no catalog FK/cascade; historical snapshots
survive catalog edits/deletion. Per-line policy permits future mixed-version
amendments. Future backend code must construct this snapshot from server data,
keep physical snapshot fields/totals consistent, and require it for new v2 lines.
This phase intentionally does not add cross-table v2 submission enforcement.

## Fingerprint and rollback compatibility

NULL/1 submission version retains the exact current raw payload minus key hash.
Version 2 will identify canonical customer/order intent with stable configuration
IDs, quantities and notes, excluding display/money/review fields. This phase adds
only metadata: no hash computation or replay branch changes.

Current backend can continue operating with these nullable additions. Before v2
writes exist, rollback can simply leave additive objects unused. Do not drop
populated snapshots/certifications to roll back application code. After a future
v2 rollout, retain a version-aware replay reader; rolling back to a v1-only
backend would not safely interpret stored v2 intent fingerprints.

## Preflight and security

Drafts check required roles, typed columns, object/function/type/index collisions,
baseline keys/constraints, timing and idempotency infrastructure and valid/ready
unique index shapes. Unexpected existing columns are rejected even if their type
looks compatible. This prevents accidental adoption of unreviewed earlier drafts.
All new order columns must be absent, hence existing rows receive NULL and cannot
violate the new conditional constraints. No historical mutation is required.
Every failing migration rolls back all DDL. No CREATE OR REPLACE or destructive
replacement is used in these drafts.

All pricing/requirement tables use RLS with no public policies/grants. Private
schema usage and helper execution are revoked from PUBLIC, anon, authenticated.
The existing narrow public compatibility RPC remains the only public model read,
returning product_id, product_size_id, option_choice_id, is_active. No contextual
price, certification, recipe or internal notes are exposed.

## Index review

Existing `(id,product_id)` size uniqueness supports ownership FKs. Partial unique
override/requirement indexes enforce active product/choice and product/size/choice
rules. Full `(product_id,product_size_id)` indexes cover inactive as well as active
FK maintenance; choice indexes support reverse choice maintenance. Compatibility
PK `(product_id,product_size_id,option_choice_id)` covers product/size lookup; a
choice index covers the reverse FK. Certification PK covers runtime product
lookup. Existing group/default product indexes support coverage extraction.
No speculative order-history, JSONB GIN or quote indexes are added.
Production scale/plans are unmeasured. D0B3 must measure the set-based pricing
query, rather than assume these single-product validation helpers are a complete
bulk engine.

## Remaining gates

No local D0B2 model blocker. Production rollout remains unapproved. Required later:
review actual product/size/group/choice IDs; populate exact inclusion and cheese
requirements/overrides; verify all temperature combinations; review and certify
intentionally zero-group products; review draft collisions, ownership/default
privileges and production migration locks; approve cart quantity/technical caps.
D0B2 should implement version-aware canonicalization/replay foundations locally,
preserving current public submission until a later explicit enforcement gate.

Operationally, additive order columns/constraints and the item trigger require
table locks during migration; D0A.1 also builds indexes and adds size uniqueness.
These drafts have only been executed in disposable local databases. Production
lock duration, existing data and concurrent activity require separate review.
