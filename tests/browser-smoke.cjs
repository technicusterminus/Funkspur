// Optional end-to-end test against Chromium. Requires Playwright for Node.
const {test} = require('node:test');
const assert = require('node:assert/strict');
const {spawn} = require('node:child_process');
const {chromium} = require('playwright');
const {createInterface} = require('node:readline');
const path = require('node:path');

test('browser scan, filtering, heatmap and project export', {timeout: 35000}, async t => {
  const project = path.join(__dirname,'..');
  const server = spawn(process.env.PYTHON || 'python3',['-u','-c',[
    'from runpy import run_path',
    'from run_funkspur import FunkspurServer',
    'fixture = run_path("tests/test_live_scan.py")["FixtureAdapter"]()',
    'with FunkspurServer(0, fixture) as server:',
    '    print(server.origin, flush=True)',
    '    server.serve_forever()',
  ].join('\n')],{cwd:project,stdio:['ignore','pipe','inherit']});
  t.after(()=>server.kill());
  const origin = await new Promise((resolve,reject)=>{
    const rl=createInterface({input:server.stdout});
    rl.once('line',resolve);
    server.once('error',reject);
    server.once('exit',code=>reject(new Error('Fixture server exited '+code)));
  });
  const browser = await chromium.launch({executablePath:process.env.CHROMIUM_PATH || undefined,headless:true});
  t.after(()=>browser.close());
  const page=await browser.newPage({viewport:{width:1440,height:1040}});
  const errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  page.on('console',m=>{
    if(m.type()==='error' && /content security policy/i.test(m.text()))errors.push(m.text());
  });
  await page.goto(origin);
  await page.getByText('Live-Scan bereit.').waitFor();
  await page.getByRole('tab',{name:'Live-Umgebung'}).click();
  await page.getByRole('button',{name:'Jetzt scannen'}).click();
  await page.getByText('3 WLAN-Radios in diesem Scan empfangen.').waitFor();
  assert.equal(await page.locator('#live-count').textContent(),'3 / 3');
  await page.getByLabel('Frequenzband').selectOption('5 GHz');
  assert.equal(await page.locator('#live-count').textContent(),'2 / 3');
  assert.equal(await page.locator('#live-channels meter').count(),2);
  await page.getByRole('button',{name:'Verfolgen: Example Lab · 02:00:00:00:00:01',exact:true}).click();
  assert.equal(await page.locator('#live-chart circle').count(),1);
  await page.getByRole('button',{name:'Auto-Scan starten'}).click();
  await page.locator('#live-chart polyline').waitFor();
  await page.getByRole('tab',{name:'Site Survey'}).click();
  await page.getByRole('tab',{name:'Live-Umgebung'}).click();
  assert.equal(await page.getByRole('button',{name:'Auto-Scan starten'}).count(),1);
  await page.getByRole('button',{name:'Verlauf leeren'}).click();
  assert.equal(await page.locator('#live-chart svg').count(),0);
  assert.equal(await page.locator('#live-count').textContent(),'2 / 3');
  await page.getByRole('tab',{name:'Site Survey'}).click();
  await page.getByRole('button',{name:'Demo laden'}).click();
  await page.locator('#demo-notice').waitFor();
  assert.equal(await page.locator('#scan-start').isDisabled(),true);
  const png=await page.evaluate(()=>{
    const canvas=document.createElement('canvas');
    canvas.width=640;canvas.height=400;
    const g=canvas.getContext('2d');
    g.fillStyle='#ffffff';g.fillRect(0,0,640,400);
    return canvas.toDataURL().split(',')[1];
  });
  page.once('dialog',dialog=>dialog.accept());
  await page.locator('#plan').setInputFiles({name:'fixture-floor.png',mimeType:'image/png',buffer:Buffer.from(png,'base64')});
  await page.getByText('Grundriss geladen.').waitFor();
  const coords=page.locator('#point-form');
  await page.getByRole('button',{name:'Scan am Messort'}).click();
  await page.getByText('X muss zwischen').waitFor();
  for (const [x,y] of [[22,24],[52,24],[31,63]]) {
    await coords.getByLabel('X %').fill(String(x));
    await coords.getByLabel('Y %').fill(String(y));
    await page.getByRole('button',{name:'Scan am Messort'}).click();
    await page.getByText('Scan abgeschlossen.').waitFor();
    await page.locator('#scan-filter').fill('Example Lab');
    assert.equal(await page.locator('#scan-radios input').count(),2);
    await page.getByRole('button',{name:'Sichtbare wählen'}).click();
    await page.getByRole('button',{name:'Auswahl speichern'}).click();
    await page.getByText('2 echte RSSI-Messwerte gespeichert.').waitFor();
  }
  await page.locator('#series').selectOption({label:'Example Lab · 5 GHz · stärkstes gemessenes Radio'});
  assert.equal(await page.locator('#count').textContent(),'3');
  assert.match(await page.locator('#median').textContent(),/-53/);
  await page.locator('#radius').fill('100');
  await page.locator('#radius').press('Tab');
  await page.getByText('Farbflächen sind Schätzwerte.').waitFor();
  const color=await page.locator('#map').evaluate(canvas=>[...canvas.getContext('2d').getImageData(220,128,1,1).data]);
  assert.ok(color[1]>color[0] && color[0]<240, 'interpolated overlay is drawn');
  const [dl] = await Promise.all([page.waitForEvent('download'),page.getByRole('button',{name:'Projekt speichern'}).click()]);
  const saved=JSON.parse(require('node:fs').readFileSync(await dl.path(),'utf8'));
  assert.equal(saved.points.length,6);
  assert.ok(saved.points.every(p=>p.source==='test-fixture' && p.observed_at));
  assert.ok(saved.points.every(p=>p.ssid==='Example Lab'));
  const [csv] = await Promise.all([page.waitForEvent('download'),page.getByRole('button',{name:'CSV exportieren'}).click()]);
  assert.match(require('node:fs').readFileSync(await csv.path(),'utf8'),/observed_at,source/);
  assert.deepEqual(errors,[]);
});
