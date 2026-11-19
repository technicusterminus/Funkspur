const {test}=require('node:test');
const assert=require('node:assert/strict');
const M=require('../live-model.js');

const wifi=(id,props={})=>({ssid:'Lab',bssid:'02:00:00:00:00:'+id,band:'5 GHz',channel:36,
  rssi_dbm:-60,observed_at:'2026-11-19T10:45:00.000Z',...props});
const scan=(radios,at=10)=>M.snapshot({source:'test-fixture',radios},at);
test('latest observation wins duplicate BSSIDs and radios are sorted by RSSI',()=>{
  const x=scan([wifi('01'),wifi('01',{rssi_dbm:-83,channel:40,observed_at:'2026-11-19T10:45:01.000Z'}),
    wifi('02',{bssid:'junk'}),wifi('03',{band:'6 GHz',rssi_dbm:-74}),wifi('04',{rssi_dbm:-122})]);
  assert.deepEqual(x.radios.map(p=>[p.bssid.slice(-2),p.rssi_dbm,p.channel]),[['03',-74,36],['01',-83,40],['04',-122,36]]);
});
test('live filters combine case-insensitive SSID or BSSID search and an exact band',()=>{
  const x=scan([wifi('01'),wifi('02',{ssid:'Other'}),wifi('01',{ssid:'Specific',band:'6 GHz'})]).radios;
  assert.equal(M.filter(x,'  laB ','5 GHz').length,1);
  assert.equal(M.filter(x,'00:01','').length,2);
  assert.equal(M.filter(x,'00:01','6 GHz')[0].ssid,'Specific');
});
test('channel counts are separated by band and ignore unknown channels',()=>{
  const x=scan([wifi('01'),wifi('02'),wifi('03',{band:'6 GHz'}),wifi('04',{channel:null}),wifi('05',{band:'Unbekannt'})]);
  assert.deepEqual(M.channels(x.radios),[{band:'5 GHz',counts:[[36,2]]},{band:'6 GHz',counts:[[36,1]]}]);
});
test('missing readings produce an actual gap and never get charted as zero',()=>{
  const first=scan([wifi('01'),wifi('02')],10);
  const history=[first,scan([wifi('02')],20),scan([wifi('01',{rssi_dbm:-75})],30)];
  const signal=M.trace(history,first.radios[0].id);
  assert.deepEqual(signal,[{at:10,dbm:-60},{at:20,dbm:null},{at:30,dbm:-75}]);
  assert.deepEqual(M.segments(signal),[[signal[0]],[signal[2]]]);
});
test('history is bounded and an empty scan is kept as missing observations',()=>{
  let history=[];
  for(let i=0;i<75;i++) history=M.historyWith(history,scan([],i));
  assert.equal(history.length,60);
  assert.equal(history[0].at,15);
  assert.deepEqual(M.segments(M.trace(history,'none')),[]);
});
