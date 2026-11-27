/* Capture the real offline application, using fictional demonstration data only. */
'use strict';
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {pathToFileURL}=require('node:url'),assert=require('node:assert/strict');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'..'),output=path.join(root,'docs','screenshots');
async function main(){
 const source=path.join(root,'archived_emails');
 assert.deepEqual((await fs.readdir(source)).sort(),['catalog','example'],'Screenshots require the untouched public demo archive, not personal email');
 const manifest=JSON.parse(/^MailArchive\.receive\(([\s\S]*)\);\s*$/.exec(await fs.readFile(path.join(source,'catalog','archive.js'),'utf8'))[1]);
 assert.deepEqual(manifest.accounts,['example']);
 assert.equal(manifest.total,4);
 const expected=['0af2d4ccad1dd08ceacc76ccc02fd9659bcff4eea7febbb8839e363a438cfed6','1aa6ed31dd39f5920719b5a7d8755c3077a62a3b3a57b5362acd758c37ce61fe','acd8e5e92f83b12203623ea96c242e7a6e47fe0d9837ae8d8744e83a65d4faf3','95741e96e1daf0f5c2e19894659f7ec1293d5c7b9b59956c265a11997c249f00'].sort();
 const records=[];
 for(const segment of manifest.segments){
  assert.match(segment.meta,/^example\/catalog\/[a-z0-9-]+\.js$/);
  const data=JSON.parse(/^MailArchive\.receive\(([\s\S]*)\);\s*$/.exec(await fs.readFile(path.join(source,segment.meta),'utf8'))[1]);
  records.push(...data.records);
 }
 assert.deepEqual(records.map(r=>r.id).sort(),expected);
 for(const record of records){
  assert.equal(record.account,'example');
  for(const field of ['from','to','cc','bcc','messageId'])for(const m of (record[field]||'').matchAll(/@[a-z0-9.-]+/gi))assert(m[0].endsWith('.invalid'));
 }
 const temp=await fs.mkdtemp(path.join(os.tmpdir(),'freedom-email-screenshots-'));
 let browser;
 try{
  for(const name of ['index.html','GUIDE.html','assets','archived_emails'])await fs.cp(path.join(root,name),path.join(temp,name),{recursive:true});
  await fs.mkdir(output,{recursive:true});
  browser=await chromium.launch({headless:true,...(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{})});
  const context=await browser.newContext({offline:true,viewport:{width:1440,height:820},deviceScaleFactor:1,locale:'en-GB',timezoneId:'UTC'});
  const page=await context.newPage();
  const errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.goto(pathToFileURL(path.join(temp,'index.html')).href);
  await page.waitForFunction(()=>window.ArchiveUI?.records.size===4&&document.querySelectorAll('#rows tr').length===4);
  await page.evaluate(()=>document.fonts.ready);
  async function capture(name){
   await page.evaluate(()=>window.scrollTo(0,0));
   await page.screenshot({path:path.join(output,name+'.png'),animations:'disabled',fullPage:true});
   console.log('Captured '+name);
  }
  assert.equal(await page.locator('html').getAttribute('data-theme'),'light');
  await capture('browse-light');
  await page.click('#themeToggle');
  await page.waitForFunction(()=>document.documentElement.dataset.theme==='dark');
  await capture('browse-dark');
  await page.click('#autoImages'); // Do not load external content in documentation.
  await page.locator('.subject').filter({hasText:'A tiny trip plan'}).click();
  await page.waitForFunction(()=>document.documentElement.dataset.theme==='dark'&&!!document.getElementById('backToArchive'));
  await capture('message');
  await page.click('#backToArchive');
  await page.waitForFunction(()=>window.ArchiveUI?.records.size===4);
  if(await page.locator('html').getAttribute('data-theme')==='dark')await page.click('#themeToggle');
  await page.click('#importTab');
  await page.locator('#files').setInputFiles(path.join(root,'tests','fixtures','example.mbox'));
  await capture('import');
  assert.deepEqual(errors,[],'Screenshot capture must not hide app errors');
  await context.close();
 }finally{if(browser)await browser.close();await fs.rm(temp,{recursive:true,force:true});}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
