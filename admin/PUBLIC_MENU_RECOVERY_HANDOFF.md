# Public menu recovery handoff

Status recorded: 2026-10-12 (Asia/Manila).

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

Authoritative pricing certification remains a later, separately reviewed step.
This recovery does not certify products. Future cleanup may remove legacy
aliases only after certification and a stability review have established that
the deployed configuration and all public ordering consumers use canonical
keys safely. POS work remains outside this closeout.

Local closeout validation: 4,462 assertions passed across six offline public-menu
suites (bridge 39, renderer 813, Customize 66, item panels 45, hydration 49,
geometry 3,450). JavaScript syntax and Git whitespace checks passed.
