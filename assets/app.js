(function(){'use strict';
const C=ArchiveCore,$=id=>document.getElementById(id);let pending=null;
window.MailArchive={receive:data=>{if(pending)pending(data);}};
function loadScript(src){return new Promise((resolve,reject)=>{const s=document.createElement('script');let result;pending=x=>result=x;s.src=src;s.onload=()=>{pending=null;s.remove();result?resolve(result):reject(Error('CATALOG'));};s.onerror=()=>{pending=null;s.remove();reject(Error('CATALOG'));};document.head.append(s);});}
let catalog,records=new Map(),all=[],matches=[],currentPage=0,queryVersion=0,root=null,controller=null,busy=false,cache=new Map(),chain=Promise.resolve();
function load(src){const p=chain.then(()=>loadScript(src));chain=p.catch(()=>{});return p;}
function notice(s){$('notice').textContent=s;$('notice').hidden=!s;}
function options(id,items,first){const el=$(id),old=el.value;el.replaceChildren(new Option(first,''));for(const s of items)el.add(new Option(s,s));if(items.includes(old))el.value=old;}
async function readCatalog(){
 let last;catalog=null;
 for(const src of [C.MANIFEST,C.PREVIOUS,'archive.js','archive.previous.js']){
  try{const result=await load(src+'?g='+Date.now());if(result?.format!==C.VERSION)throw Error('FORMAT');catalog=result;break;}catch(e){last=e;}
 }
 if(!catalog)throw last||Error('CATALOG');
 records.clear();cache.clear();for(const seg of catalog.segments){const m=await load(seg.meta);for(const r of m.records)records.set(r.account+'/'+r.id,r);}all=[...records.values()].sort((a,b)=>(b.date||'').localeCompare(a.date||'')||a.id.localeCompare(b.id));$('total').textContent=all.length.toLocaleString('en-GB');options('accountFilter',catalog.accounts,'All accounts');options('labelFilter',[...new Set(all.flatMap(r=>r.labels))].sort(),'All labels');$('accounts').replaceChildren(...catalog.accounts.map(a=>new Option(a)));await search();}
function metadataText(r){return C.fold([r.subject,r.from,r.to,r.cc,r.bcc].join(' '));}
async function search(){const v=++queryVersion;currentPage=0;const terms=C.fold($('query').value).split(/\s+/).filter(Boolean);const acc=$('accountFilter').value,lab=$('labelFilter').value,from=$('dateFrom').value,to=$('dateTo').value,attach=$('attachmentFilter').value;const candidates=all.filter(r=>(!acc||r.account===acc)&&(!lab||r.labels.includes(lab))&&(!from||r.day&&r.day>=from)&&(!to||r.day&&r.day<=to)&&(!attach||(attach==='yes')===!!r.attachments.length));
 if(!terms.length){matches=candidates;render();return;}const wanted=new Map(),found=new Set();for(const r of candidates){const key=r.account+'/'+r.id,meta=metadataText(r);if(terms.every(t=>meta.includes(t)))found.add(key);else wanted.set(key,meta);}
 $('resultInfo').textContent='Searching local text indexes…';let done=0;for(const seg of catalog.segments){if(v!==queryVersion)return;if(!seg.search)continue;let data=cache.get(seg.search);if(!data){data=await load(seg.search);cache.set(seg.search,data);if(cache.size>4)cache.delete(cache.keys().next().value);}for(const x of data.records){const meta=wanted.get(x.key);if(meta!==undefined){const hay=meta+' '+C.fold(x.text);if(terms.every(t=>hay.includes(t)))found.add(x.key);}}done++;if(done%5===0){$('resultInfo').textContent='Searched '+done+' indexes…';await new Promise(r=>setTimeout(r,0));}}
 if(v!==queryVersion)return;matches=candidates.filter(r=>found.has(r.account+'/'+r.id));render();}
function render(){const size=+$('pageSize').value,pages=Math.max(1,Math.ceil(matches.length/size));currentPage=Math.min(currentPage,pages-1);$('rows').replaceChildren();for(const r of matches.slice(currentPage*size,(currentPage+1)*size)){const tr=document.createElement('tr');const tdDate=document.createElement('td');tdDate.className='date';tdDate.textContent=r.date?new Date(r.date).toLocaleString('en-GB',{dateStyle:'medium',timeStyle:'short'}):'Unknown date';const tdAddr=document.createElement('td');tdAddr.textContent=r.from||'(Not specified)';const to=document.createElement('span');to.className='address';to.textContent='To: '+(r.to||'—');tdAddr.append(to);const tdSub=document.createElement('td');const a=document.createElement('a');a.className='subject';a.textContent=r.subject||'(No subject)';a.href=r.path.split('/').map(encodeURIComponent).join('/');a.target='_blank';a.rel='noopener noreferrer';tdSub.append(a);for(const text of [r.account,...r.labels]){const s=document.createElement('span');s.className='badge';s.textContent=text;tdSub.append(s);}const tdAtt=document.createElement('td');tdAtt.textContent=r.attachments.length?'⌕ '+r.attachments.length:'—';tr.append(tdDate,tdAddr,tdSub,tdAtt);$('rows').append(tr);}$('empty').hidden=!!matches.length;$('resultInfo').textContent=matches.length.toLocaleString('en-GB')+' messages'+(matches.length!==all.length?' of '+all.length.toLocaleString('en-GB'):'');$('pageInfo').textContent=(currentPage+1)+' / '+pages;$('prev').disabled=currentPage===0;$('next').disabled=currentPage>=pages-1;}
let timer;for(const id of ['query','accountFilter','labelFilter','dateFrom','dateTo','attachmentFilter'])$(id).addEventListener('input',()=>{clearTimeout(timer);timer=setTimeout(()=>search().catch(showError),200);});$('pageSize').onchange=render;$('prev').onclick=()=>{currentPage--;render();};$('next').onclick=()=>{currentPage++;render();};$('reset').onclick=()=>{for(const id of ['query','accountFilter','labelFilter','dateFrom','dateTo','attachmentFilter'])$(id).value='';search().catch(showError);};
function tab(which){$('browse').hidden=which!=='browse';$('import').hidden=which!=='import';$('reindex').hidden=which!=='reindex';for(const id of ['browse','import','reindex'])$(id+'Tab').classList.toggle('active',id===which);}
$('browseTab').onclick=()=>tab('browse');$('importTab').onclick=()=>tab('import');$('reindexTab').onclick=()=>tab('reindex');
function ready(){$('start').disabled=busy||!root||!$('files').files.length;}
$('chooseDir').onclick=async()=>{try{if(!window.showDirectoryPicker)throw Error('BROWSER');root=await showDirectoryPicker({mode:'readwrite',id:'mailarchive'});const m=await C.manifest(root);$('dirInfo').textContent='Archive root: '+root.name+' · '+m.total.toLocaleString('en-GB')+' messages. '+(!m.generation?'The application will be copied into this folder when you import.':'The existing archive will be extended.');ready();}catch(e){if(e.name!=='AbortError')showError(e);}};
$('files').onchange=()=>{const files=Array.from($('files').files);$('fileInfo').textContent=files.length+' files · '+(files.reduce((s,f)=>s+f.size,0)/1024**3).toFixed(2)+' GiB. Allow at least this space plus a reserve on the destination drive.';ready();};
async function install(dir){const has=await C.exists(dir,'index.html');if(has){const html=await C.read(dir,'index.html');if(!html.includes('assets/core.js'))throw Error('NONARCHIVE');}for(const [p,s] of Object.entries(ArchiveBundle))await C.write(dir,p,s);await C.write(dir,'assets/bundle.js','globalThis.ArchiveBundle='+C.json(ArchiveBundle)+';');if(!await C.exists(dir,C.MANIFEST)&&!await C.exists(dir,'archive.js'))await C.write(dir,C.MANIFEST,C.wrap(C.empty()));}
function progress(s){$('progress').value=s.totalBytes?Math.min(100,100*s.bytes/s.totalBytes):0;for(const [id,k] of [['readCount','read'],['newCount','new'],['dupeCount','duplicates'],['refreshedCount','refreshed'],['errorCount','errors']])$(id).textContent=s[k].toLocaleString('en-GB');$('progressDetail').textContent=(s.bytes/1024**2).toFixed(1)+' / '+(s.totalBytes/1024**2).toFixed(1)+' MiB read · '+s.committed+' changes committed to the catalog';}
$('start').onclick=async()=>{if(busy)return;let acc;try{acc=C.accountName($('importAccount').value.trim());}catch(e){showError(e);return;}busy=true;controller=new AbortController();$('progressPanel').hidden=false;$('stop').hidden=false;$('chooseDir').disabled=true;$('files').disabled=true;$('importAccount').disabled=true;$('refreshExisting').disabled=true;ready();notice('');$('status').textContent='Importing. Keep this tab open…';try{await install(root);const imp=new C.Importer(root,{signal:controller.signal,onProgress:progress,refreshExisting:$('refreshExisting').checked});const report=await imp.run(Array.from($('files').files),acc);$('status').textContent=report.interrupted?'Import stopped safely. Select the same MBOX files to resume.':'Import complete. Open index.html in the selected archive root.';if(report.issues.length)notice('Some messages could not be imported. Source offsets and error codes are in '+acc+'/catalog/import-….json. Source files were not modified.');if(root.name===decodeURIComponent(location.pathname.split('/').at(-2)))await readCatalog();}catch(e){$('status').textContent='Import stopped. Committed batches remain saved; you can reimport the same file.';showError(e);}finally{busy=false;$('stop').hidden=true;$('chooseDir').disabled=false;$('files').disabled=false;$('importAccount').disabled=false;$('refreshExisting').disabled=false;ready();}};
$('stop').onclick=()=>{controller?.abort();$('status').textContent='Finishing the current message and committing the catalog…';};
function showError(e){const msgs={ACCOUNT:'Enter a valid account folder name, such as personal.',BROWSER:'Import requires a current desktop Chrome or Edge with the File System Access API.',CATALOG:'The catalog could not be loaded. Check the folder is complete and retry importing from your backup.',FORMAT:'Unsupported or damaged catalog format.',NONARCHIVE:'The selected folder contains another index.html. Choose an empty folder or an archive created by this tool.'};notice(msgs[e.message]||('Operation failed ('+e.name+'). Check permissions, free space and whether another tab is writing to the archive.'));}

let repairRoot=null,repairBusy=false,repairController=null,repairPreview=0;
$('chooseReindexDir').onclick=async()=>{
 try{
  if(!window.showDirectoryPicker)throw Error('BROWSER');
  const chosen=await showDirectoryPicker({mode:'readwrite',id:'mailarchive-rebuild'});
  if(!await C.exists(chosen,'index.html'))throw Error('NONARCHIVE');
  repairRoot=chosen;repairPreview=0;
  $('reindexDirInfo').textContent='Archive root: '+chosen.name;
  $('previewReindex').disabled=false;$('startReindex').disabled=true;
  $('reindexStatus').textContent='Folder selected. Preview the file scan first.';
 }catch(e){if(e.name!=='AbortError')showError(e);}
};
$('previewReindex').onclick=async()=>{
 if(!repairRoot||repairBusy)return;
 repairBusy=true;$('previewReindex').disabled=true;$('startReindex').disabled=true;
 $('chooseReindexDir').disabled=true;$('reindexStatus').textContent='Scanning folders (read only)…';
 try{
  repairPreview=0;
  for await(const entry of ArchiveReindex.scan(repairRoot)){
   repairPreview++;
   if(repairPreview%200===0){$('reindexStatus').textContent=repairPreview+' message pages found…';await new Promise(resolve=>setTimeout(resolve,0));}
  }
  $('reindexStatus').textContent=repairPreview+' HTML message files found. This operation will regenerate the catalog, not the emails. Make sure your backup is complete.';
  $('startReindex').disabled=repairPreview===0;
 }catch(e){showError(e);}finally{repairBusy=false;$('previewReindex').disabled=false;$('chooseReindexDir').disabled=false;}
};
$('startReindex').onclick=async()=>{
 if(repairBusy||!repairRoot||!repairPreview||busy)return;
 repairBusy=true;repairController=new AbortController();$('startReindex').disabled=true;
 $('chooseReindexDir').disabled=true;$('previewReindex').disabled=true;
 $('stopReindex').hidden=false;$('reindexStatus').textContent='Rebuilding search indexes. Leave this tab open…';
 try{
  const stats=await ArchiveReindex.rebuild(repairRoot,{signal:repairController.signal,onProgress:s=>{
   $('reindexStatus').textContent=s.scanned+' HTML pages scanned · '+s.indexed+' indexed · '+s.errors+' errors · '+s.brokenAttachments+' missing attachments'+(s.committed?' · new catalog published':'');
  }});
  $('reindexStatus').textContent=stats.interrupted?'Stopped. The previous catalog is still active.':('Finished. '+stats.indexed+' messages indexed, '+stats.errors+' errors, '+stats.brokenAttachments+' broken attachments. Reopen index.html in the archive root.');
  if(!stats.interrupted&&repairRoot.name===decodeURIComponent(location.pathname.split('/').at(-2)))await readCatalog();
 }catch(e){showError(e);$('reindexStatus').textContent='Rebuild failed. The previous catalog should still be available; check your archive backup.';}
 finally{repairBusy=false;$('chooseReindexDir').disabled=false;$('previewReindex').disabled=false;$('startReindex').disabled=repairPreview===0;$('stopReindex').hidden=true;}
};
$('stopReindex').onclick=()=>repairController?.abort();
window.addEventListener('beforeunload',e=>{if(busy||repairBusy){e.preventDefault();e.returnValue='';}});
window.ArchiveUI={readCatalog,search,install,load,get root(){return root;},get records(){return records;},get catalog(){return catalog;}};
readCatalog().catch(showError);
})();

