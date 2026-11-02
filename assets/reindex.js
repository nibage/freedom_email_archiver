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
function fromHtml(html,source){
 const t=document.createElement('template');t.innerHTML=html;
 const fragment=t.content,embedded=fragment.querySelector('#mail-archive-record[type="application/json"]');
 if(!embedded)throw Error('MISSING_EMBEDDED_METADATA');
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
 return {record:{...r,attachments},text:C.fold(text)};
}
async function rebuild(root,{signal,onProgress=()=>{},batchSize=100}={}){
 const lock=new C.Importer(root);
 await lock.lock();
 const stats={scanned:0,indexed:0,duplicates:0,errors:0,brokenAttachments:0,missingOriginals:0,segments:0,committed:false};
 const notify=()=>onProgress({...stats});
 try{
  let previous;
  try{previous=await C.manifest(root);}catch{previous=C.empty();}
  const seen=new Set(),segments=[],accounts=new Set();
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
    const page=await (await source.handle.getFile()).text();
    const {record,text}=fromHtml(page,source);
    for(const a of record.attachments){
     try{if(!await C.exists(root,source.folder+'/'+decodeURIComponent(a.href)))stats.brokenAttachments++;}
     catch{stats.brokenAttachments++;}
    }
    if(record.original&&!await C.exists(root,source.folder+'/'+record.original.href))stats.missingOriginals++;
    batch.push(record);search.push({key,text});accounts.add(source.account);stats.indexed++;
    if(batch.length>=batchSize)await flush();
   }catch{stats.errors++;}
   if(stats.scanned%25===0){notify();await new Promise(resolve=>setTimeout(resolve,0));}
  }
  if(signal?.aborted)return {...stats,interrupted:true};
  // A partial replacement index could hide otherwise intact messages.
  if(stats.errors||stats.duplicates)throw Error('REINDEX_INCOMPLETE');
  await flush();
  const next={kind:'manifest',format:C.VERSION,generation:(previous.generation||0)+1,
   created:previous.created||new Date().toISOString(),updated:new Date().toISOString(),
   accounts:[...accounts].sort(),segments,total:stats.indexed,rebuild:{scanned:stats.scanned,errors:stats.errors,brokenAttachments:stats.brokenAttachments,missingOriginals:stats.missingOriginals}};
  // Do not touch HTML or attachment files; publish last, after all shards exist.
  await C.write(root,C.PREVIOUS,C.wrap(previous));
  await C.write(root,C.MANIFEST,C.wrap(next));
  stats.committed=true;notify();
  return {...stats,interrupted:false};
 }finally{if(lock.lockWriter)await lock.lockWriter.close();}
}
g.ArchiveReindex={scan,fromHtml,rebuild,safeAttachmentHref};
})(globalThis);
