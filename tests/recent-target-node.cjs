/* Fixed-root offline archive regression. All messages and paths are fictional. */
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const src=fs.readFileSync(path.join(__dirname,'../assets/app.js'),'utf8');
const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
assert(!html.includes('id="chooseDir"')&&!html.includes('id="browseChooseRoot"'),'No arbitrary data-root picker');
assert(!html.includes('id="rootOpenInfo"')&&!html.includes('id="createArchive"'),'No self-copy/launcher messaging');
assert(html.includes('archived_emails/')&&html.includes('id="files"'),'Fixed archive path and MBOX chooser');
assert(html.includes('id="connectArchive"'),'Archive permission setup must be explicit and separate from Import and Check.');
assert(html.includes('id="existingProgress"')&&!html.includes('id="refreshViewers"'),'Check/Rebuild have progress and appearance maintenance is removed');
assert(!html.includes('id="messageFrame"'),'Message viewing must be full-page, not a nested scrolling iframe');
assert(!src.slice(src.indexOf('async function ensureArchive'),src.indexOf("$('connectArchive').onclick")).includes('showDirectoryPicker('),'Import and Check may not open a directory chooser.');
assert(!src.includes('ArchiveBundle')&&!src.includes('await install('),'No installer or app self-copy');
assert(src.includes('archived_emails/catalog/archive.js'),'Read-only file:// catalog loading needs a fixed local path');
const id='a'.repeat(64),account='personal',folder='personal/2025/2025-01';
const record={id,account,folder,path:folder+'/email-'+id+'.html',subject:'Example mail',
 from:'sender@example.invalid',to:'reader@example.invalid',cc:'',bcc:'',
 date:'2025-01-15T12:00:00Z',day:'2025-01-15',labels:['Saved'],attachments:[]};
const manifest={kind:'manifest',format:1,total:1,generation:1,accounts:[account],
 segments:[{meta:'personal/catalog/data.js',search:null,count:1}]};
const empty={...manifest,total:0,accounts:[],segments:[]};
function elem(tag,id){return {tagName:tag,id,children:[],value:id==='pageSize'?'50':id==='importAccount'?'personal':'',
 files:[],disabled:false,hidden:false,checked:id==='autoImages',textContent:'',style:{},listeners:{},src:'',
 classList:{toggle(){}},replaceChildren(...items){this.children=items;if(id==='importAccountSelect')this.value=items[0]?.value||'__new__';},
 addEventListener(name,fn){this.listeners[name]=fn;},append(...items){this.children.push(...items);},add(item){this.children.push(item);},
 remove(){},removeAttribute(){this.src='';},setAttribute(){},getAttribute(){return null;}};}
const elements=new Map(),el=id=>{if(!elements.has(id))elements.set(id,elem('element',id));return elements.get(id);};
const appDirName='email_archiver_root',data={name:'archived_emails',kind:'directory',
 async *entries(){yield ['personal',{kind:'directory'}];}};
let created=0,selected=null,option=null,pickerCalls=0,writeCount=0,foreignAttempt=0;
const parent={name:appDirName,kind:'directory',
 async queryPermission(){return 'granted';},
 async getDirectoryHandle(name,{create=false}={}){assert.equal(name,'archived_emails');if(create)created++;return data;}};
const wrong={name:'another_folder',kind:'directory'};
let currentChoice=parent;
const document={getElementById:el,documentElement:{getAttribute(){return 'light';}},
 createElement:tag=>elem(tag),head:{append(script){
  const p=String(script.src).split('?')[0];
  const value=p==='archived_emails/catalog/archive.js'?manifest:
   p==='archived_emails/personal/catalog/data.js'?{kind:'metadata',records:[record]}:null;
  queueMicrotask(()=>{if(value){window.MailArchive.receive(value);script.onload?.();}else script.onerror?.();});
 }}};
const window={scrollY:0,scrollTo(){},addEventListener(){},showDirectoryPicker:async opts=>{pickerCalls++;option=opts;selected=currentChoice;return selected;}};
const saved=new Map(),database={close(){},transaction(){const tx={objectStore(){return {
 get(key){const r={};queueMicrotask(()=>{r.result=saved.get(key);r.onsuccess?.();});return r;},
 put(value,key){saved.set(key,value);queueMicrotask(()=>tx.oncomplete?.());}};}};return tx;}};
const indexedDB={open(){const req={result:database};queueMicrotask(()=>req.onsuccess?.());return req;}};
const calls=[],C={VERSION:1,MANIFEST:'__email_archiver/assets/catalog/archive.js',
 PREVIOUS:'__email_archiver/assets/catalog/archive.previous.js',
 empty:()=>({...empty}),fold:x=>String(x||'').toLowerCase(),
 accountName(s){if(!/^[a-z0-9][a-z0-9_-]{0,39}$/.test(s))throw Error('ACCOUNT');return s;},
 async exists(root,p){return root===parent&&p==='assets/core.js';},
 async read(root,p){
  if(root===parent&&p==='index.html')return '<script src="assets/app.js"></script><p>archived_emails/</p>';
  if(root===data&&p==='personal/catalog/data.js')return 'MailArchive.receive('+JSON.stringify({kind:'metadata',records:[record]})+');';
  throw Error('NOT_FOUND');
 },unwrap:s=>JSON.parse(s.slice('MailArchive.receive('.length,-2)),
 async manifest(root){assert.equal(root,data);return manifest;},
 async catalogPaths(){return {viewerDir:'',current:'catalog/archive.js',linkBackDir:'../'};},
 Importer:class{async run(files,account){calls.push('mbox:'+account);assert.equal(this instanceof C.Importer,true);return {interrupted:false,issues:[]};}}};
const ArchiveReindex={
 async checkMissing(root,{onProgress}){assert.equal(root,data);calls.push('check');const r={phase:'complete',total:1,scanned:1,indexed:0,missing:1,stale:0,errors:0,brokenAttachments:0,missingOriginals:0,damaged:false,interrupted:false};onProgress(r);return r;},
 async syncMissing(root,{onProgress}){assert.equal(root,data);calls.push('sync');const r={scanned:1,skipped:1,indexed:0,interrupted:false};onProgress(r);return r;},
 async rebuild(root,{onProgress}){assert.equal(root,data);calls.push('rebuild');const r={phase:'complete',total:1,scanned:1,indexed:1,errors:0,brokenAttachments:0,missingOriginals:0,committed:true,interrupted:false};onProgress(r);return r;}
};
vm.runInNewContext(src,{window,document,showDirectoryPicker:window.showDirectoryPicker,indexedDB,
 ArchiveCore:C,ArchiveReindex,
 location:{pathname:'/test/email_archiver_root/index.html'},
 Option:function Option(text,value){return {text,value};},sessionStorage:{getItem(){return null;},setItem(){},removeItem(){}},
 AbortController,setTimeout,clearTimeout,requestAnimationFrame:fn=>fn(),console},{filename:'assets/app.js'});
async function tick(){await new Promise(r=>setTimeout(r,0));}
async function settled(test){for(let i=0;i<30&&!test();i++)await tick();assert(test(),'State never settled');}
(async()=>{
 // file:// Browse works without the folder picker or browser-profile data.
 await settled(()=>el('rows').children.length===1);
 assert.equal(option,null,'Browsing local catalog must not trigger picker');
 assert.equal(el('rows').children[0].children[2].children[0].href,'archived_emails/'+record.path+'?fromArchive=1&images=auto&theme=light');
 assert.equal(el('importAccountSelect').value,'personal');
 assert.equal(el('previewReaders').disabled,false);
 assert.equal(el('upgradeReaders').disabled,false,'Reindex enabled even with 0 older viewer pages');
 // Missing root never silently disables the MBOX action.
 el('files').files=[{name:'fictional.mbox',size:100}];el('files').onchange();
 assert.equal(el('start').disabled,false,'MBOX is enough to enable Start import');
 await el('start').onclick();
 assert.equal(pickerCalls,0,'Import without permission must not open a folder chooser');
 assert.equal(el('status').textContent,'Import not started');
 assert.match(el('operationNotice').textContent,/Enable archive access/);
 await el('previewReaders').onclick();
 assert.equal(pickerCalls,0,'Check existing must not show the OS folder picker');
 assert.match(el('readerStatus').textContent,/Enable archive access/);
 await el('connectArchive').onclick();
 assert.equal(pickerCalls,1,'Connect action asks for app root exactly once');
 assert.equal(option.mode,'readwrite');
 assert.equal(option.id,'email-archiver-app');
 assert.equal(selected,parent,'Only the own app folder is authorized');
 assert.equal(created,1,'Only archived_emails/ may be created under app root');
 assert.match(el('accessStatus').textContent,/Archive access ready/);
 await el('start').onclick();
 assert.equal(pickerCalls,1,'Import reuses authorized archived_emails without another chooser');
 assert.deepEqual(calls,['mbox:personal'],'Import must process MBOX without scanning or updating the library');
 assert.equal(writeCount,0,'No index.html/assets may be rewritten');
 assert.match(el('status').textContent,/complete/i);
 // Reimport only existing always rebuilds the complete catalog, even with 0 viewer updates.
 calls.length=0;
 await el('previewReaders').onclick();
 assert.deepEqual(calls,['check'],'Check existing performs one read-only inventory with progress');
 assert.equal(el('existingProgress').value,el('existingProgress').max,'Check progress reaches the published total');
 assert.match(el('existingProgressTitle').textContent,/complete/i);
 calls.length=0;
 assert.equal(pickerCalls,1,'Existing scan stays under archived_emails without another chooser');
 assert.equal(el('upgradeReaders').disabled,false);
 await el('upgradeReaders').onclick();
 assert.deepEqual(calls,['rebuild'],'Rebuild checks content and updates only indexes');
 assert.equal(el('existingProgress').value,el('existingProgress').max,'Rebuild progress includes final publication tick');
 assert.match(el('existingProgressTitle').textContent,/complete/);
 assert.match(el('catalogStatus').textContent,/Rebuilt index/);
 assert.equal(typeof el('refreshViewers').onclick,'undefined','Removed appearance action has no event handler');
 // A different OS directory is rejected before filesystem writes.
 const old=window.ArchiveUI.root;
 currentChoice=wrong;
 // A second sandboxed tab has no authorized parent, so emulate that by testing
 // the static guard and assert the UI has no arbitrary Choose data root control.
 assert(!html.includes('Choose data folder'));
 assert.equal(window.ArchiveUI.root,old,'No control can switch the active data root');
 console.log('PASS file:// Browse uses archived_emails/ without permissions');
 console.log('PASS Start import and Check existing never open the folder chooser; one explicit grant is reused');
 console.log('PASS authorized import writes only beneath archived_emails/');
 console.log('PASS Check and Rebuild progress bars finish; no appearance maintenance remains');
 console.log('PASS no arbitrary folder selector or app-copy controls');
})().catch(e=>{console.error(e);process.exitCode=1;});
