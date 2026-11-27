/* file:// workflow regression, real browser DOM + disposable disk adapter. */
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),{pathToFileURL}=require('node:url');
const {chromium}=require('playwright'),{attachTestFilesystem}=require('./browser-filesystem.cjs');
const repo=path.resolve(__dirname,'..');
async function snapshot(dir,{messagesOnly=false}={}){
 const values={};async function walk(p){for(const e of await fs.readdir(p,{withFileTypes:true})){const f=path.join(p,e.name);if(e.isDirectory())await walk(f);else{const relative=path.relative(dir,f).split(path.sep).join('/');if(!messagesOnly||!relative.split('/').includes('catalog')&&!relative.endsWith('.lock')||/\/import-[^/]+\.json$/.test(relative))values[relative]=require('node:crypto').createHash('sha256').update(await fs.readFile(f)).digest('hex');}}}await walk(dir);return values;
}
(async()=>{
 const temp=await fs.mkdtemp(path.join(os.tmpdir(),'freedom-email-test-')),app=path.join(temp,'portable-app'),data=path.join(app,'archived_emails');
 let server;
 try{
  await fs.mkdir(app);for(const name of ['index.html','assets','archived_emails'])await fs.cp(path.join(repo,name),path.join(app,name),{recursive:true});
  server=await chromium.launchServer({headless:true,...(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{})});
  const browser=await chromium.connect(server.wsEndpoint()),context=await browser.newContext({offline:true}),page=await context.newPage(),errors=[];
  page.on('pageerror',e=>errors.push(e.message));await attachTestFilesystem(page,app);
  await page.goto(pathToFileURL(path.join(app,'index.html')).href);await page.waitForFunction(()=>window.ArchiveUI?.records.size===4);
  await page.click('#importTab');await page.locator('#files').setInputFiles(path.join(repo,'examples/example.mbox'));
  await page.click('#start');await page.waitForFunction(()=>document.getElementById('stop').hidden);
  assert.equal(await page.locator('#status').textContent(),'Import not started');assert.match(await page.locator('#operationNotice').textContent(),/Enable archive access/);
  await page.click('#connectArchive');await page.waitForFunction(()=>!document.getElementById('connectArchive').disabled);
  assert.match(await page.locator('#accessStatus').textContent(),/Archive access ready/);
  await page.click('#browseTab');await page.locator('.subject').filter({hasText:'A tiny trip plan'}).click();
  await page.locator('h1').filter({hasText:'A tiny trip plan'}).waitFor();
  assert.match(page.url(),/email-[a-f0-9]{64}\.html\?/);
  assert.equal(await page.locator('iframe').count(),0);
  await page.waitForFunction(()=>{const img=document.querySelector('main img');return img?.complete&&img.naturalWidth>0;});
  await page.goBack();await page.waitForFunction(()=>window.ArchiveUI?.records.size===4);
  console.log('PASS authorized browsing opens standalone HTML and CID');
  async function ensureTestAccess(){
   if(!await page.evaluate(()=>!!ArchiveUI.root)){
    await page.click('#importTab');await page.click('#connectArchive');
    await page.waitForFunction(()=>!!ArchiveUI.root&&!document.getElementById('connectArchive').disabled);
   }
   await page.evaluate(()=>{ArchiveReindex.syncMissing=()=>{throw Error('Unexpected implicit catalog scan');};});
  }
  async function importFile(file){
   await ensureTestAccess();
   await page.click('#importTab');await page.locator('#files').setInputFiles(path.join(repo,'examples',file));await page.click('#start');
   await page.waitForFunction(()=>document.getElementById('stop').hidden&&document.getElementById('status').textContent==='Import complete');
  }
  const originalMessages=await snapshot(data,{messagesOnly:true});
  await importFile('example.mbox');assert.equal(await page.locator('#newCount').textContent(),'4');assert.equal(await page.evaluate(()=>ArchiveUI.records.size),8);
  for(const [name,sum] of Object.entries(originalMessages))assert.equal((await snapshot(data,{messagesOnly:true}))[name],sum,'Import must not upgrade unrelated saved HTML');
  await page.click('#browseTab');await page.selectOption('#accountFilter','personal');
  await page.waitForFunction(()=>document.getElementById('rows').children.length===4);
  for(const mode of ['dark','light']){
   if(await page.locator('html').getAttribute('data-theme')!==mode)await page.click('#themeToggle');
   await page.locator('.subject').filter({hasText:'A tiny trip plan'}).click();
   await page.locator('#backToArchive').waitFor();
   assert.equal(await page.locator('html').getAttribute('data-theme'),mode);
   assert.equal(await page.locator('iframe').count(),0);
   await page.click('#backToArchive');await page.waitForFunction(()=>window.ArchiveUI?.records.size===8&&document.getElementById('accountFilter').value==='personal');
  }
  await page.click('#reset');
  await importFile('example.mbox');assert.equal(await page.locator('#newCount').textContent(),'0');assert.equal(await page.locator('#dupeCount').textContent(),'4');
  await importFile('overlap.mbox');assert.equal(await page.locator('#newCount').textContent(),'1');assert.equal(await page.locator('#dupeCount').textContent(),'1');
  console.log('PASS import reads only MBOX/catalog: no library scan or appearance update');
  await page.click('#browseTab');await page.fill('#query','lighthouse');await page.waitForFunction(()=>document.getElementById('rows').children.length===2);await page.click('#reset');
  await fs.cp(path.join(data,'example'),path.join(data,'merged'),{recursive:true});
  await page.click('#importTab');await page.locator('#files').setInputFiles([]);
  await page.evaluate(()=>{
   window.maintenanceEvents=[];
   for(const name of ['checkMissing','rebuild']){
    const original=ArchiveReindex[name];
    ArchiveReindex[name]=(root,options)=>original(root,{...options,onProgress:state=>{
     options.onProgress(state);const bar=document.getElementById('existingProgress');
     maintenanceEvents.push({name,phase:state.phase,total:state.total,scanned:state.scanned,indeterminate:!bar.hasAttribute('value'),visible:!document.getElementById('existingProgressPanel').hidden});
    }});
   }
  });
  const beforeCheck=await snapshot(data);await page.click('#previewReaders');await page.waitForFunction(()=>document.getElementById('stopCheck').hidden);
  assert.match(await page.locator('#readerStatus').textContent(),/13 HTML messages checked/);assert.match(await page.locator('#catalogStatus').textContent(),/4 saved messages are unindexed/);
  assert.equal(await page.locator('#existingProgressPanel').isVisible(),true);assert.equal(await page.locator('#existingProgress').evaluate(el=>el.value===el.max),true);
  assert.deepEqual(await snapshot(data),beforeCheck,'Check existing must not write any file');
  const beforeRebuild=await snapshot(data,{messagesOnly:true});await page.click('#upgradeReaders');await page.waitForFunction(()=>!document.getElementById('upgradeReaders').disabled);
  assert.match(await page.locator('#catalogStatus').textContent(),/13 messages/);assert.equal(await page.evaluate(()=>ArchiveUI.records.size),13);
  assert.equal(await page.locator('#existingProgressPanel').isVisible(),true);assert.equal(await page.locator('#existingProgress').evaluate(el=>el.value===el.max),true);
  for(const name of ['checkMissing','rebuild']){
   const events=await page.evaluate(name=>maintenanceEvents.filter(e=>e.name===name),name);
   assert.ok(events.some(e=>e.phase==='counting'&&e.indeterminate&&e.visible));
   assert.ok(events.some(e=>e.phase==='scanning'&&e.total===13&&e.scanned>0&&!e.indeterminate&&e.visible));
  }
  assert.deepEqual(await snapshot(data,{messagesOnly:true}),beforeRebuild,'Rebuild must not rewrite HTML, attachments, EML or import reports');
  const removed=await page.evaluate(()=>[...ArchiveUI.records.values()].find(r=>r.account==='merged'&&r.subject==='Welcome to your email archive').path);
  await fs.unlink(path.join(data,removed));await page.click('#previewReaders');await page.waitForFunction(()=>document.getElementById('stopCheck').hidden);
  assert.match(await page.locator('#catalogStatus').textContent(),/1 stale catalog references/);
  await page.click('#upgradeReaders');await page.waitForFunction(()=>!document.getElementById('upgradeReaders').disabled);assert.equal(await page.evaluate(()=>ArchiveUI.records.size),12);
  console.log('PASS read-only check detects merged/removed files; rebuild changes only indexes without MBOX');
  const modern=await page.evaluate(()=>[...ArchiveUI.records.values()].find(r=>r.account==='personal'&&r.subject==='A tiny trip plan').path),modernFile=path.join(data,modern);
  const valid=await fs.readFile(modernFile,'utf8'),bad=valid.replace('"schema":1','"schema":99');await fs.writeFile(modernFile,bad);
  await importFile('overlap.mbox');assert.equal(await page.locator('#errorCount').textContent(),'0');assert.equal(await fs.readFile(modernFile,'utf8'),bad);
  await page.locator('#files').setInputFiles([]);const manifestBefore=await fs.readFile(path.join(data,'catalog/archive.js'),'utf8');
  await page.click('#previewReaders');await page.waitForFunction(()=>document.getElementById('stopCheck').hidden);assert.match(await page.locator('#readerStatus').textContent(),/1 unreadable\/invalid/);
  await page.click('#upgradeReaders');await page.waitForFunction(()=>!document.getElementById('upgradeReaders').disabled);assert.match(await page.locator('#catalogStatus').textContent(),/failed/);
  assert.equal(await fs.readFile(path.join(data,'catalog/archive.js'),'utf8'),manifestBefore);await fs.writeFile(modernFile,valid);
  console.log('PASS unrelated malformed HTML does not block MBOX import; strict rebuild preserves last good index');
  assert.equal(await page.locator('#refreshViewers').count(),0);
  await page.locator('#files').setInputFiles(path.join(repo,'examples/example.mbox'));
  await page.evaluate(()=>{const run=ArchiveCore.Importer.prototype.run;window.testRuns=0;window.restoreRun=()=>ArchiveCore.Importer.prototype.run=run;
   ArchiveCore.Importer.prototype.run=async function(){window.testRuns++;await new Promise(r=>this.signal.addEventListener('abort',r,{once:true}));return {interrupted:true,issues:[]};};});
  await page.evaluate(()=>{document.getElementById('start').onclick();document.getElementById('start').onclick();});await page.waitForFunction(()=>testRuns===1);
  assert.equal(await page.locator('#previewReaders').isDisabled(),true);await page.click('#stop');await page.waitForFunction(()=>document.getElementById('stop').hidden);
  assert.equal(await page.locator('#status').textContent(),'Import stopped');assert.equal(await page.locator('#start').isEnabled(),true);await page.evaluate(()=>restoreRun());
  console.log('PASS rapid Start clicks cannot overlap and Stop restores all controls');
  await page.reload();await page.waitForFunction(()=>window.ArchiveUI?.records.size===12);await page.fill('#query','lighthouse');await page.waitForFunction(()=>document.getElementById('rows').children.length===3);
  assert.equal(await page.evaluate(()=>ArchiveUI.root),null);assert.deepEqual(errors,[]);
  console.log('PASS saved indexes and search reopen through file:// without browser-profile handles');
  await page.goto(pathToFileURL(path.join(repo,'tests/index.html')).href);const suite=await page.evaluate(()=>runEnglishTests(archiveTestRoot,{}));
  assert.equal(suite.passed,suite.checks.length);console.log('PASS browser import-engine suite: '+suite.passed+' checks');
 }finally{server?.process()?.kill('SIGKILL');await fs.rm(temp,{recursive:true,force:true});}
})().then(()=>process.exit(0)).catch(e=>{console.error(e);process.exit(1);});
