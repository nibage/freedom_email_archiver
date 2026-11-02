/* Optional selected-category RFC 5322 / EML copies. No network access. */
(function(g){'use strict';
const sig=/^application\/(?:x-)?pkcs7-signature\b|^application\/pgp-signature\b/i;
const smime=/^application\/(?:x-)?pkcs7-mime\b/i;
const opaqueSigned=/smime-type\s*=\s*"?signed-data\b/i;
const pgpSigned=/-----BEGIN PGP SIGNED MESSAGE-----/;
const pgpEncrypted=/-----BEGIN PGP MESSAGE-----/;
const isMime=(type,pattern)=>pattern.test(String(type||'').trim());
function classify(mail,labels=[]){
 const types=[...(mail.headers||[]).filter(h=>h.key==='content-type').map(h=>String(h.value||'')),...(mail.attachments||[]).map(a=>String(a.mimeType||''))];
 const kinds=[];
 if(types.some(t=>/^\s*multipart\/signed\b/i.test(t)||isMime(t,sig)||(isMime(t,smime)&&opaqueSigned.test(t)))||pgpSigned.test(String(mail.text||'')))kinds.push('signed');
 if(types.some(t=>/^\s*multipart\/encrypted\b|^\s*application\/pgp-encrypted\b/i.test(t)||(isMime(t,smime)&&!opaqueSigned.test(t)))||pgpEncrypted.test(String(mail.text||'')))kinds.push('encrypted');
 const set=new Set(labels.map(l=>String(l).replace(/^\\/,'').trim().toLowerCase()));
 if(set.has('important'))kinds.push('gmail-important');
 if(set.has('starred'))kinds.push('gmail-starred');
 return kinds;
}
// Independent import options; a message only needs one enabled reason.
function selectReasons(reasons=[],policy={}){
 const enabled={
  signed:policy.signed!==false,
  encrypted:policy.encrypted!==false,
  'gmail-starred':policy.starred===true,
  'gmail-important':policy.important===true
 };
 return [...new Set(reasons)].filter(reason=>enabled[reason]===true);
}
// MBOXrd escapes leading "From " lines within the message body only.
// Extracted messages exclude the MBOX envelope, and preserve every other source byte,
// including CRLF/LF, MIME boundaries, transfer encodings and original header folding.
function fromMbox(bytes){
 const b=bytes instanceof Uint8Array?bytes:new Uint8Array(bytes);
 let bodyStart=b.length,from=0;
 for(let i=0;i<b.length;i++)if(b[i]===10){
  const end=i+1;
  if(end-from===1||(end-from===2&&b[from]===13)){bodyStart=end;break;}
  from=end;
 }
 const removed=[];
 for(let pos=bodyStart;pos<b.length;){
  let j=pos;
  if(b[j]===62){
   while(b[j]===62)j++;
   if(b[j]===70&&b[j+1]===114&&b[j+2]===111&&b[j+3]===109&&b[j+4]===32)removed.push(pos);
  }
  const newline=b.indexOf(10,pos);if(newline<0)break;
  pos=newline+1;
 }
 if(!removed.length)return {bytes:b,unescaped:0};
 const result=new Uint8Array(b.length-removed.length);
 let start=0,out=0;
 for(const at of removed){result.set(b.subarray(start,at),out);out+=at-start;start=at+1;}
 result.set(b.subarray(start),out);
 return {bytes:result,unescaped:removed.length};
}
function safeOriginal(original,id){
 return !!original&&original.href==='originals/email-'+id+'.eml'&&
 /^[a-f0-9]{64}$/.test(String(original.sha256||''))&&
 Number.isSafeInteger(original.size)&&original.size>=0;
}
async function verify(root,meta,original){
 if(!safeOriginal(original,meta.id))return false;
 try{
  const handle=await g.ArchiveCore.fileHandle(root,meta.folder+'/'+original.href);
  const file=await handle.getFile();
  if(file.size!==original.size)return false;
  const sum=await g.ArchiveCore.hash(new Uint8Array(await file.arrayBuffer()));
  return sum===original.sha256;
 }catch{return false;}
}
async function preserve(root,meta,mboxBytes,reasons,previous){
 if(!reasons.length)return previous||null;
 if(previous&&await verify(root,meta,previous)){
  return {...previous,reasons:[...new Set([...(previous.reasons||[]),...reasons])]};
 }
 const {bytes,unescaped}=fromMbox(mboxBytes);
 const sha256=await g.ArchiveCore.hash(bytes);
 const stored={href:'originals/email-'+meta.id+'.eml',sha256,size:bytes.byteLength,
  source:'mbox-extracted-rfc5322',mboxrdUnescapedLines:unescaped,
  reasons:[...reasons],signatureVerified:false,verifiedOnWrite:true};
 await g.ArchiveCore.write(root,meta.folder+'/'+stored.href,bytes);
 if(!await verify(root,meta,stored))throw Error('EML_VERIFY_FAILED');
 return stored;
}
g.ArchiveEML={classify,selectReasons,fromMbox,safeOriginal,verify,preserve};
})(globalThis);
