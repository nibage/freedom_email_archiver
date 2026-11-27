const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');const root=path.resolve(__dirname,'..');const allowed=new Set(['.git','.github','.gitignore','README.md','GUIDE.html','LICENSE','SECURITY.md','THIRD_PARTY_NOTICES.md','index.html','assets','archived_emails','docs','scripts','tests']);for(const name of fs.readdirSync(root))assert(allowed.has(name),'Unexpected root content: '+name);
assert.deepEqual(fs.readdirSync(path.join(root,'archived_emails')).sort(),['catalog','example'],
 'Only the fictional example account and demo catalog may be committed under archived_emails/.');
assert(!fs.existsSync(path.join(root,'example')),'Fictional account must not remain outside archived_emails/.');
assert(!fs.existsSync(path.join(root,'assets/catalog')),'Old demonstration catalog should be moved into archived_emails/.');
function payload(p){const text=fs.readFileSync(path.join(root,p),'utf8');const m=/^MailArchive\.receive\(([\s\S]*)\);\s*$/.exec(text);assert(m,'Invalid catalog wrapper');return JSON.parse(m[1]);}
const manifest=payload('archived_emails/catalog/archive.js');assert.deepEqual(manifest.accounts,['example']);assert.equal(manifest.total,4);const ids=new Set();for(const seg of manifest.segments){assert(seg.meta.startsWith('example/catalog/'));assert(fs.existsSync(path.join(root,'archived_emails',seg.search)),'Demo full-text index missing');for(const r of payload('archived_emails/'+seg.meta).records){assert.equal(r.account,'example');assert(r.path.startsWith('example/'));for(const value of [r.from,r.to,r.cc,r.bcc,r.messageId])for(const m of value.matchAll(/[A-Z0-9._%+-]+@([A-Z0-9.-]+)/gi))assert(m[1].endsWith('.invalid'),'Non-fictional email domain');ids.add(r.id);}}assert.equal(ids.size,4);
for(const segment of manifest.segments){
 for(const record of payload('archived_emails/'+segment.meta).records){
  const savedPath=path.join(root,'archived_emails',record.path);
  assert(fs.existsSync(savedPath),'Fictional saved HTML message missing: '+record.path);
  const page=fs.readFileSync(savedPath,'utf8');
  const back='../'.repeat(record.folder.split('/').length+1)+'index.html';
  assert(page.includes('href="'+back+'"'),'Saved standalone email Back link must reach the app root');
  for(const attachment of record.attachments){
   assert(/^attachments\/[a-z0-9.-]+$/.test(attachment.href),'Unsafe example attachment reference');
   assert(fs.existsSync(path.join(root,'archived_emails',record.folder,attachment.href)),
    'Example attachment missing after move');
  }
 }
}
const png=path.join(root,'archived_emails/example/2025/2025-01/attachments/4a22307cc53bea7d844d12f3cc8923dbffd4597cc011806cc57c9b59749ab4e1.png');
const bytes=fs.readFileSync(png);
const gitBlob=require('node:crypto').createHash('sha1').update('blob '+bytes.length+'\0').update(bytes).digest('hex');
assert.equal(gitBlob,'47204423954e9cf7879adcb2ae1e1164e7eacf3f','Original binary demo attachment must be preserved exactly');
let files=0;function walk(dir){for(const e of fs.readdirSync(dir,{withFileTypes:true})){if(e.name==='.git')continue;const p=path.join(dir,e.name);if(e.isDirectory()){walk(p);continue;}files++;if(/\.(?:js|cjs|html|md|mbox|json|txt)$/i.test(e.name)){const s=fs.readFileSync(p,'utf8');const rel=path.relative(root,p).split(path.sep).join('/');const scrubbed=(rel==='assets/postal-mime.js')?s.replace(/C:\\+Users\\+me\b/g,'VENDOR_DOCUMENTATION_PLACEHOLDER'):s;assert(!/[A-Z]:\\+Users\\+[A-Z0-9_-]+/i.test(scrubbed),'Private Windows path');assert(!/\/(?:home|Users)\/[A-Z0-9_-]+\//.test(s),'Private home path');}}}walk(root);console.log('Public package check passed: '+files+' files; four fictional messages; example account only.');
