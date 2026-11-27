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
  await fs.mkdir(app);for(const name of ['index.html','GUIDE.html','assets','archived_emails'])await fs.cp(path.join(repo,name),path.join(app,name),{recursive:true});
  const indexFile=path.join(app,'index.html');
  const indexHtml=await fs.readFile(indexFile,'utf8');
  // Small test-only page size survives navigation/reload like the real 50/100/200 options.
  await fs.writeFile(indexFile,indexHtml.replace('<select id="pageSize">','<select id="pageSize"><option value="2">2</option>').replace('<option>50</option>','<option selected>50</option>'));
  server=await chromium.launchServer({headless:true,...(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{})});
  const browser=await chromium.connect(server.wsEndpoint()),context=await browser.newContext({offline:true}),page=await context.newPage(),errors=[];
  page.on('pageerror',e=>errors.push(e.message));await attachTestFilesystem(page,app);
  await page.goto(pathToFileURL(path.join(app,'index.html')).href);await page.waitForFunction(()=>window.ArchiveUI?.records.size===4);
  // Demo files must match the renderer used for newly imported emails.
  const demos=await page.evaluate(()=>[...ArchiveUI.records.values()]);
  for(const record of demos){
   const saved=await fs.readFile(path.join(data,record.path),'utf8');
   const body=/<main>([\s\S]*?)<\/main>/.exec(saved)[1];
   const meta=JSON.parse(/<script id="mail-archive-record" type="application\/json">([\s\S]*?)<\/script>/.exec(saved)[1]).record;
   const rendered=await page.evaluate(({meta,body})=>({
    version:MailRenderer.RENDER_VERSION,
    html:MailRenderer.documentHTML(meta,body,meta.attachments,'../'.repeat(meta.folder.split('/').length+1))
   }),{meta,body});
   assert.equal(record.renderVersion,rendered.version);
   assert.equal(meta.renderVersion,rendered.version);
   assert.equal(saved.trim(),rendered.html.trim(),'Demo shell must match current renderer: '+record.subject);
   if(record.subject==='A tiny trip plan')assert.match(body,/^<div class="mail-content">/);
   else assert.match(body,/^<pre>[\s\S]*<\/pre>$/,'Plain text demo must match imported plain text: '+record.subject);
  }
  console.log('PASS all four demo emails match the current HTML renderer');
  // Compact header and actual pagination on the four-message demo catalog.
  const originalViewport=page.viewportSize();
  await page.setViewportSize({width:1280,height:260});
  assert.equal(await page.locator('header #activeRootInfo').textContent(),'archived_emails/ · 4 indexed messages');
  assert.equal(await page.locator('header #browseTab').getAttribute('aria-pressed'),'true');
  assert.equal(await page.locator('header #importTab').getAttribute('aria-pressed'),'false');
  assert.ok((await page.locator('header.top').boundingBox()).height<=55);
  const filterRows=await page.locator('.filters').evaluate(el=>new Set([...el.children].map(c=>Math.round(c.getBoundingClientRect().bottom))).size);
  assert.equal(filterRows,1,'desktop filter strip should be one row');
  await page.evaluate(()=>window.scrollTo(0,100));
  await page.waitForFunction(()=>window.scrollY>=60&&Math.abs(document.querySelector('.filters').getBoundingClientRect().top)<2);
  await page.evaluate(()=>window.scrollTo(0,0));
  await page.evaluate(()=>{const s=document.getElementById('pageSize');s.value='2';s.dispatchEvent(new Event('change'));});
  await page.locator('#next').scrollIntoViewIfNeeded();
  assert.ok(await page.evaluate(()=>window.scrollY>0));
  await page.click('#next');await page.waitForFunction(()=>window.scrollY===0&&document.getElementById('pageInfo').textContent==='2 / 2');
  await page.locator('#prev').scrollIntoViewIfNeeded();
  await page.click('#prev');await page.waitForFunction(()=>window.scrollY===0&&document.getElementById('pageInfo').textContent==='1 / 2');
  assert.equal(await page.locator('#pageInfoTop').textContent(),'1 / 2');
  assert.equal(await page.locator('#prevTop').isDisabled(),true);
  await page.click('#nextTop');
  await page.waitForFunction(()=>document.getElementById('pageInfo').textContent==='2 / 2'&&document.getElementById('pageInfoTop').textContent==='2 / 2');
  assert.equal(await page.locator('#nextTop').isDisabled(),true);
  assert.equal(await page.locator('#next').isDisabled(),true);
  await page.click('#prevTop');
  await page.waitForFunction(()=>document.getElementById('pageInfo').textContent==='1 / 2');
  // The example account must preserve pagination when returning from mail.
  await page.click('#nextTop');
  await page.waitForFunction(()=>document.getElementById('pageInfo').textContent==='2 / 2');
  const examplePage2=await page.locator('.subject').allTextContents();
  await page.locator('.subject').first().click();
  await page.waitForURL(/archived_emails\/example\/.*\.html\?/);
  await page.locator('header a').first().click();
  await page.waitForFunction(()=>document.getElementById('pageInfo')?.textContent==='2 / 2');
  assert.deepEqual(await page.locator('.subject').allTextContents(),examplePage2);
  assert.equal(await page.locator('#pageSize').inputValue(),'2');
  await page.evaluate(()=>ArchiveUI.readCatalog());
  assert.equal(await page.locator('#pageInfoTop').textContent(),'2 / 2');
  await page.selectOption('#pageSize','50');
  await page.setViewportSize(originalViewport);
  await page.click('#importTab');
  assert.equal(await page.locator('#browseTab').getAttribute('aria-pressed'),'false');
  assert.equal(await page.locator('#importTab').getAttribute('aria-pressed'),'true');
  assert.equal(await page.locator('#browseTab').evaluate(el=>el.classList.contains('active')),false);
  assert.equal(await page.locator('.filters').isVisible(),false);
  assert.equal(await page.locator('#accessStatus .access-error').textContent(),'Archive access not enabled:');
  const tabCount=context.pages().length;
  assert.equal(await page.locator('#import .import-guide').count(),0,'Portable archive instructions belong in the guide');
  await page.click('#guideLink');await page.waitForURL(/GUIDE\.html\?from=import$/);
  assert.equal(await page.getByRole('heading',{name:'1. One portable archive'}).count(),1);
  assert.match(await page.locator('body').textContent(),/64 MiB per message/);
  assert.match(await page.locator('body').textContent(),/keep the tab open/i);
  assert.equal(context.pages().length,tabCount);
  await page.click('#guideBack');await page.waitForURL(/index\.html$/);
  await page.waitForFunction(()=>window.ArchiveUI?.records.size===4&&!document.getElementById('import').hidden);
  assert.equal(await page.locator('#importTab').getAttribute('aria-pressed'),'true');
  await page.click('#browseTab');await page.fill('#query','trip');
  await page.waitForFunction(()=>document.getElementById('rows').children.length===1);
  await page.click('#guideLink');await page.waitForURL(/GUIDE\.html\?from=browse$/);
  await page.click('#guideBack');await page.waitForURL(/index\.html$/);
  await page.waitForFunction(()=>document.getElementById('query').value==='trip'&&document.getElementById('rows').children.length===1&&!document.getElementById('browse').hidden);
  assert.equal(context.pages().length,tabCount);
  await page.click('#reset');await page.waitForFunction(()=>document.getElementById('rows').children.length===4);
  await page.click('#importTab');
  console.log('PASS guide stays in the same tab and returns to Browse or Import');
  await page.locator('#files').setInputFiles(path.join(repo,'tests/fixtures/example.mbox'));
  await page.click('#start');await page.waitForFunction(()=>document.getElementById('stop').hidden);
  assert.equal(await page.locator('#status').textContent(),'Import not started');assert.match(await page.locator('#operationNotice').textContent(),/Enable archive access/);
  await page.click('#connectArchive');await page.waitForFunction(()=>!document.getElementById('connectArchive').disabled);
  assert.match(await page.locator('#accessStatus').textContent(),/Archive access ready/);
  assert.equal(await page.locator('#accessStatus .access-ready').textContent(),'Archive access ready:');
  assert.equal(await page.locator('#accessStatus .access-error').count(),0);
  await page.click('#browseTab');await page.locator('.subject').filter({hasText:'A tiny trip plan'}).click();
  await page.waitForFunction(()=>location.pathname.includes('/archived_emails/example/2025/2025-01/'));
  assert.match(await page.locator('h1').textContent(),/A tiny trip plan/);
  assert.equal(await page.locator('img[src^="attachments/"]').count(),1,'CID attachment stays a relative local file');
  assert.equal(await page.locator('iframe').count(),0,'Saved mail opens as a full page, not an iframe');
  await page.locator('header a').first().click();await page.waitForFunction(()=>window.ArchiveUI?.records.size===4);
  // The fake test filesystem handle is a JS object and cannot survive a full
  // file:// reload in IndexedDB. Native Chrome handles can; reconnect this
  // disposable test adapter before testing actual writes.
  await page.click('#importTab');await page.click('#connectArchive');
  await page.waitForFunction(()=>document.getElementById('accessStatus').textContent.includes('Archive access ready'));
  console.log('PASS full-page example HTML, relative CID and Back navigation');
  await page.evaluate(()=>{ArchiveReindex.syncMissing=()=>{throw Error('Unexpected implicit catalog scan');};});
  async function importFile(file){
   await page.click('#importTab');
   // The test adapter is an uncloneable JS object, unlike native directory
   // handles stored by real Chrome. Reconnect after standalone-page navigation.
   if(!await page.evaluate(()=>!!window.ArchiveUI?.root)){
    await page.click('#connectArchive');
    await page.waitForFunction(()=>document.getElementById('accessStatus').textContent.includes('Archive access ready'));
   }
   await page.locator('#files').setInputFiles(path.join(repo,'tests','fixtures',file));await page.click('#start');
   try{
    await page.waitForFunction(()=>document.getElementById('stop').hidden&&document.getElementById('status').textContent==='Import complete',null,{timeout:15000});
   }catch(e){
    const status=await page.locator('#status').textContent(),detail=await page.locator('#progressDetail').textContent(),notice=await page.locator('#operationNotice').textContent();
    throw new Error('MBOX import did not complete (status '+status+'; detail '+detail+'; notice '+notice+'): '+e.message);
   }
  }
  const originalMessages=await snapshot(data,{messagesOnly:true});
  await importFile('example.mbox');assert.equal(await page.locator('#newCount').textContent(),'4');assert.equal(await page.evaluate(()=>ArchiveUI.records.size),8);
  await page.click('#browseTab');await page.selectOption('#accountFilter','personal');
  await page.waitForFunction(()=>document.getElementById('accountFilter').value==='personal'&&document.getElementById('rows').children.length===4);
  await page.locator('.subject').filter({hasText:'A tiny trip plan'}).click();
  await page.waitForFunction(()=>location.pathname.includes('/archived_emails/personal/'));
  assert.equal(await page.locator('html').getAttribute('data-theme'),'light','Modern standalone HTML follows light mode');
  assert.equal(await page.locator('iframe').count(),0);
  await page.locator('#backToArchive').click();await page.waitForFunction(()=>window.ArchiveUI?.records.size===8&&document.getElementById('accountFilter').value==='personal'&&document.getElementById('rows').children.length===4);
  await page.click('#themeToggle');await page.locator('.subject').filter({hasText:'A tiny trip plan'}).click();
  await page.waitForFunction(()=>location.pathname.includes('/archived_emails/personal/'));
  assert.equal(await page.locator('html').getAttribute('data-theme'),'dark','Modern standalone HTML follows app dark mode');
  assert.equal(await page.locator('iframe').count(),0);
  await page.locator('#backToArchive').click();await page.waitForFunction(()=>window.ArchiveUI?.records.size===8);
  await page.selectOption('#pageSize','2');
  await page.click('#nextTop');
  await page.waitForFunction(()=>document.getElementById('pageInfo').textContent==='2 / 2');
  const modernPage2=await page.locator('.subject').allTextContents();
  for(const browserBack of [false,true]){
   await page.locator('.subject').first().click();
   await page.waitForURL(/archived_emails\/personal\/.*\.html\?/);
   // Exact history return must work even when session storage was lost.
   await page.evaluate(()=>{try{sessionStorage.clear();}catch{}});
   if(browserBack)await page.goBack();else await page.locator('#backToArchive').click();
   await page.waitForFunction(()=>document.getElementById('pageInfo')?.textContent==='2 / 2'&&document.getElementById('accountFilter')?.value==='personal');
   assert.deepEqual(await page.locator('.subject').allTextContents(),modernPage2);
   assert.equal(await page.locator('#pageInfoTop').textContent(),'2 / 2');
   // Reproduce the second catalog load after returning.
   await page.evaluate(()=>ArchiveUI.readCatalog());
   assert.equal(await page.locator('#pageInfo').textContent(),'2 / 2');
   assert.deepEqual(await page.locator('.subject').allTextContents(),modernPage2);
  }
  await page.selectOption('#pageSize','50');
  await page.selectOption('#accountFilter','');
  await page.waitForFunction(()=>document.getElementById('pageInfo').textContent==='1 / 1');
  console.log('PASS modern and legacy Back preserve the results page; catalog refresh does not reset pagination');
  for(const [name,sum] of Object.entries(originalMessages))assert.equal((await snapshot(data,{messagesOnly:true}))[name],sum,'Import must not upgrade unrelated saved HTML');
  await importFile('example.mbox');assert.equal(await page.locator('#newCount').textContent(),'0');assert.equal(await page.locator('#dupeCount').textContent(),'4');
  await importFile('overlap.mbox');assert.equal(await page.locator('#newCount').textContent(),'1');assert.equal(await page.locator('#dupeCount').textContent(),'1');
  console.log('PASS import reads only MBOX/catalog: no library scan or appearance update');
  await page.click('#browseTab');await page.fill('#query','lighthouse');await page.waitForFunction(()=>document.getElementById('rows').children.length===2);await page.click('#reset');
  await fs.cp(path.join(data,'example'),path.join(data,'merged'),{recursive:true});
  // Treat the cloned fictional account as an earlier standalone-HTML archive.
  // Modern embedded metadata correctly binds account='example'; deliberately
  // remove it in this synthetic merged account to test legacy-header recovery
  // without forging modern metadata from a different account.
  async function legacyCopiedPages(dir){
   for(const e of await fs.readdir(dir,{withFileTypes:true})){
    const file=path.join(dir,e.name);
    if(e.isDirectory())await legacyCopiedPages(file);
    else if(e.name.endsWith('.html')){
     const page=await fs.readFile(file,'utf8');
     const earlier=page.replace(/<script id="mail-archive-record" type="application\/json">[\s\S]*?<\/script>/,'');
     assert.notEqual(earlier,page,'Expected a synthetic older HTML fixture');
     await fs.writeFile(file,earlier);
    }
   }
  }
  await legacyCopiedPages(path.join(data,'merged'));
  await page.click('#importTab');await page.locator('#files').setInputFiles([]);
  const beforeCheck=await snapshot(data);await page.click('#previewReaders');await page.waitForFunction(()=>document.getElementById('stopCheck').hidden);
  assert.match(await page.locator('#readerStatus').textContent(),/13 HTML messages checked/);assert.match(await page.locator('#catalogStatus').textContent(),/4 saved messages are unindexed/);
  assert.deepEqual(await snapshot(data),beforeCheck,'Check existing must not write any file');
  assert.equal(await page.locator('#existingProgress').evaluate(el=>el.value===el.max),true,'Check progress reaches total');
  assert.match(await page.locator('#existingProgressDetail').textContent(),/13 [/] 13/);
  const beforeRebuild=await snapshot(data,{messagesOnly:true});await page.click('#upgradeReaders');await page.waitForFunction(()=>!document.getElementById('upgradeReaders').disabled);
  assert.match(await page.locator('#catalogStatus').textContent(),/13 messages/);assert.equal(await page.evaluate(()=>ArchiveUI.records.size),13);
  assert.deepEqual(await snapshot(data,{messagesOnly:true}),beforeRebuild,'Rebuild must not rewrite HTML, attachments, EML or import reports');
  assert.equal(await page.locator('#existingProgress').evaluate(el=>el.value===el.max),true,'Rebuild progress includes published index');
  assert.match(await page.locator('#existingProgressTitle').textContent(),/complete/);
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
  assert.equal(await page.locator('.optional-maintenance').count(),0,'Removed appearance feature should not reappear');
  assert.equal(await page.locator('#refreshViewers').count(),0,'No old appearance update button');
  console.log('PASS no optional viewer appearance maintenance remains');
  await page.locator('#files').setInputFiles(path.join(repo,'tests/fixtures/example.mbox'));
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
