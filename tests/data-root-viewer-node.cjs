/* Offline sandboxed saved-message test. Synthetic fixture; no external dependencies. */
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
const code=fs.readFileSync(path.join(__dirname,'../assets/data-reader.js'),'utf8');
const id='a'.repeat(64),folder='personal/2025/2025-01',record={
 id,account:'personal',folder,path:folder+'/email-'+id+'.html',subject:'Fictional mail'};
assert(html.includes('id="messageFrame"')&&html.includes('sandbox="allow-downloads allow-popups allow-popups-to-escape-sandbox"'));
assert(!html.includes('sandbox="allow-scripts"')&&!html.includes('allow-same-origin'));
assert(html.includes('frame-src blob:')&&html.includes('img-src \'self\' file: data: blob:'));
const resources=[],revoked=[],reads=[],parsed=[];
const URLmock={createObjectURL(blob){const url='blob:fixture-'+(resources.length+1);resources.push({url,blob});return url;},
 revokeObjectURL(url){revoked.push(url);}};
function elem(tag,attrs={}){
 const map=new Map(Object.entries(attrs));
 const el={tagName:tag,removed:false,get attributes(){return [...map].map(([name,value])=>({name,value}));},
  getAttribute:k=>map.has(k)?map.get(k):null,
  setAttribute:(k,v)=>map.set(k,v),removeAttribute:k=>map.delete(k),
  remove(){this.removed=true;},
  get value(){return map.get('value')||'';},
  get href(){return map.get('href')||'';}
 };
 return el;
}
let last;
function fakeDoc(){
 const remote=elem('IMG',{'data-remote-src':'https://example.invalid/tracker','onerror':'alert(1)'});
 const cid=elem('IMG',{src:'attachments/picture.png'});
 const download=elem('A',{href:'attachments/notes.txt'});
 const original=elem('A',{href:'originals/email-'+id+'.eml'});
 const unsafe=elem('A',{href:'javascript:alert(1)'});
 const script=elem('SCRIPT',{});
 const oldBack=elem('A',{id:'backToArchive'});
 const oldButton=elem('BUTTON',{id:'loadRemoteImages'});
 const policy=elem('META',{});
 const root={theme:'',setAttribute(k,v){if(k==='data-theme')this.theme=v;},
  get outerHTML(){return '<html data-theme="'+this.theme+'"><body><main>Safe fictional email</main></body></html>';}};
 const metadata={textContent:JSON.stringify({schema:1,record:{...record,original:{href:'originals/email-'+id+'.eml'}}})};
 const doc={documentElement:root,head:{prepend(){},append(){}},
  getElementById(k){return k==='mail-archive-record'?metadata:k==='backToArchive'?oldBack:k==='loadRemoteImages'?oldButton:null;},
  querySelector(k){if(k==='main')return elem('MAIN');if(k==='meta[http-equiv="Content-Security-Policy"]')return policy;return null;},
  querySelectorAll(k){if(k==='script,iframe,object,embed,form,link,base,video,audio')return [script];
   if(k==='*')return [remote,cid,download,original,unsafe];
   if(k==='img')return [remote,cid];
   if(k==='a[href]')return [download,original,unsafe];
   return [];},
  createElement(k){return elem(k.toUpperCase());}
 };
 last={remote,cid,download,original,unsafe,script,oldBack,oldButton,policy,root,metadata};
 return doc;
}
const rootHandle={name:'SelectedData'};
const Core={accountName:s=>s==='personal'?s:(()=>{throw Error('ACCOUNT');})(),
 async read(root,p){reads.push({root,p});return '<!doctype html><html lang="en"><main>Safe</main></html>';},
 async fileHandle(root,p){assert.equal(root,rootHandle);return {async getFile(){
  const name=p.split('/').pop();return {name,type:name.endsWith('.png')?'image/png':'application/octet-stream',size:20};}};}};
const runtime={ArchiveCore:Core,ArchiveReindex:{safeAttachmentHref:p=>/^attachments\/[a-z0-9.-]+$/.test(p)}};
class DOMParserMock{parseFromString(text,type){parsed.push({text,type});return fakeDoc();}}
vm.runInNewContext(code,{globalThis:runtime,DOMParser:DOMParserMock,URL:URLmock,Blob},{filename:'assets/data-reader.js'});
(async()=>{
 assert.equal(runtime.ArchiveDataReader.allowedMessage(record),true);
 assert.equal(runtime.ArchiveDataReader.allowedMessage({...record,path:'../outside.html'}),false);
 assert.equal(runtime.ArchiveDataReader.allowedMessage({...record,account:'..'}),false);
 const current=await runtime.ArchiveDataReader.open(rootHandle,record,{theme:'dark',autoImages:false});
 assert.equal(reads[0].root,rootHandle);
 assert.equal(reads[0].p,record.path);
 assert.equal(parsed[0].type,'text/html');
 assert.equal(last.root.theme,'dark');
 assert.equal(last.script.removed,true,'No saved-mail script may run in the sandbox');
 assert.equal(last.oldBack.removed,true,'Back navigation belongs to the parent app');
 assert.equal(last.oldButton.removed,true,'External-image consent belongs to the parent app');
 assert.equal(last.remote.getAttribute('src'),null,'Remote tracking image blocked by default');
 assert.equal(last.remote.getAttribute('onerror'),null,'Event handlers removed');
 assert.match(last.cid.getAttribute('src'),/^blob:fixture-/,'CID image redirected to local blob');
 assert.match(last.download.getAttribute('href'),/^blob:fixture-/,'Attachment is read via file handle');
 assert.equal(last.download.getAttribute('download'),'attachment');
 assert.match(last.original.getAttribute('href'),/^blob:fixture-/,'Stored EML is available');
 assert.equal(last.unsafe.getAttribute('href'),null,'javascript: links are removed');
 assert.match(last.policy.getAttribute('content'),/script-src 'none'/);
 assert(!last.policy.getAttribute('content').includes('http:'),'Manual image mode blocks all remote resource URLs via CSP.');
 assert.equal(current.url,'blob:fixture-4');
 current.dispose();assert.equal(revoked.length,4,'All local object URLs are cleaned on exit');
 const auto=await runtime.ArchiveDataReader.open(rootHandle,record,{theme:'light',autoImages:true});
 assert.equal(last.remote.getAttribute('src'),'https://example.invalid/tracker','Explicit image preference respected');
 assert(last.policy.getAttribute('content').includes('https: http:'),'Auto images permits remote requests only with active preference.');
 assert.equal(last.root.theme,'light');
 auto.dispose();
 last.metadata.textContent=JSON.stringify({schema:1,record:{...record,path:'../../not-the-selected-record'}});
 // A separate hostile metadata source is rejected before opening attachments.
 class WrongParser{parseFromString(){const doc=fakeDoc();
  last.metadata.textContent=JSON.stringify({schema:1,record:{...record,path:'../wrong.html'}});
  return doc;}}
 await assert.rejects(
  async()=>{vm.runInNewContext(code,{globalThis:runtime,DOMParser:WrongParser,URL:URLmock,Blob});await runtime.ArchiveDataReader.open(rootHandle,record);},
  e=>e.message==='MESSAGE_METADATA');
 console.log('PASS selected-root file handles, CID assets and original EML download through blobs');
 console.log('PASS opaque sandbox, script removal, CSP and blocked unsafe links');
 console.log('PASS external images require explicit preference and old resources are revoked');
 console.log('PASS malformed record paths and mismatched embedded metadata are rejected');
})().catch(e=>{console.error(e);process.exitCode=1;});
