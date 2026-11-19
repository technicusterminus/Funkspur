/* Live view. The local WLAN scanner is shared with the Site Survey. */
(function (M) {
  'use strict';
  const el=id=>document.getElementById(id);
  const scanDelay=12_000;
  const clock=new Intl.DateTimeFormat('de-CH',{hour:'2-digit',minute:'2-digit',second:'2-digit'});
  const dbm=value=>new Intl.NumberFormat('de-CH',{maximumFractionDigits:1}).format(value)+' dBm';
  let active=false, automatic=false, timer=null, generation=0, latest=null, history=[];
  const tracked=new Map();

  const html=(name,value)=>{const node=document.createElement(name);if(value!=null)node.textContent=value;return node;};
  function message(text, error=false) {
    el('live-status').textContent=text;
    el('live-status').toggleAttribute('data-error',error);
  }
  function scannerChanged() {
    const ready=scannerAvailable();
    el('live-scan').disabled=!active||!ready||scanBusy||automatic;
    el('live-auto').disabled=!active||(!automatic&&(!ready||scanBusy));
    el('live-auto').textContent=automatic?'Auto-Scan stoppen':'Auto-Scan starten';
    el('live-auto').setAttribute('aria-pressed',String(automatic));
    el('live-clear').disabled=history.length===0;
  }
  function pause(reason) {
    const wasRunning=automatic;
    automatic=false;
    if(timer!==null)clearTimeout(timer);
    timer=null;
    scannerChanged();
    if(wasRunning)message(reason||'Auto-Scan gestoppt. Der letzte erfolgreiche Scan bleibt sichtbar.');
  }
  function showView(live, focus=false) {
    active=live;
    for(const [id,on] of [['survey',!live],['live',live]]) {
      const tab=el(id+'-tab');
      el(id+'-pane').hidden=!on;
      tab.setAttribute('aria-selected',String(on));
      tab.tabIndex=on?0:-1;
      if(on&&focus)tab.focus();
    }
    if(!active) pause('Auto-Scan beim Ansichtswechsel gestoppt.');
    scannerChanged();
  }
  function adapterChanged() {
    const hasData=latest!==null || tracked.size>0;
    pause();
    generation++;
    latest=null;
    history=[];
    tracked.clear();
    if(hasData) message('Adapter gewechselt. Für vergleichbare RSSI-Werte beginnt ein neuer Verlauf.');
    render();
  }
  function deleteTrack(id) {
    tracked.delete(id);
    render();
  }
  function track(row) {
    if(tracked.has(row.id)) deleteTrack(row.id);
    else if(tracked.size<M.trackLimit) {
      const occupied=new Set([...tracked.values()].map(p=>p.color));
      let color=0;
      while(occupied.has(color))color++;
      tracked.set(row.id,{row,color});
      render();
    }
  }
  function renderTable(rows) {
    const tbody=el('live-rows');
    const focus=document.activeElement?.dataset?.radioKey;
    const buttons=new Map();
    const visible=rows.map(row=>{
      const tr=html('tr'), control=html('td');
      const on=tracked.has(row.id);
      const name=(row.ssid||'Versteckte SSID')+' · '+row.bssid;
      const button=html('button',on?'Verfolgt':'Verfolgen');
      button.type='button';
      button.setAttribute('aria-label',(on?'Nicht mehr verfolgen: ':'Verfolgen: ')+name);
      button.setAttribute('aria-pressed',String(on));
      button.dataset.radioKey=row.id;
      button.disabled=!on&&tracked.size>=M.trackLimit;
      button.onclick=()=>track(row);
      buttons.set(row.id,button);
      control.append(button);
      tr.append(control);
      for(const value of [row.ssid||'(versteckt)',row.bssid,row.band,row.channel??'–',dbm(row.rssi_dbm)])
        tr.append(html('td',String(value)));
      return tr;
    });
    if(!visible.length) {
      const tr=html('tr'), td=html('td',!latest?'Nach dem ersten Scan erscheinen hier die empfangenen WLAN-Radios.':
        latest.radios.length?'Keine Radios entsprechen dem Filter.':'Keine frischen dBm-Messwerte in diesem Scan.');
      td.colSpan=6;tr.append(td);visible.push(tr);
    }
    tbody.replaceChildren(...visible);
    if(focus) buttons.get(focus)?.focus({preventScroll:true});
  }
  function renderChannels(rows) {
    const wrapper=el('live-channels'), groups=M.channels(rows);
    if(!groups.length) {
      const empty=html('p','Keine Radios mit bekanntem Kanal im aktuellen Filter.');
      empty.className='help';wrapper.replaceChildren(empty);return;
    }
    wrapper.replaceChildren(...groups.map(({band,counts})=>{
      const group=html('div'), items=html('div'), max=Math.max(...counts.map(([,n])=>n));
      group.className='channel-group';items.className='channel-items';
      group.append(html('h3',band),items);
      for(const [channel,count] of counts) {
        const line=html('div'), name=html('span','Kanal '+channel), meter=html('meter'), total=html('strong',String(count));
        meter.max=max;meter.value=count;meter.setAttribute('aria-label',band+', Kanal '+channel+': '+count+' BSSIDs');
        line.className='channel-row';line.append(name,meter,total);items.append(line);
      }
      return group;
    }));
  }
  const svg=(tag,attrs={},label)=>{
    const node=document.createElementNS('http://www.w3.org/2000/svg',tag);
    for(const [k,v] of Object.entries(attrs))node.setAttribute(k,String(v));
    if(label!=null)node.textContent=label;
    return node;
  };
  function renderHistory() {
    el('live-legend').replaceChildren(...[...tracked].map(([id,{row,color}])=>{
      const button=html('button',(row.ssid||'(versteckt)')+' · '+row.band+' · '+row.bssid+' ×');
      button.type='button';button.dataset.color=String(color);
      button.setAttribute('aria-label','Aus Verlauf entfernen: '+(row.ssid||'Versteckte SSID')+' '+row.bssid);
      button.onclick=()=>deleteTrack(id);
      return button;
    }));
    const wrapper=el('live-chart');
    const lines=[...tracked].map(([id,{color}])=>({color,paths:M.segments(M.trace(history,id))}));
    const values=lines.flatMap(({paths})=>paths.flatMap(path=>path.map(p=>p.dbm)));
    if(!values.length) {
      const empty=html('p',tracked.size?'Keine Messwerte für die gewählten Radios im aktuellen Verlauf.':'Wähle in der Tabelle „Verfolgen“, um den RSSI-Verlauf anzuzeigen.');
      empty.className='help';wrapper.replaceChildren(empty);return;
    }
    const left=57,right=585,top=16,bottom=185;
    const lo=Math.min(-90,Math.floor(Math.min(...values)/10)*10), hi=Math.max(-30,Math.ceil(Math.max(...values)/10)*10);
    const minT=history[0].at,maxT=history.at(-1).at;
    const x=t=>history.length===1?(left+right)/2:left+(t-minT)/Math.max(1,maxT-minT)*(right-left);
    const y=r=>bottom-(r-lo)/(hi-lo)*(bottom-top);
    const chart=svg('svg',{viewBox:'0 0 603 223',role:'img','aria-label':'RSSI in dBm über die Zeit, mit Lücken für nicht empfangene WLAN-Radios'});
    const stride=hi-lo>80?20:10;
    for(let value=lo;value<=hi;value+=stride) {
      chart.append(svg('line',{x1:left,y1:y(value),x2:right,y2:y(value),class:'signal-grid'}),
        svg('text',{x:left-7,y:y(value)+4,'text-anchor':'end'},String(value)));
    }
    chart.append(svg('text',{x:4,y:11,class:'signal-unit'},'dBm'));
    for(const [at,anchor] of history.length===1?[[minT,'middle']]:[[minT,'start'],[maxT,'end']])
      chart.append(svg('text',{x:x(at),y:208,'text-anchor':anchor},clock.format(at)));
    for(const {color,paths} of lines) {
      const group=svg('g',{'data-color':color});
      for(const path of paths) {
        if(path.length>1) group.append(svg('polyline',{points:path.map(p=>x(p.at)+','+y(p.dbm)).join(' ')}));
        for(const p of path) group.append(svg('circle',{cx:x(p.at),cy:y(p.dbm),r:3.1}));
      }
      chart.append(group);
    }
    wrapper.replaceChildren(chart);
  }
  function render() {
    const rows=M.filter(latest?.radios||[],el('live-filter').value,el('live-band').value);
    el('live-count').textContent=latest?rows.length+' / '+latest.radios.length:'–';
    el('live-strongest').textContent=rows.length?dbm(rows[0].rssi_dbm):'–';
    el('live-time').textContent=latest?clock.format(latest.at):'–';
    renderTable(rows);
    renderChannels(rows);
    renderHistory();
    scannerChanged();
  }
  async function scan() {
    if(!active||scanBusy||!scannerAvailable()) return;
    const current=generation;
    message('WLAN-Scan läuft …');
    try {
      const result=await runAdapterScan();
      if(current!==generation||!active) return;
      latest=M.snapshot(result);
      history=M.historyWith(history,latest);
      render();
      const count=latest.radios.length;
      message((count?count+' WLAN-Radios in diesem Scan empfangen.':'Keine frischen dBm-Messwerte in diesem Scan.')+
        (automatic?' Nächster Scan in etwa 12 Sekunden.':''));
    } catch(error) {
      pause();
      message(error.message+' Der letzte erfolgreiche Scan bleibt sichtbar, falls vorhanden.',true);
    } finally {
      if(automatic&&active&&current===generation) {
        timer=setTimeout(()=>{timer=null;scan();},scanDelay);
      }
      scannerChanged();
    }
  }
  el('survey-tab').onclick=()=>showView(false);
  el('live-tab').onclick=()=>showView(true);
  el('view-tabs').onkeydown=e=>{
    if(['ArrowRight','ArrowLeft','Home','End'].includes(e.key)) {
      e.preventDefault();
      showView(e.key==='End'||(e.key!=='Home'&&!active),true);
    }
  };
  el('live-scan').onclick=scan;
  el('live-auto').onclick=()=>{
    if(automatic) pause();
    else if(active&&scannerAvailable()&&!scanBusy) {
      automatic=true;
      scannerChanged();
      return scan();
    }
  };
  el('live-filter').oninput=render;
  el('live-band').onchange=render;
  el('live-clear').onclick=()=>{history=[];render();message('Verlauf geleert. Die aktuelle Scanliste bleibt sichtbar.');};
  document.addEventListener('visibilitychange',()=>{
    if(document.hidden)pause('Auto-Scan beim Wechsel in den Hintergrund gestoppt.');
  });
  window.FunkspurLive={scannerChanged,pause,adapterChanged};
  render();
})(window.LiveModel);
