/* Trusted archive HTML shell refresh, independent of MBOX and catalog rebuild.
   Never execute saved email HTML; leave the sender-controlled <main> bytes unchanged. */
(function(g){'use strict';
const C=g.ArchiveCore;
const currentVersion=g.MailRenderer.RENDER_VERSION;
const knownHashes=new Set([
 'ONdzB2Snb1KGFcLxYAyUoEX6twdM5pCy78sdYqecEqs=',
 'plh17SbUCiDkNbQcdgw9tWwZBAWhfuVQuyH4/S9O9WM=',
 '7t/H/h9ZP4XQdAlrAQ/zqlDHz4FGcNes/FoUt9JHOoM='
]);
async function evaluate(source,viewerDir,providedText){
 const text=typeof providedText==='string'?providedText:await (await source.handle.getFile()).text();
 if(!text.startsWith('<!doctype html><html lang="en">')||!text.includes('id="mail-archive-record"'))return {status:'unsupported'};
 const active=[...text.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/gi)]
  .filter(m=>!/\btype\s*=\s*["']application\/json["']/i.test(m[1]));
 // Older generated pages without external images did not always include an active reader script.
 // Only allow that form if its known legacy CSS and Back link are present.
 const plainLegacy=active.length===0&&text.includes('a{color:#0d6b67}')&&
  text.includes('<header><a href=')&&text.includes('← Email Archive');
 if(active.length!==1&&!plainLegacy)return {status:'unsupported'};
 let hash=null;
 if(active.length){
  const bytes=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(active[0][2])));
  hash=btoa(String.fromCharCode(...bytes));
  if(!knownHashes.has(hash)||!text.includes('script-src &#39;sha256-'+hash+'&#39;'))return {status:'unsupported'};
 }
 const main=text.indexOf('<main>'),end=text.indexOf('</main>',main+6);
 if(main<0||end<0||text.indexOf('<main>',main+1)!==-1)return {status:'unsupported'};
 // A modern page with a known signed script and current shell needs no rewriting.
 // Its embedded record is checked directly, avoiding costly DOM parsing on every
 // already-current email in a large archive.
 if(hash==='7t/H/h9ZP4XQdAlrAQ/zqlDHz4FGcNes/FoUt9JHOoM='&&text.includes('--accent:#6c2943')){
  const metadata=/<script id="mail-archive-record" type="application\/json">([\s\S]*?)<\/script>/.exec(text);
  if(metadata){
   try{
    const embedded=JSON.parse(metadata[1]),r=embedded.record;
    if(embedded.schema===1&&r?.id===source.id&&r?.account===source.account&&
       r?.folder===source.folder&&r?.path===source.path&&
       Number(r.renderVersion)>=currentVersion)return {status:'current'};
   }catch{/* Validate the full record below or skip the page. */}
  }
 }
 const parsed=g.ArchiveReindex.fromHtml(text,source);
 if(parsed.legacy)return {status:'unsupported'};
 const meta=parsed.record;
 const current=Number(meta.renderVersion)>=currentVersion&&hash==='7t/H/h9ZP4XQdAlrAQ/zqlDHz4FGcNes/FoUt9JHOoM='&&text.includes('--accent:#6c2943');
 if(current)return {status:'current'};
 // Regenerate only the trusted outer reader frame. The main body bytes are not sanitized
 // again, changed, or interpreted as code. The page's CSP remains enforced.
 const path='../'.repeat(source.folder.split('/').length)+viewerDir;
 const updated=g.MailRenderer.documentHTML({...meta,renderVersion:currentVersion},text.slice(main+6,end),meta.attachments,path);
 return {status:'eligible',html:updated};
}
/* The browser's exclusive write lock can be delayed by synced drives or another
   browser tab. Never leave the UI spinning forever: abort/timeout the wait, and
   release a lock if the underlying file-system request resolves after cancellation. */
async function awaitWriteLock(lock,{signal,timeoutMs=30000}={}){
 if(signal?.aborted)throw Error('AbortError');
 let timer=null,abort=null;
 const pending=lock.lock();
 const stalled=new Promise((_,reject)=>{
  timer=setTimeout(()=>reject(Error('ARCHIVE_LOCK_TIMEOUT')),timeoutMs);
  if(signal){
   abort=()=>reject(Error('AbortError'));
   signal.addEventListener('abort',abort,{once:true});
   if(signal.aborted)abort();
  }
 });
 try{await Promise.race([pending,stalled]);}
 catch(e){
  // A late successful createWritable must not keep a hidden lock open.
  void pending.then(async()=>{if(lock.lockWriter){const w=lock.lockWriter;lock.lockWriter=null;await w.close();}}).catch(()=>{});
  throw e;
 }finally{
  clearTimeout(timer);
  if(signal&&abort)signal.removeEventListener('abort',abort);
 }
}
async function refresh(root,{signal,onProgress=()=>{},write=false,lockTimeoutMs=30000}={}){
 const stats={phase:'preparing',counted:0,scanned:0,total:null,
  eligible:0,updated:0,current:0,unsupported:0,errors:0,interrupted:false};
 const notify=()=>onProgress({...stats});
 const lock=write?new C.Importer(root):null;
 let acquired=false;
 notify();
 try{
  // A catalog count is only an estimate; one directory traversal is enough.
  // No initial full enumeration, duplicate getFile() call or antivirus-triggering
  // write lock is needed when every saved HTML page is already current.
  const paths=await C.catalogPaths(root);
  try{
   const m=await C.manifest(root);
   if(Number.isSafeInteger(m.total)&&m.total>0)stats.total=m.total;
  }catch{/* Missing catalog: scan remains valid with an indeterminate total. */}
  stats.phase='reading';notify();
  for await(const source of g.ArchiveReindex.scan(root)){
   if(signal?.aborted){stats.interrupted=true;break;}
   stats.scanned++;stats.counted=stats.scanned;
   if(stats.scanned<=5||stats.scanned%10===0)notify();
   try{
    const file=await source.handle.getFile();
    if(file.size>128*1024*1024){stats.unsupported++;continue;}
    const result=await evaluate(source,paths.linkBackDir||paths.viewerDir,await file.text());
    if(result.status==='eligible'){
     stats.eligible++;
     if(write){
      if(signal?.aborted){stats.interrupted=true;break;}
      if(!acquired){
       stats.phase='waiting-lock';notify();
       try{await awaitWriteLock(lock,{signal,timeoutMs:lockTimeoutMs});acquired=true;}
       catch(e){
        if(signal?.aborted||e.message==='AbortError'){
         stats.interrupted=true;stats.phase='stopped';notify();return stats;
        }
        throw e;
       }
      }
      stats.phase='writing';notify();
      await C.write(root,source.path,result.html);
      stats.updated++;
      stats.phase='reading';
     }
    }else if(result.status==='current')stats.current++;
    else stats.unsupported++;
   }catch(e){
    // Permission/Defender or writer-lock failures are not per-message format
    // errors. Stop immediately rather than retrying a blocked write for every
    // email (which can trigger repeated Windows security notifications).
    if(e.message==='ARCHIVE_LOCK_TIMEOUT'||e.message==='LOCKED'||
       stats.phase==='writing'||stats.phase==='waiting-lock')throw e;
    stats.errors++;
   }
   if(stats.scanned<=5||stats.scanned%10===0){
    notify();await new Promise(r=>setTimeout(r,0));
   }
  }
  stats.phase=stats.interrupted?'stopped':'complete';
  if(!stats.interrupted)stats.total=stats.scanned;
  notify();return stats;
 }finally{
  if(acquired&&lock?.lockWriter){
   const writer=lock.lockWriter;lock.lockWriter=null;
   await writer.close();
  }
 }
}
g.ArchiveReaderUpgrade={evaluate,refresh};
})(globalThis);
