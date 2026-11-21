/* Reconstruct catalog and search shards from standalone HTML under file://.
   No HTML is inserted into the live document; original messages are not modified. */
(function(g){'use strict';
const C=g.ArchiveCore;
const isAccount=s=>{try{return C.accountName(s)===s;}catch{return false;}};
const mailFile=/^email-([a-f0-9]{64})\.html$/;
const year=/^(?:1[6-9]|[2-9]\d)\d{2}$/,month=/^\d{4}-(?:0[1-9]|1[0-2])$/;
async function* scan(root){
 for await(const [account,ah] of root.entries()){
  if(ah.kind!=='directory'||!isAccount(account))continue;
  for await(const [yearName,yh] of ah.entries()){
   if(yh.kind!=='directory')continue;
   const months=[];
   if(yearName==='unknown-date')months.push({folder:account+'/unknown-date',dir:yh});
   else if(year.test(yearName)){
    for await(const [mn,mh] of yh.entries()){
     if(mh.kind==='directory'&&month.test(mn)&&mn.startsWith(yearName+'-'))months.push({folder:account+'/'+yearName+'/'+mn,dir:mh});
    }
   }
   for(const {folder,dir} of months){
    for await(const [name,h] of dir.entries()){
     const m=mailFile.exec(name);
     if(h.kind==='file'&&m)yield {account,folder,id:m[1],path:folder+'/'+name,handle:h};
    }
   }
  }
 }
}
const safeAttachmentHref=href=>{
 if(typeof href!=='string'||!href.startsWith('attachments/'))return false;
 try{
  const v=decodeURIComponent(href);
  return /^attachments\/[^\/\\:\x00-\x1f]+$/.test(v)&&!v.includes('..')&&!v.includes('?')&&!v.includes('#');
 }catch{return false;}
};
function legacyRecord(fragment,source){
 // Older standalone pages do not have embedded JSON. Recover only printed header fields.
 const header=fragment.querySelector('header'),main=fragment.querySelector('main'),heading=header?.querySelector('h1');
 if(!heading||!main)throw Error('MISSING_EMBEDDED_METADATA');
 const fields={};
 for(const dt of header.querySelectorAll('dl dt')){
  const dd=dt.nextElementSibling;
  if(dd?.tagName==='DD')fields[(dt.textContent||'').trim().toLowerCase()]=(dd.textContent||'').trim();
 }
 const rawDate=fields.date||'',parsed=Date.parse(rawDate),date=Number.isFinite(parsed)?new Date(parsed).toISOString():null;
 const attachments=[];
 for(const section of fragment.querySelectorAll('section')){
  if((section.querySelector('h2')?.textContent||'').trim().toLowerCase()!=='attachments')continue;
  for(const li of section.querySelectorAll('li')){
   const a=li.querySelector('a[href]');if(!a)continue;
   const href=a.getAttribute('href');if(!safeAttachmentHref(href))throw Error('INVALID_ATTACHMENT_REFERENCE');
   const sizeText=li.querySelector('small')?.textContent||'',sizeMatch=/\(([\d,]+)\s*B\b/.exec(sizeText);
   const preview=Array.from(li.querySelectorAll('a[href]')).slice(1).map(link=>link.getAttribute('href')).find(x=>safeAttachmentHref(x));
   attachments.push({href,name:a.getAttribute('download')||a.textContent||'attachment',size:sizeMatch?Number(sizeMatch[1].replace(/,/g,'')):0,
    ...(preview?{preview}:{}),...(sizeText.includes('.download')?{quarantined:true}:{})});
  }
 }
 return {id:source.id,account:source.account,folder:source.folder,path:source.path,
  subject:(heading.textContent||'').trim()||'(No subject)',from:fields.from||'',to:fields.to||'',cc:fields.cc||'',bcc:fields.bcc||'',
  date,day:date?.slice(0,10)||null,rawDate,messageId:fields['message-id']||'',
  labels:fields.labels?fields.labels.split(',').map(s=>s.trim()).filter(Boolean):[],attachments,bytes:0};
}
function fromHtml(html,source){
 const t=document.createElement('template');t.innerHTML=html;
 const fragment=t.content,embedded=fragment.querySelector('#mail-archive-record[type="application/json"]'),legacy=!embedded;
 if(legacy){
  const record=legacyRecord(fragment,source);
  return {record,text:C.fold(fragment.querySelector('main')?.textContent||''),legacy};
 }
 let data;
 try{data=JSON.parse(embedded.textContent);}catch{throw Error('INVALID_EMBEDDED_METADATA');}
 const r=data?.record;
 if(data?.schema!==1||!r||typeof r!=='object'||r.id!==source.id||r.account!==source.account||r.folder!==source.folder||r.path!==source.path)throw Error('INVALID_EMBEDDED_METADATA');
 if(typeof r.subject!=='string'||typeof r.from!=='string'||!Array.isArray(r.labels)||!Array.isArray(r.attachments))throw Error('INVALID_EMBEDDED_METADATA');
 const attachments=r.attachments.map(a=>{
  if(!a||!safeAttachmentHref(a.href))throw Error('INVALID_ATTACHMENT_REFERENCE');
  return {...a,name:String(a.name||''),size:Number(a.size)||0};
 });
 if(r.original&&!g.ArchiveEML.safeOriginal(r.original,source.id))throw Error('INVALID_ORIGINAL_REFERENCE');
 const text=fragment.querySelector('main')?.textContent||'';
 return {record:{...r,attachments},text:C.fold(text),legacy};
}
async function inspect(source){return fromHtml(await (await source.handle.getFile()).text(),source);}
async function rebuild(root,{signal,onProgress=()=>{},batchSize=100,lockHeld=false}={}){
 const lock=lockHeld?null:new C.Importer(root);
 if(lock)await lock.lock();
 const stats={scanned:0,indexed:0,legacyRecovered:0,duplicates:0,errors:0,brokenAttachments:0,missingOriginals:0,segments:0,committed:false};
 const notify=()=>onProgress({...stats});
 try{
  let previous;
  try{previous=await C.manifest(root);}catch{previous=C.empty();}
  const seen=new Set(),segments=[],accounts=new Set(),failures=[];
  const token=crypto.randomUUID(),batch=[],search=[];
  let bucket=null;
  const flush=async()=>{
   if(!batch.length)return;
   const base=bucket+'/catalog/rebuild-'+token+'-'+String(segments.length).padStart(5,'0');
   const meta=base+'.js',textFile=base+'-text.js';
   await C.write(root,textFile,C.wrap({kind:'search',records:search}));
   await C.write(root,meta,C.wrap({kind:'metadata',records:batch}));
   segments.push({meta,search:textFile,count:batch.length});
   stats.segments++;batch.length=0;search.length=0;notify();
  };
  for await(const source of scan(root)){
   if(signal?.aborted)break;
   stats.scanned++;
   const key=source.account+'/'+source.id;
   if(seen.has(key)){stats.duplicates++;notify();continue;}
   seen.add(key);
   try{
    if(bucket!==null&&bucket!==source.account)await flush();
    bucket=source.account;
    const {record,text,legacy}=await inspect(source);
    if(legacy)stats.legacyRecovered++;
    for(const a of record.attachments){
     try{if(!await C.exists(root,source.folder+'/'+decodeURIComponent(a.href)))stats.brokenAttachments++;}
     catch{stats.brokenAttachments++;}
    }
    if(record.original&&!await C.exists(root,source.folder+'/'+record.original.href))stats.missingOriginals++;
    batch.push(record);search.push({key,text});accounts.add(source.account);stats.indexed++;
    if(batch.length>=batchSize)await flush();
   }catch(e){stats.errors++;if(failures.length<5)failures.push({path:source.path,code:e.message||e.name||'READ_ERROR'});}
   if(stats.scanned%25===0){notify();await new Promise(resolve=>setTimeout(resolve,0));}
  }
  if(signal?.aborted)return {...stats,interrupted:true};
  // A partial replacement index could hide otherwise intact messages.
  if(stats.errors||stats.duplicates){const err=Error('REINDEX_INCOMPLETE');err.details={...stats,failures,previousCatalog:previous.segments.length>0};throw err;}
  await flush();
  const next={kind:'manifest',format:C.VERSION,generation:(previous.generation||0)+1,
   created:previous.created||new Date().toISOString(),updated:new Date().toISOString(),
   accounts:[...accounts].sort(),segments,total:stats.indexed,rebuild:{scanned:stats.scanned,errors:stats.errors,brokenAttachments:stats.brokenAttachments,missingOriginals:stats.missingOriginals}};
  // Do not touch HTML or attachment files; publish last, after all shards exist.
  const paths=await C.catalogPaths(root);
   await C.write(root,paths.previous,C.wrap(previous));
   await C.write(root,paths.current,C.wrap(next));
  stats.committed=true;notify();
  return {...stats,interrupted:false};
 }finally{if(lock?.lockWriter)await lock.lockWriter.close();}
}

/* Add only orphan HTML pages to a healthy catalog. Existing metadata/search shards
   are never rewritten, and a manifest is published only after every new page validates.
   If existing shards are damaged, fall back to the strict full HTML reconstruction. */
async function syncMissing(root,{signal,onProgress=()=>{},batchSize=100}={}){
 const lock=new C.Importer(root);
 await lock.lock();
 const stats={scanned:0,skipped:0,indexed:0,legacyRecovered:0,errors:0,duplicates:0,segments:0,accounts:0,committed:false,interrupted:false,fullRebuild:false};
 const notify=()=>onProgress({...stats});
 try{
  let old=null,indexed=new Map(),badShards=false;
  try{
   old=await C.manifest(root);
   for(const shard of old.segments){
    if(signal?.aborted){stats.interrupted=true;notify();return stats;}
    if(shard.search&&!await C.exists(root,shard.search)){badShards=true;break;}
    const data=C.unwrap(await C.read(root,shard.meta));
    if(data.kind!=='metadata'||!Array.isArray(data.records))throw Error('CATALOG');
    for(const record of data.records){
     const key=record.account+'/'+record.id;
     if(!record.path||indexed.has(key)&&indexed.get(key)!==record.path)throw Error('CATALOG_CONFLICT');
     indexed.set(key,record.path);
    }
   }
  }catch{badShards=true;}
  if(badShards){
   stats.fullRebuild=true;
   // Strict fallback keeps the last good manifest until every HTML page passes validation.
   // The caller already holds the exclusive writer lock.
   const rebuilt=await rebuild(root,{signal,onProgress:d=>onProgress({...d,fullRebuild:true,skipped:0}),batchSize,lockHeld:true});
   return {...rebuilt,fullRebuild:true,skipped:0};
  }
  const seen=new Set(),segments=[],accounts=new Set(old.accounts||[]),batch=[],search=[];
  const token=crypto.randomUUID();
  let bucket=null;
  const flush=async()=>{
   if(!batch.length)return;
   const base=bucket+'/catalog/incremental-'+token+'-'+String(segments.length).padStart(5,'0');
   const meta=base+'.js',textFile=base+'-text.js';
   await C.write(root,textFile,C.wrap({kind:'search',records:search}));
   await C.write(root,meta,C.wrap({kind:'metadata',records:batch}));
   segments.push({meta,search:textFile,count:batch.length});
   stats.segments++;batch.length=0;search.length=0;notify();
  };
  for await(const source of scan(root)){
   if(signal?.aborted){stats.interrupted=true;break;}
   stats.scanned++;
   const key=source.account+'/'+source.id;
   if(seen.has(key)){stats.duplicates++;continue;}
   seen.add(key);
   if(indexed.has(key)){
    if(indexed.get(key)!==source.path){stats.errors++;break;}
    stats.skipped++;
   }else{
    try{
     if(bucket!==null&&bucket!==source.account)await flush();
     bucket=source.account;
     const item=await inspect(source);
     batch.push(item.record);search.push({key,text:item.text});
     accounts.add(source.account);stats.indexed++;
     if(item.legacy)stats.legacyRecovered++;
     if(batch.length>=batchSize)await flush();
    }catch{stats.errors++;}
   }
   if(stats.scanned%100===0){notify();await new Promise(r=>setTimeout(r,0));}
  }
  if(stats.interrupted){notify();return stats;}
  if(stats.errors||stats.duplicates){
   const error=Error('REINDEX_INCOMPLETE');
   error.details={...stats,previousCatalog:!!old.segments.length};
   throw error;
  }
  if(!stats.indexed){stats.accounts=accounts.size;notify();return stats;}
  await flush();
  const next={...old,generation:(old.generation||0)+1,
   updated:new Date().toISOString(),accounts:[...accounts].sort(),
   total:indexed.size+stats.indexed,segments:[...old.segments,...segments]};
  // Preserve the old manifest and existing segments; no saved HTML is rewritten.
  const paths=await C.catalogPaths(root);
  await C.write(root,paths.previous,C.wrap(old));
  await C.write(root,paths.current,C.wrap(next));
  stats.committed=true;stats.accounts=accounts.size;notify();return stats;
 }finally{if(lock.lockWriter)await lock.lockWriter.close();}
}
/* Read-only deep inventory for Check existing. Unlike syncMissing, this never
   opens a writer or changes catalog files. */
async function checkMissing(root,{signal,onProgress=()=>{}}={}){
 const stats={scanned:0,indexed:0,missing:0,damaged:false,errors:0,interrupted:false};
 const notify=()=>onProgress({...stats});
 const known=new Map();
 try{
  const m=await C.manifest(root);
  for(const seg of m.segments){
   if(signal?.aborted){stats.interrupted=true;notify();return stats;}
   const data=C.unwrap(await C.read(root,seg.meta));
   if(data.kind!=='metadata'||!Array.isArray(data.records))throw Error('CATALOG');
   if(seg.search&&!await C.exists(root,seg.search))throw Error('MISSING_SEARCH_INDEX');
   for(const r of data.records){
    const key=r.account+'/'+r.id;
    if(!r.path||(known.has(key)&&known.get(key)!==r.path))throw Error('CATALOG');
    known.set(key,r.path);
   }
  }
 }catch{stats.damaged=true;}
 notify();
 for await(const source of scan(root)){
  if(signal?.aborted){stats.interrupted=true;break;}
  stats.scanned++;
  const key=source.account+'/'+source.id;
  if(known.get(key)===source.path)stats.indexed++;
  else stats.missing++;
  if(stats.scanned<=5||stats.scanned%25===0){
   notify();await new Promise(r=>setTimeout(r,0));
  }
 }
 notify();return stats;
}
g.ArchiveReindex={scan,fromHtml,inspect,rebuild,syncMissing,checkMissing,safeAttachmentHref};
})(globalThis);
