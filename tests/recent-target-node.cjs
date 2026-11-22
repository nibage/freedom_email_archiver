/* One app, one data-root regression. All records are fictional.
   Browser APIs are mocked; no filesystem/network access is required. */
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../assets/app.js'),'utf8');
const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
assert(!source.includes('ArchiveBundle')&&!source.includes('await install('),'Application must never replicate itself');
assert(!html.includes('id="createArchive"')&&!html.includes('id="rootOpenInfo"'),'Remove install/copy notifications');
assert(html.includes('id="browseChooseRoot"')&&html.includes('id="messageFrame"'),'Browse selects the same active root and shows in-app messages');
assert(html.includes('sandbox="allow-downloads allow-popups allow-popups-to-escape-sandbox"'),'Viewer must have isolated opaque origin and no script permission');
assert(!html.includes('assets/bundle.js'),'Application must not load a self-installer bundle');
const idA='a'.repeat(64),idB='b'.repeat(64);
const record=(account,id,subject)=>({
 account,id,path:account+'/2025/2025-01/email-'+id+'.html',folder:account+'/2025/2025-01',
 subject,from:'sender@example.invalid',to:'recipient@example.invalid',cc:'',bcc:'',
 date:'2025-01-15T12:00:00Z',day:'2025-01-15',labels:['Saved'],attachments:[]});
const aRecord=record('personal',idA,'Archive A message');
const bRecord=record('work',idB,'Archive B message');
const demo={kind:'manifest',format:1,total:1,generation:1,accounts:['personal'],
 segments:[{meta:'personal/catalog/demo.js',search:null,count:1}]};
const manifestA={...demo,segments:[{meta:'personal/catalog/a.js',search:null,count:1}]};
const manifestB={...demo,accounts:['work'],segments:[{meta:'work/catalog/b.js',search:null,count:1}]};
const empty={...demo,total:0,accounts:[],segments:[]};
const dir=(name,accounts)=>({name,kind:'directory',async queryPermission(){return 'granted';},
 async *entries(){for(const account of accounts)yield [account,{kind:'directory'}];}});
const rootA=dir('MailA',['personal']),rootB=dir('MailB',['work']),fresh=dir('NewMail',[]);
let picked=rootB,pickerArgs=null,permissionRequests=0,writeCalls=0,appWrites=0;
for(const root of [rootA,rootB,fresh])root.requestPermission=async()=>{permissionRequests++;return 'granted';};
const selectionKey='self-root:/apps/freedom/index.html',accountKey='account:/apps/freedom/index.html';
const saved=new Map([[selectionKey,rootA],[accountKey,'personal']]),stages=[];
const indexedDB={open(){const req={result:{close(){},transaction(){const tx={objectStore(){return {
 get(key){const r={};queueMicrotask(()=>{r.result=saved.get(key);r.onsuccess?.();});return r;},
 put(value,key){saved.set(key,value);queueMicrotask(()=>tx.oncomplete?.());}};}};return tx;}}};
 queueMicrotask(()=>req.onsuccess?.());return req;}};
function element(tag,id){return {tagName:tag,id,children:[],value:id==='pageSize'?'50':id==='importAccount'?'personal':'',files:[],
 hidden:false,disabled:false,checked:id==='autoImages',textContent:'',style:{},listeners:{},
 classList:{toggle(){}},getAttribute(){return null;},setAttribute(){},removeAttribute(key){if(key==='src')this.src='';},
 addEventListener(k,fn){this.listeners[k]=fn;},replaceChildren(...items){this.children=items;if(this.id==='importAccountSelect')this.value=items[0]?.value||'__new__';},
 append(...items){this.children.push(...items);},add(item){this.children.push(item);},remove(){}};}
const elements=new Map(),el=id=>{if(!elements.has(id))elements.set(id,element('element',id));return elements.get(id);};
const document={getElementById:el,documentElement:{getAttribute(){return 'light';}},
 createElement:tag=>element(tag),head:{append(script){
  const p=String(script.src).split('?')[0];
  const result=p.endsWith('/assets/catalog/archive.js')?demo:
   p.endsWith('/personal/catalog/demo.js')?{kind:'metadata',records:[aRecord]}:null;
  queueMicrotask(()=>{if(result){window.MailArchive.receive(result);script.onload?.();}else script.onerror?.();});
 }}};
const window={scrollY:130,scrollTo(){},addEventListener(){},
 showDirectoryPicker:async options=>(pickerArgs=options,picked)};
const C={VERSION:1,MANIFEST:'__email_archiver/assets/catalog/archive.js',
 PREVIOUS:'__email_archiver/assets/catalog/archive.previous.js',VIEWER_DIR:'__email_archiver/',
 empty:()=>({...empty}),fold:s=>String(s||'').toLowerCase(),
 accountName(s){if(!/^[a-z0-9][a-z0-9_-]{0,39}$/.test(s))throw Error('ACCOUNT');return s;},
 async manifest(root){return root===rootA?manifestA:root===rootB?manifestB:empty;},
 async read(root,p){let obj=null;
  if(root===rootA&&p==='personal/catalog/a.js')obj={kind:'metadata',records:[aRecord]};
  if(root===rootB&&p==='work/catalog/b.js')obj={kind:'metadata',records:[bRecord]};
  if(obj)return JSON.stringify(obj);
  const e=Error('Not found');e.name='NotFoundError';throw e;
 },unwrap:JSON.parse,async exists(){return false;},
 async write(root,p){writeCalls++;if(/index\.html|assets\//.test(p))appWrites++;},
 async catalogPaths(){return {current:'catalog/archive.js',previous:'catalog/archive.previous.js',viewerDir:''};},
 Importer:class{async run(files,account){stages.push('mbox:'+account);return {interrupted:false,issues:[]};}}};
const ArchiveReindex={
 async checkMissing(root,{onProgress}){stages.push('inspect:'+root.name);
  const x={scanned:1,indexed:1,missing:0,damaged:false,interrupted:false};onProgress(x);return x;},
 async syncMissing(root,{onProgress}){stages.push('recover:'+root.name);
  onProgress({scanned:1,skipped:1,indexed:0});return {scanned:1,skipped:1,indexed:0,interrupted:false};}
};
const ArchiveReaderUpgrade={async refresh(root,{write=false,onProgress}){stages.push((write?'update:':'check:')+root.name);
 const x={phase:'complete',scanned:1,total:1,eligible:1,updated:write?1:0,current:0,unsupported:0,errors:0,interrupted:false};
 onProgress(x);return x;}};
let openedRecords=[],disposed=0;
const ArchiveDataReader={async open(root,r){openedRecords.push({root,subject:r.subject});return {
 url:'blob:synthetic-message',hasRemoteImages:false,dispose(){disposed++;}};}};
vm.runInNewContext(source,{window,document,location:{pathname:'/apps/freedom/index.html'},
 ArchiveCore:C,ArchiveReindex,ArchiveReaderUpgrade,ArchiveDataReader,ArchiveBundle:undefined,
 indexedDB,Option:function Option(text,value){return {text,value};},
 sessionStorage:{getItem(){return null;},setItem(){},removeItem(){}},
 setTimeout,clearTimeout,requestAnimationFrame:fn=>fn(),AbortController,console},{filename:'assets/app.js'});
async function tick(){await new Promise(r=>setTimeout(r,0));}
async function settle(check){for(let i=0;i<40&&!check();i++)await tick();assert(check(),'Expected UI state did not settle');}
function rowLink(){assert.equal(el('rows').children.length,1);return el('rows').children[0].children[2].children[0];}
(async()=>{
 await settle(()=>window.ArchiveUI.root===rootA&&el('rows').children.length===1);
 assert.equal(permissionRequests,0,'Remembered folder must be restored without a write prompt');
 assert.equal(rowLink().textContent,'Archive A message');
 assert.equal(rowLink().href,'#saved-email','Selected-root links must not use the application directory');
 assert.match(el('activeRootInfo').textContent,/MailA/);
 assert.equal(el('importAccountSelect').value,'personal');
 // Browse and Import use precisely the same root chooser and active dataset.
 await el('browseChooseRoot').onclick();
 await settle(()=>window.ArchiveUI.root===rootB&&rowLink().textContent==='Archive B message');
 assert.equal(pickerArgs.mode,'read');
 assert.match(el('activeRootInfo').textContent,/MailB/);
 assert.equal(el('importAccountSelect').value,'work');
 assert.equal(writeCalls,0,'Selecting root cannot write indexes or application assets');
 assert(!el('rows').children.some(x=>x.textContent==='Archive A message'),'Previous archive must be unloaded');
 const link=rowLink();link.listeners.click({preventDefault(){},button:0});
 await settle(()=>el('messageFrame').src==='blob:synthetic-message');
 assert.equal(openedRecords[0].root,rootB,'Message must be read through current root handle');
 assert.equal(el('messageViewer').hidden,false);
 el('closeMessage').onclick();
 assert.equal(el('messageViewer').hidden,true);
 assert.equal(disposed,1);
 // Existing HTML refresh still precedes new MBOX import, with no app copying.
 el('importTab').onclick();
 await el('previewReaders').onclick();
 await el('upgradeReaders').onclick();
 stages.length=0;
 el('files').files=[{name:'synthetic.mbox',size:512}];el('files').onchange();
 await el('start').onclick();
 assert(stages.indexOf('mbox:work')>stages.indexOf('update:MailB'));
 assert.equal(appWrites,0,'Import must not copy index.html or assets into the data root');
 assert.equal(window.ArchiveUI.root,rootB,'Import must not switch to another root');
 // A new empty data folder needs no root launcher or app installation.
 picked=fresh;
 await el('chooseDir').onclick();
 await settle(()=>window.ArchiveUI.root===fresh&&el('rows').children.length===0);
 assert.equal(writeCalls,0,'Picking a new folder must not create any files');
 assert(!html.includes('Create archive here'),'There must be no copy/install notice');
 assert.match(el('activeRootInfo').textContent,/NewMail/);
 assert.equal(saved.get(selectionKey),fresh,'Remember the last chosen root for this app copy');
 console.log('PASS one app instance loads exactly one selected data-root catalog at a time');
 console.log('PASS root switch updates Browse and account selection without writes');
 console.log('PASS same-tab sandboxed saved-mail navigation uses selected file handles');
 console.log('PASS existing refresh then MBOX import never copies application assets');
 console.log('PASS empty root remains data-only; no root launcher or install notifications');
})().catch(e=>{console.error(e);process.exitCode=1;});
