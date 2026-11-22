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
// All indexed data lives beneath archived_emails/ relative to this index.html.
function load(src){const p=chain.then(()=>loadScript(localUrl(src)));chain=p.catch(()=>{});return p;}
function notice(s){$('operationNotice').textContent=s;$('operationNotice').hidden=!s;}
function browseNotice(s){$('notice').textContent=s;$('notice').hidden=!s;}
function options(id,items,first){const el=$(id),old=el.value;el.replaceChildren(new Option(first,''));for(const s of items)el.add(new Option(s,s));if(items.includes(old))el.value=old;}
async function loadArchiveSegment(path,selectedRoot){
 // Mounted data roots are read through the selected File System Access handle.
 // The application never loads their catalogs by script tag or from its own folder.
 return selectedRoot?C.unwrap(await C.read(selectedRoot,path)):load('archived_emails/'+path);
}
async function readCatalog(){
 const selectedRoot=root,revision=selectionVersion;
 let nextCatalog,last;
 if(selectedRoot){
  nextCatalog=await C.manifest(selectedRoot);
  if(nextCatalog?.format!==C.VERSION)throw Error('FORMAT');
 }else{
  // Classic local script tags load indexes via file:// without File System Access.
  // A moved or manually merged account folder is recovered by Reimport only existing.
  for(const src of ['archived_emails/catalog/archive.js','archived_emails/catalog/archive.previous.js']){
   try{const result=await load(src+'?g='+Date.now());if(result?.format!==C.VERSION)throw Error('FORMAT');
    nextCatalog=result;break;}catch(e){last=e;}
  }
  if(!nextCatalog)nextCatalog=C.empty();
 }
 const found=new Map();
 for(const seg of nextCatalog.segments){
  const m=await loadArchiveSegment(seg.meta,selectedRoot);
  if(m.kind!=='metadata'||!Array.isArray(m.records))throw Error('CATALOG');
  for(const r of m.records)found.set(r.account+'/'+r.id,r);
 }
 if(root!==selectedRoot||revision!==selectionVersion)return;
 queryVersion++;catalog=nextCatalog;
 records=found;cache.clear();
 all=[...records.values()].sort((a,b)=>(b.date||'').localeCompare(a.date||'')||a.id.localeCompare(b.id));
 options('accountFilter',catalog.accounts,'All accounts');
 options('labelFilter',[...new Set(all.flatMap(r=>r.labels))].sort(),'All labels');
 if(remembered&&remembered.values&&Number.isFinite(remembered.when)&&Date.now()-remembered.when<=30*60*1000){
  for(const [id,value] of Object.entries(remembered.values)){
   if(['query','accountFilter','labelFilter','dateFrom','dateTo','attachmentFilter','pageSize'].includes(id)&&typeof value==='string')$(id).value=value;
  }
 }
 $('activeRootInfo').textContent='archived_emails/ · '+all.length.toLocaleString('en-GB')+' indexed messages';
 await search();restoreReturnPosition();
}
function metadataText(r){return C.fold([r.subject,r.from,r.to,r.cc,r.bcc].join(' '));}
async function search(){const v=++queryVersion;currentPage=0;const terms=C.fold($('query').value).split(/\s+/).filter(Boolean);const acc=$('accountFilter').value,lab=$('labelFilter').value,from=$('dateFrom').value,to=$('dateTo').value,attach=$('attachmentFilter').value;const candidates=all.filter(r=>(!acc||r.account===acc)&&(!lab||r.labels.includes(lab))&&(!from||r.day&&r.day>=from)&&(!to||r.day&&r.day<=to)&&(!attach||(attach==='yes')===!!r.attachments.length));
 if(!terms.length){matches=candidates;render();return;}const wanted=new Map(),found=new Set();for(const r of candidates){const key=r.account+'/'+r.id,meta=metadataText(r);if(terms.every(t=>meta.includes(t)))found.add(key);else wanted.set(key,meta);}
 $('resultInfo').textContent='Searching local text indexes…';let done=0;for(const seg of catalog.segments){if(v!==queryVersion)return;if(!seg.search)continue;let data=cache.get(seg.search);if(!data){data=await loadArchiveSegment(seg.search,root);cache.set(seg.search,data);if(cache.size>4)cache.delete(cache.keys().next().value);}for(const x of data.records){const meta=wanted.get(x.key);if(meta!==undefined){const hay=meta+' '+C.fold(x.text);if(terms.every(t=>hay.includes(t)))found.add(x.key);}}done++;if(done%5===0){$('resultInfo').textContent='Searched '+done+' indexes…';await new Promise(r=>setTimeout(r,0));}}
 if(v!==queryVersion)return;matches=candidates.filter(r=>found.has(r.account+'/'+r.id));render();}
let openMessageRecord=null,messageResources=null,openedRoot=null,openedMessageVersion=0,savedBrowseScroll=0,messageImagesApproved=false;
function closeMessage(){
 openedMessageVersion++;
 $('messageViewer').hidden=true;$('browseList').hidden=false;
 $('messageFrame').removeAttribute('src');
 requestAnimationFrame(()=>window.scrollTo(0,savedBrowseScroll));
 $('loadMessageImages').hidden=true;
 openMessageRecord=null;openedRoot=null;messageImagesApproved=false;
 if(messageResources){messageResources.dispose();messageResources=null;}
}
async function showMessage(record,{loadExternal=false}={}){
 if(!root)return;
 if(!openMessageRecord)savedBrowseScroll=window.scrollY||0;
 const chosenRoot=root,version=++openedMessageVersion;
 const theme=document.documentElement.getAttribute('data-theme')==='dark'?'dark':'light';
 $('messageInfo').textContent='Opening saved email…';
 $('messageViewer').hidden=false;$('browseList').hidden=true;
 try{
  const rendered=await ArchiveDataReader.open(chosenRoot,record,{
   theme,autoImages:loadExternal||messageImagesApproved||$('autoImages').checked
  });
  if(root!==chosenRoot||version!==openedMessageVersion){rendered.dispose();return;}
  const previous=messageResources;messageResources=rendered;
  $('messageFrame').src=rendered.url;
  if(previous)previous.dispose();
  openMessageRecord=record;openedRoot=chosenRoot;
  $('loadMessageImages').hidden=!rendered.hasRemoteImages||loadExternal||messageImagesApproved||$('autoImages').checked;
  $('messageInfo').textContent=record.subject||'(No subject)';
  window.scrollTo(0,0);
 }catch(e){
  closeMessage();
  browseNotice('Could not open this saved message: '+(e.message||e.name)+'. No archive files were changed.');
 }
}
$('closeMessage').onclick=()=>closeMessage();
$('loadMessageImages').onclick=()=>{if(openMessageRecord&&root===openedRoot){messageImagesApproved=true;void showMessage(openMessageRecord,{loadExternal:true});}};
function render(){const size=+$('pageSize').value,pages=Math.max(1,Math.ceil(matches.length/size));currentPage=Math.min(currentPage,pages-1);$('rows').replaceChildren();for(const r of matches.slice(currentPage*size,(currentPage+1)*size)){const tr=document.createElement('tr');const tdDate=document.createElement('td');tdDate.className='date';tdDate.textContent=r.date?new Date(r.date).toLocaleString('en-GB',{dateStyle:'medium',timeStyle:'short'}):'Unknown date';const tdAddr=document.createElement('td');tdAddr.textContent=r.from||'(Not specified)';const to=document.createElement('span');to.className='address';to.textContent='To: '+(r.to||'—');tdAddr.append(to);const tdSub=document.createElement('td');const a=document.createElement('a');a.className='subject';a.textContent=r.subject||'(No subject)';a.href=root?'#saved-email':'archived_emails/'+r.path.split('/').map(encodeURIComponent).join('/')+'?fromArchive=1&images='+($('autoImages').checked?'auto':'manual')+'&theme='+(document.documentElement.getAttribute('data-theme')==='dark'?'dark':'light');a.target='_self';a.addEventListener('click',e=>{
 if(root){e.preventDefault();void showMessage(r);return;}
 if(e.button===0&&!e.ctrlKey&&!e.metaKey&&!e.shiftKey&&!e.altKey)saveReturnPosition();
});tdSub.append(a);for(const text of [r.account,...r.labels]){const s=document.createElement('span');s.className='badge';s.textContent=text;tdSub.append(s);}const tdAtt=document.createElement('td');tdAtt.textContent=(r.attachments.length?'⌕ '+r.attachments.length:'—')+(r.original?' · EML':'');tr.append(tdDate,tdAddr,tdSub,tdAtt);$('rows').append(tr);}$('empty').hidden=!!matches.length;$('resultInfo').textContent=matches.length.toLocaleString('en-GB')+' messages'+(matches.length!==all.length?' of '+all.length.toLocaleString('en-GB'):'');$('pageInfo').textContent=(currentPage+1)+' / '+pages;$('prev').disabled=currentPage===0;$('next').disabled=currentPage>=pages-1;}
let timer;for(const id of ['query','accountFilter','labelFilter','dateFrom','dateTo','attachmentFilter'])$(id).addEventListener('input',()=>{clearTimeout(timer);timer=setTimeout(()=>search().catch(showBrowseError),200);});window.addEventListener('archive-theme-change',()=>{render();if(openMessageRecord&&root===openedRoot)void showMessage(openMessageRecord,{loadExternal:messageImagesApproved});});$('pageSize').onchange=render;$('prev').onclick=()=>{currentPage--;render();};$('next').onclick=()=>{currentPage++;render();};$('reset').onclick=()=>{for(const id of ['query','accountFilter','labelFilter','dateFrom','dateTo','attachmentFilter'])$(id).value='';search().catch(showBrowseError);};
function tab(which){
 $('browse').hidden=which!=='browse';
 $('import').hidden=which!=='import';
 for(const id of ['browse','import'])$(id+'Tab').classList.toggle('active',id===which);
}
$('browseTab').onclick=()=>tab('browse');
$('importTab').onclick=()=>tab('import');
function ready(){$('start').disabled=busy||repairBusy||readerBusy||rootUnsafe||rootProbing||!rootAccountsResolved||!root||!$('files').files.length;}
// Each opened index.html has its own remembered root/account. No global "last" folder.
const viewerKey=location.pathname;
const folderPreference='self-root:'+viewerKey,accountPreference='account:'+viewerKey;
const viewerParts=decodeURIComponent(viewerKey).split('/').filter(Boolean);
const selfRootName=viewerParts[nestedViewer?viewerParts.length-3:viewerParts.length-2]||'archive';
let recentRoot=null,selectionVersion=0,accountTouched=false,preferredAccount='personal',readerBusy=false,readerPreview=0,readerController=null,rootUnsafe=false,rootIsNew=false,rootHasAccounts=false,rootAccountsResolved=false,rootProbing=false;
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
   transaction.objectStore('recent').put(value,accountPreference);
  });
 }catch{/* Browser profile storage may be disabled for local files. */}
 finally{db?.close();}
}
function selectedAccount(){
 return C.accountName(($('importAccountSelect').value==='__new__' ? $('importAccount').value : $('importAccountSelect').value).trim());
}
function showNewAccount(){
 const isNew=$('importAccountSelect').value==='__new__';
 $('newAccountWrap').hidden=!isNew;
 if(!isNew){preferredAccount=$('importAccountSelect').value;void rememberAccount(preferredAccount);}
 ready();
}
$('importAccountSelect').addEventListener('change',()=>{accountTouched=true;showNewAccount();});
$('importAccount').addEventListener('input',()=>{accountTouched=true;});
$('importAccount').addEventListener('change',()=>{try{preferredAccount=C.accountName($('importAccount').value.trim());void rememberAccount(preferredAccount);}catch{}});
async function loadRootAccounts(handle){
 if(!handle||handle!==root)return;
 const version=selectionVersion,names=new Set();
 try{
  const m=await C.manifest(handle);
  for(const a of m.accounts||[]){try{names.add(C.accountName(a));}catch{}}
  for await(const [name,entry] of handle.entries()){
   if(entry.kind==='directory')try{names.add(C.accountName(name));}catch{}
  }
 }catch{
  // A remembered self handle without access may still use the viewer's known accounts.
  for(const a of catalog?.accounts||[])try{names.add(C.accountName(a));}catch{}
 }
 if(handle!==root||version!==selectionVersion)return;
 rootHasAccounts=names.size>0;rootAccountsResolved=true;
 const select=$('importAccountSelect'),prior=select.value,sorted=[...names].sort();
 select.replaceChildren(...sorted.map(a=>new Option(a,a)),new Option('+ New account…','__new__'));
 const wanted=accountTouched?prior:preferredAccount;
 select.value=names.has(wanted)?wanted:sorted.length?sorted[0]:'__new__';
 if(select.value==='__new__')$('importAccount').value=preferredAccount;
 showNewAccount();
 $('accountInfo').textContent=names.size?names.size+' existing account folder(s) found. Select one, or choose New.':'No existing accounts found. Enter a new account folder name.';
}

function rootPathLabel(handle){return handle?.name?handle.name+'/':'(none)';}
async function updateRootInfo(handle){
 // A browser directory handle exposes only its folder name, never the absolute path.
 // The label stays concise and never suggests that a root was authorized automatically.
 if(!handle){
  $('dirInfo').textContent='Currently selected: none';
  $('accountInfo').textContent='Choose an archive root to load existing accounts.';
  return;
 }
 const name='/'+handle.name+'/';
 $('dirInfo').textContent='Currently selected: '+name;

}
async function quickRootCheck(handle){
 const version=selectionVersion;
 const m=await C.manifest(handle);
 if(handle!==root||version!==selectionVersion)return;
 rootProbing=false;rootUnsafe=false;rootIsNew=!(m.segments?.length||m.total);
 $('catalogStatus').textContent=m.total
  ?'Data folder loaded · '+m.total+' indexed messages. Use Check existing for a deeper scan.'
  :'Data folder loaded with no catalog entries. New imports write data and indexes here; no application files are copied.';
 $('previewReaders').disabled=busy||repairBusy||readerBusy;
 $('upgradeReaders').disabled=true;
 ready();
 await readCatalog();
}
function setRoot(handle,{recent=false}={}){
 // One application instance always has exactly one active data root.
 closeMessage();
 root=handle;readerPreview=0;rootUnsafe=false;rootIsNew=false;
 rootHasAccounts=false;rootAccountsResolved=false;rootProbing=!!handle;
 all=[];matches=[];records.clear();cache.clear();catalog=null;queryVersion++;
 $('rows').replaceChildren();
 $('activeRootInfo').textContent=handle?'Loading data folder /'+handle.name+'/…':'Local demo archive';
 $('resultInfo').textContent='Loading selected data folder…';
 $('catalogStatus').textContent=handle?'Reading saved catalog from /'+handle.name+'/…':'Choose a data folder to browse your own messages.';
 $('existingProgressPanel').hidden=true;
 $('previewReaders').disabled=!handle||busy||repairBusy||readerBusy;
 $('upgradeReaders').disabled=true;
 $('readerStatus').textContent='Check existing to inspect the selected data folder (read-only).';
 void updateRootInfo(handle,{recent});
 if(handle){
  void quickRootCheck(handle).catch(e=>{
   if(handle!==root)return;
   rootUnsafe=true;rootProbing=false;
   $('catalogStatus').textContent='Could not open selected data folder: '+errorText(e)+'. No files were changed.';
   $('activeRootInfo').textContent='Cannot read /'+handle.name+'/ — choose the folder again.';
   $('resultInfo').textContent='Unable to load data catalog.';
   ready();
  });
  void loadRootAccounts(handle);
 }else{
  $('accountInfo').textContent='Choose a data folder to load existing accounts.';
  void readCatalog().catch(showBrowseError);
 }
 ready();
}
async function loadRecent(){
 const before=selectionVersion;
 let db;
 try{
  db=await recentDB();
  const [handle,account]=await Promise.all([dbGet(db,folderPreference),dbGet(db,accountPreference)]);
  if(typeof account==='string'&&!accountTouched){
   try{preferredAccount=C.accountName(account);$('importAccount').value=preferredAccount;}catch{/* Ignore stale invalid values. */}
  }
  if(handle?.kind==='directory'&&before===selectionVersion){
   recentRoot=handle;
   // Silent restore is allowed only when the browser still grants read permission.
   // Never prompt automatically during page load.
   let permitted=false;
   try{permitted=typeof handle.queryPermission!=='function'||
    await handle.queryPermission({mode:'read'})==='granted';}catch{}
   if(permitted&&!root)setRoot(handle,{recent:true});
   else if(!permitted&&!root)$('activeRootInfo').textContent='Previous data folder: /'+handle.name+'/ — choose it again to grant access.';
  }
 }catch{/* Recent folder and account storage are optional. */}
 finally{db?.close();if(!root)void updateRootInfo(null);}
}
async function rememberRecent(handle){
 recentRoot=handle;
 // One remembered folder per copy of the application, regardless of its name.
 let db;
 try{
  db=await recentDB();
  await new Promise((resolve,reject)=>{
   const transaction=db.transaction('recent','readwrite');
   transaction.oncomplete=resolve;transaction.onerror=()=>reject(transaction.error);
   transaction.objectStore('recent').put(handle,folderPreference);
  });
 }catch{/* The folder is still selected for this session. */}
 finally{db?.close();}
}
async function allowRoot(handle,mode='readwrite'){
 if(!handle)throw Error('RECENT_ACCESS');
 if(typeof handle.queryPermission!=='function')return;
 if(await handle.queryPermission({mode})==='granted')return;
 if(typeof handle.requestPermission==='function'&&await handle.requestPermission({mode})==='granted')return;
 throw Error('RECENT_ACCESS');
}
function pickRoot(){
 if(!window.showDirectoryPicker)throw Error('BROWSER');
 const options={mode:'read',id:'mailarchive'};
 if(recentRoot)options.startIn=recentRoot;
 return showDirectoryPicker(options);
}
async function chooseDataFolder(){
 if(busy||repairBusy||readerBusy)return;
 try{
  const chosen=await pickRoot();
  if(chosen.name==='__email_archiver'&&await C.exists(chosen,'index.html'))throw Error('APP_SUBFOLDER');
  selectionVersion++;
  setRoot(chosen);
  void rememberRecent(chosen);
 }catch(e){if(e.name!=='AbortError')showError(e);}
}
$('chooseDir').onclick=chooseDataFolder;
$('browseChooseRoot').onclick=chooseDataFolder;
void loadRecent();

$('files').onchange=()=>{const files=Array.from($('files').files);$('fileInfo').textContent=files.length+' files · '+(files.reduce((s,f)=>s+f.size,0)/1024**3).toFixed(2)+' GiB. Allow at least this space plus a reserve on the destination drive.';ready();};
function progress(s){$('progress').value=s.totalBytes?Math.min(100,100*s.bytes/s.totalBytes):0;for(const [id,k] of [['readCount','read'],['newCount','new'],['dupeCount','duplicates'],['refreshedCount','refreshed'],['emlSavedCount','emlSaved'],['emlReusedCount','emlReused'],['errorCount','errors']])$(id).textContent=s[k].toLocaleString('en-GB');$('progressDetail').textContent=(s.bytes/1024**2).toFixed(1)+' / '+(s.totalBytes/1024**2).toFixed(1)+' MiB read · '+s.committed+' changes committed to the catalog';}
$('start').onclick=async()=>{
 if(busy||repairBusy||readerBusy)return;
 let acc;
 try{acc=selectedAccount();}catch(e){showError(e);return;}
 const target=root,sourceFiles=Array.from($('files').files);
 if(!target||rootUnsafe||rootProbing||!rootAccountsResolved||!sourceFiles.length)return;
 // Permissions remain strictly user-gesture based; this button authorizes the pre-import update.
 try{await allowRoot(target);}catch(e){showError(e);return;}
 preferredAccount=acc;void rememberAccount(acc);
 busy=true;controller=new AbortController();
 $('progressPanel').hidden=true;$('existingProgressPanel').hidden=true;
 $('chooseDir').disabled=true;$('browseChooseRoot').disabled=true;$('previewReaders').disabled=true;$('upgradeReaders').disabled=true;
 $('files').disabled=true;$('importAccount').disabled=true;$('importAccountSelect').disabled=true;
 for(const id of ['retainSignedEml','retainStarredEml','retainImportantEml'])$(id).disabled=true;
 $('stop').hidden=false;ready();notice('');
 try{
  if(!(rootIsNew&&rootAccountsResolved&&!rootHasAccounts))await runCatalogSync(target,{signal:controller.signal,force:true});
  if(controller.signal.aborted)return;
  const existing=await runExistingUpgrade(target,controller.signal,'Updating existing emails before new MBOX import');
  readerPreview=0;
  if(existing.interrupted||controller.signal.aborted){
   notice('Import stopped during existing-email updates. Already updated HTML pages remain saved; MBOX import was not started.');
   return;
  }
  if(existing.errors){
   notice(existing.errors+' saved HTML page(s) could not be updated. MBOX import was not started. Check your backup and repeat the operation.');
   return;
  }
  if(controller.signal.aborted)return;
  // The application stays in its own folder. Nothing is copied to the data root.
  $('progressPanel').hidden=false;
  $('status').textContent='Importing MBOX into '+acc+'…';
  $('progress').value=0;
  // This stage always comes after the existing-only HTML pass, even if no older pages exist.
  $('existingProgressPanel').hidden=false;
  $('progressPanel').hidden=false;
  $('status').textContent='Importing MBOX into '+acc+'…';
  $('progress').value=0;
  const imp=new C.Importer(target,{signal:controller.signal,onProgress:progress,
   emlPolicy:{signed:$('retainSignedEml').checked,encrypted:$('retainSignedEml').checked,
    starred:$('retainStarredEml').checked,important:$('retainImportantEml').checked}});
  const report=await imp.run(sourceFiles,acc);
  $('status').textContent=report.interrupted?'Import stopped':'Import complete';
  if(report.issues.length)notice('Some messages could not be imported. Source offsets and error codes are in '+acc+'/catalog/import-….json. Source files were not modified.');
  try{await readCatalog();await loadRootAccounts(target);}catch(e){browseNotice('Import finished, but the selected data catalog could not be loaded: '+errorText(e));}
  if(report.interrupted&&!report.issues.length)notice('Import stopped safely. Earlier committed messages remain saved in '+target.name+'.');
  else if(!report.issues.length)notice('Import saved to data folder /'+target.name+'/. Browse now shows this same selected root. No application files were copied.');
 }catch(e){
  if(controller.signal.aborted){
   notice('Import stopped safely. Existing HTML updates and catalog changes already completed remain saved.');
  }else showError(e);
  try{await readCatalog();}catch{}
 }finally{
  busy=false;$('stop').hidden=true;$('stopReaders').hidden=true;
  $('chooseDir').disabled=false;$('browseChooseRoot').disabled=false;$('previewReaders').disabled=!root;$('upgradeReaders').disabled=true;
  $('files').disabled=false;$('importAccount').disabled=false;$('importAccountSelect').disabled=false;
  for(const id of ['retainSignedEml','retainStarredEml','retainImportantEml'])$(id).disabled=false;
  ready();
 }
};
$('stop').onclick=()=>{
 controller?.abort();
 if(!$('progressPanel').hidden)$('status').textContent='Stopping after the current message and committing the catalog…';
 else $('existingProgressTitle').textContent='Stopping existing-email updates…';
};
function errorText(e){const msgs={ARCHIVE_LOCK_TIMEOUT:'Could not acquire the archive write lock. Close other archive tabs, check syncing, and retry.',APP_SUBFOLDER:'Choose the parent archive root, not its __email_archiver application subfolder.',RECENT_ACCESS:'Archive folder access is not available. Click Import folder root to select it again, then retry.',LOCKED:'Another import or catalog repair may already be writing to this folder. Close other archive tabs and retry.',ACCOUNT:'Enter a valid account folder name, such as personal.',BROWSER:'Import requires a current desktop Chrome or Edge with the File System Access API.',CATALOG:'The catalog could not be loaded. Check the folder is complete and retry importing from your backup.',FORMAT:'Unsupported or damaged catalog format.',NONARCHIVE:'The selected folder contains another index.html. Choose an empty folder or an archive created by this tool.',OLD_ARCHIVE_FORMAT:'This is an older archive layout. For testing, choose a new empty archive root and reimport the original MBOX. No automatic migration is performed.'};return msgs[e.message]||('Operation failed ('+e.name+'). Check permissions, free space and whether another tab is writing to the archive.');}
function showError(e){notice(errorText(e));}
function showBrowseError(e){browseNotice(errorText(e));}


let repairBusy=false,repairController=null;
function operateControls(active){
 $('chooseDir').disabled=active;
 $('browseChooseRoot').disabled=active;
 $('files').disabled=active;
 $('importAccountSelect').disabled=active;
 $('importAccount').disabled=active;
 $('previewReaders').disabled=active||rootUnsafe||!root;
 $('upgradeReaders').disabled=active||rootUnsafe||!root||!readerPreview;
 ready();
}
async function runCatalogSync(target,{signal=null,force=false}={}){
 if(!target||repairBusy||(!force&&(busy||readerBusy)))return null;
 repairBusy=true;repairController=new AbortController();operateControls(true);
 $('stopReindex').hidden=!!signal;
 $('catalogStatus').textContent='Recovering missing catalog entries from saved account folders…';
 try{
  const stats=await ArchiveReindex.syncMissing(target,{
   signal:signal||repairController.signal,
   onProgress:v=>{
    $('catalogStatus').textContent=(v.scanned||0)+' HTML files found · '+(v.skipped||0)+
     ' already indexed · '+(v.indexed||0)+' recovered'+
     (v.fullRebuild?' · rebuilding missing/damaged indexes':'');
   }
  });
  const summary=stats.interrupted?'Catalog recovery stopped; the previous index is preserved.':
   stats.fullRebuild?'Catalog recovered from saved HTML: '+stats.indexed+' messages.':
   stats.indexed?'Added '+stats.indexed+' missing catalog entries; skipped '+stats.skipped+' existing ones.':
   'Catalog is up to date; '+stats.skipped+' messages already indexed. No indexes rewritten.';
  $('catalogStatus').textContent=summary;
  if(!stats.interrupted){
   try{await loadRootAccounts(target);}catch{}
  }
  return stats;
 }catch(e){
  $('catalogStatus').textContent=e.message==='REINDEX_INCOMPLETE'
   ?'Catalog recovery stopped: saved HTML validation failed. Previous catalog retained.'
   :e.message==='LOCKED'
    ?'Another tab is already writing to the archive. Close it and try again.'
    :'Catalog recovery failed ('+(e.message||e.name||'unknown error')+'). No replacement published.';
  throw e;
 }finally{repairBusy=false;$('stopReindex').hidden=true;operateControls(false);}
}
$('stopReindex').onclick=()=>repairController?.abort();

function readerControls(active){
 $('chooseDir').disabled=active;
 $('browseChooseRoot').disabled=active;
 $('files').disabled=active;
 $('previewReaders').disabled=active||!root;
 $('upgradeReaders').disabled=active||!root||!readerPreview;
 $('importAccountSelect').disabled=active;
 $('importAccount').disabled=active;
 ready();
}
function readerStatus(s){
 return s.scanned+' HTML messages checked · '+s.eligible+' older viewers eligible · '+s.current+' current · '+s.unsupported+' skipped · '+s.errors+' errors';
}
function showExistingProgress(s){
 const bar=$('existingProgress'),total=s.total;
 bar.max=total===null?100:Math.max(total,1);
 bar.value=total===null?0:Math.min(s.scanned,Math.max(total,1));
 $('existingScanned').textContent=String(s.scanned);
 $('existingUpdated').textContent=String(s.updated);
 $('existingSkipped').textContent=String(s.current+s.unsupported);
 $('existingErrors').textContent=String(s.errors);
 let detail;
 if(s.phase==='counting'){
  detail='Counting saved HTML files: '+s.counted+' found. No email content has been opened yet.';
 }else if(s.phase==='waiting-lock'){
  detail=s.total+' HTML files found. Waiting for exclusive archive write access; close other archive tabs if this takes too long.';
 }else if(s.phase==='writing'){
  detail='Saving a verified saved-email page · '+s.scanned+' / '+s.total+
   ' checked · '+s.updated+' updated so far…';
 }else{
  detail=total===null
   ?s.scanned+' saved HTML messages checked…'
   :s.scanned+' / '+total+' HTML files checked · '+s.eligible+' older pages eligible · '+
    s.updated+' updated · '+(s.current+s.unsupported)+' skipped · '+s.errors+' errors';
 }
 $('existingProgressDetail').textContent=detail;
}
async function runExistingUpgrade(target,signal,title){
 $('existingProgressPanel').hidden=false;
 $('existingProgressTitle').textContent=title;
 $('existingProgress').max=100;$('existingProgress').value=0;
 $('existingScanned').textContent='0';$('existingUpdated').textContent='0';
 $('existingSkipped').textContent='0';$('existingErrors').textContent='0';
 $('existingProgressDetail').textContent='Counting saved HTML messages…';
 $('stopReaders').hidden=false;
 try{
  const result=await ArchiveReaderUpgrade.refresh(target,{
   signal,write:true,onProgress:showExistingProgress
  });
  showExistingProgress(result);
  $('existingProgressTitle').textContent=result.interrupted?'Existing-email update stopped':
   result.errors?'Existing-email update completed with errors':'Existing-email update complete';
  $('existingProgressDetail').textContent=
   result.updated+' saved HTML pages updated · '+result.current+' already current · '+result.unsupported+' unsupported/skipped · '+result.errors+' errors'+
   (result.interrupted?' · stopped safely.':' · finished.');
  return result;
 }catch(e){
  $('existingProgressTitle').textContent='Existing-email update failed';
  $('existingProgressDetail').textContent=e.message==='ARCHIVE_LOCK_TIMEOUT'
   ?'Could not acquire the archive write lock. Close other archive tabs and check the sync drive, then try again.'
   :e.message==='LOCKED'
    ?'Another tab is writing to this archive. Close it and retry.'
    :'Existing-email update failed ('+(e.message||e.name||'unknown error')+'). Check permissions, disk space and your backup.';
  throw e;
 }finally{$('stopReaders').hidden=true;}
}
$('previewReaders').onclick=async()=>{
 if(!root||rootUnsafe||rootProbing||busy||repairBusy||readerBusy)return;
 const target=root;
 try{await allowRoot(target,'read');}catch(e){showError(e);return;}
 readerBusy=true;readerPreview=0;readerController=new AbortController();
 readerControls(true);$('stopCheck').hidden=false;
 $('existingProgressPanel').hidden=true;
 $('readerStatus').textContent='Checking saved HTML readers…';
 $('catalogStatus').textContent='Checking existing catalog references (read-only)…';
 try{
  const inventory=await ArchiveReindex.checkMissing(target,{
   signal:readerController.signal,
   onProgress:v=>{
    $('catalogStatus').textContent=v.scanned+' HTML files inspected · '+v.indexed+
     ' indexed · '+v.missing+' missing entries'+(v.damaged?' · catalog needs repair':'');
   }
  });
  if(inventory.interrupted){
   $('readerStatus').textContent='Check existing stopped. No archive files were changed.';
   return;
  }
  $('catalogStatus').textContent=inventory.damaged
   ?'Some catalog shards are missing or damaged. Start import or Reimport only existing to recover the catalog.'
   :inventory.missing
    ?inventory.missing+' unindexed saved HTML files found. They will be added before the next import or existing update.'
    :'Catalog is up to date; '+inventory.indexed+' messages already indexed. No indexes rewritten.';
  const result=await ArchiveReaderUpgrade.refresh(target,{
   signal:readerController.signal,onProgress:x=>{$('readerStatus').textContent=readerStatus(x);}
  });
  readerPreview=!result.errors&&!result.interrupted?result.eligible:0;
  $('readerStatus').textContent=readerStatus(result)+(result.interrupted?' Check stopped.':
   result.errors?' Some pages could not be read; check the archive first.':
   ' Back up the archive before applying the update.');
 }catch(e){readerPreview=0;$('readerStatus').textContent='Check existing failed: '+errorText(e);}
 finally{readerBusy=false;$('stopCheck').hidden=true;readerControls(false);}
};
$('upgradeReaders').onclick=async()=>{
 if(!root||rootUnsafe||rootProbing||!readerPreview||busy||repairBusy||readerBusy)return;
 const target=root;
 try{await allowRoot(target);}catch(e){showError(e);return;}
 readerBusy=true;readerController=new AbortController();readerControls(true);
 try{
  await runCatalogSync(target,{signal:readerController.signal,force:true});
  if(readerController.signal.aborted)return;
  const result=await runExistingUpgrade(target,readerController.signal,'Reimporting only existing saved HTML emails');
  readerPreview=0;
  if(result.errors)$('readerStatus').textContent='Some saved pages could not be updated. Check the result below, then run Check existing again.';
  else if(result.interrupted)$('readerStatus').textContent='Existing-email update stopped. Run Check existing to see what remains.';
  else $('readerStatus').textContent='Existing-email update complete. Run Check existing to verify the remaining pages.';
  if(!result.interrupted&&!result.errors){await readCatalog();await loadRootAccounts(target);}
 }catch(e){readerPreview=0;$('readerStatus').textContent='Reimport only existing failed: '+errorText(e);}
 finally{readerBusy=false;readerControls(false);}
};
$('stopCheck').onclick=()=>readerController?.abort();
$('stopReaders').onclick=()=>{
 if(busy)controller?.abort();
 else readerController?.abort();
};
window.addEventListener('beforeunload',e=>{if(busy||repairBusy||readerBusy){e.preventDefault();e.returnValue='';}});
window.ArchiveUI={readCatalog,search,load,get root(){return root;},get records(){return records;},get catalog(){return catalog;}};
readCatalog().catch(showBrowseError);
})();

