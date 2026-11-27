/* Return to the archive history entry, with a direct-link fallback. */
(function(){'use strict';
 const back=document.getElementById('guideBack');
 const from=new URLSearchParams(location.search).get('from');
 if(from!=='browse'&&from!=='import')return;
 back.href='index.html'+(from==='import'?'#import':'');
 back.addEventListener('click',event=>{
  if(event.button!==0||event.ctrlKey||event.metaKey||event.shiftKey||event.altKey)return;
  if(history.length>1){event.preventDefault();history.back();}
 });
})();
