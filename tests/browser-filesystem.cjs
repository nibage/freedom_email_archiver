/* Test-only filesystem bridge. Production still uses native File System Access. */
'use strict';
const fs=require('node:fs/promises'),path=require('node:path');
async function attachTestFilesystem(page,root){
 const locks=new Set(),writes=new Map();
 await page.exposeFunction('archiveTestDisk',async(op,relative,data)=>{
  try{
   const target=path.resolve(root,relative);
   if(target!==root&&!target.startsWith(root+path.sep))throw Error('OUTSIDE_TEST_ROOT');
   if(op==='directory'){
    if(data)await fs.mkdir(target,{recursive:true});
    if(!(await fs.stat(target)).isDirectory())throw Error('NOT_DIRECTORY');
   }else if(op==='file'){
    if(data){const file=await fs.open(target,'a');await file.close();}
    if(!(await fs.stat(target)).isFile())throw Error('NOT_FILE');
   }else if(op==='entries')return {ok:true,data:(await fs.readdir(target,{withFileTypes:true})).map(e=>[e.name,e.isDirectory()?'directory':'file'])};
   else if(op==='read')return {ok:true,data:(await fs.readFile(target)).toString('base64')};
   else if(op==='begin'){
    if(locks.has(target))return {ok:false,name:'NoModificationAllowedError'};
    locks.add(target);writes.set(target,null);
   }else if(op==='write')writes.set(target,Buffer.from(data,'base64'));
   else if(op==='close'){
    const bytes=writes.get(target);if(bytes!==null)await fs.writeFile(target,bytes);
    locks.delete(target);writes.delete(target);
   }else if(op==='abort'){locks.delete(target);writes.delete(target);}
   else if(op==='remove')await fs.rm(target,{recursive:!!data});
   else throw Error('UNKNOWN_TEST_OPERATION');
   return {ok:true};
  }catch(e){return {ok:false,name:e.code==='ENOENT'?'NotFoundError':e.name,message:e.message};}
 });
 await page.addInitScript(({rootName})=>{
  async function io(...args){const r=await archiveTestDisk(...args);if(!r.ok)throw new DOMException(r.message||r.name,r.name);return r.data;}
  function handle(relative,kind){
   return {kind,name:relative.split('/').pop()||rootName,
    queryPermission:async()=> 'granted',requestPermission:async()=> 'granted',
    getDirectoryHandle:async(name,o={})=>{const p=relative?relative+'/'+name:name;await io('directory',p,!!o.create);return handle(p,'directory');},
    getFileHandle:async(name,o={})=>{const p=relative?relative+'/'+name:name;await io('file',p,!!o.create);return handle(p,'file');},
    async *entries(){for(const [n,k] of await io('entries',relative))yield [n,handle(relative?relative+'/'+n:n,k)];},
    async *keys(){for await(const [n] of this.entries())yield n;},
    removeEntry:async(name,o={})=>io('remove',relative?relative+'/'+name:name,!!o.recursive),
    getFile:async()=>{const data=atob(await io('read',relative));return new File([Uint8Array.from(data,c=>c.charCodeAt(0))],relative.split('/').pop());},
    createWritable:async()=>{
     await io('begin',relative);
     return {write:async value=>{
      const bytes=typeof value==='string'?new TextEncoder().encode(value):new Uint8Array(value instanceof Blob?await value.arrayBuffer():value);
      let s='';for(let i=0;i<bytes.length;i+=32768)s+=String.fromCharCode(...bytes.subarray(i,i+32768));
      await io('write',relative,btoa(s));
     },close:()=>io('close',relative),abort:()=>io('abort',relative)};
    }
   };
  }
  window.archiveTestRoot=handle('','directory');
  window.showDirectoryPicker=async()=>{window.archiveTestPickerCount=(window.archiveTestPickerCount||0)+1;return window.archiveTestRoot;};
 },{rootName:path.basename(root)});
}
module.exports={attachTestFilesystem};
