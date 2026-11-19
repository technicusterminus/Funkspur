/* Browser and Node share the same validation and interpolation code. */
(function (root, build) {
  if (typeof module === 'object' && module.exports) module.exports = build();
  else root.Survey = build();
})(globalThis, function () {
  'use strict';
  const columns = ['x_pct','y_pct','rssi_dbm','ssid','band','bssid','channel','note','observed_at','source'];
  const bands = ['2.4 GHz','5 GHz','6 GHz','Unbekannt'];
  const maxPoints = 5000;
  const bounded = (value, min, max, label) => {
    const n = typeof value === 'number' ? value :
      typeof value === 'string' && value.trim() && /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(value.trim()) ? Number(value) : NaN;
    if (!Number.isFinite(n) || n < min || n > max) throw new Error(label + ' muss zwischen ' + min + ' und ' + max + ' liegen.');
    return n;
  };
  function measurement(raw) {
    if (!raw || typeof raw !== 'object') throw new Error('Ungültiger Messpunkt.');
    const string = (key, max) => {
      const v = raw[key] ?? '';
      if (typeof v !== 'string' || v.length > max) throw new Error(key + ' ist zu lang oder kein Text.');
      return v;
    };
    const band = string('band', 12) || 'Unbekannt';
    if (!bands.includes(band)) throw new Error('Unbekanntes Frequenzband.');
    const bssid = string('bssid', 17).toLowerCase();
    if (bssid && !/^(?:[a-f\d]{2}:){5}[a-f\d]{2}$/.test(bssid)) throw new Error('BSSID muss wie aa:bb:cc:dd:ee:ff aussehen.');
    const channel = raw.channel === '' || raw.channel == null ? null : bounded(raw.channel, 1, 233, 'Kanal');
    if (channel !== null && !Number.isInteger(channel)) throw new Error('Kanal muss ganzzahlig sein.');
    const observed_at = string('observed_at', 24), source = string('source', 40);
    if (observed_at && (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(observed_at) ||
        !Number.isFinite(Date.parse(observed_at)) || new Date(observed_at).toISOString() !== observed_at))
      throw new Error('Zeitstempel muss UTC im Format ISO 8601 mit Millisekunden sein.');
    if (source && !/^[a-z][a-z0-9-]*$/.test(source)) throw new Error('Ungültige Messquelle.');
    return {...coordinates(raw), rssi_dbm:bounded(raw.rssi_dbm,-127,0,'RSSI'),
      ssid:string('ssid',100),band,bssid,channel,note:string('note',500),observed_at,source};
  }
  const coordinates = p => ({x_pct:bounded(p.x_pct,0,100,'X'),y_pct:bounded(p.y_pct,0,100,'Y')});
  const groupKey = p => JSON.stringify([p.ssid,p.band,p.bssid]);
  const bestKey = p => 'best:' + JSON.stringify([p.ssid,p.band]);
  function strongestAtLocations(points, key) {
    const byPosition = new Map();
    points.forEach((p,i) => {
      if (!p.bssid || bestKey(p) !== key) return;
      const pos = JSON.stringify([p.x_pct,p.y_pct]);
      if (!byPosition.has(pos) || p.rssi_dbm > byPosition.get(pos).rssi_dbm) byPosition.set(pos, {...p,i});
    });
    return [...byPosition.values()];
  }
  const formula = /^[\s\uFEFF]*[=+@-]|^[\t\r\n]/u;
  const guard = s => s.startsWith("'") || formula.test(s) ? "'" + s : s;
  const unguard = s => s.startsWith("''") || (s.startsWith("'") && formula.test(s.slice(1))) ? s.slice(1) : s;
  function toCsv(points) {
    const quote = v => '"' + String(v ?? '').replace(/"/g, '""') + '"';
    return [columns.join(','), ...points.map(p => columns.map(k => quote(
      typeof p[k] === 'string' ? guard(p[k]) : p[k]
    )).join(','))].join('\r\n') + '\r\n';
  }
  function csvRows(text) {
    const rows = [];
    let row = [], field = '', inQuote = false, closed = false;
    const cell = () => { row.push(field); field = ''; closed = false; };
    const line = () => { cell(); if (row.some(v => v !== '')) rows.push(row); row = []; };
    const input = text.replace(/^\uFEFF/, '');
    for (let i=0; i<input.length; i++) {
      const c = input[i];
      if (inQuote) {
        if (c === '"') {
          if (input[i+1] === '"') { field += '"'; i++; }
          else { inQuote = false; closed = true; }
        } else field += c;
      } else if (c === ',') cell();
      else if (c === '\r' || c === '\n') {
        if (c === '\r' && input[i+1] === '\n') i++;
        line();
      } else if (closed || (c === '"' && field)) throw new Error('Fehlerhafte CSV-Anführungszeichen.');
      else if (c === '"') inQuote = true;
      else field += c;
    }
    if (inQuote) throw new Error('Offenes CSV-Anführungszeichen.');
    if (row.length || field || closed) line();
    return rows;
  }
  function fromCsv(text) {
    const [header,...rows] = csvRows(text);
    if (!header || new Set(header).size !== header.length || !columns.slice(0,3).every(k=>header.includes(k)))
      throw new Error('CSV braucht die Spalten x_pct, y_pct und rssi_dbm. Trennzeichen: Komma.');
    if (rows.length > maxPoints) throw new Error('Zu viele Messpunkte.');
    return rows.map((row,i) => {
      try {
        if (row.length !== header.length) throw new Error('Falsche Anzahl Spalten.');
        const raw = Object.fromEntries(header.map((k,j)=>[k, ['ssid','note'].includes(k) ? unguard(row[j]) : row[j]]));
        return measurement(raw);
      } catch (error) { throw new Error('CSV-Datensatz ' + (i+1) + ': ' + error.message); }
    });
  }
  const pixels = (p,w,h) => ({x:p.x_pct*w/100,y:p.y_pct*h/100});
  const distance = (a,b) => Math.hypot(a.x-b.x,a.y-b.y);
  function calibration(raw,w,h) {
    const point = p => ({x_pct:bounded(p?.x_pct,0,100,'X'),y_pct:bounded(p?.y_pct,0,100,'Y')});
    const a = point(raw?.a), b = point(raw?.b), meters = bounded(raw?.meters,0.01,10000,'Distanz in Metern');
    const px = distance(pixels(a,w,h), pixels(b,w,h));
    if (px < 2) throw new Error('Kalibrierpunkte liegen zu nah beieinander.');
    return {a,b,meters,pixelsPerMeter:px/meters};
  }
  const cross = (a,b,c) => (b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x);
  function hull(points) {
    const sorted = [...points].sort((a,b)=>a.x-b.x || a.y-b.y);
    const half = s => {
      const stack = [];
      for (const p of s) {
        while (stack.length >= 2 && cross(stack.at(-2),stack.at(-1),p) <= 0) stack.pop();
        stack.push(p);
      }
      return stack.slice(0,-1);
    };
    return [...half(sorted),...half(sorted.reverse())];
  }
  function prepare(points,w,h,radius) {
    const locations = new Map();
    const bins = new Map();
    const key = (x,y)=>x+','+y;
    for (const p of points) {
      const id = key(p.x_pct,p.y_pct);
      const entry = locations.get(id) || {...pixels(p,w,h), sum:0, count:0};
      entry.sum += p.rssi_dbm; entry.count++; locations.set(id,entry);
    }
    for (const p of locations.values()) {
      const id = key(Math.floor(p.x/radius),Math.floor(p.y/radius));
      if (!bins.has(id)) bins.set(id,[]);
      bins.get(id).push(p);
    }
    return {polygon:hull(locations.values()),bins,key,radius};
  }
  function estimate(model,x,y) {
    const {polygon,bins,key,radius} = model;
    if (polygon.length < 3 || polygon.some((p,i)=>cross(p,polygon[(i+1)%polygon.length],{x,y}) < -1e-7)) return null;
    const gx = Math.floor(x/radius), gy = Math.floor(y/radius);
    let weight=0, sum=0, count=0, exact=null;
    for(let j=gy-1;j<=gy+1;j++) for(let i=gx-1;i<=gx+1;i++) for(const p of bins.get(key(i,j)) || []) {
      const d2=(p.x-x)**2+(p.y-y)**2;
      if (d2>radius**2) continue;
      count++;
      if (d2<1e-10) exact=p.sum/p.count;
      const f=1/Math.max(d2,1e-10);
      weight+=f; sum+=f*p.sum/p.count;
    }
    return count<3 ? null : exact ?? sum/weight;
  }
  return {measurement,coordinates,calibration,groupKey,bestKey,strongestAtLocations,fromCsv,toCsv,pixels,prepare,estimate,columns,bands,maxPoints,guard};
});
