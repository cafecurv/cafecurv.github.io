# Pricing certification scope reconciliation

Status: RECONCILIATION COMPLETE (local comparison only).
Recorded: 2026-10-13 (Asia/Manila).

## Evidence and scope

The complete local `admin/PRICING_CERTIFICATION_AUDIT_RESULT.txt` was parsed: 93 distinct product rows, with its reported COMMIT. Its SHA-256 is `3e3efecb4df79892860d90cd63bf7ab8a054d24d30e028d0a8a33a563bb1e113`. It was compared with the reviewed SQL manifest and the imported F inventory. No production connection or SQL execution was performed during this reconciliation.

| Scope | Previously reviewed | Current audit | Difference |
| --- | ---: | ---: | ---: |
| Total products | 62 | 93 | +31 |
| Sellable candidates | 43 | 59 | +16 |
| Excluded products | 19 | 34 | +15 |
| Matching certifications | 0 | 0 | 0 |

All 62 reviewed UUIDs are still present with the same names and catalog classifications. All 31 scope anomalies have `expected_state = NULL`: they are absent from the old manifest, not renamed or state-changed versions of one of its UUIDs. No missing reviewed UUID or exact duplicate product name was found across the 93 audit rows. Absence from the prior export does not prove these products were created afterward.

The old F CSV contains only six categories: Curvccino (6 products), Espresso (18), Mains (7), Matcha & Hojicha (17), Refreshers (5), and Takoyaki & Savory Bites (9). It lacks the additional salad, sushi, pastry and other food scope now seen in the audit. However, Section F of `PUBLIC_MENU_OPTION_MAPPING_INVENTORY.sql` has no category filter. The supplied evidence cannot distinguish later catalog additions from an incomplete earlier export or different earlier visibility. No product creation timestamps/history were exported for the 31 anomalies. Actual chronology remains unknown.

The local result file contains CP437-decoded UTF-8 display artifacts in Cafè Mocha, Hojicha Brûlée and Matcha Brûlée. A CP437-to-UTF-8 round trip recovers each exact reviewed name. The database-side audit did not report name drift for those UUIDs. This report uses the verified reviewed spelling; the original export is untouched. These artifacts are not treated as product renames.

## Why STRUCTURALLY_INVALID is misleading here

The audit merges catalog-scope differences into its structural `issues` list. Every additional sellable row has only `CATALOG_ID_NAME_OR_STATE_DRIFT` plus `D0B1_CERTIFICATION_STALE:MISSING`. None has a D0B1/D0B3 coverage failure in the export. Therefore the 16 labels reflect a manifest membership mismatch, not evidence that their options are malformed.

All 16 have nonempty valid size coverage, real size UUIDs owned by the correct product, finite nonnegative prices within the supported bounds at cent precision, and zero rows in assignments, groups, choices, defaults, compatibility, requirements and overrides. They are structurally valid zero-option products, while still uncertified. Category names/descriptions and full product/category row images for these additions were not included in the current export; role inference below is labeled accordingly.

The option repair remains consistent: 117 active sellable assignments, 19 defaults, 8 Hot sizes, 24 temperature tuples, 17 active overrides and 17 active requirements. The original 43 sellable rows have no non-certification audit issues. No mapping change is indicated by this reconciliation.

## Reviewed products still matching (62)

| Product | Product UUID | Reviewed = current state | Status |
| --- | --- | --- | --- |
| Aburi Salmon | ff9e0d6f-2a1b-4b6b-a401-e02370224f39 | SELLABLE_CANDIDATE | Matches; uncertified |
| Americano | e684a6bd-aadc-4117-a018-ae0591c43d41 | SELLABLE_CANDIDATE | Matches; uncertified |
| Banana Pudding Matcha Latte | 405517fc-1c5e-4386-b21d-d1aaa6dea8a7 | UNPUBLISHED | Matches; excluded |
| Berry Cloud Latte | f9e87759-6aa9-4bce-8b8b-3081ec913c01 | SELLABLE_CANDIDATE | Matches; uncertified |
| Brown Sugar Cinnamon Cream Latte | e058ec46-f133-4982-afe6-cc6cf5e6d521 | SELLABLE_CANDIDATE | Matches; uncertified |
| Cafè Mocha | 9c0d9e22-8843-4595-b789-7550c29890a4 | SELLABLE_CANDIDATE | Matches; uncertified |
| Caramel Macchiato | aa156151-540b-4beb-b924-d97bf210af95 | SELLABLE_CANDIDATE | Matches; uncertified |
| Cheese Katsu Bowl | 5498a571-8404-4a4f-a380-9cc0eaefc67c | SELLABLE_CANDIDATE | Matches; uncertified |
| Chicken Bowl | 5f5de117-2b8f-42d5-8b66-78f20339f544 | SELLABLE_CANDIDATE | Matches; uncertified |
| Chicken Karaage | 29187fbb-f9ab-42b7-ab29-82a0a1b3f0c5 | SELLABLE_CANDIDATE | Matches; uncertified |
| Chicken Parmigiana | e4d51b9f-15f0-488d-b184-bc1df8713936 | UNPUBLISHED | Matches; excluded; lacks size coverage |
| Chicken Parmigiani | 28e7272b-4fcf-4c39-a0ae-19a74d32a8d3 | UNPUBLISHED | Matches; excluded |
| Classic Veggie | 610f399d-6fa3-46f1-b0b4-9fac6aa0ed5f | SELLABLE_CANDIDATE | Matches; uncertified |
| Cloud Spanish Oat Latte | 8f072a83-552e-4e97-946d-9c306169415a | SELLABLE_CANDIDATE | Matches; uncertified |
| Cocoa Caramel Latte | c541decb-607c-44b1-8bed-4c19594c4422 | SELLABLE_CANDIDATE | Matches; uncertified |
| Cookie Crumb Matcha Latte | 7fcf6e11-6946-4270-8114-5411ec6e2c71 | UNPUBLISHED | Matches; excluded |
| Cream Dory Fillet | a33f5d5a-fde1-4eb4-8604-1637b4afbf9a | SELLABLE_CANDIDATE | Matches; uncertified |
| CS Matcha Oat Latte | b0786602-49eb-4170-b735-a3e265835608 | UNPUBLISHED | Matches; excluded |
| Curv Chocolate | 8e1b82c6-8aea-4eb9-b591-184072c4f49e | SELLABLE_CANDIDATE | Matches; uncertified |
| Curv Latte | ec0956f8-8d28-414f-be46-2349e92bef76 | SELLABLE_CANDIDATE | Matches; uncertified |
| Curv Seasalt Latte | 7b59829b-b13b-4157-a0e8-ecb85bdbb8e4 | SELLABLE_CANDIDATE | Matches; uncertified |
| Double Chocolate Chip Cream | c26d3d79-38bf-4687-b3ca-eedfc1ed0e86 | SELLABLE_CANDIDATE | Matches; uncertified |
| Double Matcha Cloud | e8ec71af-a30d-472a-b1cf-723c60d21d0b | UNPUBLISHED | Matches; excluded |
| Dragon Dreams | c73dfa99-a16c-4e53-b369-dd56f5e3494b | UNAVAILABLE | Matches; excluded |
| Einspanner Latte | cbeecaec-e9a5-4faa-b8f3-75b0cae549dd | SELLABLE_CANDIDATE | Matches; uncertified |
| Einspanner Matcha | 7765a2ac-5133-476d-898d-35d42d3de5fc | UNPUBLISHED | Matches; excluded |
| Hibiscus Cream Tea | ab350883-08eb-4b3a-b45a-03bb11f509a3 | SELLABLE_CANDIDATE | Matches; uncertified |
| Hojicha Banana Pudding Latte | 93e9a33b-1a37-4edf-9d26-5ddd2d87f87d | SELLABLE_CANDIDATE | Matches; uncertified |
| Hojicha Brûlée | e635744c-ed77-4924-a90d-c78440a81603 | SELLABLE_CANDIDATE | Matches; uncertified |
| Hojicha Latte | d053466a-2a52-420c-bc4c-62b5f614a27f | SELLABLE_CANDIDATE | Matches; uncertified |
| Iced Shaken Vanilla Jelly | 31886227-0130-45f7-8fb7-3d84682eed92 | SELLABLE_CANDIDATE | Matches; uncertified |
| Javachip Brownie Curvccino | 56ca858c-58da-4ee3-9954-d189390cefb8 | SELLABLE_CANDIDATE | Matches; uncertified |
| Javachip Jelly Curvccino | 52f8ffc5-8f9b-41d2-9ecd-574ece1cf5e6 | SELLABLE_CANDIDATE | Matches; uncertified |
| Kagoshima Matcha Cream | 558135d9-c065-4da9-b577-530c0b66c337 | UNPUBLISHED | Matches; excluded |
| Lava Melt | c1f44003-500d-46aa-9fe6-9bbf35c57415 | SELLABLE_CANDIDATE | Matches; uncertified |
| Lime Cucumber | 9eba0285-c567-4d8d-960a-4f2bed4a6bd7 | SELLABLE_CANDIDATE | Matches; uncertified |
| Matcha Brûlée | 4077bbcf-f13a-4295-8562-503692125c01 | UNPUBLISHED | Matches; excluded |
| Matcha Sunrise | 0e810492-09eb-4a36-89e9-cd263a3c4058 | UNPUBLISHED | Matches; excluded |
| Matcha Ube Latte | 77188ef3-b97e-4411-896a-85beeb61abec | UNPUBLISHED | Matches; excluded |
| OG Takoyaki | 24007d6c-e175-4dcf-9a6f-aab076e07b98 | SELLABLE_CANDIDATE | Matches; uncertified |
| Oozie Cheese | c027eedc-1807-4574-8f14-79ce07bb544e | SELLABLE_CANDIDATE | Matches; uncertified |
| Pink Hojicha Latte | 6caefdb6-7daf-4e6d-a034-95fda0b7ecd7 | SELLABLE_CANDIDATE | Matches; uncertified |
| Pitaya Mango Cream | a3851bd7-6cb7-4dec-a834-1b26d39d712f | UNAVAILABLE | Matches; excluded |
| Pork Katsu Bowl | f4253ada-f15f-4fee-abea-c7678cd1fc06 | SELLABLE_CANDIDATE | Matches; uncertified |
| Pure Usucha | a88249e4-f2a9-4ef5-801f-644c7e142831 | UNPUBLISHED | Matches; excluded |
| Salmon Katsu Bowl | b5e5b9aa-9578-4663-81b2-1eb9328a123a | UNPUBLISHED | Matches; excluded |
| Salted Egg | 2c218e48-9871-41a3-bb12-19ced7b38321 | SELLABLE_CANDIDATE | Matches; uncertified |
| Sea Salt Cream Hojicha | 82417b58-d0c4-4d0d-a0cd-27da42b42627 | SELLABLE_CANDIDATE | Matches; uncertified |
| Sea Salt Cream Matcha Latte | 4b9149b7-f2d5-4d19-bcd8-a3bf880b1bed | UNPUBLISHED | Matches; excluded |
| Seared Salmon Beurre Blanc | c0e22263-7658-42e9-97af-4128a99270a5 | UNPUBLISHED | Matches; excluded |
| Seasalt Dark Latte | 57cd4f38-2e5f-41ba-a117-83f5b2c66819 | SELLABLE_CANDIDATE | Matches; uncertified |
| Shrimp Tempura | ffcf04b4-1500-4463-aa25-3703a1e167ed | UNPUBLISHED | Matches; excluded |
| Spanish Latte | 7a258d7e-5b74-44c8-93af-38b1fbd92765 | SELLABLE_CANDIDATE | Matches; uncertified |
| Strawberries & Cream | 8a078f3e-872d-47e0-a1df-c14f33af64c2 | SELLABLE_CANDIDATE | Matches; uncertified |
| Strawberry Matcha Latte | 837f9adf-efd6-4e80-8323-c8e87550c0a5 | UNPUBLISHED | Matches; excluded |
| Tokyo Sunrise | 483eed35-dd1d-4a87-90a6-2161b3d1ef86 | SELLABLE_CANDIDATE | Matches; uncertified |
| Tropic Kiss | f716d196-47f0-46f4-af7e-bda068b95b2d | SELLABLE_CANDIDATE | Matches; uncertified |
| Ube Cloud Latte | 4ea4643e-5a61-402f-b9c4-8a29ae130c18 | SELLABLE_CANDIDATE | Matches; uncertified |
| Vanilla Latte | 54c6725f-4445-435c-bc1d-b779e5963796 | SELLABLE_CANDIDATE | Matches; uncertified |
| White Caramel Curvccino | dd5face3-df84-47ae-8ce1-9e2b565a91dd | SELLABLE_CANDIDATE | Matches; uncertified |
| White Chocolate Mocha | 45b1f92c-0daa-4ed2-af55-c5da97315c0a | SELLABLE_CANDIDATE | Matches; uncertified |
| White Ube Latte | 3372a8c3-3208-4458-bb71-38c40c454436 | SELLABLE_CANDIDATE | Matches; uncertified |

The existing excluded Chicken Parmigiana row (`e4d51b9f-15f0-488d-b184-bc1df8713936`) has `D0B1_SIZE_COVERAGE`, consistent with missing size coverage. It remains excluded and is not a certification candidate. This is separate from the 16 scope-only sellable anomalies.

## New sellable products relative to the reviewed scope (16)

P/A/S means published/available/sold-out. All are unarchived. All UUIDs below are absent from the prior 62-product manifest; no existing reviewed UUID was renamed to any of them. No temporal creation claim is made.

| Product | Product UUID | Current state | P/A/S/archived | Sizes and authoritative prices | Classification |
| --- | --- | --- | --- | --- | --- |
| Blueberry Cheesecake | fb4bf2ff-796b-425a-9f0f-ee76009cd017 | SELLABLE_CANDIDATE | true/true/false/NULL | Slice: ₱170.00 | ZERO_OPTION_VALID |
| Chicken Salad | fc30f084-097d-414c-b56a-cf7046ee1435 | SELLABLE_CANDIDATE | true/true/false/NULL | Regular: ₱210.00 | ZERO_OPTION_VALID |
| Classic Cali Maki | 8c0dc38c-de30-4490-95e0-c83b099183a8 | SELLABLE_CANDIDATE | true/true/false/NULL | 8: ₱180.00 | ZERO_OPTION_VALID |
| Classic Chocolate Chip | f6d2542d-27f7-4245-ab48-6991237d40a5 | SELLABLE_CANDIDATE | true/true/false/NULL | 1pc: ₱90.00 | ZERO_OPTION_VALID |
| Classic Newyork Cheesecake | 55403ee2-22f4-43b5-b0ef-b2e621203647 | SELLABLE_CANDIDATE | true/true/false/NULL | Slice: ₱180.00 | ZERO_OPTION_VALID |
| Coastal Salad | 717f388b-8ccf-4b4f-bc24-5df95c47e08c | SELLABLE_CANDIDATE | true/true/false/NULL | Regular: ₱180.00 | ZERO_OPTION_VALID |
| Curv Salad | 1ad31e1e-5904-4f3d-8fb3-42618fb96a48 | SELLABLE_CANDIDATE | true/true/false/NULL | Regular: ₱160.00 | ZERO_OPTION_VALID |
| Flamed Salmon Roll | 312fdb00-6abb-4983-b826-29f9061e4b11 | SELLABLE_CANDIDATE | true/true/false/NULL | Each: ₱220.00 | ZERO_OPTION_VALID |
| Futomaki Midori Roll | 72f05758-5ad5-4dd9-8647-77ca907cef6c | SELLABLE_CANDIDATE | true/true/false/NULL | Each: ₱200.00 | ZERO_OPTION_VALID |
| Kani Roll | 58f07456-37be-4941-a5de-c9ecf6003f23 | SELLABLE_CANDIDATE | true/true/false/NULL | Each: ₱190.00 | ZERO_OPTION_VALID |
| Maguro Roll | c9458146-ec74-416b-bede-93e650e0df32 | SELLABLE_CANDIDATE | true/true/false/NULL | 8: ₱210.00 | ZERO_OPTION_VALID |
| Matcha Mousse Cheesecake | f6eabe70-a549-46b6-899c-e0d2e232bb3e | SELLABLE_CANDIDATE | true/true/false/NULL | Slice: ₱195.00 | ZERO_OPTION_VALID |
| Red Velvet | 77763809-2aff-4efd-81fe-7d9cbeedde96 | SELLABLE_CANDIDATE | true/true/false/NULL | 1pc: ₱95.00 | ZERO_OPTION_VALID |
| Salmon Kappa Roll | 526c2f4e-0708-4700-85c0-620135086e7e | SELLABLE_CANDIDATE | true/true/false/NULL | 8: ₱220.00 | ZERO_OPTION_VALID |
| Salmon Slices | 51722262-35b1-43f7-8d54-1fc6f2e98009 | SELLABLE_CANDIDATE | true/true/false/NULL | Pieces: ₱290.00 | ZERO_OPTION_VALID |
| Spring Rolls | c1e37535-db21-4a6c-8fab-2015e15f3bff | SELLABLE_CANDIDATE | true/true/false/NULL | 4 pcs: ₱160.00; 8 pcs: ₱320.00; PLATTER 16PCS: ₱630.00 | ZERO_OPTION_VALID |

## New excluded products relative to the reviewed scope (15)

| Product | Product UUID | Current state | Published | Available | Sold out | Archived | Relative to old inventory |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Avo Crab Roll | 07bf0c33-4c28-498b-9cc4-bc28c41e84b8 | UNAVAILABLE | true | false | false | NULL | Absent UUID; addition to reviewed scope; creation date unknown |
| Avo Smash Croiswhich | 2cc477e6-18ce-4680-81a7-b0f52da1f59a | UNAVAILABLE | true | false | false | NULL | Absent UUID; addition to reviewed scope; creation date unknown |
| Avocado Egg Croissant | 829687ba-67da-4fa3-9191-ccefeb25281b | UNPUBLISHED | false | true | false | NULL | Absent UUID; addition to reviewed scope; creation date unknown |
| Baked Lasagna | a21e8498-d754-4484-8d33-a7a7290a8fce | UNAVAILABLE | true | false | false | NULL | Absent UUID; addition to reviewed scope; creation date unknown |
| Chukawakame Salad | d5ff6fcc-ccd4-4d20-b4c2-76f4ccaa765a | UNAVAILABLE | true | false | false | NULL | Absent UUID; addition to reviewed scope; creation date unknown |
| Cream Chicken Fettucini | 1f7ef481-6cb1-4069-a65c-4d202b0b41ca | UNAVAILABLE | true | false | false | NULL | Absent UUID; addition to reviewed scope; creation date unknown |
| Crispy Fish Fillet Bowl | 7b72c99e-3f93-4791-b0f2-d9e0807bbbec | UNPUBLISHED | false | true | false | NULL | Absent UUID; addition to reviewed scope; creation date unknown |
| Double Chocolate Croissant | 4d261876-5949-48f9-89f7-f48ac9fe3d39 | UNAVAILABLE | true | false | false | NULL | Absent UUID; addition to reviewed scope; creation date unknown |
| Dragon Roll | 5a3205b4-db2a-46fc-a5a1-818d4c4d3750 | UNPUBLISHED | false | true | false | NULL | Absent UUID; addition to reviewed scope; creation date unknown |
| Mango Sunset Roll | 2d0dac96-3c20-4d06-acf8-6fc3f64ba0d0 | UNPUBLISHED | false | true | false | NULL | Absent UUID; addition to reviewed scope; creation date unknown |
| Matcha Cream Croissant | fdf901ab-fc5b-4518-ae8e-06f9e37c04a4 | UNAVAILABLE | true | false | false | NULL | Absent UUID; addition to reviewed scope; creation date unknown |
| Matcha Izou Cookies | a7e23a39-bc09-4929-ad3a-d3bbe3c62dd9 | UNAVAILABLE | true | false | false | NULL | Absent UUID; addition to reviewed scope; creation date unknown |
| Salmon Verde | a3a569e9-c9e1-46c7-b6f4-94205f169c77 | UNAVAILABLE | true | false | false | NULL | Absent UUID; addition to reviewed scope; creation date unknown |
| Tuna Croiswhich | 400d6168-45c8-4046-838e-7fc62dd548f9 | UNAVAILABLE | true | false | false | NULL | Absent UUID; addition to reviewed scope; creation date unknown |
| White Almond Croissant | 860c7f90-0b33-4cec-9cfa-894f5d59fe6f | UNAVAILABLE | true | false | false | NULL | Absent UUID; addition to reviewed scope; creation date unknown |

These 15 remain excluded. Do not certify or republish them as part of the current scope expansion. If their future status changes, review their recipe, identity, prices and option needs first.

## Possible replacements/renames

| Observation | IDs/evidence | Finding/action |
| --- | --- | --- |
| Reviewed UUIDs vs all 31 additions | All 62 original UUIDs still exist unchanged | No ID-based replacement or rename established. |
| Chicken Parmigiana vs Chicken Parmigiani | `e4d51b9f-15f0-488d-b184-bc1df8713936` vs `28e7272b-4fcf-4c39-a0ae-19a74d32a8d3`; both already reviewed and excluded | Possible spelling/legacy pair. Do not merge or activate; owner review only before future activation. Does not reduce current 59 sellable scope. |
| Avo Smash Croiswhich vs Avocado Egg Croissant | `2cc477e6-18ce-4680-81a7-b0f52da1f59a` vs `829687ba-67da-4fa3-9191-ccefeb25281b`; both additional and excluded | Similar food family is not proof of a replacement. Distinct recipes are possible; no identity inference or deletion. |
| Spring Rolls appears in multiple static menu sections | One production product UUID: `c1e37535-db21-4a6c-8fab-2015e15f3bff` | Duplicate presentation surfaces do not establish duplicate database products. |
| Flamed Salmon Roll vs Aburi Salmon | Roll has one Each size; Aburi Salmon remains a reviewed Takoyaki product with piece sizes and options | Different current menu roles; not evidence of replacement. |

No sellable anomaly qualifies as `DUPLICATE_OR_LEGACY_PRODUCT` from the available evidence. Names such as Classic Chocolate Chip and Red Velvet do not alone reveal detailed recipes; their price/size and zero-option structures are valid, and no required option rule is established.

## Products requiring owner decision

| Scope/product | Decision needed | Effect on proposed certification scope |
| --- | --- | --- |
| All 16 additional sellable UUIDs listed above | Confirm intentionally sellable and intentionally zero-option; approve their exact current size labels, size UUIDs and prices | Include all 16 unchanged if confirmed; do not invent required groups. |
| Spring Rolls | Confirm current 4 pcs / 8 pcs / PLATTER 16PCS prices of ₱160 / ₱320 / ₱630 | Local legacy display had ₱150 / ₱298 for its first two sizes. This is a price-review difference, not proof of invalidity; preserve server data pending owner confirmation. |
| Classic Chocolate Chip and Red Velvet | Confirm display identity/recipe and intended 1pc units | No current evidence of required customization; do not add options merely because names are brief. |
| New excluded products and existing Parmigiana/Parmigiani pair | No activation decision is needed for this recovery; review only if later offered for sale | Keep all 34 excluded from certification. |

The general 16-product confirmation includes Chicken Salad, Curv Salad, Coastal Salad and Spring Rolls. Their local menu metadata explicitly describes fixed recipes; dressing/sauces appear as ingredients, not selectors. Do not infer sauce/dressing customization. Sushi and dessert role labels are inferred from current names and the generic menu mechanism, not from absent exported category metadata.

## Products structurally safe to add unchanged

| Product | Product UUID | Classification | Evidence | Mapping action |
| --- | --- | --- | --- | --- |
| Blueberry Cheesecake | fb4bf2ff-796b-425a-9f0f-ee76009cd017 | ZERO_OPTION_VALID | Pastry/dessert role inferred from name; generic variant rendering; no known modifier contract | None; review intentional zero-option recipe and current prices |
| Chicken Salad | fc30f084-097d-414c-b56a-cf7046ee1435 | ZERO_OPTION_VALID | Named fixed-recipe food in SALAD_BAR_ITEM_META; no selectable option contract | None; review intentional zero-option recipe and current prices |
| Classic Cali Maki | 8c0dc38c-de30-4490-95e0-c83b099183a8 | ZERO_OPTION_VALID | Food/sushi role inferred from name; generic fixed-size rendering; no known modifier contract | None; review intentional zero-option recipe and current prices |
| Classic Chocolate Chip | f6d2542d-27f7-4245-ab48-6991237d40a5 | ZERO_OPTION_VALID | Pastry/dessert role inferred from name; generic variant rendering; no known modifier contract | None; review intentional zero-option recipe and current prices |
| Classic Newyork Cheesecake | 55403ee2-22f4-43b5-b0ef-b2e621203647 | ZERO_OPTION_VALID | Pastry/dessert role inferred from name; generic variant rendering; no known modifier contract | None; review intentional zero-option recipe and current prices |
| Coastal Salad | 717f388b-8ccf-4b4f-bc24-5df95c47e08c | ZERO_OPTION_VALID | Named fixed-recipe food in SALAD_BAR_ITEM_META; no selectable option contract | None; review intentional zero-option recipe and current prices |
| Curv Salad | 1ad31e1e-5904-4f3d-8fb3-42618fb96a48 | ZERO_OPTION_VALID | Named fixed-recipe food in SALAD_BAR_ITEM_META; no selectable option contract | None; review intentional zero-option recipe and current prices |
| Flamed Salmon Roll | 312fdb00-6abb-4983-b826-29f9061e4b11 | ZERO_OPTION_VALID | Food/sushi role inferred from name; generic fixed-size rendering; no known modifier contract | None; review intentional zero-option recipe and current prices |
| Futomaki Midori Roll | 72f05758-5ad5-4dd9-8647-77ca907cef6c | ZERO_OPTION_VALID | Food/sushi role inferred from name; generic fixed-size rendering; no known modifier contract | None; review intentional zero-option recipe and current prices |
| Kani Roll | 58f07456-37be-4941-a5de-c9ecf6003f23 | ZERO_OPTION_VALID | Food/sushi role inferred from name; generic fixed-size rendering; no known modifier contract | None; review intentional zero-option recipe and current prices |
| Maguro Roll | c9458146-ec74-416b-bede-93e650e0df32 | ZERO_OPTION_VALID | Food/sushi role inferred from name; generic fixed-size rendering; no known modifier contract | None; review intentional zero-option recipe and current prices |
| Matcha Mousse Cheesecake | f6eabe70-a549-46b6-899c-e0d2e232bb3e | ZERO_OPTION_VALID | Pastry/dessert role inferred from name; generic variant rendering; no known modifier contract | None; review intentional zero-option recipe and current prices |
| Red Velvet | 77763809-2aff-4efd-81fe-7d9cbeedde96 | ZERO_OPTION_VALID | Pastry/dessert role inferred from name; generic variant rendering; no known modifier contract | None; review intentional zero-option recipe and current prices |
| Salmon Kappa Roll | 526c2f4e-0708-4700-85c0-620135086e7e | ZERO_OPTION_VALID | Food/sushi role inferred from name; generic fixed-size rendering; no known modifier contract | None; review intentional zero-option recipe and current prices |
| Salmon Slices | 51722262-35b1-43f7-8d54-1fc6f2e98009 | ZERO_OPTION_VALID | Food/sushi role inferred from name; generic fixed-size rendering; no known modifier contract | None; review intentional zero-option recipe and current prices |
| Spring Rolls | c1e37535-db21-4a6c-8fab-2015e15f3bff | ZERO_OPTION_VALID | Named fixed-recipe food in SALAD_BAR_ITEM_META; no selectable option contract | None; review intentional zero-option recipe and current prices |

All 16 classifications are `ZERO_OPTION_VALID`. There are no `OPTION_CONFIGURATION_VALID` anomalies because none has option data. No sellable anomaly currently requires a demonstrated mapping repair, and there is no evidence supporting `DUPLICATE_OR_LEGACY_PRODUCT`. Owner acceptance of a zero-option recipe remains distinct from technical coverage validation.

## Recommended certification scope and remaining gates

Recommend **59 sellable products = the original 43 + these 16**, subject to explicit acceptance of the added scope and current prices/recipes. This means 35 option-configured products and 24 intentional zero-option products. All 34 excluded products stay out. No evidence warrants arbitrarily reducing the 59 count, certifying excluded products, altering assignments or deleting duplicates.

Do not execute the existing apply file: its fixed 62/43/19 scope and 43-product input are intentionally incompatible with this larger catalog. The current audit's `reviewed_manifest_template` also contains only the original 43 products, so changing numeric guards alone would be unsafe. After owner scope approval, a separately authorized audit revision/export must capture the full product/category before-images and independently reviewed authoritative structures for all 59 candidates. Certification preparation must preserve the existing 117/19/8/24/17 mapping checks and exact snapshot/coverage gates while expanding the product scope.

Only this report was created. Neither certification SQL file, the repair SQL/plan, option mappings nor inventory files were modified. No products were certified.
