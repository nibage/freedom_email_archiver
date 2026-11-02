/* Browser-free UI smoke tests for archive-root selection and clickable browsing.
   Uses synthetic mail metadata only; no real mail or filesystem writes. */
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const src=fs.readFileSync(path.join(__dirname,'../assets/app.js'),'utf8');
function node(tag,id){
 return {tagName:tag,id,children:[],value:id==='pageSize'?'50':'',files:[],disabled:false,hidden:false,checked:id==='autoImages',
  textContent:'',style:{},classList:{toggle(){}},replaceChildren(...items){this.children=items;},
  addEventListener(){},remove(){},add(item){this.children.push(item);},append(...items){this.children.push(...items);},
  setAttribute(){},getAttribute(){return null;}};
}
const elements=new Map();
function element(id){if(!elements.has(id))elements.set(id,node('element',id));return elements.get(id);}
const record={account:'personal',id:'abc123',path:'personal/2025/2025-01/email-abc123.html',subject:'Example saved message',
 from:'sender@example.invalid',to:'reader@example.invalid',cc:'',bcc:'',date:'2025-01-15T12:00:00Z',
 day:'2025-01-15',labels:['Saved'],attachments:[]};
const viewerManifest={kind:'manifest',format:1,total:1,generation:1,accounts:['personal'],segments:[{meta:'personal/catalog/one.js',search:null,count:1}]};
const archive=name=>({name,kind:'directory',async queryPermission(){return 'granted';},async isSameEntry(x){return this===x;}});
const a=archive('Archive A'),b=archive('Archive B');let pickNext=a,scanned=null,repaired=null,lastOpts=null;
const pick=async opts=>(lastOpts=opts,pickNext);
const C={VIEWER_DIR:'__email_archiver/',MANIFEST:'__email_archiver/assets/catalog/archive.js',
 PREVIOUS:'__email_archiver/assets/catalog/archive.previous.js',VERSION:1,
 async manifest(h){return {...viewerManifest,total:h===a?25:99};},
 async exists(h,p){return p==='__email_archiver/index.html'||p==='index.html';},
 async read(){throw Error('BROWSE_MUST_USE_VIEWER');},
 fold:s=>String(s||'').toLowerCase(),unwrap:s=>s};
const window={showDirectoryPicker:pick,addEventListener(){}};
const document={getElementById:element,
 head:{append(script){
   const file=String(script.src).split('?')[0];
   const result=file.endsWith('/assets/catalog/archive.js')?viewerManifest:
     file.endsWith('/personal/catalog/one.js')?{kind:'metadata',records:[record]}:null;
   queueMicrotask(()=>{
     if(result){window.MailArchive.receive(result);script.onload?.();}
     else script.onerror?.();
   });
 }},
 createElement(tag){return node(tag);}};
const ArchiveReindex={async *scan(root){scanned=root;yield {id:'fictional'};},
 async rebuild(root){repaired=root;return {indexed:1,errors:0,brokenAttachments:0,interrupted:false};}};
vm.runInNewContext(src,{window,document,ArchiveCore:C,ArchiveReindex,ArchiveBundle:{},
 location:{pathname:'/tmp/__email_archiver/index.html'},
 showDirectoryPicker:pick,Option:function Option(text,value){return {text,value};},
 sessionStorage:{getItem(){return null;},setItem(){},removeItem(){}},
 AbortController,console,setTimeout,clearTimeout,requestAnimationFrame:f=>f()},{filename:'assets/app.js'});
async function loaded(){for(let attempt=0;attempt<10&&!element('rows').children.length;attempt++)await new Promise(resolve=>setTimeout(resolve,0));}
function assertBrowseLink(message){
 const rows=element('rows').children;
 assert.equal(rows.length,1,message+': expected the viewer message');
 const subject=rows[0].children[2].children[0];
 assert.equal(subject.tagName,'a',message+': subject must remain a clickable anchor');
 assert.match(subject.href,/personal\/2025\/2025-01\/email-abc123\.html\?fromArchive=1/);
 assert.equal(subject.textContent,'Example saved message');
 assert.equal(window.ArchiveUI.records.size,1,'Selected target must not replace viewer metadata');
}
async function main(){
 await loaded();
 assertBrowseLink('Initial Browse archive');
 assert.equal(element('reuseImportDir').disabled,true);
 await element('chooseDir').onclick();
 assert.equal(window.ArchiveUI.root,a);
 assert.equal(lastOpts.id,'mailarchive');
 assert.equal(element('reuseImportDir').disabled,false);
 assert(element('recentArchiveInfo').textContent.includes('Archive A'));
 assertBrowseLink('After choosing import target A');
 await element('reuseImportDir').onclick();
 assertBrowseLink('After Use recent in Import MBOX');
 pickNext=b;
 await element('chooseReindexDir').onclick();
 assert.equal(lastOpts.startIn,a,'Folder picker should start in previous target');
 assert.equal(window.ArchiveUI.root,a,'Repair selection must not alter importer root');
 assert(element('reindexDirInfo').textContent.includes('Archive B'));
 assertBrowseLink('After choosing repair target B');
 await element('reuseReindexDir').onclick();
 assertBrowseLink('After Use recent in Repair catalog');
 await element('previewReindex').onclick();
 await element('startReindex').onclick();
 assert.equal(scanned,b);
 assert.equal(repaired,b,'Catalog rebuild must receive the selected repair root');
 assert.equal(window.ArchiveUI.root,a,'Rebuilding Archive B must not switch imported/browsed Archive A');
 assert(element('notice').textContent.includes('Archive B'));
 assertBrowseLink('After catalog repair in other archive');
 await element('reuseImportDir').onclick();
 assert.equal(window.ArchiveUI.root,b,'Recent folder shortcut should change only import target');
 element('browseTab').onclick();
 assertBrowseLink('After returning to Browse archive');
 console.log('PASS Browse subjects remain clickable after both recent-folder actions');
 console.log('PASS viewer metadata stays separate from import and repair targets');
 console.log('PASS previous-folder picker startIn and remembered folder name');
 console.log('PASS repair scans and rebuilds only the selected repair root');
 console.log('PASS selecting a different target leaves browser links pointing to current viewer');
}
main().catch(e=>{console.error(e);process.exitCode=1;});