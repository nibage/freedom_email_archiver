/* Lightweight offline tests for per-message navigation and remote image consent. */
'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const crypto=require('node:crypto');
const root=path.join(__dirname,'..');
const context={ArchiveEML:{safeOriginal:()=>false},crypto:crypto.webcrypto,TextEncoder,btoa:bytes=>Buffer.from(bytes,'binary').toString('base64')};
vm.runInNewContext(fs.readFileSync(path.join(root,'assets/mail-renderer.js'),'utf8'),context,{filename:'assets/mail-renderer.js'});
const meta={id:'a'.repeat(64),subject:'Fictional test',date:'2025-01-01T00:00:00Z',rawDate:'',from:'sender@example.invalid',to:'reader@example.invalid',cc:'',bcc:'',labels:[],messageId:'<test@example.invalid>'};
const page=context.MailRenderer.documentHTML(meta,'<div class="mail-content"><img data-remote-src="https://example.invalid/pixel" alt="Pixel"></div>',[],'../../../__email_archiver/');
assert(page.includes('id="backToArchive"'));
assert(page.includes('href="../../../__email_archiver/index.html"'));
const extracted=/<script>([\s\S]*?)<\/script>/.exec(page);
assert(extracted,'Standalone email must have a reader script.');
const script=extracted[1];
const sha=crypto.createHash('sha256').update(script).digest('base64');
assert(page.replaceAll('&#39;',"'").includes("script-src 'sha256-"+sha+"'"),'CSP must allow exactly the bundled reader script.');
assert(!page.includes("script-src 'unsafe-inline'"));
const sourceIndex=fs.readFileSync(path.join(root,'index.html'),'utf8');
const app=fs.readFileSync(path.join(root,'assets/app.js'),'utf8');
const styles=fs.readFileSync(path.join(root,'assets/style.css'),'utf8');
assert(sourceIndex.indexOf('id="notice"')<sourceIndex.indexOf('id="import"'),'Notices must appear above import panels.');
assert(sourceIndex.indexOf('id="progressPanel"')<sourceIndex.indexOf('class="importgrid"'),'Import progress must appear above the importer.');
assert(styles.includes('grid-template-columns:repeat(4,minmax(0,1fr))')&&styles.includes('.filters .search{grid-column:span 2}'),'Search must retain half the filter row while dates match.');
assert(sourceIndex.includes('id="previewReaders"')&&sourceIndex.includes('id="upgradeReaders"'),'Legacy reader repair must be available in the import workspace.');
assert(sourceIndex.includes('id="autoImages" checked'));
assert(app.includes("images='+($('autoImages').checked?'auto':'manual')"));
assert(app.includes('saveReturnPosition()')&&app.includes('restoreReturnPosition()'));
function simulate(query,length=2){
 const attrs=new Map([['data-remote-src','https://example.invalid/pixel']]);
 const img={getAttribute:k=>attrs.get(k)||null,setAttribute:(k,v)=>attrs.set(k,v),removeAttribute:k=>attrs.delete(k)};
 const handlers={};let removed=false,wentBack=false,prevented=false;
 const button={addEventListener:(ev,cb)=>handlers['load-'+ev]=cb,remove:()=>removed=true};
 const back={addEventListener:(ev,cb)=>handlers['back-'+ev]=cb};
 const document={getElementById:id=>id==='loadRemoteImages'?button:id==='backToArchive'?back:null,
  querySelectorAll:()=>[img]};
 vm.runInNewContext(script,{location:{search:query},URLSearchParams,document,history:{length,back:()=>wentBack=true}});
 return {attrs,handlers,clicked:()=>{handlers['load-click']?.();},back:()=>{handlers['back-click']?.({preventDefault(){prevented=true;}});return {wentBack,prevented};},get removed(){return removed;}};
}
const automatic=simulate('?fromArchive=1&images=auto');
assert.equal(automatic.attrs.get('src'),'https://example.invalid/pixel');
assert.equal(automatic.attrs.has('data-remote-src'),false);
assert.equal(automatic.removed,true);
assert.deepEqual(automatic.back(),{wentBack:true,prevented:true});
const manual=simulate('?fromArchive=1&images=manual');
assert.equal(manual.attrs.has('src'),false,'Manual mode must not initiate remote requests.');
assert.equal(manual.attrs.has('data-remote-src'),true);
manual.clicked();
assert.equal(manual.attrs.get('src'),'https://example.invalid/pixel');
const direct=simulate('',1);
assert.equal(direct.attrs.has('src'),false,'Opening standalone HTML directly must remain remote-blocked.');
assert.deepEqual(direct.back(),{wentBack:false,prevented:false});
console.log('PASS: checked default and app link preference');
console.log('PASS: CSP inline-script SHA-256 matches exactly');
console.log('PASS: auto mode loads only from an explicit viewer URL');
console.log('PASS: manual/direct mode blocks until button click');
console.log('PASS: Back uses history for viewer links, falls back for direct pages');

(async()=>{
 const oldScript=String.raw`document.getElementById('loadRemoteImages')?.addEventListener('click',function(){document.querySelectorAll('.mail-content img[data-remote-src]').forEach(function(img){const src=img.getAttribute('data-remote-src');if(src&&/^https?:\/\//i.test(src)){img.setAttribute('src',src);img.removeAttribute('data-remote-src');}});this.remove();});`;
 const oldHash=crypto.createHash('sha256').update(oldScript).digest('base64');
 assert.equal(oldHash,'ONdzB2Snb1KGFcLxYAyUoEX6twdM5pCy78sdYqecEqs=','Legacy reader fingerprint must remain exact.');
 const currentHash=crypto.createHash('sha256').update(script).digest('base64');
 const oldPage=page.replace('<script>'+script+'</script>','<script>'+oldScript+'</script>')
  .replace('sha256-'+currentHash,'sha256-'+oldHash)
  .replace(' id="backToArchive"','')
  .replace('← Back to archive','← Email Archive');
 const originalBody=/<main>([\s\S]*?)<\/main>/.exec(oldPage)[1];
 const upgraded=await context.MailRenderer.upgradeHtmlPage(oldPage);
 assert.equal(upgraded.status,'updated');
 assert(upgraded.html.includes('id="backToArchive"'));
 assert(upgraded.html.includes('script-src &#39;sha256-'+currentHash+'&#39;'));
 assert.equal(/<main>([\s\S]*?)<\/main>/.exec(upgraded.html)[1],originalBody,'Mail body must not be altered');
 const again=await context.MailRenderer.upgradeHtmlPage(upgraded.html);
 assert.equal(again.status,'current','Already upgraded messages must not be rewritten');
 assert.equal((await context.MailRenderer.upgradeHtmlPage(page.replace(script,'alert(1)'))).status,'unsupported','Never rewrite an unknown script');
 const unchanged=await context.MailRenderer.upgradeHtmlPage(page.replace('data-remote-src=','data-unavailable-src='));
 assert.equal(unchanged.status,'no-remote');
 console.log('PASS: legacy remote-image reader upgrade preserves email body and CSP');
 console.log('PASS: unknown scripts are not modified; upgrades are idempotent');
})().catch(e=>{console.error(e);process.exitCode=1;});
