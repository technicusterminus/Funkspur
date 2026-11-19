const {test} = require('node:test');
const assert = require('node:assert/strict');
const S = require('../survey.js');
const point = (x,y,r,extra={})=>S.measurement({x_pct:x,y_pct:y,rssi_dbm:r,...extra});
test('validates coordinates, RSSI, channel, and BSSID',()=>{
  for(const args of [[null,23,-72],['',4,-66],[-2,3,-50],[2,101,-65],[3,4,'50%'],[3,4,-128],[3,4,1]])
    assert.throws(()=>point(...args));
  assert.throws(()=>point(2,3,-60,{channel:6.1}));
  assert.throws(()=>point(2,3,-60,{bssid:'junk'}));
  assert.equal(point(2,3,-60,{bssid:'AA:BB:CC:DD:EE:FF'}).bssid,'aa:bb:cc:dd:ee:ff');
});
test('round trips quoted and multiline CSV without emitting formulas',()=>{
  const points=[point(3,4,-57,{ssid:'  =1+1',note:'"A, B"\nzweite Zeile'}),point(13,45,-62,{ssid:"'quotes",note:'@not-a-formula'})];
  const csv=S.toCsv(points);
  assert.match(csv,/"'  =1\+1"/);
  assert.deepEqual(S.fromCsv(csv),points);
  assert.equal(S.fromCsv('\ufeffx_pct,y_pct,rssi_dbm\n1,2,-70\n')[0].band,'Unbekannt');
  assert.throws(()=>S.fromCsv('x_pct,y_pct,rssi_dbm\n1,,−5'));
  assert.throws(()=>S.fromCsv('x_pct,y_pct,rssi_dbm,x_pct\n1,2,-60,3'));
});
test('does not mix bands or BSSIDs into one radio series',()=>{
  const p=point(0,0,-50,{ssid:'Example',band:'5 GHz',bssid:'aa:bb:cc:dd:ee:01'});
  assert.notEqual(S.groupKey(p), S.groupKey({...p,bssid:'aa:bb:cc:dd:ee:02'}));
  assert.notEqual(S.groupKey(p), S.groupKey({...p,band:'6 GHz'}));
});
test('uses actual pixel distance to calibrate non-square plans',()=>{
  assert.equal(S.calibration({a:{x_pct:10,y_pct:10},b:{x_pct:30,y_pct:50},meters:5},100,50).pixelsPerMeter,Math.sqrt(800)/5);
  assert.throws(()=>S.calibration({a:{x_pct:0,y_pct:0},b:{x_pct:0,y_pct:0},meters:5},100,50));
});
test('IDW stays within hull and requires three unique nearby locations',()=>{
  const points=[point(0,0,-50),point(100,0,-65),point(0,100,-80)];
  const model=S.prepare(points,100,100,160);
  assert.equal(S.estimate(model,25,25),(-50*5-65-80)/7);
  assert.equal(S.estimate(model,0,0),-50);
  assert.equal(S.estimate(model,90,90),null);
  assert.equal(S.estimate(S.prepare(points,100,100,40),25,25),null);
  assert.equal(S.estimate(S.prepare([points[0],points[1],points[0]],100,100,160),10,0),null);
});
test('averages repeated readings at exactly the same site',()=>{
  const model=S.prepare([point(0,0,-50),point(100,0,-65),point(0,100,-80),point(0,0,-60)],100,100,160);
  assert.equal(S.estimate(model,0,0),-55);
});
test('best AP view selects one actual reading per exact position, SSID and band',()=>{
  const a={ssid:'Lab',band:'5 GHz',bssid:'02:00:00:00:00:01'};
  const b={...a,bssid:'02:00:00:00:00:02'};
  const readings=[point(10,20,-70,a),point(10,20,-59,b),point(11,20,-64,a),
    point(10,20,-50,{...b,band:'6 GHz'}),point(10,20,-34,{...b,bssid:''})];
  assert.deepEqual(S.strongestAtLocations(readings,S.bestKey(a)).map(x=>[x.i,x.rssi_dbm]),[[1,-59],[2,-64]]);
});
test('keeps true measurement provenance in CSV and rejects malformed timestamps',()=>{
  const measure=point(10,15,-59,{source:'windows-wlanapi',observed_at:'2026-11-19T08:51:00.000Z'});
  assert.deepEqual(S.fromCsv(S.toCsv([measure])),[measure]);
  assert.throws(()=>point(10,15,-59,{observed_at:'2026-11-31T08:51:00.000Z'}));
  assert.throws(()=>point(10,15,-59,{source:'=not a source'}));
});
