/* Offline theme preference. No external resources and no email content access. */
(function(){
 'use strict';
 const KEY='email-archiver-theme';
 let theme='light';
 try{
  const saved=localStorage.getItem(KEY);
  if(saved==='light'||saved==='dark')theme=saved;
 }catch{/* Some file:// contexts restrict local storage. */}
 function apply(mode){
  document.documentElement.setAttribute('data-theme',mode);
  const button=document.getElementById('themeToggle');
  if(!button)return;
  const dark=mode==='dark';
  const label=dark?'Switch to light mode':'Switch to dark mode';
  button.setAttribute('aria-label',label);
  button.setAttribute('aria-pressed',String(dark));
  button.title=label;
  const glyph=button.querySelector('[data-theme-icon]');
  const words=button.querySelector('[data-theme-label]');
  if(glyph)glyph.textContent=dark?'☀':'☾';
  if(words)words.textContent=dark?'Light mode':'Dark mode';
 }
 // Set the document theme before loading the main stylesheet to prevent a bright flash.
 apply(theme);
 function init(){
  apply(theme);
  const button=document.getElementById('themeToggle');
  if(!button)return;
  button.addEventListener('click',()=>{
   theme=theme==='dark'?'light':'dark';
   apply(theme);
   try{localStorage.setItem(KEY,theme);}catch{/* The current tab still switches. */}
  });
 }
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});
 else init();
})();
