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
async function evaluate(source,viewerDir){
 const text=await (await source.handle.getFile()).text();
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
async function refresh(root,{signal,onProgress=()=>{},write=false}={}){
 const lock=write?new C.Importer(root):null;
 if(lock)await lock.lock();
 const stats={scanned:0,eligible:0,updated:0,current:0,unsupported:0,errors:0,interrupted:false};
 const paths=await C.catalogPaths(root);
 const notify=()=>onProgress({...stats});
 try{
  for await(const source of g.ArchiveReindex.scan(root)){
   if(signal?.aborted){stats.interrupted=true;break;}
   stats.scanned++;
   try{
    const file=await source.handle.getFile();
    if(file.size>128*1024*1024){stats.unsupported++;continue;}
    const result=await evaluate(source,paths.viewerDir);
    if(result.status==='eligible'){
     stats.eligible++;
     if(write){
      if(signal?.aborted){stats.interrupted=true;break;}
      await C.write(root,source.path,result.html);
      stats.updated++;
     }
    }else if(result.status==='current')stats.current++;
    else stats.unsupported++;
   }catch{stats.errors++;}
   if(stats.scanned%25===0){notify();await new Promise(r=>setTimeout(r,0));}
  }
  notify();return stats;
 }finally{if(lock?.lockWriter)await lock.lockWriter.close();}
}
g.ArchiveReaderUpgrade={evaluate,refresh};
})(globalThis);
