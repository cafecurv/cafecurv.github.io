# Production option mapping exports awaiting local import

The production inventory already exists: its Supabase result exports were provided in the ChatGPT conversation. Those exports were not available inside the local repository context when the repair report was prepared. Import the existing exports; this document does not request a new live connection, SQL execution, migration, or production change.

Local repository: `C:\Users\Isaiah\OneDrive\Documents\GitHub\cafecurv.github.io`.

Populate the following files under `admin/production-option-inventory/`. Preserve the original headers, every row, exact UUIDs, values, prices, NULLs, activity flags and JSON fields. Do not replace complete result sets with summaries or screenshots, and do not omit inactive rows. These files are import destinations only; this task creates no CSVs or placeholder inventory data.

| Production result set | Preferred local filename | Required evidence |
|---|---|---|
|A_OPTION_GROUPS|`admin/production-option-inventory/A_OPTION_GROUPS.csv`|All group IDs, names, exact keys, selection types, sort orders and activity flags.|
|B_OPTION_CHOICES|`admin/production-option-inventory/B_OPTION_CHOICES.csv`|All choice IDs, group IDs/context, exact labels and values, price deltas, sort orders and activity flags.|
|C_PRODUCT_ASSIGNMENTS|`admin/production-option-inventory/C_PRODUCT_ASSIGNMENTS.csv`|Assignment IDs, product IDs/names/categories, group IDs/keys/types, required/min/max/order/activity fields and `exact_assignment_row`.|
|D_PRODUCT_DEFAULTS|`admin/production-option-inventory/D_PRODUCT_DEFAULTS.csv`|Default IDs, product/group/choice IDs, choice values/prices/activity, actual choice-group linkage and assignment context.|
|E1_PRICE_OVERRIDES|`admin/production-option-inventory/E_ADVANCED_CONFIGURATION.csv`|Rows with this exact `section`; object status and complete `exact_row`, including product/size/choice IDs, override price and activity.|
|E2_SIZE_COMPATIBILITY|`admin/production-option-inventory/E_ADVANCED_CONFIGURATION.csv`|Rows with this exact `section`; object status and complete size/choice compatibility records and linkage context.|
|E3_OVERRIDE_REQUIREMENTS|`admin/production-option-inventory/E_ADVANCED_CONFIGURATION.csv`|Rows with this exact `section`; object status and complete product/size/choice requirement records.|
|E4_PRICING_CERTIFICATIONS|`admin/production-option-inventory/E_ADVANCED_CONFIGURATION.csv`|Rows with this exact `section`; object status and complete certification records, including reviewed structure/metadata as exported.|
|F_PRODUCT_SIZE_INVENTORY|`admin/production-option-inventory/F_PRODUCT_SIZE_INVENTORY.csv`|Complete catalog, product/category IDs and names, publication/availability/sold-out/archive state, every size ID/owner/label/base price/sort order and exported exact metadata. Include products without sizes.|
|G_CURRENT_FRONTEND_MAPPING_GAPS|`admin/production-option-inventory/G_CURRENT_FRONTEND_MAPPING_GAPS.csv`|Product identity, recipe family, expected/current/missing keys, publication context and diagnostic status. Diagnostics are evidence, not approved business rules.|
|H_DUPLICATE_SIGNALS|`admin/production-option-inventory/H_DUPLICATE_SIGNALS.csv`|All duplicate kinds, keys, counts and exact row JSON; preserve a confirmed zero-row result if no signals exist.|
|I_PUBLIC_OPTION_VIEW_DEFINITIONS|`admin/production-option-inventory/I_PUBLIC_OPTION_VIEW_DEFINITIONS.csv`|Schema/view names, relation options and full multiline definitions for the public option views.|

## Import conventions

- E1–E4 share one preferred file because the existing inventory diagnostic returns them in one combined result set with a `section` discriminator. Keep all four sections, including `PRESENT_EMPTY` or `MISSING` status rows. An empty table and a missing object are not equivalent. Do not flatten away `exact_row`.
- Use UTF-8 CSV with normal CSV quoting for commas, JSON and multiline definitions. Preserve accents in production names, including `Cafè Mocha`. Keep NULL distinct from an empty string; retain the exporter representation and identify it if ambiguous.
- Preserve zero-row results with their CSV headers. A header-only H file means confirmed no duplicates only when the original result was successfully executed and returned zero rows; an absent/blank file does not establish that result. Preserve any original query error alongside the affected export for review rather than representing failure as empty data.
- If the original exports include execution-context/object-inventory results, retain that provenance with the exports when available. Do not rerun production queries for this documentation task. Identify the original export timestamp/snapshot if known; do not invent it or imply separately collected outputs were one snapshot.

## Review gate after import

Re-evaluate UUID completeness and reconcile every published/sellable product, including zero-group products and newer names, against F and its real assignments/defaults. Reconcile exact choice values and size identities before finalizing contextual tuples. Review advanced-table statuses, duplicates and view definitions. The currently incomplete matrix in `PUBLIC_MENU_OPTION_MAPPING_REPAIR_PLAN.md` is provisional and must not be treated as final.

No technical recommendation is changed by this import checklist. Do not generate write SQL, certify products, modify frontend behavior or proceed with migration until the imported evidence has been reviewed.
