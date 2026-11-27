/* Account-level sync regression, using synthetic files and no HTML reads. */
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../assets/account-sync.js'),'utf8');
const current='catalog/archive.js',previous='catalog/archive.previous.js';
const wrap=x=>'MailArchive.receive('+JSON.stringify(x)+');';
const unwrap=x=>JSON.parse(x.slice('MailArchive.receive('.length,-2));
const id=n=>n.repeat(64);
const record=(account,n)=>({id:id(n),account,folder:account+'/2025/2025-01',path:account+'/2025/2025-01/email-'+id(n)+'.html',subject:'Fictional mail',from:'sender@example.invalid',labels:[],attachments:[]});
const seg=(account,name,count=1,search=true)=>({meta:account+'/catalog/'+name+'.js',search:search?account+'/catalog/'+name+'-text.js':null,count});
const manifest=(accounts,segments,total,generation=1)=>({kind:'manifest',format:1,generation,accounts,segments,total});
const pointer=(account,segments,total)=>({kind:'account-index',format:1,account,segments,total});
function fixture(){
 const values=new Map(),reads=[],writes=[],walks=[],locks={open:0,close:0,blocked:false},state={failEnumeration:false};
 function missing(){const e=Error('Not found');e.name='NotFoundError';return e;}
 function dir(prefix=''){
  return {kind:'directory',async *entries(){
   walks.push(prefix);
   if(prefix===''&&state.failEnumeration)throw Error('Permission lost');
   const children=new Map();
   for(const p of values.keys()){
    if(!p.startsWith(prefix))continue;
    const tail=p.slice(prefix.length),[first,...rest]=tail.split('/');
    if(!first)continue;
    children.set(first,rest.length?dir(prefix+first+'/'):{kind:'file',getFile(){throw Error('HTML must not be opened');}});
   }
   for(const item of children)yield item;
  },async getDirectoryHandle(name){
   const next=prefix+name+'/';
   if(![...values.keys()].some(p=>p.startsWith(next)))throw missing();
   return dir(next);
  }};
 }
 const root=dir(),C={VERSION:1,
  accountName(a){if(!/^[a-z0-9][a-z0-9_-]{0,39}$/.test(a)||a==='catalog')throw Error('ACCOUNT');return a;},
  async manifest(){return unwrap(values.get(current));},
  async catalogPaths(){return {current,previous};},json:JSON.stringify,wrap,unwrap,
  async exists(root,p){return values.has(p);},
  async read(root,p){reads.push(p);assert(!p.endsWith('.html'),'No message body may be read');if(!values.has(p))throw missing();return values.get(p);},
  async write(root,p,v){writes.push(p);assert(!p.endsWith('.html'));values.set(p,v);},
  Importer:class{async lock(){if(locks.blocked)throw Error('LOCKED');locks.open++;this.lockWriter={close:async()=>{locks.close++;}};}}
 };
 const context={ArchiveCore:C};vm.runInNewContext(source,context);
 function add(s,records){values.set(s.meta,wrap({kind:'metadata',records}));if(s.search)values.set(s.search,wrap({kind:'search',records:records.map(r=>({key:r.account+'/'+r.id,text:'fictional'}))}));for(const r of records)values.set(r.path,'Fictional HTML');}
 function setManifest(m){values.set(current,wrap(m));values.set(previous,wrap(m));}
 function savePointer(a,ss,total){values.set(a+'/catalog/account-index.json',JSON.stringify(pointer(a,ss,total)));}
 function removeAccount(a){const backup=new Map();for(const [p,v] of values)if(p.startsWith(a+'/')){backup.set(p,v);values.delete(p);}return backup;}
 function restore(backup){for(const [p,v] of backup)values.set(p,v);}
 return {values,reads,writes,walks,locks,state,add,setManifest,savePointer,removeAccount,restore,sync:opts=>context.ArchiveAccountSync.sync(root,opts),get:()=>unwrap(values.get(current)),backup:()=>unwrap(values.get(previous))};
}
async function main(){
 const x=fixture(),p=seg('personal','p'),pUpdate=seg('personal','p-update',1,false),w=seg('work','w');
 x.add(p,[record('personal','a')]);x.add(pUpdate,[{...record('personal','a'),labels:['Important']}]);x.add(w,[record('work','b')]);
 x.setManifest(manifest(['personal','work'],[p,w,pUpdate],2));
 let result=await x.sync({write:true});
 assert.equal(x.get().total,2);assert.equal(x.writes.includes(current),false,'One-time pointer migration does not rewrite global manifest');
 assert.deepEqual(x.writes.sort(),['personal/catalog/account-index.json','work/catalog/account-index.json']);
 assert.equal(x.locks.open,x.locks.close);
 x.writes.length=0;x.reads.length=0;x.walks.length=0;
 result=await x.sync({write:true});assert.equal(x.writes.length,0);assert.equal(x.locks.open,1);
 assert(!x.reads.includes(p.meta),'No-op startup must not reread metadata to count existing accounts');
 assert.deepEqual(x.walks,[''],'No-op startup walks only account directories');
 const oldWork=x.removeAccount('work'),before=x.get(),keep=x.values.get(p.meta),keepUpdate=x.values.get(pUpdate.meta);
 result=await x.sync({write:false});assert.equal(result.manifest.total,1);assert.equal(result.persisted,false);assert.equal(x.writes.length,0);assert.deepEqual(x.get(),before);
 result=await x.sync({write:true});assert.equal(result.persisted,true);assert.deepEqual(x.get().accounts,['personal']);assert.equal(x.get().total,1);
 assert.deepEqual(x.get().segments,[p,pUpdate]);assert.deepEqual(x.backup(),x.get());assert.equal(x.values.get(p.meta),keep);assert.equal(x.values.get(pUpdate.meta),keepUpdate);
 assert.deepEqual(x.writes,[previous,current],'Deleting an account updates only the two global manifests');
 x.writes.length=0;x.restore(oldWork);
 result=await x.sync({write:true});assert.equal(result.persisted,true);assert.deepEqual(x.get().accounts,['personal','work']);assert.equal(x.get().total,2);
 assert.deepEqual(x.writes,[previous,current],'Restored complete indexed account needs no rebuild');
 // Legacy copied account with a single complete metadata/search pair.
 const copied=seg('copied','old');
 x.add(copied,[record('copied','c')]);
 result=await x.sync({write:true});assert.equal(x.get().total,3);assert(x.get().accounts.includes('copied'));assert(x.values.has('copied/catalog/account-index.json'));
 // Ambiguous legacy metadata (older rebuilds/label revisions), missing index,
 // and a pointer with the wrong account must never be guessed.
 const a=seg('ambiguous','old'),b=seg('ambiguous','new');
 x.add(a,[record('ambiguous','d')]);x.add(b,[record('ambiguous','d')]);
 x.values.set(record('unindexed','e').path,'Fictional HTML');
 const bad=seg('incomplete','only');x.add(bad,[record('incomplete','f')]);x.values.set(record('incomplete','1').path,'Fictional HTML');
 x.values.set(record('renamed','2').path,'Fictional HTML');x.savePointer('renamed',[p],1);
 x.writes.length=0;
 result=await x.sync({write:true});assert.deepEqual(Array.from(result.unindexed),['ambiguous','incomplete','renamed','unindexed']);assert.equal(x.writes.length,0);assert.equal(x.get().total,3);
 // A lock conflict and an incomplete folder listing must not publish changes.
 x.removeAccount('work');x.locks.blocked=true;
 result=await x.sync({write:true});assert.equal(result.deferred,true);assert.equal(result.manifest.total,2);assert.equal(x.get().total,3);assert.equal(x.writes.length,0);
 x.locks.blocked=false;x.state.failEnumeration=true;
 await assert.rejects(x.sync({write:true}),/Permission lost/);assert.equal(x.writes.length,0);
 x.state.failEnumeration=false;result=await x.sync({write:true});assert.equal(result.persisted,true);assert.equal(x.get().total,2);assert.equal(x.locks.open,x.locks.close);
 console.log('PASS account migration, no-op, read-only, whole-account removal, exact duplicate-aware totals, backup cleanup, safe copied-account adoption, lock conflict and incomplete enumeration; no HTML reads');
}
main().catch(e=>{console.error(e);process.exitCode=1;});
