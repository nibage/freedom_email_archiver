/* Offline mail archive, format 1. No network, no browser-profile storage. */
(function(g){'use strict';
const VERSION=1, LIMIT=64*1024*1024, CHUNK=1024*1024;
const te=new TextEncoder(), ascii=new TextDecoder('windows-1252');
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const norm=s=>String(s??'').normalize('NFC').replace(/\r\n?/g,'\n');
const fold=s=>norm(s).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase('en');
async function hash(x){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',typeof x==='string'?te.encode(x):x)),b=>b.toString(16).padStart(2,'0')).join('');}
function json(x){return JSON.stringify(x).replace(/</g,'\\u003c').replace(/\u2028/g,'\\u2028').replace(/\u2029/g,'\\u2029');}
function wrap(x){return 'MailArchive.receive('+json(x)+');\n';}
function unwrap(x){const m=/^MailArchive\.receive\(([\s\S]*)\);\s*$/.exec(x);if(!m)throw Error('FORMAT');return JSON.parse(m[1]);}
function safeName(s){let v=norm(s||'attachment').replace(/[\x00-\x1f\x7f<>:"/\\|?*\u202a-\u202e\u2066-\u2069]/g,'_').replace(/[. ]+$/g,'');v=Array.from(v).slice(0,100).join('');if(!v||/^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(v))v='file_'+v;return v;}
function accountName(s){if(!/^[a-z0-9][a-z0-9_-]{0,39}$/.test(s)||/^(assets|con|prn|aux|nul|com[0-9]|lpt[0-9])$/.test(s))throw Error('ACCOUNT');return s;}
async function directory(root,p,create=false){let d=root;for(const x of p.split('/').filter(Boolean)){if(x==='.'||x==='..'||/[\\:\x00-\x1f]/.test(x))throw Error('PATH');d=await d.getDirectoryHandle(x,{create});}return d;}
async function fileHandle(root,p,create=false){const i=p.lastIndexOf('/');const d=await directory(root,i<0?'':p.slice(0,i),create);const n=p.slice(i+1);if(!n||/[\\:\x00-\x1f]/.test(n)||n==='..')throw Error('PATH');return d.getFileHandle(n,{create});}
async function write(root,p,value){const f=await fileHandle(root,p,true);const w=await f.createWritable();try{await w.write(value);await w.close();}catch(e){try{await w.abort();}catch{}throw e;}}
async function read(root,p){return (await (await fileHandle(root,p)).getFile()).text();}
async function exists(root,p){try{await fileHandle(root,p);return true;}catch(e){if(e.name==='NotFoundError')return false;throw e;}}
const empty=()=>({kind:'manifest',format:VERSION,generation:0,accounts:[],segments:[],total:0,created:new Date().toISOString()});
function checkManifest(m){if(m.kind!=='manifest'||m.format!==VERSION||!Array.isArray(m.segments)||!Array.isArray(m.accounts))throw Error('FORMAT');return m;}
const MANIFEST='assets/catalog/archive.js',PREVIOUS='assets/catalog/archive.previous.js';
async function manifest(root){
 for(const [current,backup] of [[MANIFEST,PREVIOUS],['archive.js','archive.previous.js']]){
  if(!await exists(root,current)&&!await exists(root,backup))continue;
  try{return checkManifest(unwrap(await read(root,current)));}
  catch{try{return checkManifest(unwrap(await read(root,backup)));}catch{throw Error('CATALOG');}}
 }
 return empty();
}
// Read bounded chunks. A large/invalid line cannot grow the scanner's memory indefinitely.
async function* lines(file,signal){let pending=new Uint8Array(0),offset=0;for(let p=0;p<file.size;p+=CHUNK){if(signal?.aborted)return;const buf=new Uint8Array(await file.slice(p,p+CHUNK).arrayBuffer());let start=0;for(let i=buf.indexOf(10);i>=0;i=buf.indexOf(10,start)){let line=buf.subarray(start,i+1);if(pending.length){const n=new Uint8Array(pending.length+line.length);n.set(pending);n.set(line,pending.length);line=n;pending=new Uint8Array(0);}yield {bytes:line,offset};offset+=line.length;start=i+1;}if(start<buf.length){const rest=buf.subarray(start);const n=new Uint8Array(pending.length+rest.length);n.set(pending);n.set(rest,pending.length);pending=n;if(pending.length>LIMIT)throw Error('LINE_TOO_LARGE');}}if(pending.length)yield {bytes:pending,offset};}
const envelope=/^From \S+ (?:Mon|Tue|Wed|Thu|Fri|Sat|Sun) (?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) +\d{1,2} \d{2}:\d{2}(?::\d{2})?(?: [A-Z0-9+:-]+)? \d{4}(?: .*)?\r?\n?$/;
function isEnvelope(b){return b.length<1024&&b[0]===70&&envelope.test(ascii.decode(b));}
function headerInfo(rows){let fields=0,known=0,last=false,txt='';for(const r of rows){const s=ascii.decode(r.bytes).replace(/\r?\n$/,'');if(!s)return fields>=2&&known>=1?txt:null;if(/^[ \t]/.test(s)){if(!last)return null;}else{const m=/^([!-9;-~]+):/.exec(s);if(!m)return null;fields++;if(/^(from|to|date|subject|message-id|mime-version|content-type)$/i.test(m[1]))known++;last=true;}txt+=s+'\n';}return fields>=2&&known>=1?txt:null;}
async function* mbox(file,{signal,maxMessageBytes=LIMIT,onBytes=()=>{}}={}){
 const it=lines(file,signal)[Symbol.asyncIterator]();let queued=[],parts=[],size=0,start=0,seen=false,oversize=false,protectedUntil=0;
 const add=r=>{size+=r.bytes.length;if(size>maxMessageBytes){parts=[];oversize=true;}else if(!oversize)parts.push(r.bytes);};
 const take=async()=>queued.length?{value:queued.shift(),done:false}:it.next();
 const finish=()=>{if(oversize)return {error:'MESSAGE_TOO_LARGE',offset:start,end:start+size};const out=new Uint8Array(size);let p=0;for(const b of parts){out.set(b,p);p+=b.length;}return {bytes:out,offset:start,end:start+size};};
 while(true){if(signal?.aborted)break;const n=await take();if(n.done)break;const r=n.value;onBytes(r.offset+r.bytes.length);
  if(r.offset>=protectedUntil&&isEnvelope(r.bytes)){
   const head=[];let bytes=0;for(let i=0;i<65536;i++){const h=await take();if(h.done)break;head.push(h.value);bytes+=h.value.bytes.length;if(bytes>2*1024*1024||/^\r?\n$/.test(ascii.decode(h.value.bytes)))break;}
   const hi=headerInfo(head);
   if(hi!==null){if(seen&&size)yield finish();seen=true;parts=[];size=0;oversize=false;start=r.offset+r.bytes.length;protectedUntil=0;
    // mboxcl/cl2: honor a Content-Length only if its end points at a real separator or EOF.
    const cl=/^content-length:\s*(\d+)\s*$/im.exec(hi);if(cl){const end=head[head.length-1].offset+head[head.length-1].bytes.length+Number(cl[1]);if(end<=file.size){const probe=ascii.decode(new Uint8Array(await file.slice(end,end+1024).arrayBuffer())).replace(/^\r?\n/,'');if(end===file.size||envelope.test(probe.split('\n')[0]+'\n'))protectedUntil=end;}}
    for(const h of head)add(h);continue;
   }queued.unshift(...head);
  }
  if(!seen){if(!parts.length)start=r.offset;seen=true;}add(r);
 }
 if(!signal?.aborted&&size)yield finish();
}
function unescapeMbox(bytes){const positions=[];let start=true;for(let i=0;i<bytes.length;i++){if(start&&bytes[i]===62){let j=i;while(bytes[j]===62)j++;if(bytes[j]===70&&bytes[j+1]===114&&bytes[j+2]===111&&bytes[j+3]===109&&bytes[j+4]===32)positions.push(i);}start=bytes[i]===10;}if(!positions.length)return bytes;const out=new Uint8Array(bytes.length-positions.length);let from=0,to=0;for(const i of positions){out.set(bytes.subarray(from,i),to);to+=i-from;from=i+1;}out.set(bytes.subarray(from),to);return out;}
function addresses(a){if(!a)return '';if(!Array.isArray(a))a=[a];return a.map(x=>x.group?addresses(x.group):[x.name,x.address?'<' +x.address+'>':''].filter(Boolean).join(' ')).join(', ');}
function invalidCalendarDate(raw){const months=['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];let m=/(?:^|,\s*)(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{2,4})\b/i.exec(raw),y,month,day;if(m){day=+m[1];month=months.indexOf(m[2].toLowerCase());y=+m[3];if(y<100)y+=y<50?2000:1900;}else{m=/^(\d{4})-(\d{2})-(\d{2})(?:T|\s|$)/.exec(raw);if(!m)return false;y=+m[1];month=+m[2]-1;day=+m[3];}return month<0||month>11||day<1||day>new Date(Date.UTC(y,month+1,0)).getUTCDate();}
function dateInfo(m){const raw=m.headers.find(h=>h.key==='date')?.value||'';const d=new Date(m.date||'');if(!raw||invalidCalendarDate(raw)||!Number.isFinite(+d)||d.getUTCFullYear()<1601||d.getUTCFullYear()>9999)return {date:null,day:'',folder:'unknown-date',raw};return {date:d.toISOString(),day:d.toISOString().slice(0,10),folder:d.toISOString().slice(0,4)+'/'+d.toISOString().slice(0,7),raw};}
function labels(m){const out=[];for(const h of m.headers.filter(h=>h.key==='x-gmail-labels')){const v=g.decodeWords(h.value);let token='',quote=false;for(const c of v){if(c==='"'){quote=!quote;continue;}if(c===','&&!quote){if(token.trim())out.push(token.trim());token='';}else token+=c;}if(token.trim())out.push(token.trim());}return [...new Set(out)].sort();}
const {cleanHTML,documentHTML}=g.MailRenderer;
function extensionSafe(name,type){return /\.(?:html?|xhtml|svg|xml|mhtml?|js|mjs|cjs|hta|exe|com|scr|bat|cmd|ps1|vbs|vbe|wsf|url|lnk|desktop|sh|reg|msi)$/i.test(name)||/^(text\/html|image\/svg\+xml|application\/(?:xhtml\+xml|javascript|xml))$/i.test(type);}
async function prepare(bytes,account,depth=0){
 const decodedBytes=depth===0?g.ArchiveEML.fromMbox(bytes).bytes:bytes;
  const m=await PostalMime.parse(decodedBytes,{forceRfc822Attachments:true,maxNestingDepth:64,maxHeadersSize:2*1024*1024});
 if(!m.headers.length||!m.headers.some(h=>/^(from|date|subject|to|message-id|content-type)$/.test(h.key)))throw Error('MALFORMED');
 const di=dateInfo(m),atts=[];for(const a of m.attachments){atts.push({source:a,hash:await hash(a.content)});}
 const idHeaders={from:addresses(m.from),to:addresses(m.to),cc:addresses(m.cc),bcc:addresses(m.bcc),subject:norm(m.subject),date:di.date||norm(di.raw),replyTo:addresses(m.replyTo),inReplyTo:m.inReplyTo||'',references:m.references||''};
 // Export-only headers and labels are excluded. Transfer encodings and MIME boundaries are decoded.
 const fingerprint=await hash(json({headers:idHeaders,text:norm(m.text||'').replace(/\n+$/,''),html:norm(m.html||'').replace(/\n+$/,''),attachments:atts.map(a=>({hash:a.hash,name:norm(a.source.filename||''),type:a.source.mimeType,cid:a.source.contentId||''})).sort((a,b)=>json(a).localeCompare(json(b)))}));
 const messageId=(m.messageId||'').trim();const id=await hash('mail-v1\n'+messageId+'\n'+fingerprint);
 const folder=account+'/'+di.folder, filepath=folder+'/email-'+id+'.html';
 const cids={},files=[],attachmentMeta=[];
 for(let i=0;i<atts.length;i++){
  const {source:a,hash:ah}=atts[i];let name=safeName(a.filename||('attachment-'+(i+1)+(a.mimeType==='message/rfc822'?'.eml':'')));
  const quarantine=extensionSafe(name,a.mimeType);const stored=ah+(/(\.[a-z0-9]{1,12})$/i.exec(name)?.[1].toLowerCase()||'.bin')+(quarantine?'.download':'');const href='attachments/'+encodeURIComponent(stored);files.push({path:folder+'/attachments/'+stored,bytes:a.content});
  const am={name,href,size:a.content.byteLength,type:a.mimeType,quarantined:quarantine,sha256:ah,contentId:a.contentId||'',disposition:a.disposition||'',originalName:a.filename||''};
  const cid=(a.contentId||'').replace(/^<|>$/g,'');if(cid&&/^image\/(png|jpeg|gif|webp|bmp)$/i.test(a.mimeType)&&!quarantine)cids[cid]=href;
  if(a.mimeType==='message/rfc822'&&depth<3){try{const nested=await prepare(new Uint8Array(a.content),account,depth+1);const preview='v-'+ah+'.html';am.preview='attachments/'+preview;
    // Flatten embedded-message assets into the same attachment folder. No deep Windows paths.
    for(const f of nested.files){const suffix=f.path.slice(nested.folder.length+1);files.push({path:folder+'/'+suffix,bytes:f.bytes});}
    const nestedBody=nested.body.replace(/src="attachments\//g,'src="');
    const nestedAtts=nested.attachments.map(a=>({...a,href:a.href.replace(/^attachments\//,''),preview:a.preview?.replace(/^attachments\//,'')}));
    files.push({path:folder+'/attachments/'+preview,bytes:documentHTML(nested.meta,nestedBody,nestedAtts,'../'.repeat(folder.split('/').length+1))});
   }catch{/* Raw embedded message stays as an ordinary attachment. */}}
  attachmentMeta.push(am);
 }
 const clean=cleanHTML(m.html||'',cids);const body=m.html?clean.html:'<pre>'+esc(m.text||'')+'</pre>';
 const mime={
   note:'Decoded MIME metadata, not a byte-exact RFC 5322 source or verified signature',
   headers:m.headers.map(h=>({name:h.key,value:String(h.value??'')})),
   topLevelType:String(m.headers.find(h=>h.key==='content-type')?.value||'text/plain'),
   mimeVersion:String(m.headers.find(h=>h.key==='mime-version')?.value||''),
   transferEncoding:String(m.headers.find(h=>h.key==='content-transfer-encoding')?.value||''),
   hasText:!!m.text,hasHtml:!!m.html,
   signatureHeaders:m.headers.filter(h=>/^(dkim-signature|authentication-results|arc-seal|arc-message-signature|arc-authentication-results)$/.test(h.key)).map(h=>({name:h.key,value:String(h.value??'')})),
   hasSignedMime:/multipart\/signed|application\/(?:pkcs7-mime|x-pkcs7-mime|pgp-signature)/i.test(m.headers.find(h=>h.key==='content-type')?.value||'')
  };
  const meta={id,account,path:filepath,folder,fingerprint,messageId,subject:m.subject||'',from:idHeaders.from,to:idHeaders.to,cc:idHeaders.cc,bcc:idHeaders.bcc,date:di.date,day:di.day,rawDate:di.raw,labels:labels(m),attachments:attachmentMeta,bytes:bytes.length,mime};
 return {meta,files,body,attachments:attachmentMeta,folder,selectedReasons:depth===0?g.ArchiveEML.classify(m,meta.labels):[],text:norm([m.text||'',clean.text].join('\n'))};
}
class Importer{
 constructor(root,{onProgress=()=>{},signal=null,batchSize=50,refreshExisting=false,retainSelectedEml=true}={}){this.refreshExisting=refreshExisting;this.retainSelectedEml=retainSelectedEml;this.root=root;this.onProgress=onProgress;this.signal=signal;this.batchSize=batchSize;this.records=new Map();this.pending=[];this.search=[];this.searchBytes=0;this.stats={read:0,new:0,duplicates:0,refreshed:0,emlSaved:0,emlReused:0,errors:0,bytes:0,totalBytes:0,committed:0};this.issues=[];}
 async open(){this.m=await manifest(this.root);for(const seg of this.m.segments){const data=unwrap(await read(this.root,seg.meta));if(data.kind!=='metadata')throw Error('CATALOG');for(const r of data.records)this.records.set(r.account+'/'+r.id,r);}return this;}
 async lock(){const f=await fileHandle(this.root,'archive.lock',true);this.lockWriter=await f.createWritable({mode:'exclusive'});}
 async commit(){if(!this.pending.length)return;const token=crypto.randomUUID();const account=this.pending[0].account;const base=account+'/catalog/'+token;const meta=base+'.js',search=this.search.length?base+'-text.js':null;
  if(search)await write(this.root,search,wrap({kind:'search',records:this.search}));
  await write(this.root,meta,wrap({kind:'metadata',records:this.pending}));
  const next={...this.m,generation:this.m.generation+1,total:this.records.size,updated:new Date().toISOString(),accounts:[...new Set([...this.m.accounts,account])].sort(),segments:[...this.m.segments,{meta,search,count:this.pending.length}]};
  await write(this.root,PREVIOUS,wrap(this.m));await write(this.root,MANIFEST,wrap(next));this.m=next;this.stats.committed+=this.pending.length;this.pending=[];this.search=[];this.searchBytes=0;this.onProgress({...this.stats});
 }
 async run(files,account){accountName(account);await this.lock();try{await this.open();this.stats.totalBytes=files.reduce((s,f)=>s+f.size,0);let base=0;
  for(const file of files){if(this.signal?.aborted)break;try{for await(const raw of mbox(file,{signal:this.signal,onBytes:n=>{this.stats.bytes=base+n;}})){
   if(this.signal?.aborted)break;this.stats.read++;let p;try{if(raw.error)throw Error(raw.error);p=await prepare(raw.bytes,account);}catch(e){this.stats.errors++;this.issues.push({file:file.name,offset:raw.offset,end:raw.end,code:['MESSAGE_TOO_LARGE','MALFORMED'].includes(e.message)?e.message:'MIME_ERROR'});this.onProgress({...this.stats});continue;}
   const key=account+'/'+p.meta.id,old=this.records.get(key);
   let original=old?.original||null,originalChanged=false;
   // Save and checksum-verify the EML before publishing a reference in HTML/catalog.
   // Existing verified originals are reused on overlapping imports.
   const wanted=this.retainSelectedEml?(p.selectedReasons.length?p.selectedReasons:original?.reasons||[]):[];
   if(wanted.length){
    const alreadyValid=!!original&&await g.ArchiveEML.verify(this.root,old||p.meta,original);
    const retained=await g.ArchiveEML.preserve(this.root,old||p.meta,raw.bytes,wanted,original);
    originalChanged=json(retained)!==json(original);original=retained;
    if(alreadyValid)this.stats.emlReused++;else this.stats.emlSaved++;
   }
   if(old){
    this.stats.duplicates++;
    const merged=[...new Set([...old.labels,...p.meta.labels])].sort();
    if(json(merged)!==json(old.labels)||this.refreshExisting||originalChanged){
     const updated={...old,labels:merged,mime:p.meta.mime||old.mime,...(original?{original}:{})};
     // Preserve CID attachment paths belonging to the existing archive.
     const links=new Map();for(const a of p.attachments){const digest=decodeURIComponent(a.href).split('/').pop().slice(0,64);const before=old.attachments.find(b=>b.name===a.name&&decodeURIComponent(b.href).split('/').pop().slice(0,64)===digest);if(before)links.set(a.href,before.href);}
     const template=document.createElement('template');template.innerHTML=p.body;
     for(const img of template.content.querySelectorAll('img[src]')){const mapped=links.get(img.getAttribute('src'));if(mapped)img.setAttribute('src',mapped);}
     await write(this.root,old.path,documentHTML(updated,template.innerHTML,old.attachments,'../'.repeat(old.folder.split('/').length)));
     this.records.set(key,updated);this.pending.push(updated);if(this.refreshExisting)this.stats.refreshed++;
    }
   }else{
    if(original)p.meta.original=original;
    for(const f of p.files)await write(this.root,f.path,f.bytes);
    await write(this.root,p.meta.path,documentHTML(p.meta,p.body,p.attachments,'../'.repeat(p.folder.split('/').length)));
    this.records.set(key,p.meta);this.pending.push(p.meta);this.search.push({key,text:p.text});this.searchBytes+=p.text.length*2;this.stats.new++;
   }
   if(this.pending.length>=this.batchSize||this.searchBytes>=4*1024*1024)await this.commit();this.onProgress({...this.stats});await new Promise(r=>setTimeout(r,0));
  }}catch(e){if(e.message==='LINE_TOO_LARGE'){this.stats.errors++;this.issues.push({file:file.name,code:'LINE_TOO_LARGE'});}else throw e;}base+=file.size;
  }
  await this.commit();const report={format:1,finished:new Date().toISOString(),interrupted:!!this.signal?.aborted,stats:this.stats,issues:this.issues};await write(this.root,account+'/catalog/import-'+crypto.randomUUID()+'.json',json(report));return report;
 }finally{if(this.lockWriter){await this.lockWriter.close();this.lockWriter=null;}}}
}
g.ArchiveCore={VERSION,LIMIT,MANIFEST,PREVIOUS,esc,fold,hash,fileHandle,json,wrap,unwrap,safeName,accountName,write,read,exists,manifest,empty,mbox,prepare,Importer,cleanHTML,documentHTML};
})(globalThis);

