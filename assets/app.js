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
function tab(which){$('browse').hidden=which!=='browse';$('import').hidden=which!=='import';$('reindex').hidden=which!=='reindex';for(const id of ['browse','import','reindex'])$(id+'Tab').classList.toggle('active',id===which);}
$('browseTab').onclick=()=>tab('browse');$('importTab').onclick=()=>tab('import');$('reindexTab').onclick=()=>tab('reindex');
function ready(){$('start').disabled=busy||!root||!$('files').files.length;}
let recentRoot=null;
function updateRecentButtons(){
 const name=recentRoot?.name||'';
 $('reuseImportDir').disabled=!recentRoot||busy;
 $('reuseReindexDir').disabled=!recentRoot||repairBusy;
 $('recentArchiveInfo').textContent=name?'Recent archive: '+name+'. Reuse it here, or choose another folder.':'No remembered archive yet. Chrome may reopen your last folder when you choose one.';
}
function recentDB(){
 return new Promise((resolve,reject)=>{
  let request;try{request=indexedDB.open('offline-email-archiver-folders',1);}catch(e){reject(e);return;}
  request.onupgradeneeded=()=>request.result.createObjectStore('recent');
  request.onsuccess=()=>resolve(request.result);
  request.onerror=()=>reject(request.error);
 });
}
async function loadRecent(){
 let db;
 try{
  db=await recentDB();
  const h=await new Promise((resolve,reject)=>{
   const request=db.transaction('recent','readonly').objectStore('recent').get('last');
   request.onsuccess=()=>resolve(request.result);
   request.onerror=()=>reject(request.error);
  });
  if(h?.kind==='directory')recentRoot=h;
 }catch{/* Browser profile storage is optional. */}
 finally{db?.close();updateRecentButtons();}
}
async function rememberRecent(handle){
 recentRoot=handle;updateRecentButtons();
 let db;
 try{
  db=await recentDB();
  await new Promise((resolve,reject)=>{
   const transaction=db.transaction('recent','readwrite');
   transaction.oncomplete=resolve;
   transaction.onerror=()=>reject(transaction.error);
   transaction.objectStore('recent').put(handle,'last');
  });
 }catch{/* Keep the in-tab shortcut even when storage is blocked. */}
 finally{db?.close();}
}
async function allowRecent(handle){
 if(typeof handle.queryPermission!=='function')return;
 if(await handle.queryPermission({mode:'readwrite'})==='granted')return;
 if(typeof handle.requestPermission==='function'&&await handle.requestPermission({mode:'readwrite'})==='granted')return;
 throw Error('RECENT_ACCESS');
}
function pickRoot(id){
 if(!window.showDirectoryPicker)throw Error('BROWSER');
 const options={mode:'readwrite',id};
 if(recentRoot)options.startIn=recentRoot;
 return showDirectoryPicker(options);
}
async function selectImportRoot(chosen){
 if(chosen.name==='__email_archiver'&&await C.exists(chosen,'index.html'))throw Error('APP_SUBFOLDER');
 const m=await C.manifest(chosen);
 root=chosen;
 $('dirInfo').textContent='Import target: '+chosen.name+' · '+m.total.toLocaleString('en-GB')+' indexed messages. '+(!m.generation?'New archives install the viewer under __email_archiver/.':'Existing archive will be extended.');
 void rememberRecent(chosen);
 // Picking an import destination must not replace the current Browse archive.
 ready();
}
async function selectRepairRoot(chosen){
 if(chosen.name==='__email_archiver'&&await C.exists(chosen,'index.html'))throw Error('APP_SUBFOLDER');
 if(!await C.exists(chosen,'index.html')&&!await C.exists(chosen,C.VIEWER_DIR+'index.html'))throw Error('NONARCHIVE');
 repairRoot=chosen;repairPreview=0;
 $('reindexDirInfo').textContent='Repair target: '+chosen.name+'. Only this selected archive will be scanned and updated.';
 $('previewReindex').disabled=false;$('startReindex').disabled=true;
 $('reindexStatus').textContent='Selected '+chosen.name+'. Preview the file scan before rebuilding.';
 void rememberRecent(chosen);
}
$('chooseDir').onclick=async()=>{
 try{await selectImportRoot(await pickRoot('mailarchive'));}
 catch(e){if(e.name!=='AbortError')showError(e);}
};
$('reuseImportDir').onclick=async()=>{
 try{if(!recentRoot)throw Error('RECENT_ACCESS');await allowRecent(recentRoot);await selectImportRoot(recentRoot);}
 catch(e){if(e.name!=='AbortError')showError(e);}
};
$('reuseReindexDir').onclick=async()=>{
 try{if(!recentRoot)throw Error('RECENT_ACCESS');await allowRecent(recentRoot);await selectRepairRoot(recentRoot);}
 catch(e){if(e.name!=='AbortError')showError(e);}
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
$('start').onclick=async()=>{if(busy)return;let acc;try{acc=C.accountName($('importAccount').value.trim());}catch(e){showError(e);return;}busy=true;controller=new AbortController();$('progressPanel').hidden=false;$('stop').hidden=false;$('chooseDir').disabled=true;$('reuseImportDir').disabled=true;$('files').disabled=true;$('importAccount').disabled=true;$('refreshExisting').disabled=true;$('retainSignedEml').disabled=true;$('retainStarredEml').disabled=true;$('retainImportantEml').disabled=true;ready();notice('');$('status').textContent='Importing. Keep this tab open…';try{await install(root);const imp=new C.Importer(root,{signal:controller.signal,onProgress:progress,emlPolicy:{signed:$('retainSignedEml').checked,encrypted:$('retainSignedEml').checked,starred:$('retainStarredEml').checked,important:$('retainImportantEml').checked},refreshExisting:$('refreshExisting').checked});const report=await imp.run(Array.from($('files').files),acc);
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
}finally{busy=false;$('stop').hidden=true;$('chooseDir').disabled=false;updateRecentButtons();$('files').disabled=false;$('importAccount').disabled=false;$('refreshExisting').disabled=false;$('retainSignedEml').disabled=false;$('retainStarredEml').disabled=false;$('retainImportantEml').disabled=false;ready();}};
$('stop').onclick=()=>{controller?.abort();$('status').textContent='Finishing the current message and committing the catalog…';};
function showError(e){const msgs={APP_SUBFOLDER:'Choose the parent archive root, not its __email_archiver application subfolder.',RECENT_ACCESS:'The last selected archive is no longer accessible. Choose the archive root folder again.',LOCKED:'Another import or catalog repair may already be writing to this folder. Close other archive tabs and retry.',ACCOUNT:'Enter a valid account folder name, such as personal.',BROWSER:'Import requires a current desktop Chrome or Edge with the File System Access API.',CATALOG:'The catalog could not be loaded. Check the folder is complete and retry importing from your backup.',FORMAT:'Unsupported or damaged catalog format.',NONARCHIVE:'The selected folder contains another index.html. Choose an empty folder or an archive created by this tool.',OLD_ARCHIVE_FORMAT:'This is an older archive layout. For testing, choose a new empty archive root and reimport the original MBOX. No automatic migration is performed.'};notice(msgs[e.message]||('Operation failed ('+e.name+'). Check permissions, free space and whether another tab is writing to the archive.'));}

let repairRoot=null,repairBusy=false,repairController=null,repairPreview=0;
$('chooseReindexDir').onclick=async()=>{
 try{await selectRepairRoot(await pickRoot('mailarchive-rebuild'));}
 catch(e){if(e.name!=='AbortError')showError(e);}
};
$('previewReindex').onclick=async()=>{
 if(!repairRoot||repairBusy)return;
 repairBusy=true;$('previewReindex').disabled=true;$('startReindex').disabled=true;
 $('chooseReindexDir').disabled=true;$('reuseReindexDir').disabled=true;$('reindexStatus').textContent='Scanning folders (read only)…';
 try{
  repairPreview=0;
  for await(const entry of ArchiveReindex.scan(repairRoot)){
   repairPreview++;
   if(repairPreview%200===0){$('reindexStatus').textContent=repairPreview+' message pages found…';await new Promise(resolve=>setTimeout(resolve,0));}
  }
  $('reindexStatus').textContent=repairPreview+' HTML message files found. This operation will regenerate the catalog, not the emails. Make sure your backup is complete.';
  $('startReindex').disabled=repairPreview===0;
 }catch(e){showError(e);}finally{repairBusy=false;$('previewReindex').disabled=false;$('chooseReindexDir').disabled=false;updateRecentButtons();}
};
$('startReindex').onclick=async()=>{
 if(repairBusy||!repairRoot||!repairPreview||busy)return;
 repairBusy=true;repairController=new AbortController();$('startReindex').disabled=true;
 $('chooseReindexDir').disabled=true;$('reuseReindexDir').disabled=true;$('previewReindex').disabled=true;
 $('stopReindex').hidden=false;$('reindexStatus').textContent='Rebuilding search indexes. Leave this tab open…';
 try{
  const stats=await ArchiveReindex.rebuild(repairRoot,{signal:repairController.signal,onProgress:s=>{
   $('reindexStatus').textContent=s.scanned+' HTML pages scanned · '+s.indexed+' indexed · '+s.errors+' errors · '+s.brokenAttachments+' missing attachments'+(s.committed?' · new catalog published':'');
  }});
  $('reindexStatus').textContent=stats.interrupted?'Stopped. The previous catalog is still active.':('Finished. '+stats.indexed+' messages indexed, '+stats.errors+' errors, '+stats.brokenAttachments+' broken attachments. Reopen index.html in the archive root.');
  if(!stats.interrupted){
   // The current viewer can reload its own catalog if it was the repaired archive.
   try{await readCatalog();}catch{}
   notice('Rebuilt the catalog only in '+repairRoot.name+'. Open that archive’s own index.html to browse it.');
  }
 }catch(e){showError(e);$('reindexStatus').textContent='Rebuild failed. The previous catalog should still be available; check your archive backup.';}
 finally{repairBusy=false;$('chooseReindexDir').disabled=false;updateRecentButtons();$('previewReindex').disabled=false;$('startReindex').disabled=repairPreview===0;$('stopReindex').hidden=true;}
};
$('stopReindex').onclick=()=>repairController?.abort();
window.addEventListener('beforeunload',e=>{if(busy||repairBusy){e.preventDefault();e.returnValue='';}});
window.ArchiveUI={readCatalog,search,install,load,get root(){return root;},get records(){return records;},get catalog(){return catalog;}};
readCatalog().catch(showError);
})();

