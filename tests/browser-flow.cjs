/* Run with a development-only Playwright installation: node tests/browser-flow.cjs.
   Uses file:// and a disposable on-disk filesystem adapter, not native picker tests. */
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),{pathToFileURL}=require('node:url');
const {chromium}=require('playwright'),{attachTestFilesystem}=require('./browser-filesystem.cjs');
const repo=path.resolve(__dirname,'..');
(async()=>{
 const temp=await fs.mkdtemp(path.join(os.tmpdir(),'freedom-email-test-')),app=path.join(temp,'portable-app');
 let browser,server;
 try{
  await fs.mkdir(app);for(const name of ['index.html','assets','archived_emails'])await fs.cp(path.join(repo,name),path.join(app,name),{recursive:true});
  server=await chromium.launchServer({headless:true,...(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{})});
  browser=await chromium.connect(server.wsEndpoint());
  const context=await browser.newContext({offline:true}),page=await context.newPage(),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await attachTestFilesystem(page,app);
  await page.goto(pathToFileURL(path.join(app,'index.html')).href);
  await page.waitForFunction(()=>window.ArchiveUI?.records.size===4);
  await page.click('#importTab');await page.locator('#files').setInputFiles(path.join(repo,'examples/example.mbox'));
  await page.click('#start');await page.waitForFunction(()=>document.getElementById('stop').hidden);
  assert.equal(await page.locator('#status').textContent(),'Import not started');
  assert.match(await page.locator('#operationNotice').textContent(),/Enable archive access/);
  await page.click('#connectArchive');await page.waitForFunction(()=>!document.getElementById('connectArchive').disabled);
  assert.match(await page.locator('#accessStatus').textContent(),/Archive access ready/);
  await page.click('#browseTab');await page.locator('.subject').filter({hasText:'A tiny trip plan'}).click();
  await page.frameLocator('#messageFrame').locator('h1').waitFor();
  await page.frameLocator('#messageFrame').locator('img[src^="blob:"]').waitFor();
  assert(await page.frameLocator('#messageFrame').locator('h1').innerText());
  assert.equal(await page.frameLocator('#messageFrame').locator('script').count(),0);
  await page.click('#closeMessage');
  console.log('PASS authorized viewer opens legacy example HTML, attachments and CID');
  await page.click('#importTab');await page.click('#start');
  await page.waitForFunction(()=>document.getElementById('stop').hidden&&document.getElementById('status').textContent==='Import complete');
  assert.equal(await page.locator('#newCount').textContent(),'4');
  assert.equal(await page.evaluate(()=>ArchiveUI.records.size),8);
  await page.click('#start');await page.waitForFunction(()=>document.getElementById('stop').hidden&&document.getElementById('status').textContent==='Import complete');
  assert.equal(await page.locator('#newCount').textContent(),'0');assert.equal(await page.locator('#dupeCount').textContent(),'4');
  await page.locator('#files').setInputFiles(path.join(repo,'examples/overlap.mbox'));await page.click('#start');
  await page.waitForFunction(()=>document.getElementById('stop').hidden&&document.getElementById('status').textContent==='Import complete');
  assert.equal(await page.locator('#newCount').textContent(),'1');assert.equal(await page.locator('#dupeCount').textContent(),'1');
  console.log('PASS actual Start import handlers write messages, skip duplicates, merge overlap and reload Browse');
  await page.click('#browseTab');await page.fill('#query','lighthouse');await page.waitForFunction(()=>document.getElementById('rows').children.length===2);await page.click('#reset');
  await page.click('#importTab');await page.locator('#files').setInputFiles([]);await page.click('#previewReaders');
  await page.waitForFunction(()=>document.getElementById('stopCheck').hidden);
  assert.match(await page.locator('#readerStatus').textContent(),/9 HTML messages checked/);
  await page.click('#upgradeReaders');await page.waitForFunction(()=>!document.getElementById('upgradeReaders').disabled);
  assert.match(await page.locator('#readerStatus').textContent(),/9 messages indexed/);
  console.log('PASS Check existing and full rebuild work without an MBOX');
  await page.locator('#files').setInputFiles(path.join(repo,'examples/example.mbox'));
  await page.evaluate(()=>{
   const sync=ArchiveReindex.syncMissing;window.testSyncCalls=0;
   ArchiveReindex.syncMissing=async(root,options)=>{window.testSyncCalls++;await new Promise(resolve=>options.signal.addEventListener('abort',resolve,{once:true}));return {interrupted:true};};
   window.restoreSync=()=>ArchiveReindex.syncMissing=sync;
  });
  await page.evaluate(()=>{document.getElementById('start').onclick();document.getElementById('start').onclick();});
  await page.waitForFunction(()=>window.testSyncCalls===1);
  assert.equal(await page.locator('#start').isDisabled(),true);assert.equal(await page.locator('#previewReaders').isDisabled(),true);
  await page.click('#stop');await page.waitForFunction(()=>document.getElementById('stop').hidden);
  assert.equal(await page.locator('#status').textContent(),'Import stopped');
  assert.equal(await page.locator('#start').isEnabled(),true);await page.evaluate(()=>restoreSync());
  console.log('PASS rapid Start clicks cannot overlap, and Stop during recovery clears busy state');
  await page.reload();await page.waitForFunction(()=>window.ArchiveUI?.records.size===9);
  await page.fill('#query','lighthouse');await page.waitForFunction(()=>document.getElementById('rows').children.length===2);
  assert.equal(await page.evaluate(()=>ArchiveUI.root),null);
  assert.deepEqual(errors,[]);
  console.log('PASS new file:// load searches saved catalog without a remembered folder handle');
  // The manually runnable native suite must exercise the same data-only layout.
  await page.goto(pathToFileURL(path.join(repo,'tests/index.html')).href);
  
  const suite=await page.evaluate(()=>runEnglishTests(archiveTestRoot,{}));
  assert.equal(suite.passed,suite.checks.length);console.log('PASS browser import-engine suite: '+suite.passed+' checks');
 }finally{
  // End only the browser process owned by this disposable CLI test. Closing
  // the driver listener via process exit avoids Windows shutdown hangs.
  server?.process()?.kill('SIGKILL');
  await fs.rm(temp,{recursive:true,force:true});
 }
})().then(()=>process.exit(0)).catch(e=>{console.error(e);process.exit(1);});
