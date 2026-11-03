/* Offline light/dark theme smoke tests. No browser permission or mail data needed. */
'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.join(__dirname,'..');
const src=fs.readFileSync(path.join(root,'assets/theme.js'),'utf8');
const index=fs.readFileSync(path.join(root,'index.html'),'utf8');
const css=fs.readFileSync(path.join(root,'assets/style.css'),'utf8');
const guide=fs.readFileSync(path.join(root,'GUIDE.html'),'utf8');
assert(index.includes('id="themeToggle"')&&index.includes('data-theme-label'));
assert(guide.includes('id="themeToggle"')&&guide.includes('assets/theme.js'));
assert(index.indexOf('assets/theme.js')<index.indexOf('assets/style.css'),'Theme must initialize before CSS paints.');
assert(index.includes("script-src 'self' file:"),'CSP must allow the local theme script.');
assert(guide.includes("script-src 'self' file:"),'Guide must allow the local theme script.');
assert(css.includes('html[data-theme="dark"]'));
assert(css.includes('--header-bg:#851a26'),'Light header should be brick red.');
assert(css.includes('--teal:#921d2b'),'Light accent should be brick red.');
assert(css.includes('--paper:#0e1014')&&css.includes('--surface:#1d2129'),'Dark surfaces should be charcoal.');
assert(css.includes('--teal:#f5a623'),'Dark accent should be orange.');
assert(css.includes('color-scheme:dark'),'Native controls should receive dark mode.');
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
 const label={textContent:''},icon={textContent:''};
 const button={
  attrs:{},title:'',
  setAttribute(k,v){this.attrs[k]=v;},
  querySelector(s){return s==='[data-theme-icon]'?icon:s==='[data-theme-label]'?label:null;},
  addEventListener(name,fn){handlers[name]=fn;}
 };
 const document={
  readyState:'loading',
  documentElement:{setAttribute(k,v){if(k==='data-theme')mode=v;}},
  getElementById(id){return id==='themeToggle'?button:null;},
  addEventListener(name,fn){handlers[name]=fn;}
 };
 const localStorage={
  getItem(key){if(blocked)throw Error('storage unavailable');return current.get(key)||null;},
  setItem(key,val){if(blocked)throw Error('storage unavailable');current.set(key,val);storageWrites++;}
 };
 vm.runInNewContext(src,{document,localStorage},{filename:'assets/theme.js'});
 const first=mode;
 handlers.DOMContentLoaded();
 return {get mode(){return mode;},first,button,icon,label,storageWrites:()=>storageWrites,stored:()=>current.get('email-archiver-theme'),click:()=>handlers.click()};
}
const first=scenario();
assert.equal(first.first,'light');
assert.equal(first.label.textContent,'Dark mode');
assert.equal(first.button.attrs['aria-pressed'],'false');
first.click();
assert.equal(first.mode,'dark');
assert.equal(first.stored(),'dark');
assert.equal(first.label.textContent,'Light mode');
assert.equal(first.button.attrs['aria-label'],'Switch to light mode');
assert.equal(first.button.attrs['aria-pressed'],'true');
const remembered=scenario(first.stored());
assert.equal(remembered.first,'dark','Previously selected theme must load immediately.');
remembered.click();
assert.equal(remembered.stored(),'light');
assert.equal(remembered.button.attrs['aria-pressed'],'false');
const noStorage=scenario(null,true);
noStorage.click();
assert.equal(noStorage.mode,'dark','Switch must work even with localStorage disabled.');
assert.equal(noStorage.storageWrites(),0);
console.log('PASS: brick light and orange dark semantic palette tokens and native controls');
console.log('PASS: theme initializes before CSS, switches with accessible labels, and persists');
console.log('PASS: offline guide shares theme; storage restrictions do not break the toggle');
