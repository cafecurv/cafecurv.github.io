const fs=require('node:fs');const path=require('node:path');
const {fixture}=require('./pos-database.cjs');
async function kitchenFixture(){
  const f=await fixture();
  try{for(const file of ['POS_PHASE_P1B_SCHEMA.sql','POS_PHASE_P1B_BACKEND.sql'])
    await f.db.exec(fs.readFileSync(path.join(__dirname,'../admin',file),'utf8'));
    return f;
  }catch(e){await f.db.close();throw e;}
}
module.exports={kitchenFixture};
