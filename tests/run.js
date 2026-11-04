/* Native File System Access tests. All fixtures are fictional. */
async function runEnglishTests(parent){
 const C=ArchiveCore,checks=[];function check(name,ok){checks.push({name,pass:!!ok});if(!ok)throw Error(name);}
 const root=await parent.getDirectoryHandle('test-'+crypto.randomUUID(),{create:true});
 const first=()=>new File([ExampleFixtures.first],'example.mbox');let r=await new C.Importer(root,{batchSize:2}).run([first()],'example');check('First import stores four messages',r.stats.new===4&&r.stats.errors===0);
 check('Fresh catalogs use the sibling app directory',C.MANIFEST==='__email_archiver/assets/catalog/archive.js'&&await C.exists(root,C.MANIFEST)&&await C.exists(root,C.VIEWER_DIR+'archive.lock'));
 async function contentPaths(d,p=''){const out=[];for await(const [n,h] of d.entries()){if(h.kind==='directory')out.push(...await contentPaths(h,p+n+'/'));else if(n.endsWith('.html')||p.includes('/attachments/'))out.push(p+n);}return out.sort();}
 const before=await contentPaths(root);const sanitize=DOMPurify.sanitize;let sanitized=0;DOMPurify.sanitize=function(...args){sanitized++;return sanitize.apply(this,args);};
 r=await new C.Importer(root).run([first()],'example');DOMPurify.sanitize=sanitize;check('Repeated import adds no messages',r.stats.new===0&&r.stats.duplicates===4);check('Reimport does not sanitize any current-renderer HTML',sanitized===0);check('Repeated import adds no HTML or attachment files',JSON.stringify(before)===JSON.stringify(await contentPaths(root)));
 check('Current renderer duplicates skip HTML and catalog writes',r.stats.refreshed===0&&r.stats.committed===0);
 const firstManifest=await C.manifest(root),oldShard=firstManifest.segments[0].meta,oldShardData=C.unwrap(await C.read(root,oldShard));
 check('Newly imported records carry a renderer marker',oldShardData.records[0].renderVersion===MailRenderer.RENDER_VERSION);
 delete oldShardData.records[0].renderVersion;await C.write(root,oldShard,C.wrap(oldShardData));
 r=await new C.Importer(root).run([first()],'example');
 check('Old unversioned HTML refreshes automatically just once',r.stats.refreshed===1&&r.stats.new===0);
 sanitized=0;DOMPurify.sanitize=function(...args){sanitized++;return sanitize.apply(this,args);};
 r=await new C.Importer(root).run([first()],'example');DOMPurify.sanitize=sanitize;
 check('Updated renderer is not invoked on a following reimport',sanitized===0);
 check('Upgraded HTML is skipped by the following reimport',r.stats.refreshed===0&&r.stats.committed===0);
 r=await new C.Importer(root).run([new File([ExampleFixtures.overlap],'extensionless')],'example');check('Overlapping export adds only the new message',r.stats.new===1&&r.stats.duplicates===1);
 let imp=await new C.Importer(root).open(),rows=[...imp.records.values()];check('Old messages remain present',rows.length===5);check('Gmail labels are merged',rows.find(x=>x.subject==='Welcome to your email archive').labels.includes('Saved'));check('Missing dates use the English folder',rows.find(x=>x.subject==='A note without a date').folder==='example/unknown-date');check('Metadata and text shards use the English catalog path',imp.m.segments.every(s=>s.meta.startsWith('example/catalog/')));
 const rich=rows.find(x=>x.subject==='A tiny trip plan');let html=await C.read(root,rich.path);check('Standalone message has English headers',html.includes('<dt>From</dt>')&&html.includes('<h2>Attachments</h2>'));
 check('Standalone message backlink goes to the sibling app',html.includes('href="../../../__email_archiver/index.html"'));check('CID is a local attachment URL',html.includes('src="attachments/'));check('Attachment paths are ASCII',rich.attachments.every(a=>/^[\x20-\x7e]+$/.test(a.href)));
 const changed=ExampleFixtures.first.replace('Travel, Example','Travel, Example, Saved');sanitized=0;DOMPurify.sanitize=function(...args){sanitized++;return sanitize.apply(this,args);};
 await new C.Importer(root).run([new File([changed],'labels')],'example');DOMPurify.sanitize=sanitize;
 check('Label-only duplicate update reuses the already rendered HTML body',sanitized===0);check('Label-only update keeps attachment paths and files',JSON.stringify(before)===JSON.stringify((await contentPaths(root)).filter(x=>!x.includes(rows.find(r=>r.subject==='One more example').id))));
 const mail=(id,body)=>new TextEncoder().encode('From: a@example.invalid\nTo: b@example.invalid\nDate: Wed, 15 Jan 2025 12:00:00 +0000\n'+(id?'Message-ID: <'+id+'>\n':'')+'Subject: Synthetic\n\n'+body);const a=await C.prepare(mail('same@example.invalid','one'),'example'),b=await C.prepare(mail('same@example.invalid','two'),'example');check('Same Message-ID cannot discard different content',a.meta.id!==b.meta.id);check('Missing IDs deduplicate by content',(await C.prepare(mail('','same'),'example')).meta.id===(await C.prepare(mail('','same'),'example')).meta.id);
 const richMime=new TextEncoder().encode('From: designer@example.invalid\nTo: reader@example.invalid\nDate: Wed, 15 Jan 2025 12:00:00 +0000\nSubject: Styled sample\nMIME-Version: 1.0\nContent-Type: text/html; charset=utf-8\n\n<div style="color:#225588;font-weight:bold">Fictional formatting</div>');const parsedRich=await C.prepare(richMime,'example');check('HTML MIME import keeps safe colors and type',parsedRich.body.includes('color:#225588')&&parsedRich.body.includes('font-weight:bold'));
 const formatted=C.cleanHTML('<style>.accent{color:rgb(12, 34, 56)}</style><table bgcolor="#ffeeaa"><tr><td class="accent" style="font-weight:bold;background-image:url(https://example.invalid/a)">Styled</td></tr></table>');check('Safe inline fonts and table backgrounds survive',formatted.html.includes('font-weight:bold')&&formatted.html.includes('bgcolor="#ffeeaa"'));check('Safe stylesheet colors are inlined',formatted.html.includes('color:rgb(12, 34, 56)'));check('Network CSS is rejected',!formatted.html.includes('background-image')&&!formatted.html.includes('url('));
 const unsafe=C.cleanHTML('<script>alert(1)</script><img src="https://example.invalid/remote" onerror="alert(1)"><a href="javascript:alert(1)">x</a>');const inert=document.createElement('template');inert.innerHTML=unsafe.html;const remote=inert.content.querySelector('img');check('Untrusted scripts and event handlers are removed',!unsafe.html.includes('<script')&&!unsafe.html.includes('onerror')&&!unsafe.html.includes('javascript:'));check('Remote images do not auto-load',!remote.hasAttribute('src')&&remote.getAttribute('data-remote-src')==='https://example.invalid/remote');const embedded=C.cleanHTML('<img src="data:image/png;base64,aGVsbG8=" alt="inline"><img src="data:image/svg+xml;base64,PHN2Zz4=" alt="unsafe">');const raster=embedded.html.match(/<img[^>]*>/g)||[];check('Embedded raster data images remain offline; SVG data is refused',raster.length===2&&raster[0].includes('data:image/png;base64,')&&!raster[1].includes('src='));const remoteDoc=C.documentHTML({subject:'Example',date:null,rawDate:'',from:'a',to:'b',cc:'',bcc:'',labels:[],messageId:''},unsafe.html,[],'../../../');check('Remote loading is opt-in with a restricted script policy',remoteDoc.includes('loadRemoteImages')&&remoteDoc.includes("script-src 'sha256-")&&!remoteDoc.includes("script-src 'unsafe-inline'"));
 const stored=await C.read(root,rich.path);const holder=document.createElement('template');holder.innerHTML=stored;
 const recordTag=holder.content.querySelector('#mail-archive-record[type="application/json"]');
 const embeddedRecord=JSON.parse(recordTag.textContent).record;
 check('Standalone HTML embeds inert structured metadata',!!recordTag&&embeddedRecord.id===rich.id&&embeddedRecord.path===rich.path);
 check('New HTML carries decoded MIME headers',embeddedRecord.mime.headers.some(h=>h.name==='content-type')&&embeddedRecord.mime.headers.some(h=>h.name==='subject'));
 const originalPaths=await contentPaths(root);
 // Rebuilding must recreate the entire deleted viewer catalog directory.
 const viewerAssets=await (await root.getDirectoryHandle('__email_archiver')).getDirectoryHandle('assets');
 await viewerAssets.removeEntry('catalog',{recursive:true});
 check('Catalog directory really is absent before rebuild',!await C.exists(root,C.MANIFEST));
 const rebuilt=await ArchiveReindex.rebuild(root,{batchSize:2});
 check('Reindex from HTML succeeds without MBOX',rebuilt.indexed===5&&rebuilt.committed&&rebuilt.errors===0);
 check('Rebuild uses sibling app manifest location',await C.exists(root,C.MANIFEST));
 check('Reindex preserves every message and attachment file',JSON.stringify(originalPaths)===JSON.stringify(await contentPaths(root)));
 const restored=new C.Importer(root);await restored.open();
 check('Rebuilt catalog preserves known messages and labels',restored.records.size===5&&[...restored.records.values()].some(x=>x.labels.includes('Saved')));
 const stopRebuild=new AbortController();stopRebuild.abort();
 const snapshot=(await C.manifest(root)).generation;
 const interrupted=await ArchiveReindex.rebuild(root,{signal:stopRebuild.signal});
 check('Cancelled rebuild never publishes a new manifest',interrupted.interrupted&&(await C.manifest(root)).generation===snapshot);
 const oldPage=stored.replace(/<script id="mail-archive-record" type="application\/json">[\s\S]*?<\/script>/,'');
 const recovered=ArchiveReindex.fromHtml(oldPage,{account:rich.account,id:rich.id,path:rich.path,folder:rich.folder});
 check('Catalog repair recovers older saved HTML from readable headers',recovered.legacy&&recovered.record.subject===rich.subject&&recovered.record.from===rich.from&&recovered.record.path===rich.path);
 let rejectedBadMetadata=false;
 try{ArchiveReindex.fromHtml(stored.replace(/\"schema\":1/,'\"schema\":99'),{account:rich.account,id:rich.id,path:rich.path,folder:rich.folder});}
 catch(e){rejectedBadMetadata=e.message==='INVALID_EMBEDDED_METADATA';}
 check('Catalog repair still rejects corrupt embedded metadata',rejectedBadMetadata);
 const unchanged=await contentPaths(root);r=await new C.Importer(root).run([first()],'example');
 check('Repeated MBOX import does not duplicate archived email files',r.stats.new===0&&JSON.stringify(unchanged)===JSON.stringify(await contentPaths(root)));

 // EML fidelity and policy tests use fictional messages and temporary folders.
 const E=ArchiveEML,enc=new TextEncoder();
 const sample=enc.encode('From: a@example.invalid\r\nX-Test: >From header\r\n\r\n>From body line\r\n>>From second line\r\n');
 const extracted=E.fromMbox(sample),out=new TextDecoder().decode(extracted.bytes);
 check('MBOXrd decoding changes only body lines and preserves CRLF',out==='From: a@example.invalid\r\nX-Test: >From header\r\n\r\nFrom body line\r\n>From second line\r\n'&&extracted.unescaped===2);
 check('DKIM alone is not selected for extra EML storage',E.classify({headers:[{key:'dkim-signature',value:'v=1; a=rsa-sha256'}],attachments:[],text:''},[]).length===0);
 check('PGP/MIME, S/MIME and inline PGP signatures qualify',E.classify({headers:[{key:'content-type',value:'multipart/signed; protocol=application/pgp-signature'}]},[]).includes('signed')&&E.classify({headers:[{key:'content-type',value:'application/pkcs7-mime; smime-type=signed-data'}]},[]).includes('signed')&&E.classify({text:'-----BEGIN PGP SIGNED MESSAGE-----'},[]).includes('signed'));
 check('Encrypted PGP and S/MIME qualify',E.classify({headers:[{key:'content-type',value:'multipart/encrypted; protocol=application/pgp-encrypted'}]},[]).includes('encrypted')&&E.classify({headers:[{key:'content-type',value:'application/pkcs7-mime; smime-type=enveloped-data'}]},[]).includes('encrypted'));
 check('Gmail Important and Starred labels qualify',E.classify({headers:[]},['Important','\\Starred']).length===2);
 const emlFolder=await parent.getDirectoryHandle('originals-'+crypto.randomUUID(),{create:true});
 const makeMessage=(id,extra,body)=>'From example@example.invalid Wed Jan 15 12:00:00 2025\r\nFrom: Anna <a@example.invalid>\r\nTo: Bob <b@example.invalid>\r\nMessage-ID: <'+id+'@example.invalid>\r\nSubject: Original test\r\nDate: Wed, 15 Jan 2025 12:00:00 +0000\r\nMIME-Version: 1.0\r\n'+extra+'Content-Type: text/plain; charset=utf-8\r\n\r\n'+body+'\r\n';
 const policyMessages=makeMessage('starred-policy','X-Gmail-Labels: Starred\r\n','Starred fixture')
                      +makeMessage('important-policy','X-Gmail-Labels: Important\r\n','Important fixture');
 const starredRoot=await parent.getDirectoryHandle('starred-only-'+crypto.randomUUID(),{create:true});
 const starredRun=await new C.Importer(starredRoot,{emlPolicy:{starred:true,important:false}}).run([new File([policyMessages],'labels.mbox')],'policy');
 const starredRecords=[...(await new C.Importer(starredRoot).open()).records.values()];
 check('Starred-only EML option retains Starred but excludes Important',starredRun.stats.emlSaved===1&&!!starredRecords.find(x=>x.messageId.includes('starred-policy@')).original&&!starredRecords.find(x=>x.messageId.includes('important-policy@')).original);
 const importantRoot=await parent.getDirectoryHandle('important-only-'+crypto.randomUUID(),{create:true});
 const importantRun=await new C.Importer(importantRoot,{emlPolicy:{starred:false,important:true}}).run([new File([policyMessages],'labels.mbox')],'policy');
 const importantRecords=[...(await new C.Importer(importantRoot).open()).records.values()];
 check('Important-only EML option retains Important but excludes Starred',importantRun.stats.emlSaved===1&&!!importantRecords.find(x=>x.messageId.includes('important-policy@')).original&&!importantRecords.find(x=>x.messageId.includes('starred-policy@')).original);
 const defaultRoot=await parent.getDirectoryHandle('default-labels-'+crypto.randomUUID(),{create:true});
 const defaultRun=await new C.Importer(defaultRoot).run([new File([policyMessages],'labels.mbox')],'policy');
 check('Starred and Important EML copies are OFF by default',defaultRun.stats.new===2&&defaultRun.stats.emlSaved===0);
 const selectedSource=makeMessage('important','X-Gmail-Labels: Important\r\nDKIM-Signature: v=1; a=rsa-sha256\r\n','>From the archive\r\nSigned bytes stay quoted in MBOX.');
 const plainSource=makeMessage('ordinary','DKIM-Signature: v=1; a=rsa-sha256\r\n','No original needed.');
 const selectedFile=()=>new File([selectedSource+plainSource],'selected.mbox');
 const importantPolicy={important:true};
 let selection=await new C.Importer(emlFolder,{batchSize:1,emlPolicy:importantPolicy}).run([selectedFile()],'emltest');
 check('Selected-category import writes only qualifying EML',selection.stats.new===2&&selection.stats.emlSaved===1&&selection.stats.errors===0);
 let selectedIndex=await new C.Importer(emlFolder).open(),messages=[...selectedIndex.records.values()];
 let retained=messages.find(x=>x.messageId.includes('important@')),normal=messages.find(x=>x.messageId.includes('ordinary@'));
 check('Nonselected DKIM-only mail remains HTML only',!normal.original);
 check('Selected EML is a sibling of HTML with stable ID',retained.original.href==='originals/email-'+retained.id+'.eml'&&await C.exists(emlFolder,retained.folder+'/'+retained.original.href));
 check('Preserved EML passes readback SHA-256 verification',await E.verify(emlFolder,retained,retained.original));
 const rawBytes=new Uint8Array(await (await C.fileHandle(emlFolder,retained.folder+'/'+retained.original.href)).getFile().then(f=>f.arrayBuffer()));
 check('EML keeps CRLF headers and restores escaped From line',new TextDecoder().decode(rawBytes).includes('\r\n\r\nFrom the archive\r\n'));
 const oldPaths=await contentPaths(emlFolder);
 selection=await new C.Importer(emlFolder,{emlPolicy:importantPolicy}).run([selectedFile()],'emltest');
 check('Repeated import reuses EML without creating more files',selection.stats.new===0&&selection.stats.duplicates===2&&selection.stats.emlSaved===0&&selection.stats.emlReused===1&&JSON.stringify(oldPaths)===JSON.stringify(await contentPaths(emlFolder)));
 await C.write(emlFolder,retained.folder+'/'+retained.original.href,enc.encode('corrupted'));
 check('Tampering with EML is detected',!await E.verify(emlFolder,retained,retained.original));
 selection=await new C.Importer(emlFolder,{emlPolicy:importantPolicy}).run([selectedFile()],'emltest');
 check('A later import repairs corrupt EML and verifies it',selection.stats.emlSaved===1&&await E.verify(emlFolder,retained,retained.original));
 const importantAdded=plainSource.replace('DKIM-Signature:','X-Gmail-Labels: Important\r\nDKIM-Signature:');
 selection=await new C.Importer(emlFolder,{emlPolicy:importantPolicy}).run([new File([importantAdded],'label-update')],'emltest');
 check('Changed label promotes existing mail to EML without a duplicate',selection.stats.new===0&&selection.stats.duplicates===1&&selection.stats.emlSaved===1);
 selectedIndex=await new C.Importer(emlFolder).open();normal=selectedIndex.records.get('emltest/'+normal.id);
 check('Promoted message is linked in HTML and catalog',!!normal.original&&(await C.read(emlFolder,normal.path)).includes('Download EML source message'));
 const emlRebuilt=await ArchiveReindex.rebuild(emlFolder,{batchSize:1});
 const reconstructed=await new C.Importer(emlFolder).open();
 check('HTML-only reindex preserves EML original records',emlRebuilt.indexed===2&&!!reconstructed.records.get('emltest/'+normal.id).original);

 const originalPage=await C.read(emlFolder,retained.path);
 const originalTemplate=document.createElement('template');originalTemplate.innerHTML=originalPage;
 const embeddedOriginal=JSON.parse(originalTemplate.content.querySelector('#mail-archive-record').textContent).record.original;
 check('Standalone HTML stores EML SHA-256 in inert metadata',embeddedOriginal.sha256===retained.original.sha256&&originalPage.includes('Download EML source message'));
 check('Stored EML excludes the MBOX envelope separator',new TextDecoder().decode(rawBytes).startsWith('From: Anna <a@example.invalid>\r\n'));
 const sigSource='From test@example.invalid Wed Jan 15 12:00:00 2025\nFrom: a@example.invalid\nTo: b@example.invalid\nSubject: Signed synthetic\nMessage-ID: <signed@example.invalid>\nDate: Wed, 15 Jan 2025 12:00:00 +0000\nMIME-Version: 1.0\nContent-Type: multipart/signed; boundary="sig"; protocol="application/pgp-signature"\n\n--sig\nContent-Type: text/plain; charset=utf-8\n\nFictional signed content\n--sig\nContent-Type: application/pgp-signature\nContent-Transfer-Encoding: base64\n\nYWJj\n--sig--\n';
 const signedFolder=await parent.getDirectoryHandle('signed-'+crypto.randomUUID(),{create:true});
 const sigReport=await new C.Importer(signedFolder).run([new File([sigSource],'signed.mbox')],'test');
 check('Signed multipart MIME auto-retains EML during actual import',sigReport.stats.new===1&&sigReport.stats.emlSaved===1);
 const encryptedSource='From test@example.invalid Wed Jan 15 12:00:00 2025\nFrom: a@example.invalid\nTo: b@example.invalid\nSubject: Encrypted synthetic\nMessage-ID: <encrypted@example.invalid>\nDate: Wed, 15 Jan 2025 12:00:00 +0000\nMIME-Version: 1.0\nContent-Type: application/pkcs7-mime; smime-type=enveloped-data\nContent-Transfer-Encoding: base64\n\nYWJj\n';
 const encFolder=await parent.getDirectoryHandle('encrypted-'+crypto.randomUUID(),{create:true});
 const encReport=await new C.Importer(encFolder).run([new File([encryptedSource],'encrypted.mbox')],'test');
 check('S/MIME encrypted MIME auto-retains EML during actual import',encReport.stats.new===1&&encReport.stats.emlSaved===1);
  const noRetainFolder=await parent.getDirectoryHandle('no-retain-'+crypto.randomUUID(),{create:true});
 const disabled=await new C.Importer(noRetainFolder,{emlPolicy:{signed:false,encrypted:false,starred:false,important:false}}).run([new File([selectedSource],'selected.mbox')],'test');
 check('Explicit EML opt-out stores HTML with no original',disabled.stats.new===1&&disabled.stats.emlSaved===0&&![...(await new C.Importer(noRetainFolder).open()).records.values()][0].original);
 const failFolder=await parent.getDirectoryHandle('verify-fail-'+crypto.randomUUID(),{create:true});
 const realWrite=C.write;let didFail=false;
 C.write=async(root,path,bytes)=>realWrite(root,path,path.endsWith('.eml')?enc.encode('wrong persisted bytes'):bytes);
 try{await new C.Importer(failFolder).run([new File([selectedSource],'verify.mbox')],'test');}
 catch(e){didFail=e.message==='EML_VERIFY_FAILED';}finally{C.write=realWrite;}
 check('Checksum failure prevents publishing message catalog or HTML',didFail&&(await C.manifest(failFolder)).total===0&&(await contentPaths(failFolder)).filter(p=>p.endsWith('.html')).length===0);
 const stopRoot=await parent.getDirectoryHandle('stop-'+crypto.randomUUID(),{create:true}),controller=new AbortController();r=await new C.Importer(stopRoot,{signal:controller.signal,onProgress:s=>{if(s.read>=2)controller.abort();}}).run([first()],'example');check('Cancellation commits completed messages',r.interrupted&&r.stats.new===2);r=await new C.Importer(stopRoot).run([first()],'example');check('Retry after cancellation adds only remaining messages',r.stats.new===2&&r.stats.duplicates===2);
 const priorPaths=await contentPaths(root);
 r=await new C.Importer(root,{refreshExisting:true}).run([first()],'example');
 check('Reimport can reformat existing HTML while retaining EML option',r.stats.refreshed===4&&r.stats.new===0&&JSON.stringify(priorPaths)===JSON.stringify(await contentPaths(root)));
 const legacyRoot=await parent.getDirectoryHandle('legacy-layout-'+crypto.randomUUID(),{create:true});
 await C.write(legacyRoot,'index.html','<script src="assets/core.js"></script>');
 check('Legacy root viewer retains its catalog location',(await C.catalogPaths(legacyRoot)).current==='assets/catalog/archive.js');
 const legacyReport=await new C.Importer(legacyRoot).run([first()],'example');
 check('Old root archives still import and keep root-level lock',legacyReport.stats.new===4&&await C.exists(legacyRoot,'assets/catalog/archive.js')&&await C.exists(legacyRoot,'archive.lock'));
 const lock=new C.Importer(root),other=new C.Importer(root);await lock.lock();let blocked=false;try{await other.lock();}catch{blocked=true;}finally{await lock.lockWriter.close();if(other.lockWriter)await other.lockWriter.close();}check('Concurrent writer is rejected',blocked);
 const long='From a@example.invalid Wed Jan 15 12:00:00 2025\nFrom: a@example.invalid\nSubject: First\n\nBody\nFrom a@example.invalid Wed Jan 15 12:00:00 2025\nFrom: a@example.invalid\nSubject: Long headers\nReferences: <a@example.invalid>\n'+' <b@example.invalid>\n'.repeat(1200)+'\nBody\n';check('Long folded headers do not hide a message boundary',(await Array.fromAsync(C.mbox(new File([long],'long')))).length===2);
 return {checks,passed:checks.length};
}
if(document.getElementById('run'))document.getElementById('run').onclick=async()=>{const out=document.getElementById('result');try{const dir=await showDirectoryPicker({mode:'readwrite'});out.textContent='Running…';const result=await runEnglishTests(dir);out.textContent=result.checks.map(x=>'PASS '+x.name).join('\n')+'\n\n'+result.passed+' checks passed.';}catch(e){out.textContent='FAILED: '+e.name+' — '+e.message;}};
