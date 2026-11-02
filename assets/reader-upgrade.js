/* Optional one-time upgrade of legacy standalone HTML reader controls.
   Does not change decoded email body, attachments, original EML or search catalogs. */
(function(g){'use strict';
const C=g.ArchiveCore;
const MAX_PAGE=128*1024*1024;
async function run(root,{signal,onProgress=()=>{},write=false}={}){
 const stats={scanned:0,eligible:0,updated:0,current:0,noRemote:0,unsupported:0,errors:0,interrupted:false};
 const notify=()=>onProgress({...stats});
 let lock=null;
 if(write){lock=new C.Importer(root);await lock.lock();}
 try{
  for await(const source of g.ArchiveReindex.scan(root)){
   if(signal?.aborted){stats.interrupted=true;break;}
   stats.scanned++;
   try{
    const file=await source.handle.getFile();
    if(file.size>MAX_PAGE){stats.unsupported++;continue;}
    const old=await file.text();
    const result=await g.MailRenderer.upgradeHtmlPage(old);
    if(result.status==='updated'){
     stats.eligible++;
     if(write){
      if(signal?.aborted){stats.interrupted=true;break;}
      await C.write(root,source.path,result.html);
      stats.updated++;
     }
    }else if(result.status==='current')stats.current++;
    else if(result.status==='no-remote')stats.noRemote++;
    else stats.unsupported++;
   }catch{stats.errors++;}
   if(stats.scanned%10===0){notify();await new Promise(resolve=>setTimeout(resolve,0));}
  }
 }finally{if(lock?.lockWriter)await lock.lockWriter.close();}
 notify();
 return stats;
}
g.ArchiveReaderUpgrade={run};
})(globalThis);
