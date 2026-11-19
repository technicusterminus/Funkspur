/* Data shaping for the transient Live-Umgebung view. */
(function (root, build) {
  if (typeof module === 'object' && module.exports) module.exports = build(require('./survey.js'));
  else root.LiveModel = build(root.Survey);
})(globalThis, function (S) {
  'use strict';
  const historyLimit=60, trackLimit=4;
  const key = p => JSON.stringify([p.band,p.bssid]);
  function snapshot(result, at=Date.now()) {
    const radios=new Map();
    for(const raw of result.radios || []) {
      try {
        const p=S.measurement({...raw,x_pct:0,y_pct:0,source:result.source});
        if(!p.bssid) continue;
        const id=key(p), old=radios.get(id);
        const {ssid,bssid,band,channel,rssi_dbm,observed_at}=p;
        if(!old || observed_at>old.observed_at || (observed_at===old.observed_at && rssi_dbm>old.rssi_dbm))
          radios.set(id,{id,ssid,bssid,band,channel,rssi_dbm,observed_at});
      } catch { /* Ignore malformed driver entries. */ }
    }
    return {at, radios:[...radios.values()].sort((a,b)=>b.rssi_dbm-a.rssi_dbm || a.bssid.localeCompare(b.bssid))};
  }
  const filter = (rows, text='', band='') => {
    const query=text.trim().toLowerCase();
    return rows.filter(row=>(!band||row.band===band) && (row.ssid+' '+row.bssid).toLowerCase().includes(query));
  };
  function channels(rows) {
    const bands=new Map();
    for(const row of rows) {
      if(row.channel===null || row.band==='Unbekannt') continue;
      if(!bands.has(row.band)) bands.set(row.band,new Map());
      const band=bands.get(row.band);
      band.set(row.channel,(band.get(row.channel)||0)+1);
    }
    return S.bands.flatMap(band=>bands.has(band) ? [{band,counts:[...bands.get(band)].sort((a,b)=>a[0]-b[0])}] : []);
  }
  function historyWith(history, scan) {
    return [...history,scan].slice(-historyLimit);
  }
  function trace(history,id) {
    return history.map(scan=>({at:scan.at, dbm:scan.radios.find(row=>row.id===id)?.rssi_dbm ?? null}));
  }
  function segments(samples) {
    const paths=[];
    let current=[];
    for(const sample of samples) {
      if(sample.dbm===null) {
        if(current.length) paths.push(current);
        current=[];
      } else current.push(sample);
    }
    if(current.length)paths.push(current);
    return paths;
  }
  return {snapshot,filter,channels,historyWith,trace,segments,historyLimit,trackLimit};
});
