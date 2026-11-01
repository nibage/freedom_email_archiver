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
function fromHtml(html,source,old){
 const t=document.createElement('template');t.innerHTML=html;
 const fragment=t.content,embedded=fragment.querySelector('#mail-archive-record[type="application/json"]');
 let r=null;
 if(embedded){
  try{const p=JSON.parse(embedded.textContent);if(p.schema===1&&p.record&&typeof p.record==='object')r=p.record;}catch{}
 }
 // Previously published HTML files predate the embedded data. Prefer surviving catalog
 // metadata, then recover the visible header fields if the catalog has been lost.
 const values={};
 const dl=fragment.querySelector('header dl');
 if(dl){for(const dt of dl.querySelectorAll('dt')){const dd=dt.nextElementSibling;if(dd?.tagName==='DD')values[dt.textContent.trim().toLowerCase()]=dd.textContent.trim();}}
 if(!r)r=old||{};
 const text=fragment.querySelector('main')?.textContent||'';
 const attLinks=Array.from(fragment.querySelectorAll('section ul li')).map(li=>{
  const a=li.querySelector('a[href]');return a&&safeAttachmentHref(a.getAttribute('href'))?{name:a.textContent.trim(),href:a.getAttribute('href'),size:0,type:'application/octet-stream'}:null;
 }).filter(Boolean);
 const metadataDate=(r.date||values.date||'');
 const validDate=metadataDate&&Number.isFinite(Date.parse(metadataDate))&&!/^Unknown/i.test(metadataDate);
 const iso=validDate?new Date(metadataDate).toISOString():null;
 const attachments=Array.isArray(r.attachments)?r.attachments.filter(a=>a&&safeAttachmentHref(a.href)).map(a=>({name:String(a.name||''),href:a.href,size:Number(a.size)||0,type:String(a.type||''),quarantined:!!a.quarantined,sha256:a.sha256||'',contentId:a.contentId||'',preview:safeAttachmentHref(a.preview)?a.preview:undefined})):attLinks;
 const record={
  id:source.id,account:source.account,folder:source.folder,path:source.path,
  fingerprint:r.fingerprint||null,messageId:String(r.messageId||values['message-id']||''),
  subject:String(r.subject||fragment.querySelector('header h1')?.textContent||''),
  from:String(r.from||values.from||''),to:String(r.to||values.to||''),
  cc:String(r.cc||values.cc||''),bcc:String(r.bcc||values.bcc||''),
  date:iso,day:iso?.slice(0,10)||'',rawDate:r.rawDate||values.date||'',
  labels:Array.isArray(r.labels)?r.labels:values.labels?values.labels.split(',').map(x=>x.trim()).filter(Boolean):[],
  attachments,bytes:Number(r.bytes)||0,
  mime:r.mime&&typeof r.mime==='object'?r.mime:{note:'Original MIME data was not embedded by the earlier importer'}
 };
 return {record,text:C.fold(text)};
}
async function legacyRecords(root){
 const map=new Map();
 try{
  const m=await C.manifest(root);
  for(const seg of m.segments){
   try{
    const data=C.unwrap(await C.read(root,seg.meta));
    if(data.kind==='metadata')for(const r of data.records)if(r&&r.account&&r.id)map.set(r.account+'/'+r.id,r);
   }catch{/* Keep rebuilding even if one old metadata segment was lost. */}
  }
 }catch{/* No readable legacy manifest. */}
 return map;
}
async function rebuild(root,{signal,onProgress=()=>{},batchSize=100}={}){
 const lock=new C.Importer(root);
 await lock.lock();
 const stats={scanned:0,indexed:0,duplicates:0,errors:0,brokenAttachments:0,segments:0,committed:false};
 const notify=()=>onProgress({...stats});
 try{
  let previous;
  try{previous=await C.manifest(root);}catch{previous=C.empty();}
  const old=await legacyRecords(root),seen=new Set(),segments=[],accounts=new Set();
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
    const {record,text}=fromHtml(page,source,old.get(key));
    for(const a of record.attachments){
     try{if(!await C.exists(root,source.folder+'/'+decodeURIComponent(a.href)))stats.brokenAttachments++;}
     catch{stats.brokenAttachments++;}
    }
    batch.push(record);search.push({key,text});accounts.add(source.account);stats.indexed++;
    if(batch.length>=batchSize)await flush();
   }catch{stats.errors++;}
   if(stats.scanned%25===0){notify();await new Promise(resolve=>setTimeout(resolve,0));}
  }
  if(signal?.aborted)return {...stats,interrupted:true};
  await flush();
  const next={kind:'manifest',format:C.VERSION,generation:(previous.generation||0)+1,
   created:previous.created||new Date().toISOString(),updated:new Date().toISOString(),
   accounts:[...accounts].sort(),segments,total:stats.indexed,rebuild:{scanned:stats.scanned,errors:stats.errors,brokenAttachments:stats.brokenAttachments}};
  // Do not touch HTML or attachment files; publish last, after all shards exist.
  await C.write(root,C.PREVIOUS,C.wrap(previous));
  await C.write(root,C.MANIFEST,C.wrap(next));
  stats.committed=true;notify();
  return {...stats,interrupted:false};
 }finally{if(lock.lockWriter)await lock.lockWriter.close();}
}
g.ArchiveReindex={scan,fromHtml,rebuild,safeAttachmentHref};
})(globalThis);
