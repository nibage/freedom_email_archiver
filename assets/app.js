(function(){'use strict';
const C=ArchiveCore,$=id=>document.getElementById(id);let pending=null;
window.MailArchive={receive:data=>{if(pending)pending(data);}};
function loadScript(src){return new Promise((resolve,reject)=>{const s=document.createElement('script');let result;pending=x=>result=x;s.src=src;s.onload=()=>{pending=null;s.remove();result?resolve(result):reject(Error('CATALOG'));};s.onerror=()=>{pending=null;s.remove();reject(Error('CATALOG'));};document.head.append(s);});}
let catalog,records=new Map(),all=[],matches=[],currentPage=0,queryVersion=0,root=null,controller=null,busy=false,cache=new Map(),chain=Promise.resolve();
const nestedViewer=/(?:^|\/)__email_archiver\/index\.html$/i.test(decodeURIComponent(location.pathname));
const localUrl=p=>(nestedViewer?'../':'')+p;
const returnKey='email-archive-return:'+location.pathname,imagesKey='email-archive-images:'+location.pathname;
let remembered=null;
try{const stored=sessionStorage.getItem(returnKey);if(stored){remembered=JSON.parse(stored);sessionStorage.removeItem(returnKey);}}catch{/* Session storage may be unavailable on file://. */}
try{const saved=sessionStorage.getItem(imagesKey);if(saved!==null)$('autoImages').checked=saved==='on';}catch{/* Default to checked. */}
$('autoImages').addEventListener('change',()=>{try{sessionStorage.setItem(imagesKey,$('autoImages').checked?'on':'off');}catch{}render();});
function saveReturnPosition(){
 const inputs=['query','accountFilter','labelFilter','dateFrom','dateTo','attachmentFilter','pageSize'];
 const values=Object.fromEntries(inputs.map(id=>[id,$(id).value]));
 try{sessionStorage.setItem(returnKey,JSON.stringify({values,page:currentPage,scrollY:window.scrollY,when:Date.now()}));}catch{}
}
function restoreReturnPosition(){
 if(!remembered)return;
 const old=remembered;remembered=null;
 if(!Number.isFinite(old.when)||Date.now()-old.when>30*60*1000)return;
 currentPage=Math.max(0,Number(old.page)||0);
 render();
 const y=Math.max(0,Number(old.scrollY)||0);
 requestAnimationFrame(()=>window.scrollTo(0,y));
}
window.addEventListener('pageshow',event=>{if(event.persisted){try{sessionStorage.removeItem(returnKey);}catch{}}});
// Browse always reads the catalog beside this index.html, never from an import/repair target.
function load(src){const p=chain.then(()=>loadScript(localUrl(src)));chain=p.catch(()=>{});return p;}
function notice(s){$('notice').textContent=s;$('notice').hidden=!s;}
function options(id,items,first){const el=$(id),old=el.value;el.replaceChildren(new Option(first,''));for(const s of items)el.add(new Option(s,s));if(items.includes(old))el.value=old;}
async function readCatalog(){
 let last;catalog=null;
 for(const src of [C.MANIFEST,C.PREVIOUS,'assets/catalog/archive.js','assets/catalog/archive.previous.js','archive.js','archive.previous.js']){
  try{const result=await load(src+'?g='+Date.now());if(result?.format!==C.VERSION)throw Error('FORMAT');catalog=result;break;}catch(e){last=e;}
 }
 if(!catalog)throw last||Error('CATALOG');
 records.clear();cache.clear();for(const seg of catalog.segments){const m=await load(seg.meta);for(const r of m.records)records.set(r.account+'/'+r.id,r);}all=[...records.values()].sort((a,b)=>(b.date||'').localeCompare(a.date||'')||a.id.localeCompare(b.id));$('total').textContent=all.length.toLocaleString('en-GB');options('accountFilter',catalog.accounts,'All accounts');options('labelFilter',[...new Set(all.flatMap(r=>r.labels))].sort(),'All labels');$('accounts').replaceChildren(...catalog.accounts.map(a=>new Option(a)));
 if(remembered&&remembered.values&&Number.isFinite(remembered.when)&&Date.now()-remembered.when<=30*60*1000){
  for(const [id,value] of Object.entries(remembered.values)){
   if(['query','accountFilter','labelFilter','dateFrom','dateTo','attachmentFilter','pageSize'].includes(id)&&typeof value==='string')$(id).value=value;
  }
 }
 await search();restoreReturnPosition();
}
function metadataText(r){return C.fold([r.subject,r.from,r.to,r.cc,r.bcc].join(' '));}
async function search(){const v=++queryVersion;currentPage=0;const terms=C.fold($('query').value).split(/\s+/).filter(Boolean);const acc=$('accountFilter').value,lab=$('labelFilter').value,from=$('dateFrom').value,to=$('dateTo').value,attach=$('attachmentFilter').value;const candidates=all.filter(r=>(!acc||r.account===acc)&&(!lab||r.labels.includes(lab))&&(!from||r.day&&r.day>=from)&&(!to||r.day&&r.day<=to)&&(!attach||(attach==='yes')===!!r.attachments.length));
 if(!terms.length){matches=candidates;render();return;}const wanted=new Map(),found=new Set();for(const r of candidates){const key=r.account+'/'+r.id,meta=metadataText(r);if(terms.every(t=>meta.includes(t)))found.add(key);else wanted.set(key,meta);}
 $('resultInfo').textContent='Searching local text indexes…';let done=0;for(const seg of catalog.segments){if(v!==queryVersion)return;if(!seg.search)continue;let data=cache.get(seg.search);if(!data){data=await load(seg.search);cache.set(seg.search,data);if(cache.size>4)cache.delete(cache.keys().next().value);}for(const x of data.records){const meta=wanted.get(x.key);if(meta!==undefined){const hay=meta+' '+C.fold(x.text);if(terms.every(t=>hay.includes(t)))found.add(x.key);}}done++;if(done%5===0){$('resultInfo').textContent='Searched '+done+' indexes…';await new Promise(r=>setTimeout(r,0));}}
 if(v!==queryVersion)return;matches=candidates.filter(r=>found.has(r.account+'/'+r.id));render();}
function render(){const size=+$('pageSize').value,pages=Math.max(1,Math.ceil(matches.length/size));currentPage=Math.min(currentPage,pages-1);$('rows').replaceChildren();for(const r of matches.slice(currentPage*size,(currentPage+1)*size)){const tr=document.createElement('tr');const tdDate=document.createElement('td');tdDate.className='date';tdDate.textContent=r.date?new Date(r.date).toLocaleString('en-GB',{dateStyle:'medium',timeStyle:'short'}):'Unknown date';const tdAddr=document.createElement('td');tdAddr.textContent=r.from||'(Not specified)';const to=document.createElement('span');to.className='address';to.textContent='To: '+(r.to||'—');tdAddr.append(to);const tdSub=document.createElement('td');const a=document.createElement('a');a.className='subject';a.textContent=r.subject||'(No subject)';a.href=localUrl(r.path.split('/').map(encodeURIComponent).join('/'))+'?fromArchive=1&images='+($('autoImages').checked?'auto':'manual');a.target='_self';a.addEventListener('click',e=>{if(e.button===0&&!e.ctrlKey&&!e.metaKey&&!e.shiftKey&&!e.altKey)saveReturnPosition();});tdSub.append(a);for(const text of [r.account,...r.labels]){const s=document.createElement('span');s.className='badge';s.textContent=text;tdSub.append(s);}const tdAtt=document.createElement('td');tdAtt.textContent=(r.attachments.length?'⌕ '+r.attachments.length:'—')+(r.original?' · EML':'');tr.append(tdDate,tdAddr,tdSub,tdAtt);$('rows').append(tr);}$('empty').hidden=!!matches.length;$('resultInfo').textContent=matches.length.toLocaleString('en-GB')+' messages'+(matches.length!==all.length?' of '+all.length.toLocaleString('en-GB'):'');$('pageInfo').textContent=(currentPage+1)+' / '+pages;$('prev').disabled=currentPage===0;$('next').disabled=currentPage>=pages-1;}
let timer;for(const id of ['query','accountFilter','labelFilter','dateFrom','dateTo','attachmentFilter'])$(id).addEventListener('input',()=>{clearTimeout(timer);timer=setTimeout(()=>search().catch(showError),200);});$('pageSize').onchange=render;$('prev').onclick=()=>{currentPage--;render();};$('next').onclick=()=>{currentPage++;render();};$('reset').onclick=()=>{for(const id of ['query','accountFilter','labelFilter','dateFrom','dateTo','attachmentFilter'])$(id).value='';search().catch(showError);};
function tab(which){
 $('browse').hidden=which!=='browse';
 $('import').hidden=which!=='import';
 for(const id of ['browse','import'])$(id+'Tab').classList.toggle('active',id===which);
}
$('browseTab').onclick=()=>tab('browse');
$('importTab').onclick=()=>tab('import');
function ready(){$('start').disabled=busy||repairBusy||readerBusy||!root||!$('files').files.length;}
let recentRoot=null,selectionVersion=0,accountTouched=false,readerBusy=false,readerPreview=0,readerController=null;
function recentDB(){
 return new Promise((resolve,reject)=>{
  let request;try{request=indexedDB.open('offline-email-archiver-folders',1);}catch(e){reject(e);return;}
  request.onupgradeneeded=()=>request.result.createObjectStore('recent');
  request.onsuccess=()=>resolve(request.result);
  request.onerror=()=>reject(request.error);
 });
}
function dbGet(db,key){
 return new Promise((resolve,reject)=>{
  const request=db.transaction('recent','readonly').objectStore('recent').get(key);
  request.onsuccess=()=>resolve(request.result);
  request.onerror=()=>reject(request.error);
 });
}
async function rememberAccount(value){
 try{C.accountName(value);}catch{return;}
 let db;
 try{
  db=await recentDB();
  await new Promise((resolve,reject)=>{
   const transaction=db.transaction('recent','readwrite');
   transaction.oncomplete=resolve;transaction.onerror=()=>reject(transaction.error);
   transaction.objectStore('recent').put(value,'lastAccount');
  });
 }catch{/* Browser profile storage may be disabled for local files. */}
 finally{db?.close();}
}
$('importAccount').addEventListener('input',()=>{accountTouched=true;});
$('importAccount').addEventListener('change',()=>{void rememberAccount($('importAccount').value.trim());});
function rootPathLabel(handle){return handle?.name?handle.name+'/':'(none)';}
async function updateRootInfo(handle,{recent=false}={}){
 if(!handle){
  $('dirInfo').textContent='No archive folder selected. Click Import folder root to choose one.';
  $('reindexDirInfo').textContent='No repair target. Choose an archive root above.';
  return;
 }
 const name=rootPathLabel(handle);
 // Show the target immediately; an asynchronous permission/catalog check enriches it later.
 $('dirInfo').textContent='Selected root: '+name+(recent?' (remembered)':'')+' · Checking available catalog information… · Full device path unavailable to this browser.';
 $('reindexDirInfo').textContent='Repair target: '+name+' — the same folder selected above. Preview before rebuilding.';
 let detail='Access will be checked when you start importing or preview a repair.';
 try{
  const permission=typeof handle.queryPermission==='function'?await handle.queryPermission({mode:'readwrite'}):'granted';
  if(permission==='granted'){
   const m=await C.manifest(handle);
   const paths=await C.catalogPaths(handle);
   detail=m.total.toLocaleString('en-GB')+' indexed messages · viewer: '+name+paths.viewerDir+'index.html';
  }
 }catch{detail='Could not inspect this folder yet; choose it again if access was revoked.';}
 // An older asynchronous inspection cannot overwrite a newly selected target.
 if(root!==handle)return;
 $('dirInfo').textContent='Selected root: '+name+(recent?' (remembered)':'')+' · '+detail+' · Full device path unavailable to this browser.';
 $('reindexDirInfo').textContent='Repair target: '+name+' — the same folder selected above. Preview before rebuilding.';
}
function setRoot(handle,{recent=false}={}){
 root=handle;repairPreview=0;readerPreview=0;
 $('previewReaders').disabled=!handle||busy||repairBusy||readerBusy;
 $('upgradeReaders').disabled=true;
 $('readerStatus').textContent=handle?'Selected '+rootPathLabel(handle)+'. Preview reader updates before changing saved HTML.':'Choose the archive root above.';
 $('previewReindex').disabled=!handle||busy||repairBusy||readerBusy;
 $('startReindex').disabled=true;
 $('reindexStatus').textContent=handle?'Folder selected. Preview this root before rebuilding its catalog.':'Select an archive root above.';
 void updateRootInfo(handle,{recent});
 ready();
}
async function loadRecent(){
 const before=selectionVersion;
 let db;
 try{
  db=await recentDB();
  const [handle,account]=await Promise.all([dbGet(db,'last'),dbGet(db,'lastAccount')]);
  if(typeof account==='string'&&!accountTouched){
   try{$('importAccount').value=C.accountName(account);}catch{/* Ignore stale invalid values. */}
  }
  if(handle?.kind==='directory'&&before===selectionVersion&&!root){
   recentRoot=handle;
   setRoot(handle,{recent:true});
  }else if(handle?.kind==='directory'&&before===selectionVersion)recentRoot=handle;
 }catch{/* Recent folder and account storage are optional. */}
 finally{db?.close();if(!root)void updateRootInfo(null);}
}
async function rememberRecent(handle){
 recentRoot=handle;
 let db;
 try{
  db=await recentDB();
  await new Promise((resolve,reject)=>{
   const transaction=db.transaction('recent','readwrite');
   transaction.oncomplete=resolve;transaction.onerror=()=>reject(transaction.error);
   transaction.objectStore('recent').put(handle,'last');
  });
 }catch{/* The folder is still selected for this session. */}
 finally{db?.close();}
}
async function allowRoot(handle){
 if(!handle)throw Error('RECENT_ACCESS');
 if(typeof handle.queryPermission!=='function')return;
 if(await handle.queryPermission({mode:'readwrite'})==='granted')return;
 if(typeof handle.requestPermission==='function'&&await handle.requestPermission({mode:'readwrite'})==='granted')return;
 throw Error('RECENT_ACCESS');
}
function pickRoot(){
 if(!window.showDirectoryPicker)throw Error('BROWSER');
 const options={mode:'readwrite',id:'mailarchive'};
 if(recentRoot)options.startIn=recentRoot;
 return showDirectoryPicker(options);
}
$('chooseDir').onclick=async()=>{
 if(busy||repairBusy||readerBusy)return;
 try{
  const chosen=await pickRoot();
  if(chosen.name==='__email_archiver'&&await C.exists(chosen,'index.html'))throw Error('APP_SUBFOLDER');
  selectionVersion++;
  setRoot(chosen);
  void rememberRecent(chosen);
 }catch(e){if(e.name!=='AbortError')showError(e);}
};
void loadRecent();

$('files').onchange=()=>{const files=Array.from($('files').files);$('fileInfo').textContent=files.length+' files · '+(files.reduce((s,f)=>s+f.size,0)/1024**3).toFixed(2)+' GiB. Allow at least this space plus a reserve on the destination drive.';ready();};
async function install(dir){
 const legacy=await C.exists(dir,'index.html'),modern=await C.exists(dir,C.VIEWER_DIR+'index.html');
 if(legacy||modern){const html=await C.read(dir,modern?C.VIEWER_DIR+'index.html':'index.html');if(!html.includes('assets/core.js'))throw Error('NONARCHIVE');}
 const appDir=legacy&&!modern?'':C.VIEWER_DIR;
 for(const [p,t] of Object.entries(ArchiveBundle))await C.write(dir,appDir+p,t);
 await C.write(dir,appDir+'assets/bundle.js','globalThis.ArchiveBundle='+C.json(ArchiveBundle)+';');
 const paths=await C.catalogPaths(dir);
 if(!await C.exists(dir,paths.current)&&!await C.exists(dir,'archive.js')&&!await C.exists(dir,'assets/catalog/archive.js'))await C.write(dir,paths.current,C.wrap(C.empty()));
}
function progress(s){$('progress').value=s.totalBytes?Math.min(100,100*s.bytes/s.totalBytes):0;for(const [id,k] of [['readCount','read'],['newCount','new'],['dupeCount','duplicates'],['refreshedCount','refreshed'],['emlSavedCount','emlSaved'],['emlReusedCount','emlReused'],['errorCount','errors']])$(id).textContent=s[k].toLocaleString('en-GB');$('progressDetail').textContent=(s.bytes/1024**2).toFixed(1)+' / '+(s.totalBytes/1024**2).toFixed(1)+' MiB read · '+s.committed+' changes committed to the catalog';}
$('start').onclick=async()=>{if(busy||repairBusy||readerBusy)return;let acc;try{acc=C.accountName($('importAccount').value.trim());}catch(e){showError(e);return;}
 // Request access from the user's Start click (never silently at startup).
 try{await allowRoot(root);}catch(e){showError(e);return;}
 void rememberAccount(acc);
 busy=true;controller=new AbortController();$('progressPanel').hidden=false;$('stop').hidden=false;$('chooseDir').disabled=true;$('previewReindex').disabled=true;$('previewReaders').disabled=true;$('upgradeReaders').disabled=true;$('files').disabled=true;$('importAccount').disabled=true;$('refreshExisting').disabled=true;$('retainSignedEml').disabled=true;$('retainStarredEml').disabled=true;$('retainImportantEml').disabled=true;ready();notice('');$('status').textContent='Importing. Keep this tab open…';try{await install(root);const imp=new C.Importer(root,{signal:controller.signal,onProgress:progress,emlPolicy:{signed:$('retainSignedEml').checked,encrypted:$('retainSignedEml').checked,starred:$('retainStarredEml').checked,important:$('retainImportantEml').checked},refreshExisting:$('refreshExisting').checked});const report=await imp.run(Array.from($('files').files),acc);
const viewerPath=(await C.catalogPaths(root)).viewerDir+'index.html';
$('status').textContent=report.interrupted?'Import stopped safely. Earlier committed messages remain saved. Open '+viewerPath+' to test them.':'Import complete. Open '+viewerPath+' in the selected archive root.';
if(report.issues.length)notice('Some messages could not be imported. Source offsets and error codes are in '+acc+'/catalog/import-….json. Source files were not modified.');
// Refresh only the viewer open in this tab; do not browse via the selected directory handle.
try{await readCatalog();}catch{/* A different source viewer may not have a local catalog. */}
if(!report.issues.length)notice('Import saved to '+root.name+'. Open its own '+viewerPath+' to browse those messages. This tab continues to browse its original archive.');
}catch(e){
 if(controller.signal.aborted&&e.name==='AbortError'){
  $('status').textContent='Stop requested. Earlier committed messages remain saved; reopen the archive to check the count.';
  notice('A browser file operation was interrupted. Reimporting the same MBOX into the same account skips committed messages.');
 }else{
  $('status').textContent='Import interrupted. Previously committed batches remain saved; you can retry the same source.';
  showError(e);
 }
 try{await readCatalog();}catch{}
}finally{busy=false;$('stop').hidden=true;$('chooseDir').disabled=false;$('previewReindex').disabled=!root;$('previewReaders').disabled=!root;$('upgradeReaders').disabled=readerPreview===0;$('files').disabled=false;$('importAccount').disabled=false;$('refreshExisting').disabled=false;$('retainSignedEml').disabled=false;$('retainStarredEml').disabled=false;$('retainImportantEml').disabled=false;ready();}};
$('stop').onclick=()=>{controller?.abort();$('status').textContent='Finishing the current message and committing the catalog…';};
function showError(e){const msgs={APP_SUBFOLDER:'Choose the parent archive root, not its __email_archiver application subfolder.',RECENT_ACCESS:'Archive folder access is not available. Click Import folder root to select it again, then retry.',LOCKED:'Another import or catalog repair may already be writing to this folder. Close other archive tabs and retry.',ACCOUNT:'Enter a valid account folder name, such as personal.',BROWSER:'Import requires a current desktop Chrome or Edge with the File System Access API.',CATALOG:'The catalog could not be loaded. Check the folder is complete and retry importing from your backup.',FORMAT:'Unsupported or damaged catalog format.',NONARCHIVE:'The selected folder contains another index.html. Choose an empty folder or an archive created by this tool.',OLD_ARCHIVE_FORMAT:'This is an older archive layout. For testing, choose a new empty archive root and reimport the original MBOX. No automatic migration is performed.'};notice(msgs[e.message]||('Operation failed ('+e.name+'). Check permissions, free space and whether another tab is writing to the archive.'));}

let repairBusy=false,repairController=null,repairPreview=0;
$('previewReindex').onclick=async()=>{
 if(!root||repairBusy||busy||readerBusy)return;
 const target=root;
 // Permission is requested only from this explicit button action, not on page load.
 try{await allowRoot(target);}catch(e){showError(e);return;}
 repairBusy=true;$('previewReindex').disabled=true;$('startReindex').disabled=true;
 $('chooseDir').disabled=true;ready();$('reindexStatus').textContent='Scanning '+rootPathLabel(target)+' (read only)…';
 try{
  repairPreview=0;
  for await(const entry of ArchiveReindex.scan(target)){
   repairPreview++;
   if(repairPreview%200===0){$('reindexStatus').textContent=repairPreview+' message pages found…';await new Promise(resolve=>setTimeout(resolve,0));}
  }
  $('reindexStatus').textContent=repairPreview+' HTML message files found in '+rootPathLabel(target)+'. Rebuilding changes only its catalog, not its email HTML or attachments.';
  $('startReindex').disabled=repairPreview===0;
  void updateRootInfo(target);
 }catch(e){showError(e);}
 finally{repairBusy=false;$('previewReindex').disabled=false;$('chooseDir').disabled=false;ready();}
};
$('startReindex').onclick=async()=>{
 if(repairBusy||!root||!repairPreview||busy||readerBusy)return;
 const target=root;
 try{await allowRoot(target);}catch(e){showError(e);return;}
 repairBusy=true;repairController=new AbortController();$('startReindex').disabled=true;
 $('chooseDir').disabled=true;$('previewReindex').disabled=true;
 $('stopReindex').hidden=false;$('reindexStatus').textContent='Rebuilding catalog in '+rootPathLabel(target)+'. Leave this tab open…';
 ready();
 try{
  const stats=await ArchiveReindex.rebuild(target,{signal:repairController.signal,onProgress:s=>{
   $('reindexStatus').textContent=s.scanned+' HTML pages scanned · '+s.indexed+' indexed · '+s.errors+' errors · '+s.brokenAttachments+' missing attachments'+(s.committed?' · new catalog published':'');
  }});
  $('reindexStatus').textContent=stats.interrupted?'Stopped. The previous catalog is still active.':('Finished rebuilding '+rootPathLabel(target)+': '+stats.indexed+' messages indexed, '+stats.errors+' errors.');
  if(!stats.interrupted){
   // Browse remains attached to the viewer's own index.html.
   try{await readCatalog();}catch{}
   notice('Rebuilt only the catalog in '+rootPathLabel(target)+'. Open that archive’s own index.html to browse it.');
  }
 }catch(e){showError(e);$('reindexStatus').textContent='Rebuild failed. The previous catalog should still be available; check your archive backup.';}
 finally{repairBusy=false;$('chooseDir').disabled=false;$('previewReindex').disabled=false;$('startReindex').disabled=repairPreview===0;$('stopReindex').hidden=true;ready();}
};
$('stopReindex').onclick=()=>repairController?.abort();
function readerProgress(s){
 $('readerStatus').textContent=s.scanned+' HTML emails scanned · '+s.eligible+' older readers eligible · '+s.updated+' updated · '+s.current+' already current · '+s.unsupported+' unrecognized · '+s.errors+' read/write errors';
}
function readerControls(working){
 $('chooseDir').disabled=working;
 $('previewReaders').disabled=working||!root;
 $('upgradeReaders').disabled=working||readerPreview===0;
 $('previewReindex').disabled=working||!root;
 $('startReindex').disabled=working||!repairPreview;
 ready();
}
$('previewReaders').onclick=async()=>{
 if(!root||busy||repairBusy||readerBusy)return;
 const target=root;
 try{await allowRoot(target);}catch(e){showError(e);return;}
 readerBusy=true;readerPreview=0;readerController=new AbortController();readerControls(true);
 $('stopReaders').hidden=false;
 $('readerStatus').textContent='Previewing reader controls in '+rootPathLabel(target)+'…';
 try{
  const report=await ArchiveReaderUpgrade.run(target,{signal:readerController.signal,onProgress:readerProgress});
  readerPreview=report.interrupted||report.errors?0:report.eligible;
  $('readerStatus').textContent=report.scanned+' emails checked · '+report.eligible+' can be upgraded · '+report.current+' already current · '+report.unsupported+' unrecognized · '+report.errors+' errors.'+(report.interrupted?' Preview stopped.':report.errors?' Fix file errors before updating.':' Back up the archive before updating.');
 }catch(e){readerPreview=0;showError(e);}
 finally{readerBusy=false;$('stopReaders').hidden=true;readerControls(false);}
};
$('upgradeReaders').onclick=async()=>{
 if(!root||!readerPreview||busy||repairBusy||readerBusy)return;
 const target=root;
 try{await allowRoot(target);}catch(e){showError(e);return;}
 readerBusy=true;readerController=new AbortController();readerControls(true);$('stopReaders').hidden=false;
 $('readerStatus').textContent='Updating known saved email reader controls in '+rootPathLabel(target)+'…';
 try{
  const report=await ArchiveReaderUpgrade.run(target,{signal:readerController.signal,write:true,onProgress:readerProgress});
  readerPreview=0;
  $('readerStatus').textContent=report.updated+' saved email pages updated · '+report.current+' already current · '+report.unsupported+' unrecognized · '+report.errors+' errors.'+(report.interrupted?' Stopped; previously updated pages remain saved.':' Completed.');
  notice('Saved email reader update '+(report.interrupted?'stopped':'completed')+' in '+rootPathLabel(target)+'. Updated pages can now honor automatic external images when opened from the archive. No MBOX import or catalog rebuild was performed.');
 }catch(e){showError(e);$('readerStatus').textContent='Reader update failed. Check your backup and file permissions.';}
 finally{readerBusy=false;$('stopReaders').hidden=true;readerControls(false);}
};
$('stopReaders').onclick=()=>readerController?.abort();

window.addEventListener('beforeunload',e=>{if(busy||repairBusy||readerBusy){e.preventDefault();e.returnValue='';}});
window.ArchiveUI={readCatalog,search,install,load,get root(){return root;},get records(){return records;},get catalog(){return catalog;}};
readCatalog().catch(showError);
})();

