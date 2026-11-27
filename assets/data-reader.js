/* Sandboxed read-only viewer for messages stored outside the application folder.
   Uses File System Access handles, not fetch or constructed file:// paths. */
(function(g){'use strict';
const C=g.ArchiveCore;
function allowedMessage(record){
 if(!record||typeof record.path!=='string'||typeof record.folder!=='string')return false;
 try{if(C.accountName(record.account)!==record.account)return false;}catch{return false;}
 if(!/^[a-f0-9]{64}$/.test(record.id||''))return false;
 const folder=record.account+'/(?:\\d{4}/\\d{4}-(?:0[1-9]|1[0-2])|unknown-date)';
 const expected=new RegExp('^'+folder+'/email-'+record.id+'\\.html$');
 return expected.test(record.path)&&record.path===record.folder+'/email-'+record.id+'.html';
}
function mediaType(filename,original){
 const ext=filename.slice(filename.lastIndexOf('.')+1).toLowerCase();
 const mime={png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',gif:'image/gif',webp:'image/webp',bmp:'image/bmp',
  svg:'application/octet-stream',txt:'text/plain',pdf:'application/pdf',eml:'message/rfc822'};
 return mime[ext]||original||'application/octet-stream';
}
async function open(root,record,{theme='light',autoImages=false}={}){
 if(!root||!allowedMessage(record))throw Error('MESSAGE_PATH');
 const text=await C.read(root,record.path);
 if(text.length>128*1024*1024)throw Error('MESSAGE_TOO_LARGE');
 // DOMParser parses in an inert document. Never insert saved mail into the app DOM.
 const doc=new DOMParser().parseFromString(text,'text/html');
 const embedded=doc.getElementById('mail-archive-record');
 let stored;
 if(embedded){
  let payload;
  try{payload=JSON.parse(embedded.textContent||'');}catch{throw Error('MESSAGE_METADATA');}
  stored=payload?.record;
  if(payload?.schema!==1||!stored||stored.account!==record.account||
     stored.id!==record.id||stored.path!==record.path||stored.folder!==record.folder)
   throw Error('MESSAGE_METADATA');
 }else{
  // Earlier standalone archives predate the inert JSON record. Recover only
  // their readable headers; malformed modern metadata must never fall back.
  stored=g.ArchiveReindex.fromHtml(text,record).record;
 }
 if(!doc.querySelector('main'))throw Error('MESSAGE_FORMAT');
 // Strip all scripts and active elements; the isolated iframe also denies
 // scripts, same-origin access, forms and top-level navigation.
 for(const el of [...doc.querySelectorAll('script,iframe,object,embed,form,link,base,video,audio')])el.remove();
 for(const el of doc.querySelectorAll('*')){
  for(const attr of [...el.attributes])if(/^on/i.test(attr.name))el.removeAttribute(attr.name);
 }
 doc.getElementById('backToArchive')?.remove();
 doc.getElementById('loadRemoteImages')?.remove();
 // Remote images and CSS image URLs are blocked by CSP when the user has
 // disabled auto-loading; adding src accidentally cannot bypass that choice.
 const imagePolicy=autoImages?'img-src data: blob: https: http:':'img-src data: blob:';
 const csp="default-src 'none'; "+imagePolicy+"; style-src 'unsafe-inline'; script-src 'none'; connect-src 'none'; media-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";
 let policy=doc.querySelector('meta[http-equiv="Content-Security-Policy"]');
 if(!policy){policy=doc.createElement('meta');policy.setAttribute('http-equiv','Content-Security-Policy');doc.head.prepend(policy);}
 policy.setAttribute('content',csp);
 let referrer=doc.querySelector('meta[name="referrer"]');
 if(!referrer){referrer=doc.createElement('meta');referrer.name='referrer';doc.head.append(referrer);}
 referrer.content='no-referrer';
 doc.documentElement.setAttribute('data-theme',theme==='dark'?'dark':'light');
 const urls=[],mapped=new Map();
 async function attachment(href){
  const isOriginal=href==='originals/email-'+record.id+'.eml'&&
   stored.original?.href===href;
  if(!isOriginal&&!g.ArchiveReindex.safeAttachmentHref(href))return null;
  const path=record.folder+'/'+decodeURIComponent(href);
  if(mapped.has(path))return mapped.get(path);
  try{
   const f=await (await C.fileHandle(root,path)).getFile();
   const file=new Blob([f],{type:mediaType(f.name,f.type)});
   const url=URL.createObjectURL(file);urls.push(url);mapped.set(path,url);
   return url;
  }catch{return null;}
 }
 let hasRemoteImages=false;
 for(const img of doc.querySelectorAll('img')){
  const remote=(img.getAttribute('data-remote-src')||'').trim();
  const src=(img.getAttribute('src')||'').trim();
  if(remote){
   hasRemoteImages=true;
   img.removeAttribute('data-remote-src');
   if(autoImages&&/^https?:\/\//i.test(remote))img.setAttribute('src',remote);
   else img.removeAttribute('src');
  }else if(src.startsWith('attachments/')){
   const url=await attachment(src);if(url)img.setAttribute('src',url);else img.removeAttribute('src');
  }else if(/^https?:\/\//i.test(src)){
   // Only explicit sanitized data-remote-src images may contact the network.
   img.removeAttribute('src');
  }else if(src&&!/^data:image\/(?:png|jpeg|gif|webp|bmp);base64,/i.test(src)){
   img.removeAttribute('src');
  }
 }
 for(const anchor of doc.querySelectorAll('a[href]')){
  const href=(anchor.getAttribute('href')||'').trim();
  if(href.startsWith('attachments/')||href==='originals/email-'+record.id+'.eml'){
   const url=await attachment(href);
   if(url){anchor.setAttribute('href',url);anchor.setAttribute('download',anchor.getAttribute('download')||'attachment');anchor.removeAttribute('target');}
   else anchor.removeAttribute('href');
  }else if(!/^(https?:\/\/|mailto:|tel:)/i.test(href)){
   anchor.removeAttribute('href');
  }else{
   anchor.setAttribute('target','_blank');
   anchor.setAttribute('rel','noopener noreferrer');
  }
 }
 const html='<!doctype html>\n'+doc.documentElement.outerHTML;
 const url=URL.createObjectURL(new Blob([html],{type:'text/html;charset=utf-8'}));
 urls.push(url);
 return {url,hasRemoteImages,dispose(){for(const u of urls)URL.revokeObjectURL(u);}};
}
g.ArchiveDataReader={allowedMessage,open};
})(globalThis);
