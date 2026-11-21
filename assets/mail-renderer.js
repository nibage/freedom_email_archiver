/* HTML email presentation: readable styling without remote loads or active email code. */
(function(g){'use strict';
// Bump when generated HTML, sanitization, or message controls change.
const RENDER_VERSION=2;
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const tags=['p','br','div','span','a','img','h1','h2','h3','h4','h5','h6','b','strong','i','em','u','s','strike','blockquote','pre','code','ul','ol','li','dl','dt','dd','table','thead','tbody','tfoot','tr','td','th','hr','sup','sub','center','font'];
const attrs=['href','src','alt','title','colspan','rowspan','dir','lang','class','style','bgcolor','color','face','size','align','valign','width','height','border','cellpadding','cellspacing'];
const properties=new Set('color background background-color font font-family font-size font-style font-weight font-variant line-height letter-spacing word-spacing text-align text-decoration text-transform text-indent white-space vertical-align direction display width min-width max-width height min-height max-height margin margin-top margin-right margin-bottom margin-left padding padding-top padding-right padding-bottom padding-left border border-top border-right border-bottom border-left border-color border-style border-width border-top-color border-right-color border-bottom-color border-left-color border-top-width border-right-width border-bottom-width border-left-width border-radius border-collapse border-spacing table-layout box-sizing list-style-type overflow-wrap word-break opacity float clear text-shadow box-shadow outline outline-color outline-style outline-width'.split(' '));
const displays=/^(block|inline|inline-block|none|table|inline-table|table-row|table-cell|table-row-group|table-header-group|table-footer-group|list-item|flex|inline-flex)$/i;
function safeStyle(css){
 const probe=document.createElement('span');probe.style.cssText=String(css||'').slice(0,8192);
 const safe=[];
 for(let i=0;i<probe.style.length&&i<80;i++){
  const key=probe.style.item(i),value=probe.style.getPropertyValue(key).trim();
  if(!properties.has(key)||!value||value.length>300)continue;
  if(/[\\{}<>@]/.test(value)||/[\x00-\x1f\x7f]/.test(value)||/(?:url|image-set|cross-fade|var|attr|expression|env|paint)\s*\(/i.test(value))continue;
  if(key==='display'&&!displays.test(value))continue;
  safe.push([key,value]);
 }
 return safe;
}
function applyStyle(el,pairs){for(const [key,value] of pairs)el.style.setProperty(key,value);}
function cleanHTML(html,cids={}){
 // Templates are inert; stylesheet rules are inlined into message nodes, never added to the document.
 let css='';
 if(/<style[\s>]/i.test(html)){
  const t=document.createElement('template');t.innerHTML=html;
  css=Array.from(t.content.querySelectorAll('style')).slice(0,24).map(s=>s.textContent||'').join('\n').slice(0,65536);
 }
 const frag=DOMPurify.sanitize(html,{ALLOWED_TAGS:tags,ALLOWED_ATTR:attrs,ADD_DATA_URI_TAGS:['img'],ALLOW_DATA_ATTR:false,ALLOW_ARIA_ATTR:false,RETURN_DOM_FRAGMENT:true});
 const wrapper=document.createElement('div');wrapper.className='mail-content';wrapper.append(frag);
 const els=Array.from(wrapper.querySelectorAll('*')).slice(0,10000),original=new WeakMap();
 for(const el of els){original.set(el,safeStyle(el.getAttribute('style')));el.removeAttribute('style');}
 if(css&&typeof CSSStyleSheet!=='undefined'){
  try{
   const sheet=new CSSStyleSheet();sheet.replaceSync(css);
   let seen=0;
   for(const rule of sheet.cssRules){
    if(++seen>240)break;
    if(rule.type!==CSSRule.STYLE_RULE||rule.selectorText.length>400)continue;
    const safe=safeStyle(rule.style.cssText);if(!safe.length)continue;
    for(const part of rule.selectorText.split(',').slice(0,12)){
     const selector=part.trim();
     if(/^(?:html|body|:root)$/i.test(selector)){applyStyle(wrapper,safe);continue;}
     const scoped=selector.replace(/^(?:html\s+)?body\s*(?:>\s*)?/i,'').trim();
     if(!scoped||/[\\{}@]/.test(scoped))continue;
     try{const matches=wrapper.querySelectorAll(scoped);for(let i=0;i<matches.length&&i<1000;i++)applyStyle(matches[i],safe);}catch{/* Ignore unsupported email selectors. */}
    }
   }
  }catch{/* A malformed stylesheet should not prevent mail import. */}
 }
 for(const el of els){
  applyStyle(el,original.get(el));
  if(el.hasAttribute('style')){
   const safe=safeStyle(el.getAttribute('style'));
   if(safe.length)el.setAttribute('style',safe.map(([k,v])=>k+':'+v).join(';'));
   else el.removeAttribute('style');
  }
  if(el.hasAttribute('href')){
   const href=el.getAttribute('href').trim();
   if(!/^(https?:\/\/|mailto:|tel:)/i.test(href))el.removeAttribute('href');
   else{el.setAttribute('target','_blank');el.setAttribute('rel','noopener noreferrer');}
  }
  if(el.tagName==='IMG'){
   const src=(el.getAttribute('src')||'').trim();
   let cid;try{cid=decodeURIComponent(src.replace(/^cid:/i,''));}catch{cid='';}
   const local=/^cid:/i.test(src)?cids[cid.replace(/^<|>$/g,'')]:null;
   if(local)el.setAttribute('src',local);
   else if(src.length<=4*1024*1024&&/^data:image\/(?:png|jpeg|gif|webp|bmp);base64,[a-z0-9+/=]+$/i.test(src))el.setAttribute('src',src);
   else{
    el.removeAttribute('src');
    const remote=/^https?:\/\//i.test(src);
    if(remote)el.setAttribute('data-remote-src',src);
    const reason=remote?'External image. Loading it contacts a remote server; if allowed, that server may still be unavailable.'
     :/^cid:/i.test(src)?'Inline image attachment missing, unsupported or not linked to this message.'
     :/^data:/i.test(src)?'Embedded image type or encoding is unsupported, or the data exceeds 4 MiB.'
     :src?'Unsafe or unsupported image URL was removed.':'No usable image source remains after sanitization.';
    el.setAttribute('title',reason);
    if(!el.getAttribute('alt'))el.setAttribute('alt',remote?'[External image unavailable]':'[Image not displayed: '+reason+']');
   }
  } }
 return {html:wrapper.outerHTML,text:wrapper.textContent||''};
}
const messageScript="(()=>{'use strict';const u=new URLSearchParams(location.search);const theme=u.get('theme');if(theme==='dark'||theme==='light')document.documentElement.setAttribute('data-theme',theme);else{try{const saved=localStorage.getItem('email-archiver-theme');if(saved==='dark'||saved==='light')document.documentElement.setAttribute('data-theme',saved);}catch{}}const button=document.getElementById('loadRemoteImages');const load=()=>{document.querySelectorAll('.mail-content img[data-remote-src]').forEach(img=>{const src=img.getAttribute('data-remote-src');if(src&&/^https?:\\/\\//i.test(src)){img.setAttribute('src',src);img.removeAttribute('data-remote-src');}});button?.remove();};button?.addEventListener('click',load);if(u.get('images')==='auto')load();const back=document.getElementById('backToArchive');if(back&&u.get('fromArchive')==='1')back.addEventListener('click',e=>{if(history.length>1){e.preventDefault();history.back();}});})();";
const csp="default-src 'none'; img-src 'self' file: data: https: http:; style-src 'unsafe-inline'; script-src 'sha256-7t/H/h9ZP4XQdAlrAQ/zqlDHz4FGcNes/FoUt9JHOoM='; connect-src 'none'; media-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";
const css=":root{color-scheme:light;--page:#edf0f3;--surface:#fff;--text:#292d35;--accent:#6c2943;--line:#d9dce2;--muted:#697380;--button:#f7eef2}html[data-theme=\"dark\"]{color-scheme:dark;--page:#0e1014;--surface:#1d2129;--text:#f0f2f6;--accent:#f5a623;--line:#343b46;--muted:#a4afbf;--button:#302a24}*{box-sizing:border-box}body{font:16px/1.65 system-ui,sans-serif;margin:0;padding:30px 20px;color:var(--text);background:var(--page)}body>header,body>main,body>section,.external-images{max-width:1000px;margin-left:auto;margin-right:auto}header{background:var(--surface);border:1px solid var(--line);border-radius:10px;padding:22px 26px}h1{font-size:25px;overflow-wrap:anywhere;line-height:1.25}dl{display:grid;grid-template-columns:110px 1fr;gap:5px}dt{color:var(--muted)}dd{margin:0;overflow-wrap:anywhere}main{padding:0;overflow-wrap:anywhere;margin-top:20px}.mail-content{overflow-x:auto;background:#fff;color:#182c3b;border:1px solid var(--line);border-radius:10px;padding:20px;min-height:100px}.mail-content img{max-width:100%;height:auto}.mail-content table{max-width:100%}pre{white-space:pre-wrap;overflow-wrap:anywhere}a{color:var(--accent)}.note{font-size:13px;color:var(--muted)}.external-images{margin-top:15px;margin-bottom:15px}.external-images button{font:inherit;padding:8px 13px;border:1px solid var(--line);border-radius:6px;background:var(--button);color:var(--text);cursor:pointer}body>section{background:var(--surface);border:1px solid var(--line);border-radius:10px;margin-top:18px;padding:18px 24px}body>section ul{padding-left:22px}@media(max-width:640px){body{padding:12px}header{padding:16px}dl{grid-template-columns:75px 1fr;gap:6px}.mail-content{padding:12px}}";
function documentHTML(meta,body,attachments,back){
 // Inert, self-describing record for offline catalog repair. JSON is HTML-safe.
 const record=JSON.stringify({schema:1,record:{...meta,attachments}}).replace(/</g,'\\u003c').replace(/\u2028/g,'\\u2028').replace(/\u2029/g,'\\u2029');
 const embedded='<script id="mail-archive-record" type="application/json">'+record+'</script>';
 const hasRemote=body.includes('data-remote-src=');
 const control=hasRemote?'<div class="external-images"><button id="loadRemoteImages" type="button">Load external images (contacts remote servers; may expose tracking)</button></div>':'';
 const original=meta.original&&g.ArchiveEML.safeOriginal(meta.original,meta.id)?meta.original:null;
 const originalBlock=original?'<section class="original-copy"><h2>Preserved source EML</h2><p><a href="'+esc(original.href)+'" download="email-'+esc(meta.id)+'.eml">Download EML source message</a> · '+Number(original.size).toLocaleString('en-GB')+' bytes</p><p class="note">SHA-256: <code>'+esc(original.sha256)+'</code></p><p class="note">Checksum verified when saved. Sender signatures are not verified. The file is reconstructed from the MBOX message; the MBOX envelope was excluded.</p></section>':'';
 return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="'+esc(csp)+'"><meta name="referrer" content="no-referrer"><meta name="viewport" content="width=device-width"><title>'+esc(meta.subject||'(No subject)')+'</title><style>'+css+'</style></head><body><header><a id="backToArchive" href="'+back+'index.html">← Back to archive</a><h1>'+esc(meta.subject||'(No subject)')+'</h1><dl>'+[['Date',meta.date||'Unknown / invalid date: '+meta.rawDate],['From',meta.from],['To',meta.to],['Cc',meta.cc],['Bcc',meta.bcc],['Labels',meta.labels.join(', ')],['Message-ID',meta.messageId||'(missing)']].filter(x=>x[1]).map(([k,v])=>'<dt>'+k+'</dt><dd>'+esc(v)+'</dd>').join('')+'</dl><p class="note">Safe archive view. Safe visual formatting is preserved. External images may contact senders when auto-loading is enabled in the archive viewer; otherwise use the Load external images button. Image placeholders explain why a source is not displayed; a blocked image alone does not mean that the email is malicious.</p></header>'+control+'<main>'+body+'</main>'+(attachments.length?'<section><h2>Attachments</h2><ul>'+attachments.map(a=>'<li><a href="'+esc(a.href)+'" download="'+esc(a.name)+'">'+esc(a.name)+'</a> <small>('+a.size.toLocaleString('en-GB')+' B'+(a.quarantined?'; safety suffix .download':'')+')</small>'+(a.preview?' · <a href="'+esc(a.preview)+'">Read embedded message</a>':'')+'</li>').join('')+'</ul></section>':'')+(originalBlock)+'<script>'+messageScript+'</script>'+(embedded)+'</body></html>';
}

g.MailRenderer={RENDER_VERSION,cleanHTML,documentHTML,safeStyle};
})(globalThis);
