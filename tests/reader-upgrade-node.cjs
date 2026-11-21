/* Offline tests for upgrading only verified older standalone email viewer shells.
   Synthetic metadata and HTML; no private messages. */
'use strict';
const assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const crypto=require('node:crypto');
const rootDir=path.join(__dirname,'..');
const globals={ArchiveEML:{safeOriginal:()=>false},crypto:crypto.webcrypto,TextEncoder,btoa:s=>Buffer.from(s,'binary').toString('base64')};
const mailSource=fs.readFileSync(path.join(rootDir,'assets/mail-renderer.js'),'utf8');
vm.runInNewContext(mailSource,globals,{filename:'assets/mail-renderer.js'});
const currentScript=/<script>([\s\S]*?)<\/script>/.exec(globals.MailRenderer.documentHTML({
 id:'a'.repeat(64),account:'personal',path:'personal/2025/2025-01/email-'+ 'a'.repeat(64)+'.html',
 folder:'personal/2025/2025-01',subject:'Fictional subject',labels:[],attachments:[],date:null,rawDate:'',
 from:'a@example.invalid',to:'b@example.invalid',cc:'',bcc:'',messageId:'',renderVersion:2
},'<div class="mail-content">Fictional content</div>',[],'../../../__email_archiver/'))[1];
const latestHash=crypto.createHash('sha256').update(currentScript).digest('base64');
const olderScript=String.raw`(()=>{'use strict';const u=new URLSearchParams(location.search);const button=document.getElementById('loadRemoteImages');const load=()=>{document.querySelectorAll('.mail-content img[data-remote-src]').forEach(img=>{const src=img.getAttribute('data-remote-src');if(src&&/^https?:\/\//i.test(src)){img.setAttribute('src',src);img.removeAttribute('data-remote-src');}});button?.remove();};button?.addEventListener('click',load);if(u.get('images')==='auto')load();const back=document.getElementById('backToArchive');if(back&&u.get('fromArchive')==='1')back.addEventListener('click',e=>{if(history.length>1){e.preventDefault();history.back();}});})();`;
const olderHash=crypto.createHash('sha256').update(olderScript).digest('base64');
assert.equal(latestHash,'7t/H/h9ZP4XQdAlrAQ/zqlDHz4FGcNes/FoUt9JHOoM=');
assert.equal(olderHash,'plh17SbUCiDkNbQcdgw9tWwZBAWhfuVQuyH4/S9O9WM=');
const id='a'.repeat(64),folder='personal/2025/2025-01',messagePath=folder+'/email-'+id+'.html';
const meta={id,account:'personal',path:messagePath,folder,renderVersion:2,subject:'Example with image',date:null,rawDate:'',
 from:'sender@example.invalid',to:'reader@example.invalid',cc:'',bcc:'',labels:[],attachments:[],messageId:''};
const body='<div class="mail-content"><p style="color:red">Original message preserved</p><img data-remote-src="https://example.invalid/tracking" alt="test"></div>';
const page=globals.MailRenderer.documentHTML(meta,body,[],'../../../__email_archiver/');
const oldPage=page.replace('<script>'+currentScript+'</script>','<script>'+olderScript+'</script>')
 .replace('sha256-'+latestHash,'sha256-'+olderHash).replace('"renderVersion":2','"renderVersion":1');
const makePageFor=id=>globals.MailRenderer.documentHTML({...meta,id,path:folder+'/email-'+id+'.html'},body,[],'../../../__email_archiver/');
const currentPageB=makePageFor('b'.repeat(64));
const plainId='d'.repeat(64),plainPath=folder+'/email-'+plainId+'.html';
const oldPlain=makePageFor(plainId).replace('<script>'+currentScript+'</script>','')
 .replace('a{color:var(--accent)}','a{color:#0d6b67}')
 .replace('id="backToArchive" ','').replace('← Back to archive','← Email Archive');
const plainSource={account:'personal',folder,id:plainId,path:plainPath,
 handle:{async getFile(){return {size:oldPlain.length,async text(){return oldPlain;}}}}};
const unknownPageC=makePageFor('c'.repeat(64)).replace(currentScript,'alert(1)');
const pages=new Map([[messagePath,oldPage],[folder+'/email-'+'b'.repeat(64)+'.html',currentPageB],
 [folder+'/email-'+'c'.repeat(64)+'.html',unknownPageC]]);
const files=[...pages.keys()].map(p=>({account:'personal',folder,id:path.basename(p).slice(6,70),path:p,
 handle:{async getFile(){return {size:pages.get(p).length,async text(){return pages.get(p);}}}}}));
const writes=[];
const C={
 Importer:class{async lock(){this.lockWriter={close:async()=>{}};}},
 async catalogPaths(){return {viewerDir:'__email_archiver/'};},
 async write(root,p,text){writes.push(p);pages.set(p,text);}
};
globals.ArchiveCore=C;
globals.ArchiveReindex={
 async *scan(){for(const f of files)yield f;},
 fromHtml(html,source){
  const match=/<script id="mail-archive-record" type="application\/json">([\s\S]*?)<\/script>/.exec(html);
  if(!match)throw Error('INVALID_METADATA');
  const data=JSON.parse(match[1]);
  assert.equal(data.record.id,source.id);assert.equal(data.record.path,source.path);
  return {record:data.record,legacy:false};
 }
};
const upgrader=fs.readFileSync(path.join(rootDir,'assets/reader-upgrade.js'),'utf8');
vm.runInNewContext(upgrader, {globalThis:globals,crypto:crypto.webcrypto,TextEncoder,btoa:bytes=>Buffer.from(bytes,'binary').toString('base64'),setTimeout},{filename:'assets/reader-upgrade.js'});
(async()=>{
 assert.equal((await globals.ArchiveReaderUpgrade.evaluate(plainSource,'__email_archiver/')).status,'eligible','Recognized old pages without image scripts must also be theme-upgradable');
 const preview=await globals.ArchiveReaderUpgrade.refresh({}, {});
 assert.equal(preview.scanned,3);assert.equal(preview.eligible,1);assert.equal(preview.current,1);assert.equal(preview.unsupported,1);
 assert.equal(writes.length,0,'Preview must never change saved HTML');
 const updated=await globals.ArchiveReaderUpgrade.refresh({}, {write:true});
 assert.equal(updated.updated,1);assert.deepEqual(writes,[messagePath]);
 const after=pages.get(messagePath);
 assert.equal(/<main>([\s\S]*?)<\/main>/.exec(after)[1],body,'Original HTML mail body bytes must remain unchanged');
 assert(after.includes('--accent:#6c2943')&&after.includes('--accent:#f5a623'),'Updated shell must support burgundy and orange modes');
 assert(after.includes('sha256-'+latestHash),'Current CSP script hash must be preserved');
 assert.equal((await globals.ArchiveReaderUpgrade.refresh({},{})).eligible,0,'Rerun must be idempotent');
 const stopped=new AbortController();stopped.abort();
 assert.equal((await globals.ArchiveReaderUpgrade.refresh({},{signal:stopped.signal,write:true})).interrupted,true);
 assert.equal(writes.length,1,'Cancelled operation must not write another email');
 // A synced drive may leave createWritable({mode:'exclusive'}) unresolved.
 // The updater must stop cleanly with a useful error and close late locks.
 const OriginalImporter=C.Importer;
 let unlock,lateCloseCount=0,updates=[];
 C.Importer=class{
  async lock(){await new Promise(resolve=>{unlock=()=>{
   this.lockWriter={close:async()=>{lateCloseCount++;}};
   resolve();
  };});}
 };
 try{
  await assert.rejects(
   ()=>globals.ArchiveReaderUpgrade.refresh({},{
    write:true,lockTimeoutMs:20,onProgress:x=>updates.push(x)
   }),e=>e.message==='ARCHIVE_LOCK_TIMEOUT');
  assert(updates.some(x=>x.phase==='counting'&&x.counted>=1),
   'Counting progress should be visible before waiting for the writer lock');
  assert(updates.some(x=>x.phase==='waiting-lock'),
   'The UI must distinguish lock wait from a frozen HTML scan');
  unlock();await new Promise(resolve=>setTimeout(resolve,0));
  assert.equal(lateCloseCount,1,'A late successful lock must be released after timeout');
  const stopped=new AbortController();
  const aborting=globals.ArchiveReaderUpgrade.refresh({},{
   write:true,signal:stopped.signal,lockTimeoutMs:1000
  });
  await new Promise(resolve=>setTimeout(resolve,0));
  stopped.abort();
  const cancelledLock=await aborting;
  assert.equal(cancelledLock.interrupted,true,'Cancel must work during a pending lock');
  unlock();await new Promise(resolve=>setTimeout(resolve,0));
  assert.equal(lateCloseCount,2,'A late lock after cancellation must also close');
 }finally{C.Importer=OriginalImporter;}

 console.log('PASS: old email navigation shell updated without MBOX, body unchanged');
 console.log('PASS: current emails and unknown scripts skipped, preview read-only, cancellation safe');
 console.log('PASS: timed-out and cancelled exclusive locks report progress and close late writers');
})().catch(e=>{console.error(e);process.exitCode=1;});
