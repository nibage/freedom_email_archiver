/* Node regression: repeated MBOX imports must not rerender current email HTML. */
'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {webcrypto}=require('node:crypto');
const encoder=new TextEncoder(),decoder=new TextDecoder();
const writes=new Map();
function missing(){const e=Error('Not found');e.name='NotFoundError';return e;}
function fileHandle(path){
 let bytes=new Uint8Array();
 return {kind:'file',async getFile(){const snapshot=bytes.slice();return {
  size:snapshot.length,async text(){return decoder.decode(snapshot);},
  async arrayBuffer(){return snapshot.slice().buffer;}};},
  async createWritable(){let next=null;return {
   async write(value){next=typeof value==='string'?encoder.encode(value):new Uint8Array(value);},
   async close(){if(next){bytes=next;writes.set(path,(writes.get(path)||0)+1);}},
   async abort(){next=null;}};}};
}
function directory(prefix=''){
 const entries=new Map();
 return {kind:'directory',async getDirectoryHandle(name,{create=false}={}){
  let child=entries.get(name);if(!child&&create){child=directory(prefix+name+'/');entries.set(name,child);}
  if(!child||child.kind!=='directory')throw missing();return child;},
 async getFileHandle(name,{create=false}={}){
  let child=entries.get(name);if(!child&&create){child=fileHandle(prefix+name);entries.set(name,child);}
  if(!child||child.kind!=='file')throw missing();return child;}};
}
let sanitized=0;
const renderer={
 RENDER_VERSION:1,
 cleanHTML(html){sanitized++;return {html:'<div class="mail-content">'+html+'</div>',text:'Hello'};},
 documentHTML(meta,body){return '<html><main>'+body+'</main><aside>'+meta.labels.join(',')+'</aside></html>';}
};
const document={createElement(tag){
 assert.equal(tag,'template');
 return {html:'',set innerHTML(value){this.html=value;},get content(){const html=this.html;return {
  querySelector(selector){if(selector!=='main')return null;const match=/<main>([\s\S]*?)<\/main>/.exec(html);return match?{innerHTML:match[1]}:null;},
  querySelectorAll(){return [];}};}};
}};
const context={TextEncoder,TextDecoder,crypto:webcrypto,document,MailRenderer:renderer,
 decodeWords:value=>value,
 PostalMime:{async parse(bytes){
  const source=decoder.decode(bytes),labels=/^X-Gmail-Labels: ([^\r\n]+)/mi.exec(source)?.[1];
  const headers=[{key:'from',value:'sender@example.invalid'},
   {key:'to',value:'reader@example.invalid'},{key:'date',value:'Wed, 15 Jan 2025 12:00:00 +0000'},
   {key:'subject',value:'Test'},{key:'message-id',value:'<same@example.invalid>'}];
  if(labels)headers.push({key:'x-gmail-labels',value:labels});
  return {headers,from:[{address:'sender@example.invalid'}],to:[{address:'reader@example.invalid'}],
   date:'2025-01-15T12:00:00Z',subject:'Test',messageId:'<same@example.invalid>',
   text:'Hello',html:'<p>Hello</p>',attachments:[]};
 }},
 ArchiveEML:{fromMbox:bytes=>({bytes}),classify:()=>[],selectReasons:()=>[]}};
context.globalThis=context;
vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../assets/core.js'),'utf8'),context);
const C=context.ArchiveCore,root=directory();
function mbox(label=''){
 const header='From sender@example.invalid Wed Jan 15 12:00:00 2025\n'
  +'From: sender@example.invalid\nTo: reader@example.invalid\n'
  +'Date: Wed, 15 Jan 2025 12:00:00 +0000\nSubject: Test\n'
  +'Message-ID: <same@example.invalid>\n'
  +(label?'X-Gmail-Labels: '+label+'\n':'')+'\nHello\n';
 const bytes=encoder.encode(header);
 return {name:'test.mbox',size:bytes.length,slice(start,end){const chunk=bytes.slice(start,end);return {arrayBuffer:async()=>chunk.buffer};}};
}
async function main(){
 let report=await new C.Importer(root).run([mbox()],'personal');
 assert.equal(report.stats.new,1);
 assert.equal(sanitized,1);
 const record=[...(await new C.Importer(root).open()).records.values()][0];
 const path=record.path,writesAfterFirst=writes.get(path);
 sanitized=0;report=await new C.Importer(root).run([mbox()],'personal');
 assert.equal(report.stats.duplicates,1);
 assert.equal(report.stats.committed,0);
 assert.equal(sanitized,0,'identical reimport must not rerender HTML');
 assert.equal(writes.get(path),writesAfterFirst,'identical reimport must not rewrite the HTML file');
 sanitized=0;report=await new C.Importer(root).run([mbox('Saved')],'personal');
 assert.equal(report.stats.new,0);
 assert.equal(report.stats.committed,1);
 assert.equal(sanitized,0,'label-only update must reuse sanitized message body');
 assert.match(await C.read(root,path),/<aside>Saved<\/aside>/);
 const manifest=await C.manifest(root),shard=manifest.segments[manifest.segments.length-1].meta;
 const metadata=C.unwrap(await C.read(root,shard));delete metadata.records[0].renderVersion;
 await C.write(root,shard,C.wrap(metadata));
 sanitized=0;report=await new C.Importer(root).run([mbox()],'personal');
 assert.equal(report.stats.refreshed,1);
 assert.equal(sanitized,1,'old renderer version must refresh once');
 sanitized=0;report=await new C.Importer(root).run([mbox()],'personal');
 assert.equal(report.stats.refreshed,0);
 assert.equal(sanitized,0,'upgraded renderer must be reused on next reimport');
 console.log('PASS duplicate reimport skips HTML rendering and disk writes');
 console.log('PASS label-only update reuses existing HTML body');
 console.log('PASS outdated renderer is refreshed exactly once');
}
main().catch(e=>{console.error(e);process.exitCode=1;});
