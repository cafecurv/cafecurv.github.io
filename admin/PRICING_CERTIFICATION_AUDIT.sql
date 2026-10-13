-- READ-ONLY DRAFT: production audit approval is required before execution.
-- Exact approved repair manifests plus the imported F size inventory.
-- D0B1 certifies full JSONB row images, including prices and inactive rows.
-- Coverage reasons mirror D0B1/D0B3 with additional owner-manifest checks.
-- Independently review all 43 snapshots in reviewed_manifest_template before APPLY.
-- No certification helper, quote RPC or order/submission function is invoked here.
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout = '2min';
WITH
_curv_expected_product(id,name,expected_state) AS (VALUES
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
 ('5f5de117-2b8f-42d5-8b66-78f20339f544'::uuid,'Chicken Bowl','SELLABLE_CANDIDATE')),
_curv_expected_excluded_state(product_id,category_id,is_published,is_available,is_sold_out,archived_at,category_active) AS (VALUES
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
 ('c0e22263-7658-42e9-97af-4128a99270a5'::uuid,'a66acae6-b403-4c55-8dbe-566e55cd39cc'::uuid,false,false,false,NULL,true)),
_curv_expected_assignment(product_id,group_key,is_required,min_selections,max_selections,sort_order) AS (VALUES
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
 ('2c218e48-9871-41a3-bb12-19ced7b38321'::uuid,'cheese',false,0,1,30)),
_curv_expected_default(product_id,group_key,choice_value) AS (VALUES
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
 ('2c218e48-9871-41a3-bb12-19ced7b38321'::uuid,'spicy','no')),
_curv_classic_size(product_id,regular_id,large_id,regular_price) AS (VALUES
('ec0956f8-8d28-414f-be46-2349e92bef76'::uuid,'532bedff-2344-4ff8-ac82-e3d958062a9f'::uuid,'ee6f7767-1f35-4cbc-9e14-0e314988b15e'::uuid,130),
 ('cbeecaec-e9a5-4faa-b8f3-75b0cae549dd'::uuid,'7da598a2-f675-4764-ba83-f923af768561'::uuid,'cd302ffe-1919-4ac8-8088-4e730fb12113'::uuid,150),
 ('7a258d7e-5b74-44c8-93af-38b1fbd92765'::uuid,'95c5e2d6-75de-4b68-8fbb-e9b81ac58ebc'::uuid,'debd8f6b-3a87-4044-825c-91ab7342e1ec'::uuid,140),
 ('aa156151-540b-4beb-b924-d97bf210af95'::uuid,'1ca62e3c-86bc-4655-8ba6-2d972369a93f'::uuid,'02a2d179-2921-4c13-ac21-67a4c7b2d5ad'::uuid,160),
 ('54c6725f-4445-435c-bc1d-b779e5963796'::uuid,'3b21ccce-2fa8-4c83-b4c9-392b7c9db398'::uuid,'bfc35a0a-d71d-4e0a-9da7-7a99fc95158e'::uuid,140),
 ('e684a6bd-aadc-4117-a018-ae0591c43d41'::uuid,'fe0c4074-ba4e-4c68-8e55-adf71b2577cc'::uuid,'f723ca06-a515-4712-ae81-aa889783a498'::uuid,120),
 ('9c0d9e22-8843-4595-b789-7550c29890a4'::uuid,'909ac7fa-e743-4848-87fa-7ec68304b9a1'::uuid,'86f8242b-128b-4474-beb3-7e7f5f56a9d6'::uuid,160),
 ('45b1f92c-0daa-4ed2-af55-c5da97315c0a'::uuid,'4a36f492-2cb1-49a6-93a2-d422a7ca5674'::uuid,'b33ef270-1e14-43a5-99ff-837ccab47f78'::uuid,160)),
_curv_cheese_tier(product_id,size_id,size_label,delta) AS (VALUES
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
 ('2c218e48-9871-41a3-bb12-19ced7b38321'::uuid,'fe484ccc-5a71-48e1-bb6a-fa4535002836'::uuid,'12pcs',90)),
_curv_expected_group(id,name,old_key,new_key,old_type,new_type) AS (VALUES
('232d1301-d072-48ed-a363-6d5af6a6d906'::uuid,'Add Cheese','add_cheese','cheese','single','single'),
 ('5475e951-d4b1-46bf-a556-f63aecdf0fe2'::uuid,'Bites Sauce','bites_sauce','bites_sauce','single','single'),
 ('6f1074e8-f51a-41cd-a7f0-ed777418c916'::uuid,'Extra Espresso Shot','extra_shot','extrashot','multi','single'),
 ('516fb052-949a-43f5-8734-5b3f60bc76be'::uuid,'Inclusions','sinkers','inclusions','multi','multi'),
 ('f16decf7-b5a4-4b98-8182-c9c2c9eca1f0'::uuid,'Sauce','sauce_beverage','sauce','multi','multi'),
 ('1a3e299a-430c-4cf2-97c2-4d677e7019cd'::uuid,'Sweetener','sweetener','sweetener','multi','single'),
 ('da657452-3dfe-4ba1-b695-26648180d999'::uuid,'Syrup','syrup','syrup','multi','multi'),
 ('ff3aa2ce-e4ab-4870-98e1-93ff8078b534'::uuid,'Takoyaki Add-ons','garnish','addons','multi','multi'),
 ('c6727e99-bae9-4963-a7cb-b238409667d9'::uuid,'Temperature','beverage_temperature','temperature','single','single'),
 ('8a798579-ae21-47a2-8b84-6dc545b788bd'::uuid,'Sub Milk','milk','milk','single','single')),
_curv_existing_choice(id,group_id,old_label,old_value,old_delta,old_active) AS (VALUES
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
 ('cd6cfd0e-9826-4c16-bf1a-4d5305186fed'::uuid,'8a798579-ae21-47a2-8b84-6dc545b788bd'::uuid,'Soy Milk','soy_milk',30,true)),
expected_original_sizes(id,product_id,label,price,sort_order) AS (VALUES
('d556028c-a0ec-42ab-bccd-f9a49b7a5593'::uuid,'93e9a33b-1a37-4edf-9d26-5ddd2d87f87d'::uuid,'18oz',230::numeric,0::integer),
('3c71785d-f833-4834-8f24-70a789abb524'::uuid,'e635744c-ed77-4924-a90d-c78440a81603'::uuid,'Each',230::numeric,0::integer),
('c03cdc06-d031-430d-ae34-6a5eda87470f'::uuid,'d053466a-2a52-420c-bc4c-62b5f614a27f'::uuid,'Regular',190::numeric,0::integer),
('0bcbf694-190c-4c47-9f3c-fa53000080a6'::uuid,'82417b58-d0c4-4d0d-a0cd-27da42b42627'::uuid,'Regular',210::numeric,0::integer),
('ae887c0b-ab06-4dc5-b9e7-3d8f11122c8a'::uuid,'6caefdb6-7daf-4e6d-a034-95fda0b7ecd7'::uuid,'Regular',215::numeric,0::integer),
('eab42649-051e-4504-a615-8dd2d5952e22'::uuid,'e058ec46-f133-4982-afe6-cc6cf5e6d521'::uuid,'Regular',160::numeric,0::integer),
('07a1c3aa-2d13-4001-bdb2-5980961c746c'::uuid,'e058ec46-f133-4982-afe6-cc6cf5e6d521'::uuid,'Large',170::numeric,1::integer),
('ceb2866d-5cb3-4de9-b028-55113ef10d29'::uuid,'8f072a83-552e-4e97-946d-9c306169415a'::uuid,'Regular',175::numeric,0::integer),
('2cce7276-2989-4584-9ad6-d9a20cdb6861'::uuid,'8f072a83-552e-4e97-946d-9c306169415a'::uuid,'Large',190::numeric,1::integer),
('532bedff-2344-4ff8-ac82-e3d958062a9f'::uuid,'ec0956f8-8d28-414f-be46-2349e92bef76'::uuid,'Regular',130::numeric,0::integer),
('ee6f7767-1f35-4cbc-9e14-0e314988b15e'::uuid,'ec0956f8-8d28-414f-be46-2349e92bef76'::uuid,'Large',145::numeric,1::integer),
('6839607d-ad9f-42c3-8c9f-bc294c6b7704'::uuid,'7b59829b-b13b-4157-a0e8-ecb85bdbb8e4'::uuid,'Regular',150::numeric,0::integer),
('63a31ec4-a828-4ae3-9ded-f5b14308c100'::uuid,'7b59829b-b13b-4157-a0e8-ecb85bdbb8e4'::uuid,'Large',160::numeric,1::integer),
('0a801b3b-b9f3-4801-a42c-3f3e9fc0fe8f'::uuid,'31886227-0130-45f7-8fb7-3d84682eed92'::uuid,'Regular',160::numeric,0::integer),
('224501f6-fca2-4270-8b55-82c2a149c8ce'::uuid,'31886227-0130-45f7-8fb7-3d84682eed92'::uuid,'Large',170::numeric,1::integer),
('3a397e0c-464d-44bb-ba6c-6342a7f73333'::uuid,'57cd4f38-2e5f-41ba-a117-83f5b2c66819'::uuid,'Regular',165::numeric,0::integer),
('2591a69e-3b22-4a9d-8076-b110caa6eb8d'::uuid,'57cd4f38-2e5f-41ba-a117-83f5b2c66819'::uuid,'Large',180::numeric,1::integer),
('7da598a2-f675-4764-ba83-f923af768561'::uuid,'cbeecaec-e9a5-4faa-b8f3-75b0cae549dd'::uuid,'Regular',150::numeric,0::integer),
('cd302ffe-1919-4ac8-8088-4e730fb12113'::uuid,'cbeecaec-e9a5-4faa-b8f3-75b0cae549dd'::uuid,'Large',160::numeric,1::integer),
('95c5e2d6-75de-4b68-8fbb-e9b81ac58ebc'::uuid,'7a258d7e-5b74-44c8-93af-38b1fbd92765'::uuid,'Regular',140::numeric,0::integer),
('debd8f6b-3a87-4044-825c-91ab7342e1ec'::uuid,'7a258d7e-5b74-44c8-93af-38b1fbd92765'::uuid,'Large',150::numeric,1::integer),
('1ca62e3c-86bc-4655-8ba6-2d972369a93f'::uuid,'aa156151-540b-4beb-b924-d97bf210af95'::uuid,'Regular',160::numeric,0::integer),
('02a2d179-2921-4c13-ac21-67a4c7b2d5ad'::uuid,'aa156151-540b-4beb-b924-d97bf210af95'::uuid,'Large',175::numeric,1::integer),
('3b21ccce-2fa8-4c83-b4c9-392b7c9db398'::uuid,'54c6725f-4445-435c-bc1d-b779e5963796'::uuid,'Regular',140::numeric,0::integer),
('bfc35a0a-d71d-4e0a-9da7-7a99fc95158e'::uuid,'54c6725f-4445-435c-bc1d-b779e5963796'::uuid,'Large',150::numeric,1::integer),
('fe0c4074-ba4e-4c68-8e55-adf71b2577cc'::uuid,'e684a6bd-aadc-4117-a018-ae0591c43d41'::uuid,'Regular',120::numeric,0::integer),
('f723ca06-a515-4712-ae81-aa889783a498'::uuid,'e684a6bd-aadc-4117-a018-ae0591c43d41'::uuid,'Large',125::numeric,1::integer),
('909ac7fa-e743-4848-87fa-7ec68304b9a1'::uuid,'9c0d9e22-8843-4595-b789-7550c29890a4'::uuid,'Regular',160::numeric,0::integer),
('86f8242b-128b-4474-beb3-7e7f5f56a9d6'::uuid,'9c0d9e22-8843-4595-b789-7550c29890a4'::uuid,'Large',170::numeric,1::integer),
('4a36f492-2cb1-49a6-93a2-d422a7ca5674'::uuid,'45b1f92c-0daa-4ed2-af55-c5da97315c0a'::uuid,'Regular',160::numeric,0::integer),
('b33ef270-1e14-43a5-99ff-837ccab47f78'::uuid,'45b1f92c-0daa-4ed2-af55-c5da97315c0a'::uuid,'Large',170::numeric,1::integer),
('1e83b774-cd11-48b1-861a-8a693961cca2'::uuid,'3372a8c3-3208-4458-bb71-38c40c454436'::uuid,'Regular',160::numeric,0::integer),
('23b7d6b1-3a12-4e5e-8350-ea6580930afb'::uuid,'3372a8c3-3208-4458-bb71-38c40c454436'::uuid,'Large',170::numeric,1::integer),
('b62f9a1d-22d6-4361-9d1e-da8145e2dc84'::uuid,'c541decb-607c-44b1-8bed-4c19594c4422'::uuid,'Regular',165::numeric,0::integer),
('d0eb7d57-affd-4504-a438-18d68129a2ed'::uuid,'c541decb-607c-44b1-8bed-4c19594c4422'::uuid,'Large',175::numeric,1::integer),
('af75c6d2-1ab5-4813-a1e3-17f29a7363d3'::uuid,'8e1b82c6-8aea-4eb9-b591-184072c4f49e'::uuid,'Regular',150::numeric,0::integer),
('188b98e9-6ffd-4ab9-bbfa-536ee12dcea6'::uuid,'4ea4643e-5a61-402f-b9c4-8a29ae130c18'::uuid,'Regular',150::numeric,0::integer),
('3ce52e6f-bdb2-4927-aa78-913b1f43cd06'::uuid,'4ea4643e-5a61-402f-b9c4-8a29ae130c18'::uuid,'Large',160::numeric,1::integer),
('4d2c664e-55fd-42ed-a909-90de0bcd0474'::uuid,'f9e87759-6aa9-4bce-8b8b-3081ec913c01'::uuid,'Regular',150::numeric,0::integer),
('9c491be7-f397-41ce-a39f-3f0487f94552'::uuid,'f9e87759-6aa9-4bce-8b8b-3081ec913c01'::uuid,'Large',160::numeric,1::integer),
('54b50f90-eee1-404f-b2a2-e977c42177d6'::uuid,'c26d3d79-38bf-4687-b3ca-eedfc1ed0e86'::uuid,'Regular',170::numeric,0::integer),
('909d8758-5f95-4392-b00f-70d6a068677d'::uuid,'c26d3d79-38bf-4687-b3ca-eedfc1ed0e86'::uuid,'Large',185::numeric,1::integer),
('01361b2b-85ad-4198-bcb9-e1756c5c944e'::uuid,'56ca858c-58da-4ee3-9954-d189390cefb8'::uuid,'Regular',170::numeric,0::integer),
('146a28d2-4952-4d9b-bbd9-2dd49a400dd7'::uuid,'56ca858c-58da-4ee3-9954-d189390cefb8'::uuid,'Large',185::numeric,1::integer),
('c8fc1be6-ae4e-474d-80b6-ad25733a9732'::uuid,'52f8ffc5-8f9b-41d2-9ecd-574ece1cf5e6'::uuid,'Regular',170::numeric,0::integer),
('5cebc026-3ba3-4046-85a7-d3680ceaf64e'::uuid,'52f8ffc5-8f9b-41d2-9ecd-574ece1cf5e6'::uuid,'Large',185::numeric,1::integer),
('b434b87a-549a-454b-8cd6-2fe63f1cfd87'::uuid,'8a078f3e-872d-47e0-a1df-c14f33af64c2'::uuid,'Regular',160::numeric,0::integer),
('6a99db42-63e1-4487-9507-890fb6e4edbc'::uuid,'8a078f3e-872d-47e0-a1df-c14f33af64c2'::uuid,'Large',175::numeric,1::integer),
('5abfda87-d4af-4cec-bfe3-5988905077e7'::uuid,'dd5face3-df84-47ae-8ce1-9e2b565a91dd'::uuid,'Regular',175::numeric,0::integer),
('c78a6543-63b9-48c1-a66c-b4092feddf06'::uuid,'dd5face3-df84-47ae-8ce1-9e2b565a91dd'::uuid,'Large',190::numeric,1::integer),
('cf269f21-df3b-4e02-84e3-83a6779682e2'::uuid,'f716d196-47f0-46f4-af7e-bda068b95b2d'::uuid,'Regular',150::numeric,0::integer),
('6e801849-3926-46ef-ba2a-5add950652da'::uuid,'f716d196-47f0-46f4-af7e-bda068b95b2d'::uuid,'Large',165::numeric,1::integer),
('f520ad40-773e-4dea-a1b6-18a7e28bb730'::uuid,'483eed35-dd1d-4a87-90a6-2161b3d1ef86'::uuid,'Regular',160::numeric,0::integer),
('6028319c-d276-4d9a-9e6e-f74720e8ab4b'::uuid,'483eed35-dd1d-4a87-90a6-2161b3d1ef86'::uuid,'Large',170::numeric,1::integer),
('dd268425-3250-469b-a36f-747e02bcd63b'::uuid,'ab350883-08eb-4b3a-b45a-03bb11f509a3'::uuid,'Regular',150::numeric,0::integer),
('7725e0cb-ce7b-4a9b-affa-8b46717d698a'::uuid,'ab350883-08eb-4b3a-b45a-03bb11f509a3'::uuid,'Large',160::numeric,1::integer),
('4769d47e-2ed4-4143-9674-ecd705c36fae'::uuid,'9eba0285-c567-4d8d-960a-4f2bed4a6bd7'::uuid,'Regular',150::numeric,0::integer),
('946e66ce-9904-4595-a68c-6351cbccf725'::uuid,'9eba0285-c567-4d8d-960a-4f2bed4a6bd7'::uuid,'Large',160::numeric,1::integer),
('3c436f01-a9d6-4c70-a2a3-2c35f6d78635'::uuid,'24007d6c-e175-4dcf-9a6f-aab076e07b98'::uuid,'4pcs',90::numeric,0::integer),
('b7b88390-fccf-4124-9346-4cc1afd80e5c'::uuid,'24007d6c-e175-4dcf-9a6f-aab076e07b98'::uuid,'8pcs',150::numeric,1::integer),
('bbce5f8f-db50-40e4-8bce-ec8d4a1c685d'::uuid,'24007d6c-e175-4dcf-9a6f-aab076e07b98'::uuid,'12pcs',220::numeric,2::integer),
('5092934c-919e-4c53-8890-ca29316aa551'::uuid,'ff9e0d6f-2a1b-4b6b-a401-e02370224f39'::uuid,'4pcs',105::numeric,0::integer),
('22fbd2e7-7c33-4e4d-b3a2-ccf0860cb322'::uuid,'ff9e0d6f-2a1b-4b6b-a401-e02370224f39'::uuid,'8pcs',200::numeric,1::integer),
('30df5f88-3760-4e46-bb52-a304e2fa2f42'::uuid,'ff9e0d6f-2a1b-4b6b-a401-e02370224f39'::uuid,'12pcs',300::numeric,2::integer),
('e2e1b618-fb4a-4d12-9d57-c34e351f036c'::uuid,'29187fbb-f9ab-42b7-ab29-82a0a1b3f0c5'::uuid,'Regular',160::numeric,0::integer),
('fa187849-fc74-4bc6-937c-d287e84e382d'::uuid,'a33f5d5a-fde1-4eb4-8604-1637b4afbf9a'::uuid,'Regular',160::numeric,0::integer),
('a5f59fd4-ce5c-4049-87a0-9b6d41faf246'::uuid,'c027eedc-1807-4574-8f14-79ce07bb544e'::uuid,'4pcs',90::numeric,0::integer),
('d0c8adf8-2398-441a-9880-eeead91ea6fe'::uuid,'c027eedc-1807-4574-8f14-79ce07bb544e'::uuid,'8pcs',150::numeric,1::integer),
('836b56fc-ec63-49d6-9e3f-7be32c233888'::uuid,'c027eedc-1807-4574-8f14-79ce07bb544e'::uuid,'12pcs',220::numeric,2::integer),
('b958356c-1e4e-44ea-8c1f-f61683bd2a80'::uuid,'c1f44003-500d-46aa-9fe6-9bbf35c57415'::uuid,'4pcs',95::numeric,0::integer),
('0cfceeae-1a12-47a4-b544-1c53395c82d3'::uuid,'c1f44003-500d-46aa-9fe6-9bbf35c57415'::uuid,'8pcs',165::numeric,1::integer),
('43394c3a-2256-40bc-bcdd-89b5aeb69556'::uuid,'c1f44003-500d-46aa-9fe6-9bbf35c57415'::uuid,'12pcs',230::numeric,2::integer),
('d37cf9b3-8742-4a0e-aa17-fc2df384cc5d'::uuid,'610f399d-6fa3-46f1-b0b4-9fac6aa0ed5f'::uuid,'8pcs',140::numeric,0::integer),
('81c30dcf-9bae-4055-a1c4-2d46e3ca0ad3'::uuid,'610f399d-6fa3-46f1-b0b4-9fac6aa0ed5f'::uuid,'12pcs',200::numeric,1::integer),
('6fdd4f4b-481d-4fbc-9459-4208dff71006'::uuid,'2c218e48-9871-41a3-bb12-19ced7b38321'::uuid,'8pcs',165::numeric,0::integer),
('fe484ccc-5a71-48e1-bb6a-fa4535002836'::uuid,'2c218e48-9871-41a3-bb12-19ced7b38321'::uuid,'12pcs',230::numeric,1::integer),
('27425966-32e5-4ad1-ac14-1f23ab5ecb07'::uuid,'5498a571-8404-4a4f-a380-9cc0eaefc67c'::uuid,'Each',220::numeric,0::integer),
('843284d9-b64c-4586-b183-b8f215b49fb3'::uuid,'f4253ada-f15f-4fee-abea-c7678cd1fc06'::uuid,'Regular',210::numeric,0::integer),
('573b1fdd-8298-42d8-9acf-605c6529cc98'::uuid,'5f5de117-2b8f-42d5-8b66-78f20339f544'::uuid,'Regular',180::numeric,0::integer)),
expected_new_choices(group_key,label,value,delta,sort_order) AS (VALUES
('extrapower','+1g','+1g Extra Powder',45::numeric,0),
 ('spicy','Not Spicy','no',0::numeric,0),
 ('spicy','Spicy','yes',0::numeric,1),
 ('sweetener','No Sweetener','no-sweetener',0::numeric,0),
 ('sweetener','Simple Syrup','Simple Syrup',0::numeric,1),
 ('sweetener','Agave','Agave Syrup',30::numeric,2),
 ('sweetener','Honey','Honey',30::numeric,3)),
catalog AS MATERIALIZED (
 SELECT coalesce(p.id,e.id) AS product_id,p.id IS NOT NULL AS product_exists,
        p.name AS product_name,e.name AS reviewed_name,e.expected_state,
        p.is_published,p.is_available,p.is_sold_out,p.archived_at,
        to_jsonb(p) AS product_state,to_jsonb(cat) AS category_state,
        CASE WHEN p.id IS NULL THEN 'MISSING'
             WHEN cat.id IS NULL THEN 'CATEGORY_MISSING'
             WHEN NOT p.is_published THEN 'UNPUBLISHED'
             WHEN NOT p.is_available THEN 'UNAVAILABLE'
             WHEN NOT coalesce((to_jsonb(cat)->>'is_active')::boolean,false)
               THEN 'CATEGORY_INACTIVE_OR_UNKNOWN'
             WHEN p.archived_at IS NOT NULL THEN 'ARCHIVED'
             WHEN p.is_sold_out THEN 'SOLD_OUT'
             WHEN NOT EXISTS(SELECT 1 FROM public.product_sizes s WHERE s.product_id=p.id)
               THEN 'NO_SIZE'
             ELSE 'SELLABLE_CANDIDATE' END AS catalog_state
 FROM public.products p FULL JOIN _curv_expected_product e ON e.id=p.id
 LEFT JOIN public.categories cat ON cat.id=p.category_id
),
scope_issues AS (
 SELECT product_id,'CATALOG_ID_NAME_OR_STATE_DRIFT'::text AS reason FROM catalog
 WHERE NOT product_exists OR expected_state IS NULL
   OR product_name IS DISTINCT FROM reviewed_name
   OR catalog_state IS DISTINCT FROM expected_state
 UNION ALL
 SELECT c.product_id,'EXCLUDED_STATE_DRIFT' FROM catalog c
 JOIN _curv_expected_excluded_state e ON e.product_id=c.product_id
 WHERE (c.product_state->>'category_id',c.is_published,c.is_available,
        coalesce(c.is_sold_out,false),c.archived_at,
        coalesce((c.category_state->>'is_active')::boolean,false))
   IS DISTINCT FROM
       (e.category_id::text,e.is_published,e.is_available,e.is_sold_out,
        e.archived_at,e.category_active)
),
structures AS MATERIALIZED (
 SELECT c.*,CASE WHEN product_exists
   THEN configuration_private.catalog_structure(product_id) END AS current_structure
 FROM catalog c
),
active_choices AS MATERIALIZED (
 SELECT a.product_id,c.*,g.group_key FROM public.product_option_groups a
 JOIN public.option_groups g ON g.id=a.option_group_id AND g.is_active
 JOIN public.option_choices c ON c.option_group_id=g.id AND c.is_active
 WHERE a.is_active
),
group_stats AS MATERIALIZED (
 SELECT a.*,g.selection_type,g.group_key,g.is_active AS group_active,
   greatest(a.min_selections,CASE WHEN a.is_required THEN 1 ELSE 0 END) AS minimum,
   coalesce(a.max_selections,CASE WHEN g.selection_type='single' THEN 1
     ELSE (SELECT count(*)::integer FROM public.option_choices c
           WHERE c.option_group_id=g.id AND c.is_active) END) AS maximum,
   (SELECT count(*) FROM public.option_choices c WHERE c.option_group_id=g.id AND c.is_active) AS choices_count,
   (SELECT count(*) FROM public.product_option_defaults d
     WHERE d.product_id=a.product_id AND d.option_group_id=g.id) AS defaults_count,
   (SELECT count(*) FROM public.product_option_defaults d
     JOIN public.option_choices c ON c.id=d.option_choice_id
       AND c.option_group_id=d.option_group_id AND c.is_active
     WHERE d.product_id=a.product_id AND d.option_group_id=g.id) AS valid_defaults
 FROM public.product_option_groups a JOIN public.option_groups g ON g.id=a.option_group_id
 WHERE a.is_active
),
expected_compatibility AS (
 SELECT product_id,regular_id AS size_id,'c018fa7b-5cb5-490a-9d8a-7a5611a1bd67'::uuid AS choice_id FROM _curv_classic_size
 UNION ALL SELECT product_id,large_id,'c018fa7b-5cb5-490a-9d8a-7a5611a1bd67'::uuid FROM _curv_classic_size
 UNION ALL SELECT e.product_id,s.id,'c9b382d8-5eee-4d50-a1dc-7ceed43b5fdc'::uuid
 FROM _curv_classic_size e JOIN public.product_sizes s
 ON s.product_id=e.product_id AND s.label='12oz Hot' AND s.price=e.regular_price
),
expected_context AS (
 SELECT product_id,size_id,'7c4e3426-a4ea-427c-ad73-b0815242e7c4'::uuid AS choice_id,delta,'size'::text AS specificity
 FROM _curv_cheese_tier
 UNION ALL SELECT '8f072a83-552e-4e97-946d-9c306169415a'::uuid,NULL::uuid,
   '049cc2e6-14d3-4892-abaf-a82b9cd6ed84'::uuid,0::numeric,'product'
),
coverage_issues AS (
 SELECT product_id,'D0B1_SIZE_COVERAGE'::text AS reason FROM catalog c
 WHERE NOT product_exists OR NOT EXISTS(SELECT 1 FROM public.product_sizes s WHERE s.product_id=c.product_id)
 UNION ALL SELECT product_id,'D0B1_SIZE_COVERAGE' FROM public.product_sizes
 WHERE NOT (price>=0 AND price<=999999.99 AND price=round(price,2)) IS TRUE
 UNION ALL SELECT product_id,'D0B1_GROUP_COVERAGE' FROM group_stats
 WHERE NOT group_active OR selection_type NOT IN ('single','multi')
   OR min_selections<0 OR maximum<minimum OR choices_count<minimum
   OR (selection_type='single' AND (maximum>1 OR minimum>1))
 UNION ALL SELECT a.product_id,'D0B1_GROUP_COVERAGE' FROM public.product_option_groups a
 JOIN public.option_groups g ON g.id=a.option_group_id
 JOIN public.option_choices c ON c.option_group_id=g.id AND c.is_active
 WHERE a.is_active AND NOT (c.price_delta>=0 AND c.price_delta<=999999.99 AND c.price_delta=round(c.price_delta,2)) IS TRUE
 UNION ALL SELECT product_id,'D0B1_DEFAULT_COVERAGE' FROM group_stats
 WHERE defaults_count<>valid_defaults OR valid_defaults<minimum OR valid_defaults>maximum
 UNION ALL SELECT d.product_id,'D0B1_DEFAULT_COVERAGE' FROM public.product_option_defaults d
 WHERE NOT EXISTS(SELECT 1 FROM public.product_option_groups a
   WHERE a.product_id=d.product_id AND a.option_group_id=d.option_group_id AND a.is_active)
 UNION ALL SELECT product_id,'D0B1_TEMPERATURE_COVERAGE' FROM group_stats
 WHERE group_key='temperature' AND (selection_type<>'single' OR minimum<>1 OR maximum<>1)
 UNION ALL SELECT g.product_id,'D0B1_TEMPERATURE_COVERAGE' FROM group_stats g
 JOIN public.product_sizes s ON s.product_id=g.product_id
 WHERE g.group_key='temperature' AND NOT EXISTS(
   SELECT 1 FROM public.product_size_option_choice_compatibility t
   JOIN active_choices c ON c.product_id=t.product_id AND c.id=t.option_choice_id
   WHERE t.product_id=s.product_id AND t.product_size_id=s.id
     AND t.is_active AND c.option_group_id=g.option_group_id)
 UNION ALL SELECT t.product_id,'D0B1_TEMPERATURE_COVERAGE' FROM public.product_size_option_choice_compatibility t
 LEFT JOIN active_choices c ON c.product_id=t.product_id AND c.id=t.option_choice_id
 WHERE t.is_active AND (c.id IS NULL OR c.group_key<>'temperature')
 UNION ALL SELECT o.product_id,'D0B3_OVERRIDE_INVALID' FROM public.product_option_choice_price_overrides o
 LEFT JOIN active_choices c ON c.product_id=o.product_id AND c.id=o.option_choice_id
 WHERE o.is_active AND (c.id IS NULL OR NOT(o.price_delta>=0 AND o.price_delta<=999999.99 AND o.price_delta=round(o.price_delta,2)) IS TRUE)
 UNION ALL SELECT product_id,'D0B3_DUPLICATE_OVERRIDE' FROM public.product_option_choice_price_overrides
 WHERE is_active GROUP BY product_id,product_size_id,option_choice_id HAVING count(*)>1
 UNION ALL SELECT r.product_id,'D0B1_OVERRIDE_COVERAGE' FROM public.product_option_choice_override_requirements r
 LEFT JOIN active_choices c ON c.product_id=r.product_id AND c.id=r.option_choice_id
 WHERE r.is_active AND (c.id IS NULL OR NOT EXISTS(
   SELECT 1 FROM public.product_option_choice_price_overrides o
   WHERE o.product_id=r.product_id AND o.option_choice_id=r.option_choice_id
     AND o.is_active AND o.product_size_id IS NOT DISTINCT FROM r.product_size_id))
),
owner_issues AS (
 SELECT e.product_id,'APPROVED_ASSIGNMENT_MISSING_OR_RULE_DRIFT:'||e.group_key AS reason
 FROM _curv_expected_assignment e LEFT JOIN public.option_groups g ON g.group_key=e.group_key
 LEFT JOIN public.product_option_groups a ON a.product_id=e.product_id AND a.option_group_id=g.id
 WHERE a.id IS NULL OR NOT a.is_active OR NOT g.is_active
   OR (a.is_required,a.min_selections,a.max_selections,a.sort_order)
      IS DISTINCT FROM (e.is_required,e.min_selections,e.max_selections,e.sort_order)
 UNION ALL SELECT a.product_id,'UNAPPROVED_ACTIVE_MAPPING:'||g.group_key
 FROM public.product_option_groups a JOIN catalog p ON p.product_id=a.product_id
 JOIN public.option_groups g ON g.id=a.option_group_id
 WHERE p.expected_state='SELLABLE_CANDIDATE' AND a.is_active
   AND NOT EXISTS(SELECT 1 FROM _curv_expected_assignment e WHERE e.product_id=a.product_id AND e.group_key=g.group_key)
 UNION ALL SELECT e.product_id,'APPROVED_DEFAULT_MISSING:'||e.group_key FROM _curv_expected_default e
 WHERE NOT EXISTS(SELECT 1 FROM public.product_option_defaults d
   JOIN public.option_groups g ON g.id=d.option_group_id
   JOIN public.option_choices c ON c.id=d.option_choice_id AND c.option_group_id=g.id AND c.is_active
   WHERE d.product_id=e.product_id AND g.group_key=e.group_key AND c.value=e.choice_value)
 UNION ALL SELECT d.product_id,'UNAPPROVED_DEFAULT' FROM public.product_option_defaults d
 JOIN catalog p ON p.product_id=d.product_id JOIN public.option_groups g ON g.id=d.option_group_id
 JOIN public.option_choices c ON c.id=d.option_choice_id
 WHERE p.expected_state='SELLABLE_CANDIDATE' AND NOT EXISTS(
   SELECT 1 FROM _curv_expected_default e WHERE e.product_id=d.product_id AND e.group_key=g.group_key AND e.choice_value=c.value)
 UNION ALL SELECT e.product_id,'ORIGINAL_SIZE_DRIFT:'||e.id::text FROM expected_original_sizes e
 LEFT JOIN public.product_sizes s ON s.id=e.id
 WHERE s.id IS NULL OR (s.product_id,s.label,s.price,s.sort_order)
   IS DISTINCT FROM(e.product_id,e.label,e.price,e.sort_order)
 UNION ALL SELECT s.product_id,'UNAPPROVED_SIZE:'||s.id::text FROM public.product_sizes s JOIN catalog p ON p.product_id=s.product_id
 WHERE p.expected_state='SELLABLE_CANDIDATE' AND NOT EXISTS(SELECT 1 FROM expected_original_sizes e WHERE e.id=s.id)
   AND NOT EXISTS(SELECT 1 FROM _curv_classic_size e WHERE e.product_id=s.product_id AND s.label='12oz Hot' AND s.price=e.regular_price AND s.sort_order=2)
 UNION ALL SELECT e.product_id,'HOT_12OZ_COUNT_OR_PRICE_DRIFT' FROM _curv_classic_size e
 WHERE (SELECT count(*) FROM public.product_sizes s WHERE s.product_id=e.product_id AND s.label='12oz Hot' AND s.price=e.regular_price AND s.sort_order=2)<>1
 UNION ALL SELECT e.product_id,'APPROVED_COMPATIBILITY_MISSING' FROM expected_compatibility e
 WHERE NOT EXISTS(SELECT 1 FROM public.product_size_option_choice_compatibility t
   WHERE t.product_id=e.product_id AND t.product_size_id=e.size_id AND t.option_choice_id=e.choice_id AND t.is_active)
 UNION ALL SELECT t.product_id,'UNAPPROVED_ACTIVE_COMPATIBILITY' FROM public.product_size_option_choice_compatibility t JOIN catalog p ON p.product_id=t.product_id
 WHERE p.expected_state='SELLABLE_CANDIDATE' AND t.is_active AND NOT EXISTS(
   SELECT 1 FROM expected_compatibility e WHERE e.product_id=t.product_id AND e.size_id=t.product_size_id AND e.choice_id=t.option_choice_id)
 UNION ALL SELECT e.product_id,'APPROVED_CONTEXT_MISSING_OR_DRIFT' FROM expected_context e WHERE
   NOT EXISTS(SELECT 1 FROM public.product_option_choice_price_overrides o
     WHERE o.product_id=e.product_id AND o.product_size_id IS NOT DISTINCT FROM e.size_id AND o.option_choice_id=e.choice_id AND o.price_delta=e.delta AND o.is_active)
   OR NOT EXISTS(SELECT 1 FROM public.product_option_choice_override_requirements r
     WHERE r.product_id=e.product_id AND r.product_size_id IS NOT DISTINCT FROM e.size_id AND r.option_choice_id=e.choice_id AND r.specificity=e.specificity AND r.is_active)
 UNION ALL SELECT o.product_id,'UNAPPROVED_ACTIVE_OVERRIDE' FROM public.product_option_choice_price_overrides o JOIN catalog p ON p.product_id=o.product_id
 WHERE p.expected_state='SELLABLE_CANDIDATE' AND o.is_active AND NOT EXISTS(
   SELECT 1 FROM expected_context e WHERE e.product_id=o.product_id AND e.size_id IS NOT DISTINCT FROM o.product_size_id AND e.choice_id=o.option_choice_id)
 UNION ALL SELECT r.product_id,'UNAPPROVED_ACTIVE_REQUIREMENT' FROM public.product_option_choice_override_requirements r JOIN catalog p ON p.product_id=r.product_id
 WHERE p.expected_state='SELLABLE_CANDIDATE' AND r.is_active AND NOT EXISTS(
   SELECT 1 FROM expected_context e WHERE e.product_id=r.product_id AND e.size_id IS NOT DISTINCT FROM r.product_size_id AND e.choice_id=r.option_choice_id)
 UNION ALL SELECT a.product_id,'APPROVED_GROUP_IDENTITY_DRIFT:'||g.group_key
 FROM public.product_option_groups a JOIN catalog p ON p.product_id=a.product_id JOIN public.option_groups g ON g.id=a.option_group_id
 LEFT JOIN _curv_expected_group e ON e.id=g.id
 WHERE a.is_active AND p.expected_state='SELLABLE_CANDIDATE' AND (
   (g.group_key NOT IN ('extrapower','spicy') AND (e.id IS NULL OR g.name IS DISTINCT FROM e.name OR g.group_key IS DISTINCT FROM e.new_key OR g.selection_type IS DISTINCT FROM e.new_type))
   OR (g.group_key='extrapower' AND (g.name<>'Extra Powder' OR g.selection_type<>'single'))
   OR (g.group_key='spicy' AND (g.name<>'Spice Level' OR g.selection_type<>'single')))
 UNION ALL SELECT a.product_id,'APPROVED_EXISTING_CHOICE_DRIFT:'||e.id::text
 FROM _curv_existing_choice e JOIN public.product_option_groups a ON a.option_group_id=e.group_id AND a.is_active
 JOIN catalog p ON p.product_id=a.product_id
 LEFT JOIN public.option_choices c ON c.id=e.id
 WHERE p.expected_state='SELLABLE_CANDIDATE' AND (
   c.id IS NULL OR c.option_group_id IS DISTINCT FROM e.group_id OR c.price_delta IS DISTINCT FROM e.old_delta
   OR c.label IS DISTINCT FROM CASE WHEN e.id='7c4e3426-a4ea-427c-ad73-b0815242e7c4'::uuid THEN 'Add Cheese' ELSE e.old_label END
   OR c.value IS DISTINCT FROM CASE WHEN e.id='7c4e3426-a4ea-427c-ad73-b0815242e7c4'::uuid THEN 'yes' ELSE e.old_value END
   OR c.is_active IS DISTINCT FROM CASE WHEN e.id IN ('bab37892-3af1-4498-ad67-71271c9cad70'::uuid,'3db8c36d-2e8e-4343-b8de-683b65070961'::uuid) THEN false ELSE e.old_active END)
 UNION ALL SELECT a.product_id,'APPROVED_NEW_CHOICE_MISSING_OR_DRIFT:'||e.group_key||':'||e.value
 FROM expected_new_choices e JOIN public.option_groups g ON g.group_key=e.group_key
 JOIN public.product_option_groups a ON a.option_group_id=g.id AND a.is_active JOIN catalog p ON p.product_id=a.product_id
 WHERE p.expected_state='SELLABLE_CANDIDATE' AND NOT EXISTS(
   SELECT 1 FROM public.option_choices c WHERE c.option_group_id=g.id AND c.value=e.value AND c.label=e.label AND c.price_delta=e.delta AND c.sort_order=e.sort_order AND c.is_active)
 UNION ALL SELECT c.product_id,'UNAPPROVED_ACTIVE_CHOICE:'||c.id::text FROM active_choices c JOIN catalog p ON p.product_id=c.product_id
 WHERE p.expected_state='SELLABLE_CANDIDATE' AND NOT EXISTS(SELECT 1 FROM _curv_existing_choice e WHERE e.id=c.id)
   AND NOT EXISTS(SELECT 1 FROM expected_new_choices e WHERE e.group_key=c.group_key AND e.value=c.value AND e.label=c.label AND e.delta=c.price_delta)
 UNION ALL SELECT product_id,'APPROVED_GROUP_HAS_NO_ACTIVE_CHOICES:'||group_key FROM group_stats WHERE choices_count=0
),
all_issues AS (
 SELECT * FROM scope_issues UNION ALL SELECT * FROM coverage_issues UNION ALL SELECT * FROM owner_issues
),
results AS MATERIALIZED (
 SELECT s.*,to_jsonb(c) AS existing_certification,c.structure_version,
   c.product_id IS NOT NULL AS certification_exists,
   coalesce(c.structure_version=1 AND c.expected_structure=s.current_structure,false) AS certification_matches,
   coalesce((SELECT jsonb_agg(DISTINCT i.reason ORDER BY i.reason) FROM all_issues i WHERE i.product_id=s.product_id),'[]'::jsonb) AS issues
 FROM structures s LEFT JOIN configuration_private.product_pricing_certifications c ON c.product_id=s.product_id
),
summary AS (
 SELECT jsonb_build_object(
   'expected_sellable',43,'expected_excluded',19,'expected_inventory_products',62,
   'actual_inventory_products',count(*) FILTER(WHERE product_exists),
   'sellable_products',count(*) FILTER(WHERE catalog_state='SELLABLE_CANDIDATE'),
   'certified_matching',count(*) FILTER(WHERE catalog_state='SELLABLE_CANDIDATE' AND certification_matches),
   'uncertified',count(*) FILTER(WHERE catalog_state='SELLABLE_CANDIDATE' AND NOT certification_exists),
   'stale_mismatched',count(*) FILTER(WHERE catalog_state='SELLABLE_CANDIDATE' AND certification_exists AND NOT certification_matches),
   'excluded',count(*) FILTER(WHERE product_exists AND catalog_state<>'SELLABLE_CANDIDATE'),
   'structurally_invalid',count(*) FILTER(WHERE catalog_state='SELLABLE_CANDIDATE' AND jsonb_array_length(issues)>0),
   'scope_anomalies',(SELECT count(*) FROM scope_issues),
   'approved_assignment_manifest_rows',(SELECT count(*) FROM _curv_expected_assignment),
   'active_sellable_assignments',(SELECT count(*) FROM public.product_option_groups a JOIN catalog p ON p.product_id=a.product_id WHERE p.catalog_state='SELLABLE_CANDIDATE' AND a.is_active),
   'sellable_defaults',(SELECT count(*) FROM public.product_option_defaults d JOIN catalog p ON p.product_id=d.product_id WHERE p.catalog_state='SELLABLE_CANDIDATE'),
   'hot_sizes',(SELECT count(*) FROM public.product_sizes s JOIN _curv_classic_size e ON e.product_id=s.product_id WHERE s.label='12oz Hot'),
   'expected_temperature_tuples',(SELECT count(*) FROM expected_compatibility),
   'active_sellable_temperature_tuples',(SELECT count(*) FROM public.product_size_option_choice_compatibility t JOIN catalog p ON p.product_id=t.product_id WHERE p.catalog_state='SELLABLE_CANDIDATE' AND t.is_active),
   'expected_context_entries',(SELECT count(*) FROM expected_context),
   'active_sellable_overrides',(SELECT count(*) FROM public.product_option_choice_price_overrides o JOIN catalog p ON p.product_id=o.product_id WHERE p.catalog_state='SELLABLE_CANDIDATE' AND o.is_active),
   'active_sellable_requirements',(SELECT count(*) FROM public.product_option_choice_override_requirements r JOIN catalog p ON p.product_id=r.product_id WHERE p.catalog_state='SELLABLE_CANDIDATE' AND r.is_active)
 ) AS data FROM results
)

SELECT jsonb_build_object(
 'summary',(SELECT data FROM summary),
 'products',(SELECT jsonb_agg(jsonb_build_object(
   'product_id',product_id,'product_name',product_name,'reviewed_name',reviewed_name,
   'published',is_published,'available',is_available,'sold_out',is_sold_out,'archived_at',archived_at,
   'catalog_state',catalog_state,'expected_state',expected_state,
   'current_catalog_structure',current_structure,'existing_certification',existing_certification,
   'structure_version',structure_version,'certification_matches',certification_matches,
   'readiness',CASE WHEN catalog_state<>'SELLABLE_CANDIDATE' THEN 'EXCLUDED'
     WHEN jsonb_array_length(issues)>0 THEN 'STRUCTURALLY_INVALID'
     WHEN NOT certification_exists THEN 'CERTIFICATION_MISSING'
     WHEN NOT certification_matches THEN 'CERTIFICATION_STALE_OR_MISMATCHED'
     ELSE 'READY' END,
   'reasons',issues || CASE WHEN catalog_state='SELLABLE_CANDIDATE' AND NOT certification_exists
     THEN jsonb_build_array('D0B1_CERTIFICATION_STALE:MISSING')
     WHEN catalog_state='SELLABLE_CANDIDATE' AND NOT certification_matches
     THEN jsonb_build_array('D0B1_CERTIFICATION_STALE:MISMATCH') ELSE '[]'::jsonb END
 ) ORDER BY product_name,product_id) FROM results),
 'reviewed_manifest_template',jsonb_build_object(
   'review_note',NULL,
   'products',(SELECT jsonb_agg(jsonb_build_object(
      'product_id',product_id,'product_name',product_name,
      'product_state',product_state,'category_state',category_state,
      'expected_structure',current_structure,
      'reviewed_existing_certification',existing_certification
   ) ORDER BY product_id) FROM results WHERE expected_state='SELLABLE_CANDIDATE')
 )
) AS pricing_certification_audit;
COMMIT;
