# D0A.1 local configuration hardening — review before deployment

Local implementation only. No production data or UUIDs were invented. No v2
submission switch, cart pricing RPC, payment workflow, amendment UI, or POS change.

## Decisions

- Cart configuration is product_id + product_size_id + sorted option_choice_ids.
  Notes remain separate line identity so different instructions do not merge.
  options retains readable values; option_snapshots retains labels/group labels.
  Quantity edits and cart rendering preserve the configuration. There is no existing
  full cart reconfiguration UI; remove/re-add and rebuild use the same representation.
- Catalog size controls are constructed directly from actual variant rows. No
  label/price reverse lookup supplies their UUID. Known specialized recipes cannot
  silently lose modifiers when their renderer falls back to generic.
- HOT 12oz should have its own product_sizes row. Temperature is a selected catalog
  choice. The compatibility table records explicit allowed product/size/choice
  tuples. Missing compatibility blocks temperature configurations, not unrelated
  products. The default is not guessed from display text.
- Required recipe groups must be mapped, including free choices. Runtime catalog
  rules determine required/min/max/default selection. A selected free choice is
  serialized; an optional unselected group produces no choice ID.
- All name/price-only addItem paths are display-only. Initial and failed hydration
  cannot create identity-less cart lines. Fully mapped catalog panels and Picks
  targeting them remain orderable. Unmapped specialty panels show an explanation.
- Browser monetary values are still previews/current legacy submission inputs.
  They are NOT server-authoritative. Existing recipe inclusion and cheese preview
  rules remain client-side while the private draft represents their future server
  equivalent. Their display-value lookup does not bind identity. D0B must replace
  these preview rules with server quotes, not reuse names/labels for pricing.
- Payload adds choice IDs and option snapshots without pricing_contract_version=2.
  Existing submit RPCs do not persist/validate these new top-level item fields.
  D0B must wire persistence and authoritative validation; do not treat D0A.1 as a
  security fix against price tampering. Idempotency backend behavior is unchanged.

## Draft SQL and security

Following D0B1 local model finalization (see WEBSITE_PRICING_D0B1_REVIEW.md),
WEBSITE_CONFIGURATION_D0A1_SCHEMA.sql adds three tables with RLS and no anon or
ordinary authenticated table access, a private choice-delta model helper, and one
narrow read-only compatibility RPC. The RPC returns only allowed IDs for published,
available, nonarchived, non-sold-out products and active temperature assignments. It exposes
no override prices or private table contents. SECURITY DEFINER is limited to this
read; its search_path is pg_catalog and object names are qualified.

Override precedence: size-specific > product-specific > base choice delta, after
explicit product/exact-size override requirements have been satisfied. Missing
required rules fail closed. D0B1 adds private reviewed configuration certification.
Defaults never make a choice free. Partial unique indexes prevent duplicate active
rules. Composite foreign keys enforce size ownership. Active choice assignment is
checked on mapping writes and again when resolving a delta; deactivating a group,
choice, or assignment cannot be overridden by an existing price rule. Monetary
values must be finite, nonnegative, at most 999999.99, and have at most 2 decimals.
This helper does not price a cart or validate full group cardinality/availability.

Preflight checks catalog/UUID prerequisites and object collisions before DDL.
Reapplication deliberately stops for review; it never assumes an existing object
has the right definition. Whole-file transaction prevents partial DDL. New indexes
and the product_sizes unique constraint require deployment lock review.

Rollback: if a statement fails, ROLLBACK the transaction. After installation,
retain these additive objects unused unless a separate removal is reviewed.
D0B1 depends on them; do not remove its prerequisite functions/tables or the size
uniqueness constraint. Do not use CASCADE or remove populated configuration
without exporting/reviewing it. No existing order data is backfilled.

## Production data requirements (not supplied by local fixtures)

For every named specialty in the inventory below:
1. Confirm its real product UUID and every actual size UUID.
2. Map each listed non-size modifier to active product_option_groups and active
   option_choices. Preserve supported choices; do not add dummy groups.
3. Configure correct required/min/max rules and explicit defaults. Include free
   recipe choices and meaningful No/None choices when they describe configuration.
4. Validate every supported selection using actual IDs. Local fixture UUIDs must
   never be copied into production.

Espresso: add/confirm distinct HOT 12oz variants and explicit ICED Regular,
ICED Large, HOT 12oz compatibility tuples. Do not map HOT to Large by equal price.
Other temperature-bearing catalog products also need explicit compatibility.

Product-level zero-price overrides are required for:
- Cloud Spanish Oat Latte / Oat
- Cocoa Caramel Latte / Breve
- CS Matcha Oat Latte / Oat
- Matcha Sunrise / Coconut

Every Takoyaki product offering cheese needs the applicable size/cheese tuples:
4 pcs = 30, 8 pcs = 60, 12 pcs = 90. Classic Veggie and Salted Egg currently offer
8/12 only; executable local configuration enables cheese despite older comments.
Confirm that intended catalog configuration before deployment; do not silently
change it in this phase.

Generic catalog products with confirmed zero groups need no dummy options.
Salads, Sushi, Rice Bowls, Pasta, Croissant and additional products require a real
catalog data inventory; their live rows were not inspected.

## Status

READY LOCALLY: stable ID transport, direct size binding, explicit defaults,
configuration merge keys, fallback blocking, compatibility read/fail-closed path,
private contextual model and offline fixtures/tests.
NEEDS PRODUCTION CATALOG DATA: all actual product/size/choice assignments, defaults,
temperature tuples, included-milk and cheese override rows.
NEEDS MODEL CHANGE: additive draft must be reviewed/deployed before temperature
read availability and future server pricing. No production model change occurred.

## D0B and future amendment boundaries

D0B must implement full product availability, size ownership, group cardinality,
choice activation/assignment, compatibility, authoritative totals, persisted
snapshots/IDs, and idempotent replay. A client configuration is never trusted.
Amendment preview/application should reuse that same configuration contract;
legacy order reconfiguration must select fresh catalog IDs, never match labels.

No new quantity limits were implemented. Design/test assumptions only: 20 per line,
50 aggregate, existing 30-line maximum. Current +/- controls and merged quantities
are unbounded; future UI and server limits must agree and apply after merging.

## Later deployment phases

1. Review draft/security/lock requirements; approve production data inventory.
2. Deploy additive model/read API separately during an approved window.
3. Populate reviewed UUID mappings and verify complete configuration coverage.
4. Deploy frontend only once affected specialty products pass catalog acceptance.
5. Separately design/review D0B pricing, then amendment lifecycle work.

Do not deploy frontend alone: missing mappings intentionally disable specialty
ordering. This is a deployment dependency, not a fallback to guessed identity.

## Specialized catalog inventory

| Family | Product | Required mapping keys (size comes from product_sizes) |
| --- | --- | --- |
| Espresso | Curv Latte | temperature, milk, extrashot, syrup, sauce |
| Espresso | Einspanner Latte | temperature, milk, extrashot, syrup, sauce |
| Espresso | Spanish Latte | temperature, milk, extrashot, syrup, sauce |
| Espresso | Caramel Macchiato | temperature, milk, extrashot, syrup, sauce |
| Espresso | Vanilla Latte | temperature, milk, extrashot, syrup, sauce |
| Espresso | White Chocolate Mocha | temperature, milk, extrashot, syrup, sauce |
| Espresso | Caffè Mocha | temperature, milk, extrashot, syrup, sauce |
| Espresso | Americano | temperature, extrashot |
| Espresso | Cloud Spanish Oat Latte | temperature, milk, extrashot, syrup, sauce |
| Espresso | Cocoa Caramel Latte | temperature, milk, extrashot, syrup, sauce |
| Espresso | White Ube Latte | temperature, milk, extrashot, syrup, sauce |
| Matcha | Einspanner Matcha | extrapower, milk, sweetener |
| Matcha | Kagoshima Matcha Cream | extrapower, milk, sweetener |
| Matcha | Banana Fudge Matcha Latte | extrapower, milk, sweetener |
| Matcha | Cookie Crumb Matcha Latte | extrapower, milk, sweetener |
| Matcha | Sea Salt Cream Matcha Latte | extrapower, milk, sweetener |
| Matcha | CS Matcha Oat Latte | extrapower, milk, sweetener |
| Matcha | Strawberry Matcha Latte | extrapower, milk, sweetener |
| Matcha | Pure Usucha | extrapower |
| Matcha | Matcha Ube Latte | extrapower, milk, sweetener |
| Matcha | Double Matcha Cloud | extrapower, sweetener |
| Matcha | Matcha Sunrise | extrapower, milk |
| Matcha | Hojicha Latte | extrapower, milk, sweetener |
| Matcha | Sea Salt Cream Hojicha | extrapower, milk, sweetener |
| Matcha | Pink Hojicha Latte | extrapower, milk, sweetener |
| Curvccino | Double Chocolate Chip Cream | milk, syrup, sauce, inclusions |
| Curvccino | Javachip Brownie Curvccino | milk, syrup, sauce, inclusions |
| Curvccino | Javachip Jelly Curvccino | milk, syrup, sauce, inclusions |
| Curvccino | Strawberries & Cream | milk, syrup, sauce, inclusions |
| Curvccino | White Caramel Curvccino | milk, syrup, sauce, inclusions |
| Refreshers | Dragon Dreams | syrup, sauce |
| Refreshers | Tropic Kiss | syrup, sauce |
| Refreshers | Tokyo Sunrise | syrup, sauce |
| Refreshers | Hibiscus Cream Tea | syrup, sauce |
| Refreshers | Lime Cucumber | syrup, sauce |
| Takoyaki | OG Takoyaki | spicy, addons, cheese |
| Takoyaki | Aburi Salmon | spicy, addons, cheese |
| Takoyaki | Oozie Cheese | spicy, addons, cheese |
| Takoyaki | Lava Melt | spicy, addons, cheese |
| Takoyaki | Classic Veggie | spicy, addons, cheese |
| Takoyaki | Salted Egg | spicy, addons, cheese |
| Savory | Shrimp Tempura | sauce_pref |
| Savory | Chicken Karaage | sauce_pref |
| Savory | Cream Dory Fillet | sauce_pref |
