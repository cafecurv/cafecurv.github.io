-- CURV public menu option mapping repair. LOCAL DRAFT FOR MANUAL REVIEW ONLY.
-- Coordinated frontend work from repair-plan H is required: canonical keys;
-- no Curvccino Milk, Refresher Sauce or savory sauce selector; iced-only
-- signatures; Cafè Mocha/newer recipe identity; real 3-size classic controls.
-- SQL alone does not make the current menu safe/addable. No certification.
-- Required cutover order:
-- A. Prepare and test a frontend bridge accepting both production and canonical keys.
-- B. Deploy that bridge before this database migration.
-- C. Run and validate this migration only with that bridge already live.
-- D. Verify customer ordering across representative product families.
-- E. Only then remove legacy-key aliases from the frontend.
-- NEVER run this migration against a frontend that understands only one side
-- of the key transition. Final owner confirmation of the defaults below is
-- also required before execution.
-- Prerequisites: reviewed D0A.1/D0B1 objects; owner role; quiet window;
-- tested frontend release. Capture exact pre-deployment row before-images.
-- Transaction rollback on any failure. Locks below can briefly block writers;
-- timeout aborts rather than blocking ordering indefinitely.
-- Product/category locks keep the catalog-state preflight true through COMMIT.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';
LOCK TABLE public.products, public.categories,
 public.option_groups, public.option_choices,
 public.product_option_groups, public.product_option_defaults,
 public.product_sizes, public.product_option_choice_price_overrides,
 public.product_option_choice_override_requirements,
 public.product_size_option_choice_compatibility,
 configuration_private.product_pricing_certifications
 IN SHARE ROW EXCLUSIVE MODE;

CREATE TEMP TABLE _curv_expected_group (
 id uuid PRIMARY KEY, name text NOT NULL, old_key text NOT NULL,
 new_key text NOT NULL, old_type text NOT NULL, new_type text NOT NULL
) ON COMMIT DROP;
INSERT INTO _curv_expected_group VALUES

 ('232d1301-d072-48ed-a363-6d5af6a6d906'::uuid,'Add Cheese','add_cheese','cheese','single','single'),
 ('5475e951-d4b1-46bf-a556-f63aecdf0fe2'::uuid,'Bites Sauce','bites_sauce','bites_sauce','single','single'),
 ('6f1074e8-f51a-41cd-a7f0-ed777418c916'::uuid,'Extra Espresso Shot','extra_shot','extrashot','multi','single'),
 ('516fb052-949a-43f5-8734-5b3f60bc76be'::uuid,'Inclusions','sinkers','inclusions','multi','multi'),
 ('f16decf7-b5a4-4b98-8182-c9c2c9eca1f0'::uuid,'Sauce','sauce_beverage','sauce','multi','multi'),
 ('1a3e299a-430c-4cf2-97c2-4d677e7019cd'::uuid,'Sweetener','sweetener','sweetener','multi','single'),
 ('da657452-3dfe-4ba1-b695-26648180d999'::uuid,'Syrup','syrup','syrup','multi','multi'),
 ('ff3aa2ce-e4ab-4870-98e1-93ff8078b534'::uuid,'Takoyaki Add-ons','garnish','addons','multi','multi'),
 ('c6727e99-bae9-4963-a7cb-b238409667d9'::uuid,'Temperature','beverage_temperature','temperature','single','single'),
 ('8a798579-ae21-47a2-8b84-6dc545b788bd'::uuid,'Sub Milk','milk','milk','single','single');

CREATE TEMP TABLE _curv_expected_product (
 id uuid PRIMARY KEY, name text NOT NULL, expected_state text NOT NULL
) ON COMMIT DROP;
INSERT INTO _curv_expected_product VALUES

 ('b0786602-49eb-4170-b735-a3e265835608'::uuid,'CS Matcha Oat Latte','UNPUBLISHED'),
 ('93e9a33b-1a37-4edf-9d26-5ddd2d87f87d'::uuid,'Hojicha Banana Pudding Latte','SELLABLE_CANDIDATE'),
 ('e635744c-ed77-4924-a90d-c78440a81603'::uuid,'Hojicha Brûlée','SELLABLE_CANDIDATE'),
 ('d053466a-2a52-420c-bc4c-62b5f614a27f'::uuid,'Hojicha Latte','SELLABLE_CANDIDATE'),
 ('558135d9-c065-4da9-b577-530c0b66c337'::uuid,'Kagoshima Matcha Cream','UNPUBLISHED'),
 ('0e810492-09eb-4a36-89e9-cd263a3c4058'::uuid,'Matcha Sunrise','UNPUBLISHED'),
 ('77188ef3-b97e-4411-896a-85beeb61abec'::uuid,'Matcha Ube Latte','UNPUBLISHED'),
 ('4077bbcf-f13a-4295-8562-503692125c01'::uuid,'Matcha Brûlée','UNPUBLISHED'),
 ('82417b58-d0c4-4d0d-a0cd-27da42b42627'::uuid,'Sea Salt Cream Hojicha','SELLABLE_CANDIDATE'),
 ('4b9149b7-f2d5-4d19-bcd8-a3bf880b1bed'::uuid,'Sea Salt Cream Matcha Latte','UNPUBLISHED'),
 ('405517fc-1c5e-4386-b21d-d1aaa6dea8a7'::uuid,'Banana Pudding Matcha Latte','UNPUBLISHED'),
 ('7765a2ac-5133-476d-898d-35d42d3de5fc'::uuid,'Einspanner Matcha','UNPUBLISHED'),
 ('6caefdb6-7daf-4e6d-a034-95fda0b7ecd7'::uuid,'Pink Hojicha Latte','SELLABLE_CANDIDATE'),
 ('7fcf6e11-6946-4270-8114-5411ec6e2c71'::uuid,'Cookie Crumb Matcha Latte','UNPUBLISHED'),
 ('837f9adf-efd6-4e80-8323-c8e87550c0a5'::uuid,'Strawberry Matcha Latte','UNPUBLISHED'),
 ('e8ec71af-a30d-472a-b1cf-723c60d21d0b'::uuid,'Double Matcha Cloud','UNPUBLISHED'),
 ('a88249e4-f2a9-4ef5-801f-644c7e142831'::uuid,'Pure Usucha','UNPUBLISHED'),
 ('e058ec46-f133-4982-afe6-cc6cf5e6d521'::uuid,'Brown Sugar Cinnamon Cream Latte','SELLABLE_CANDIDATE'),
 ('8f072a83-552e-4e97-946d-9c306169415a'::uuid,'Cloud Spanish Oat Latte','SELLABLE_CANDIDATE'),
 ('ec0956f8-8d28-414f-be46-2349e92bef76'::uuid,'Curv Latte','SELLABLE_CANDIDATE'),
 ('7b59829b-b13b-4157-a0e8-ecb85bdbb8e4'::uuid,'Curv Seasalt Latte','SELLABLE_CANDIDATE'),
 ('31886227-0130-45f7-8fb7-3d84682eed92'::uuid,'Iced Shaken Vanilla Jelly','SELLABLE_CANDIDATE'),
 ('57cd4f38-2e5f-41ba-a117-83f5b2c66819'::uuid,'Seasalt Dark Latte','SELLABLE_CANDIDATE'),
 ('cbeecaec-e9a5-4faa-b8f3-75b0cae549dd'::uuid,'Einspanner Latte','SELLABLE_CANDIDATE'),
 ('7a258d7e-5b74-44c8-93af-38b1fbd92765'::uuid,'Spanish Latte','SELLABLE_CANDIDATE'),
 ('aa156151-540b-4beb-b924-d97bf210af95'::uuid,'Caramel Macchiato','SELLABLE_CANDIDATE'),
 ('54c6725f-4445-435c-bc1d-b779e5963796'::uuid,'Vanilla Latte','SELLABLE_CANDIDATE'),
 ('e684a6bd-aadc-4117-a018-ae0591c43d41'::uuid,'Americano','SELLABLE_CANDIDATE'),
 ('9c0d9e22-8843-4595-b789-7550c29890a4'::uuid,'Cafè Mocha','SELLABLE_CANDIDATE'),
 ('45b1f92c-0daa-4ed2-af55-c5da97315c0a'::uuid,'White Chocolate Mocha','SELLABLE_CANDIDATE'),
 ('3372a8c3-3208-4458-bb71-38c40c454436'::uuid,'White Ube Latte','SELLABLE_CANDIDATE'),
 ('c541decb-607c-44b1-8bed-4c19594c4422'::uuid,'Cocoa Caramel Latte','SELLABLE_CANDIDATE'),
 ('8e1b82c6-8aea-4eb9-b591-184072c4f49e'::uuid,'Curv Chocolate','SELLABLE_CANDIDATE'),
 ('4ea4643e-5a61-402f-b9c4-8a29ae130c18'::uuid,'Ube Cloud Latte','SELLABLE_CANDIDATE'),
 ('f9e87759-6aa9-4bce-8b8b-3081ec913c01'::uuid,'Berry Cloud Latte','SELLABLE_CANDIDATE'),
 ('c26d3d79-38bf-4687-b3ca-eedfc1ed0e86'::uuid,'Double Chocolate Chip Cream','SELLABLE_CANDIDATE'),
 ('a3851bd7-6cb7-4dec-a834-1b26d39d712f'::uuid,'Pitaya Mango Cream','UNAVAILABLE'),
 ('56ca858c-58da-4ee3-9954-d189390cefb8'::uuid,'Javachip Brownie Curvccino','SELLABLE_CANDIDATE'),
 ('52f8ffc5-8f9b-41d2-9ecd-574ece1cf5e6'::uuid,'Javachip Jelly Curvccino','SELLABLE_CANDIDATE'),
 ('8a078f3e-872d-47e0-a1df-c14f33af64c2'::uuid,'Strawberries & Cream','SELLABLE_CANDIDATE'),
 ('dd5face3-df84-47ae-8ce1-9e2b565a91dd'::uuid,'White Caramel Curvccino','SELLABLE_CANDIDATE'),
 ('c73dfa99-a16c-4e53-b369-dd56f5e3494b'::uuid,'Dragon Dreams','UNAVAILABLE'),
 ('f716d196-47f0-46f4-af7e-bda068b95b2d'::uuid,'Tropic Kiss','SELLABLE_CANDIDATE'),
 ('483eed35-dd1d-4a87-90a6-2161b3d1ef86'::uuid,'Tokyo Sunrise','SELLABLE_CANDIDATE'),
 ('ab350883-08eb-4b3a-b45a-03bb11f509a3'::uuid,'Hibiscus Cream Tea','SELLABLE_CANDIDATE'),
 ('9eba0285-c567-4d8d-960a-4f2bed4a6bd7'::uuid,'Lime Cucumber','SELLABLE_CANDIDATE'),
 ('24007d6c-e175-4dcf-9a6f-aab076e07b98'::uuid,'OG Takoyaki','SELLABLE_CANDIDATE'),
 ('ffcf04b4-1500-4463-aa25-3703a1e167ed'::uuid,'Shrimp Tempura','UNPUBLISHED'),
 ('ff9e0d6f-2a1b-4b6b-a401-e02370224f39'::uuid,'Aburi Salmon','SELLABLE_CANDIDATE'),
 ('29187fbb-f9ab-42b7-ab29-82a0a1b3f0c5'::uuid,'Chicken Karaage','SELLABLE_CANDIDATE'),
 ('a33f5d5a-fde1-4eb4-8604-1637b4afbf9a'::uuid,'Cream Dory Fillet','SELLABLE_CANDIDATE'),
 ('c027eedc-1807-4574-8f14-79ce07bb544e'::uuid,'Oozie Cheese','SELLABLE_CANDIDATE'),
 ('c1f44003-500d-46aa-9fe6-9bbf35c57415'::uuid,'Lava Melt','SELLABLE_CANDIDATE'),
 ('610f399d-6fa3-46f1-b0b4-9fac6aa0ed5f'::uuid,'Classic Veggie','SELLABLE_CANDIDATE'),
 ('2c218e48-9871-41a3-bb12-19ced7b38321'::uuid,'Salted Egg','SELLABLE_CANDIDATE'),
 ('5498a571-8404-4a4f-a380-9cc0eaefc67c'::uuid,'Cheese Katsu Bowl','SELLABLE_CANDIDATE'),
 ('e4d51b9f-15f0-488d-b184-bc1df8713936'::uuid,'Chicken Parmigiana','UNPUBLISHED'),
 ('28e7272b-4fcf-4c39-a0ae-19a74d32a8d3'::uuid,'Chicken Parmigiani','UNPUBLISHED'),
 ('f4253ada-f15f-4fee-abea-c7678cd1fc06'::uuid,'Pork Katsu Bowl','SELLABLE_CANDIDATE'),
 ('b5e5b9aa-9578-4663-81b2-1eb9328a123a'::uuid,'Salmon Katsu Bowl','UNPUBLISHED'),
 ('c0e22263-7658-42e9-97af-4128a99270a5'::uuid,'Seared Salmon Beurre Blanc','UNPUBLISHED'),
 ('5f5de117-2b8f-42d5-8b66-78f20339f544'::uuid,'Chicken Bowl','SELLABLE_CANDIDATE');

-- Exact F-export before-image for all 19 excluded products. State and category
-- changes require a fresh inventory review even if the product is still hidden.
CREATE TEMP TABLE _curv_expected_excluded_state (
 product_id uuid PRIMARY KEY, category_id uuid NOT NULL,
 is_published boolean NOT NULL, is_available boolean NOT NULL,
 is_sold_out boolean NOT NULL, archived_at timestamptz,
 category_active boolean NOT NULL
) ON COMMIT DROP;
INSERT INTO _curv_expected_excluded_state VALUES

 ('b0786602-49eb-4170-b735-a3e265835608'::uuid,'a8c75db5-59b7-4707-ad02-0b2b7c37e7fd'::uuid,false,true,false,NULL,true),
 ('558135d9-c065-4da9-b577-530c0b66c337'::uuid,'a8c75db5-59b7-4707-ad02-0b2b7c37e7fd'::uuid,false,false,false,NULL,true),
 ('0e810492-09eb-4a36-89e9-cd263a3c4058'::uuid,'a8c75db5-59b7-4707-ad02-0b2b7c37e7fd'::uuid,false,false,false,NULL,true),
 ('77188ef3-b97e-4411-896a-85beeb61abec'::uuid,'a8c75db5-59b7-4707-ad02-0b2b7c37e7fd'::uuid,false,true,false,NULL,true),
 ('4077bbcf-f13a-4295-8562-503692125c01'::uuid,'a8c75db5-59b7-4707-ad02-0b2b7c37e7fd'::uuid,false,true,false,NULL,true),
 ('4b9149b7-f2d5-4d19-bcd8-a3bf880b1bed'::uuid,'a8c75db5-59b7-4707-ad02-0b2b7c37e7fd'::uuid,false,true,false,NULL,true),
 ('405517fc-1c5e-4386-b21d-d1aaa6dea8a7'::uuid,'a8c75db5-59b7-4707-ad02-0b2b7c37e7fd'::uuid,false,true,false,NULL,true),
 ('7765a2ac-5133-476d-898d-35d42d3de5fc'::uuid,'a8c75db5-59b7-4707-ad02-0b2b7c37e7fd'::uuid,false,true,false,NULL,true),
 ('7fcf6e11-6946-4270-8114-5411ec6e2c71'::uuid,'a8c75db5-59b7-4707-ad02-0b2b7c37e7fd'::uuid,false,true,false,NULL,true),
 ('837f9adf-efd6-4e80-8323-c8e87550c0a5'::uuid,'a8c75db5-59b7-4707-ad02-0b2b7c37e7fd'::uuid,false,true,false,NULL,true),
 ('e8ec71af-a30d-472a-b1cf-723c60d21d0b'::uuid,'a8c75db5-59b7-4707-ad02-0b2b7c37e7fd'::uuid,false,true,false,NULL,true),
 ('a88249e4-f2a9-4ef5-801f-644c7e142831'::uuid,'a8c75db5-59b7-4707-ad02-0b2b7c37e7fd'::uuid,false,true,false,NULL,true),
 ('a3851bd7-6cb7-4dec-a834-1b26d39d712f'::uuid,'0d7b91c8-070c-4c87-a63c-ee4e19956496'::uuid,true,false,false,NULL,true),
 ('c73dfa99-a16c-4e53-b369-dd56f5e3494b'::uuid,'c085adc2-02c1-438a-9c1b-09927d653ac7'::uuid,true,false,false,NULL,true),
 ('ffcf04b4-1500-4463-aa25-3703a1e167ed'::uuid,'1796cec1-be5f-401b-a9f3-321194f6130c'::uuid,false,false,false,'2026-09-02T08:49:37.342083+00:00'::timestamptz,true),
 ('e4d51b9f-15f0-488d-b184-bc1df8713936'::uuid,'a66acae6-b403-4c55-8dbe-566e55cd39cc'::uuid,false,false,false,'2026-09-02T10:46:22.729582+00:00'::timestamptz,true),
 ('28e7272b-4fcf-4c39-a0ae-19a74d32a8d3'::uuid,'a66acae6-b403-4c55-8dbe-566e55cd39cc'::uuid,false,false,false,NULL,true),
 ('b5e5b9aa-9578-4663-81b2-1eb9328a123a'::uuid,'a66acae6-b403-4c55-8dbe-566e55cd39cc'::uuid,false,false,false,NULL,true),
 ('c0e22263-7658-42e9-97af-4128a99270a5'::uuid,'a66acae6-b403-4c55-8dbe-566e55cd39cc'::uuid,false,false,false,NULL,true);


CREATE TEMP TABLE _curv_expected_assignment (
 product_id uuid NOT NULL, group_key text NOT NULL,
 is_required boolean NOT NULL, min_selections integer NOT NULL,
 max_selections integer, sort_order integer NOT NULL,
 PRIMARY KEY(product_id,group_key)
) ON COMMIT DROP;
INSERT INTO _curv_expected_assignment VALUES

 ('93e9a33b-1a37-4edf-9d26-5ddd2d87f87d'::uuid,'extrapower',false,0,1,10),
 ('93e9a33b-1a37-4edf-9d26-5ddd2d87f87d'::uuid,'milk',false,0,1,20),
 ('93e9a33b-1a37-4edf-9d26-5ddd2d87f87d'::uuid,'sweetener',false,0,1,30),
 ('e635744c-ed77-4924-a90d-c78440a81603'::uuid,'extrapower',false,0,1,10),
 ('e635744c-ed77-4924-a90d-c78440a81603'::uuid,'milk',false,0,1,20),
 ('e635744c-ed77-4924-a90d-c78440a81603'::uuid,'sweetener',false,0,1,30),
 ('d053466a-2a52-420c-bc4c-62b5f614a27f'::uuid,'extrapower',false,0,1,10),
 ('d053466a-2a52-420c-bc4c-62b5f614a27f'::uuid,'milk',false,0,1,20),
 ('d053466a-2a52-420c-bc4c-62b5f614a27f'::uuid,'sweetener',false,0,1,30),
 ('82417b58-d0c4-4d0d-a0cd-27da42b42627'::uuid,'extrapower',false,0,1,10),
 ('82417b58-d0c4-4d0d-a0cd-27da42b42627'::uuid,'milk',false,0,1,20),
 ('82417b58-d0c4-4d0d-a0cd-27da42b42627'::uuid,'sweetener',false,0,1,30),
 ('6caefdb6-7daf-4e6d-a034-95fda0b7ecd7'::uuid,'extrapower',false,0,1,10),
 ('6caefdb6-7daf-4e6d-a034-95fda0b7ecd7'::uuid,'milk',false,0,1,20),
 ('6caefdb6-7daf-4e6d-a034-95fda0b7ecd7'::uuid,'sweetener',false,0,1,30),
 ('e058ec46-f133-4982-afe6-cc6cf5e6d521'::uuid,'milk',false,0,1,20),
 ('e058ec46-f133-4982-afe6-cc6cf5e6d521'::uuid,'extrashot',false,0,1,30),
 ('e058ec46-f133-4982-afe6-cc6cf5e6d521'::uuid,'syrup',false,0,NULL,40),
 ('e058ec46-f133-4982-afe6-cc6cf5e6d521'::uuid,'sauce',false,0,NULL,50),
 ('8f072a83-552e-4e97-946d-9c306169415a'::uuid,'milk',false,0,1,20),
 ('8f072a83-552e-4e97-946d-9c306169415a'::uuid,'extrashot',false,0,1,30),
 ('8f072a83-552e-4e97-946d-9c306169415a'::uuid,'syrup',false,0,NULL,40),
 ('8f072a83-552e-4e97-946d-9c306169415a'::uuid,'sauce',false,0,NULL,50),
 ('ec0956f8-8d28-414f-be46-2349e92bef76'::uuid,'temperature',true,1,1,10),
 ('ec0956f8-8d28-414f-be46-2349e92bef76'::uuid,'milk',false,0,1,20),
 ('ec0956f8-8d28-414f-be46-2349e92bef76'::uuid,'extrashot',false,0,1,30),
 ('ec0956f8-8d28-414f-be46-2349e92bef76'::uuid,'syrup',false,0,NULL,40),
 ('ec0956f8-8d28-414f-be46-2349e92bef76'::uuid,'sauce',false,0,NULL,50),
 ('7b59829b-b13b-4157-a0e8-ecb85bdbb8e4'::uuid,'milk',false,0,1,20),
 ('7b59829b-b13b-4157-a0e8-ecb85bdbb8e4'::uuid,'extrashot',false,0,1,30),
 ('7b59829b-b13b-4157-a0e8-ecb85bdbb8e4'::uuid,'syrup',false,0,NULL,40),
 ('7b59829b-b13b-4157-a0e8-ecb85bdbb8e4'::uuid,'sauce',false,0,NULL,50),
 ('31886227-0130-45f7-8fb7-3d84682eed92'::uuid,'milk',false,0,1,20),
 ('31886227-0130-45f7-8fb7-3d84682eed92'::uuid,'extrashot',false,0,1,30),
 ('31886227-0130-45f7-8fb7-3d84682eed92'::uuid,'syrup',false,0,NULL,40),
 ('31886227-0130-45f7-8fb7-3d84682eed92'::uuid,'sauce',false,0,NULL,50),
 ('57cd4f38-2e5f-41ba-a117-83f5b2c66819'::uuid,'milk',false,0,1,20),
 ('57cd4f38-2e5f-41ba-a117-83f5b2c66819'::uuid,'extrashot',false,0,1,30),
 ('57cd4f38-2e5f-41ba-a117-83f5b2c66819'::uuid,'syrup',false,0,NULL,40),
 ('57cd4f38-2e5f-41ba-a117-83f5b2c66819'::uuid,'sauce',false,0,NULL,50),
 ('cbeecaec-e9a5-4faa-b8f3-75b0cae549dd'::uuid,'temperature',true,1,1,10),
 ('cbeecaec-e9a5-4faa-b8f3-75b0cae549dd'::uuid,'milk',false,0,1,20),
 ('cbeecaec-e9a5-4faa-b8f3-75b0cae549dd'::uuid,'extrashot',false,0,1,30),
 ('cbeecaec-e9a5-4faa-b8f3-75b0cae549dd'::uuid,'syrup',false,0,NULL,40),
 ('cbeecaec-e9a5-4faa-b8f3-75b0cae549dd'::uuid,'sauce',false,0,NULL,50),
 ('7a258d7e-5b74-44c8-93af-38b1fbd92765'::uuid,'temperature',true,1,1,10),
 ('7a258d7e-5b74-44c8-93af-38b1fbd92765'::uuid,'milk',false,0,1,20),
 ('7a258d7e-5b74-44c8-93af-38b1fbd92765'::uuid,'extrashot',false,0,1,30),
 ('7a258d7e-5b74-44c8-93af-38b1fbd92765'::uuid,'syrup',false,0,NULL,40),
 ('7a258d7e-5b74-44c8-93af-38b1fbd92765'::uuid,'sauce',false,0,NULL,50),
 ('aa156151-540b-4beb-b924-d97bf210af95'::uuid,'temperature',true,1,1,10),
 ('aa156151-540b-4beb-b924-d97bf210af95'::uuid,'milk',false,0,1,20),
 ('aa156151-540b-4beb-b924-d97bf210af95'::uuid,'extrashot',false,0,1,30),
 ('aa156151-540b-4beb-b924-d97bf210af95'::uuid,'syrup',false,0,NULL,40),
 ('aa156151-540b-4beb-b924-d97bf210af95'::uuid,'sauce',false,0,NULL,50),
 ('54c6725f-4445-435c-bc1d-b779e5963796'::uuid,'temperature',true,1,1,10),
 ('54c6725f-4445-435c-bc1d-b779e5963796'::uuid,'milk',false,0,1,20),
 ('54c6725f-4445-435c-bc1d-b779e5963796'::uuid,'extrashot',false,0,1,30),
 ('54c6725f-4445-435c-bc1d-b779e5963796'::uuid,'syrup',false,0,NULL,40),
 ('54c6725f-4445-435c-bc1d-b779e5963796'::uuid,'sauce',false,0,NULL,50),
 ('e684a6bd-aadc-4117-a018-ae0591c43d41'::uuid,'temperature',true,1,1,10),
 ('e684a6bd-aadc-4117-a018-ae0591c43d41'::uuid,'extrashot',false,0,1,30),
 ('9c0d9e22-8843-4595-b789-7550c29890a4'::uuid,'temperature',true,1,1,10),
 ('9c0d9e22-8843-4595-b789-7550c29890a4'::uuid,'milk',false,0,1,20),
 ('9c0d9e22-8843-4595-b789-7550c29890a4'::uuid,'extrashot',false,0,1,30),
 ('9c0d9e22-8843-4595-b789-7550c29890a4'::uuid,'syrup',false,0,NULL,40),
 ('9c0d9e22-8843-4595-b789-7550c29890a4'::uuid,'sauce',false,0,NULL,50),
 ('45b1f92c-0daa-4ed2-af55-c5da97315c0a'::uuid,'temperature',true,1,1,10),
 ('45b1f92c-0daa-4ed2-af55-c5da97315c0a'::uuid,'milk',false,0,1,20),
 ('45b1f92c-0daa-4ed2-af55-c5da97315c0a'::uuid,'extrashot',false,0,1,30),
 ('45b1f92c-0daa-4ed2-af55-c5da97315c0a'::uuid,'syrup',false,0,NULL,40),
 ('45b1f92c-0daa-4ed2-af55-c5da97315c0a'::uuid,'sauce',false,0,NULL,50),
 ('3372a8c3-3208-4458-bb71-38c40c454436'::uuid,'milk',false,0,1,20),
 ('3372a8c3-3208-4458-bb71-38c40c454436'::uuid,'extrashot',false,0,1,30),
 ('3372a8c3-3208-4458-bb71-38c40c454436'::uuid,'syrup',false,0,NULL,40),
 ('3372a8c3-3208-4458-bb71-38c40c454436'::uuid,'sauce',false,0,NULL,50),
 ('c541decb-607c-44b1-8bed-4c19594c4422'::uuid,'milk',false,0,1,20),
 ('c541decb-607c-44b1-8bed-4c19594c4422'::uuid,'extrashot',false,0,1,30),
 ('c541decb-607c-44b1-8bed-4c19594c4422'::uuid,'syrup',false,0,NULL,40),
 ('c541decb-607c-44b1-8bed-4c19594c4422'::uuid,'sauce',false,0,NULL,50),
 ('c26d3d79-38bf-4687-b3ca-eedfc1ed0e86'::uuid,'syrup',false,0,NULL,40),
 ('c26d3d79-38bf-4687-b3ca-eedfc1ed0e86'::uuid,'sauce',false,0,NULL,50),
 ('c26d3d79-38bf-4687-b3ca-eedfc1ed0e86'::uuid,'inclusions',false,0,NULL,60),
 ('56ca858c-58da-4ee3-9954-d189390cefb8'::uuid,'syrup',false,0,NULL,40),
 ('56ca858c-58da-4ee3-9954-d189390cefb8'::uuid,'sauce',false,0,NULL,50),
 ('56ca858c-58da-4ee3-9954-d189390cefb8'::uuid,'inclusions',false,0,NULL,60),
 ('52f8ffc5-8f9b-41d2-9ecd-574ece1cf5e6'::uuid,'syrup',false,0,NULL,40),
 ('52f8ffc5-8f9b-41d2-9ecd-574ece1cf5e6'::uuid,'sauce',false,0,NULL,50),
 ('52f8ffc5-8f9b-41d2-9ecd-574ece1cf5e6'::uuid,'inclusions',false,0,NULL,60),
 ('8a078f3e-872d-47e0-a1df-c14f33af64c2'::uuid,'syrup',false,0,NULL,40),
 ('8a078f3e-872d-47e0-a1df-c14f33af64c2'::uuid,'sauce',false,0,NULL,50),
 ('8a078f3e-872d-47e0-a1df-c14f33af64c2'::uuid,'inclusions',false,0,NULL,60),
 ('dd5face3-df84-47ae-8ce1-9e2b565a91dd'::uuid,'syrup',false,0,NULL,40),
 ('dd5face3-df84-47ae-8ce1-9e2b565a91dd'::uuid,'sauce',false,0,NULL,50),
 ('dd5face3-df84-47ae-8ce1-9e2b565a91dd'::uuid,'inclusions',false,0,NULL,60),
 ('f716d196-47f0-46f4-af7e-bda068b95b2d'::uuid,'syrup',false,0,NULL,40),
 ('483eed35-dd1d-4a87-90a6-2161b3d1ef86'::uuid,'syrup',false,0,NULL,40),
 ('ab350883-08eb-4b3a-b45a-03bb11f509a3'::uuid,'syrup',false,0,NULL,40),
 ('9eba0285-c567-4d8d-960a-4f2bed4a6bd7'::uuid,'syrup',false,0,NULL,40),
 ('24007d6c-e175-4dcf-9a6f-aab076e07b98'::uuid,'spicy',false,0,1,10),
 ('24007d6c-e175-4dcf-9a6f-aab076e07b98'::uuid,'addons',false,0,NULL,20),
 ('24007d6c-e175-4dcf-9a6f-aab076e07b98'::uuid,'cheese',false,0,1,30),
 ('ff9e0d6f-2a1b-4b6b-a401-e02370224f39'::uuid,'spicy',false,0,1,10),
 ('ff9e0d6f-2a1b-4b6b-a401-e02370224f39'::uuid,'addons',false,0,NULL,20),
 ('ff9e0d6f-2a1b-4b6b-a401-e02370224f39'::uuid,'cheese',false,0,1,30),
 ('c027eedc-1807-4574-8f14-79ce07bb544e'::uuid,'spicy',false,0,1,10),
 ('c027eedc-1807-4574-8f14-79ce07bb544e'::uuid,'addons',false,0,NULL,20),
 ('c027eedc-1807-4574-8f14-79ce07bb544e'::uuid,'cheese',false,0,1,30),
 ('c1f44003-500d-46aa-9fe6-9bbf35c57415'::uuid,'spicy',false,0,1,10),
 ('c1f44003-500d-46aa-9fe6-9bbf35c57415'::uuid,'addons',false,0,NULL,20),
 ('c1f44003-500d-46aa-9fe6-9bbf35c57415'::uuid,'cheese',false,0,1,30),
 ('610f399d-6fa3-46f1-b0b4-9fac6aa0ed5f'::uuid,'spicy',false,0,1,10),
 ('610f399d-6fa3-46f1-b0b4-9fac6aa0ed5f'::uuid,'addons',false,0,NULL,20),
 ('610f399d-6fa3-46f1-b0b4-9fac6aa0ed5f'::uuid,'cheese',false,0,1,30),
 ('2c218e48-9871-41a3-bb12-19ced7b38321'::uuid,'spicy',false,0,1,10),
 ('2c218e48-9871-41a3-bb12-19ced7b38321'::uuid,'addons',false,0,NULL,20),
 ('2c218e48-9871-41a3-bb12-19ced7b38321'::uuid,'cheese',false,0,1,30);

CREATE TEMP TABLE _curv_classic_size (
 product_id uuid PRIMARY KEY, regular_id uuid UNIQUE NOT NULL,
 large_id uuid UNIQUE NOT NULL, regular_price numeric NOT NULL
) ON COMMIT DROP;
INSERT INTO _curv_classic_size VALUES

 ('ec0956f8-8d28-414f-be46-2349e92bef76'::uuid,'532bedff-2344-4ff8-ac82-e3d958062a9f'::uuid,'ee6f7767-1f35-4cbc-9e14-0e314988b15e'::uuid,130),
 ('cbeecaec-e9a5-4faa-b8f3-75b0cae549dd'::uuid,'7da598a2-f675-4764-ba83-f923af768561'::uuid,'cd302ffe-1919-4ac8-8088-4e730fb12113'::uuid,150),
 ('7a258d7e-5b74-44c8-93af-38b1fbd92765'::uuid,'95c5e2d6-75de-4b68-8fbb-e9b81ac58ebc'::uuid,'debd8f6b-3a87-4044-825c-91ab7342e1ec'::uuid,140),
 ('aa156151-540b-4beb-b924-d97bf210af95'::uuid,'1ca62e3c-86bc-4655-8ba6-2d972369a93f'::uuid,'02a2d179-2921-4c13-ac21-67a4c7b2d5ad'::uuid,160),
 ('54c6725f-4445-435c-bc1d-b779e5963796'::uuid,'3b21ccce-2fa8-4c83-b4c9-392b7c9db398'::uuid,'bfc35a0a-d71d-4e0a-9da7-7a99fc95158e'::uuid,140),
 ('e684a6bd-aadc-4117-a018-ae0591c43d41'::uuid,'fe0c4074-ba4e-4c68-8e55-adf71b2577cc'::uuid,'f723ca06-a515-4712-ae81-aa889783a498'::uuid,120),
 ('9c0d9e22-8843-4595-b789-7550c29890a4'::uuid,'909ac7fa-e743-4848-87fa-7ec68304b9a1'::uuid,'86f8242b-128b-4474-beb3-7e7f5f56a9d6'::uuid,160),
 ('45b1f92c-0daa-4ed2-af55-c5da97315c0a'::uuid,'4a36f492-2cb1-49a6-93a2-d422a7ca5674'::uuid,'b33ef270-1e14-43a5-99ff-837ccab47f78'::uuid,160);

CREATE TEMP TABLE _curv_cheese_tier (
 product_id uuid NOT NULL, size_id uuid PRIMARY KEY, size_label text NOT NULL,
 delta numeric NOT NULL
) ON COMMIT DROP;
INSERT INTO _curv_cheese_tier VALUES

 ('24007d6c-e175-4dcf-9a6f-aab076e07b98'::uuid,'3c436f01-a9d6-4c70-a2a3-2c35f6d78635'::uuid,'4pcs',30),
 ('24007d6c-e175-4dcf-9a6f-aab076e07b98'::uuid,'b7b88390-fccf-4124-9346-4cc1afd80e5c'::uuid,'8pcs',60),
 ('24007d6c-e175-4dcf-9a6f-aab076e07b98'::uuid,'bbce5f8f-db50-40e4-8bce-ec8d4a1c685d'::uuid,'12pcs',90),
 ('ff9e0d6f-2a1b-4b6b-a401-e02370224f39'::uuid,'5092934c-919e-4c53-8890-ca29316aa551'::uuid,'4pcs',30),
 ('ff9e0d6f-2a1b-4b6b-a401-e02370224f39'::uuid,'22fbd2e7-7c33-4e4d-b3a2-ccf0860cb322'::uuid,'8pcs',60),
 ('ff9e0d6f-2a1b-4b6b-a401-e02370224f39'::uuid,'30df5f88-3760-4e46-bb52-a304e2fa2f42'::uuid,'12pcs',90),
 ('c027eedc-1807-4574-8f14-79ce07bb544e'::uuid,'a5f59fd4-ce5c-4049-87a0-9b6d41faf246'::uuid,'4pcs',30),
 ('c027eedc-1807-4574-8f14-79ce07bb544e'::uuid,'d0c8adf8-2398-441a-9880-eeead91ea6fe'::uuid,'8pcs',60),
 ('c027eedc-1807-4574-8f14-79ce07bb544e'::uuid,'836b56fc-ec63-49d6-9e3f-7be32c233888'::uuid,'12pcs',90),
 ('c1f44003-500d-46aa-9fe6-9bbf35c57415'::uuid,'b958356c-1e4e-44ea-8c1f-f61683bd2a80'::uuid,'4pcs',30),
 ('c1f44003-500d-46aa-9fe6-9bbf35c57415'::uuid,'0cfceeae-1a12-47a4-b544-1c53395c82d3'::uuid,'8pcs',60),
 ('c1f44003-500d-46aa-9fe6-9bbf35c57415'::uuid,'43394c3a-2256-40bc-bcdd-89b5aeb69556'::uuid,'12pcs',90),
 ('610f399d-6fa3-46f1-b0b4-9fac6aa0ed5f'::uuid,'d37cf9b3-8742-4a0e-aa17-fc2df384cc5d'::uuid,'8pcs',60),
 ('610f399d-6fa3-46f1-b0b4-9fac6aa0ed5f'::uuid,'81c30dcf-9bae-4055-a1c4-2d46e3ca0ad3'::uuid,'12pcs',90),
 ('2c218e48-9871-41a3-bb12-19ced7b38321'::uuid,'6fdd4f4b-481d-4fbc-9459-4208dff71006'::uuid,'8pcs',60),
 ('2c218e48-9871-41a3-bb12-19ced7b38321'::uuid,'fe484ccc-5a71-48e1-bb6a-fa4535002836'::uuid,'12pcs',90);

CREATE TEMP TABLE _curv_existing_choice (
 id uuid PRIMARY KEY, group_id uuid NOT NULL, old_label text NOT NULL,
 old_value text, old_delta numeric NOT NULL, old_active boolean NOT NULL
) ON COMMIT DROP;
INSERT INTO _curv_existing_choice VALUES

 ('3db8c36d-2e8e-4343-b8de-683b65070961'::uuid,'232d1301-d072-48ed-a363-6d5af6a6d906'::uuid,'12pcs','12pcs',90,true),
 ('7c4e3426-a4ea-427c-ad73-b0815242e7c4'::uuid,'232d1301-d072-48ed-a363-6d5af6a6d906'::uuid,'4pcs','4pcs',30,true),
 ('bab37892-3af1-4498-ad67-71271c9cad70'::uuid,'232d1301-d072-48ed-a363-6d5af6a6d906'::uuid,'8pcs','8pcs',60,true),
 ('ed7d2165-f29d-4ca7-b4d8-1e5bbb89d0a7'::uuid,'5475e951-d4b1-46bf-a556-f63aecdf0fe2'::uuid,'Tempura Sauce','Tempura Sauce',0,true),
 ('61c4fd98-6351-4daf-8074-f747da337c5c'::uuid,'6f1074e8-f51a-41cd-a7f0-ed777418c916'::uuid,'Add Espresso Shot','single_shot',45,true),
 ('bd6ff3fe-73c6-4f78-9f9e-8304af73ad5a'::uuid,'6f1074e8-f51a-41cd-a7f0-ed777418c916'::uuid,'Double Shot','double_shot',90,true),
 ('e07fcd14-ed31-427c-bd67-3067d5c71410'::uuid,'516fb052-949a-43f5-8734-5b3f60bc76be'::uuid,'Chocolate chips','chocolate_chips',40,true),
 ('e93da599-6652-44c5-80e9-f3d2dd1950ca'::uuid,'516fb052-949a-43f5-8734-5b3f60bc76be'::uuid,'Coffee Jelly','coffee_jelly',40,true),
 ('505ad026-b0c7-48a9-a1fb-011a4c8a17ef'::uuid,'516fb052-949a-43f5-8734-5b3f60bc76be'::uuid,'White Chocolate Chips','white_chocolate_chips',40,true),
 ('c7b34dc7-1fe6-4825-bd50-65efb6a37c6c'::uuid,'f16decf7-b5a4-4b98-8182-c9c2c9eca1f0'::uuid,'Chocolate','chocolate',45,true),
 ('086c711e-a1b5-46cf-a5e0-f14394a95dfa'::uuid,'f16decf7-b5a4-4b98-8182-c9c2c9eca1f0'::uuid,'Salted Caramel','salted_caramel',45,true),
 ('6aea534b-4ead-43f1-af1a-0eb80afffc95'::uuid,'f16decf7-b5a4-4b98-8182-c9c2c9eca1f0'::uuid,'Strawberry','strawberry',45,true),
 ('f533a65f-da2e-462b-8c34-81eb061cfa11'::uuid,'f16decf7-b5a4-4b98-8182-c9c2c9eca1f0'::uuid,'White Chocolate','white_chocolate',45,true),
 ('59203eed-e726-4582-a8a8-4d7c9001f338'::uuid,'da657452-3dfe-4ba1-b695-26648180d999'::uuid,'Caramel','caramel',30,true),
 ('4e07d4f6-9302-41fb-93f2-02fb9054aea6'::uuid,'da657452-3dfe-4ba1-b695-26648180d999'::uuid,'Chocolate Syrup','chocolate_syrup',30,true),
 ('47216d41-5c5e-4891-beb2-4189993f49df'::uuid,'da657452-3dfe-4ba1-b695-26648180d999'::uuid,'Vanilla','vanilla',30,true),
 ('a089875e-fde2-45ed-bafd-a14f16efbb5b'::uuid,'da657452-3dfe-4ba1-b695-26648180d999'::uuid,'White Chocolate Syrup','white_chocolate_syrup',30,true),
 ('d496995e-4e81-4298-b51e-6d316fc2de83'::uuid,'ff3aa2ce-e4ab-4870-98e1-93ff8078b534'::uuid,'Katsuboshi (Tuna Flakes)','katsuboshi_tuna_flakes',30,true),
 ('722860cc-085a-4bf3-868e-52d7a877c0cb'::uuid,'ff3aa2ce-e4ab-4870-98e1-93ff8078b534'::uuid,'Meat Floss','meat_floss',40,true),
 ('c9b382d8-5eee-4d50-a1dc-7ceed43b5fdc'::uuid,'c6727e99-bae9-4963-a7cb-b238409667d9'::uuid,'Hot','hot',0,true),
 ('c018fa7b-5cb5-490a-9d8a-7a5611a1bd67'::uuid,'c6727e99-bae9-4963-a7cb-b238409667d9'::uuid,'Iced','iced',0,true),
 ('04672e62-40c1-4595-955b-55ab7e2598fa'::uuid,'8a798579-ae21-47a2-8b84-6dc545b788bd'::uuid,'Non-fat','non_fat',30,true),
 ('049cc2e6-14d3-4892-abaf-a82b9cd6ed84'::uuid,'8a798579-ae21-47a2-8b84-6dc545b788bd'::uuid,'Oat','oat',50,true),
 ('cd6cfd0e-9826-4c16-bf1a-4d5305186fed'::uuid,'8a798579-ae21-47a2-8b84-6dc545b788bd'::uuid,'Soy Milk','soy_milk',30,true);

CREATE TEMP TABLE _curv_existing_assignment (
 id uuid PRIMARY KEY, product_id uuid NOT NULL, group_id uuid NOT NULL,
 old_required boolean NOT NULL, old_min integer NOT NULL,
 old_max integer, old_sort integer NOT NULL, old_active boolean NOT NULL
) ON COMMIT DROP;
INSERT INTO _curv_existing_assignment VALUES

 ('6f954ddd-953d-4ee1-838d-4ed89967717b'::uuid,'e058ec46-f133-4982-afe6-cc6cf5e6d521'::uuid,'6f1074e8-f51a-41cd-a7f0-ed777418c916'::uuid,false,0,NULL,0,true),
 ('e17e04ce-f596-4ecf-a205-3c3321620210'::uuid,'e058ec46-f133-4982-afe6-cc6cf5e6d521'::uuid,'8a798579-ae21-47a2-8b84-6dc545b788bd'::uuid,false,0,1,1,true),
 ('5350612d-7b76-49c0-a50f-88024a7832ec'::uuid,'e058ec46-f133-4982-afe6-cc6cf5e6d521'::uuid,'da657452-3dfe-4ba1-b695-26648180d999'::uuid,false,0,NULL,2,true),
 ('4995e604-4224-4ffd-9599-a6db02542836'::uuid,'e058ec46-f133-4982-afe6-cc6cf5e6d521'::uuid,'f16decf7-b5a4-4b98-8182-c9c2c9eca1f0'::uuid,false,0,NULL,3,true),
 ('14783335-981c-407a-8b52-4c032122538d'::uuid,'e058ec46-f133-4982-afe6-cc6cf5e6d521'::uuid,'c6727e99-bae9-4963-a7cb-b238409667d9'::uuid,false,0,1,4,true),
 ('a021fee7-ad9e-4373-9dc6-42d907c367da'::uuid,'ec0956f8-8d28-414f-be46-2349e92bef76'::uuid,'c6727e99-bae9-4963-a7cb-b238409667d9'::uuid,true,1,1,0,true),
 ('5f1415de-a4b1-426c-b018-e8dd768a482b'::uuid,'ec0956f8-8d28-414f-be46-2349e92bef76'::uuid,'8a798579-ae21-47a2-8b84-6dc545b788bd'::uuid,false,0,1,1,true),
 ('b5c04824-9419-4e96-9bd3-cb11741e045e'::uuid,'ec0956f8-8d28-414f-be46-2349e92bef76'::uuid,'6f1074e8-f51a-41cd-a7f0-ed777418c916'::uuid,false,0,NULL,2,true),
 ('3943b67f-45f7-476d-beb3-4eafef17109c'::uuid,'ec0956f8-8d28-414f-be46-2349e92bef76'::uuid,'da657452-3dfe-4ba1-b695-26648180d999'::uuid,false,0,NULL,2,true),
 ('0ecc9017-5a9b-4832-8ec7-2b11bb33d968'::uuid,'ec0956f8-8d28-414f-be46-2349e92bef76'::uuid,'f16decf7-b5a4-4b98-8182-c9c2c9eca1f0'::uuid,false,0,NULL,3,true),
 ('da9742a2-5ab0-453e-89a8-583f0eff6a46'::uuid,'ffcf04b4-1500-4463-aa25-3703a1e167ed'::uuid,'5475e951-d4b1-46bf-a556-f63aecdf0fe2'::uuid,true,1,1,0,true);

-- PREFLIGHT: every mismatch aborts before the first persistent mutation.
-- Reapply accepts only the exact approved before-image or the exact final image.
DO $preflight$
BEGIN
 IF (SELECT count(*) FROM _curv_expected_group)<>10
 OR (SELECT count(*) FROM _curv_expected_product)<>62
 OR (SELECT count(*) FROM _curv_expected_excluded_state)<>19
 OR (SELECT count(*) FROM _curv_expected_assignment)<>117
 OR (SELECT count(DISTINCT product_id) FROM _curv_expected_assignment)<>35
 OR (SELECT count(*) FROM _curv_classic_size)<>8
 OR (SELECT count(*) FROM _curv_cheese_tier)<>16
 OR (SELECT count(*) FROM _curv_existing_choice)<>24
 OR (SELECT count(*) FROM _curv_existing_assignment)<>11 THEN
   RAISE EXCEPTION 'CURV manifest is incomplete' USING DETAIL='CURV_OPTION_MANIFEST_INCOMPLETE';
 END IF;
 IF EXISTS (
   SELECT 1 FROM _curv_expected_group e LEFT JOIN public.option_groups g ON g.id=e.id
   WHERE g.id IS NULL OR g.name<>e.name OR g.group_key NOT IN (e.old_key,e.new_key)
      OR g.selection_type NOT IN (e.old_type,e.new_type) OR NOT g.is_active
 ) OR EXISTS (
   SELECT 1 FROM _curv_expected_group e JOIN public.option_groups g
   ON g.group_key=e.new_key AND g.id<>e.id
 ) THEN
   RAISE EXCEPTION 'Option group inventory drift or canonical key collision' USING DETAIL='CURV_OPTION_GROUP_DRIFT';
 END IF;
 IF EXISTS (
   SELECT 1 FROM _curv_expected_product e
   LEFT JOIN public.products p ON p.id=e.id
   LEFT JOIN public.categories cat ON cat.id=p.category_id
   WHERE p.id IS NULL OR p.name IS DISTINCT FROM e.name OR
     (CASE WHEN cat.id IS NULL THEN 'CATEGORY_MISSING'
           WHEN NOT p.is_published THEN 'UNPUBLISHED'
           WHEN NOT p.is_available THEN 'UNAVAILABLE'
           WHEN COALESCE((to_jsonb(cat)->>'is_active')::boolean,false)=false
             THEN 'CATEGORY_INACTIVE_OR_UNKNOWN'
           WHEN to_jsonb(p)->>'archived_at' IS NOT NULL THEN 'ARCHIVED'
           WHEN COALESCE((to_jsonb(p)->>'is_sold_out')::boolean,false)
             THEN 'SOLD_OUT'
           WHEN NOT EXISTS (SELECT 1 FROM public.product_sizes sz WHERE sz.product_id=p.id)
             THEN 'NO_SIZE'
           ELSE 'SELLABLE_CANDIDATE' END) IS DISTINCT FROM e.expected_state
 ) THEN
   RAISE EXCEPTION 'Product identity or catalog state changed since approved inventory'
     USING DETAIL='CURV_OPTION_PRODUCT_DRIFT';
 END IF;
 IF EXISTS (
   SELECT 1 FROM _curv_expected_excluded_state e
   LEFT JOIN public.products p ON p.id=e.product_id
   LEFT JOIN public.categories cat ON cat.id=p.category_id
   WHERE p.id IS NULL OR cat.id IS NULL OR
     (p.category_id,p.is_published,p.is_available,
      COALESCE((to_jsonb(p)->>'is_sold_out')::boolean,false),
      (to_jsonb(p)->>'archived_at')::timestamptz,
      COALESCE((to_jsonb(cat)->>'is_active')::boolean,false))
     IS DISTINCT FROM
     (e.category_id,e.is_published,e.is_available,e.is_sold_out,
      e.archived_at,e.category_active)
 ) THEN
   RAISE EXCEPTION 'Excluded product state changed since approved inventory'
     USING DETAIL='CURV_OPTION_EXCLUDED_STATE_DRIFT';
 END IF;
 IF EXISTS (
   SELECT 1 FROM _curv_existing_choice e LEFT JOIN public.option_choices c ON c.id=e.id
   WHERE c.id IS NULL OR c.option_group_id<>e.group_id OR c.price_delta<>e.old_delta
      OR (e.id='7c4e3426-a4ea-427c-ad73-b0815242e7c4'::uuid
           AND ((c.label,c.value,c.is_active) NOT IN (('4pcs','4pcs',true),('Add Cheese','yes',true))))
      OR (e.id IN ('bab37892-3af1-4498-ad67-71271c9cad70'::uuid,
                   '3db8c36d-2e8e-4343-b8de-683b65070961'::uuid)
           AND (c.label IS DISTINCT FROM e.old_label OR c.value IS DISTINCT FROM e.old_value))
      OR (e.id NOT IN ('7c4e3426-a4ea-427c-ad73-b0815242e7c4'::uuid,
                       'bab37892-3af1-4498-ad67-71271c9cad70'::uuid,
                       '3db8c36d-2e8e-4343-b8de-683b65070961'::uuid)
           AND (c.label IS DISTINCT FROM e.old_label OR c.value IS DISTINCT FROM e.old_value OR c.is_active<>e.old_active))
 ) THEN
   RAISE EXCEPTION 'Existing choice identity, owner or price changed' USING DETAIL='CURV_OPTION_CHOICE_DRIFT';
 END IF;
 IF EXISTS (
   SELECT 1 FROM _curv_existing_assignment e LEFT JOIN public.product_option_groups a ON a.id=e.id
   WHERE a.id IS NULL OR a.product_id<>e.product_id OR a.option_group_id<>e.group_id
 ) THEN
   RAISE EXCEPTION 'Existing assignment UUID ownership changed' USING DETAIL='CURV_OPTION_ASSIGNMENT_DRIFT';
 END IF;
 IF EXISTS (
   SELECT 1 FROM _curv_classic_size e
   LEFT JOIN public.product_sizes r ON r.id=e.regular_id
   LEFT JOIN public.product_sizes l ON l.id=e.large_id
   WHERE r.id IS NULL OR l.id IS NULL OR r.product_id<>e.product_id OR l.product_id<>e.product_id
      OR r.label<>'Regular' OR l.label<>'Large' OR r.price<>e.regular_price
 ) OR EXISTS (
   SELECT 1 FROM _curv_cheese_tier e LEFT JOIN public.product_sizes s ON s.id=e.size_id
   WHERE s.id IS NULL OR s.product_id<>e.product_id OR s.label<>e.size_label
 ) THEN
   RAISE EXCEPTION 'Existing size identity or approved Regular price changed' USING DETAIL='CURV_OPTION_SIZE_DRIFT';
 END IF;
 IF EXISTS (
   SELECT 1 FROM configuration_private.product_pricing_certifications c
   JOIN _curv_expected_product p ON p.id=c.product_id
   WHERE p.expected_state='SELLABLE_CANDIDATE'
 ) THEN
   RAISE EXCEPTION 'Sellable products unexpectedly certified; assess certification invalidation'
     USING DETAIL='CURV_OPTION_CERTIFICATION_COLLISION';
 END IF;
 IF EXISTS (
   SELECT 1 FROM public.product_option_groups a
   JOIN _curv_expected_product p ON p.id=a.product_id AND p.expected_state='SELLABLE_CANDIDATE'
   JOIN public.option_groups g ON g.id=a.option_group_id
   LEFT JOIN _curv_expected_assignment e ON e.product_id=a.product_id AND e.group_key IN (g.group_key,
      (SELECT x.new_key FROM _curv_expected_group x WHERE x.id=g.id))
   WHERE a.is_active AND e.product_id IS NULL
 ) THEN
   RAISE EXCEPTION 'Unapproved active product option mapping exists' USING DETAIL='CURV_OPTION_EXTRA_MAPPING';
 END IF;
 IF EXISTS (
   SELECT 1 FROM public.product_option_defaults d
   WHERE d.id='cfe33aa7-fd9d-4e0b-b0c4-016200e59ec2'::uuid
     AND (d.product_id<>'ffcf04b4-1500-4463-aa25-3703a1e167ed'::uuid OR
          d.option_group_id<>'5475e951-d4b1-46bf-a556-f63aecdf0fe2'::uuid OR
          d.option_choice_id<>'ed7d2165-f29d-4ca7-b4d8-1e5bbb89d0a7'::uuid)
 ) OR EXISTS (
   SELECT 1 FROM public.product_option_defaults d
   WHERE d.product_id='ffcf04b4-1500-4463-aa25-3703a1e167ed'::uuid
      AND d.option_group_id='5475e951-d4b1-46bf-a556-f63aecdf0fe2'::uuid
      AND d.id<>'cfe33aa7-fd9d-4e0b-b0c4-016200e59ec2'::uuid
 ) THEN
   RAISE EXCEPTION 'Shrimp sauce default differs from inventory' USING DETAIL='CURV_OPTION_DEFAULT_DRIFT';
 END IF;
 IF EXISTS (
   SELECT 1 FROM public.product_option_defaults d
   WHERE d.product_id='e058ec46-f133-4982-afe6-cc6cf5e6d521'::uuid
     AND d.option_group_id='c6727e99-bae9-4963-a7cb-b238409667d9'::uuid
 ) THEN
   RAISE EXCEPTION 'Unexpected Brown Sugar temperature default needs manual before-image'
     USING DETAIL='CURV_OPTION_SIGNATURE_DEFAULT_COLLISION';
 END IF;
END
$preflight$;

DO $assignment_preflight$
BEGIN
 IF EXISTS (
   SELECT 1 FROM _curv_existing_assignment e
   JOIN public.product_option_groups a ON a.id=e.id
   LEFT JOIN _curv_expected_group eg ON eg.id=e.group_id
   LEFT JOIN _curv_expected_assignment intended
     ON intended.product_id=e.product_id AND intended.group_key=eg.new_key
   WHERE NOT (
     (a.is_required,a.min_selections,a.max_selections,a.sort_order,a.is_active)
       IS NOT DISTINCT FROM
       (e.old_required,e.old_min,e.old_max,e.old_sort,e.old_active)
     OR
     (intended.product_id IS NOT NULL AND
      (a.is_required,a.min_selections,a.max_selections,a.sort_order,a.is_active)
       IS NOT DISTINCT FROM
       (intended.is_required,intended.min_selections,intended.max_selections,
        intended.sort_order,true))
     OR
     (e.id IN ('da9742a2-5ab0-453e-89a8-583f0eff6a46'::uuid,
               '14783335-981c-407a-8b52-4c032122538d'::uuid)
      AND (a.is_required,a.min_selections,a.max_selections,a.sort_order,a.is_active)
       IS NOT DISTINCT FROM
       (e.old_required,e.old_min,e.old_max,e.old_sort,false))
   )
 ) THEN
   RAISE EXCEPTION 'Existing assignment rules changed since inventory'
     USING DETAIL='CURV_OPTION_ASSIGNMENT_RULE_DRIFT';
 END IF;
 IF EXISTS (
   SELECT 1 FROM public.products p
   WHERE p.id='ffcf04b4-1500-4463-aa25-3703a1e167ed'::uuid
     AND (p.is_published OR p.is_available OR p.archived_at IS NULL)
 ) THEN
   RAISE EXCEPTION 'Shrimp Tempura publication state changed'
     USING DETAIL='CURV_OPTION_SHRIMP_STATE_DRIFT';
 END IF;
END
$assignment_preflight$;

DO $preflight_new$
BEGIN
 IF EXISTS (SELECT 1 FROM public.option_groups g WHERE g.group_key='extrapower'
             AND (g.name<>'Extra Powder' OR g.selection_type<>'single' OR NOT g.is_active))
 OR EXISTS (SELECT 1 FROM public.option_groups g WHERE g.group_key='spicy'
             AND (g.name<>'Spice Level' OR g.selection_type<>'single' OR NOT g.is_active)) THEN
   RAISE EXCEPTION 'New group key collision' USING DETAIL='CURV_OPTION_NEW_GROUP_COLLISION';
 END IF;
 IF EXISTS (
   SELECT 1 FROM public.option_choices c JOIN public.option_groups g ON g.id=c.option_group_id
   JOIN (VALUES
      ('extrapower','+1g Extra Powder','+1g',45::numeric),
      ('spicy','no','Not Spicy',0::numeric),
      ('spicy','yes','Spicy',0::numeric),
      ('sweetener','no-sweetener','No Sweetener',0::numeric),
      ('sweetener','Simple Syrup','Simple Syrup',0::numeric),
      ('sweetener','Agave Syrup','Agave',30::numeric),
      ('sweetener','Honey','Honey',30::numeric)
   ) AS x(group_key,choice_value,choice_label,delta)
     ON x.group_key=g.group_key AND x.choice_value=c.value
   WHERE c.label<>x.choice_label OR c.price_delta<>x.delta OR NOT c.is_active
 ) OR EXISTS (
   SELECT 1 FROM public.option_choices c JOIN public.option_groups g ON g.id=c.option_group_id
   WHERE (g.group_key IN ('extrapower','spicy') AND c.value NOT IN
       ('+1g Extra Powder','no','yes'))
     OR (g.group_key='sweetener' AND c.value NOT IN
       ('no-sweetener','Simple Syrup','Agave Syrup','Honey'))
 ) THEN
   RAISE EXCEPTION 'Approved new choice values collide with existing data' USING DETAIL='CURV_OPTION_NEW_CHOICE_COLLISION';
 END IF;
 IF EXISTS (
   SELECT 1 FROM _curv_classic_size x JOIN public.product_sizes s
     ON s.product_id=x.product_id AND s.label='12oz Hot'
   WHERE s.price<>x.regular_price
 ) OR EXISTS (
   SELECT product_id FROM public.product_sizes WHERE label='12oz Hot'
     AND product_id IN (SELECT product_id FROM _curv_classic_size)
   GROUP BY product_id HAVING count(*)>1
 ) THEN
   RAISE EXCEPTION 'Existing 12oz Hot row differs from approved model' USING DETAIL='CURV_OPTION_HOT_SIZE_COLLISION';
 END IF;
END
$preflight_new$;

-- PHASE 1: canonical keys and selection modes, preserving the ten known UUIDs.
-- Rollback: restore each prior key/type from the imported A inventory; remove
-- generated groups only after removing dependent choices/assignments.
UPDATE public.option_groups g SET group_key=e.new_key, selection_type=e.new_type
FROM _curv_expected_group e
WHERE g.id=e.id AND (g.group_key,g.selection_type) IS DISTINCT FROM (e.new_key,e.new_type);
INSERT INTO public.option_groups(name,group_key,selection_type,is_active,sort_order)
SELECT x.name,x.group_key,'single',true,0
FROM (VALUES ('Extra Powder','extrapower'),('Spice Level','spicy')) AS x(name,group_key)
WHERE NOT EXISTS (SELECT 1 FROM public.option_groups g WHERE g.group_key=x.group_key);

-- PHASE 2: add only seven owner-approved choices. Existing choices keep UUIDs
-- and prices. The 4pcs cheese UUID becomes semantic Add Cheese/yes; old
-- 8pcs/12pcs choices are retained until phase 7 contextual rows are complete.
-- Rollback: remove only generated unused choices; restore 4pcs label/value.
UPDATE public.option_choices SET label='Add Cheese', value='yes'
WHERE id='7c4e3426-a4ea-427c-ad73-b0815242e7c4'::uuid
  AND (label,value) IS DISTINCT FROM ('Add Cheese','yes');
INSERT INTO public.option_choices(option_group_id,label,value,price_delta,sort_order,is_active)
SELECT g.id,x.label,x.value,x.delta,x.sort_order,true
FROM (VALUES
 ('extrapower','+1g','+1g Extra Powder',45::numeric,0),
 ('spicy','Not Spicy','no',0::numeric,0),
 ('spicy','Spicy','yes',0::numeric,1),
 ('sweetener','No Sweetener','no-sweetener',0::numeric,0),
 ('sweetener','Simple Syrup','Simple Syrup',0::numeric,1),
 ('sweetener','Agave','Agave Syrup',30::numeric,2),
 ('sweetener','Honey','Honey',30::numeric,3)
) AS x(group_key,label,value,delta,sort_order)
JOIN public.option_groups g ON g.group_key=x.group_key
WHERE NOT EXISTS (SELECT 1 FROM public.option_choices c
                  WHERE c.option_group_id=g.id AND c.value=x.value);

-- PHASE 3: apply the exact 117 product/group pairs in the manifest.
-- Savory sauce/default retirement is atomic. No category-wide assignment.
-- Rollback: restore original 11 assignment rows from C; remove generated
-- assignments only after their defaults/context have been removed.
DELETE FROM public.product_option_defaults
WHERE id='cfe33aa7-fd9d-4e0b-b0c4-016200e59ec2'::uuid
  AND product_id='ffcf04b4-1500-4463-aa25-3703a1e167ed'::uuid
  AND option_group_id='5475e951-d4b1-46bf-a556-f63aecdf0fe2'::uuid
  AND option_choice_id='ed7d2165-f29d-4ca7-b4d8-1e5bbb89d0a7'::uuid;
UPDATE public.product_option_groups SET is_active=false
WHERE id IN ('da9742a2-5ab0-453e-89a8-583f0eff6a46'::uuid,
             '14783335-981c-407a-8b52-4c032122538d'::uuid)
  AND is_active;
INSERT INTO public.product_option_groups
 (product_id,option_group_id,is_required,min_selections,max_selections,sort_order,is_active)
SELECT e.product_id,g.id,e.is_required,e.min_selections,e.max_selections,e.sort_order,true
FROM _curv_expected_assignment e
JOIN public.option_groups g ON g.group_key=e.group_key AND g.is_active
WHERE true
ON CONFLICT (product_id,option_group_id) DO UPDATE
 SET is_required=excluded.is_required,
     min_selections=excluded.min_selections,
     max_selections=excluded.max_selections,
     sort_order=excluded.sort_order,
     is_active=true
WHERE (product_option_groups.is_required,product_option_groups.min_selections,
       product_option_groups.max_selections,product_option_groups.sort_order,
       product_option_groups.is_active)
 IS DISTINCT FROM
      (excluded.is_required,excluded.min_selections,excluded.max_selections,
       excluded.sort_order,true);

-- PHASE 4: the only intended structured defaults (8 Iced, 5 No Sweetener,
-- 6 Not Spicy). Built-in milk and optional add-ons have no default.
-- HOLD FOR FINAL OWNER CONFIRMATION of all three default sets before cutover.
-- Shrimp's obsolete default was removed immediately before retirement above.
-- Rollback: remove only these new default triples; restore Shrimp's exact
-- imported default only if its assignment is simultaneously reactivated.
CREATE TEMP TABLE _curv_expected_default
 (product_id uuid NOT NULL, group_key text NOT NULL, choice_value text NOT NULL,
  PRIMARY KEY(product_id,group_key)) ON COMMIT DROP;
INSERT INTO _curv_expected_default VALUES

 ('ec0956f8-8d28-414f-be46-2349e92bef76'::uuid,'temperature','iced'),
 ('cbeecaec-e9a5-4faa-b8f3-75b0cae549dd'::uuid,'temperature','iced'),
 ('7a258d7e-5b74-44c8-93af-38b1fbd92765'::uuid,'temperature','iced'),
 ('aa156151-540b-4beb-b924-d97bf210af95'::uuid,'temperature','iced'),
 ('54c6725f-4445-435c-bc1d-b779e5963796'::uuid,'temperature','iced'),
 ('e684a6bd-aadc-4117-a018-ae0591c43d41'::uuid,'temperature','iced'),
 ('9c0d9e22-8843-4595-b789-7550c29890a4'::uuid,'temperature','iced'),
 ('45b1f92c-0daa-4ed2-af55-c5da97315c0a'::uuid,'temperature','iced'),
 ('93e9a33b-1a37-4edf-9d26-5ddd2d87f87d'::uuid,'sweetener','no-sweetener'),
 ('e635744c-ed77-4924-a90d-c78440a81603'::uuid,'sweetener','no-sweetener'),
 ('d053466a-2a52-420c-bc4c-62b5f614a27f'::uuid,'sweetener','no-sweetener'),
 ('82417b58-d0c4-4d0d-a0cd-27da42b42627'::uuid,'sweetener','no-sweetener'),
 ('6caefdb6-7daf-4e6d-a034-95fda0b7ecd7'::uuid,'sweetener','no-sweetener'),
 ('24007d6c-e175-4dcf-9a6f-aab076e07b98'::uuid,'spicy','no'),
 ('ff9e0d6f-2a1b-4b6b-a401-e02370224f39'::uuid,'spicy','no'),
 ('c027eedc-1807-4574-8f14-79ce07bb544e'::uuid,'spicy','no'),
 ('c1f44003-500d-46aa-9fe6-9bbf35c57415'::uuid,'spicy','no'),
 ('610f399d-6fa3-46f1-b0b4-9fac6aa0ed5f'::uuid,'spicy','no'),
 ('2c218e48-9871-41a3-bb12-19ced7b38321'::uuid,'spicy','no');

DO $defaults_guard$
BEGIN
 IF (SELECT count(*) FROM _curv_expected_default)<>19 THEN
  RAISE EXCEPTION 'Approved default manifest incomplete' USING DETAIL='CURV_OPTION_DEFAULT_MANIFEST';
 END IF;
 IF EXISTS (
   SELECT 1 FROM public.product_option_defaults d
   JOIN _curv_expected_product p ON p.id=d.product_id
   LEFT JOIN _curv_expected_default e ON e.product_id=d.product_id AND
     e.group_key=(SELECT g.group_key FROM public.option_groups g WHERE g.id=d.option_group_id)
   LEFT JOIN public.option_choices c ON c.id=d.option_choice_id
   WHERE p.expected_state='SELLABLE_CANDIDATE'
     AND (e.product_id IS NULL OR c.value IS DISTINCT FROM e.choice_value)
 ) THEN
  RAISE EXCEPTION 'Unexpected sellable-product default' USING DETAIL='CURV_OPTION_DEFAULT_COLLISION';
 END IF;
END
$defaults_guard$;
INSERT INTO public.product_option_defaults(product_id,option_group_id,option_choice_id)
SELECT e.product_id,g.id,c.id
FROM _curv_expected_default e
JOIN public.option_groups g ON g.group_key=e.group_key
JOIN public.option_choices c ON c.option_group_id=g.id AND c.value=e.choice_value AND c.is_active
WHERE NOT EXISTS (
 SELECT 1 FROM public.product_option_defaults d
 WHERE d.product_id=e.product_id AND d.option_group_id=g.id AND d.option_choice_id=c.id
);

-- PHASE 5: eight real 12oz Hot size rows, generated UUID defaults.
-- Existing Regular/Large UUIDs and prices are untouched.
-- Rollback: remove generated Hot rows only after removing their compatibility
-- and confirming no historical order references; do not cascade-delete.
INSERT INTO public.product_sizes(product_id,label,price,sort_order)
SELECT e.product_id,'12oz Hot',e.regular_price,2
FROM _curv_classic_size e
WHERE NOT EXISTS (SELECT 1 FROM public.product_sizes s
                  WHERE s.product_id=e.product_id AND s.label='12oz Hot');
DO $hot_guard$
BEGIN
 IF (SELECT count(*) FROM public.product_sizes s JOIN _curv_classic_size e
     ON e.product_id=s.product_id WHERE s.label='12oz Hot'
       AND s.price=e.regular_price)<>8 THEN
  RAISE EXCEPTION 'Hot sizes incomplete' USING DETAIL='CURV_OPTION_HOT_SIZE_INCOMPLETE';
 END IF;
END
$hot_guard$;

-- PHASE 6: exactly three allowed temperature pairs per classic drink.
-- UUIDs for new sizes are resolved from their verified product/label identities.
-- Rollback: remove these 24 tuples before removing newly created sizes.
CREATE TEMP TABLE _curv_expected_compatibility
 (product_id uuid NOT NULL, product_size_id uuid NOT NULL,
  option_choice_id uuid NOT NULL,
  PRIMARY KEY(product_id,product_size_id,option_choice_id)) ON COMMIT DROP;
INSERT INTO _curv_expected_compatibility
SELECT product_id,regular_id,'c018fa7b-5cb5-490a-9d8a-7a5611a1bd67'::uuid FROM _curv_classic_size
UNION ALL
SELECT product_id,large_id,'c018fa7b-5cb5-490a-9d8a-7a5611a1bd67'::uuid FROM _curv_classic_size
UNION ALL
SELECT e.product_id,s.id,'c9b382d8-5eee-4d50-a1dc-7ceed43b5fdc'::uuid
FROM _curv_classic_size e JOIN public.product_sizes s
 ON s.product_id=e.product_id AND s.label='12oz Hot';
DO $compat_guard$
BEGIN
 IF (SELECT count(*) FROM _curv_expected_compatibility)<>24
 OR EXISTS (
   SELECT 1 FROM public.product_size_option_choice_compatibility c
   JOIN _curv_classic_size e ON e.product_id=c.product_id
   WHERE c.is_active AND NOT EXISTS (
     SELECT 1 FROM _curv_expected_compatibility x
     WHERE x.product_id=c.product_id AND x.product_size_id=c.product_size_id
       AND x.option_choice_id=c.option_choice_id)
 ) THEN
  RAISE EXCEPTION 'Temperature compatibility differs from 24 approved tuples'
    USING DETAIL='CURV_OPTION_COMPATIBILITY_COLLISION';
 END IF;
END
$compat_guard$;
INSERT INTO public.product_size_option_choice_compatibility
 (product_id,product_size_id,option_choice_id,is_active)
SELECT product_id,product_size_id,option_choice_id,true
FROM _curv_expected_compatibility
WHERE true
ON CONFLICT (product_id,product_size_id,option_choice_id)
 DO UPDATE SET is_active=true
 WHERE NOT product_size_option_choice_compatibility.is_active;

-- PHASE 7: one product-wide Cloud Oat zero-price substitution and
-- 16 size-scoped Add Cheese price/requirement pairs. Every override has the
-- same-scope requirement. Cocoa/Breve and deferred CS Oat are untouched.
-- Rollback: remove override and requirement rows together; restore 8pcs/12pcs
-- cheese activity and the old 4pcs choice semantics if reversing the feature.
CREATE TEMP TABLE _curv_expected_context
 (product_id uuid NOT NULL, product_size_id uuid,
  option_choice_id uuid NOT NULL, delta numeric NOT NULL,
  specificity text NOT NULL) ON COMMIT DROP;
INSERT INTO _curv_expected_context
SELECT product_id,size_id,'7c4e3426-a4ea-427c-ad73-b0815242e7c4'::uuid,delta,'size'
FROM _curv_cheese_tier
UNION ALL
SELECT '8f072a83-552e-4e97-946d-9c306169415a'::uuid,NULL,
       '049cc2e6-14d3-4892-abaf-a82b9cd6ed84'::uuid,0,'product';
DO $context_guard$
BEGIN
 IF (SELECT count(*) FROM _curv_expected_context)<>17
 OR EXISTS (
   SELECT 1 FROM public.product_option_choice_price_overrides o
   JOIN _curv_expected_context e ON e.product_id=o.product_id
      AND e.option_choice_id=o.option_choice_id
      AND e.product_size_id IS NOT DISTINCT FROM o.product_size_id
   WHERE o.is_active AND o.price_delta<>e.delta
 )
 OR EXISTS (
   SELECT 1 FROM public.product_option_choice_override_requirements r
   JOIN _curv_expected_context e ON e.product_id=r.product_id
      AND e.option_choice_id=r.option_choice_id
      AND e.product_size_id IS NOT DISTINCT FROM r.product_size_id
   WHERE r.is_active AND r.specificity<>e.specificity
 )
 OR EXISTS (
   SELECT 1 FROM public.product_option_choice_price_overrides o
   WHERE o.is_active AND o.product_id IN
     (SELECT DISTINCT product_id FROM _curv_expected_context)
     AND NOT EXISTS (SELECT 1 FROM _curv_expected_context e
       WHERE e.product_id=o.product_id
         AND e.option_choice_id=o.option_choice_id
         AND e.product_size_id IS NOT DISTINCT FROM o.product_size_id)
 )
 OR EXISTS (
   SELECT 1 FROM public.product_option_choice_override_requirements r
   WHERE r.is_active AND r.product_id IN
     (SELECT DISTINCT product_id FROM _curv_expected_context)
     AND NOT EXISTS (SELECT 1 FROM _curv_expected_context e
       WHERE e.product_id=r.product_id
         AND e.option_choice_id=r.option_choice_id
         AND e.product_size_id IS NOT DISTINCT FROM r.product_size_id)
 ) THEN
  RAISE EXCEPTION 'Contextual pricing differs from approved matrix'
    USING DETAIL='CURV_OPTION_CONTEXT_COLLISION';
 END IF;
END
$context_guard$;
INSERT INTO public.product_option_choice_price_overrides
 (product_id,product_size_id,option_choice_id,price_delta,is_active)
SELECT e.product_id,e.product_size_id,e.option_choice_id,e.delta,true
FROM _curv_expected_context e
WHERE NOT EXISTS (
 SELECT 1 FROM public.product_option_choice_price_overrides o
 WHERE o.is_active AND o.product_id=e.product_id
   AND o.option_choice_id=e.option_choice_id
   AND o.product_size_id IS NOT DISTINCT FROM e.product_size_id
);
INSERT INTO public.product_option_choice_override_requirements
 (product_id,product_size_id,option_choice_id,specificity,is_active)
SELECT e.product_id,e.product_size_id,e.option_choice_id,e.specificity,true
FROM _curv_expected_context e
WHERE NOT EXISTS (
 SELECT 1 FROM public.product_option_choice_override_requirements r
 WHERE r.is_active AND r.product_id=e.product_id
   AND r.option_choice_id=e.option_choice_id
   AND r.product_size_id IS NOT DISTINCT FROM e.product_size_id
);
-- Preserve both old cheese UUIDs for historical references; retire only
-- after the semantic choice and all size-scoped price/requirement rows exist.
UPDATE public.option_choices SET is_active=false
WHERE id IN ('bab37892-3af1-4498-ad67-71271c9cad70'::uuid,
             '3db8c36d-2e8e-4343-b8de-683b65070961'::uuid)
 AND is_active;

-- PHASE 8: hard postconditions run inside the same transaction. Any
-- failure rolls back every persistent change above.
DO $postflight$
BEGIN
 IF EXISTS (
  SELECT 1 FROM _curv_expected_assignment e
  JOIN public.option_groups g ON g.group_key=e.group_key
  LEFT JOIN public.product_option_groups a
    ON a.product_id=e.product_id AND a.option_group_id=g.id
  WHERE a.id IS NULL OR NOT a.is_active
    OR (a.is_required,a.min_selections,a.max_selections,a.sort_order)
       IS DISTINCT FROM (e.is_required,e.min_selections,e.max_selections,e.sort_order)
 ) OR EXISTS (
  SELECT 1 FROM public.product_option_groups a
  JOIN _curv_expected_product p ON p.id=a.product_id
    AND p.expected_state='SELLABLE_CANDIDATE'
  JOIN public.option_groups g ON g.id=a.option_group_id
  LEFT JOIN _curv_expected_assignment e ON e.product_id=a.product_id AND e.group_key=g.group_key
  WHERE a.is_active AND e.product_id IS NULL
 ) OR (SELECT count(*) FROM public.product_option_groups a
       JOIN _curv_expected_product p ON p.id=a.product_id
       WHERE p.expected_state='SELLABLE_CANDIDATE' AND a.is_active)<>117 THEN
  RAISE EXCEPTION 'Assignment matrix incomplete' USING DETAIL='CURV_OPTION_FINAL_ASSIGNMENTS';
 END IF;
 IF EXISTS (
  SELECT 1 FROM _curv_expected_default e
  JOIN public.option_groups g ON g.group_key=e.group_key
  JOIN public.option_choices c ON c.option_group_id=g.id AND c.value=e.choice_value
  LEFT JOIN public.product_option_defaults d ON d.product_id=e.product_id
    AND d.option_group_id=g.id AND d.option_choice_id=c.id
  WHERE d.id IS NULL
 ) OR (SELECT count(*) FROM public.product_option_defaults d
       JOIN _curv_expected_product p ON p.id=d.product_id
       WHERE p.expected_state='SELLABLE_CANDIDATE')<>19 THEN
  RAISE EXCEPTION 'Approved defaults incomplete' USING DETAIL='CURV_OPTION_FINAL_DEFAULTS';
 END IF;
 IF EXISTS (
  SELECT 1 FROM _curv_expected_compatibility e
  LEFT JOIN public.product_size_option_choice_compatibility c
    ON c.product_id=e.product_id AND c.product_size_id=e.product_size_id
      AND c.option_choice_id=e.option_choice_id
  WHERE c.product_id IS NULL OR NOT c.is_active
 ) OR (SELECT count(*) FROM public.product_size_option_choice_compatibility c
       JOIN _curv_classic_size e ON e.product_id=c.product_id
       WHERE c.is_active)<>24 THEN
  RAISE EXCEPTION 'Classic temperature coverage incomplete' USING DETAIL='CURV_OPTION_FINAL_COMPATIBILITY';
 END IF;
 IF EXISTS (
  SELECT 1 FROM _curv_expected_context e
  WHERE NOT EXISTS (SELECT 1 FROM public.product_option_choice_price_overrides o
     WHERE o.product_id=e.product_id AND o.product_size_id IS NOT DISTINCT FROM e.product_size_id
       AND o.option_choice_id=e.option_choice_id AND o.price_delta=e.delta AND o.is_active)
    OR NOT EXISTS (SELECT 1 FROM public.product_option_choice_override_requirements r
     WHERE r.product_id=e.product_id AND r.product_size_id IS NOT DISTINCT FROM e.product_size_id
       AND r.option_choice_id=e.option_choice_id AND r.specificity=e.specificity AND r.is_active)
 ) THEN
  RAISE EXCEPTION 'Contextual price/requirement coverage incomplete'
    USING DETAIL='CURV_OPTION_FINAL_CONTEXT';
 END IF;
 IF EXISTS (SELECT 1 FROM public.option_groups g JOIN _curv_expected_group e ON e.id=g.id
            WHERE g.group_key<>e.new_key OR g.selection_type<>e.new_type)
 OR EXISTS (SELECT 1 FROM public.option_groups g
            WHERE g.group_key IN ('add_cheese','extra_shot','sinkers',
                                  'sauce_beverage','garnish','beverage_temperature'))
 OR EXISTS (SELECT 1 FROM public.product_option_groups a
   WHERE a.id IN ('da9742a2-5ab0-453e-89a8-583f0eff6a46'::uuid,
                  '14783335-981c-407a-8b52-4c032122538d'::uuid) AND a.is_active)
 OR EXISTS (SELECT 1 FROM public.product_option_defaults
   WHERE id='cfe33aa7-fd9d-4e0b-b0c4-016200e59ec2'::uuid)
 OR EXISTS (SELECT 1 FROM public.option_choices
   WHERE id IN ('bab37892-3af1-4498-ad67-71271c9cad70'::uuid,
                '3db8c36d-2e8e-4343-b8de-683b65070961'::uuid) AND is_active) THEN
  RAISE EXCEPTION 'Legacy mapping was not fully retired' USING DETAIL='CURV_OPTION_FINAL_LEGACY';
 END IF;
END
$postflight$;

-- READ-ONLY REVIEW OUTPUTS. Zero rows in an anomaly query means PASS.
SELECT g.id,g.name,g.group_key,g.selection_type,g.is_active
FROM public.option_groups g
WHERE g.id IN (SELECT id FROM _curv_expected_group)
   OR g.group_key IN ('extrapower','spicy')
ORDER BY g.group_key;
SELECT g.group_key,count(c.id) FILTER (WHERE c.is_active) AS active_choices,
 count(c.id) AS all_choices
FROM public.option_groups g LEFT JOIN public.option_choices c ON c.option_group_id=g.id
WHERE g.id IN (SELECT id FROM _curv_expected_group)
   OR g.group_key IN ('extrapower','spicy')
GROUP BY g.group_key ORDER BY g.group_key;
SELECT p.id AS product_id,p.name,g.group_key,a.is_required,
 a.min_selections,a.max_selections,a.sort_order,a.is_active
FROM public.products p
LEFT JOIN public.product_option_groups a ON a.product_id=p.id AND a.is_active
LEFT JOIN public.option_groups g ON g.id=a.option_group_id
WHERE p.id IN (SELECT id FROM _curv_expected_product WHERE expected_state='SELLABLE_CANDIDATE')
ORDER BY p.name,a.sort_order,g.group_key;
SELECT a.product_id,a.option_group_id,count(*) AS duplicate_count
FROM public.product_option_groups a
GROUP BY a.product_id,a.option_group_id HAVING count(*)>1;
SELECT d.product_id,g.group_key,c.value AS default_value,d.option_choice_id
FROM public.product_option_defaults d
JOIN public.option_groups g ON g.id=d.option_group_id
JOIN public.option_choices c ON c.id=d.option_choice_id
WHERE d.product_id IN (SELECT id FROM _curv_expected_product WHERE expected_state='SELLABLE_CANDIDATE')
ORDER BY d.product_id,g.group_key;
SELECT o.product_id,o.product_size_id,o.option_choice_id,o.price_delta,
 r.specificity,r.is_active AS requirement_active
FROM public.product_option_choice_price_overrides o
LEFT JOIN public.product_option_choice_override_requirements r
 ON r.product_id=o.product_id AND r.option_choice_id=o.option_choice_id
 AND r.product_size_id IS NOT DISTINCT FROM o.product_size_id AND r.is_active
WHERE o.is_active AND o.product_id IN (SELECT id FROM _curv_expected_product)
ORDER BY o.product_id,o.product_size_id NULLS FIRST,o.option_choice_id;
SELECT c.product_id,s.label AS size_label,c.product_size_id,
 oc.value AS temperature,c.is_active
FROM public.product_size_option_choice_compatibility c
JOIN public.product_sizes s ON s.id=c.product_size_id
JOIN public.option_choices oc ON oc.id=c.option_choice_id
WHERE c.product_id IN (SELECT product_id FROM _curv_classic_size)
ORDER BY c.product_id,s.label,oc.value;
SELECT e.product_id,e.group_key AS missing_group
FROM _curv_expected_assignment e
LEFT JOIN public.option_groups g ON g.group_key=e.group_key
LEFT JOIN public.product_option_groups a ON a.product_id=e.product_id
 AND a.option_group_id=g.id AND a.is_active
WHERE a.id IS NULL ORDER BY e.product_id,e.group_key;
SELECT a.product_id,g.group_key AS unexpected_group
FROM public.product_option_groups a
JOIN public.option_groups g ON g.id=a.option_group_id
JOIN _curv_expected_product p ON p.id=a.product_id AND p.expected_state='SELLABLE_CANDIDATE'
LEFT JOIN _curv_expected_assignment e ON e.product_id=a.product_id AND e.group_key=g.group_key
WHERE a.is_active AND e.product_id IS NULL ORDER BY a.product_id,g.group_key;
SELECT a.product_id,g.group_key
FROM public.product_option_groups a JOIN public.option_groups g ON g.id=a.option_group_id
WHERE a.is_active AND a.product_id IN
 (SELECT id FROM _curv_expected_product WHERE expected_state='SELLABLE_CANDIDATE')
 AND NOT EXISTS (SELECT 1 FROM public.option_choices c
                 WHERE c.option_group_id=g.id AND c.is_active);
SELECT e.product_id,e.product_size_id,e.option_choice_id AS missing_choice_id
FROM _curv_expected_compatibility e
LEFT JOIN public.product_size_option_choice_compatibility c
 ON c.product_id=e.product_id AND c.product_size_id=e.product_size_id
 AND c.option_choice_id=e.option_choice_id AND c.is_active
WHERE c.product_id IS NULL ORDER BY e.product_id,e.product_size_id;
SELECT g.id,g.group_key FROM public.option_groups g
WHERE g.group_key IN ('add_cheese','extra_shot','sinkers','sauce_beverage',
                      'garnish','beverage_temperature');
COMMIT;
