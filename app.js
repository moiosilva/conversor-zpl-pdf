const $ = (s) => document.querySelector(s);
const state = { canvases: [], files: [], widthMm: 100, heightMm: 150, dpi: 203 };
const sample = `^XA
^PW812
^LL1218
^FO55,55^GB702,1108,4^FS
^FO90,95^A0N,34,34^FDETIQUETA DE ENVIO^FS
^FO90,145^GB630,3,3^FS
^FO90,185^A0N,25,25^FDDESTINATARIO:^FS
^FO90,225^A0N,38,38^FDVAGNER DA SILVA^FS
^FO90,278^A0N,26,26^FDRua Exemplo, 123 - Centro^FS
^FO90,320^A0N,26,26^FDSao Paulo - SP^FS
^FO90,370^A0N,32,32^FDCEP: 01001-000^FS
^FO90,435^GB630,3,3^FS
^FO125,500^BY3,2,120^BCN,120,Y,N,N^FD123456789012^FS
^FO90,700^GB630,3,3^FS
^FO90,745^A0N,24,24^FDPEDIDO^FS
^FO90,785^A0N,48,48^FD#MLB-2026-001^FS
^FO90,875^A0N,25,25^FDVolume 1/1   Peso: 0,85 kg^FS
^FO90,1035^A0N,22,22^FDGerado por ZPL para PDF^FS
^XZ`;

const sizeSelect = $('#sizeSelect');
sizeSelect.addEventListener('change', () => $('#customSize').hidden = sizeSelect.value !== 'custom');
$('#sampleBtn').addEventListener('click', () => { state.files=[]; updateFileList(); $('#zplInput').value = sample; updateCount(); generate(); });
$('#clearBtn').addEventListener('click', () => { state.files=[]; updateFileList(); $('#zplInput').value = ''; updateCount(); resetPreview(); $('#zplInput').focus(); });
$('#zplInput').addEventListener('input', updateCount);
$('#convertBtn').addEventListener('click', generate);
$('#downloadBtn').addEventListener('click', downloadPdf);

const dropzone = $('#dropzone');
$('#chooseFile').addEventListener('click', () => $('#fileInput').click());
$('#fileInput').addEventListener('change', (e) => { if(e.target.files.length) readFiles(e.target.files); e.target.value=''; });
['dragenter','dragover'].forEach(ev => dropzone.addEventListener(ev, e => { e.preventDefault(); dropzone.classList.add('dragover'); }));
['dragleave','drop'].forEach(ev => dropzone.addEventListener(ev, e => { e.preventDefault(); dropzone.classList.remove('dragover'); }));
dropzone.addEventListener('drop', e => e.dataTransfer.files.length && readFiles(e.dataTransfer.files));

async function readFiles(fileList){
  hideError();
  const incoming=[...fileList];
  if(state.files.length+incoming.length>50) return showError('Selecione no máximo 50 arquivos por vez.');
  if(incoming.some(file=>file.size>5*1024*1024)) return showError('Cada arquivo pode ter no máximo 5 MB.');
  if([...state.files,...incoming].reduce((sum,item)=>sum+(item.file||item).size,0)>25*1024*1024) return showError('O conjunto de arquivos pode ter no máximo 25 MB.');
  try{
    const loaded=await Promise.all(incoming.map(async file=>({file,text:await file.text()})));
    state.files.push(...loaded); syncFilesToEditor(); updateFileList(); generate();
  }catch(err){ console.error(err); showError('Não foi possível ler um dos arquivos selecionados.'); }
}
function syncFilesToEditor(){
  $('#zplInput').value=state.files.map(item=>item.text.trim()).filter(Boolean).join('\n'); updateCount();
}
function updateFileList(){
  const list=$('#fileList'); list.innerHTML=''; list.hidden=!state.files.length;
  state.files.forEach((item,index)=>{
    const row=document.createElement('div'); row.className='file-item';
    const order=document.createElement('span'); order.className='file-order'; order.textContent=index+1;
    const name=document.createElement('span'); name.className='file-name'; name.textContent=item.file.name;
    const size=document.createElement('span'); size.className='file-size'; size.textContent=formatBytes(item.file.size);
    const remove=document.createElement('button'); remove.className='file-remove'; remove.type='button'; remove.setAttribute('aria-label',`Remover ${item.file.name}`); remove.textContent='×';
    remove.addEventListener('click',()=>{ state.files.splice(index,1); syncFilesToEditor(); updateFileList(); state.files.length?generate():resetPreview(); });
    row.append(order,name,size,remove); list.appendChild(row);
  });
}
function formatBytes(bytes){ return bytes<1024?`${bytes} B`:bytes<1048576?`${(bytes/1024).toFixed(1)} KB`:`${(bytes/1048576).toFixed(1)} MB`; }
function updateCount(){ $('#charCount').textContent = `${$('#zplInput').value.length.toLocaleString('pt-BR')} caracteres`; }
function showError(msg){ const el=$('#errorMessage'); el.textContent=msg; el.hidden=false; }
function hideError(){ $('#errorMessage').hidden=true; }
function getDimensions(){
  if(sizeSelect.value === 'custom') return [clamp(+$('#widthInput').value,20,300),clamp(+$('#heightInput').value,20,500)];
  return sizeSelect.value.split('x').map(Number);
}
function clamp(v,min,max){ return Number.isFinite(v) ? Math.max(min,Math.min(max,v)) : min; }
async function prepareLabelJobs(zpl){
  const jobs=[], graphics=new Map();
  const token=/~DGR:([^,]+),(\d+),(\d+),:Z64:([^:]+):[0-9A-F]*|\^XA[\s\S]*?\^XZ/gi;
  let match;
  while((match=token.exec(zpl))){
    if(match[1]){
      const name=match[1].trim().replace(/^[A-Z]:/i,'').toUpperCase();
      const bytes=await inflateZ64(match[4]);
      graphics.set(name,{bytes,rowBytes:+match[3],totalBytes:+match[2]});
    }else{
      const code=match[0];
      if(/\^(?:FO|FT|GB|GF|FD|XG|BC|BQ|B3)/i.test(code)) jobs.push({code,graphics:new Map(graphics)});
      for(const deletion of code.matchAll(/\^ID(?:[A-Z]:)?([^\^~]+)/gi)) graphics.delete(deletion[1].trim().toUpperCase());
    }
  }
  if(!jobs.length && zpl.trim()) jobs.push({code:zpl,graphics});
  return jobs;
}
async function inflateZ64(base64){
  if(typeof DecompressionStream==='undefined') throw new Error('Este navegador não oferece descompactação Z64.');
  const binary=atob(base64.replace(/\s/g,'')), packed=new Uint8Array(binary.length);
  for(let i=0;i<binary.length;i++) packed[i]=binary.charCodeAt(i);
  const stream=new Blob([packed]).stream().pipeThrough(new DecompressionStream('deflate'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function generate(){
  hideError();
  const zpl=$('#zplInput').value.trim();
  if(!zpl) return showError('Cole um código ZPL ou envie um arquivo para continuar.');
  const button=$('#convertBtn'), buttonText=button.querySelector('span');
  button.disabled=true; buttonText.textContent='Processando etiqueta…';
  [state.widthMm,state.heightMm]=getDimensions(); state.dpi=+$('#dpiSelect').value;
  state.canvases=[]; const list=$('#canvasList'); list.innerHTML='';
  try{
    const labels=await prepareLabelJobs(zpl);
    if(labels.length>100) throw new Error('LIMIT');
    labels.forEach((label,i)=>{
      const canvas=renderZpl(label.code,state.widthMm,state.heightMm,state.dpi,label.graphics);
      state.canvases.push(canvas);
      const wrap=document.createElement('div'); wrap.className='canvas-wrap';
      const preview=document.createElement('canvas');
      const maxW=390, scale=Math.min(1,maxW/canvas.width);
      preview.width=Math.round(canvas.width*scale); preview.height=Math.round(canvas.height*scale);
      preview.getContext('2d').drawImage(canvas,0,0,preview.width,preview.height);
      const num=document.createElement('span'); num.className='page-number'; num.textContent=`${i+1}/${labels.length}`;
      wrap.append(preview,num); list.appendChild(wrap);
    });
    $('#emptyState').style.display='none'; list.style.display='flex';
    $('#pageBadge').textContent=`${labels.length} ${labels.length===1?'etiqueta':'etiquetas'}`;
    $('#pdfInfo').textContent='PDF pronto para gerar';
    $('#pdfMeta').textContent=`${state.widthMm} × ${state.heightMm} mm · ${state.dpi} dpi`;
    $('#downloadBtn').disabled=false;
  }catch(err){
    console.error(err);
    showError(err.message==='LIMIT'?'Para manter o navegador rápido, converta no máximo 100 etiquetas por vez.':'Não foi possível interpretar este ZPL. Verifique o arquivo e tente novamente.');
  }finally{ button.disabled=false; buttonText.textContent='Gerar prévia'; }
}

function resetPreview(){
  state.canvases=[]; $('#canvasList').innerHTML=''; $('#canvasList').style.display='none'; $('#emptyState').style.display='block';
  $('#pageBadge').textContent='0 etiquetas'; $('#pdfInfo').textContent='PDF não gerado'; $('#pdfMeta').textContent='Configure e gere uma prévia'; $('#downloadBtn').disabled=true;
}

function renderZpl(code,widthMm,heightMm,dpi,graphics=new Map()){
  const outW=Math.max(1,Math.round(widthMm/25.4*dpi)), outH=Math.max(1,Math.round(heightMm/25.4*dpi));
  const firstGraphic=graphics.values().next().value;
  const graphicW=firstGraphic?firstGraphic.rowBytes*8:outW, graphicH=firstGraphic?Math.ceil(firstGraphic.totalBytes/firstGraphic.rowBytes):outH;
  let pw=+(code.match(/\^PW(\d+)/i)||[])[1]||graphicW, ll=+(code.match(/\^LL(\d+)/i)||[])[1]||graphicH;
  const scale=Math.min(outW/pw,outH/ll), ox=(outW-pw*scale)/2, oy=(outH-ll*scale)/2;
  const canvas=document.createElement('canvas'); canvas.width=outW; canvas.height=outH;
  const ctx=canvas.getContext('2d'); ctx.fillStyle='#fff'; ctx.fillRect(0,0,outW,outH); ctx.save(); ctx.translate(ox,oy); ctx.scale(scale,scale); ctx.fillStyle='#000'; ctx.strokeStyle='#000';
  let x=0,y=0,fontH=30,fontW=30,font='Arial',align='left',by={w:2,h:100}, pendingBarcode=null;
  const commands=code.replace(/\r?\n/g,'').split('^').slice(1);
  for(let raw of commands){
    const cmd=raw.slice(0,2).toUpperCase(), arg=raw.slice(2);
    if(cmd==='FO'||cmd==='FT'){ const p=arg.split(',').map(Number); x=p[0]||0; y=p[1]||0; if(cmd==='FT') y-=fontH; }
    else if(cmd[0]==='A' && cmd!=='AT'){ const p=arg.split(','); fontH=+(p[1]||p[0].replace(/^[NRIB]/i,''))||30; fontW=+(p[2]||fontH)||fontH; font='Arial'; }
    else if(cmd==='CF'){ const p=arg.split(','); fontH=+p[1]||fontH; fontW=+p[2]||fontH; }
    else if(cmd==='FB'){ const p=arg.split(','); align=(p[3]||'L').toUpperCase()==='C'?'center':(p[3]||'L').toUpperCase()==='R'?'right':'left'; }
    else if(cmd==='BY'){ const p=arg.split(','); by={w:+p[0]||2,h:+p[2]||100}; }
    else if(cmd==='BC'){ const p=arg.split(','); pendingBarcode={h:+p[1]||by.h,text:(p[2]||'Y').toUpperCase()==='Y'}; }
    else if(cmd==='GB'){ drawBox(ctx,x,y,arg); }
    else if(cmd==='GF'){ drawGraphic(ctx,x,y,arg); }
    else if(cmd==='XG'){
      const p=arg.split(','), name=(p[0]||'').trim().replace(/^[A-Z]:/i,'').toUpperCase();
      const graphic=graphics.get(name); if(graphic) drawStoredGraphic(ctx,x,y,graphic,+p[1]||1,+p[2]||1);
    }
    else if(cmd==='FD'){
      let text=decodeField(arg);
      if(pendingBarcode){ drawCode128(ctx,text,x,y,pendingBarcode.h,by.w,pendingBarcode.text); pendingBarcode=null; }
      else drawText(ctx,text,x,y,font,fontH,fontW,align);
      align='left';
    }
  }
  ctx.restore(); return canvas;
}
function decodeField(s){ return s.replace(/_([0-9A-F]{2})/gi,(_,h)=>String.fromCharCode(parseInt(h,16))).replace(/\\&/g,'\n'); }
function drawText(ctx,text,x,y,font,h,w,align){
  ctx.save(); ctx.font=`${h}px ${font}`; ctx.textBaseline='top'; ctx.textAlign=align;
  const sx=w/h; ctx.translate(x,y); ctx.scale(sx,1); text.split(/\n/).forEach((line,i)=>ctx.fillText(line,0,i*h*1.18)); ctx.restore();
}
function drawBox(ctx,x,y,arg){
  const p=arg.split(',').map(Number), w=p[0]||1,h=p[1]||1,t=Math.max(1,p[2]||1), color=(p[3]||'B').toUpperCase();
  ctx.save(); ctx.lineWidth=t; if(color==='W'){ctx.strokeStyle='#fff';ctx.fillStyle='#fff'}
  if(w<=t||h<=t) ctx.fillRect(x,y,w||t,h||t); else ctx.strokeRect(x+t/2,y+t/2,Math.max(0,w-t),Math.max(0,h-t)); ctx.restore();
}
function drawGraphic(ctx,x,y,arg){
  const p=arg.split(','), format=p[0].toUpperCase(); if(format!=='A') return;
  const bytes=+p[1]||0, rowBytes=+p[2]||1, hex=p.slice(3).join('').replace(/[^0-9A-F]/gi,'');
  const rows=Math.ceil(bytes/rowBytes); ctx.save(); ctx.fillStyle='#000';
  for(let r=0;r<rows;r++) for(let b=0;b<rowBytes;b++){ const val=parseInt(hex.substr((r*rowBytes+b)*2,2),16)||0; for(let bit=0;bit<8;bit++) if(val&(128>>bit)) ctx.fillRect(x+b*8+bit,y+r,1,1); } ctx.restore();
}
function drawStoredGraphic(ctx,x,y,graphic,scaleX,scaleY){
  const {bytes,rowBytes,totalBytes}=graphic, rows=Math.ceil(totalBytes/rowBytes);
  const image=ctx.createImageData(rowBytes*8,rows), data=image.data;
  for(let r=0;r<rows;r++) for(let b=0;b<rowBytes;b++){
    const value=bytes[r*rowBytes+b]||0;
    for(let bit=0;bit<8;bit++){
      const i=(r*rowBytes*8+b*8+bit)*4, ink=(value&(128>>bit))?0:255;
      data[i]=data[i+1]=data[i+2]=ink; data[i+3]=255;
    }
  }
  if(scaleX===1&&scaleY===1) ctx.putImageData(image,x,y);
  else{ const temp=document.createElement('canvas'); temp.width=image.width; temp.height=image.height; temp.getContext('2d').putImageData(image,0,0); ctx.drawImage(temp,x,y,image.width*scaleX,image.height*scaleY); }
}

const code128Patterns=['212222','222122','222221','121223','121322','131222','122213','122312','132212','221213','221312','231212','112232','122132','122231','113222','123122','123221','223211','221132','221231','213212','223112','312131','311222','321122','321221','312212','322112','322211','212123','212321','232121','111323','131123','131321','112313','132113','132311','211313','231113','231311','112133','112331','132131','113123','113321','133121','313121','211331','231131','213113','213311','213131','311123','311321','331121','312113','312311','332111','314111','221411','431111','111224','111422','121124','121421','141122','141221','112214','112412','122114','122411','142112','142211','241211','221114','413111','241112','134111','111242','121142','121241','114212','124112','124211','411212','421112','421211','212141','214121','412121','111143','111341','131141','114113','114311','411113','411311','113141','114131','311141','411131','211412','211214','211232','2331112'];
function drawCode128(ctx,text,x,y,h,moduleW,showText){
  const vals=[104]; for(const ch of text){ const n=ch.charCodeAt(0)-32; vals.push(n>=0&&n<=94?n:0); }
  let checksum=104; vals.slice(1).forEach((v,i)=>checksum+=v*(i+1)); vals.push(checksum%103,106);
  let pos=x; ctx.save(); ctx.fillStyle='#000';
  for(const v of vals){ const pat=code128Patterns[v]; for(let i=0;i<pat.length;i++){ const w=+pat[i]*moduleW; if(i%2===0) ctx.fillRect(pos,y,w,h); pos+=w; } }
  if(showText){ ctx.font='18px Arial'; ctx.textAlign='center'; ctx.textBaseline='top'; ctx.fillText(text,(x+pos)/2,y+h+7); } ctx.restore();
}

function downloadPdf(){
  if(!state.canvases.length) return;
  try{
    const images=state.canvases.map(c=>dataUrlBytes(c.toDataURL('image/jpeg',.94)));
    const pdf=makePdf(images,state.canvases[0].width,state.canvases[0].height,state.widthMm,state.heightMm);
    const blob=new Blob([pdf],{type:'application/pdf'}), a=document.createElement('a');
    a.href=URL.createObjectURL(blob); a.download=`etiquetas-${new Date().toISOString().slice(0,10)}.pdf`; a.click(); setTimeout(()=>URL.revokeObjectURL(a.href),1000);
  }catch(e){ console.error(e); showError('Não foi possível gerar o PDF. Tente reduzir a quantidade de etiquetas.'); }
}
function dataUrlBytes(url){ const bin=atob(url.split(',')[1]), out=new Uint8Array(bin.length); for(let i=0;i<bin.length;i++) out[i]=bin.charCodeAt(i); return out; }
function makePdf(images,imgW,imgH,wMm,hMm){
  const enc=new TextEncoder(), chunks=[], offsets=[0]; let length=0;
  const add=v=>{ const b=typeof v==='string'?enc.encode(v):v; chunks.push(b); length+=b.length; };
  add('%PDF-1.4\n%âãÏÓ\n'); const n=2+images.length*3;
  const obj=(id,body,stream)=>{ offsets[id]=length; add(`${id} 0 obj\n${body}`); if(stream){add(`\nstream\n`);add(stream);add('\nendstream');} add('\nendobj\n'); };
  const kids=images.map((_,i)=>`${3+i*3} 0 R`).join(' '); obj(1,'<< /Type /Catalog /Pages 2 0 R >>'); obj(2,`<< /Type /Pages /Kids [${kids}] /Count ${images.length} >>`);
  const wp=wMm*72/25.4,hp=hMm*72/25.4;
  images.forEach((img,i)=>{ const page=3+i*3, image=page+1, content=page+2, name=`Im${i+1}`; const stream=`q\n${wp.toFixed(3)} 0 0 ${hp.toFixed(3)} 0 0 cm\n/${name} Do\nQ`;
    obj(page,`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${wp.toFixed(3)} ${hp.toFixed(3)}] /Resources << /XObject << /${name} ${image} 0 R >> >> /Contents ${content} 0 R >>`);
    obj(image,`<< /Type /XObject /Subtype /Image /Width ${imgW} /Height ${imgH} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${img.length} >>`,img);
    obj(content,`<< /Length ${stream.length} >>`,enc.encode(stream));
  });
  const xref=length; add(`xref\n0 ${n+1}\n0000000000 65535 f \n`); for(let i=1;i<=n;i++) add(`${String(offsets[i]).padStart(10,'0')} 00000 n \n`); add(`trailer\n<< /Size ${n+1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`);
  const total=chunks.reduce((s,c)=>s+c.length,0), out=new Uint8Array(total); let p=0; chunks.forEach(c=>{out.set(c,p);p+=c.length}); return out;
}

updateCount();
