/* Node 20+ tests for source-byte fidelity and selected EML retention.
   No external packages, network, private messages, or browser required. */
'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../assets/eml.js'),'utf8');
const sandbox={globalThis:{}};
vm.runInNewContext(source,sandbox,{filename:'assets/eml.js'});
const E=sandbox.globalThis.ArchiveEML;
const encode=s=>new TextEncoder().encode(s);
const decode=b=>new TextDecoder().decode(b);
let checks=0;
function check(name,fn){fn();checks++;console.log('PASS '+name);}
async function run(){
 check('MBOXrd dequotes body lines, not headers, preserving CRLF',()=>{
  const input=encode('From: a@example.invalid\r\nX-Source: >From untouched\r\n\r\n>From one\r\n>>From two\r\n');
  const result=E.fromMbox(input);
  assert.equal(result.unescaped,2);
  assert.equal(decode(result.bytes),'From: a@example.invalid\r\nX-Source: >From untouched\r\n\r\nFrom one\r\n>From two\r\n');
 });
 check('Messages without MBOXrd escaping stay byte identical',()=>{
  const input=encode('From: a@example.invalid\r\n\r\nBody\r\n');
  assert.equal(decode(E.fromMbox(input).bytes),decode(input));
 });
 check('DKIM header alone does not retain EML',()=>assert.deepEqual(Array.from(E.classify({headers:[{key:'dkim-signature',value:'v=1'}]},[])),[]));
 check('S/MIME and OpenPGP signed messages retain EML',()=>{
  assert(E.classify({headers:[{key:'content-type',value:'multipart/signed; protocol="application/pgp-signature"'}]},[]).includes('signed'));
  assert(E.classify({headers:[{key:'content-type',value:'application/pkcs7-mime; smime-type=signed-data'}]},[]).includes('signed'));
  assert(E.classify({text:'-----BEGIN PGP SIGNED MESSAGE-----'},[]).includes('signed'));
 });
 check('Encrypted MIME and PGP armor retain EML',()=>{
  assert(E.classify({headers:[{key:'content-type',value:'multipart/encrypted'}]},[]).includes('encrypted'));
  assert(E.classify({headers:[{key:'content-type',value:'application/pkcs7-mime; smime-type=enveloped-data'}]},[]).includes('encrypted'));
  assert(E.classify({text:'-----BEGIN PGP MESSAGE-----'},[]).includes('encrypted'));
 });
 check('Gmail Important and Starred qualify, ignoring case/backslash',()=>assert.deepEqual(Array.from(E.classify({},['IMPORTANT','\\Starred'])),['gmail-important','gmail-starred']));
 check('Starred and Important are independent choices',()=>{
  const labels=['gmail-starred','gmail-important'];
  assert.deepEqual(Array.from(E.selectReasons(labels,{starred:true,important:false})),['gmail-starred']);
  assert.deepEqual(Array.from(E.selectReasons(labels,{starred:false,important:true})),['gmail-important']);
  assert.deepEqual(Array.from(E.selectReasons(labels,{starred:false,important:false})),[]);
  assert.deepEqual(Array.from(E.selectReasons(labels)),labels);
 });
 check('Signed or encrypted retention does not depend on Gmail label choices',()=>{
  const categories=['signed','encrypted','gmail-starred','gmail-important'];
  assert.deepEqual(Array.from(E.selectReasons(categories,{starred:false,important:false})),['signed','encrypted']);
  assert.deepEqual(Array.from(E.selectReasons(categories,{signed:false,encrypted:false})),['gmail-starred','gmail-important']);
  assert.deepEqual(Array.from(E.selectReasons(categories,{signed:false,encrypted:false,starred:false,important:false})),[]);
 });
 const files=new Map();let writes=0,corruptWrites=false;
 const C={
  hash:async b=>crypto.createHash('sha256').update(Buffer.from(b)).digest('hex'),
  write:async(root,p,b)=>{files.set(p,corruptWrites?encode('corrupted on write'):Uint8Array.from(b));writes++;},
  fileHandle:async(root,p)=>{
   if(!files.has(p))throw Error('NotFoundError');
   return {getFile:async()=>{const b=files.get(p);return {size:b.length,arrayBuffer:async()=>Uint8Array.from(b).buffer};}};
  }
 };
 sandbox.globalThis.ArchiveCore=C;
 const metadata={id:'a'.repeat(64),folder:'account/2025/2025-01'};
 const originalBytes=encode('From: a@example.invalid\r\n\r\n>From body\r\n');
 const saved=await E.preserve({},metadata,originalBytes,['gmail-important'],null);
 assert(await E.verify({},metadata,saved));checks++;console.log('PASS EML written and verified with real SHA-256');
 const repeated=await E.preserve({},metadata,originalBytes,['gmail-starred'],saved);
 assert.equal(writes,1);
 assert.deepEqual(Array.from(repeated.reasons),['gmail-important','gmail-starred']);
 checks++;console.log('PASS Reimport reuses verified EML and merges categories');
 files.set(metadata.folder+'/'+saved.href,encode('tampered'));
 assert.equal(await E.verify({},metadata,saved),false);
 const repaired=await E.preserve({},metadata,originalBytes,['gmail-important'],saved);
 assert(await E.verify({},metadata,repaired));
 assert.equal(writes,2);checks++;console.log('PASS Corruption detected and repaired from source');
 corruptWrites=true;let failed=false;
 try{await E.preserve({},metadata,encode('From: changed@example.invalid\r\n\r\nDifferent\r\n'),['signed'],null);}
 catch(e){failed=e.message==='EML_VERIFY_FAILED';}
 assert(failed);checks++;console.log('PASS Write-time checksum mismatch fails closed');
 assert.equal(E.safeOriginal({...saved,href:'../../evil.eml'},metadata.id),false);
 checks++;console.log('PASS EML path traversal is rejected');
 console.log('\n'+checks+' EML helper checks passed.');
}
run().catch(e=>{console.error(e);process.exitCode=1;});
