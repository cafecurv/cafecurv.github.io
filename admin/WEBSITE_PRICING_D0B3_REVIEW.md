# D0B3 private authoritative pricing engine

Local-only acceptance. No live Supabase, production SQL, deployment, commit or push.
Current public submission/frontend prices, structured dine-in timing, customer
linking, tracking, POS and kitchen behavior remain unchanged. This is not a live
price-tampering fix until a later approved submission integration.

## Entry point and migration

`configuration_private.price_order_configuration(p_items jsonb) returns jsonb`

STABLE, SECURITY INVOKER, pinned `search_path=pg_catalog`, no dynamic SQL. It reads
only catalog/configuration/certification data; it writes no order, customer,
payment, inventory, sequence or reservation state. There is no public wrapper.
Anon and ordinary authenticated users have neither private schema access nor
execution privileges. No table privileges or existing functions are replaced.

The draft is `WEBSITE_PRICING_D0B3_ENGINE.sql`, after revised D0A.1, D0B1 and D0B2.
Preflight verifies typed dependencies, helper names, roles and valid/ready unique
indexes. Any overload colliding with one of the three new helper names aborts.
The transaction prevents partial installation; reapplication stops for review.
Tests verify unchanged submission/tracking/customer-link definitions and ACLs.

## Input and structural validation

Input is a nonempty array of objects with product_id, product_size_id,
option_choice_ids, quantity and optional item_note. There are no customer,
fulfillment, submission-key, time, payment or complete-order requirements.

- Maximum serialized JSONB input: 256 KiB; 1–30 raw lines; 64 choices per line.
- UUIDs must parse; each ID is cast once into typed rows/arrays.
- Quantity: positive integral JSON number, <= 2,147,483,647; strings/fractions fail.
- Item note: string/null, at most 500 characters after boundary ASCII trimming.
  Internal whitespace, case, accents and line breaks remain meaningful.
- Duplicate choice UUIDs fail, including textual aliases of the same UUID.
- Choices sort by UUID. Identical configuration/note lines sum quantity with an
  overflow check; different notes remain separate. Canonical lines sort by the
  same configuration JSONB/C-collation rule as D0B2; indices are zero-based.
- Allowlisted browser money/display/snapshot fields are ignored. Unknown intent
  fields fail. A top-level subtotal is not an input to this item-array API.

The 30-line ceiling already exists in website submission; candidate 20-per-line
and 50-per-cart business limits are not enabled. JSON parsing happens before the
helper: later public admission/request-size/rate controls are still necessary.

## Product, size and readiness validation

Every product must exist, be published and available, not sold out or archived.
Every selected size must exist and belong to that exact product UUID.

The query reconstructs D0B1 structure version 1 in bulk, including all sizes,
assignments, groups, choices, defaults, compatibility, requirements and overrides,
including inactive rows. It compares this exact JSONB to each stored reviewed
certificate. Missing/stale certification returns CONFIGURATION_INVALID.

It additionally checks current coverage/cardinality/defaults and price validity,
so even a manually forged matching certificate cannot legitimize broken rules.
All sizes and contextual requirements for the product must remain configured,
even when the current selection uses only one size/choice. Price and choice/size
label changes invalidate certification as D0B1 specifies. Product/category names
are not fields of that certificate and are read as current server snapshots.

No per-product `assert_pricing_ready` or `catalog_structure` call is made inside
pricing. Its bulk equivalent is tested against certificates produced by those
actual D0B1 helpers. This preserves their contract without N+1 catalog reads.

## Options and defaults

Selected choices must exist, be active, belong to an active group, and have an
active assignment to the submitted product. Overrides cannot authorize choices.
Every active assigned group is checked, including groups omitted from the input.
Single/multi selection semantics and effective required/min/max limits apply.

Defaults are configuration coverage, not implicit customer selections or free
pricing. Omitting a required default still returns OPTION_REQUIRED. Broken or
inactive defaults invalidate configuration. Required default coverage retains
D0B1's existing certification policy; no dummy defaults are added here.

Temperature uses the stable group key and exact product/size/choice tuple. No
HOT/ICED or size-label inference occurs. HOT 12oz is a distinct size identity.
Valid ICED Regular/Large and HOT 12oz tuples pass; uncertified/missing coverage
fails. Selecting HOT for a reviewed ICED-only Large size is an invalid selection.
Non-temperature products need no temperature selection or compatibility tuples.

## Contextual pricing

Effective choice delta is:

`exact size override > product override > option_choices.price_delta`

Explicit product-scope requirements require the product rule; exact-size
requirements require that size's rule. A missing required rule never falls back.
Same-specificity ambiguity fails even in a corruption fixture with its unique
index removed. Having both a size and product rule is ordinary precedence.

Fixtures cover included Oat/Breve/Coconut, non-included milk, cheese at 4/8/12,
shots, syrup, sauce, sweeteners, paid/free Curvccino inclusions, extra matcha and
hojicha powder, free savory sauces and ordinary zero-price options. No production
recipe names, prices or IDs are embedded in the engine.

## Set-based data flow and snapshot consistency

`pricing_input_lines` performs bounded pure structural normalization. Its loops
perform no catalog lookup. It advertises ROWS 30 to the planner.

One relational pricing statement then:

1. Materializes typed input and canonical merged lines.
2. Deduplicates product IDs and loads only their related catalog sets.
3. Builds reviewed structures and validates coverage set-wise.
4. Expands selected UUID arrays and joins active groups/choices/assignments.
5. Joins product/size overrides, requirements and exact compatibility tuples.
6. Aggregates selected counts and option effects by group/line.
7. Computes numeric unit, line and cart totals and builds one canonical response.

Catalog sets are materialized once and reused. No per-choice pricing function or
per-line database round trip occurs. PostgreSQL may perform indexed nested loops
within that single plan; that is not application-level N+1 querying.

STABLE execution uses the calling statement's MVCC snapshot for certification,
labels and all prices. A genuine independent-session test holds a reader after
its statement starts, commits changed base/option prices plus recertification
from a second session, then releases it. The reader returns the complete old
125.00 result; the next statement returns the complete new 250.00 result. It
never combines old/new amounts or a mismatched certification.

This is a pricing checkpoint, not an availability reservation or guarantee that
the catalog cannot change before a future caller commits.

## Authoritative response and snapshot shape

Example response (UUIDs shortened only for this illustration):

```json
{
  "pricing_contract_version": 2,
  "pricing_policy_version": "curv-cart-v2.1",
  "currency": "PHP",
  "subtotal": "125.00",
  "items": [{
    "line_index": 0,
    "product_id": "product-uuid",
    "product_size_id": "size-uuid",
    "option_choice_ids": ["milk-choice-uuid", "temperature-choice-uuid"],
    "quantity": 1,
    "item_note": null,
    "product_name": "Configurable drink",
    "category_name": "Pricing fixture",
    "size_label": "Regular",
    "base_price": "100.00",
    "option_total": "25.00",
    "unit_price": "125.00",
    "line_total": "125.00",
    "pricing_policy_version": "curv-cart-v2.1",
    "options": [
      {"group_id":"milk-group-uuid","group_key":"milk","group_name":"Milk","choice_id":"milk-choice-uuid","label":"Oat","value":"oat","effective_price_delta":25},
      {"group_id":"temperature-group-uuid","group_key":"temperature","group_name":"Temperature","choice_id":"temperature-choice-uuid","label":"ICED","value":"iced","effective_price_delta":0}
    ],
    "pricing_configuration_snapshot": {
      "contract_version": 2,
      "pricing_policy_version": "curv-cart-v2.1",
      "product_id": "product-uuid",
      "product_size_id": "size-uuid",
      "option_choice_ids": ["milk-choice-uuid", "temperature-choice-uuid"],
      "options": [
        {"group_id":"milk-group-uuid","group_key":"milk","group_name":"Milk","choice_id":"milk-choice-uuid","label":"Oat","value":"oat","effective_price_delta":25},
        {"group_id":"temperature-group-uuid","group_key":"temperature","group_name":"Temperature","choice_id":"temperature-choice-uuid","label":"ICED","value":"iced","effective_price_delta":0}
      ]
    }
  }]
}
```

Option snapshots sort by choice UUID and contain only server-derived safe fields.
Effective deltas are exact JSONB numeric values, matching D0B1's snapshot validator.
Displayed monetary totals/base/effect sums are fixed-two-decimal strings to avoid
requiring browser floating-point arithmetic. No costs, recipe notes, raw override
rules or certificates are projected. Snapshot compatibility with D0B1 is tested.
Existing order insertion/readable `options` are untouched. Future renderers must
continue escaping dynamic text.

## Numeric safety and errors

All arithmetic uses PostgreSQL numeric. Components (size price, base option delta,
override) must be finite, nonnegative, <= 999999.99 and exactly representable to
two decimals, using the existing D0B1 model bounds. No fractional cents are rounded
away. All active configured choice/override prices are checked, not only selected
ones. Unit price, line total and subtotal must fit 0..99999999.99, the existing
NUMERIC(10,2) order/item storage range. Sums/products are computed before bounded
formatting, so overflow cannot silently wrap/truncate. No negative-price policy is
introduced. Large free quantities still require later approved business caps.

Expected failures use SQLSTATE 22023 and these stable detail codes:

| Code | Meaning |
|---|---|
| ORDER_CART_INVALID | Invalid array/shape/UUID/note/technical request bound |
| QUANTITY_INVALID | Invalid quantity, merged overflow, or line/cart money exceeds storage range |
| PRODUCT_UNAVAILABLE | Missing, unpublished, unavailable, sold-out or archived product |
| SIZE_INVALID | Missing size or wrong product ownership |
| CONFIGURATION_INVALID | Missing/stale certification, bad rules/defaults/prices/coverage, ambiguous overrides |
| OPTION_INVALID | Unknown/inactive/unassigned selected choice in otherwise valid configuration |
| OPTION_REQUIRED | No selection for a group with an effective minimum above zero |
| OPTION_SELECTION_INVALID | Duplicate choices, too few/many choices, or incompatible temperature |

After structural checks, precedence is quantity overflow, availability, size,
configuration, selected-choice validity, required/cardinality/temperature checks,
then computed monetary bounds. Thus deactivating a certified choice normally
produces CONFIGURATION_INVALID until the changed catalog is reviewed; selecting
an inactive choice after a valid recertification produces OPTION_INVALID.
Messages contain no table/SQL/rule details. Future public wrappers must filter
unexpected PostgreSQL diagnostics rather than exposing internal exception context.

## Amendment reuse

A one-line replacement, added configuration or added-quantity configuration can
be priced independently; tests require no customer/checkout data. The helper
never loads or reprices an existing order. Future amendment code must combine
unchanged persisted lines at historical prices with these new current-price
results and enforce its own lifecycle, revision and final-order limits.

## Performance and index findings

Native PostgreSQL 17.6 EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) measured the exact
inner engine query extracted from its SQL marker, not a simplified approximation.
Fixture catalog: 20,008 products, 20,012 sizes, 20,009 assignments.

| Cart | Selected choices | Query execution |
|---|---:|---:|
| One product, one line | 2 | 2.344 ms |
| One product, 30 distinct-note lines | 300 | 9.622 ms |
| 30 distinct products | 240 | 10.961 ms |

Existing products_pkey, categories_pkey, product_sizes_product_sort_order_idx and
product_option_groups_product_sort_order_idx served bounded key lookups. Repeated
lines loaded the shared product once. Tiny option/configuration tables used one
sequential scan each (3–38 rows), which is appropriate at that fixture scale.
An earlier 2,000-product fixture used planner-selected sequential scans and still
ran in 4–12 ms; the larger fixture confirms existing indexes support growth.
No speculative indexes or forced planner settings were added.

These are local warm-query observations, not a production latency guarantee.
Actual production catalog cardinality, statistics, certificates and wrapper
overhead require later acceptance. The native test also checks a generous five-
second smoke ceiling; exact timings are retained as diagnostics, not brittle tests.

## Acceptance results

All local suites passed:

| node tests/<suite>.cjs | Assertions |
|---|---:|
| public-pricing-engine | 122 |
| public-pricing-engine-preflight | 17 |
| public-pricing-engine-native | 11 |
| public-pricing-model | 92 |
| public-pricing-preflight | 28 |
| public-configuration-database | 46 |
| public-configuration-browser | 38 |
| public-menu-item-panels | 45 |
| public-menu-renderers | 813 |
| public-menu-options-hydration | 49 |
| public-menu-geometry | 3450 |
| public-submission-foundation | 134 |
| public-submission-concurrency | 17 |
| dine-in-timing-database | 41 |
| dine-in-timing-browser | 22 |
| customer-records | 73 |
| customer-admin | 116 |
| public-customer-details | 74 |
| customers-browser | 80 |
| pos-database | 51 |
| pos-browser | 13 |
| pos-kitchen-database | 45 |
| pos-kitchen-browser | 28 |

Native evidence retained in task workspace `curv-d0b3-xdN6bk/results.json`;
D0B2 concurrency evidence in `curv-d0b2-hCDK6u/results.json`. Both disposable
loopback servers shut down afterward. No live database was contacted. Early
fixture setup issues (an existing milk group key, a second failure in an aborted
test transaction, and unpublished performance products) were corrected in tests;
no production business rules were weakened to accommodate them.

## Remaining gates / next phase

Ready for local D0B4 public preview API work, subject to separate authorization.
No local engine blocker remains. Production configuration population/certification,
public authorization/error/admission controls, quote/review fingerprint handling,
new-order final pricing integration, rollout of legacy pending-request handling,
approved business quantity caps and production migration review remain later gates.
This phase does not activate v2 or make existing browser prices authoritative.
