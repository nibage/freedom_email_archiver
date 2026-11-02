/* Offline tests for an interrupted and preview-only archived reader upgrade.
   Only fictional data are used; no disk writes. */
'use strict';
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const source=fs.readFileSync(path.join(__dirname,'../assets/reader-upgrade.js'),'utf8');
const contents=new Map([
 ['test/2025/2025-01/email-'+'a'.repeat(64)+'.html','legacy-reader'],
 ['test/2025/2025-01/email-'+'b'.repeat(64)+'.html','already-current'],
 ['test/2025/2025-01/email-'+'c'.repeat(64)+'.html','unknown-reader']
]);
const files=[...contents.keys()].map(path=>({path,handle:{async getFile(){return {size:200,async text(){return contents.get(path);}}}}}));
const writes=[],lockState={acquired:0,closed:0};
const context={
 ArchiveCore:{
  Importer:class{constructor(root){}async lock(){lockState.acquired++;this.lockWriter={close:async()=>{lockState.closed++;}};}},
  async write(root,p,text){writes.push({path:p,text});contents.set(p,text);}
 },
 ArchiveReindex:{async *scan(root){for(const f of files)yield f;}},
 MailRenderer:{async upgradeHtmlPage(page){
  if(page==='legacy-reader')return {status:'updated',html:'modern-reader'};
  if(page==='already-current'||page==='modern-reader')return {status:'current'};
  return {status:'unsupported'};
 }}
};
vm.runInNewContext(source,{globalThis:context,Promise,setTimeout},{filename:'assets/reader-upgrade.js'});
async function main(){
 const preview=await context.ArchiveReaderUpgrade.run({},{});
 assert.equal(preview.scanned,3);assert.equal(preview.eligible,1);assert.equal(preview.updated,0);
 assert.equal(writes.length,0,'Preview cannot modify emails or catalog');
 assert.equal(lockState.acquired,0,'Preview should not acquire a write lock');
 const applied=await context.ArchiveReaderUpgrade.run({}, {write:true});
 assert.equal(applied.updated,1);assert.equal(writes.length,1);
 assert.equal(writes[0].path,files[0].path);
 assert.equal(writes[0].text,'modern-reader');
 assert.equal(lockState.acquired,1);assert.equal(lockState.closed,1);
 const next=await context.ArchiveReaderUpgrade.run({},{});
 assert.equal(next.eligible,0,'Updated pages are not offered again');
 const stopped=new AbortController();stopped.abort();
 const cancelled=await context.ArchiveReaderUpgrade.run({},{write:true,signal:stopped.signal});
 assert.equal(cancelled.interrupted,true);assert.equal(writes.length,1,'Stopped upgrade cannot rewrite another page');
 assert.equal(lockState.closed,2,'Stopped writer must release lock');
 console.log('PASS: preview is read only and reports legacy/current/unknown readers');
 console.log('PASS: only identified older reader pages are rewritten and lock is released');
 console.log('PASS: rerun is idempotent and cancellation performs no further writes');
}
main().catch(e=>{console.error(e);process.exitCode=1;});