/* Offline light/dark theme smoke tests. No browser permission or mail data needed. */
'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.join(__dirname,'..');
const src=fs.readFileSync(path.join(root,'assets/theme.js'),'utf8');
const index=fs.readFileSync(path.join(root,'index.html'),'utf8');
const css=fs.readFileSync(path.join(root,'assets/style.css'),'utf8');
const guide=fs.readFileSync(path.join(root,'GUIDE.html'),'utf8');
const lightIcon=fs.readFileSync(path.join(root,'assets/favicon-light.svg'),'utf8');
const darkIcon=fs.readFileSync(path.join(root,'assets/favicon-dark.svg'),'utf8');
for(const svg of [lightIcon,darkIcon]){
 assert(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"'),'Favicon must be a local SVG.');
 assert(svg.includes('viewBox="0 0 64 64"'),'Icon must have scalable square proportions.');
 assert(svg.includes('<rect')&&svg.includes('<path'),'Icon should contain a recognizable envelope.');
 assert(!/<(?:script|image|foreignObject)\b/i.test(svg),'No active content or linked images in favicons.');
 assert(!/\b(?:href|src)=/i.test(svg),'Favicons must be self-contained.');
}
assert(lightIcon.includes('fill="#562237"'),'Light favicon should use the wine palette.');
assert(darkIcon.includes('fill="#17191E"')&&darkIcon.includes('stroke="#F5A623"'),'Dark favicon should use charcoal and orange.');
assert(index.includes('id="themeToggle"')&&index.includes('data-theme-label'));
assert(guide.includes('id="themeToggle"')&&guide.includes('assets/theme.js'));
assert(index.includes('id="appFavicon"')&&index.includes('assets/favicon-light.svg'));
assert(guide.includes('id="appFavicon"')&&guide.includes('assets/favicon-light.svg'));
assert(index.includes("img-src 'self' file:"),'App CSP should permit local SVG icons but no remote images.');
assert(guide.includes("img-src 'self' file:"),'Guide CSP should permit the local SVG favicon.');
assert(index.indexOf('assets/theme.js')<index.indexOf('assets/style.css'),'Theme must initialize before CSS paints.');
assert(index.includes("script-src 'self' file:"),'CSP must allow the local theme script.');
assert(guide.includes("script-src 'self' file:"),'Guide must allow the local theme script.');
assert(css.includes('html[data-theme="dark"]'));
assert(css.includes('--header-bg:#562237'),'Light header should be deep burgundy.');
assert(css.includes('--teal:#6c2943'),'Light accent should be muted burgundy.');
assert(css.includes('--paper:#0e1014')&&css.includes('--surface:#1d2129'),'Dark surfaces should be charcoal.');
assert(css.includes('--teal:#f5a623'),'Dark accent should be orange.');
assert(css.includes('color-scheme:dark'),'Native controls should receive dark mode.');
assert(!index.includes('YOUR MAIL LIBRARY')&&!index.includes('Keep what matters.'),'Remove redundant landing hero.');
assert(index.indexOf('id="chooseDir"')<index.indexOf('id="importAccount"'),'Archive root must precede account folder.');
assert(index.includes('Email account folder inside the archive'),'Use clearer email account label.');
assert(!index.includes('<aside')&&index.includes('class="panel import-guide"'),'Move incremental import guidance below the form.');
assert(!index.includes('No telemetry. No cloud API.'),'Remove redundant footer copy.');
assert(!index.includes('These settings are independent.'),'Remove verbose EML guidance.');
assert(css.includes('grid-template-columns:minmax(0,1fr);max-width:860px'),'Center the import instead of a two-column sidebar.');
assert(css.includes('.eml-options label{display:flex;flex-direction:row;align-items:center'),'Checkbox and label text must share a line.');
const htmlVariables=new Set([...css.matchAll(/var\((--[a-z-]+)/g)].map(m=>m[1]));
const lightBlock=css.slice(css.indexOf(':root{'),css.indexOf('html[data-theme="dark"]'));
const darkBlock=css.slice(css.indexOf('html[data-theme="dark"]'),css.indexOf('}',css.indexOf('html[data-theme="dark"]'))+1);
for(const key of htmlVariables){
 assert(lightBlock.includes(key+':'),'Missing light token '+key);
 assert(darkBlock.includes(key+':'),'Missing dark token '+key);
}
function scenario(initial,blocked=false){
 const current=new Map(initial?[['email-archiver-theme',initial]]:[]);
 const handlers={};let mode=null,storageWrites=0;
 const label={textContent:''},icon={textContent:''},favicon={href:'',setAttribute(k,v){if(k==='href')this.href=v;}};
 const button={
  attrs:{},title:'',
  setAttribute(k,v){this.attrs[k]=v;},
  querySelector(s){return s==='[data-theme-icon]'?icon:s==='[data-theme-label]'?label:null;},
  addEventListener(name,fn){handlers[name]=fn;}
 };
 const document={
  readyState:'loading',
  documentElement:{setAttribute(k,v){if(k==='data-theme')mode=v;}},
  getElementById(id){return id==='themeToggle'?button:id==='appFavicon'?favicon:null;},
  addEventListener(name,fn){handlers[name]=fn;}
 };
 const localStorage={
  getItem(key){if(blocked)throw Error('storage unavailable');return current.get(key)||null;},
  setItem(key,val){if(blocked)throw Error('storage unavailable');current.set(key,val);storageWrites++;}
 };
 vm.runInNewContext(src,{document,localStorage},{filename:'assets/theme.js'});
 const first=mode;
 handlers.DOMContentLoaded();
 return {get mode(){return mode;},first,button,icon,label,favicon,storageWrites:()=>storageWrites,stored:()=>current.get('email-archiver-theme'),click:()=>handlers.click()};
}
const first=scenario();
assert.equal(first.first,'light');
assert.equal(first.favicon.href,'assets/favicon-light.svg');
assert.equal(first.label.textContent,'Dark mode');
assert.equal(first.button.attrs['aria-pressed'],'false');
first.click();
assert.equal(first.mode,'dark');
assert.equal(first.favicon.href,'assets/favicon-dark.svg');
assert.equal(first.stored(),'dark');
assert.equal(first.label.textContent,'Light mode');
assert.equal(first.button.attrs['aria-label'],'Switch to light mode');
assert.equal(first.button.attrs['aria-pressed'],'true');
const remembered=scenario(first.stored());
assert.equal(remembered.first,'dark','Previously selected theme must load immediately.');
assert.equal(remembered.favicon.href,'assets/favicon-dark.svg');
remembered.click();
assert.equal(remembered.stored(),'light');
assert.equal(remembered.favicon.href,'assets/favicon-light.svg');
assert.equal(remembered.button.attrs['aria-pressed'],'false');
const noStorage=scenario(null,true);
noStorage.click();
assert.equal(noStorage.mode,'dark','Switch must work even with localStorage disabled.');
assert.equal(noStorage.favicon.href,'assets/favicon-dark.svg');
assert.equal(noStorage.storageWrites(),0);
console.log('PASS: brick light and orange dark semantic palette tokens and native controls');
console.log('PASS: theme initializes before CSS, switches with accessible labels, and persists');
console.log('PASS: offline guide shares theme; storage restrictions do not break the toggle');
console.log('PASS: both SVG favicons are local, self-contained, and match their themes');
