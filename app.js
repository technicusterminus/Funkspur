'use strict';
const S = window.Survey;
const $ = id => document.getElementById(id);
const form = $('point-form'), map = $('map'), ctx = map.getContext('2d');
const state = {name:'', image:null, data:'', points:[], scale:null, demo:false};
let editing = null, anchor = null, pins = null, raster = null, previousKey = '';
const num = (x, digits=1) => new Intl.NumberFormat('de-CH',{maximumFractionDigits:digits}).format(x);
const nameOf = p => (p.ssid || 'Ohne SSID') + ' · ' + p.band + ' · ' + (p.bssid || 'ohne BSSID');
const field = key => form.elements.namedItem(key);
const updateStatus = (message, error=false) => {
  $('status').textContent=message;
  $('status').toggleAttribute('data-error', error);
};
const handle = fn => async e => {
  try { await fn(e); }
  catch (error) { updateStatus(error.message || 'Vorgang fehlgeschlagen.',true); }
};
function decode(src) {
  return new Promise((resolve,reject) => {
    const image=new Image();
    image.onload=()=>resolve(image);
    image.onerror=()=>reject(new Error('Grundriss konnte nicht als Bild gelesen werden.'));
    image.src=src;
  });
}
function download(data, type, extension) {
  if (!data) throw new Error('Export konnte nicht erstellt werden.');
  const url=URL.createObjectURL(data instanceof Blob ? data : new Blob([data],{type}));
  const link=document.createElement('a');
  link.href=url;
  link.download=(state.name.replace(/[^\p{L}\d_-]+/gu,'-').replace(/^-+|-+$/g,'') || 'wlan-survey').slice(0,90) + extension;
  link.click();
  setTimeout(()=>URL.revokeObjectURL(url),8000);
}
function dataImage(image) {
  const scale=Math.min(1,2000/Math.max(image.width,image.height));
  const canvas=document.createElement('canvas');
  canvas.width=Math.max(1,Math.round(image.width*scale)); canvas.height=Math.max(1,Math.round(image.height*scale));
  canvas.getContext('2d').drawImage(image,0,0,canvas.width,canvas.height);
  return canvas.toDataURL('image/png');
}
function setProject(project, prefs={}) {
  Object.assign(state,project);
  map.width=state.image.width; map.height=state.image.height;
  $('threshold').value=prefs.threshold ?? -67;
  $('radius').value=prefs.radius ?? (state.scale ? 12 : 35);
  $('show-heat').checked=prefs.heat ?? true;
  previousKey=prefs.series ?? '';
  resetEdit(true);
  anchor=null; pins=null;
  refresh();
}
function canReplace() {
  return !state.image || window.confirm('Aktuelles Projekt im Browser ersetzen? Nicht exportierte Änderungen gehen verloren.');
}
function resetEdit(full=false) {
  editing=null;
  $('save-point').textContent='Messpunkt hinzufügen';
  $('cancel-edit').hidden=true;
  if (full) form.reset();
}
function activatePoint(i) {
  const p=state.points[i];
  for(const k of S.columns) field(k).value=p[k] ?? '';
  editing=i;
  $('save-point').textContent='Änderungen speichern';
  $('cancel-edit').hidden=false;
  field('rssi_dbm').focus();
  draw();
}
const groups = () => new Map(state.points.map(p=>[S.groupKey(p),nameOf(p)]));
const filtered = () => state.points.flatMap((p,i)=>S.groupKey(p)===$('series').value ? [{...p,i}] : []);
const palette = [[234,83,109],[240,154,85],[236,201,87],[59,200,153]];
const level = v => v < -75 ? 0 : v < -67 ? 1 : v < -55 ? 2 : 3;
function invalidate(){raster=null;}
function addHeat(points, radius) {
  const model=S.prepare(points,map.width,map.height,radius);
  if(model.polygon.length<3) return false;
  const overlay=document.createElement('canvas');
  const factor=Math.min(1,155/Math.max(map.width,map.height));
  overlay.width=Math.max(1,Math.round(map.width*factor));
  overlay.height=Math.max(1,Math.round(map.height*factor));
  const g=overlay.getContext('2d'), image=g.createImageData(overlay.width,overlay.height);
  let any=false;
  for(let y=0;y<overlay.height;y++) for(let x=0;x<overlay.width;x++) {
    const v=S.estimate(model,(x+0.5)*map.width/overlay.width,(y+0.5)*map.height/overlay.height);
    if(v===null) continue;
    const index=(y*overlay.width+x)*4;
    const [r,g,b]=palette[level(v)];
    image.data[index]=r; image.data[index+1]=g; image.data[index+2]=b; image.data[index+3]=126;
    any=true;
  }
  g.putImageData(image,0,0);
  raster=overlay;
  raster.any=any;
  return any;
}
function draw(points=filtered(), destination=ctx, exportImage=false) {
  if(!state.image) return;
  const {width:w,height:h}=map;
  destination.fillStyle='#eef2f5'; destination.fillRect(0,0,w,h);
  destination.drawImage(state.image,0,0,w,h);
  let hasHeat=false;
  const configured=$('radius').valueAsNumber;
  if($('show-heat').checked && Number.isFinite(configured) && configured>=.1 && configured<=1000 && points.length>=3) {
    const px=state.scale ? configured*state.scale.pixelsPerMeter : configured/100*Math.min(w,h);
    hasHeat=raster ? raster.any : addHeat(points,px);
    if(hasHeat) {
      destination.imageSmoothingEnabled=false;
      destination.drawImage(raster,0,0,w,h);
      destination.imageSmoothingEnabled=true;
    }
  }
  if(!exportImage) {
    $('map-note').textContent=hasHeat ? 'Farbflächen sind Schätzwerte. Ungefärbte Flächen sind nicht bewertet. Wände werden nicht modelliert.' :
      'Keine Heatmap sichtbar. Sie benötigt mindestens drei nicht kollineare Messorte innerhalb des Radius und bleibt auf die umschlossene Messfläche begrenzt.';
    if(!$('show-heat').checked) $('map-note').textContent='Heatmap ausgeblendet. Die Markierungen zeigen die tatsächlichen Messorte.';
  }
  const unit=Math.max(1,Math.max(w,h)/800);
  const pixel=p=>S.pixels(p,w,h);
  function dot(p,text,background,stroke='#0b1725') {
    const {x,y}=pixel(p), size=10*unit;
    destination.beginPath(); destination.arc(x,y,size,0,Math.PI*2);
    destination.fillStyle=background; destination.fill();
    destination.strokeStyle=stroke; destination.lineWidth=2*unit; destination.stroke();
    destination.fillStyle='#0b1725'; destination.textAlign='center'; destination.textBaseline='middle';
    destination.font='bold '+(Math.max(7, 12-Math.max(0,text.length-2)*2)*unit)+'px system-ui';
    destination.fillText(text,x,y);
  }
  for(const p of points) dot(p,String(p.i+1),'rgb('+palette[level(p.rssi_dbm)].join(',')+')',p.i===editing&&!exportImage?'#fff':'#0b1725');
  if(!exportImage && pins?.a) {
    dot(pins.a,'A','#82dfff');
    if(pins.b) dot(pins.b,'B','#82dfff');
  }
  if(!exportImage && anchor) dot(anchor,'+','#fff');
}
function refresh() {
  const all=groups();
  const selected=previousKey || $('series').value;
  const assign=(node,text)=>{node.textContent=text;return node;};
  $('series').replaceChildren(...[...all].map(([id,label])=>{
    const option=assign(document.createElement('option'),label);
    option.value=id; return option;
  }));
  if(all.has(selected)) $('series').value=selected;
  previousKey='';
  const points=filtered();
  const enabled=Boolean(state.image);
  map.hidden=!enabled; $('empty').hidden=enabled;
  $('project-title').textContent=state.name || 'Kein Grundriss geladen';
  $('demo-notice').hidden=!state.demo;
  for(const id of ['save-project','calibrate','save-point','load-csv','save-png']) $(id).disabled=!enabled;
  $('save-csv').disabled=state.points.length===0;
  $('series').disabled=all.size===0;
  $('count').textContent=String(points.length);
  const ordered=points.map(p=>p.rssi_dbm).sort((a,b)=>a-b);
  const mid=Math.floor(ordered.length/2);
  $('median').textContent=ordered.length ? num(ordered.length%2 ? ordered[mid] : (ordered[mid]+ordered[mid-1])/2)+' dBm' : '–';
  const target=$('threshold').valueAsNumber;
  const hits=points.filter(p=>p.rssi_dbm>=target).length;
  $('coverage').textContent=points.length&&$('threshold').validity.valid&&Number.isFinite(target) ? hits+' / '+points.length : '–';
  $('radius-label').textContent=state.scale ? 'Radius (m)' : 'Radius (% kurzer Seite)';
  $('scale').textContent=state.scale ? 'Massstab '+num(state.scale.pixelsPerMeter,2)+' px/m' : 'Kein Massstab gesetzt';
  $('calibrate').textContent=pins ? 'Kalibrierung abbrechen' : 'Massstab setzen';
  if(!points.length) {
    const tr=document.createElement('tr'), td=assign(document.createElement('td'),'Noch keine Messpunkte in dieser Ansicht.');
    td.colSpan=7; tr.append(td); $('points').replaceChildren(tr);
  } else {
    const rows=points.map(p=>{
      const tr=document.createElement('tr');
      for(const value of [p.i+1,num(p.x_pct,2)+' / '+num(p.y_pct,2),num(p.rssi_dbm)+' dBm',nameOf(p),p.channel??'–',p.note||'–'])
        tr.append(assign(document.createElement('td'),String(value)));
      const actions=document.createElement('td');
      for(const [label,fn] of [['Bearbeiten',()=>activatePoint(p.i)],['Löschen',()=>{
        state.points.splice(p.i,1); resetEdit(); anchor=null; refresh(); updateStatus('Messpunkt gelöscht.');
      }]]) {
        const button=assign(document.createElement('button'),label); button.type='button';
        button.onclick=fn; actions.append(button);
      }
      tr.append(actions);
      return tr;
    });
    $('points').replaceChildren(...rows);
  }
  invalidate(); draw(points);
}
form.addEventListener('submit',handle(e=>{
  e.preventDefault();
  if(!state.image) return;
  if(editing===null && state.points.length>=S.maxPoints) throw new Error('Messpunktlimit erreicht.');
  const p=S.measurement(Object.fromEntries(new FormData(form)));
  if(editing===null) state.points.push(p); else state.points[editing]=p;
  previousKey=S.groupKey(p);
  resetEdit(); anchor=null; field('rssi_dbm').value=''; field('note').value='';
  refresh(); updateStatus('Messpunkt gespeichert.');
}));
$('cancel-edit').onclick=()=>{resetEdit(true);anchor=null;draw();};
map.addEventListener('click',handle(e=>{
  const rect=map.getBoundingClientRect();
  const point={x_pct:Math.round(10000*(e.clientX-rect.left)/rect.width)/100,y_pct:Math.round(10000*(e.clientY-rect.top)/rect.height)/100};
  if(pins) {
    if(!pins.a){pins.a=point;updateStatus('Zweiten Kalibrierpunkt wählen.');draw();return;}
    pins.b=point;
    draw();
    const answer=window.prompt('Reale Distanz zwischen A und B in Metern','5');
    const old=state.scale;
    const pair=pins; pins=null;
    if(answer===null){refresh();updateStatus('Kalibrierung abgebrochen.');return;}
    try {state.scale=S.calibration({...pair,meters:answer.trim().replace(',','.')},map.width,map.height);}
    catch(error){refresh();throw error;}
    if(!old) $('radius').value=12;
    refresh();updateStatus('Massstab gespeichert.');return;
  }
  anchor=point; field('x_pct').value=point.x_pct;field('y_pct').value=point.y_pct;
  draw();field('rssi_dbm').focus({preventScroll:true});
}));
$('calibrate').onclick=()=>{
  if(pins){pins=null;updateStatus('Kalibrierung abgebrochen.');}
  else {pins={};anchor=null;updateStatus('Ersten Kalibrierpunkt im Grundriss wählen.');}
  refresh();
};
$('series').onchange=()=>{resetEdit();anchor=null;refresh();};
$('threshold').onchange=refresh;
$('radius').onchange=()=>{invalidate();draw();};
$('show-heat').onchange=()=>draw();
$('plan').onchange=handle(async e=>{
  const file=e.target.files[0];e.target.value='';
  if(!file || !canReplace()) return;
  if(!['image/png','image/jpeg','image/webp'].includes(file.type) || file.size>20_000_000)
    throw new Error('Bitte PNG, JPEG oder WebP bis 20 MB wählen.');
  const url=URL.createObjectURL(file);
  try {
    const data=dataImage(await decode(url));
    const image=await decode(data);
    setProject({name:file.name.replace(/\.[^.]+$/,''),image,data,points:[],scale:null,demo:false});
    updateStatus('Grundriss geladen. Einen Messpunkt im Plan auswählen.');
  } finally {URL.revokeObjectURL(url);}
});
$('load-project').onclick=()=>$('project-file').click();
$('project-file').onchange=handle(async e=>{
  const file=e.target.files[0];e.target.value='';
  if(!file || !canReplace()) return;
  if(file.size>25_000_000) throw new Error('Projektdatei überschreitet 25 MB.');
  const p=JSON.parse(await file.text());
  if(p?.version!==1 || typeof p.name!=='string' || p.name.length>255 || typeof p.image!=='string' ||
    !/^data:image\/png;base64,[a-z\d+/]+=*$/i.test(p.image) || !Array.isArray(p.points) || p.points.length>S.maxPoints)
    throw new Error('Ungültige Projektdatei oder nicht unterstützte Version.');
  const image=await decode(p.image);
  if(Math.max(image.width,image.height)>2000) throw new Error('Grundriss im Projekt überschreitet 2000 Pixel.');
  const points=p.points.map(S.measurement);
  const scale=p.scale ? S.calibration(p.scale,image.width,image.height) : null;
  const bounded=(n,lo,hi)=>typeof n==='number'&&Number.isFinite(n)&&n>=lo&&n<=hi ? n : undefined;
  setProject({name:p.name,image,data:p.image,points,scale,demo:p.demo===true},{
    threshold:bounded(p.view?.threshold,-127,0),radius:bounded(p.view?.radius,.1,1000),heat:p.view?.heat!==false,
    series:typeof p.view?.series==='string' ? p.view.series : ''
  });
  updateStatus('Projekt geöffnet.');
});
$('save-project').onclick=handle(()=>{
  const {name,data,points,scale,demo}=state;
  download(JSON.stringify({version:1,name,image:data,points,scale,demo,view:{
    threshold:$('threshold').valueAsNumber,radius:$('radius').valueAsNumber,heat:$('show-heat').checked,series:$('series').value
  }},null,2),'application/json','.survey.json');
  updateStatus('Projektdatei exportiert.');
});
$('load-csv').onclick=()=>$('csv-file').click();
$('csv-file').onchange=handle(async e=>{
  const file=e.target.files[0];e.target.value='';
  if(!file || !state.image)return;
  if(file.size>5_000_000)throw new Error('CSV-Datei überschreitet 5 MB.');
  const points=S.fromCsv(await file.text());
  if(state.points.length+points.length>S.maxPoints)throw new Error('Messpunktlimit erreicht.');
  state.points.push(...points);refresh();updateStatus(points.length+' Messpunkte importiert.');
});
$('save-csv').onclick=handle(()=>{download(S.toCsv(state.points),'text/csv;charset=utf-8','.csv');updateStatus('Alle Messpunkte als CSV exportiert.');});
$('save-png').onclick=handle(async()=>{
  const out=document.createElement('canvas'), points=filtered();
  const footerHeight=Math.max(100,Math.round(map.width*.145));
  out.width=Math.max(580,map.width);out.height=map.height+footerHeight;
  const g=out.getContext('2d');
  g.fillStyle='#101f30';g.fillRect(0,0,out.width,out.height);
  draw(points,g,true);
  g.fillStyle='#eff6ff';g.font='bold 17px system-ui';
  g.fillText((state.demo ? 'DEMO / SYNTHETISCHE MESSWERTE · ' : '')+state.name,13,map.height+23,out.width-26);
  g.font='13px system-ui';
  g.fillText((points[0] ? nameOf(points[0]) : 'Keine Messreihe')+' · '+points.length+' Messpunkte',13,map.height+43,out.width-26);
  let x=13;
  for(const [i,label] of ['< −75','−75 bis < −67','−67 bis < −55','≥ −55 dBm'].entries()) {
    g.fillStyle='rgb('+palette[i].join(',')+')';g.fillRect(x,map.height+54,10,10);
    g.fillStyle='#eff6ff';g.fillText(label,x+15,map.height+64);
    x+=g.measureText(label).width+31;
  }
  g.fillStyle='#afc1d2';g.fillText('Zwischenwerte geschätzt. Ungefärbt = nicht bewertet. Wände nicht modelliert.',13,map.height+84,out.width-26);
  const blob=await new Promise(resolve=>out.toBlob(resolve,'image/png'));
  download(blob,'image/png','.png');updateStatus('Aktuelle Kartenansicht als PNG exportiert.');
});
$('demo').onclick=handle(async()=>{
  if(!canReplace())return;
  const canvas=document.createElement('canvas');
  canvas.width=1000;canvas.height=610;
  const g=canvas.getContext('2d');
  g.fillStyle='#edf3f8';g.fillRect(0,0,1000,610);
  g.fillStyle='#d3e4e8';g.fillRect(65,246,870,125);
  g.strokeStyle='#344959';g.lineWidth=7;g.strokeRect(65,65,870,480);
  for(const line of [[65,246,200,246],[245,246,455,246],[500,246,745,246],[790,246,935,246],
    [330,65,330,246],[646,65,646,246],[65,371,218,371],[263,371,610,371],[655,371,935,371],[455,371,455,545]]) {
    g.beginPath();g.moveTo(line[0],line[1]);g.lineTo(line[2],line[3]);g.stroke();
  }
  g.fillStyle='#43576a';g.font='600 22px system-ui';
  for(const [name,x,y] of [['Empfang',130,110],['Teamraum',390,110],['Werkstatt',712,110],['Korridor',90,290],['Schulung',140,510],['Lager',600,510]])
    g.fillText(name,x,y);
  const data=canvas.toDataURL('image/png'), image=await decode(data);
  const points=[[14,24,-49],[30,20,-55],[49,23,-62],[69,22,-69],[86,25,-74],
    [13,55,-53],[29,55,-58],[49,52,-64],[70,51,-70],[88,55,-79],
    [17,78,-59],[34,78,-63],[53,78,-72],[71,78,-77],[88,78,-84]].map(([x,y,r])=>S.measurement({
    x_pct:x,y_pct:y,rssi_dbm:r,ssid:'Survey-Demo',band:'5 GHz',bssid:'02:00:00:00:00:01',channel:36,note:'Synthetischer Demowert'
  }));
  setProject({name:'Beispieletage',image,data,points,scale:null,demo:true},{radius:43});
  updateStatus('Demo geladen. Für eine echte Begehung einen eigenen Grundriss laden.');
});
refresh();
