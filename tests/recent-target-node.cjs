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
 async catalogPaths(){return {viewerDir:'__email_archiver/'};},
 async exists(root,p){return p==='__email_archiver/index.html'||p==='index.html';},
 async read(){throw Error('Browse must not read through import target');},fold:s=>String(s||'').toLowerCase()};
const ArchiveReindex={async syncMissing(root,{onProgress}){
 scanned.push(root);onProgress({scanned:7,skipped:6,indexed:1});
 return {scanned:7,skipped:6,indexed:1,committed:true,interrupted:false};
}};
vm.runInNewContext(src,{window,document,indexedDB,ArchiveCore:C,ArchiveReindex,ArchiveBundle:{},
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
 assertLink();
 assert.equal(saved.get(selfRootKey),a,'Other folder must not replace self preference');
 assert.equal(saved.get('last'),b,'Ignore the global last folder from another archive');
 console.log('PASS remembered self-root and existing account selection');
 console.log('PASS explicit root choice triggers incremental all-account catalog check');
 console.log('PASS New account reveals its name field, imported account is validated');
 console.log('PASS Browse links remain clickable after selecting another root');
}
main().catch(e=>{console.error(e);process.exitCode=1;});
