const fs=require('node:fs'),path=require('node:path');
const {fixture}=require('./pos-database.cjs');
async function configurationFixture({applyPos=false}={}){
 const f=await fixture({applyPos});
 try {await f.db.exec(fs.readFileSync(path.join(__dirname,'../admin/WEBSITE_CONFIGURATION_D0A1_SCHEMA.sql'),'utf8').replace(/^\uFEFF/,''));return f;}
 catch(e){await f.db.close();throw e;}
}
module.exports={configurationFixture};
