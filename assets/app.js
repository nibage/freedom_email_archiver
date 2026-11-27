(function(){'use strict';
const C=ArchiveCore,$=id=>document.getElementById(id);let pending=null,catalogWarning='',catalogLoadVersion=0;
window.MailArchive={receive:data=>{if(pending)pending(data);}};
function loadScript(src){return new Promise((resolve,reject)=>{const s=document.createElement('script');let result;pending=x=>result=x;s.src=src;s.onload=()=>{pending=null;s.remove();result?resolve(result):reject(Error('CATALOG'));};s.onerror=()=>{pending=null;s.remove();reject(Error('CATALOG'));};document.head.append(s);});}
let catalog,records=new Map(),all=[],matches=[],currentPage=0,queryVersion=0,root=null,controller=null,busy=false,accessBusy=false,cache=new Map(),chain=Promise.resolve();
const nestedViewer=/(?:^|\/)__email_archiver\/index\.html$/i.test(decodeURIComponent(location.pathname));
const localUrl=p=>(nestedViewer?'../':'')+p;
const returnKey='email-archive-return:'+location.pathname,imagesKey='email-archive-images:'+location.pathname;
let remembered=null;
try{
 const stored=sessionStorage.getItem(returnKey);
 if(stored){
  const saved=JSON.parse(stored);
  // A direct link in an old message can create a new history entry.
  if(Number.isFinite(saved?.when)&&Date.now()-saved.when<=24*60*60*1000)remembered=saved;
  sessionStorage.removeItem(returnKey);
 }
}catch{/* Session storage may be unavailable on file://. */}
// Browser Back can restore the exact archive history entry without sessionStorage.
// Keep this snapshot for as long as that history entry exists.
try{const saved=history.state?.archiveReturn;if(saved?.values)remembered=saved;}catch{}
function clearArchiveReturn(){
 try{
  if(history.state?.archiveReturn){
   const next={...history.state};delete next.archiveReturn;history.replaceState(next,'');
  }
 }catch{}
}
clearArchiveReturn();
try{const saved=sessionStorage.getItem(imagesKey);if(saved!==null)$('autoImages').checked=saved==='on';}catch{/* Default to checked. */}
$('autoImages').addEventListener('change',()=>{try{sessionStorage.setItem(imagesKey,$('autoImages').checked?'on':'off');}catch{}render();});
function saveReturnPosition(section='browse'){
 const inputs=['query','accountFilter','labelFilter','dateFrom','dateTo','attachmentFilter','pageSize'];
 const values=Object.fromEntries(inputs.map(id=>[id,$(id).value]));
 const saved={values,page:currentPage,scrollY:window.scrollY,when:Date.now(),section};
 // Save email navigation; session storage also supports old direct Back links.
 try{history.replaceState({...history.state,archiveReturn:saved},'');}catch{}
 try{sessionStorage.setItem(returnKey,JSON.stringify(saved));}catch{}
}
function restoreReturnPosition(saved){
 if(!saved||remembered!==saved)return;
 remembered=null;
 const y=Math.max(0,Number(saved.scrollY)||0);
 requestAnimationFrame(()=>window.scrollTo(0,y));
}
window.addEventListener('pageshow',event=>{if(event.persisted){clearArchiveReturn();try{sessionStorage.removeItem(returnKey);}catch{}}});
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
// A failed saved directory handle is an access problem, not an index problem.
function accessFailure(e){
 return ['NotFoundError','NotAllowedError','SecurityError','InvalidStateError'].includes(e?.name)||
  /requested file or directory could not be found/i.test(e?.message||'')||
  e?.message==='WRONG_APP_ROOT';
}
async function probeDirectory(handle){
 // Verify that the handle still points to an accessible directory. Do not
 // enumerate any account's messages or inspect its HTML.
 const entries=handle.entries();
 try{await entries.next();}finally{await entries.return?.();}
}
async function readCatalog({persist=true}={}){
 const selectedRoot=root,revision=selectionVersion;
 try{
  if(selectedRoot)await probeDirectory(selectedRoot);
  if(root!==selectedRoot||revision!==selectionVersion)return;
  return await readCatalogView({persist});
 }catch(e){
  if(root!==selectedRoot||revision!==selectionVersion)return;
  if(selectedRoot&&accessFailure(e)){
   await forgetArchiveAccess();
   return readCatalogView({persist:false});
  }
  throw e;
 }
}
async function readCatalogView({persist=true}={}){
 const selectedRoot=root,revision=selectionVersion,loadVersion=++catalogLoadVersion;
 let nextCatalog,last,accountSync=null;
 if(selectedRoot){
  try{
   accountSync=await ArchiveAccountSync.sync(selectedRoot,{write:persist&&await permissionGranted(parentHandle,'readwrite')});
   nextCatalog=accountSync.manifest;
  }catch(e){if(accessFailure(e))throw e;nextCatalog=await C.manifest(selectedRoot);}
  if(nextCatalog?.format!==C.VERSION)throw Error('FORMAT');
 }else{
  // Classic local script tags load indexes via file:// without File System Access.
  // The whole archive can move intact: every index path is relative.
  for(const src of ['archived_emails/catalog/archive.js','archived_emails/catalog/archive.previous.js']){
   try{const result=await load(src+'?g='+Date.now());if(result?.format!==C.VERSION)throw Error('FORMAT');
    nextCatalog=result;break;}catch(e){last=e;}
  }
  if(!nextCatalog)nextCatalog=C.empty();
 }
 // A missing account must not prevent other accounts from opening. If any
 // metadata shard is unavailable, hide that entire account in this view.
 const groups=new Map(),unavailable=new Set(),usable=[];
 let invalidSegment=false;
 for(const seg of nextCatalog.segments){
  let account;
  try{account=ArchiveAccountSync.segmentAccount(seg);}catch{invalidSegment=true;continue;}
  if(unavailable.has(account))continue;
  try{
   const m=await loadArchiveSegment(seg.meta,selectedRoot);
   if(m?.kind!=='metadata'||!Array.isArray(m.records)||m.records.length!==seg.count)throw Error('CATALOG');
   if(!groups.has(account))groups.set(account,new Map());
   for(const r of m.records){
    if(r?.account!==account||typeof r.id!=='string'||typeof r.path!=='string'||!r.path.startsWith(account+'/')||!Array.isArray(r.labels)||!Array.isArray(r.attachments))throw Error('CATALOG');
    groups.get(account).set(r.account+'/'+r.id,r);
   }
   usable.push(seg);
  }catch{unavailable.add(account);groups.delete(account);}
 }
 if(root!==selectedRoot||revision!==selectionVersion||loadVersion!==catalogLoadVersion)return;
 const found=new Map();
 for(const [account,group] of groups)if(!unavailable.has(account))for(const [key,r] of group)found.set(key,r);
 const warnings=[];
 if(accountSync?.removed.length)warnings.push((accountSync.persisted?'Removed from catalog: ':'Missing account folders (skipped): ')+accountSync.removed.join(', ')+'.');
 if(accountSync?.added.length)warnings.push((accountSync.persisted?'Added to catalog: ':'Available copied accounts: ')+accountSync.added.join(', ')+'.');
 if(accountSync?.unindexed.length)warnings.push('Accounts without a complete usable index: '+accountSync.unindexed.join(', ')+'. Use Rebuild index to recover them.');
 if(accountSync?.damaged.length)warnings.push('Some account indexes need repair: '+accountSync.damaged.join(', ')+'.');
 if(accountSync?.deferred||accountSync?.requiresPublish&&!accountSync.persisted)warnings.push('Catalog changes are not saved yet. Enable write access or close another writer and reopen the archive.');
 if(unavailable.size||invalidSegment)warnings.push('Unavailable account indexes'+(unavailable.size?': '+[...unavailable].sort().join(', '):'')+'. Other accounts remain available. Enable archive access to synchronize missing folders, or use Rebuild index if indexes are damaged.');
 catalogWarning=warnings.join(' ');browseNotice(catalogWarning);
 queryVersion++;
 catalog={...nextCatalog,accounts:[...groups.keys()].sort(),segments:usable.filter(s=>!unavailable.has(ArchiveAccountSync.segmentAccount(s))),total:found.size};
 records=found;cache.clear();
 all=[...records.values()].sort((a,b)=>(b.date||'').localeCompare(a.date||'')||a.id.localeCompare(b.id));
 options('accountFilter',catalog.accounts,'All accounts');
 options('labelFilter',[...new Set(all.flatMap(r=>r.labels))].sort(),'All labels');
 const saved=remembered;
 if(saved?.values){
  for(const [id,value] of Object.entries(saved.values)){
   if(!['query','accountFilter','labelFilter','dateFrom','dateTo','attachmentFilter','pageSize'].includes(id)||typeof value!=='string')continue;
   const field=$(id);
   if(field.tagName!=='SELECT'||Array.from(field.options).some(option=>option.value===value))field.value=value;
  }
 }
 $('activeRootInfo').textContent='archived_emails/ · '+all.length.toLocaleString('en-GB')+' indexed messages';
 // Reloading the catalog (including when saved folder access is restored)
 // must not reset pagination. Only explicit filter changes reset to page one.
 const page=saved?Math.max(0,Math.floor(Number(saved.page)||0)):currentPage;
 const completed=await search({page});
 if(completed&&root===selectedRoot&&revision===selectionVersion)restoreReturnPosition(saved);
 if(root===selectedRoot&&revision===selectionVersion&&loadVersion===catalogLoadVersion)await loadRootAccounts(selectedRoot);
}
function metadataText(r){return C.fold([r.subject,r.from,r.to,r.cc,r.bcc].join(' '));}
async function search({page=0}={}){const v=++queryVersion;const terms=C.fold($('query').value).split(/\s+/).filter(Boolean);const acc=$('accountFilter').value,lab=$('labelFilter').value,from=$('dateFrom').value,to=$('dateTo').value,attach=$('attachmentFilter').value;const candidates=all.filter(r=>(!acc||r.account===acc)&&(!lab||r.labels.includes(lab))&&(!from||r.day&&r.day>=from)&&(!to||r.day&&r.day<=to)&&(!attach||(attach==='yes')===!!r.attachments.length));
 if(!terms.length){matches=candidates;currentPage=page;render();browseNotice(catalogWarning);return true;}const wanted=new Map(),found=new Set();for(const r of candidates){const key=r.account+'/'+r.id,meta=metadataText(r);if(terms.every(t=>meta.includes(t)))found.add(key);else wanted.set(key,meta);}
 $('resultInfo').textContent='Searching local text indexes…';let done=0;const unavailableSearch=new Set();for(const seg of catalog.segments){if(v!==queryVersion)return false;if(!seg.search)continue;let data=cache.get(seg.search);if(!data){try{data=await loadArchiveSegment(seg.search,root);if(data?.kind!=='search'||!Array.isArray(data.records)||data.records.some(x=>typeof x?.key!=='string'||typeof x.text!=='string'))throw Error('CATALOG');cache.set(seg.search,data);if(cache.size>4)cache.delete(cache.keys().next().value);}catch{unavailableSearch.add(ArchiveAccountSync.segmentAccount(seg));continue;}}for(const x of data.records){const meta=wanted.get(x.key);if(meta!==undefined){const hay=meta+' '+C.fold(x.text);if(terms.every(t=>hay.includes(t)))found.add(x.key);}}done++;if(done%5===0){$('resultInfo').textContent='Searched '+done+' indexes…';await new Promise(r=>setTimeout(r,0));}}
 if(v!==queryVersion)return false;matches=candidates.filter(r=>found.has(r.account+'/'+r.id));currentPage=page;render();browseNotice([catalogWarning,unavailableSearch.size?'Full-text search is incomplete for '+[...unavailableSearch].sort().join(', ')+'. Use Rebuild index to repair missing search indexes.':''].filter(Boolean).join(' '));return true;}
function render(){const size=+$('pageSize').value,pages=Math.max(1,Math.ceil(matches.length/size));currentPage=Math.min(currentPage,pages-1);$('rows').replaceChildren();for(const r of matches.slice(currentPage*size,(currentPage+1)*size)){const tr=document.createElement('tr');const tdDate=document.createElement('td');tdDate.className='date';tdDate.textContent=r.date?new Date(r.date).toLocaleString('en-GB',{dateStyle:'medium',timeStyle:'short'}):'Unknown date';const tdAddr=document.createElement('td');tdAddr.textContent=r.from||'(Not specified)';const to=document.createElement('span');to.className='address';to.textContent='To: '+(r.to||'—');tdAddr.append(to);const tdSub=document.createElement('td');const a=document.createElement('a');a.className='subject';a.textContent=r.subject||'(No subject)';a.href='archived_emails/'+r.path.split('/').map(encodeURIComponent).join('/')+'?fromArchive=1&images='+($('autoImages').checked?'auto':'manual')+'&theme='+(document.documentElement.getAttribute('data-theme')==='dark'?'dark':'light');a.target='_self';a.addEventListener('click',e=>{
 if(e.button===0&&!e.ctrlKey&&!e.metaKey&&!e.shiftKey&&!e.altKey)saveReturnPosition();
});tdSub.append(a);for(const text of [r.account,...r.labels]){const s=document.createElement('span');s.className='badge';s.textContent=text;tdSub.append(s);}const tdAtt=document.createElement('td');tdAtt.textContent=(r.attachments.length?'⌕ '+r.attachments.length:'—')+(r.original?' · EML':'');tr.append(tdDate,tdAddr,tdSub,tdAtt);$('rows').append(tr);}$('empty').hidden=!!matches.length;$('resultInfo').textContent=matches.length.toLocaleString('en-GB')+' messages'+(matches.length!==all.length?' of '+all.length.toLocaleString('en-GB'):'');for(const suffix of ['', 'Top']){$('pageInfo'+suffix).textContent=(currentPage+1)+' / '+pages;$('prev'+suffix).disabled=currentPage===0;$('next'+suffix).disabled=currentPage>=pages-1;}}
let timer;for(const id of ['query','accountFilter','labelFilter','dateFrom','dateTo','attachmentFilter'])$(id).addEventListener('input',()=>{clearTimeout(timer);timer=setTimeout(()=>search().catch(showBrowseError),200);});window.addEventListener('archive-theme-change',render);$('pageSize').onchange=render;for(const suffix of ['', 'Top']){$('prev'+suffix).onclick=()=>{if(currentPage>0){currentPage--;render();window.scrollTo(0,0);}};$('next'+suffix).onclick=()=>{if(currentPage+1<Math.ceil(matches.length/+$('pageSize').value)){currentPage++;render();window.scrollTo(0,0);}};}$('reset').onclick=()=>{for(const id of ['query','accountFilter','labelFilter','dateFrom','dateTo','attachmentFilter'])$(id).value='';search().catch(showBrowseError);};
function tab(which){
 $('browse').hidden=which!=='browse';
 $('import').hidden=which!=='import';
 for(const id of ['browse','import']){
  const button=$(id+'Tab'),active=id===which;
  button.classList.toggle('active',active);
  button.setAttribute('aria-pressed',String(active));
 }
}
$('browseTab').onclick=()=>tab('browse');
$('importTab').onclick=()=>tab('import');
tab('browse');
function ready(){
 const active=busy||repairBusy||readerBusy||accessBusy;
 $('start').disabled=active||!$('files').files.length;
 for(const id of ['files','importAccountSelect','importAccount','connectArchive','previewReaders','upgradeReaders','retainSignedEml','retainStarredEml','retainImportantEml'])$(id).disabled=active;
}
const viewerKey=location.pathname;
const folderPreference='app-root:'+viewerKey,accountPreference='account:'+viewerKey;
const parentName=decodeURIComponent(viewerKey).split('/').filter(Boolean).slice(-2,-1)[0]||'email_archiver_root';
let parentHandle=null,recentParent=null,selectionVersion=0,accountTouched=false;
let preferredAccount='personal',readerBusy=false,readerController=null;
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
async function dbPut(key,value){
 let db;
 try{
  db=await recentDB();
  await new Promise((resolve,reject)=>{
   const transaction=db.transaction('recent','readwrite');
   transaction.oncomplete=resolve;transaction.onerror=()=>reject(transaction.error);
   transaction.objectStore('recent').put(value,key);
  });
 }catch{/* File-based browser storage is optional. */}
 finally{db?.close();}
}
async function rememberAccount(value){
 try{C.accountName(value);}catch{return;}
 await dbPut(accountPreference,value);
}
function selectedAccount(){
 return C.accountName(($('importAccountSelect').value==='__new__'
  ?$('importAccount').value:$('importAccountSelect').value).trim());
}
function showNewAccount(){
 const isNew=$('importAccountSelect').value==='__new__';
 $('newAccountWrap').hidden=!isNew;
 if(!isNew){preferredAccount=$('importAccountSelect').value;void rememberAccount(preferredAccount);}
 ready();
}
$('importAccountSelect').addEventListener('change',()=>{accountTouched=true;showNewAccount();});
$('importAccount').addEventListener('input',()=>{accountTouched=true;ready();});
$('importAccount').addEventListener('change',()=>{
 try{preferredAccount=C.accountName($('importAccount').value.trim());void rememberAccount(preferredAccount);}catch{}
});
async function loadRootAccounts(handle){
 const version=selectionVersion,names=new Set();
 if(handle){
  for await(const [name,entry] of handle.entries())
   if(entry.kind==='directory')try{names.add(C.accountName(name));}catch{}
 }else for(const a of catalog?.accounts||[]){try{names.add(C.accountName(a));}catch{}}
 if(version!==selectionVersion||handle!==root)return;
 const select=$('importAccountSelect'),prior=select.value,sorted=[...names].sort();
 select.replaceChildren(...sorted.map(a=>new Option(a,a)),new Option('+ New account…','__new__'));
 const wanted=accountTouched?prior:preferredAccount;
 // Never choose the fictional 'example' account automatically for someone's real MBOX.
 select.value=names.has(wanted)?wanted:(sorted.find(a=>a!=='example')||'__new__');
 if(select.value==='__new__'&&!accountTouched)$('importAccount').value=preferredAccount;
 showNewAccount();
 $('accountInfo').textContent=names.size
  ?names.size+' account folder(s) in archived_emails/. Select one or choose New.'
  :'No indexed accounts yet. New emails will be saved under archived_emails/<account>/.';
}
async function validateAppParent(handle){
 // A page opened via file:// cannot get an OS handle for its own location.
 // Validate the requested app folder, refusing arbitrary email/data directories.
 if(!handle||handle.kind!=='directory'||handle.name!==parentName)throw Error('WRONG_APP_ROOT');
 const index=await C.read(handle,'index.html');
 if(!index.includes('assets/app.js')||!index.includes('archived_emails/'))throw Error('WRONG_APP_ROOT');
 if(!await C.exists(handle,'assets/core.js'))throw Error('WRONG_APP_ROOT');
 return handle;
}
async function permissionGranted(handle,mode){
 if(!handle)return false;
 if(typeof handle.queryPermission!=='function')return true;
 try{return await handle.queryPermission({mode})==='granted';}catch{return false;}
}
function setAccessStatus(message,kind=''){
 const status=$('accessStatus');
 if(!kind){status.textContent=message;return;}
 const prefix=document.createElement('strong');
 prefix.className=kind==='ready'?'access-ready':'access-error';
 prefix.textContent=kind==='ready'?'Archive access ready:':'Archive access not enabled:';
 status.replaceChildren(prefix,document.createTextNode(' '+message));
}
async function forgetArchiveAccess(){
 // Invalidate outstanding loads before restoring the independent local view.
 root=null;parentHandle=null;recentParent=null;selectionVersion++;queryVersion++;
 cache.clear();
 $('connectArchive').textContent='Enable archive access';
 setAccessStatus('The folder was moved, is unavailable or access has expired. Select the folder containing this index.html again to enable writes. Browsing uses local relative paths.','error');
 await dbPut(folderPreference,null);
}
async function bindParent(parent,{create=false,syncWrite=true}={}){
 await validateAppParent(parent);
 const data=await parent.getDirectoryHandle('archived_emails',{create});
 await probeDirectory(data);
 parentHandle=parent;recentParent=parent;root=data;selectionVersion++;
 await dbPut(folderPreference,parent);
 try{await readCatalog({persist:syncWrite});}
 catch(e){
  // Genuine catalog failures remain visible until a successful catalog load.
  // Never label a stale filesystem authorization as index corruption.
  if(accessFailure(e))throw e;
  catalogWarning='The current archive index needs repair: '+errorText(e);
  browseNotice(catalogWarning);
 }
 if(!root||parentHandle!==parent)throw Error('ARCHIVE_ACCESS_REQUIRED');
 const canWrite=await permissionGranted(parent,'readwrite');
 if(canWrite)setAccessStatus('/'+parent.name+'/archived_emails/. Import and Check existing will not ask for a folder.','ready');
 else setAccessStatus('Read access restored for archived_emails/. Click Enable archive access to permit importing and rebuilding.');
 return root;
}
async function ensureArchive({write=false}={}){
 // No picker, permission request, or directory selection is permitted here.
 // Those actions belong only to the explicit Enable archive access button.
 const parent=parentHandle||recentParent;
 if(!parent)throw Error('ARCHIVE_ACCESS_REQUIRED');
 if(!await permissionGranted(parent,write?'readwrite':'read')){
  if(!await permissionGranted(parent,'read')){
   await forgetArchiveAccess();
   await readCatalog({persist:false}).catch(showBrowseError);
  }else setAccessStatus('Read access is available. Click Enable archive access to permit writing.','error');
  throw Error('ARCHIVE_ACCESS_REQUIRED');
 }
 try{
  // Resolve the child again, rather than relying on a handle saved before
  // a folder move, replacement, or sync-drive remount.
  await validateAppParent(parent);
  const data=await parent.getDirectoryHandle('archived_emails',{create:false});
  await probeDirectory(data);
  if(root&&parent===parentHandle){
   if(root!==data){root=data;selectionVersion++;}
   return data;
  }
  return await bindParent(parent,{create:false,syncWrite:false});
 }catch(e){
  if(!accessFailure(e)&&e?.message!=='ARCHIVE_ACCESS_REQUIRED')throw e;
  await forgetArchiveAccess();
  await readCatalog({persist:false}).catch(showBrowseError);
  throw Error('ARCHIVE_ACCESS_REQUIRED');
 }
}
$('connectArchive').onclick=async()=>{
 if(busy||repairBusy||readerBusy||accessBusy)return;
 accessBusy=true;ready();
 setAccessStatus('Authorizing only this application folder…');
 try{
  if(!window.showDirectoryPicker)throw Error('BROWSER');
  // Explicit Enable/Renew always lets the user choose the current folder.
  // A remembered handle can point to the old location even if permission
  // still says granted. Never silently reuse it on an explicit renewal.
  const parent=await window.showDirectoryPicker({mode:'readwrite',id:'email-archiver-app'});
  await validateAppParent(parent);
  if(!await permissionGranted(parent,'readwrite')){
   if(typeof parent.requestPermission!=='function'||
      await parent.requestPermission({mode:'readwrite'})!=='granted')
    throw Error('APP_PERMISSION');
  }
  await bindParent(parent,{create:true});
  $('connectArchive').textContent='Renew archive access';
 }catch(e){
  if(e.name==='AbortError')setAccessStatus('Archive authorization cancelled. No files were changed.');
  else if(accessFailure(e)&&e.message!=='WRONG_APP_ROOT'){
   await forgetArchiveAccess();
   await readCatalog({persist:false}).catch(showBrowseError);
  }else setAccessStatus(errorText(e),'error');
 }finally{accessBusy=false;ready();}
};
async function loadRecent(){
 let db;
 try{
  db=await recentDB();
  const [handle,account]=await Promise.all([dbGet(db,folderPreference),dbGet(db,accountPreference)]);
  if(typeof account==='string'&&!accountTouched){
   try{preferredAccount=C.accountName(account);$('importAccount').value=preferredAccount;}catch{}
  }
  if(handle?.kind==='directory'){
   recentParent=handle;
   let permitted=false;
   try{permitted=typeof handle.queryPermission!=='function'||
     await handle.queryPermission({mode:'read'})==='granted';}catch{}
   if(permitted&&!root&&!accessBusy&&!busy&&!repairBusy&&!readerBusy){
    accessBusy=true;ready();
    try{await bindParent(handle);if(await permissionGranted(handle,'readwrite'))$('connectArchive').textContent='Renew archive access';}
    catch(e){
     if(accessFailure(e)){
      await forgetArchiveAccess();
      await readCatalog({persist:false}).catch(showBrowseError);
     }
     // No permission prompt and no automatic creation.
    }
    finally{accessBusy=false;ready();}
   }
  }
 }catch{/* Browser profile storage may be disabled for file:// */}
 finally{
  db?.close();
  if(!root)try{await loadRootAccounts(null);}catch{}
 }
}
void loadRecent();
$('files').onchange=()=>{const files=Array.from($('files').files);$('fileInfo').textContent=files.length+' files · '+(files.reduce((s,f)=>s+f.size,0)/1024**3).toFixed(2)+' GiB. Allow at least this space plus a reserve on the destination drive.';ready();};
function progress(s){$('progress').value=s.totalBytes?Math.min(100,100*s.bytes/s.totalBytes):0;for(const [id,k] of [['readCount','read'],['newCount','new'],['dupeCount','duplicates'],['emlSavedCount','emlSaved'],['emlReusedCount','emlReused'],['errorCount','errors']])$(id).textContent=s[k].toLocaleString('en-GB');$('progressDetail').textContent=(s.bytes/1024**2).toFixed(1)+' / '+(s.totalBytes/1024**2).toFixed(1)+' MiB read · '+s.committed+' changes committed to the catalog';}
$('start').onclick=async()=>{
 if(busy||repairBusy||readerBusy||accessBusy)return;
 const sourceFiles=Array.from($('files').files);
 if(!sourceFiles.length){notice('Choose at least one MBOX file first.');return;}
 // Reserve the operation before the first await: rapid clicks and catalog
 // preparation must not start two writers or leave Stop unavailable.
 let target,acc,importStarted=false;
 busy=true;controller=new AbortController();
 $('progressPanel').hidden=false;$('status').textContent='Authorizing this archive folder…';
 $('progressDetail').textContent='Preparing archived_emails/. Authorization is managed separately above.';
 notice('');$('existingProgressPanel').hidden=true;
 readerControls(true);$('connectArchive').disabled=true;
 for(const id of ['retainSignedEml','retainStarredEml','retainImportantEml'])$(id).disabled=true;
 $('stop').hidden=false;ready();
 try{
  target=await ensureArchive({write:true});
  const reconciled=await ArchiveAccountSync.sync(target,{write:true});
  if(reconciled.requiresPublish&&!reconciled.persisted||reconciled.damaged.length)throw Error(reconciled.error||'CATALOG');
  acc=selectedAccount();
  preferredAccount=acc;void rememberAccount(acc);
  if(controller.signal.aborted){$('status').textContent='Import stopped';return;}
  $('progressPanel').hidden=false;$('status').textContent='Importing MBOX into '+acc+'…';
  $('progress').value=0;$('progressDetail').textContent='Starting incremental MBOX read…';
  const imp=new C.Importer(target,{signal:controller.signal,onProgress:progress,
   emlPolicy:{signed:$('retainSignedEml').checked,encrypted:$('retainSignedEml').checked,
    starred:$('retainStarredEml').checked,important:$('retainImportantEml').checked}});
  importStarted=true;
  const report=await imp.run(sourceFiles,acc);
  $('status').textContent=report.interrupted?'Import stopped':'Import complete';
  if(report.issues.length)notice('Some messages were skipped; error details are saved in '+acc+'/catalog/import-….json. Source MBOX files were not modified.');
  try{await readCatalog();await loadRootAccounts(target);}catch(e){browseNotice('Could not reload archived_emails catalog: '+errorText(e));}
  if(report.interrupted&&!report.issues.length)notice('Import stopped safely. Previously committed messages remain saved in archived_emails/.');
  else if(!report.issues.length)notice('Import saved to archived_emails/'+acc+'/. Browse now displays the updated index. No files outside archived_emails/ were rewritten.');
 }catch(e){
  if(controller.signal.aborted){$('status').textContent='Import stopped';notice('Import stopped safely. Saved changes remain in archived_emails/.');}
  else{notice(errorText(e));$('status').textContent=importStarted?'Import failed':'Import not started';$('progressDetail').textContent=errorText(e);}
  if(target)try{await readCatalog();}catch{}
 }finally{
  busy=false;$('stop').hidden=true;$('connectArchive').disabled=false;
  $('previewReaders').disabled=false;$('upgradeReaders').disabled=false;
  $('files').disabled=false;$('importAccount').disabled=false;$('importAccountSelect').disabled=false;
  for(const id of ['retainSignedEml','retainStarredEml','retainImportantEml'])$(id).disabled=false;
  ready();
 }
};
$('stop').onclick=()=>{
 controller?.abort();
 $('status').textContent='Stopping after the current message and committing the catalog…';
};
function errorText(e){
 const msgs={
  APP_PERMISSION:'Write permission was not granted. Click Enable archive access, then select/authorize the folder containing this index.html.',
  ARCHIVE_ACCESS_REQUIRED:'Click Enable archive access once to authorize archived_emails/. Start import and Check existing never open a folder chooser.',
  WRONG_APP_ROOT:'Choose the folder containing the index.html you opened (/'+parentName+'/), not archived_emails/ or a different archive.',
  RECENT_ACCESS:'Permission to the application folder expired. Click Enable archive access and choose the folder containing this index.html again.',
  ARCHIVE_LOCK_TIMEOUT:'Could not acquire the archive write lock. Close other writing tabs and check syncing.',
  LOCKED:'Another import or reindex is writing to archived_emails/. Close that tab before retrying.',
  ACCOUNT:'Enter a valid account folder name, such as personal.',
  BROWSER:'Import/reindex requires desktop Chrome or Edge with File System Access API.',
  CATALOG:'Some saved catalog files are damaged. Rebuild index can recover them from saved HTML.',
  FORMAT:'Unsupported or damaged catalog format.',
  REINDEX_INCOMPLETE:'Catalog could not be rebuilt from all saved HTML. Previous indexes were preserved.'
 };
 if(accessFailure(e)&&e?.message!=='WRONG_APP_ROOT')return 'Archive folder access is unavailable. If the archive was moved, click Enable archive access and select its current folder. A move alone does not require Rebuild index.';
 return msgs[e?.message]||('Operation failed ('+(e?.message||e?.name||'unknown')+'). Check folder permissions, free space and archive locks.');
}
function showError(e){notice(errorText(e));}
function showBrowseError(e){catalogWarning=errorText(e);browseNotice(catalogWarning);}


let repairBusy=false,repairController=null;
function readerControls(){ready();}
function beginMaintenance(title){
 $('progressPanel').hidden=true;notice('');
 $('existingProgressPanel').hidden=false;
 $('existingProgressTitle').textContent=title;
 $('existingProgress').max=1;$('existingProgress').removeAttribute('value');
 $('existingProgressDetail').textContent='Preparing archive…';
 $('readerStatus').textContent='';$('catalogStatus').textContent='';
}
function maintenanceProgress(s){
 const bar=$('existingProgress');
 if(s.phase==='counting'){
  bar.removeAttribute('value');
  $('existingProgressDetail').textContent='Counting saved HTML files · '+s.counted+' found…';
 }else if(Number.isFinite(s.total)){
  bar.max=Math.max(s.total,1);
  // Reserve the last step until verification or index publication has finished.
  bar.max+=1;
  bar.value=Math.min(s.scanned,bar.max-1);
  $('existingProgressDetail').textContent=s.scanned+' / '+s.total+' HTML files processed'+(s.phase==='publishing'?' · Saving catalog…':'');
 }else{
  bar.removeAttribute('value');
  $('existingProgressDetail').textContent=s.phase==='catalog'?'Validating catalog and search indexes…':'Preparing archive…';
 }
}
function finishMaintenance(title,complete){
 $('existingProgressTitle').textContent=title;
 const bar=$('existingProgress');
 if(complete)bar.value=bar.max;
 else if(!bar.hasAttribute('value'))bar.value=0;
}
$('previewReaders').onclick=async()=>{
 if(busy||repairBusy||readerBusy||accessBusy)return;
 readerBusy=true;readerController=new AbortController();ready();
 beginMaintenance('Checking existing messages…');$('stopCheck').hidden=false;
 $('readerStatus').textContent='Checking archived_emails/ (read-only)…';
 try{
  const target=await ensureArchive({write:false});
  const result=await ArchiveReindex.checkMissing(target,{
   signal:readerController.signal,onProgress:v=>{
    maintenanceProgress(v);
    $('readerStatus').textContent=v.scanned+' HTML messages checked · '+(v.errors||0)+' unreadable/invalid · '+(v.brokenAttachments||0)+' missing attachments';
    $('catalogStatus').textContent=v.indexed+' indexed · '+v.missing+' unindexed · '+(v.stale||0)+' stale references'+(v.damaged?' · damaged catalog':'');
   }
  });
  finishMaintenance(result.interrupted?'Check stopped':'Check complete',!result.interrupted);
  $('readerStatus').textContent=result.interrupted?'Check existing stopped. No files were changed.':
   result.scanned+' HTML messages checked · '+result.errors+' unreadable/invalid · '+result.brokenAttachments+' missing attachments · '+result.missingOriginals+' missing EML copies. No files were changed.';
  $('catalogStatus').textContent=result.interrupted?'Catalog verification incomplete.':result.damaged?'Catalog is missing or damaged. Use Rebuild index to recover it from saved HTML.':
   result.missing||result.stale?result.missing+' saved messages are unindexed · '+result.stale+' stale catalog references. Use Rebuild index.':
   'Catalog matches the saved files; '+result.indexed+' messages indexed.';
 }catch(e){finishMaintenance('Check failed',false);$('readerStatus').textContent='Check existing could not finish: '+errorText(e);}
 finally{readerBusy=false;$('stopCheck').hidden=true;ready();}
};
$('upgradeReaders').onclick=async()=>{
 if(busy||repairBusy||readerBusy||accessBusy)return;
 repairBusy=true;repairController=new AbortController();ready();
 beginMaintenance('Rebuilding index…');$('stopReindex').hidden=false;
 $('catalogStatus').textContent='Rebuilding indexes from saved HTML in archived_emails/…';
 try{
  const target=await ensureArchive({write:true});
  const result=await ArchiveReindex.rebuild(target,{
   signal:repairController.signal,onProgress:v=>{
    maintenanceProgress(v);
    $('catalogStatus').textContent=v.scanned+' HTML files read · '+v.indexed+' indexed · '+v.errors+' errors';
   }
  });
  if(result.interrupted){finishMaintenance('Rebuild stopped',false);$('catalogStatus').textContent='Rebuild stopped; the previous catalog was preserved.';return;}
  $('catalogStatus').textContent='Rebuilt index: '+result.indexed+' messages · '+(result.brokenAttachments||0)+' missing attachments · '+(result.missingOriginals||0)+' missing EML copies. Message HTML and attachments were not changed.';
  await readCatalog();finishMaintenance('Rebuild complete',true);
 }catch(e){finishMaintenance('Rebuild failed',false);$('catalogStatus').textContent='Rebuild index failed: '+errorText(e);}
 finally{repairBusy=false;$('stopReindex').hidden=true;ready();}
};
$('stopReindex').onclick=()=>repairController?.abort();
$('stopCheck').onclick=()=>readerController?.abort();
window.addEventListener('beforeunload',e=>{if(busy||repairBusy||readerBusy||accessBusy){e.preventDefault();e.returnValue='';}});
window.ArchiveUI={readCatalog,search,load,get root(){return root;},get records(){return records;},get catalog(){return catalog;}};
readCatalog().catch(showBrowseError);
})();

