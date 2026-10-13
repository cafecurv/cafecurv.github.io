# Proposed 59-product pricing certification scope

Status: OWNER REVIEW READY; proposed scope, not certification approval or execution.
Prepared: 2026-10-13 (Asia/Manila).

Source: local `admin/PRICING_CERTIFICATION_AUDIT_RESULT.txt` and `admin/PRICING_CERTIFICATION_SCOPE_RECONCILIATION.md`. Audit-export SHA-256: `3e3efecb4df79892860d90cd63bf7ab8a054d24d30e028d0a8a33a563bb1e113`. This document reflects that exported snapshot; no fresh production request was made. The two accented existing sellable names affected by console encoding are displayed using the exact matching reviewed manifest spellings (Cafè Mocha and Hojicha Brûlée). Product UUIDs are unchanged.

## Owner-review summary

- 16 additions reviewed; all 16 currently sellable, zero-option and structurally valid.
- 0 demonstrated structural or price-format defects requiring correction.
- Owner confirmation remains required for intentional states, zero-option recipes, prices and portion labels. A missing unit is a wording/portion question, not evidence of a required option group.
- Proposed total: 59 candidates = 43 EXISTING_REVIEWED_SCOPE + 16 NEW_ZERO_OPTION_VALID.
- 35 option-configured products and 24 zero-option products in the proposed scope.
- All 34 excluded products remain outside this document's certification scope.

## Detailed 16-product owner table

| Product UUID | Product | Published | Available | Sold out | Archived at | Every size/current price | Zero-option | Classification | Review note |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| fb4bf2ff-796b-425a-9f0f-ee76009cd017 | Blueberry Cheesecake | true | true | false | NULL | Slice — ₱170.00 | Yes | ZERO_OPTION_VALID | No older exact-price reference located; no coverage defect found. |
| fc30f084-097d-414c-b56a-cf7046ee1435 | Chicken Salad | true | true | false | NULL | Regular — ₱210.00 | Yes | ZERO_OPTION_VALID | Older menu price ₱210 matches; old seed label Each vs current Regular. |
| 8c0dc38c-de30-4490-95e0-c83b099183a8 | Classic Cali Maki | true | true | false | NULL | 8 — ₱180.00 | Yes | ZERO_OPTION_VALID | Label is literally 8; confirm its unit/portion. |
| f6d2542d-27f7-4245-ab48-6991237d40a5 | Classic Chocolate Chip | true | true | false | NULL | 1pc — ₱90.00 | Yes | ZERO_OPTION_VALID | No older exact-price reference located; no coverage defect found. |
| 55403ee2-22f4-43b5-b0ef-b2e621203647 | Classic Newyork Cheesecake | true | true | false | NULL | Slice — ₱180.00 | Yes | ZERO_OPTION_VALID | No older exact-price reference located; no coverage defect found. |
| 717f388b-8ccf-4b4f-bc24-5df95c47e08c | Coastal Salad | true | true | false | NULL | Regular — ₱180.00 | Yes | ZERO_OPTION_VALID | Older menu price ₱180 matches; old seed label Each vs current Regular. |
| 1ad31e1e-5904-4f3d-8fb3-42618fb96a48 | Curv Salad | true | true | false | NULL | Regular — ₱160.00 | Yes | ZERO_OPTION_VALID | Older menu price ₱160 matches; old seed label Each vs current Regular. |
| 312fdb00-6abb-4983-b826-29f9061e4b11 | Flamed Salmon Roll | true | true | false | NULL | Each — ₱220.00 | Yes | ZERO_OPTION_VALID | Each does not state a piece count; confirm portion. |
| 72f05758-5ad5-4dd9-8647-77ca907cef6c | Futomaki Midori Roll | true | true | false | NULL | Each — ₱200.00 | Yes | ZERO_OPTION_VALID | Each does not state a piece count; confirm portion. |
| 58f07456-37be-4941-a5de-c9ecf6003f23 | Kani Roll | true | true | false | NULL | Each — ₱190.00 | Yes | ZERO_OPTION_VALID | Each does not state a piece count; confirm portion. |
| c9458146-ec74-416b-bede-93e650e0df32 | Maguro Roll | true | true | false | NULL | 8 — ₱210.00 | Yes | ZERO_OPTION_VALID | Label is literally 8; confirm its unit/portion. |
| f6eabe70-a549-46b6-899c-e0d2e232bb3e | Matcha Mousse Cheesecake | true | true | false | NULL | Slice — ₱195.00 | Yes | ZERO_OPTION_VALID | No older exact-price reference located; no coverage defect found. |
| 77763809-2aff-4efd-81fe-7d9cbeedde96 | Red Velvet | true | true | false | NULL | 1pc — ₱95.00 | Yes | ZERO_OPTION_VALID | No older exact-price reference located; no coverage defect found. |
| 526c2f4e-0708-4700-85c0-620135086e7e | Salmon Kappa Roll | true | true | false | NULL | 8 — ₱220.00 | Yes | ZERO_OPTION_VALID | Label is literally 8; confirm its unit/portion. |
| 51722262-35b1-43f7-8d54-1fc6f2e98009 | Salmon Slices | true | true | false | NULL | Pieces — ₱290.00 | Yes | ZERO_OPTION_VALID | Pieces has no quantity; confirm portion. |
| c1e37535-db21-4a6c-8fab-2015e15f3bff | Spring Rolls | true | true | false | NULL | 4 pcs — ₱160.00; 8 pcs — ₱320.00; PLATTER 16PCS — ₱630.00 | Yes | ZERO_OPTION_VALID | Only multi-size addition. Older 4/8 pcs prices ₱150/₱298; current ₱160/₱320. Platter ₱630 is ₱10 below four 4-pc portions. |

## Explicit pricing and label review

Spring Rolls (`c1e37535-db21-4a6c-8fab-2015e15f3bff`) is the only multi-size addition:

| Exact current label | Current price | Older local menu price | Difference |
| --- | ---: | ---: | ---: |
| 4 pcs | ₱160.00 | ₱150.00 | +₱10.00 |
| 8 pcs | ₱320.00 | ₱298.00 | +₱22.00 |
| PLATTER 16PCS | ₱630.00 | No comparable reference found | Not determinable |

The platter is ₱10 less than four 4-pc portions (₱640) or two 8-pc portions (₱640). This can be intentional platter pricing; confirm rather than change it. Capitalization/spacing in PLATTER 16PCS differs from the other labels. The older prices appear in `menu/index.html` static markup; they are historical local references, not authoritative current prices.

Classic Cali Maki, Maguro Roll and Salmon Kappa Roll use the exact bare label `8`; its unit needs confirmation. Salmon Slices uses `Pieces` without a count. Flamed Salmon Roll, Futomaki Midori Roll and Kani Roll use `Each` without a piece count. These are accepted nonblank size labels and do not establish technical invalidity. The three salad prices match older menu markup; the seed draft's Each labels differ from current Regular labels. No other exact older numeric price comparison was established locally. Names, units and prices are preserved exactly; no correction is assumed.

## Complete proposed certification candidate manifest (59)

Each candidate is currently published, available, not sold out and unarchived in the supplied audit. EXISTING_REVIEWED_SCOPE identifies the original 43 sellable UUIDs; NEW_ZERO_OPTION_VALID identifies the 16 additions above. State here means observed in that snapshot, not independently owner-approved today.

| Product UUID | Product name | Published | Available | Sold out | Archived at | Observed state | Scope classification |
| --- | --- | --- | --- | --- | --- | --- | --- |
| ff9e0d6f-2a1b-4b6b-a401-e02370224f39 | Aburi Salmon | true | true | false | NULL | SELLABLE_CANDIDATE | EXISTING_REVIEWED_SCOPE |
| e684a6bd-aadc-4117-a018-ae0591c43d41 | Americano | true | true | false | NULL | SELLABLE_CANDIDATE | EXISTING_REVIEWED_SCOPE |
| f9e87759-6aa9-4bce-8b8b-3081ec913c01 | Berry Cloud Latte | true | true | false | NULL | SELLABLE_CANDIDATE | EXISTING_REVIEWED_SCOPE |
| fb4bf2ff-796b-425a-9f0f-ee76009cd017 | Blueberry Cheesecake | true | true | false | NULL | SELLABLE_CANDIDATE | NEW_ZERO_OPTION_VALID |
| e058ec46-f133-4982-afe6-cc6cf5e6d521 | Brown Sugar Cinnamon Cream Latte | true | true | false | NULL | SELLABLE_CANDIDATE | EXISTING_REVIEWED_SCOPE |
| 9c0d9e22-8843-4595-b789-7550c29890a4 | Cafè Mocha | true | true | false | NULL | SELLABLE_CANDIDATE | EXISTING_REVIEWED_SCOPE |
| aa156151-540b-4beb-b924-d97bf210af95 | Caramel Macchiato | true | true | false | NULL | SELLABLE_CANDIDATE | EXISTING_REVIEWED_SCOPE |
| 5498a571-8404-4a4f-a380-9cc0eaefc67c | Cheese Katsu Bowl | true | true | false | NULL | SELLABLE_CANDIDATE | EXISTING_REVIEWED_SCOPE |
| 5f5de117-2b8f-42d5-8b66-78f20339f544 | Chicken Bowl | true | true | false | NULL | SELLABLE_CANDIDATE | EXISTING_REVIEWED_SCOPE |
| 29187fbb-f9ab-42b7-ab29-82a0a1b3f0c5 | Chicken Karaage | true | true | false | NULL | SELLABLE_CANDIDATE | EXISTING_REVIEWED_SCOPE |
| fc30f084-097d-414c-b56a-cf7046ee1435 | Chicken Salad | true | true | false | NULL | SELLABLE_CANDIDATE | NEW_ZERO_OPTION_VALID |
| 8c0dc38c-de30-4490-95e0-c83b099183a8 | Classic Cali Maki | true | true | false | NULL | SELLABLE_CANDIDATE | NEW_ZERO_OPTION_VALID |
| f6d2542d-27f7-4245-ab48-6991237d40a5 | Classic Chocolate Chip | true | true | false | NULL | SELLABLE_CANDIDATE | NEW_ZERO_OPTION_VALID |
| 55403ee2-22f4-43b5-b0ef-b2e621203647 | Classic Newyork Cheesecake | true | true | false | NULL | SELLABLE_CANDIDATE | NEW_ZERO_OPTION_VALID |
| 610f399d-6fa3-46f1-b0b4-9fac6aa0ed5f | Classic Veggie | true | true | false | NULL | SELLABLE_CANDIDATE | EXISTING_REVIEWED_SCOPE |
| 8f072a83-552e-4e97-946d-9c306169415a | Cloud Spanish Oat Latte | true | true | false | NULL | SELLABLE_CANDIDATE | EXISTING_REVIEWED_SCOPE |
| 717f388b-8ccf-4b4f-bc24-5df95c47e08c | Coastal Salad | true | true | false | NULL | SELLABLE_CANDIDATE | NEW_ZERO_OPTION_VALID |
| c541decb-607c-44b1-8bed-4c19594c4422 | Cocoa Caramel Latte | true | true | false | NULL | SELLABLE_CANDIDATE | EXISTING_REVIEWED_SCOPE |
| a33f5d5a-fde1-4eb4-8604-1637b4afbf9a | Cream Dory Fillet | true | true | false | NULL | SELLABLE_CANDIDATE | EXISTING_REVIEWED_SCOPE |
| 8e1b82c6-8aea-4eb9-b591-184072c4f49e | Curv Chocolate | true | true | false | NULL | SELLABLE_CANDIDATE | EXISTING_REVIEWED_SCOPE |
| ec0956f8-8d28-414f-be46-2349e92bef76 | Curv Latte | true | true | false | NULL | SELLABLE_CANDIDATE | EXISTING_REVIEWED_SCOPE |
| 1ad31e1e-5904-4f3d-8fb3-42618fb96a48 | Curv Salad | true | true | false | NULL | SELLABLE_CANDIDATE | NEW_ZERO_OPTION_VALID |
| 7b59829b-b13b-4157-a0e8-ecb85bdbb8e4 | Curv Seasalt Latte | true | true | false | NULL | SELLABLE_CANDIDATE | EXISTING_REVIEWED_SCOPE |
| c26d3d79-38bf-4687-b3ca-eedfc1ed0e86 | Double Chocolate Chip Cream | true | true | false | NULL | SELLABLE_CANDIDATE | EXISTING_REVIEWED_SCOPE |
| cbeecaec-e9a5-4faa-b8f3-75b0cae549dd | Einspanner Latte | true | true | false | NULL | SELLABLE_CANDIDATE | EXISTING_REVIEWED_SCOPE |
| 312fdb00-6abb-4983-b826-29f9061e4b11 | Flamed Salmon Roll | true | true | false | NULL | SELLABLE_CANDIDATE | NEW_ZERO_OPTION_VALID |
| 72f05758-5ad5-4dd9-8647-77ca907cef6c | Futomaki Midori Roll | true | true | false | NULL | SELLABLE_CANDIDATE | NEW_ZERO_OPTION_VALID |
| ab350883-08eb-4b3a-b45a-03bb11f509a3 | Hibiscus Cream Tea | true | true | false | NULL | SELLABLE_CANDIDATE | EXISTING_REVIEWED_SCOPE |
| 93e9a33b-1a37-4edf-9d26-5ddd2d87f87d | Hojicha Banana Pudding Latte | true | true | false | NULL | SELLABLE_CANDIDATE | EXISTING_REVIEWED_SCOPE |
| e635744c-ed77-4924-a90d-c78440a81603 | Hojicha Brûlée | true | true | false | NULL | SELLABLE_CANDIDATE | EXISTING_REVIEWED_SCOPE |
| d053466a-2a52-420c-bc4c-62b5f614a27f | Hojicha Latte | true | true | false | NULL | SELLABLE_CANDIDATE | EXISTING_REVIEWED_SCOPE |
| 31886227-0130-45f7-8fb7-3d84682eed92 | Iced Shaken Vanilla Jelly | true | true | false | NULL | SELLABLE_CANDIDATE | EXISTING_REVIEWED_SCOPE |
| 56ca858c-58da-4ee3-9954-d189390cefb8 | Javachip Brownie Curvccino | true | true | false | NULL | SELLABLE_CANDIDATE | EXISTING_REVIEWED_SCOPE |
| 52f8ffc5-8f9b-41d2-9ecd-574ece1cf5e6 | Javachip Jelly Curvccino | true | true | false | NULL | SELLABLE_CANDIDATE | EXISTING_REVIEWED_SCOPE |
| 58f07456-37be-4941-a5de-c9ecf6003f23 | Kani Roll | true | true | false | NULL | SELLABLE_CANDIDATE | NEW_ZERO_OPTION_VALID |
| c1f44003-500d-46aa-9fe6-9bbf35c57415 | Lava Melt | true | true | false | NULL | SELLABLE_CANDIDATE | EXISTING_REVIEWED_SCOPE |
| 9eba0285-c567-4d8d-960a-4f2bed4a6bd7 | Lime Cucumber | true | true | false | NULL | SELLABLE_CANDIDATE | EXISTING_REVIEWED_SCOPE |
| c9458146-ec74-416b-bede-93e650e0df32 | Maguro Roll | true | true | false | NULL | SELLABLE_CANDIDATE | NEW_ZERO_OPTION_VALID |
| f6eabe70-a549-46b6-899c-e0d2e232bb3e | Matcha Mousse Cheesecake | true | true | false | NULL | SELLABLE_CANDIDATE | NEW_ZERO_OPTION_VALID |
| 24007d6c-e175-4dcf-9a6f-aab076e07b98 | OG Takoyaki | true | true | false | NULL | SELLABLE_CANDIDATE | EXISTING_REVIEWED_SCOPE |
| c027eedc-1807-4574-8f14-79ce07bb544e | Oozie Cheese | true | true | false | NULL | SELLABLE_CANDIDATE | EXISTING_REVIEWED_SCOPE |
| 6caefdb6-7daf-4e6d-a034-95fda0b7ecd7 | Pink Hojicha Latte | true | true | false | NULL | SELLABLE_CANDIDATE | EXISTING_REVIEWED_SCOPE |
| f4253ada-f15f-4fee-abea-c7678cd1fc06 | Pork Katsu Bowl | true | true | false | NULL | SELLABLE_CANDIDATE | EXISTING_REVIEWED_SCOPE |
| 77763809-2aff-4efd-81fe-7d9cbeedde96 | Red Velvet | true | true | false | NULL | SELLABLE_CANDIDATE | NEW_ZERO_OPTION_VALID |
| 526c2f4e-0708-4700-85c0-620135086e7e | Salmon Kappa Roll | true | true | false | NULL | SELLABLE_CANDIDATE | NEW_ZERO_OPTION_VALID |
| 51722262-35b1-43f7-8d54-1fc6f2e98009 | Salmon Slices | true | true | false | NULL | SELLABLE_CANDIDATE | NEW_ZERO_OPTION_VALID |
| 2c218e48-9871-41a3-bb12-19ced7b38321 | Salted Egg | true | true | false | NULL | SELLABLE_CANDIDATE | EXISTING_REVIEWED_SCOPE |
| 82417b58-d0c4-4d0d-a0cd-27da42b42627 | Sea Salt Cream Hojicha | true | true | false | NULL | SELLABLE_CANDIDATE | EXISTING_REVIEWED_SCOPE |
| 57cd4f38-2e5f-41ba-a117-83f5b2c66819 | Seasalt Dark Latte | true | true | false | NULL | SELLABLE_CANDIDATE | EXISTING_REVIEWED_SCOPE |
| 7a258d7e-5b74-44c8-93af-38b1fbd92765 | Spanish Latte | true | true | false | NULL | SELLABLE_CANDIDATE | EXISTING_REVIEWED_SCOPE |
| c1e37535-db21-4a6c-8fab-2015e15f3bff | Spring Rolls | true | true | false | NULL | SELLABLE_CANDIDATE | NEW_ZERO_OPTION_VALID |
| 8a078f3e-872d-47e0-a1df-c14f33af64c2 | Strawberries & Cream | true | true | false | NULL | SELLABLE_CANDIDATE | EXISTING_REVIEWED_SCOPE |
| 483eed35-dd1d-4a87-90a6-2161b3d1ef86 | Tokyo Sunrise | true | true | false | NULL | SELLABLE_CANDIDATE | EXISTING_REVIEWED_SCOPE |
| f716d196-47f0-46f4-af7e-bda068b95b2d | Tropic Kiss | true | true | false | NULL | SELLABLE_CANDIDATE | EXISTING_REVIEWED_SCOPE |
| 4ea4643e-5a61-402f-b9c4-8a29ae130c18 | Ube Cloud Latte | true | true | false | NULL | SELLABLE_CANDIDATE | EXISTING_REVIEWED_SCOPE |
| 54c6725f-4445-435c-bc1d-b779e5963796 | Vanilla Latte | true | true | false | NULL | SELLABLE_CANDIDATE | EXISTING_REVIEWED_SCOPE |
| dd5face3-df84-47ae-8ce1-9e2b565a91dd | White Caramel Curvccino | true | true | false | NULL | SELLABLE_CANDIDATE | EXISTING_REVIEWED_SCOPE |
| 45b1f92c-0daa-4ed2-af55-c5da97315c0a | White Chocolate Mocha | true | true | false | NULL | SELLABLE_CANDIDATE | EXISTING_REVIEWED_SCOPE |
| 3372a8c3-3208-4458-bb71-38c40c454436 | White Ube Latte | true | true | false | NULL | SELLABLE_CANDIDATE | EXISTING_REVIEWED_SCOPE |

## Readiness and remaining execution gates

The 59-product scope is technically suitable for certification preparation once the owner confirms the 16 current prices/states, intentionally zero-option recipes and portion meanings. No option-mapping change is demonstrated.

This Markdown document is not the frozen JSON certification input. The existing audit's reviewed_manifest_template contains only the old 43 candidates; the existing apply script intentionally retains its old 62/43/19 scope. Neither SQL file is changed here. A separately authorized audit/export revision must capture complete authoritative structures and product/category before-images for all 59, followed by independent snapshot review and a separately reviewed apply revision. Preserve all exact drift, coverage and fail-closed checks. Do not change counts alone and execute the old apply draft.

No SQL was executed; no production connection, price/mapping change or certification occurred.
