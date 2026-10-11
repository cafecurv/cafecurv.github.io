# Public menu option mapping repair plan — final inventory review

11 October 2026. Documentation only. Production CSVs govern actual UUIDs/state; current repository code establishes frontend behavior; latest owner rules govern desired behavior. This revision incorporates approved fixed savory sauces, explicitly iced Vanilla Jelly, five newer recipes and approved powder/spice/sweetener choices. No live connection, SQL execution, migration, application change, deployment, commit or push.

## A. Verified production inventory summary

| Export | Rows |
| --- | --- |
| A_OPTION_GROUPS.csv | 10 |
| B_OPTION_CHOICES.csv | 24 |
| C_PRODUCT_ASSIGNMENTS.csv | 11 |
| D_PRODUCT_DEFAULTS.csv | 1 |
| E_ADVANCED_CONFIGURATION.csv | 4 |
| F_PRODUCT_SIZE_INVENTORY.csv | 100 |
| G_CURRENT_FRONTEND_MAPPING_GAPS.csv | 44 |
| H_DUPLICATE_SIGNALS.csv | 0 |
| I_PUBLIC_OPTION_VIEW_DEFINITIONS.csv | 3 |

F contains **62 distinct products, 99 non-NULL size IDs and one NULL-size row**. Exactly **43 products / 79 size rows** are published and available; all also have active categories, no archive timestamp, are not sold out and are SELLABLE_CANDIDATE. The other **19 products / 21 rows** comprise 17 unpublished products and two unavailable products. This is the imported snapshot, not a new live check. No salads/sushi/pasta occur in this F export; do not append prior name-only guesses.

C has eleven active assignments across Brown Sugar Cinnamon Cream Latte (five), Curv Latte (five), Shrimp Tempura (one). All other F products have zero C assignments. Brown Sugar Temperature is optional 0/1, while Curv Temperature is required 1/1; the canonical backend requires 1/1 only when Temperature is assigned. Brown Sugar now retires that group entirely under the owner signature rule. Curv shot and syrup both sort at 2: not a duplicate assignment. D has only Shrimp → Tempura Sauce. Shrimp is unpublished, unavailable and archived; plan removal of its Bites Sauce default and deactivation of its assignment without republishing it.

E has four PRESENT_EMPTY status rows: zero underlying overrides, compatibility, requirements or certifications. H has zero duplicate signals. G contains 44 old-recipe diagnostics, including NULL product IDs for Caffè Mocha and Banana Fudge Matcha Latte. F contains Cafè Mocha and Banana Pudding Matcha Latte. Only the Mocha spelling correspondence is established by owner evidence; do not equate the banana recipes without approval.

I confirms all three public views use security_invoker=true, filtering published/available/non-archived products and active mappings/groups/choices. Definitions do not prove grants/RLS access or a live permissions outage. C exact_assignment_row/timestamps are NULL in the import; retain provenance and capture exact before-images during any future approved migration, never invent timestamps.

| Assignment UUID | Product UUID / name | Group UUID / key | Current required; min/max; sort |
| --- | --- | --- | --- |
| 6f954ddd-953d-4ee1-838d-4ed89967717b | e058ec46-f133-4982-afe6-cc6cf5e6d521 / Brown Sugar Cinnamon Cream Latte | 6f1074e8-f51a-41cd-a7f0-ed777418c916 / extra_shot | false; 0/NULL; 0 |
| e17e04ce-f596-4ecf-a205-3c3321620210 | e058ec46-f133-4982-afe6-cc6cf5e6d521 / Brown Sugar Cinnamon Cream Latte | 8a798579-ae21-47a2-8b84-6dc545b788bd / milk | false; 0/1; 1 |
| 5350612d-7b76-49c0-a50f-88024a7832ec | e058ec46-f133-4982-afe6-cc6cf5e6d521 / Brown Sugar Cinnamon Cream Latte | da657452-3dfe-4ba1-b695-26648180d999 / syrup | false; 0/NULL; 2 |
| 4995e604-4224-4ffd-9599-a6db02542836 | e058ec46-f133-4982-afe6-cc6cf5e6d521 / Brown Sugar Cinnamon Cream Latte | f16decf7-b5a4-4b98-8182-c9c2c9eca1f0 / sauce_beverage | false; 0/NULL; 3 |
| 14783335-981c-407a-8b52-4c032122538d | e058ec46-f133-4982-afe6-cc6cf5e6d521 / Brown Sugar Cinnamon Cream Latte | c6727e99-bae9-4963-a7cb-b238409667d9 / beverage_temperature | false; 0/1; 4 |
| a021fee7-ad9e-4373-9dc6-42d907c367da | ec0956f8-8d28-414f-be46-2349e92bef76 / Curv Latte | c6727e99-bae9-4963-a7cb-b238409667d9 / beverage_temperature | true; 1/1; 0 |
| 5f1415de-a4b1-426c-b018-e8dd768a482b | ec0956f8-8d28-414f-be46-2349e92bef76 / Curv Latte | 8a798579-ae21-47a2-8b84-6dc545b788bd / milk | false; 0/1; 1 |
| b5c04824-9419-4e96-9bd3-cb11741e045e | ec0956f8-8d28-414f-be46-2349e92bef76 / Curv Latte | 6f1074e8-f51a-41cd-a7f0-ed777418c916 / extra_shot | false; 0/NULL; 2 |
| 3943b67f-45f7-476d-beb3-4eafef17109c | ec0956f8-8d28-414f-be46-2349e92bef76 / Curv Latte | da657452-3dfe-4ba1-b695-26648180d999 / syrup | false; 0/NULL; 2 |
| 0ecc9017-5a9b-4832-8ec7-2b11bb33d968 | ec0956f8-8d28-414f-be46-2349e92bef76 / Curv Latte | f16decf7-b5a4-4b98-8182-c9c2c9eca1f0 / sauce_beverage | false; 0/NULL; 3 |
| da9742a2-5ab0-453e-89a8-583f0eff6a46 | ffcf04b4-1500-4463-aa25-3703a1e167ed / Shrimp Tempura | 5475e951-d4b1-46bf-a556-f63aecdf0fe2 / bites_sauce | true; 1/1; 0 |

## B. Canonical group plan

Use one active vocabulary: temperature, extrashot, milk, syrup, sauce, inclusions, sweetener, addons, cheese, plus approved new extrapower and spicy. Preserve all ten existing group UUIDs. Six active key renames are needed. Bites Sauce is retired from customer customization: leave its unused group/key/Tempura choice intact, with no public product assignments, rather than renaming it to an obsolete sauce_pref contract. This dormant library entry is not an alternative active vocabulary.

| Group UUID / name | Current → intended key | Current → intended type | Plan |
| --- | --- | --- | --- |
| 232d1301-d072-48ed-a363-6d5af6a6d906 / Add Cheese | add_cheese → cheese | single → single | Preserve UUID; normalize key |
| 5475e951-d4b1-46bf-a556-f63aecdf0fe2 / Bites Sauce | bites_sauce → bites_sauce | single → single | Retire all savory assignments/defaults; no selector; no new sauce choices |
| 6f1074e8-f51a-41cd-a7f0-ed777418c916 / Extra Espresso Shot | extra_shot → extrashot | multi → single | Preserve UUID; normalize key; optional 0/1 bounds |
| 516fb052-949a-43f5-8734-5b3f60bc76be / Inclusions | sinkers → inclusions | multi → multi | Preserve UUID; normalize key |
| f16decf7-b5a4-4b98-8182-c9c2c9eca1f0 / Sauce | sauce_beverage → sauce | multi → multi | Preserve UUID; normalize key |
| 1a3e299a-430c-4cf2-97c2-4d677e7019cd / Sweetener | sweetener → sweetener | multi → single | Preserve UUID; keep key; optional 0/1 bounds |
| da657452-3dfe-4ba1-b695-26648180d999 / Syrup | syrup → syrup | multi → multi | Preserve UUID; keep key |
| ff3aa2ce-e4ab-4870-98e1-93ff8078b534 / Takoyaki Add-ons | garnish → addons | multi → multi | Preserve UUID; normalize key |
| c6727e99-bae9-4963-a7cb-b238409667d9 / Temperature | beverage_temperature → temperature | single → single | Preserve UUID; normalize key |
| 8a798579-ae21-47a2-8b84-6dc545b788bd / Sub Milk | milk → milk | single → single | Preserve UUID; keep key |

Sauce and Inclusions retain structured production multi; Sweetener becomes single per approved historical behavior. Shot optional single and Syrup multi follow owner rules. NULL multi max allows distinct available choices, not repeated quantities; existing 64-choice-ID protocol bound remains. New Extra Powder and Spice Level groups have no existing UUID; allocate only on future authorized creation. Group presence is required by recipe contracts even when selection is optional. D0A.1/D0B temperature compatibility still requires literal temperature. Preserve historical snapshots and verify consumer/key collisions before any eventual migration.

## C. Choice plan

All 24 existing choices remain UUID-backed below; the Tempura Sauce library choice stays unused after savory retirement. No hard deletion.

| Choice UUID | Group / label | Exact value | Price delta | Action |
| --- | --- | --- | --- | --- |
| 3db8c36d-2e8e-4343-b8de-683b65070961 | Add Cheese / 12pcs | 12pcs | 90 | DEACTIVATE after complete conversion; preserve ID/history |
| 7c4e3426-a4ea-427c-ad73-b0815242e7c4 | Add Cheese / 4pcs | 4pcs | 30 | CHANGE label Add Cheese/value yes; keep UUID/base 30; contextual requirements |
| bab37892-3af1-4498-ad67-71271c9cad70 | Add Cheese / 8pcs | 8pcs | 60 | DEACTIVATE after complete conversion; preserve ID/history |
| ed7d2165-f29d-4ca7-b4d8-1e5bbb89d0a7 | Bites Sauce / Tempura Sauce | Tempura Sauce | 0 | KEEP ID/label/value/price/activity |
| 61c4fd98-6351-4daf-8074-f747da337c5c | Extra Espresso Shot / Add Espresso Shot | single_shot | 45 | KEEP ID/label/value/price/activity |
| bd6ff3fe-73c6-4f78-9f9e-8304af73ad5a | Extra Espresso Shot / Double Shot | double_shot | 90 | KEEP ID/label/value/price/activity |
| e07fcd14-ed31-427c-bd67-3067d5c71410 | Inclusions / Chocolate chips | chocolate_chips | 40 | KEEP ID/label/value/price/activity |
| e93da599-6652-44c5-80e9-f3d2dd1950ca | Inclusions / Coffee Jelly | coffee_jelly | 40 | KEEP ID/label/value/price/activity |
| 505ad026-b0c7-48a9-a1fb-011a4c8a17ef | Inclusions / White Chocolate Chips | white_chocolate_chips | 40 | KEEP ID/label/value/price/activity |
| c7b34dc7-1fe6-4825-bd50-65efb6a37c6c | Sauce / Chocolate | chocolate | 45 | KEEP ID/label/value/price/activity |
| 086c711e-a1b5-46cf-a5e0-f14394a95dfa | Sauce / Salted Caramel | salted_caramel | 45 | KEEP ID/label/value/price/activity |
| 6aea534b-4ead-43f1-af1a-0eb80afffc95 | Sauce / Strawberry | strawberry | 45 | KEEP ID/label/value/price/activity |
| f533a65f-da2e-462b-8c34-81eb061cfa11 | Sauce / White Chocolate | white_chocolate | 45 | KEEP ID/label/value/price/activity |
| 59203eed-e726-4582-a8a8-4d7c9001f338 | Syrup / Caramel | caramel | 30 | KEEP ID/label/value/price/activity |
| 4e07d4f6-9302-41fb-93f2-02fb9054aea6 | Syrup / Chocolate Syrup | chocolate_syrup | 30 | KEEP ID/label/value/price/activity |
| 47216d41-5c5e-4891-beb2-4189993f49df | Syrup / Vanilla | vanilla | 30 | KEEP ID/label/value/price/activity |
| a089875e-fde2-45ed-bafd-a14f16efbb5b | Syrup / White Chocolate Syrup | white_chocolate_syrup | 30 | KEEP ID/label/value/price/activity |
| d496995e-4e81-4298-b51e-6d316fc2de83 | Takoyaki Add-ons / Katsuboshi (Tuna Flakes) | katsuboshi_tuna_flakes | 30 | KEEP ID/label/value/price/activity |
| 722860cc-085a-4bf3-868e-52d7a877c0cb | Takoyaki Add-ons / Meat Floss | meat_floss | 40 | KEEP ID/label/value/price/activity |
| c9b382d8-5eee-4d50-a1dc-7ceed43b5fdc | Temperature / Hot | hot | 0 | KEEP ID/label/value/price/activity |
| c018fa7b-5cb5-490a-9d8a-7a5611a1bd67 | Temperature / Iced | iced | 0 | KEEP ID/label/value/price/activity |
| 04672e62-40c1-4595-955b-55ab7e2598fa | Sub Milk / Non-fat | non_fat | 30 | KEEP ID/label/value/price/activity |
| 049cc2e6-14d3-4892-abaf-a82b9cd6ed84 | Sub Milk / Oat | oat | 50 | KEEP ID/label/value/price/activity |
| cd6cfd0e-9826-4c16-bf1a-4d5305186fed | Sub Milk / Soy Milk | soy_milk | 30 | KEEP ID/label/value/price/activity |

Retain 7c4e3426-a4ea-427c-ad73-b0815242e7c4 as Add Cheese / yes with base 30 and required size prices. Deactivate old 8pcs/12pcs cheese choices only after complete contextual conversion. No None cheese choice; stale carts must reselect/requote.

Approved additions only (NEW means no existing UUID):

| Group | Exact label | Proposed stored value | Price | Authority |
| --- | --- | --- | --- | --- |
| NEW Extra Powder / extrapower | +1g | +1g Extra Powder | 45 | Owner approved +1g/+45; retain proven legacy value for compatibility |
| NEW Spice Level / spicy | Not Spicy | no | 0 | Owner approved |
| NEW Spice Level / spicy | Spicy | yes | 0 | Owner approved |
| Sweetener / sweetener | No Sweetener | no-sweetener | 0 | Owner approved; retain exact legacy value |
| Sweetener / sweetener | Simple Syrup | Simple Syrup | 0 | Owner approved |
| Sweetener / sweetener | Agave | Agave Syrup | 30 | Owner approved label/price; proven legacy stored value |
| Sweetener / sweetener | Honey | Honey | 30 | Owner approved |

Do not create Sweet Chili Sauce or Garlic Aioli option choices: they are fixed recipe ingredients. Do not create Breve, Coconut, Full Cream, additional Takoyaki add-ons, Brownies or other retired flavors. Approved live choice prices/values remain unchanged. Katsuboshi is not duplicated by alternate spelling. Milk groups use only live Non-fat/Oat/Soy choices. Built-in recipe milk is implicit. No Breve/Coconut choice, structured default or +0 override is needed solely to represent that ingredient. Sub Milk describes customer-selectable substitutions.

## D. Complete product assignment matrix

Every published + available F product is listed once. Rules below expand each referenced group into required/min/max/sort. NEW IDs are not fabricated. Owner-specific profiles, never category-wide mappings.

| Group | UUID | Selection required? | Min/max | Sort |
| --- | --- | --- | --- | --- |
| temperature | c6727e99-bae9-4963-a7cb-b238409667d9 | required | 1/1 | 10 |
| milk | 8a798579-ae21-47a2-8b84-6dc545b788bd | optional | 0/1 | 20 |
| extrashot | 6f1074e8-f51a-41cd-a7f0-ed777418c916 | optional | 0/1 | 30 |
| syrup | da657452-3dfe-4ba1-b695-26648180d999 | optional | 0/NULL | 40 |
| sauce | f16decf7-b5a4-4b98-8182-c9c2c9eca1f0 | optional | 0/NULL | 50 |
| inclusions | 516fb052-949a-43f5-8734-5b3f60bc76be | optional | 0/NULL | 60 |
| sweetener | 1a3e299a-430c-4cf2-97c2-4d677e7019cd | optional | 0/1 | 30 |
| extrapower | NEW | optional | 0/1 | 10 |
| spicy | NEW | optional | 0/1 | 10 |
| addons | ff3aa2ce-e4ab-4870-98e1-93ff8078b534 | optional | 0/NULL | 20 |
| cheese | 232d1301-d072-48ed-a363-6d5af6a6d906 | optional | 0/1 | 30 |

E = temperature/milk/extrashot/syrup/sauce for the seven classic milk espresso drinks only; SIG = milk/extrashot/syrup/sauce for six iced-only signatures; A = temperature/extrashot; ICED = milk/extrashot/syrup/sauce with NO temperature or inclusions; M = extrapower/milk/sweetener; C = syrup/sauce/inclusions, NO milk; R = syrup only; T = spicy/addons/cheese; Z = zero groups. Iced Shaken Vanilla Jelly retains espresso identity and built-in jelly, never selectable/removable. Savory sauces are built-in fixed recipes, not defaults/options.

| Product UUID / name | Category | Size UUID : label : price | Intended groups / UUIDs | Already assigned? | Frontend recognizes? | Change / reason |
| --- | --- | --- | --- | --- | --- | --- |
| 93e9a33b-1a37-4edf-9d26-5ddd2d87f87d / Hojicha Banana Pudding Latte | Matcha & Hojicha | d556028c-a0ec-42ab-bccd-f9a49b7a5593 : 18oz : 230 | extrapower [NEW]<br>milk [8a798579-ae21-47a2-8b84-6dc545b788bd]<br>sweetener [1a3e299a-430c-4cf2-97c2-4d677e7019cd] | No | Generic currently; approved profile must be synchronized | Apply explicit owner-approved new recipe |
| e635744c-ed77-4924-a90d-c78440a81603 / Hojicha Brûlée | Matcha & Hojicha | 3c71785d-f833-4834-8f24-70a789abb524 : Each : 230 | extrapower [NEW]<br>milk [8a798579-ae21-47a2-8b84-6dc545b788bd]<br>sweetener [1a3e299a-430c-4cf2-97c2-4d677e7019cd] | No | Generic currently; approved profile must be synchronized | Apply explicit owner-approved new recipe |
| d053466a-2a52-420c-bc4c-62b5f614a27f / Hojicha Latte | Matcha & Hojicha | c03cdc06-d031-430d-ae34-6a5eda87470f : Regular : 190 | extrapower [NEW]<br>milk [8a798579-ae21-47a2-8b84-6dc545b788bd]<br>sweetener [1a3e299a-430c-4cf2-97c2-4d677e7019cd] | No | Known local recipe; synchronize approved expectations | Synchronize approved mapping and readiness gates |
| 82417b58-d0c4-4d0d-a0cd-27da42b42627 / Sea Salt Cream Hojicha | Matcha & Hojicha | 0bcbf694-190c-4c47-9f3c-fa53000080a6 : Regular : 210 | extrapower [NEW]<br>milk [8a798579-ae21-47a2-8b84-6dc545b788bd]<br>sweetener [1a3e299a-430c-4cf2-97c2-4d677e7019cd] | No | Known local recipe; synchronize approved expectations | Synchronize approved mapping and readiness gates |
| 6caefdb6-7daf-4e6d-a034-95fda0b7ecd7 / Pink Hojicha Latte | Matcha & Hojicha | ae887c0b-ab06-4dc5-b9e7-3d8f11122c8a : Regular : 215 | extrapower [NEW]<br>milk [8a798579-ae21-47a2-8b84-6dc545b788bd]<br>sweetener [1a3e299a-430c-4cf2-97c2-4d677e7019cd] | No | Known local recipe; synchronize approved expectations | Synchronize approved mapping and readiness gates |
| e058ec46-f133-4982-afe6-cc6cf5e6d521 / Brown Sugar Cinnamon Cream Latte | Espresso | eab42649-051e-4504-a615-8dd2d5952e22 : Regular : 160<br>07a1c3aa-2d13-4001-bdb2-5980961c746c : Large : 170 | milk [8a798579-ae21-47a2-8b84-6dc545b788bd]<br>extrashot [6f1074e8-f51a-41cd-a7f0-ed777418c916]<br>syrup [da657452-3dfe-4ba1-b695-26648180d999]<br>sauce [f16decf7-b5a4-4b98-8182-c9c2c9eca1f0] | extrashot, milk, syrup, sauce, temperature | Generic currently; approved profile must be synchronized | Yes — SIGNATURE ICED-ONLY; no product-specific Hot evidence; remove Temperature contract; deactivate current Temperature assignment |
| 8f072a83-552e-4e97-946d-9c306169415a / Cloud Spanish Oat Latte | Espresso | ceb2866d-5cb3-4de9-b028-55113ef10d29 : Regular : 175<br>2cce7276-2989-4584-9ad6-d9a20cdb6861 : Large : 190 | milk [8a798579-ae21-47a2-8b84-6dc545b788bd]<br>extrashot [6f1074e8-f51a-41cd-a7f0-ed777418c916]<br>syrup [da657452-3dfe-4ba1-b695-26648180d999]<br>sauce [f16decf7-b5a4-4b98-8182-c9c2c9eca1f0] | No | Known local recipe; synchronize approved expectations | Yes — SIGNATURE ICED-ONLY; no product-specific Hot evidence; remove Temperature contract |
| ec0956f8-8d28-414f-be46-2349e92bef76 / Curv Latte | Espresso | 532bedff-2344-4ff8-ac82-e3d958062a9f : Regular : 130<br>ee6f7767-1f35-4cbc-9e14-0e314988b15e : Large : 145 | temperature [c6727e99-bae9-4963-a7cb-b238409667d9]<br>milk [8a798579-ae21-47a2-8b84-6dc545b788bd]<br>extrashot [6f1074e8-f51a-41cd-a7f0-ed777418c916]<br>syrup [da657452-3dfe-4ba1-b695-26648180d999]<br>sauce [f16decf7-b5a4-4b98-8182-c9c2c9eca1f0] | temperature, milk, extrashot, syrup, sauce | Known local recipe; synchronize approved expectations | Synchronize approved mapping and readiness gates |
| 7b59829b-b13b-4157-a0e8-ecb85bdbb8e4 / Curv Seasalt Latte | Espresso | 6839607d-ad9f-42c3-8c9f-bc294c6b7704 : Regular : 150<br>63a31ec4-a828-4ae3-9ded-f5b14308c100 : Large : 160 | milk [8a798579-ae21-47a2-8b84-6dc545b788bd]<br>extrashot [6f1074e8-f51a-41cd-a7f0-ed777418c916]<br>syrup [da657452-3dfe-4ba1-b695-26648180d999]<br>sauce [f16decf7-b5a4-4b98-8182-c9c2c9eca1f0] | No | Generic currently; approved profile must be synchronized | Yes — SIGNATURE ICED-ONLY; no product-specific Hot evidence; remove Temperature contract |
| 31886227-0130-45f7-8fb7-3d84682eed92 / Iced Shaken Vanilla Jelly | Espresso | 0a801b3b-b9f3-4801-a42c-3f3e9fc0fe8f : Regular : 160<br>224501f6-fca2-4270-8b55-82c2a149c8ce : Large : 170 | milk [8a798579-ae21-47a2-8b84-6dc545b788bd]<br>extrashot [6f1074e8-f51a-41cd-a7f0-ed777418c916]<br>syrup [da657452-3dfe-4ba1-b695-26648180d999]<br>sauce [f16decf7-b5a4-4b98-8182-c9c2c9eca1f0] | No | Generic currently; approved profile must be synchronized | Owner approved explicitly iced; jelly built in; four groups only |
| 57cd4f38-2e5f-41ba-a117-83f5b2c66819 / Seasalt Dark Latte | Espresso | 3a397e0c-464d-44bb-ba6c-6342a7f73333 : Regular : 165<br>2591a69e-3b22-4a9d-8076-b110caa6eb8d : Large : 180 | milk [8a798579-ae21-47a2-8b84-6dc545b788bd]<br>extrashot [6f1074e8-f51a-41cd-a7f0-ed777418c916]<br>syrup [da657452-3dfe-4ba1-b695-26648180d999]<br>sauce [f16decf7-b5a4-4b98-8182-c9c2c9eca1f0] | No | Generic currently; approved profile must be synchronized | Yes — SIGNATURE ICED-ONLY; no product-specific Hot evidence; remove Temperature contract |
| cbeecaec-e9a5-4faa-b8f3-75b0cae549dd / Einspanner Latte | Espresso | 7da598a2-f675-4764-ba83-f923af768561 : Regular : 150<br>cd302ffe-1919-4ac8-8088-4e730fb12113 : Large : 160 | temperature [c6727e99-bae9-4963-a7cb-b238409667d9]<br>milk [8a798579-ae21-47a2-8b84-6dc545b788bd]<br>extrashot [6f1074e8-f51a-41cd-a7f0-ed777418c916]<br>syrup [da657452-3dfe-4ba1-b695-26648180d999]<br>sauce [f16decf7-b5a4-4b98-8182-c9c2c9eca1f0] | No | Known local recipe; synchronize approved expectations | Synchronize approved mapping and readiness gates |
| 7a258d7e-5b74-44c8-93af-38b1fbd92765 / Spanish Latte | Espresso | 95c5e2d6-75de-4b68-8fbb-e9b81ac58ebc : Regular : 140<br>debd8f6b-3a87-4044-825c-91ab7342e1ec : Large : 150 | temperature [c6727e99-bae9-4963-a7cb-b238409667d9]<br>milk [8a798579-ae21-47a2-8b84-6dc545b788bd]<br>extrashot [6f1074e8-f51a-41cd-a7f0-ed777418c916]<br>syrup [da657452-3dfe-4ba1-b695-26648180d999]<br>sauce [f16decf7-b5a4-4b98-8182-c9c2c9eca1f0] | No | Known local recipe; synchronize approved expectations | Synchronize approved mapping and readiness gates |
| aa156151-540b-4beb-b924-d97bf210af95 / Caramel Macchiato | Espresso | 1ca62e3c-86bc-4655-8ba6-2d972369a93f : Regular : 160<br>02a2d179-2921-4c13-ac21-67a4c7b2d5ad : Large : 175 | temperature [c6727e99-bae9-4963-a7cb-b238409667d9]<br>milk [8a798579-ae21-47a2-8b84-6dc545b788bd]<br>extrashot [6f1074e8-f51a-41cd-a7f0-ed777418c916]<br>syrup [da657452-3dfe-4ba1-b695-26648180d999]<br>sauce [f16decf7-b5a4-4b98-8182-c9c2c9eca1f0] | No | Known local recipe; synchronize approved expectations | Synchronize approved mapping and readiness gates |
| 54c6725f-4445-435c-bc1d-b779e5963796 / Vanilla Latte | Espresso | 3b21ccce-2fa8-4c83-b4c9-392b7c9db398 : Regular : 140<br>bfc35a0a-d71d-4e0a-9da7-7a99fc95158e : Large : 150 | temperature [c6727e99-bae9-4963-a7cb-b238409667d9]<br>milk [8a798579-ae21-47a2-8b84-6dc545b788bd]<br>extrashot [6f1074e8-f51a-41cd-a7f0-ed777418c916]<br>syrup [da657452-3dfe-4ba1-b695-26648180d999]<br>sauce [f16decf7-b5a4-4b98-8182-c9c2c9eca1f0] | No | Known local recipe; synchronize approved expectations | Synchronize approved mapping and readiness gates |
| e684a6bd-aadc-4117-a018-ae0591c43d41 / Americano | Espresso | fe0c4074-ba4e-4c68-8e55-adf71b2577cc : Regular : 120<br>f723ca06-a515-4712-ae81-aa889783a498 : Large : 125 | temperature [c6727e99-bae9-4963-a7cb-b238409667d9]<br>extrashot [6f1074e8-f51a-41cd-a7f0-ed777418c916] | No | Known local recipe; synchronize approved expectations | Synchronize approved mapping and readiness gates |
| 9c0d9e22-8843-4595-b789-7550c29890a4 / Cafè Mocha | Espresso | 909ac7fa-e743-4848-87fa-7ec68304b9a1 : Regular : 160<br>86f8242b-128b-4474-beb3-7e7f5f56a9d6 : Large : 170 | temperature [c6727e99-bae9-4963-a7cb-b238409667d9]<br>milk [8a798579-ae21-47a2-8b84-6dc545b788bd]<br>extrashot [6f1074e8-f51a-41cd-a7f0-ed777418c916]<br>syrup [da657452-3dfe-4ba1-b695-26648180d999]<br>sauce [f16decf7-b5a4-4b98-8182-c9c2c9eca1f0] | No | Generic currently; approved profile must be synchronized | Synchronize approved mapping and readiness gates |
| 45b1f92c-0daa-4ed2-af55-c5da97315c0a / White Chocolate Mocha | Espresso | 4a36f492-2cb1-49a6-93a2-d422a7ca5674 : Regular : 160<br>b33ef270-1e14-43a5-99ff-837ccab47f78 : Large : 170 | temperature [c6727e99-bae9-4963-a7cb-b238409667d9]<br>milk [8a798579-ae21-47a2-8b84-6dc545b788bd]<br>extrashot [6f1074e8-f51a-41cd-a7f0-ed777418c916]<br>syrup [da657452-3dfe-4ba1-b695-26648180d999]<br>sauce [f16decf7-b5a4-4b98-8182-c9c2c9eca1f0] | No | Known local recipe; synchronize approved expectations | Synchronize approved mapping and readiness gates |
| 3372a8c3-3208-4458-bb71-38c40c454436 / White Ube Latte | Espresso | 1e83b774-cd11-48b1-861a-8a693961cca2 : Regular : 160<br>23b7d6b1-3a12-4e5e-8350-ea6580930afb : Large : 170 | milk [8a798579-ae21-47a2-8b84-6dc545b788bd]<br>extrashot [6f1074e8-f51a-41cd-a7f0-ed777418c916]<br>syrup [da657452-3dfe-4ba1-b695-26648180d999]<br>sauce [f16decf7-b5a4-4b98-8182-c9c2c9eca1f0] | No | Known local recipe; synchronize approved expectations | Yes — SIGNATURE ICED-ONLY; no product-specific Hot evidence; remove Temperature contract |
| c541decb-607c-44b1-8bed-4c19594c4422 / Cocoa Caramel Latte | Espresso | b62f9a1d-22d6-4361-9d1e-da8145e2dc84 : Regular : 165<br>d0eb7d57-affd-4504-a438-18d68129a2ed : Large : 175 | milk [8a798579-ae21-47a2-8b84-6dc545b788bd]<br>extrashot [6f1074e8-f51a-41cd-a7f0-ed777418c916]<br>syrup [da657452-3dfe-4ba1-b695-26648180d999]<br>sauce [f16decf7-b5a4-4b98-8182-c9c2c9eca1f0] | No | Known local recipe; synchronize approved expectations | Yes — SIGNATURE ICED-ONLY; no product-specific Hot evidence; remove Temperature contract |
| 8e1b82c6-8aea-4eb9-b591-184072c4f49e / Curv Chocolate | Espresso | af75c6d2-1ab5-4813-a1e3-17f29a7363d3 : Regular : 150 | ZERO groups; bounds/sort N/A | No | Generic currently; approved profile must be synchronized | No options; validate sizes and certify |
| 4ea4643e-5a61-402f-b9c4-8a29ae130c18 / Ube Cloud Latte | Espresso | 188b98e9-6ffd-4ab9-bbfa-536ee12dcea6 : Regular : 150<br>3ce52e6f-bdb2-4927-aa78-913b1f43cd06 : Large : 160 | ZERO groups; bounds/sort N/A | No | Generic currently; approved profile must be synchronized | No options; validate sizes and certify |
| f9e87759-6aa9-4bce-8b8b-3081ec913c01 / Berry Cloud Latte | Espresso | 4d2c664e-55fd-42ed-a909-90de0bcd0474 : Regular : 150<br>9c491be7-f397-41ce-a39f-3f0487f94552 : Large : 160 | ZERO groups; bounds/sort N/A | No | Generic currently; approved profile must be synchronized | No options; validate sizes and certify |
| c26d3d79-38bf-4687-b3ca-eedfc1ed0e86 / Double Chocolate Chip Cream | Curvccino | 54b50f90-eee1-404f-b2a2-e977c42177d6 : Regular : 170<br>909d8758-5f95-4392-b00f-70d6a068677d : Large : 185 | syrup [da657452-3dfe-4ba1-b695-26648180d999]<br>sauce [f16decf7-b5a4-4b98-8182-c9c2c9eca1f0]<br>inclusions [516fb052-949a-43f5-8734-5b3f60bc76be] | No | Known local recipe; synchronize approved expectations | Synchronize approved mapping and readiness gates |
| 56ca858c-58da-4ee3-9954-d189390cefb8 / Javachip Brownie Curvccino | Curvccino | 01361b2b-85ad-4198-bcb9-e1756c5c944e : Regular : 170<br>146a28d2-4952-4d9b-bbd9-2dd49a400dd7 : Large : 185 | syrup [da657452-3dfe-4ba1-b695-26648180d999]<br>sauce [f16decf7-b5a4-4b98-8182-c9c2c9eca1f0]<br>inclusions [516fb052-949a-43f5-8734-5b3f60bc76be] | No | Known local recipe; synchronize approved expectations | Synchronize approved mapping and readiness gates |
| 52f8ffc5-8f9b-41d2-9ecd-574ece1cf5e6 / Javachip Jelly Curvccino | Curvccino | c8fc1be6-ae4e-474d-80b6-ad25733a9732 : Regular : 170<br>5cebc026-3ba3-4046-85a7-d3680ceaf64e : Large : 185 | syrup [da657452-3dfe-4ba1-b695-26648180d999]<br>sauce [f16decf7-b5a4-4b98-8182-c9c2c9eca1f0]<br>inclusions [516fb052-949a-43f5-8734-5b3f60bc76be] | No | Known local recipe; synchronize approved expectations | Synchronize approved mapping and readiness gates |
| 8a078f3e-872d-47e0-a1df-c14f33af64c2 / Strawberries & Cream | Curvccino | b434b87a-549a-454b-8cd6-2fe63f1cfd87 : Regular : 160<br>6a99db42-63e1-4487-9507-890fb6e4edbc : Large : 175 | syrup [da657452-3dfe-4ba1-b695-26648180d999]<br>sauce [f16decf7-b5a4-4b98-8182-c9c2c9eca1f0]<br>inclusions [516fb052-949a-43f5-8734-5b3f60bc76be] | No | Known local recipe; synchronize approved expectations | Synchronize approved mapping and readiness gates |
| dd5face3-df84-47ae-8ce1-9e2b565a91dd / White Caramel Curvccino | Curvccino | 5abfda87-d4af-4cec-bfe3-5988905077e7 : Regular : 175<br>c78a6543-63b9-48c1-a66c-b4092feddf06 : Large : 190 | syrup [da657452-3dfe-4ba1-b695-26648180d999]<br>sauce [f16decf7-b5a4-4b98-8182-c9c2c9eca1f0]<br>inclusions [516fb052-949a-43f5-8734-5b3f60bc76be] | No | Known local recipe; synchronize approved expectations | Synchronize approved mapping and readiness gates |
| f716d196-47f0-46f4-af7e-bda068b95b2d / Tropic Kiss | Refreshers | cf269f21-df3b-4e02-84e3-83a6779682e2 : Regular : 150<br>6e801849-3926-46ef-ba2a-5add950652da : Large : 165 | syrup [da657452-3dfe-4ba1-b695-26648180d999] | No | Known local recipe; synchronize approved expectations | Synchronize approved mapping and readiness gates |
| 483eed35-dd1d-4a87-90a6-2161b3d1ef86 / Tokyo Sunrise | Refreshers | f520ad40-773e-4dea-a1b6-18a7e28bb730 : Regular : 160<br>6028319c-d276-4d9a-9e6e-f74720e8ab4b : Large : 170 | syrup [da657452-3dfe-4ba1-b695-26648180d999] | No | Known local recipe; synchronize approved expectations | Synchronize approved mapping and readiness gates |
| ab350883-08eb-4b3a-b45a-03bb11f509a3 / Hibiscus Cream Tea | Refreshers | dd268425-3250-469b-a36f-747e02bcd63b : Regular : 150<br>7725e0cb-ce7b-4a9b-affa-8b46717d698a : Large : 160 | syrup [da657452-3dfe-4ba1-b695-26648180d999] | No | Known local recipe; synchronize approved expectations | Synchronize approved mapping and readiness gates |
| 9eba0285-c567-4d8d-960a-4f2bed4a6bd7 / Lime Cucumber | Refreshers | 4769d47e-2ed4-4143-9674-ecd705c36fae : Regular : 150<br>946e66ce-9904-4595-a68c-6351cbccf725 : Large : 160 | syrup [da657452-3dfe-4ba1-b695-26648180d999] | No | Known local recipe; synchronize approved expectations | Synchronize approved mapping and readiness gates |
| 24007d6c-e175-4dcf-9a6f-aab076e07b98 / OG Takoyaki | Takoyaki & Savory Bites | 3c436f01-a9d6-4c70-a2a3-2c35f6d78635 : 4pcs : 90<br>b7b88390-fccf-4124-9346-4cc1afd80e5c : 8pcs : 150<br>bbce5f8f-db50-40e4-8bce-ec8d4a1c685d : 12pcs : 220 | spicy [NEW]<br>addons [ff3aa2ce-e4ab-4870-98e1-93ff8078b534]<br>cheese [232d1301-d072-48ed-a363-6d5af6a6d906] | No | Known local recipe; synchronize approved expectations | Synchronize approved mapping and readiness gates |
| ff9e0d6f-2a1b-4b6b-a401-e02370224f39 / Aburi Salmon | Takoyaki & Savory Bites | 5092934c-919e-4c53-8890-ca29316aa551 : 4pcs : 105<br>22fbd2e7-7c33-4e4d-b3a2-ccf0860cb322 : 8pcs : 200<br>30df5f88-3760-4e46-bb52-a304e2fa2f42 : 12pcs : 300 | spicy [NEW]<br>addons [ff3aa2ce-e4ab-4870-98e1-93ff8078b534]<br>cheese [232d1301-d072-48ed-a363-6d5af6a6d906] | No | Known local recipe; synchronize approved expectations | Synchronize approved mapping and readiness gates |
| 29187fbb-f9ab-42b7-ab29-82a0a1b3f0c5 / Chicken Karaage | Takoyaki & Savory Bites | e2e1b618-fb4a-4d12-9d57-c34e351f036c : Regular : 160 | ZERO groups; bounds/sort N/A | No | Known local recipe; synchronize approved expectations | Remove sauce selector and fail-closed sauce contract; fixed recipe |
| a33f5d5a-fde1-4eb4-8604-1637b4afbf9a / Cream Dory Fillet | Takoyaki & Savory Bites | fa187849-fc74-4bc6-937c-d287e84e382d : Regular : 160 | ZERO groups; bounds/sort N/A | No | Known local recipe; synchronize approved expectations | Remove sauce selector and fail-closed sauce contract; fixed recipe |
| c027eedc-1807-4574-8f14-79ce07bb544e / Oozie Cheese | Takoyaki & Savory Bites | a5f59fd4-ce5c-4049-87a0-9b6d41faf246 : 4pcs : 90<br>d0c8adf8-2398-441a-9880-eeead91ea6fe : 8pcs : 150<br>836b56fc-ec63-49d6-9e3f-7be32c233888 : 12pcs : 220 | spicy [NEW]<br>addons [ff3aa2ce-e4ab-4870-98e1-93ff8078b534]<br>cheese [232d1301-d072-48ed-a363-6d5af6a6d906] | No | Known local recipe; synchronize approved expectations | Synchronize approved mapping and readiness gates |
| c1f44003-500d-46aa-9fe6-9bbf35c57415 / Lava Melt | Takoyaki & Savory Bites | b958356c-1e4e-44ea-8c1f-f61683bd2a80 : 4pcs : 95<br>0cfceeae-1a12-47a4-b544-1c53395c82d3 : 8pcs : 165<br>43394c3a-2256-40bc-bcdd-89b5aeb69556 : 12pcs : 230 | spicy [NEW]<br>addons [ff3aa2ce-e4ab-4870-98e1-93ff8078b534]<br>cheese [232d1301-d072-48ed-a363-6d5af6a6d906] | No | Known local recipe; synchronize approved expectations | Synchronize approved mapping and readiness gates |
| 610f399d-6fa3-46f1-b0b4-9fac6aa0ed5f / Classic Veggie | Takoyaki & Savory Bites | d37cf9b3-8742-4a0e-aa17-fc2df384cc5d : 8pcs : 140<br>81c30dcf-9bae-4055-a1c4-2d46e3ca0ad3 : 12pcs : 200 | spicy [NEW]<br>addons [ff3aa2ce-e4ab-4870-98e1-93ff8078b534]<br>cheese [232d1301-d072-48ed-a363-6d5af6a6d906] | No | Known local recipe; synchronize approved expectations | Synchronize approved mapping and readiness gates |
| 2c218e48-9871-41a3-bb12-19ced7b38321 / Salted Egg | Takoyaki & Savory Bites | 6fdd4f4b-481d-4fbc-9459-4208dff71006 : 8pcs : 165<br>fe484ccc-5a71-48e1-bb6a-fa4535002836 : 12pcs : 230 | spicy [NEW]<br>addons [ff3aa2ce-e4ab-4870-98e1-93ff8078b534]<br>cheese [232d1301-d072-48ed-a363-6d5af6a6d906] | No | Known local recipe; synchronize approved expectations | Synchronize approved mapping and readiness gates |
| 5498a571-8404-4a4f-a380-9cc0eaefc67c / Cheese Katsu Bowl | Mains | 27425966-32e5-4ad1-ac14-1f23ab5ecb07 : Each : 220 | ZERO groups; bounds/sort N/A | No | Generic currently; approved profile must be synchronized | No options; validate sizes and certify |
| f4253ada-f15f-4fee-abea-c7678cd1fc06 / Pork Katsu Bowl | Mains | 843284d9-b64c-4586-b183-b8f215b49fb3 : Regular : 210 | ZERO groups; bounds/sort N/A | No | Generic currently; approved profile must be synchronized | No options; validate sizes and certify |
| 5f5de117-2b8f-42d5-8b66-78f20339f544 / Chicken Bowl | Mains | 573b1fdd-8298-42d8-9acf-605c6529cc98 : Regular : 180 | ZERO groups; bounds/sort N/A | No | Generic currently; approved profile must be synchronized | No options; validate sizes and certify |

### Excluded products — retain publication state

| Product UUID / name | Current state / flags | Size UUID : label : price | Disposition |
| --- | --- | --- | --- |
| b0786602-49eb-4170-b735-a3e265835608 / CS Matcha Oat Latte | UNPUBLISHED; available=true, published=false, archived=null | 764194ca-cc27-406a-b24d-0e0941ab785d : Regular : 195 | NOT_CURRENTLY_SELLABLE; no activation or certification |
| 558135d9-c065-4da9-b577-530c0b66c337 / Kagoshima Matcha Cream | UNPUBLISHED; available=false, published=false, archived=null | f0874aa3-354f-4720-b26d-685ab03c91eb : Regular : 220 | NOT_CURRENTLY_SELLABLE; no activation or certification |
| 0e810492-09eb-4a36-89e9-cd263a3c4058 / Matcha Sunrise | UNPUBLISHED; available=false, published=false, archived=null | 2937253e-4ff4-493e-97b3-fe5e6169148d : Regular : 220 | NOT_CURRENTLY_SELLABLE; no activation or certification |
| 77188ef3-b97e-4411-896a-85beeb61abec / Matcha Ube Latte | UNPUBLISHED; available=true, published=false, archived=null | fe76de04-b034-4209-84b8-12bd8ba64ac7 : Regular : 230 | NOT_CURRENTLY_SELLABLE; no activation or certification |
| 4077bbcf-f13a-4295-8562-503692125c01 / Matcha Brûlée | UNPUBLISHED; available=true, published=false, archived=null | 38ea1891-96f2-4102-a39c-0d1635b493f3 : Each : 240 | NOT_CURRENTLY_SELLABLE; no activation or certification |
| 4b9149b7-f2d5-4d19-bcd8-a3bf880b1bed / Sea Salt Cream Matcha Latte | UNPUBLISHED; available=true, published=false, archived=null | 8370bd5d-6940-46c3-8bca-4924876670e9 : Regular : 215 | NOT_CURRENTLY_SELLABLE; no activation or certification |
| 405517fc-1c5e-4386-b21d-d1aaa6dea8a7 / Banana Pudding Matcha Latte | UNPUBLISHED; available=true, published=false, archived=null | e51303d4-6125-45f5-a426-85adb4052f46 : Regular : 240 | NOT_CURRENTLY_SELLABLE; no activation or certification |
| 7765a2ac-5133-476d-898d-35d42d3de5fc / Einspanner Matcha | UNPUBLISHED; available=true, published=false, archived=null | 2edf70ec-87ac-4151-9e49-9e54e6a9c8c4 : Regular : 220 | NOT_CURRENTLY_SELLABLE; no activation or certification |
| 7fcf6e11-6946-4270-8114-5411ec6e2c71 / Cookie Crumb Matcha Latte | UNPUBLISHED; available=true, published=false, archived=null | 56125b2b-22a3-4954-82e5-9e7bf110c5e9 : Regular : 240 | NOT_CURRENTLY_SELLABLE; no activation or certification |
| 837f9adf-efd6-4e80-8323-c8e87550c0a5 / Strawberry Matcha Latte | UNPUBLISHED; available=true, published=false, archived=null | c651dd9a-5cfb-4641-9ac2-fda88830e41f : Regular : 220 | NOT_CURRENTLY_SELLABLE; no activation or certification |
| e8ec71af-a30d-472a-b1cf-723c60d21d0b / Double Matcha Cloud | UNPUBLISHED; available=true, published=false, archived=null | 37a7e9ff-69d2-4041-9d53-0ce558296d9e : Regular : 240 | NOT_CURRENTLY_SELLABLE; no activation or certification |
| a88249e4-f2a9-4ef5-801f-644c7e142831 / Pure Usucha | UNPUBLISHED; available=true, published=false, archived=null | efccd7a8-4871-4dc2-9d58-592d72ee2199 : Regular : 170 | NOT_CURRENTLY_SELLABLE; no activation or certification |
| a3851bd7-6cb7-4dec-a834-1b26d39d712f / Pitaya Mango Cream | UNAVAILABLE; available=false, published=true, archived=null | 0bec2e00-4820-4759-b9a0-16d5070bfdb3 : R : 160<br>c7a308a6-cd38-44ad-95ef-ffc0147f0e9a : L : 175 | NOT_CURRENTLY_SELLABLE; no activation or certification |
| c73dfa99-a16c-4e53-b369-dd56f5e3494b / Dragon Dreams | UNAVAILABLE; available=false, published=true, archived=null | b68ecd24-3ca9-4c33-97e3-471ddd558644 : Regular : 160<br>46ad4a08-f823-4d26-bb00-8cbfd21c4e18 : Large : 170 | NOT_CURRENTLY_SELLABLE; no activation or certification |
| ffcf04b4-1500-4463-aa25-3703a1e167ed / Shrimp Tempura | UNPUBLISHED; available=false, published=false, archived=2026-09-02T08:49:37.342083+00:00 | 4d24013d-2c10-4ce1-80cb-4003aa07adae : Regular : 180 | NOT_CURRENTLY_SELLABLE; remove/deactivate obsolete sauce assignment/default; remain unpublished |
| e4d51b9f-15f0-488d-b184-bc1df8713936 / Chicken Parmigiana | UNPUBLISHED; available=false, published=false, archived=2026-09-02T10:46:22.729582+00:00 | null : null : null | NOT_CURRENTLY_SELLABLE; no activation or certification |
| 28e7272b-4fcf-4c39-a0ae-19a74d32a8d3 / Chicken Parmigiani | UNPUBLISHED; available=false, published=false, archived=null | 1a5b54d3-faef-414c-ab33-e45ece5677f1 : Each : 0 | NOT_CURRENTLY_SELLABLE; no activation or certification |
| b5e5b9aa-9578-4663-81b2-1eb9328a123a / Salmon Katsu Bowl | UNPUBLISHED; available=false, published=false, archived=null | c5545ef8-02f7-4278-ba9e-3dd068f149ff : Each : 220 | NOT_CURRENTLY_SELLABLE; no activation or certification |
| c0e22263-7658-42e9-97af-4128a99270a5 / Seared Salmon Beurre Blanc | UNPUBLISHED; available=false, published=false, archived=null | 67e60c0b-2c96-4acf-88d3-3be89442fe39 : Each : 0 | NOT_CURRENTLY_SELLABLE; no activation or certification |

For later reactivation: Pure Usucha MP; Double Matcha Cloud MS; Matcha Sunrise MM; CS Matcha Oat M plus included oat. Banana Pudding Matcha Latte, Matcha Brûlée and Pitaya Mango Cream lack exact local recipes. Do not equate Banana Pudding with Banana Fudge by name. The NULL-size Chicken Parmigiana row remains untouched.

## E. Default matrix

Savory sauces are fixed recipe ingredients, never options or defaults. Remove Shrimp default cfe33aa7-fd9d-4e0b-b0c4-016200e59ec2 and deactivate assignment da9742a2-5ab0-453e-89a8-583f0eff6a46 for product ffcf04b4-1500-4463-aa25-3703a1e167ed; do not republish it. Remove the default before assignment retirement in the same future transaction. Do not create Sweet Chili Sauce or Garlic Aioli choices/defaults.

| Product UUID / name | Group UUID | Choice UUID | Plan |
| --- | --- | --- | --- |
| ec0956f8-8d28-414f-be46-2349e92bef76 / Curv Latte | c6727e99-bae9-4963-a7cb-b238409667d9 | c018fa7b-5cb5-490a-9d8a-7a5611a1bd67 | Proposed Iced, apply with approved Hot12oz rows and compatibility |
| cbeecaec-e9a5-4faa-b8f3-75b0cae549dd / Einspanner Latte | c6727e99-bae9-4963-a7cb-b238409667d9 | c018fa7b-5cb5-490a-9d8a-7a5611a1bd67 | Proposed Iced, apply with approved Hot12oz rows and compatibility |
| 7a258d7e-5b74-44c8-93af-38b1fbd92765 / Spanish Latte | c6727e99-bae9-4963-a7cb-b238409667d9 | c018fa7b-5cb5-490a-9d8a-7a5611a1bd67 | Proposed Iced, apply with approved Hot12oz rows and compatibility |
| aa156151-540b-4beb-b924-d97bf210af95 / Caramel Macchiato | c6727e99-bae9-4963-a7cb-b238409667d9 | c018fa7b-5cb5-490a-9d8a-7a5611a1bd67 | Proposed Iced, apply with approved Hot12oz rows and compatibility |
| 54c6725f-4445-435c-bc1d-b779e5963796 / Vanilla Latte | c6727e99-bae9-4963-a7cb-b238409667d9 | c018fa7b-5cb5-490a-9d8a-7a5611a1bd67 | Proposed Iced, apply with approved Hot12oz rows and compatibility |
| e684a6bd-aadc-4117-a018-ae0591c43d41 / Americano | c6727e99-bae9-4963-a7cb-b238409667d9 | c018fa7b-5cb5-490a-9d8a-7a5611a1bd67 | Proposed Iced, apply with approved Hot12oz rows and compatibility |
| 9c0d9e22-8843-4595-b789-7550c29890a4 / Cafè Mocha | c6727e99-bae9-4963-a7cb-b238409667d9 | c018fa7b-5cb5-490a-9d8a-7a5611a1bd67 | Proposed Iced, apply with approved Hot12oz rows and compatibility |
| 45b1f92c-0daa-4ed2-af55-c5da97315c0a / White Chocolate Mocha | c6727e99-bae9-4963-a7cb-b238409667d9 | c018fa7b-5cb5-490a-9d8a-7a5611a1bd67 | Proposed Iced, apply with approved Hot12oz rows and compatibility |

Five live Hojicha recipes: proposed default approved No Sweetener/no-sweetener at zero; future actual UUID, not fabricated. This means no extra sweetener, not removal of base ingredients. Spice may default to approved Not Spicy/no. No optional shot/syrup/sauce/inclusions/add-ons/cheese/powder defaults. No temperature or inclusions default for Vanilla Jelly. No Breve/Coconut default is authorized. Required temperature still needs one compatible default under D0B1 coverage.


No Temperature defaults for any of the six signatures or Iced Shaken Vanilla Jelly. Existing Brown Sugar Temperature assignment 14783335-981c-407a-8b52-4c032122538d is planned for deactivation; there is no current default for it in D. If a later before-image reveals one, remove it atomically before retiring the assignment. Built-in milk, including Cloud/CS Oat and Cocoa Breve, requires no structured milk default.


Cocoa: no milk choice = built-in Breve. Non-fat 04672e62-40c1-4595-955b-55ab7e2598fa = +30; Oat 049cc2e6-14d3-4892-abaf-a82b9cd6ed84 = +50; Soy cd6cfd0e-9826-4c16-bf1a-4d5305186fed = +30. These are replacements, not additions to a Breve choice. No Breve default, choice, requirement or override. Apply implicit base ingredients generally, without changing any live substitution price.

## F. Contextual pricing matrix

Every planned override needs an active requirement at exactly the same scope. Product-wide means NULL size. No override/requirement is needed just to encode a built-in ingredient. Remove prior Breve/Coconut baseline rows entirely; absent selectable choices are not blockers.

| Product UUID / name | Size | Choice UUID | Delta | State |
| --- | --- | --- | --- | --- |
| 8f072a83-552e-4e97-946d-9c306169415a / Cloud Spanish Oat Latte | NULL (product-wide) | 049cc2e6-14d3-4892-abaf-a82b9cd6ed84 | 0 | BLOCKED_CONTEXTUAL_PRICE |
| b0786602-49eb-4170-b735-a3e265835608 / CS Matcha Oat Latte | NULL (product-wide) | 049cc2e6-14d3-4892-abaf-a82b9cd6ed84 | 0 | Deferred: NOT_CURRENTLY_SELLABLE |

Cheese semantic choice 7c4e3426-a4ea-427c-ad73-b0815242e7c4 (4pcs → Add Cheese/yes). Exactly 16 intended override + requirement tuples:

| Product | Size | Choice | Delta | State |
| --- | --- | --- | --- | --- |
| 24007d6c-e175-4dcf-9a6f-aab076e07b98 / OG Takoyaki | 3c436f01-a9d6-4c70-a2a3-2c35f6d78635 / 4pcs | 7c4e3426-a4ea-427c-ad73-b0815242e7c4 | 30 | BLOCKED_CONTEXTUAL_PRICE |
| 24007d6c-e175-4dcf-9a6f-aab076e07b98 / OG Takoyaki | b7b88390-fccf-4124-9346-4cc1afd80e5c / 8pcs | 7c4e3426-a4ea-427c-ad73-b0815242e7c4 | 60 | BLOCKED_CONTEXTUAL_PRICE |
| 24007d6c-e175-4dcf-9a6f-aab076e07b98 / OG Takoyaki | bbce5f8f-db50-40e4-8bce-ec8d4a1c685d / 12pcs | 7c4e3426-a4ea-427c-ad73-b0815242e7c4 | 90 | BLOCKED_CONTEXTUAL_PRICE |
| ff9e0d6f-2a1b-4b6b-a401-e02370224f39 / Aburi Salmon | 5092934c-919e-4c53-8890-ca29316aa551 / 4pcs | 7c4e3426-a4ea-427c-ad73-b0815242e7c4 | 30 | BLOCKED_CONTEXTUAL_PRICE |
| ff9e0d6f-2a1b-4b6b-a401-e02370224f39 / Aburi Salmon | 22fbd2e7-7c33-4e4d-b3a2-ccf0860cb322 / 8pcs | 7c4e3426-a4ea-427c-ad73-b0815242e7c4 | 60 | BLOCKED_CONTEXTUAL_PRICE |
| ff9e0d6f-2a1b-4b6b-a401-e02370224f39 / Aburi Salmon | 30df5f88-3760-4e46-bb52-a304e2fa2f42 / 12pcs | 7c4e3426-a4ea-427c-ad73-b0815242e7c4 | 90 | BLOCKED_CONTEXTUAL_PRICE |
| c027eedc-1807-4574-8f14-79ce07bb544e / Oozie Cheese | a5f59fd4-ce5c-4049-87a0-9b6d41faf246 / 4pcs | 7c4e3426-a4ea-427c-ad73-b0815242e7c4 | 30 | BLOCKED_CONTEXTUAL_PRICE |
| c027eedc-1807-4574-8f14-79ce07bb544e / Oozie Cheese | d0c8adf8-2398-441a-9880-eeead91ea6fe / 8pcs | 7c4e3426-a4ea-427c-ad73-b0815242e7c4 | 60 | BLOCKED_CONTEXTUAL_PRICE |
| c027eedc-1807-4574-8f14-79ce07bb544e / Oozie Cheese | 836b56fc-ec63-49d6-9e3f-7be32c233888 / 12pcs | 7c4e3426-a4ea-427c-ad73-b0815242e7c4 | 90 | BLOCKED_CONTEXTUAL_PRICE |
| c1f44003-500d-46aa-9fe6-9bbf35c57415 / Lava Melt | b958356c-1e4e-44ea-8c1f-f61683bd2a80 / 4pcs | 7c4e3426-a4ea-427c-ad73-b0815242e7c4 | 30 | BLOCKED_CONTEXTUAL_PRICE |
| c1f44003-500d-46aa-9fe6-9bbf35c57415 / Lava Melt | 0cfceeae-1a12-47a4-b544-1c53395c82d3 / 8pcs | 7c4e3426-a4ea-427c-ad73-b0815242e7c4 | 60 | BLOCKED_CONTEXTUAL_PRICE |
| c1f44003-500d-46aa-9fe6-9bbf35c57415 / Lava Melt | 43394c3a-2256-40bc-bcdd-89b5aeb69556 / 12pcs | 7c4e3426-a4ea-427c-ad73-b0815242e7c4 | 90 | BLOCKED_CONTEXTUAL_PRICE |
| 610f399d-6fa3-46f1-b0b4-9fac6aa0ed5f / Classic Veggie | d37cf9b3-8742-4a0e-aa17-fc2df384cc5d / 8pcs | 7c4e3426-a4ea-427c-ad73-b0815242e7c4 | 60 | BLOCKED_CONTEXTUAL_PRICE |
| 610f399d-6fa3-46f1-b0b4-9fac6aa0ed5f / Classic Veggie | 81c30dcf-9bae-4055-a1c4-2d46e3ca0ad3 / 12pcs | 7c4e3426-a4ea-427c-ad73-b0815242e7c4 | 90 | BLOCKED_CONTEXTUAL_PRICE |
| 2c218e48-9871-41a3-bb12-19ced7b38321 / Salted Egg | 6fdd4f4b-481d-4fbc-9459-4208dff71006 / 8pcs | 7c4e3426-a4ea-427c-ad73-b0815242e7c4 | 60 | BLOCKED_CONTEXTUAL_PRICE |
| 2c218e48-9871-41a3-bb12-19ced7b38321 / Salted Egg | fe484ccc-5a71-48e1-bb6a-fa4535002836 / 12pcs | 7c4e3426-a4ea-427c-ad73-b0815242e7c4 | 90 | BLOCKED_CONTEXTUAL_PRICE |

Classic Veggie and Salted Egg have no 4pcs size; create no synthetic tuples. D0A.1 precedence: size override > product override > base. Same-scope requirements prevent larger sizes falling back to 30. Compatibility is temperature-only (D0A.1:123); do not put cheese there. No other contextual prices are proved by the reviewed preview logic.


Cloud/CS Oat: retain the separately approved zero price for the existing selectable Oat choice if selected (a return to the included milk), with no forced Oat default. This contextual behavior concerns an existing customer-selectable choice; it is not required to represent the base ingredient. Unselected milk already means included Oat. CS remains unpublished/deferred. Cocoa substitutions keep their full current live deltas, including Oat +50; do not apply the Cloud Oat zero rule to Cocoa. No Cocoa/Breve or Sunrise/Coconut override/requirement row is planned.

## G. Espresso classification and approved Hot12oz model

Owner rule: signatures are iced-only unless explicitly offered hot. Espresso category, Regular/Large prices, a historical generic Hot chip, or a generic hot-price formula do not establish an individual signature’s Hot offering. Current source lists eight classic recipes individually before the three Seasonal signatures (menu/index.html:3642–3713). The three newer signatures have no local hot-specific recipe. Apply conservative NO Temperature to signatures without a product-specific exception; no further owner question is needed for that default.

| Product UUID / name | Classification | Temperature? | Individual evidence / decision |
| --- | --- | --- | --- |
| ec0956f8-8d28-414f-be46-2349e92bef76 / Curv Latte | STANDARD HOT/ICED ESPRESSO | Yes, required single 1/1 | Individual classic recipe in ESPRESSO_ITEMS, explicit hot/iced panel path; Cafè reconciled to legacy Caffè |
| cbeecaec-e9a5-4faa-b8f3-75b0cae549dd / Einspanner Latte | STANDARD HOT/ICED ESPRESSO | Yes, required single 1/1 | Individual classic recipe in ESPRESSO_ITEMS, explicit hot/iced panel path; Cafè reconciled to legacy Caffè |
| 7a258d7e-5b74-44c8-93af-38b1fbd92765 / Spanish Latte | STANDARD HOT/ICED ESPRESSO | Yes, required single 1/1 | Individual classic recipe in ESPRESSO_ITEMS, explicit hot/iced panel path; Cafè reconciled to legacy Caffè |
| aa156151-540b-4beb-b924-d97bf210af95 / Caramel Macchiato | STANDARD HOT/ICED ESPRESSO | Yes, required single 1/1 | Individual classic recipe in ESPRESSO_ITEMS, explicit hot/iced panel path; Cafè reconciled to legacy Caffè |
| 54c6725f-4445-435c-bc1d-b779e5963796 / Vanilla Latte | STANDARD HOT/ICED ESPRESSO | Yes, required single 1/1 | Individual classic recipe in ESPRESSO_ITEMS, explicit hot/iced panel path; Cafè reconciled to legacy Caffè |
| e684a6bd-aadc-4117-a018-ae0591c43d41 / Americano | STANDARD HOT/ICED ESPRESSO | Yes, required single 1/1 | Individual classic recipe in ESPRESSO_ITEMS, explicit hot/iced panel path; Cafè reconciled to legacy Caffè |
| 9c0d9e22-8843-4595-b789-7550c29890a4 / Cafè Mocha | STANDARD HOT/ICED ESPRESSO | Yes, required single 1/1 | Individual classic recipe in ESPRESSO_ITEMS, explicit hot/iced panel path; Cafè reconciled to legacy Caffè |
| 45b1f92c-0daa-4ed2-af55-c5da97315c0a / White Chocolate Mocha | STANDARD HOT/ICED ESPRESSO | Yes, required single 1/1 | Individual classic recipe in ESPRESSO_ITEMS, explicit hot/iced panel path; Cafè reconciled to legacy Caffè |
| e058ec46-f133-4982-afe6-cc6cf5e6d521 / Brown Sugar Cinnamon Cream Latte | SIGNATURE ICED-ONLY | NO | Owner signature rule; no explicit local hot offering |
| 8f072a83-552e-4e97-946d-9c306169415a / Cloud Spanish Oat Latte | SIGNATURE ICED-ONLY | NO | Seasonal/signature recipe; shared renderer is not a product-specific hot exception |
| 7b59829b-b13b-4157-a0e8-ecb85bdbb8e4 / Curv Seasalt Latte | SIGNATURE ICED-ONLY | NO | Owner signature rule; no explicit local hot offering |
| 57cd4f38-2e5f-41ba-a117-83f5b2c66819 / Seasalt Dark Latte | SIGNATURE ICED-ONLY | NO | Owner signature rule; no explicit local hot offering |
| 3372a8c3-3208-4458-bb71-38c40c454436 / White Ube Latte | SIGNATURE ICED-ONLY | NO | Seasonal/signature recipe; shared renderer is not a product-specific hot exception |
| c541decb-607c-44b1-8bed-4c19594c4422 / Cocoa Caramel Latte | SIGNATURE ICED-ONLY | NO | Seasonal/signature recipe; shared renderer is not a product-specific hot exception |
| 31886227-0130-45f7-8fb7-3d84682eed92 / Iced Shaken Vanilla Jelly | EXPLICITLY ICED BY NAME | NO | Owner fixed-iced rule and name; built-in jelly, no inclusions |

Curv Chocolate, Ube Cloud Latte and Berry Cloud Latte sit in the production Espresso category but are explicitly Non-Espresso by menu_group and have no espresso modifier contract. They retain zero groups, with no Temperature; do not classify by category alone.

The eight classic products now have an approved deterministic model: **one dedicated 12oz Hot size per product, priced exactly at its existing Regular price**. This latest rule overrides the obsolete legacy hot=lrg formula. Preserve existing Regular/Large IDs and prices for iced. No size schema change, reused IDs or fabricated UUIDs. New size IDs are generated only in a future approved migration.

| Classic product UUID / name | Existing Regular UUID / price | Existing Large UUID / price | Planned NEW size / price | Exact compatibility |
| --- | --- | --- | --- | --- |
| ec0956f8-8d28-414f-be46-2349e92bef76 / Curv Latte | 532bedff-2344-4ff8-ac82-e3d958062a9f / 130 | ee6f7767-1f35-4cbc-9e14-0e314988b15e / 145 | NEW UUID: 12oz Hot / 130 | Regular → Iced; Large → Iced; 12oz Hot → Hot |
| cbeecaec-e9a5-4faa-b8f3-75b0cae549dd / Einspanner Latte | 7da598a2-f675-4764-ba83-f923af768561 / 150 | cd302ffe-1919-4ac8-8088-4e730fb12113 / 160 | NEW UUID: 12oz Hot / 150 | Regular → Iced; Large → Iced; 12oz Hot → Hot |
| 7a258d7e-5b74-44c8-93af-38b1fbd92765 / Spanish Latte | 95c5e2d6-75de-4b68-8fbb-e9b81ac58ebc / 140 | debd8f6b-3a87-4044-825c-91ab7342e1ec / 150 | NEW UUID: 12oz Hot / 140 | Regular → Iced; Large → Iced; 12oz Hot → Hot |
| aa156151-540b-4beb-b924-d97bf210af95 / Caramel Macchiato | 1ca62e3c-86bc-4655-8ba6-2d972369a93f / 160 | 02a2d179-2921-4c13-ac21-67a4c7b2d5ad / 175 | NEW UUID: 12oz Hot / 160 | Regular → Iced; Large → Iced; 12oz Hot → Hot |
| 54c6725f-4445-435c-bc1d-b779e5963796 / Vanilla Latte | 3b21ccce-2fa8-4c83-b4c9-392b7c9db398 / 140 | bfc35a0a-d71d-4e0a-9da7-7a99fc95158e / 150 | NEW UUID: 12oz Hot / 140 | Regular → Iced; Large → Iced; 12oz Hot → Hot |
| e684a6bd-aadc-4117-a018-ae0591c43d41 / Americano | fe0c4074-ba4e-4c68-8e55-adf71b2577cc / 120 | f723ca06-a515-4712-ae81-aa889783a498 / 125 | NEW UUID: 12oz Hot / 120 | Regular → Iced; Large → Iced; 12oz Hot → Hot |
| 9c0d9e22-8843-4595-b789-7550c29890a4 / Cafè Mocha | 909ac7fa-e743-4848-87fa-7ec68304b9a1 / 160 | 86f8242b-128b-4474-beb3-7e7f5f56a9d6 / 170 | NEW UUID: 12oz Hot / 160 | Regular → Iced; Large → Iced; 12oz Hot → Hot |
| 45b1f92c-0daa-4ed2-af55-c5da97315c0a / White Chocolate Mocha | 4a36f492-2cb1-49a6-93a2-d422a7ca5674 / 160 | b33ef270-1e14-43a5-99ff-837ccab47f78 / 170 | NEW UUID: 12oz Hot / 160 | Regular → Iced; Large → Iced; 12oz Hot → Hot |

Exactly 8 new size rows and 24 active compatibility tuples: 16 existing iced-size tuples plus 8 new hot-size tuples. Hot choice c9b382d8-5eee-4d50-a1dc-7ceed43b5fdc; Iced c018fa7b-5cb5-490a-9d8a-7a5611a1bd67. Reject Hot + Regular/Large and Iced + 12oz Hot. Temperature remains required single 1/1 for these eight, with Iced default and an existing iced size initially selected. Frontend must render actual three-size identities and filter/validate combinations; switching temperature must select/require a compatible size, never silently quote an invalid pair.

The six signatures and Vanilla Jelly receive no Temperature, no Hot size and no temperature tuples. Brown Sugar Temperature assignment 14783335-981c-407a-8b52-4c032122538d is planned for deactivation. Missing Temperature on iced-only products is valid. The model is ready to draft; current production still lacks the eight new rows/tuples, so no product is certified by this documentation change.

## H. Frontend recipe corrections — not implemented

| File/function/line | Required synchronization |
| --- | --- |
| menu/index.html:4793 FRAPPE_ITEMS; 4864 renderFrappePanel; 5002 defaults; 5049 mapPublicCurvccinoItems; 6907 enhancement defaults | Remove milk flags, markup, defaults and detached fallback expectations. Retain syrup/sauce/inclusions. |
| menu/index.html:5132 REFRESHER_ITEMS; 5222 renderer; 5363 mapper; 6912 enhancement defaults | Remove sauce flags/defaults/expectations. Keep syrup for four sellable recipes; same rule before Dragon Dreams reactivation. |
| menu/index.html:3681 ESPRESSO_ITEMS; 6959 mapDefensivePublicCategory | Correct enhancement identity to Cafè Mocha UUID 9c0d9e22-8843-4595-b789-7550c29890a4; do not rename production to fit old Caffè. |
| menu/index.html:6901 getPublicPanelEnhancements; 6926 publicPanelVariantsCompatible; 7485 hydration | Explicit approved Brown Sugar recipe. Apply all five owner-approved profiles: Curv Seasalt/Seasalt Dark signature iced-only; Vanilla Jelly four groups without temperature/inclusions; both new Hojicha milk/sweetener/powder. No category-wide fallback. |
| menu/index.html:4286 MATCHA_ITEMS | Banana Fudge vs Banana Pudding is unproved recipe identity. Matcha Brûlée/Pitaya Mango Cream remain excluded and require review before reactivation. |
| menu/index.html:7455 renderPublicOptionGroup; 7534 contract keys; 7726 readPublicConfiguration | Canonical keys; retain Sauce/Inclusions structured multi, Sweetener proposed single, shot single and syrup multi. Update detached contract as well as visible UI. |
| menu/index.html:3641,3813; 7555 size rebuild; syncPublicPanelTemperature | Replace synthetic hot-serving assumptions with approved real size IDs/compatibility. Generic fallback must preserve required recipe checks. |
| menu/index.html:3847 buildEspressoDefaults; 4629 buildMatchaDefaults; 7860 refreshConfigurationPreview | Use live Oat and reviewed cheese identities/context; do not generate unapproved Breve/Coconut choices/defaults. Cocoa unselected milk preserves base Breve; live substitutions charge 30/50/30. Server quote remains authoritative. |
| menu/index.html:3760,3773,5601 legacy labels | Remove obsolete 25 syrup, 30 sauce/all-add-ons, free Non-fat assumptions; do not restore old flavors. |
| menu/index.html buildSupabaseOptionsMap / hydration | Preserve absent-product warning/skip, per-product validation, shared request fail-closed behavior and Add validation. No configuration bypass. |



Savory removal: menu/index.html SAVORY_ITEMS (5887), renderSavoryPanel (5917), renderAllSavoryPanels/defaults (5972), getPublicPanelEnhancements savory defaults (~6920), and hydratePublicItemPanels detached expectedRoot/requiredOptionKeys (~7527). Remove all sauce_pref selector/default/required-key expectations for the three savory UUIDs. Retain fixed sauce text in recipe descriptions; do not make it selectable, removable or swappable. Generic/specialized rendering must both work with zero groups.

Approved choice presentation: Extra Powder label +1g at 45; Sweetener labels No Sweetener / Simple Syrup / Agave / Honey with 0/0/30/30; Spice labels Not Spicy / Spicy, both zero. Preserve specified underlying legacy values and new real choice IDs once created. Temperature must not appear for Vanilla Jelly in visible markup, detached expectations, defaults or compatibility. Jelly remains part of the base recipe.


Signature rule correction: ESPRESSO_ITEMS (3642), renderEspressoPanel (3715), buildEspressoDefaults (3847), mapPublicEspressoItems, getPublicPanelEnhancements (6901), detached expectedRoot/requiredOptionKeys in hydratePublicItemPanels (~7527) and temperature synchronization must use explicit per-product hot capability. Remove Temperature markup/defaults/contract expectations for Brown Sugar, Curv Seasalt, Seasalt Dark, Cloud Spanish Oat, Cocoa Caramel and White Ube. The generic espresso adapter’s default flags/shared Hot chip must not grant Hot capability. Keep classic eight hot/iced; Vanilla Jelly remains explicitly iced without Temperature or Inclusions. Do not require signature temperature tuples in frontend or certification checks.


Remove Cocoa’s legacy Breve preselection/default lookup and missing-Breve readiness check; base ingredients need no selectable identity. Replace obsolete hot=lrg pricing with actual approved 12oz Hot rows priced at Regular. Three-size generic fallback must preserve classic temperature and recipe validation.

## I. Readiness after owner resolution

All 43 sellable products are READY_AFTER_MAPPING for migration-draft planning. This is design readiness, not a claim of applied mappings, passing implementation tests or live certificates. Future-created IDs are migration outputs, never guessed inputs. No Cocoa or classic Hot12oz design blocker remains.

| Product UUID / name | Design readiness | Implementation gate before certification |
| --- | --- | --- |
| b0786602-49eb-4170-b735-a3e265835608 / CS Matcha Oat Latte | NOT_CURRENTLY_SELLABLE | Remain excluded; no activation |
| 93e9a33b-1a37-4edf-9d26-5ddd2d87f87d / Hojicha Banana Pudding Latte | READY_AFTER_MAPPING | Approved choices/mappings/frontend/context and tests |
| e635744c-ed77-4924-a90d-c78440a81603 / Hojicha Brûlée | READY_AFTER_MAPPING | Approved choices/mappings/frontend/context and tests |
| d053466a-2a52-420c-bc4c-62b5f614a27f / Hojicha Latte | READY_AFTER_MAPPING | Approved choices/mappings/frontend/context and tests |
| 558135d9-c065-4da9-b577-530c0b66c337 / Kagoshima Matcha Cream | NOT_CURRENTLY_SELLABLE | Remain excluded; no activation |
| 0e810492-09eb-4a36-89e9-cd263a3c4058 / Matcha Sunrise | NOT_CURRENTLY_SELLABLE | Remain excluded; no activation |
| 77188ef3-b97e-4411-896a-85beeb61abec / Matcha Ube Latte | NOT_CURRENTLY_SELLABLE | Remain excluded; no activation |
| 4077bbcf-f13a-4295-8562-503692125c01 / Matcha Brûlée | NOT_CURRENTLY_SELLABLE | Remain excluded; no activation |
| 82417b58-d0c4-4d0d-a0cd-27da42b42627 / Sea Salt Cream Hojicha | READY_AFTER_MAPPING | Approved choices/mappings/frontend/context and tests |
| 4b9149b7-f2d5-4d19-bcd8-a3bf880b1bed / Sea Salt Cream Matcha Latte | NOT_CURRENTLY_SELLABLE | Remain excluded; no activation |
| 405517fc-1c5e-4386-b21d-d1aaa6dea8a7 / Banana Pudding Matcha Latte | NOT_CURRENTLY_SELLABLE | Remain excluded; no activation |
| 7765a2ac-5133-476d-898d-35d42d3de5fc / Einspanner Matcha | NOT_CURRENTLY_SELLABLE | Remain excluded; no activation |
| 6caefdb6-7daf-4e6d-a034-95fda0b7ecd7 / Pink Hojicha Latte | READY_AFTER_MAPPING | Approved choices/mappings/frontend/context and tests |
| 7fcf6e11-6946-4270-8114-5411ec6e2c71 / Cookie Crumb Matcha Latte | NOT_CURRENTLY_SELLABLE | Remain excluded; no activation |
| 837f9adf-efd6-4e80-8323-c8e87550c0a5 / Strawberry Matcha Latte | NOT_CURRENTLY_SELLABLE | Remain excluded; no activation |
| e8ec71af-a30d-472a-b1cf-723c60d21d0b / Double Matcha Cloud | NOT_CURRENTLY_SELLABLE | Remain excluded; no activation |
| a88249e4-f2a9-4ef5-801f-644c7e142831 / Pure Usucha | NOT_CURRENTLY_SELLABLE | Remain excluded; no activation |
| e058ec46-f133-4982-afe6-cc6cf5e6d521 / Brown Sugar Cinnamon Cream Latte | READY_AFTER_MAPPING | Iced-only profile; non-temperature mappings/context/tests |
| 8f072a83-552e-4e97-946d-9c306169415a / Cloud Spanish Oat Latte | READY_AFTER_MAPPING | Iced-only profile; non-temperature mappings/context/tests |
| ec0956f8-8d28-414f-be46-2349e92bef76 / Curv Latte | READY_AFTER_MAPPING | Create Hot12oz at Regular price; exclusive compatibility, mappings/frontend/tests |
| 7b59829b-b13b-4157-a0e8-ecb85bdbb8e4 / Curv Seasalt Latte | READY_AFTER_MAPPING | Iced-only profile; non-temperature mappings/context/tests |
| 31886227-0130-45f7-8fb7-3d84682eed92 / Iced Shaken Vanilla Jelly | READY_AFTER_MAPPING | Approved choices/mappings/frontend/context and tests |
| 57cd4f38-2e5f-41ba-a117-83f5b2c66819 / Seasalt Dark Latte | READY_AFTER_MAPPING | Iced-only profile; non-temperature mappings/context/tests |
| cbeecaec-e9a5-4faa-b8f3-75b0cae549dd / Einspanner Latte | READY_AFTER_MAPPING | Create Hot12oz at Regular price; exclusive compatibility, mappings/frontend/tests |
| 7a258d7e-5b74-44c8-93af-38b1fbd92765 / Spanish Latte | READY_AFTER_MAPPING | Create Hot12oz at Regular price; exclusive compatibility, mappings/frontend/tests |
| aa156151-540b-4beb-b924-d97bf210af95 / Caramel Macchiato | READY_AFTER_MAPPING | Create Hot12oz at Regular price; exclusive compatibility, mappings/frontend/tests |
| 54c6725f-4445-435c-bc1d-b779e5963796 / Vanilla Latte | READY_AFTER_MAPPING | Create Hot12oz at Regular price; exclusive compatibility, mappings/frontend/tests |
| e684a6bd-aadc-4117-a018-ae0591c43d41 / Americano | READY_AFTER_MAPPING | Create Hot12oz at Regular price; exclusive compatibility, mappings/frontend/tests |
| 9c0d9e22-8843-4595-b789-7550c29890a4 / Cafè Mocha | READY_AFTER_MAPPING | Create Hot12oz at Regular price; exclusive compatibility, mappings/frontend/tests |
| 45b1f92c-0daa-4ed2-af55-c5da97315c0a / White Chocolate Mocha | READY_AFTER_MAPPING | Create Hot12oz at Regular price; exclusive compatibility, mappings/frontend/tests |
| 3372a8c3-3208-4458-bb71-38c40c454436 / White Ube Latte | READY_AFTER_MAPPING | Iced-only profile; non-temperature mappings/context/tests |
| c541decb-607c-44b1-8bed-4c19594c4422 / Cocoa Caramel Latte | READY_AFTER_MAPPING | Implicit Breve; 30/50/30 substitutions; iced-only frontend/tests |
| 8e1b82c6-8aea-4eb9-b591-184072c4f49e / Curv Chocolate | READY_AFTER_MAPPING | Approved choices/mappings/frontend/context and tests |
| 4ea4643e-5a61-402f-b9c4-8a29ae130c18 / Ube Cloud Latte | READY_AFTER_MAPPING | Approved choices/mappings/frontend/context and tests |
| f9e87759-6aa9-4bce-8b8b-3081ec913c01 / Berry Cloud Latte | READY_AFTER_MAPPING | Approved choices/mappings/frontend/context and tests |
| c26d3d79-38bf-4687-b3ca-eedfc1ed0e86 / Double Chocolate Chip Cream | READY_AFTER_MAPPING | Approved choices/mappings/frontend/context and tests |
| a3851bd7-6cb7-4dec-a834-1b26d39d712f / Pitaya Mango Cream | NOT_CURRENTLY_SELLABLE | Remain excluded; no activation |
| 56ca858c-58da-4ee3-9954-d189390cefb8 / Javachip Brownie Curvccino | READY_AFTER_MAPPING | Approved choices/mappings/frontend/context and tests |
| 52f8ffc5-8f9b-41d2-9ecd-574ece1cf5e6 / Javachip Jelly Curvccino | READY_AFTER_MAPPING | Approved choices/mappings/frontend/context and tests |
| 8a078f3e-872d-47e0-a1df-c14f33af64c2 / Strawberries & Cream | READY_AFTER_MAPPING | Approved choices/mappings/frontend/context and tests |
| dd5face3-df84-47ae-8ce1-9e2b565a91dd / White Caramel Curvccino | READY_AFTER_MAPPING | Approved choices/mappings/frontend/context and tests |
| c73dfa99-a16c-4e53-b369-dd56f5e3494b / Dragon Dreams | NOT_CURRENTLY_SELLABLE | Remain excluded; no activation |
| f716d196-47f0-46f4-af7e-bda068b95b2d / Tropic Kiss | READY_AFTER_MAPPING | Approved choices/mappings/frontend/context and tests |
| 483eed35-dd1d-4a87-90a6-2161b3d1ef86 / Tokyo Sunrise | READY_AFTER_MAPPING | Approved choices/mappings/frontend/context and tests |
| ab350883-08eb-4b3a-b45a-03bb11f509a3 / Hibiscus Cream Tea | READY_AFTER_MAPPING | Approved choices/mappings/frontend/context and tests |
| 9eba0285-c567-4d8d-960a-4f2bed4a6bd7 / Lime Cucumber | READY_AFTER_MAPPING | Approved choices/mappings/frontend/context and tests |
| 24007d6c-e175-4dcf-9a6f-aab076e07b98 / OG Takoyaki | READY_AFTER_MAPPING | Approved choices/mappings/frontend/context and tests |
| ffcf04b4-1500-4463-aa25-3703a1e167ed / Shrimp Tempura | NOT_CURRENTLY_SELLABLE | Remain excluded; no activation |
| ff9e0d6f-2a1b-4b6b-a401-e02370224f39 / Aburi Salmon | READY_AFTER_MAPPING | Approved choices/mappings/frontend/context and tests |
| 29187fbb-f9ab-42b7-ab29-82a0a1b3f0c5 / Chicken Karaage | READY_AFTER_MAPPING | Remove savory option contract; fixed recipe/tests |
| a33f5d5a-fde1-4eb4-8604-1637b4afbf9a / Cream Dory Fillet | READY_AFTER_MAPPING | Remove savory option contract; fixed recipe/tests |
| c027eedc-1807-4574-8f14-79ce07bb544e / Oozie Cheese | READY_AFTER_MAPPING | Approved choices/mappings/frontend/context and tests |
| c1f44003-500d-46aa-9fe6-9bbf35c57415 / Lava Melt | READY_AFTER_MAPPING | Approved choices/mappings/frontend/context and tests |
| 610f399d-6fa3-46f1-b0b4-9fac6aa0ed5f / Classic Veggie | READY_AFTER_MAPPING | Approved choices/mappings/frontend/context and tests |
| 2c218e48-9871-41a3-bb12-19ced7b38321 / Salted Egg | READY_AFTER_MAPPING | Approved choices/mappings/frontend/context and tests |
| 5498a571-8404-4a4f-a380-9cc0eaefc67c / Cheese Katsu Bowl | READY_AFTER_MAPPING | Approved choices/mappings/frontend/context and tests |
| e4d51b9f-15f0-488d-b184-bc1df8713936 / Chicken Parmigiana | NOT_CURRENTLY_SELLABLE | Remain excluded; no activation |
| 28e7272b-4fcf-4c39-a0ae-19a74d32a8d3 / Chicken Parmigiani | NOT_CURRENTLY_SELLABLE | Remain excluded; no activation |
| f4253ada-f15f-4fee-abea-c7678cd1fc06 / Pork Katsu Bowl | READY_AFTER_MAPPING | Approved choices/mappings/frontend/context and tests |
| b5e5b9aa-9578-4663-81b2-1eb9328a123a / Salmon Katsu Bowl | NOT_CURRENTLY_SELLABLE | Remain excluded; no activation |
| c0e22263-7658-42e9-97af-4128a99270a5 / Seared Salmon Beurre Blanc | NOT_CURRENTLY_SELLABLE | Remain excluded; no activation |
| 5f5de117-2b8f-42d5-8b66-78f20339f544 / Chicken Bowl | READY_AFTER_MAPPING | Approved choices/mappings/frontend/context and tests |

## J. Pricing certification plan

E4 remains empty; no product is certified by this report. All approved changes and tests must complete before final reviewed catalog_structure certification.

Eight classics require actual 12oz Hot size at Regular price, three real size identities, exclusive temperature tuples, required 1/1, compatible Iced default and three-size frontend handling. Six signatures and Vanilla Jelly require no Temperature; retire Brown Sugar’s old assignment. Cocoa unselected milk preserves Breve; Non-fat/Oat/Soy charge 30/50/30. No Breve choice/default/override or missing-Breve gate.

Other implementation gates: fixed savory recipe contract removal and Shrimp default/assignment retirement; approved powder/spice/sweetener; Curvccino/Refresher corrections; 16 cheese tuples/requirements; approved selectable Oat contextual pricing without forced base-milk defaults; authoritative quote/submission, failed-read and stale-cart tests. All 19 excluded products stay excluded. Finish shared edits before certifying final structure; never reuse an old certificate for changed data. Preserve order snapshots and idempotency.

## K. Remaining blockers and decisions

No remaining owner decisions or design blockers for the current sellable scope. Dedicated Hot12oz at Regular price and exclusive compatibility are approved. Cocoa base Breve is implicit with live substitutions only. New size/group/choice UUIDs are allocated in a future approved migration; do not invent IDs.

Remaining execution gates are implementation work: reviewed migration draft and baseline/reapplication checks, synchronized frontend, local tests, final structure validation and certification. They are not unresolved product rules. Excluded products remain outside activation scope.

READY FOR MIGRATION DRAFT. No SQL is generated in this task.

## L. Migration phases — design only

No SQL. Prepare synchronized frontend before eventual coordinated cutover.

| Phase | Objects/prerequisites | Validation | Rollback |
| --- | --- | --- | --- |
| 1. Keys/types | Six active key renames; shot/sweetener single; dormant Bites key retained | Same UUIDs, coherent bounds, no duplicates | Exact key/type/bound before-images |
| 2. Choices | Only approved powder/spice/sweetener; semantic cheese conversion | Exact labels/prices; no new savory/milk/add-on options | Restore activity/labels; never hard-delete referenced IDs |
| 3. Assignments | D profiles, Shrimp retirement and Brown Sugar Temperature deactivation; remove dependent default first in same transaction | 106 unique existing-group pairs; no savory groups or Vanilla Jelly temperature/inclusions | Restore da9742a2-5ab0-453e-89a8-583f0eff6a46 and dependent default atomically |
| 4. Defaults | E only; remove cfe33aa7-fd9d-4e0b-b0c4-016200e59ec2 coordinated with phase 3 | No dangling savory defaults; compatible temperature; approved sweetener/spice defaults | Exact prior default set |
| 5. Context | Cloud Oat zero and 16 cheese tuples/requirements; no new Breve/Coconut choices | Correct prices, scope, failure on missing context | Restore override/requirement pairs together |
| 6. Compatibility | Approved eight NEW 12oz Hot sizes at Regular prices; 24 exact tuples; no signature temperature tuples | All temperature sizes covered; Vanilla Jelly excluded | Restore sizes/tuples/defaults/code together |
| 7. Frontend | Remove savory and six signature Temperature contracts; approved profiles; Vanilla Jelly exclusions; Curvccino/Refresher corrections | Fixed ingredients intact; zero-group savory addable; no fabricated hot IDs | Matching code/data baseline and stale-cart requote |
| 8. Validation | Complete approved model and synchronized frontend | Prices, choices, no swaps/jelly removal, required options, request failures | Coherent rollback; uncertified if incomplete |
| 9. Certification | J final structure gates | Coverage/hash/authoritative quote match | Matching prior structure/certificate or remain uncertified |

Keep Bites group/Tempura choice dormant; do not hard-delete library/history. Capture exact before-images. No republishing excluded products or order backfill. Future tests cover savory zero-options, fixed-iced Jelly, all five recipes, approved labels/prices, Hot12oz identities and invalid pairs, context, stale carts and certification invalidation. No application tests/SQL execution in this documentation revision.


Retire Brown Sugar Temperature assignment 14783335-981c-407a-8b52-4c032122538d together with any dependent rows confirmed in a future before-image; current CSVs show no defaults/compatibility for it. Rollback restores its exact prior optional 0/1/sort4 state, not the superseded proposed required 1/1. Future tests must prove all six signatures and Vanilla Jelly remain addable without Temperature, that classic choices still validate compatibility, and that category/adapter defaults do not silently introduce Hot.


Phase 6 has no owner/model blocker: create eight 12oz Hot sizes using referenced Regular prices; preserve existing iced rows. Resolve generated IDs for exactly 24 allowed tuples; assert no duplicate hot size before creation/reapplication. Test forbidden opposite-temperature pairs. Rollback records only created IDs and exact prior tuples; never delete sizes referenced by later orders. Phase 7 removes base-only milk defaults (including Breve), and phase 8 tests implicit base milk versus live priced substitutions. No size, SQL or application file is created in this documentation task.

## Local static checks

Verify 43 sellable rows/79 existing sizes, 19 excluded, all report UUIDs imported, 106 unique existing-group assignments, six signatures plus one fixed-iced Temperature exclusions, eight planned Hot12oz rows at Regular prices and 24 allowed tuples. Verify no Cocoa base-Breve choice/default/override, live substitution deltas, unchanged CSV hashes and git diff --check.

**READY FOR MIGRATION DRAFT** — implementation/testing/certification still required. Stop before SQL.
