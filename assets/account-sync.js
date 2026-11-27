/* Account-level catalog reconciliation. Never reads or writes message HTML. */
(function(g){'use strict';
const C=g.ArchiveCore;
const pointer=account=>account+'/catalog/account-index.json';
const validAccount=name=>{try{return C.accountName(name)===name;}catch{return false;}};
const segmentAccount=segment=>{
 const m=typeof segment?.meta==='string'&&/^([a-z0-9][a-z0-9_-]{0,39})\/catalog\/([A-Za-z0-9_-]+)\.js$/.exec(segment.meta);
 if(!m||!validAccount(m[1])||m[2].endsWith('-text')||!Number.isSafeInteger(segment.count)||segment.count<0||
  (segment.search!=null&&segment.search!==segment.meta.slice(0,-3)+'-text.js'))throw Error('CATALOG');
 return m[1];
};
const validSegments=(account,segments)=>{
 if(!Array.isArray(segments)||segments.some(s=>segmentAccount(s)!==account)||
  new Set(segments.map(s=>s.meta)).size!==segments.length)throw Error('CATALOG');
 return segments;
};
const canonical=segments=>JSON.stringify(segments.map(s=>({meta:s.meta,search:s.search||null,count:s.count})));
const equalSegments=(a,b)=>canonical(a)===canonical(b);
const index=(account,segments,total)=>({kind:'account-index',format:C.VERSION,account,segments,total});
async function readPointer(root,account){
 if(!await C.exists(root,pointer(account)))return null;
 const value=JSON.parse(await C.read(root,pointer(account)));
 if(value?.kind!=='account-index'||value.format!==C.VERSION||value.account!==account||
  !Number.isSafeInteger(value.total)||value.total<0)throw Error('CATALOG');
 validSegments(account,value.segments);
 return value;
}
function validateRecord(account,record){
 if(!record||record.account!==account||!/^[a-f0-9]{64}$/.test(record.id)||
  typeof record.folder!=='string'||typeof record.subject!=='string'||typeof record.from!=='string'||
  !Array.isArray(record.labels)||!Array.isArray(record.attachments))throw Error('CATALOG');
 const folder=record.folder.split('/');
 if(folder[0]!==account||!(folder.length===2&&folder[1]==='unknown-date'||
  folder.length===3&&/^(?:1[6-9]|[2-9]\d)\d{2}$/.test(folder[1])&&/^\d{4}-(?:0[1-9]|1[0-2])$/.test(folder[2])&&folder[2].startsWith(folder[1]+'-'))||
  record.path!==record.folder+'/email-'+record.id+'.html')throw Error('CATALOG');
}
async function inspect(root,account,segments,{adopt=false,unique=false}={}){
 validSegments(account,segments);
 const records=new Map(),searchKeys=new Set();
 for(const segment of segments){
  const metadata=C.unwrap(await C.read(root,segment.meta));
  if(metadata?.kind!=='metadata'||!Array.isArray(metadata.records)||metadata.records.length!==segment.count)throw Error('CATALOG');
  for(const record of metadata.records){
   validateRecord(account,record);
   if(records.has(record.id)&&(unique||records.get(record.id)!==record.path))throw Error('CATALOG');
   records.set(record.id,record.path);
  }
  if(segment.search){
   if(adopt){
    const search=C.unwrap(await C.read(root,segment.search));
    if(search?.kind!=='search'||!Array.isArray(search.records))throw Error('CATALOG');
    for(const entry of search.records){
     if(typeof entry?.key!=='string'||!entry.key.startsWith(account+'/')||typeof entry.text!=='string')throw Error('CATALOG');
     searchKeys.add(entry.key.slice(account.length+1));
    }
   }else if(!await C.exists(root,segment.search))throw Error('CATALOG');
  }
 }
 if(adopt&&(records.size!==searchKeys.size||[...records.keys()].some(id=>!searchKeys.has(id))))throw Error('CATALOG');
 return records;
}
// A newly copied account can be adopted only if its index covers all current
// message filenames. Never open those messages, and never walk existing accounts.
async function filenames(account,handle){
 const found=new Map();
 async function month(folder,dir){
  for await(const [name,entry] of dir.entries()){
   const m=/^email-([a-f0-9]{64})\.html$/.exec(name);
   if(entry.kind==='file'&&m){
    if(found.has(m[1]))throw Error('CATALOG');
    found.set(m[1],folder+'/'+name);
   }
  }
 }
 for await(const [year,dir] of handle.entries()){
  if(dir.kind!=='directory')continue;
  if(year==='unknown-date')await month(account+'/'+year,dir);
  else if(/^(?:1[6-9]|[2-9]\d)\d{2}$/.test(year)){
   for await(const [name,entry] of dir.entries())
    if(entry.kind==='directory'&&/^\d{4}-(?:0[1-9]|1[0-2])$/.test(name)&&name.startsWith(year+'-'))await month(account+'/'+year+'/'+name,entry);
  }
 }
 return found;
}
async function legacySegments(root,account,handle){
 let dir;
 try{dir=await handle.getDirectoryHandle('catalog');}catch(e){if(e.name==='NotFoundError')return null;throw e;}
 const names=[];
 for await(const [name,entry] of dir.entries())if(entry.kind==='file'&&/^[A-Za-z0-9_-]+\.js$/.test(name)&&!name.endsWith('-text.js'))names.push(name);
 if(!names.length)return null;
 const segments=[];
 for(const name of names.sort()){
  const meta=account+'/catalog/'+name,search=meta.slice(0,-3)+'-text.js';
  const data=C.unwrap(await C.read(root,meta));
  if(data?.kind!=='metadata'||!Array.isArray(data.records)||!data.records.length)throw Error('CATALOG');
  segments.push({meta,search:await C.exists(root,search)?search:null,count:data.records.length});
 }
 return segments;
}
async function plan(root){
 const original=await C.manifest(root),physical=new Map();
 // Enumeration must complete successfully before treating a folder as absent.
 for await(const [name,entry] of root.entries())if(entry.kind==='directory'&&validAccount(name))physical.set(name,entry);
 const grouped=new Map();
 for(const account of original.accounts){
  if(!validAccount(account))throw Error('CATALOG');
  grouped.set(account,[]);
 }
 for(const segment of original.segments){
  const account=segmentAccount(segment);
  if(!grouped.has(account))grouped.set(account,[]);
  grouped.get(account).push(segment);
 }
 for(const [account,segments] of grouped)validSegments(account,segments);
 const removed=[...grouped.keys()].filter(a=>!physical.has(a)).sort(),added=[],unindexed=[],damaged=[],pointers=[];
 const retained=original.segments.filter(s=>physical.has(segmentAccount(s))),accounts=[...grouped.keys()].filter(a=>physical.has(a));
 let total=0;
 for(const account of accounts){
  const segments=grouped.get(account);
  let saved=null;try{saved=await readPointer(root,account);}catch{/* The global manifest is authoritative for existing accounts. */}
  if(saved&&equalSegments(saved.segments,segments)){
   total+=saved.total;continue;
  }
  try{
   const records=await inspect(root,account,segments);
   total+=records.size;
   pointers.push(index(account,segments,records.size));
  }catch{damaged.push(account);}
 }
 for(const [account,handle] of [...physical].sort(([a],[b])=>a.localeCompare(b))){
  if(grouped.has(account))continue;
  try{
   const saved=await readPointer(root,account);
   const segments=saved?.segments||await legacySegments(root,account,handle);
   if(!segments?.length){unindexed.push(account);continue;}
   const records=await inspect(root,account,segments,{adopt:true,unique:!saved});
   const actual=await filenames(account,handle);
   if(actual.size!==records.size||[...actual].some(([id,p])=>records.get(id)!==p)||
    saved&&saved.total!==records.size)throw Error('CATALOG');
   retained.push(...segments);accounts.push(account);added.push(account);total+=records.size;
   if(!saved)pointers.push(index(account,segments,records.size));
  }catch{unindexed.push(account);}
 }
 accounts.sort();
 const changed=removed.length>0||added.length>0||(!damaged.length&&total!==original.total)||
  JSON.stringify(accounts)!==JSON.stringify([...original.accounts].sort());
 const next={...original,accounts,segments:retained,total:damaged.length?original.total:total};
 if(changed&&!damaged.length){next.generation=(original.generation||0)+1;next.updated=new Date().toISOString();}
 // Backup is also a manifest. Never leave absent-account references in it
 // after reconciliation, even when the current manifest is already clean.
 const paths=await C.catalogPaths(root);
 let backupDirty=false;
 if(await C.exists(root,paths.previous)){
  try{
   const previous=C.unwrap(await C.read(root,paths.previous));
   if(previous?.kind==='manifest'&&Array.isArray(previous.accounts)&&Array.isArray(previous.segments))
    backupDirty=previous.accounts.some(a=>validAccount(a)&&!physical.has(a))||previous.segments.some(s=>!physical.has(segmentAccount(s)));
  }catch{/* Do not silently replace an independently damaged backup on a no-op. */}
 }
 return {manifest:next,paths,removed,added,unindexed,damaged,pointers,changed,backupDirty,
  requiresPublish:changed||backupDirty,persisted:false,deferred:false};
}
async function sync(root,{write=false}={}){
 let result=await plan(root);
 if(!write||result.damaged.length||!(result.requiresPublish||result.pointers.length))return result;
 const lock=new C.Importer(root);
 try{
  await lock.lock({timeoutMs:1500});
  // Re-read after acquiring the same exclusive lock as Import/Rebuild.
  result=await plan(root);
  if(result.damaged.length)return result;
  if(result.requiresPublish){
   // Publish a clean backup as well as a clean current manifest. If the
   // second write fails, the next startup retries without touching email.
   await C.write(root,result.paths.previous,C.wrap(result.manifest));
   if(result.changed)await C.write(root,result.paths.current,C.wrap(result.manifest));
   result.persisted=true;
  }
  for(const entry of result.pointers)await C.write(root,pointer(entry.account),C.json(entry));
  return result;
 }catch(e){return {...result,deferred:true,error:e?.message||'CATALOG'};}
 finally{if(lock.lockWriter)await lock.lockWriter.close();}
}
g.ArchiveAccountSync={sync,segmentAccount,validateRecord};
})(globalThis);
