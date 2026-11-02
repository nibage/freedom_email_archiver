/* Offline smoke test: remembered default root/account, shared import/repair target,
   top-right Import tab, and Browse links. All data fictional. */
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const src=fs.readFileSync(path.join(__dirname,'../assets/app.js'),'utf8');
const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
assert(html.includes('id="importTab" class="import-tab"'));
assert(!html.includes('id="reindexTab"'));
assert(!html.includes('id="reuseImportDir"'));
assert(!html.includes('id="reuseReindexDir"'));
assert(!html.includes('id="chooseReindexDir"'));
assert(html.indexOf('id="reindex"')>html.indexOf('id="import"'));
const record={account:'personal',id:'abc123',path:'personal/2025/2025-01/email-abc123.html',subject:'Fictional message',
 from:'sender@example.invalid',to:'reader@example.invalid',cc:'',bcc:'',date:'2025-01-15T12:00:00Z',
 day:'2025-01-15',labels:['Saved'],attachments:[]};
const viewerManifest={kind:'manifest',format:1,total:1,generation:1,accounts:['personal'],segments:[{meta:'personal/catalog/one.js',search:null,count:1}]};
function node(tag,id){return {tagName:tag,id,children:[],value:id==='pageSize'?'50':id==='importAccount'?'personal':'',files:[],
 disabled:false,hidden:false,checked:id==='autoImages',textContent:'',classList:{toggle(){}},style:{},
 replaceChildren(...items){this.children=items;},addEventListener(){},add(item){this.children.push(item);},
 append(...items){this.children.push(...items);},remove(){},setAttribute(){},getAttribute(){return null;}};}
const els=new Map(),element=id=>{if(!els.has(id))els.set(id,node('div',id));return els.get(id);};
let permissions=0,lastOpts=null,pickNext;
const a={name:'RecentMail',kind:'directory',async queryPermission(){return 'prompt';},async requestPermission(){permissions++;return 'granted';}};
const b={name:'OtherMail',kind:'directory',async queryPermission(){return 'granted';}};
pickNext=b;
const stored=new Map([['last',a],['lastAccount','business']]);
let idbOpen=0;
const db={close(){},transaction(store,mode){const tx={objectStore(){return {
 get(key){const req={};queueMicrotask(()=>{req.result=stored.get(key);req.onsuccess?.();});return req;},
 put(value,key){stored.set(key,value);queueMicrotask(()=>tx.oncomplete?.());}};}};return tx;}};
const indexedDB={open(){idbOpen++;const request={result:db};queueMicrotask(()=>request.onsuccess?.());return request;}};
const document={getElementById:element,createElement(tag){return node(tag);},
 head:{append(script){const name=String(script.src).split('?')[0];const data=name.endsWith('/assets/catalog/archive.js')?viewerManifest:
 name.endsWith('/personal/catalog/one.js')?{kind:'metadata',records:[record]}:null;
 queueMicrotask(()=>{if(data){window.MailArchive.receive(data);script.onload?.();}else script.onerror?.();});}}};
const window={showDirectoryPicker:async options=>(lastOpts=options,pickNext),addEventListener(){}};
const C={VIEWER_DIR:'__email_archiver/',MANIFEST:'__email_archiver/assets/catalog/archive.js',
 PREVIOUS:'__email_archiver/assets/catalog/archive.previous.js',VERSION:1,
 accountName(x){if(!/^[a-z0-9][a-z0-9_-]{0,39}$/.test(x))throw Error('ACCOUNT');return x;},
 async manifest(root){return {...viewerManifest,total:root===a?83:22};},
 async catalogPaths(){return {viewerDir:'__email_archiver/'};},
 async exists(root,p){return p==='__email_archiver/index.html'||p==='index.html';},
 async read(){throw Error('Viewer must not switch catalogs');},fold:x=>String(x||'').toLowerCase()};
let scanned=null,repaired=null;
const ArchiveReindex={async *scan(root){scanned=root;yield {id:'fictional'};},async rebuild(root){repaired=root;return {indexed:1,errors:0,brokenAttachments:0,interrupted:false};}};
vm.runInNewContext(src,{window,document,indexedDB,ArchiveCore:C,ArchiveReindex,ArchiveBundle:{},
 location:{pathname:'/tmp/__email_archiver/index.html'},showDirectoryPicker:window.showDirectoryPicker,
 Option:function Option(text,value){return {text,value};},
 sessionStorage:{getItem(){return null;},setItem(){},removeItem(){}},
 AbortController,console,setTimeout,clearTimeout,requestAnimationFrame:f=>f()},{filename:'assets/app.js'});
async function tick(){await new Promise(resolve=>setTimeout(resolve,0));}
function assertBrowse(label){
 const rows=element('rows').children;
 assert.equal(rows.length,1,label+': viewer record remains loaded');
 const subj=rows[0].children[2].children[0];
 assert.equal(subj.tagName,'a',label+': email subject remains a link');
 assert.match(subj.href,/personal\/2025\/2025-01\/email-abc123\.html/);
 assert.equal(window.ArchiveUI.records.size,1);
}
async function main(){
 for(let i=0;i<10&&!element('rows').children.length;i++)await tick();
 for(let i=0;i<10&&!window.ArchiveUI.root;i++)await tick();
 assert.equal(window.ArchiveUI.root,a,'Recent archive must be auto-selected without a button');
 assert.equal(element('importAccount').value,'business','Last account must be pre-selected');
 assert.equal(permissions,0,'Opening the page must not request disk permission');
 assert(element('dirInfo').textContent.includes('RecentMail/'));
 assert(element('dirInfo').textContent.includes('Full device path unavailable'));
 assert.equal(element('previewReindex').disabled,false);
 assertBrowse('initial');
 element('importTab').onclick();
 assert.equal(element('browse').hidden,true);
 assert.equal(element('import').hidden,false);
 element('browseTab').onclick();assertBrowse('after switching tabs');
 await element('previewReindex').onclick();
 assert.equal(permissions,1,'Repair preview should ask permission upon explicit action');
 assert.equal(scanned,a);
 await element('startReindex').onclick();
 assert.equal(repaired,a,'Repair must use same root as import');
 assertBrowse('after repairing remembered target');
 await element('chooseDir').onclick();
 assert.equal(window.ArchiveUI.root,b,'Picker changes shared import/repair root');
 assert.equal(lastOpts.startIn,a,'Picker starts at remembered root');
 assert(element('reindexDirInfo').textContent.includes('OtherMail'));
 assert.equal(element('startReindex').disabled,true,'Switching folder invalidates old repair preview');
 await element('previewReindex').onclick();
 assert.equal(scanned,b);
 await element('startReindex').onclick();
 assert.equal(repaired,b);
 element('browseTab').onclick();assertBrowse('after repairing another target');
 assert.equal(element('importAccount').value,'business');
 assert.equal(stored.get('last'),b,'Last root persists in IndexedDB');
 console.log('PASS remembered root and account are auto-selected');
 console.log('PASS permission not requested on load; repair requests it on click');
 console.log('PASS common import/repair target and changed-folder preview reset');
 console.log('PASS Browse remains clickable and one-page Import navigation works');
 console.log('PASS browser reports folder-relative path instead of invented absolute path');
}
main().catch(e=>{console.error(e);process.exitCode=1;});