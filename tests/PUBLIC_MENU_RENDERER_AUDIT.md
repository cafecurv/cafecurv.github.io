# Public Menu Specialized Renderer Audit

Scope: local repository inspection and offline fixtures, 2026-09-04.
No live Supabase connection, SQL execution, data edits, commit, or push.

## Prior rendering path

The registry claimed matching category IDs before invoking a whole-category
renderer. A false result hid the corresponding section and navigation tab.
Unclaimed categories already used generic rendering. CURV Picks was separate
from category claiming and used the flat public product collection.

The public fetch selects is_curv_pick; shapePublicMenuData retains it.
The repository's M-P2C3 public_menu_products view exposes it and filters
is_published = true and archived_at is null. Availability is not a visibility
filter. This verifies the repository contract, not the deployed view or rows.

## Inventory and failure modes before this patch

| Collection | Category identity | Mapping / presentation | Name and lineup assumptions | Variant / grouping restrictions | Failure scope |
| --- | --- | --- | --- | --- | --- |
| Matcha & Hojicha | Exact normalized matcha & hojicha | mapPublicMatchaItems / renderMatchaPanel | Every present product needed a MATCHA_ITEMS name; no required total or requirement that every old product exist | Exactly one price variant; legacy metadata selects Signature/Popular/Seasonal/Hojicha | One unknown name or invalid variant returned failure for the category |
| Espresso, including Non-Espresso | Exact espresso | mapPublicEspressoItems / renderEspressoPanel / renderSupabaseEspressoNonEspresso | Unknown names accepted with invented default panel options; duplicate mapped IDs rejected; no fixed product count | One or two variants, positional Regular/Large fallback; menu_group whitelist; specific Non-Espresso names required that group | One malformed row, bad group or duplicate ID failed entire category |
| Curvccino | Exact curvccino; section blended | mapPublicCurvccinoItems / renderFrappePanel | Names optionally matched FRAPPE_ITEMS; unknown names received default options; no fixed product count | One or two variants; unfamiliar labels assigned Regular/Large by position; duplicate IDs rejected | One bad product failed entire category |
| Refreshers | Exact refreshers | mapPublicRefresherItems / renderRefresherPanel | Names optionally matched REFRESHER_ITEMS; no fixed product count | One or two variants; positional Regular/Large fallback; duplicate IDs rejected | One bad product failed entire category |
| Takoyaki | bites, curv bites, takoyaki, takoyaki & savory bites, savory, savory bites | mapPublicTakoyakiItems / renderTakoyakiPanel | Exact known names and panel metadata; no fixed total | Exact expected piece counts/labels for each known product | Already skipped bad products; incompatible KNOWN names were excluded from the additional generic-products pass |
| Savory Bites | Same aggregated aliases as Takoyaki | mapPublicSavoryItems / renderSavoryPanel | Exact known names and sauce metadata; no fixed total | Exactly one valid price | Already skipped bad products, but same known-name generic-fallback gap as Takoyaki |
| Salads | salad bar or salads; first match only | mapPublicSaladBarItems / renderSaladBarProduct | Unknown names recently supported; no fixed total | At least one valid variant; disabled rows could lack sizes | One invalid name/variant still failed the category; multiple alias categories could be claimed but only first rendered |
| Pastries & Desserts | Exact pastries & desserts | mapPublicPastryItems / renderPastryProduct | Any name; no fixed lineup | At least one valid variant; empty category had a special empty state | One invalid row failed whole category |
| CURV Picks | is_curv_pick on flat public products, independent of category | mapPublicCurvPicks / renderCurvPickItem | Previous fix removed fixed-set eligibility | Known-panel variant restrictions still skipped incompatible picks; panel targets inferred from names, not successful rendering | Individual returned failures skipped, but malformed variant structures could throw; all rejected picks hid collection |

Other public categories use getGenericCategorySectionId and the generic renderer.
No other specialized public category shells were found.

## Matcha observation: what is and is not proved

A dynamically rendered Kagoshima Matcha Cream pick is consistent with a product
and its category reaching the public shaping pipeline while a different Matcha
row causes the normal mapper to fail. The pick collection does not run the
normal Matcha category mapper, so the two outcomes can differ.

No live payload was inspected. The exact offending product, current lineup,
price rows, and deployed spelling cannot be identified from repository source.
Missing an old expected Matcha product alone did NOT fail that mapper.
Unknown/renamed/moved-in products or an invalid variant shape did.

The old registry did not recognize "Matcha & Houjicha". That spelling alone
would normally be unclaimed and use the generic category path, so it is NOT
proof of the reported disappearance. Both spellings now share the specialized
section and search route.

## Shared solution

- renderPublicMenuFromSupabase invokes renderDefensivePublicCategory for every
  registry entry. Category visibility uses actual successful card counts.
- mapDefensivePublicCategory first validates each row against real public
  variants. It tries known, compatible customization metadata individually.
- Existing legacy mappers remain small compatibility adapters called with ONE
  product. Their strict assumptions no longer decide category visibility.
- Unknown names, incompatible size labels, invalid panel metadata and panel
  render exceptions fall back to generic public-data cards.
- Generic validation rejects null/blank/negative/noninteger prices, ignores
  malformed variant rows, and skips available products without usable prices.
  Disabled products may render without a usable price, but cannot be ordered.
- Actual category sections override legacy subgroup hints. All matching alias
  categories are aggregated, not just the first.
- Successful fetches replace legacy card roots, keeping intros and note boxes.
  This removes stale/unpublished panels and duplicate IDs. Fetch-failure startup
  behavior is unchanged.
- Empty categories, including Pastries, now hide per the requested zero-renderable
  contract; the Pastries intro remains unchanged.
- Existing product panel factories and defaults retain milk, sweetener,
  hot/iced, sauce, inclusions, cheese and Takoyaki add-on handling when compatible.
  Single fixed-price items retain their panels. Size panels require two
  recognizable sizes rather than inventing an extra size or renaming new labels.
- Salads and Pastries have no special customization panels, so their public rows
  use the shared generic card renderer.
- CURV Picks uses the same generic validation and only links to panels registered
  as successfully rendered for that product ID. It remains cross-category.
- Search targets product IDs before falling back to names for old static cards.
  It supports same-named products and all real generic/specialized targets.
- Arbitrary names/variant labels are escaped in generic quick-add attributes.

## Regression suite

tests/public-menu-renderers.cjs loads the actual page and inline script into an
offline headless browser, blocks all external requests, and does not fire startup
Supabase listeners. Each of seven category shells runs the 15-scenario matrix:
legacy, removal, addition, arbitrary rename, legacy rename, move in, move out,
unfamiliar sizes, unavailable/no sizes, sold out, malformed mixed, zero valid,
generic fallback, mocked public-view visibility, and category section.

Additional cases cover Kagoshima, both Hojicha spellings, all Bites aliases,
aggregation, multiple category picks, duplicate names and IDs, panel exceptions,
null rows, real panel/quick-add cart operations, search selection, refreshes,
and 390px/1280px overflow. No live database acceptance is claimed.

Run with an installed Playwright and Edge:
```powershell
$env:CURV_PLAYWRIGHT_MODULE = '<path to installed playwright package>'
node tests/public-menu-renderers.cjs
```
CURV_BROWSER_CHANNEL can override msedge. CURV_TEST_SCREENSHOTS can optionally
name an existing output directory for the two offline screenshots.

No SQL or Menu Manager changes are needed. Deploy-time acceptance should check
the actual lineup, compatible panel options, generic prices, search and cart.

