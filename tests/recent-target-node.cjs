/* Offline UI simulation for unified import, existing/New account selection,
   per-viewer root preference, and automatic incremental catalog recovery. */
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const src=fs.readFileSync(path.join(__dirname,'../assets/app.js'),'utf8');
const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
assert(!html.includes('id="reindex"')&&!html.includes('id="previewReindex"'),'No separate Repair panel.');
assert(html.indexOf('id="chooseDir"')<html.indexOf('id="files"')&&html.indexOf('id="files"')<html.indexOf('id="importAccountSelect"'),'Root, MBOX, account order.');
assert(html.includes('id="newAccountWrap"')&&html.includes('id="stopReindex"'),'New account and Stop catalog check available.');
const record={account:'personal',id:'abc123',path:'personal/2025/2025-01/email-abc123.html',subject:'Fictional message',
 from:'sender@example.invalid',to:'reader@example.invalid',cc:'',bcc:'',date:'2025-01-15T12:00:00Z',
 day:'2025-01-15',labels:['Saved'],attachments:[]};
const viewerManifest={kind:'manifest',format:1,total:1,generation:1,accounts:['personal'],segments:[{meta:'personal/catalog/one.js',search:null,count:1}]};
function node(tag,id){return {tagName:tag,id,children:[],value:id==='pageSize'?'50':id==='importAccount'?'personal':'',
 files:[],disabled:false,hidden:false,checked:id==='autoImages',textContent:'',style:{},listeners:{},
 classList:{toggle(){}},replaceChildren(...items){this.children=items;if(this.id==='importAccountSelect')this.value=items[0]?.value||'__new__';},
 addEventListener(k,fn){this.listeners[k]=fn;},add(item){this.children.push(item);},append(...items){this.children.push(...items);},
 remove(){},setAttribute(){},getAttribute(){return null;}};}
const els=new Map(),el=id=>{if(!els.has(id))els.set(id,node('element',id));return els.get(id);};
const a={name:'tmp',kind:'directory',async queryPermission(){return 'prompt';},
 async *entries(){yield ['personal',{kind:'directory'}];yield ['work',{kind:'directory'}];}},
 b={name:'OtherMail',kind:'directory',async queryPermission(){return 'granted';},
 async *entries(){yield ['work',{kind:'directory'}];yield ['another',{kind:'directory'}];}};
let prompts=0,pickNext=b,lastPicker=null,scanned=[],lastAction;
const stages=[];
a.requestPermission=async()=>{prompts++;return 'granted';};
const selfRootKey='self-root:/tmp/__email_archiver/index.html',selfAccountKey='account:/tmp/__email_archiver/index.html';
const saved=new Map([[selfRootKey,a],[selfAccountKey,'work'],['last',b],['lastAccount','foreign']]);
function database(){
 return {close(){},transaction(){const tx={objectStore(){return {
 get(key){const req={};queueMicrotask(()=>{req.result=saved.get(key);req.onsuccess?.();});return req;},
 put(value,key){saved.set(key,value);queueMicrotask(()=>tx.oncomplete?.());}};}};return tx;}};
}
const indexedDB={open(){const req={result:database()};queueMicrotask(()=>req.onsuccess?.());return req;}};
const document={getElementById:el,documentElement:{getAttribute(){return 'light';}},
 createElement(tag){return node(tag);},head:{append(script){
  const u=String(script.src).split('?')[0],data=u.endsWith('/assets/catalog/archive.js')?viewerManifest:
   u.endsWith('/personal/catalog/one.js')?{kind:'metadata',records:[record]}:null;
  queueMicrotask(()=>{if(data){window.MailArchive.receive(data);script.onload?.();}else script.onerror?.();});
 }}};
const window={showDirectoryPicker:async opts=>(lastPicker=opts,pickNext),addEventListener(){}};
const C={VIEWER_DIR:'__email_archiver/',MANIFEST:'__email_archiver/assets/catalog/archive.js',
 PREVIOUS:'__email_archiver/assets/catalog/archive.previous.js',VERSION:1,
 accountName(s){if(!/^[a-z0-9][a-z0-9_-]{0,39}$/.test(s))throw Error('ACCOUNT');return s;},
 async manifest(root){return {...viewerManifest,total:root===a?83:22,accounts:root===a?['personal','work']:['work','another']};},
 async catalogPaths(){return {viewerDir:'__email_archiver/',current:'__email_archiver/assets/catalog/archive.js'};},
 async exists(root,p){return p==='__email_archiver/index.html'||p==='index.html'||p==='__email_archiver/assets/catalog/archive.js';},
 async read(root,p){if(p.endsWith('index.html'))return '<script src="assets/core.js"></script>';
  if(p.endsWith('assets/bundle.js'))return 'globalThis.ArchiveBundle={};\\n'.replace('\\\\n','\\n');
  throw Error('Browse must not read through import target');},
 async write(root,p){stages.push('viewer-install:'+p);},json:JSON.stringify,empty(){return viewerManifest;},
 Importer:class{async run(files,account){stages.push('mbox:'+account);return {interrupted:false,issues:[]};}},
 fold:s=>String(s||'').toLowerCase()};
const ArchiveReindex={async syncMissing(root,{onProgress}){
 scanned.push(root);onProgress({scanned:7,skipped:6,indexed:1});
 return {scanned:7,skipped:6,indexed:1,committed:true,interrupted:false};
}};
const ArchiveReaderUpgrade={async refresh(root,{write=false,onProgress=()=>{}}){
 stages.push(write?'existing-update':'existing-check');
 const data={scanned:4,total:write?4:null,eligible:1,updated:write?1:0,current:3,unsupported:0,errors:0,interrupted:false};
 onProgress(data);return data;
}};
vm.runInNewContext(src,{window,document,indexedDB,ArchiveCore:C,ArchiveReindex,ArchiveReaderUpgrade,ArchiveBundle:{},
 location:{pathname:'/tmp/__email_archiver/index.html'},showDirectoryPicker:window.showDirectoryPicker,
 Option:function Option(text,value){return {text,value};},sessionStorage:{getItem(){return null;},setItem(){},removeItem(){}},
 AbortController,console,setTimeout,clearTimeout,requestAnimationFrame:f=>f()},{filename:'assets/app.js'});
async function tick(){await new Promise(r=>setTimeout(r,0));}
function assertLink(){
 assert.equal(el('rows').children.length,1,'Viewer list stays loaded');
 const anchor=el('rows').children[0].children[2].children[0];
 assert.equal(anchor.tagName,'a');
 assert.match(anchor.href,/email-abc123\.html\?fromArchive=1/);
}
async function main(){
 for(let k=0;k<20&&!window.ArchiveUI.root;k++)await tick();
 assert.equal(window.ArchiveUI.root,a,'Only self-root preference may be loaded');
 assert.equal(scanned.length,0,'Never automatically write to a remembered root at startup');
 assert.equal(prompts,0,'No permission prompt on page load');
 assert.equal(el('importAccountSelect').value,'work','Most recent valid account should be preselected');
 assert.equal(el('newAccountWrap').hidden,true,'Existing account hides New input');
 assertLink();
 el('importTab').onclick();assert.equal(el('browse').hidden,true);
 el('browseTab').onclick();assertLink();
 await el('chooseDir').onclick();
 assert.equal(scanned.length,1,'Explicit folder choice starts incremental catalog check');
 assert.equal(scanned[0],b);
 assert.equal(window.ArchiveUI.root,b);
 assert.equal(lastPicker.startIn,a);
 assert(!html.includes('id="repairProgressPanel"'),'Catalog has no separate progress card.');
 assert.match(el('catalogStatus').textContent,/Added 1 missing catalog entries/,'Catalog result appears inline under import actions.');
 assert.equal(el('importAccountSelect').value,'work');
 el('importAccountSelect').value='__new__';
 el('importAccountSelect').listeners.change();
 assert.equal(el('newAccountWrap').hidden,false,'New choice reveals account name');
 el('importAccount').value='project';
 el('importAccount').listeners.change();
 assert.equal(el('importAccount').value,'project');
 // Check existing stays in the action row and puts its result just underneath.
 await el('previewReaders').onclick();
 assert.match(el('readerStatus').textContent,/4 HTML messages checked · 1 older viewers eligible/);
 assert.equal(el('existingProgressPanel').hidden,true,'Read-only check must not open the write-progress panel');
 await el('upgradeReaders').onclick();
 assert.match(el('existingProgressTitle').textContent,/Existing-email update complete/);
 assert.equal(el('existingProgress').value,4,'Existing update progress must reach its real file count');
 assert.equal(el('existingUpdated').textContent,'1');
 // A new MBOX import must refresh existing pages BEFORE the importer sees the MBOX.
 stages.length=0;
 el('importAccountSelect').value='work';el('importAccountSelect').listeners.change();
 el('files').files=[{name:'fictional.mbox',size:1024}];el('files').onchange();
 await el('start').onclick();
 assert.equal(stages[0],'existing-update','Existing HTML refresh must run first');
 assert(stages.indexOf('mbox:work')>0,'The MBOX importer must run after existing HTML refresh');
 assert(stages.filter(x=>x.startsWith('viewer-install:')).length<=1,
  'Unchanged application assets should not be rewritten on repeat import');
 assert.equal(el('existingProgressPanel').hidden,false,'Existing result remains visible after new import begins');
 assert.equal(el('progressPanel').hidden,false,'New MBOX has its own progress panel');
 assertLink();
 assert.equal(saved.get(selfRootKey),a,'Other folder must not replace self preference');
 assert.equal(saved.get('last'),b,'Ignore the global last folder from another archive');
 console.log('PASS remembered self-root and existing account selection');
 console.log('PASS explicit root choice triggers incremental all-account catalog check');
 console.log('PASS New account reveals its name field, imported account is validated');
 console.log('PASS Browse links remain clickable after selecting another root');
}
main().catch(e=>{console.error(e);process.exitCode=1;});
