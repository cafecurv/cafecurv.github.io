// Creates ONLY new labelled local containers/network. Never reads existing Env/DB data.
const fs=require('fs'),path=require('path'),cp=require('child_process'),crypto=require('crypto');
const {Client}=require('pg');const os=require('os');const work=fs.mkdtempSync(path.join(process.env.CURV_KIOSK_TMPDIR||os.tmpdir(),'curv-kiosk-real-auth-')), docker='C:/Program Files/Docker/Docker/resources/bin/docker.exe';
const host=['--host','npipe:////./pipe/docker_engine'];const owner='curv-kiosk-real-auth-'+crypto.randomBytes(5).toString('hex');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
function run(args,opts={}){const r=cp.spawnSync(docker,[...host,...args],{encoding:'utf8',windowsHide:true,timeout:opts.timeout||60000,...opts});if(r.status!==0)throw Error('Docker '+args[0]+' failed: '+(r.stderr||r.error?.message));return r.stdout.trim();}
const inspect=name=>JSON.parse(run(['inspect',name]))[0];
const select=c=>({id:c.Id,name:c.Name,image:c.Image,labels:c.Config.Labels,ports:c.HostConfig.PortBindings,mounts:c.Mounts.map(m=>({type:m.Type,name:m.Name,source:m.Source,destination:m.Destination,rw:m.RW}))});
const inventory=()=>{const ids=run(['ps','-aq']).split(/\s+/).filter(Boolean);return ids.map(x=>select(inspect(x)));};
const volumes=()=>run(['volume','ls','-q']).split(/\s+/).filter(Boolean).sort();
function writeEnv(name,vars){const p=path.join(work,name+'.env');fs.writeFileSync(p,Object.entries(vars).map(([k,v])=>k+'='+v).join('\n')+'\n');return p;}
async function start(){
 const before={containers:inventory(),volumes:volumes()};fs.writeFileSync(path.join(work,'docker-before.json'),JSON.stringify(before,null,2));
 const secret=crypto.randomBytes(48).toString('hex'),password=crypto.randomBytes(24).toString('hex');
 const names={network:owner,db:owner+'-db',auth:owner+'-auth',rest:owner+'-rest'};const label=['--label','curv.disposable.owner='+owner];
 const state={owner,names,work,created:[],ports:{},images:{db:'public.ecr.aws/supabase/postgres:17.6.1.140',auth:'public.ecr.aws/supabase/gotrue:v2.197.0',rest:'public.ecr.aws/supabase/postgrest:v16.4'}};
 const save=()=>fs.writeFileSync(path.join(work,'state.json'),JSON.stringify(state,null,2));save();
 let client;
 const cleanup=async()=>{
  if(client)await client.end().catch(()=>{});
  for(const name of [...state.created].reverse()){
   let c;try{c=inspect(name);}catch(e){if(e.message.includes('No such')||e.message.includes('no such'))continue;throw e;}if(c.Config.Labels?.['curv.disposable.owner']!==owner)throw Error('Refusing unrelated container cleanup');run(['rm','-f',name]);
  }
  const net=JSON.parse(run(['network','inspect',names.network]))[0];if(net.Labels?.['curv.disposable.owner']!==owner)throw Error('Refusing unrelated network cleanup');run(['network','rm',names.network]);
  const after={containers:inventory(),volumes:volumes()};
  const preserved=before.containers.every(c=>JSON.stringify(c)===JSON.stringify(after.containers.find(x=>x.id===c.id)))&&JSON.stringify(before.volumes)===JSON.stringify(after.volumes);
  fs.writeFileSync(path.join(work,'docker-after.json'),JSON.stringify(after,null,2));if(!preserved)throw Error('Existing Docker resource metadata changed');state.cleaned=true;state.existingPreserved=true;save();for(const name of ['db.env','auth.env','rest.env']){const p=path.join(work,name);if(fs.existsSync(p))fs.unlinkSync(p);}
 };
 try{
  run(['network','create',...label,names.network]);
  const dbEnv=writeEnv('db',{POSTGRES_PASSWORD:password,POSTGRES_DB:'postgres',JWT_SECRET:secret,JWT_EXP:'60'});
  state.created.push(names.db);save();
  run(['run','-d','--pull=never','--name',names.db,...label,'--network',names.network,'--network-alias','db','--tmpfs','/var/lib/postgresql/data:rw,size=768m','-p','127.0.0.1::5432','--env-file',dbEnv,state.images.db]);save();
  const port=Number(inspect(names.db).NetworkSettings.Ports['5432/tcp'][0].HostPort);state.ports.db=port;save();
  for(let i=0;i<100;i++){
   try{const t=new Client({host:'127.0.0.1',port,user:'postgres',database:'postgres',password,ssl:false,connectionTimeoutMillis:1000});await t.connect();client=t;break;}catch(e){if(i===99)throw Error('New disposable DB readiness failed');await sleep(300);}
  }
  const roles=(await client.query("select rolname from pg_roles where rolname in ('anon','authenticated','authenticator','supabase_auth_admin')")).rows.map(x=>x.rolname);console.log('Fresh disposable DB roles: '+roles.join(','));
  state.phase='database-ready';save();
  return {client,state,secret,password,run,inspect,writeEnv,label,sleep,save,cleanup,async services(){
   const authEnv=writeEnv('auth',{GOTRUE_API_HOST:'0.0.0.0',GOTRUE_API_PORT:'9999',API_EXTERNAL_URL:'http://127.0.0.1',GOTRUE_SITE_URL:'http://127.0.0.1',GOTRUE_DB_DRIVER:'postgres',GOTRUE_DB_DATABASE_URL:'postgres://supabase_auth_admin:'+password+'@db:5432/postgres',GOTRUE_JWT_SECRET:secret,GOTRUE_JWT_EXP:'60',GOTRUE_JWT_AUD:'authenticated',GOTRUE_JWT_DEFAULT_GROUP_NAME:'authenticated',GOTRUE_JWT_ADMIN_ROLES:'service_role',GOTRUE_DISABLE_SIGNUP:'false',GOTRUE_EXTERNAL_EMAIL_ENABLED:'true',GOTRUE_MAILER_AUTOCONFIRM:'true',GOTRUE_EXTERNAL_PHONE_ENABLED:'false',GOTRUE_RATE_LIMIT_EMAIL_SENT:'100',GOTRUE_SECURITY_REFRESH_TOKEN_ROTATION_ENABLED:'true',GOTRUE_SECURITY_REFRESH_TOKEN_REUSE_INTERVAL:'0',GOTRUE_LOG_LEVEL:'error'});
   state.created.push(names.auth);save();
  run(['run','-d','--pull=never','--name',names.auth,...label,'--network',names.network,'-p','127.0.0.1::9999','--env-file',authEnv,state.images.auth]);state.ports.auth=Number(inspect(names.auth).NetworkSettings.Ports['9999/tcp'][0].HostPort);save();
   const restEnv=writeEnv('rest',{PGRST_DB_URI:'postgres://authenticator:'+password+'@db:5432/postgres',PGRST_DB_SCHEMAS:'public',PGRST_DB_ANON_ROLE:'anon',PGRST_JWT_SECRET:secret,PGRST_DB_EXTRA_SEARCH_PATH:'public,extensions',PGRST_LOG_LEVEL:'error'});
   state.created.push(names.rest);save();
  run(['run','-d','--pull=never','--name',names.rest,...label,'--network',names.network,'-p','127.0.0.1::3000','--env-file',restEnv,state.images.rest]);state.ports.rest=Number(inspect(names.rest).NetworkSettings.Ports['3000/tcp'][0].HostPort);save();
   for(const [service,url] of [['auth','http://127.0.0.1:'+state.ports.auth+'/health'],['rest','http://127.0.0.1:'+state.ports.rest+'/']]){
    let ready=false;for(let i=0;i<80;i++){try{const r=await fetch(url,{signal:AbortSignal.timeout(1500)});if(r.ok){ready=true;break;}}catch{}await sleep(300);}if(!ready)throw Error(service+' readiness failed');
   }
   state.phase='services-ready';save();console.log('Isolated real Auth/PostgREST healthy; loopback-only ports.');
  }};
 }catch(e){try{await cleanup();}catch(x){e.message+='; cleanup: '+x.message;}throw e;}
}
module.exports={start};
if(require.main===module)(async()=>{const s=await start();try{console.log(JSON.stringify((await s.client.query("select schema_name from information_schema.schemata where schema_name='auth'")).rows));}finally{await s.cleanup();}})().catch(e=>{console.error(e.message);process.exitCode=1;});
