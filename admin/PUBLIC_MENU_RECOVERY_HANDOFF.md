# Public menu recovery handoff

Status recorded: 2026-10-13 (Asia/Manila).

The owner confirmed that the frontend compatibility bridge was deployed, the
complete `PUBLIC_MENU_OPTION_MAPPING_REPAIR.sql` migration reached `COMMIT`,
and public customer ordering was manually verified working afterward. This
closeout records that confirmation; it does not independently query production.

The bridge remains intentionally in place. Do not remove its legacy aliases
(`beverage_temperature`, `extra_shot`, `sinkers`, `sauce_beverage`, `garnish`,
`add_cheese`) yet. Missing or invalid required configuration must remain
fail-closed. The migration's preflight exempts only the exact approved Brown
Sugar Temperature and Shrimp Bites Sauce assignment UUIDs scheduled for
retirement; all other unexpected mappings remain blockers.

Recovery sources are `menu/index.html`,
`admin/PUBLIC_MENU_OPTION_MAPPING_REPAIR.sql`,
`admin/PUBLIC_MENU_OPTION_MAPPING_REPAIR_PLAN.md`, the imported exports in
`admin/production-option-inventory/`, and the public-menu bridge, Customize,
hydration, renderer, item-panel, and geometry tests under `tests/`.

Authoritative checkout/pricing is now confirmed complete: D0B2 submission
foundation, D0B3 pricing engine, D0B4 quote preview, and D0B5 submission backend
are installed. Both `public.quote_public_cart` and
`public.submit_public_order_v2` were verified through PostgREST. All 59 approved
sellable products are certified and 59/59 are pricing-ready; the 34 excluded
products remain uncertified. A real Classic Cali Maki quote returned `ok:true`
at ₱180, and the live CURV menu price review/checkout flow was manually verified
working. These production results are owner-confirmed; this documentation
update does not independently query production or perform certification.

Certification is complete, but legacy aliases must not be removed yet. Future
cleanup requires a stability review establishing that the deployed
configuration and all public ordering consumers use canonical keys safely.
POS work remains outside this closeout.

Earlier local recovery closeout validation: 4,462 assertions passed across six offline public-menu
suites (bridge 39, renderer 813, Customize 66, item panels 45, hydration 49,
geometry 3,450). JavaScript syntax and Git whitespace checks passed.
