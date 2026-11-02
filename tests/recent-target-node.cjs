/* Browser-free UI smoke tests for archive-root selection. No real mail or filesystem writes. */
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const src=fs.readFileSync(path.join(__dirname,'../assets/app.js'),'utf8');
const elements=new Map();
function element(id){
 if(!elements.has(id))elements.set(id,{id,value:id==='pageSize'?'50':'',files:[],disabled:false,hidden:false,
  textContent:'',style:{},classList:{toggle(){}},replaceChildren(){},addEventListener(){},remove(){},
  append(){},setAttribute(){},getAttribute(){return null;}});
 return elements.get(id);
}
const document={getElementById:element,head:{append(s){s.onerror?.();}},createElement(tag){return tag==='script'?{remove(){}}:element('created-'+tag);}};
const archive=name=>({name,kind:'directory',async queryPermission(){return 'granted';},async isSameEntry(x){return this===x;}});
const a=archive('Archive A'),b=archive('Archive B');let pickNext=a,scanned=null,repaired=null,lastOpts=null;
const pick=async opts=>(lastOpts=opts,pickNext);
const C={VIEWER_DIR:'__email_archiver/',MANIFEST:'__email_archiver/assets/catalog/archive.js',
 PREVIOUS:'__email_archiver/assets/catalog/archive.previous.js',VERSION:1,
 async manifest(){return {kind:'manifest',format:1,total:5,generation:1,accounts:[],segments:[]};},
 async exists(h,p){return p==='__email_archiver/index.html'||p==='index.html';},
 fold:s=>String(s||'').toLowerCase(),unwrap:s=>s};
const window={showDirectoryPicker:pick,addEventListener(){}};
const ArchiveReindex={async *scan(root){scanned=root;yield {id:'fictional'};},
 async rebuild(root){repaired=root;return {indexed:1,errors:0,brokenAttachments:0,interrupted:false};}};
vm.runInNewContext(src,{window,document,ArchiveCore:C,ArchiveReindex,ArchiveBundle:{},
 location:{pathname:'/tmp/__email_archiver/index.html'},
 showDirectoryPicker:pick,Option:function Option(text,value){return {text,value};},
 sessionStorage:{getItem(){return null;},setItem(){},removeItem(){}},
 AbortController,console,setTimeout,clearTimeout,requestAnimationFrame:f=>f()},{filename:'assets/app.js'});
async function main(){
 await new Promise(resolve=>setTimeout(resolve,0));
 assert.equal(element('reuseImportDir').disabled,true);
 await element('chooseDir').onclick();
 assert.equal(window.ArchiveUI.root,a);
 assert.equal(lastOpts.id,'mailarchive');
 assert.equal(element('reuseImportDir').disabled,false);
 assert(element('recentArchiveInfo').textContent.includes('Archive A'));
 pickNext=b;
 await element('chooseReindexDir').onclick();
 assert.equal(lastOpts.startIn,a,'Folder picker should start in the previous target');
 assert.equal(window.ArchiveUI.root,a,'Repair selection must not alter importer root');
 assert(element('reindexDirInfo').textContent.includes('Archive B'));
 await element('previewReindex').onclick();
 await element('startReindex').onclick();
 assert.equal(scanned,b);
 assert.equal(repaired,b,'Catalog rebuild must receive the selected repair root');
 assert.equal(window.ArchiveUI.root,a,'Rebuilding Archive B must not switch imported/browsed Archive A');
 assert(element('notice').textContent.includes('Archive B'));
 await element('reuseImportDir').onclick();
 assert.equal(window.ArchiveUI.root,b,'Recent folder shortcut should switch import target on user action');
 console.log('PASS previous-folder picker startIn and remembered name');
 console.log('PASS repair target is separate from import target');
 console.log('PASS preview and rebuild operate only on selected repair root');
 console.log('PASS explicit recent-folder reuse updates import root');
}
main().catch(e=>{console.error(e);process.exitCode=1;});