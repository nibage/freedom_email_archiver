/* Bounded, cancellable native writer acquisition, including late resolutions. */
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const context={TextEncoder,TextDecoder,DOMException,crypto:require('node:crypto').webcrypto,
 setTimeout,clearTimeout,MailRenderer:{},console};
vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../assets/core.js'),'utf8'),context);
const C=context.ArchiveCore;
let release,closed=0;
const missing=()=>{throw new DOMException('Missing','NotFoundError');};
const root={getDirectoryHandle:async()=>missing(),getFileHandle:async(name,{create=false}={})=>{
 if(!create)return missing();assert.equal(name,'archive.lock');
 return {createWritable:()=>new Promise(resolve=>{release=()=>resolve({close:async()=>{closed++;}});})};
}};
(async()=>{
 const late=new C.Importer(root);
 await assert.rejects(()=>late.lock({timeoutMs:20}),e=>e.message==='ARCHIVE_LOCK_TIMEOUT');
 release();await new Promise(r=>setTimeout(r,0));assert.equal(closed,1);assert.equal(late.lockWriter,undefined);
 const controller=new AbortController(),cancelled=new C.Importer(root,{signal:controller.signal});
 const wait=cancelled.lock();await new Promise(r=>setTimeout(r,0));controller.abort();
 await assert.rejects(()=>wait,e=>e.name==='AbortError');release();await new Promise(r=>setTimeout(r,0));assert.equal(closed,2);
 let accessed=false;const stopped=new AbortController();stopped.abort();
 await assert.rejects(()=>new C.Importer({getFileHandle(){accessed=true;}},{signal:stopped.signal}).lock(),e=>e.name==='AbortError');assert.equal(accessed,false);
 console.log('PASS import/catalog lock timeout and cancellation close late writers without hidden locks');
})().catch(e=>{console.error(e);process.exitCode=1;});
