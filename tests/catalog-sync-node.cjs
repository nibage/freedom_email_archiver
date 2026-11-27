/* Self-contained incremental catalog regression tests: synthetic folders, no private email. */
'use strict';
const assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const prefix='__email_archiver/assets/catalog/';
const ida='a'.repeat(64),idb='b'.repeat(64);
const saved=new Map(),reads=new Map(),writes=[],values=new Map();
const record=id=>({id,account:'personal',folder:'personal/2025/2025-01',
 path:'personal/2025/2025-01/email-'+id+'.html',subject:'Fictional mail',from:'sender@example.invalid',
 to:'reader@example.invalid',labels:[],attachments:[],messageId:'',date:null,day:null,rawDate:''});
function html(id){
 return '<!doctype html><html lang="en"><head></head><body><main><div class="mail-content">Example '+id.slice(0,2)+'</div></main>'
  +'<script id="mail-archive-record" type="application/json">'+JSON.stringify({schema:1,record:record(id)})+'</script></body></html>';
}
saved.set(ida,html(ida));saved.set(idb,html(idb));
function file(id){return {kind:'file',async getFile(){reads.set(id,(reads.get(id)||0)+1);return {async text(){return saved.get(id);}};}};}
function dir(items){return {kind:'directory',async *entries(){for(const x of items)yield x;}};}
const month=dir([['email-'+ida+'.html',file(ida)],['email-'+idb+'.html',file(idb)]]);
const year=dir([['2025-01',month]]),account=dir([['2025',year]]),root=dir([['personal',account]]);
const basic={kind:'manifest',format:1,generation:1,created:'2025-01-01',accounts:['personal'],
 total:1,segments:[{meta:'personal/catalog/original.js',search:'personal/catalog/original-text.js',count:1}]};
let manifest=structuredClone(basic),lockCount=0,lockClose=0;
values.set('personal/catalog/original.js',{kind:'metadata',records:[record(ida)]});
values.set('personal/catalog/original-text.js',{kind:'search',records:[{key:'personal/'+ida,text:'original'}]});
const C={
 VERSION:1,
 accountName:name=>{if(!/^[a-z0-9][a-z0-9_-]{0,39}$/.test(name))throw Error('ACCOUNT');return name;},
 Importer:class{async lock(){lockCount++;this.lockWriter={async close(){lockClose++;}};}},
 async manifest(){return manifest;},empty(){return {kind:'manifest',format:1,generation:0,accounts:[],segments:[],total:0};},
 async catalogPaths(){return {viewerDir:'__email_archiver/',current:prefix+'archive.js',previous:prefix+'archive.previous.js'};},
 async read(root,path){if(!values.has(path))throw Error('Not found');return values.get(path);},
 async write(root,path,val){const snapshot=structuredClone(val);writes.push(path);values.set(path,snapshot);if(path===prefix+'archive.js')manifest=snapshot;},
 async exists(root,path){return values.has(path);},
 unwrap:x=>x,wrap:x=>x,fold:x=>String(x||'').toLowerCase()
};
function template(){
 return {set innerHTML(html){
  this.content={querySelector(selector){
   if(selector.startsWith('#mail-archive-record')){
    const x=/<script id="mail-archive-record" type="application\/json">([\s\S]*?)<\/script>/.exec(html);
    return x?{textContent:x[1]}:null;
   }
   if(selector==='main')return {textContent:(/<main>([\s\S]*?)<\/main>/.exec(html)||[])[1]||''};
   return null;
  }};
 }};
}
const globals={ArchiveCore:C,ArchiveEML:{safeOriginal:()=>true},crypto:{randomUUID:()=>String(writes.length+1)},document:{createElement:template}};
vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../assets/reindex.js'),'utf8'),{globalThis:globals,document:globals.document,crypto:{randomUUID:()=>String(writes.length+1)},setTimeout},{filename:'assets/reindex.js'});
async function main(){
 const seen=[];
 const baselineWrites=writes.length,baselineLocks=lockCount;
 const check=await globals.ArchiveReindex.checkMissing(root,{});
 assert.equal(check.scanned,2);assert.equal(check.indexed,1);assert.equal(check.missing,1);
 assert.equal(writes.length,baselineWrites,'Check existing must be read-only');
 assert.equal(lockCount,baselineLocks,'Check existing must not request a writer lock');
 assert.equal(check.validated,2);assert.equal(reads.get(ida),1);assert.equal(reads.get(idb),1);reads.clear();
 let result=await globals.ArchiveReindex.syncMissing(root,{onProgress:s=>seen.push(s)});
 assert.equal(result.scanned,2);assert.equal(result.skipped,1);assert.equal(result.indexed,1);assert.equal(result.committed,true);
 assert.equal(reads.get(ida)||0,0,'Already indexed HTML must not be read');
 assert.equal(reads.get(idb),1,'Only orphan HTML is inspected');
 assert.equal(manifest.generation,2);assert.equal(manifest.total,2);
 assert.deepEqual(manifest.segments[0],basic.segments[0],'Existing index segment must remain identical');
 assert.equal(manifest.segments.length,2,'Only one incremental shard should be appended');
 const writesAfter=writes.length;
 result=await globals.ArchiveReindex.syncMissing(root,{});
 assert.equal(result.indexed,0);assert.equal(result.skipped,2);assert.equal(result.committed,false);
 assert.equal(writes.length,writesAfter,'Up-to-date catalog must not be rewritten');
 const confirmed=await globals.ArchiveReindex.checkMissing(root,{});
 assert.equal(confirmed.missing,0);assert.equal(confirmed.indexed,2);
 assert.equal(writes.length,writesAfter,'Repeated Check existing must never rewrite a catalog');
 assert.equal(reads.get(ida),1,'Explicit Check existing reads each indexed HTML exactly once');
 assert.equal(lockCount,lockClose,'Every writer lock must be released');
 // A missing catalog is recovered from all saved HTML without any MBOX.
 manifest=C.empty();
 result=await globals.ArchiveReindex.syncMissing(root,{});
 assert.equal(result.indexed,2);assert.equal(result.skipped,0);
 assert.equal(manifest.total,2);
 // A corrupt unindexed HTML cannot replace the last good catalog.
 manifest=structuredClone(basic);
 saved.set(idb,'<!doctype html><html><main>damaged metadata</main></html>');
 const prior=JSON.stringify(manifest),count=writes.length;
 let blocked=false;
 try{await globals.ArchiveReindex.syncMissing(root,{});}catch(e){blocked=e.message==='REINDEX_INCOMPLETE';}
 assert(blocked,'Unrecoverable pages must block publishing');
 assert.equal(JSON.stringify(manifest),prior);
 assert.equal(writes.length,count);
 saved.set(idb,html(idb));
 // A missing old search shard triggers strict full reconstruction.
 manifest=structuredClone(basic);
 values.delete('personal/catalog/original-text.js');
 result=await globals.ArchiveReindex.syncMissing(root,{});
 assert.equal(result.fullRebuild,true);assert.equal(result.indexed,2);
 assert.equal(manifest.segments.length,1,'Broken shard must be replaced by full reconstruction');
 assert.equal(manifest.total,2);
 console.log('PASS: existing index shards and HTML are skipped without rewrites');
 console.log('PASS: orphan HTML is added, repeated scans perform no catalog writes');
 console.log('PASS: missing catalogs rebuild safely; corruption prevents publication');
 console.log('PASS: damaged index shards trigger strict rebuild and writer locks close');
}
main().catch(e=>{console.error(e);process.exitCode=1;});
