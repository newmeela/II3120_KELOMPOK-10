// Integration test. Requires Playwright and Chromium. Run against a fresh test database.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const {chromium, request} = require('playwright');

const url = process.env.TAPRENT_TEST_URL || 'http://127.0.0.1:8000';
const trace = [];
async function run() {
  const browser = await chromium.launch({executablePath: process.env.CHROMIUM_PATH || undefined, args:['--no-sandbox']});
  const page = await browser.newPage({viewport:{width:1280,height:860}});
  const clients = {};
  async function clientFor(base, username) {
    const key = base + username;
    if (!clients[key]) {
      const client = await request.newContext({baseURL:base});
      const response = await client.post('/api/auth/login', {data:{username,password:'kata-sandi-uji'}});
      assert.equal(response.status(), 200);
      clients[key] = client;
    }
    return clients[key];
  }
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('response', async response => {
    if (!response.url().includes('/api/') || response.url().includes('/api/auth/')) return;
    try {
      trace.push({method:response.request().method(), path:new URL(response.url()).pathname + new URL(response.url()).search,
        input:response.request().postDataJSON(), status:response.status(), actual:await response.json()});
    } catch { /* A closing page can abandon an in-flight background request. */ }
  });
  const click = name => page.getByRole('button', {name,exact:true}).click();
  const fill = (name,value) => page.getByLabel(name,{exact:true}).fill(value);
  const shot = name => page.screenshot({path:'tests/evidence/' + name + '.png',fullPage:true});
  const read = async (path, method='GET', data, headers={}, role='penyewa') => {
    const base = new URL(path,url).origin;
    const client = await clientFor(base, role);
    const response = await client.fetch(path.startsWith('http') ? path : url+path,
      {method,data,headers});
    const actual = await response.json();
    trace.push({method,path:new URL(path,url).pathname + new URL(path,url).search,input:data,status:response.status(),actual});
    return {status:response.status(), actual};
  };
  const post = (path,data,role='penyewa',headers={}) => read(path,'POST',data,headers,role);
  const current = async () => (await read('/api/bookings')).actual.find(order => order.item_id === 2);
  const state = async expected => assert.equal((await current()).status,expected);
  async function login(username, heading) {
    if (await page.locator('#logout').isVisible()) await click('Keluar');
    await fill('Username',username);
    await fill('Kata sandi','kata-sandi-uji');
    await click('Masuk');
    await page.getByRole('heading',{name:heading,exact:true}).waitFor();
  }
  async function register(username, role) {
    await click('Daftar akun');
    await page.locator('input[name=role][value=' + role + ']').check();
    if (role === 'peminjam') await shot('10_halaman_daftar');
    await fill('Nama','Akun Pengujian');
    await fill('Username',username);
    await fill('Kata sandi','kata-sandi-uji');
    await fill('Konfirmasi kata sandi','kata-sandi-uji');
    await click('Buat akun');
    await page.getByText('Akun berhasil dibuat. Silakan masuk.').waitFor();
  }
  try {
    await page.goto(url);
    await page.getByRole('heading',{name:'Masuk ke TapRent'}).waitFor();
    await shot('08_halaman_login');
    assert.equal(await page.getByText('Akun demo',{exact:true}).count(),0);
    await register('penyewa','peminjam');
    await register('pemilik','penyewa_pemilik');
    await login('pemilik','Kelola pesanan sewa');
    assert.match(await page.locator('#profile').textContent(),/Penyewa \(Pemilik Barang\)/);
    const today = new Date();
    const tomorrow = new Date(today.getTime() + 86400000);
    const date = value => new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Jakarta',year:'numeric',month:'2-digit',day:'2-digit'}).format(value);
    for (const [index,name,description,rate] of [
      [1,'Kalkulator','Perhitungan matematika',10000],
      [2,'Tripod Aluminium','Dudukan ponsel stabil untuk merekam video',15000],
      [3,'Mikrofon','Merekam audio',10000]
    ]) {
      const offer = await post('/api/offers',{name,description,daily_rate:rate,available_from:date(today),
        available_until:date(tomorrow),location:'Titik penitipan',terms:'Kembalikan lengkap',rfid_uid:'DEMO000'+index},'pemilik');
      assert.equal(offer.status,201);
      assert.equal(offer.actual.id,index);
    }
    await click('Keluar');
    assert.equal((await page.request.get(url+'/api/bookings',{headers:{'X-Demo-Role':'pemilik'}})).status(),401);
    await fill('Username','penyewa');
    await fill('Kata sandi','tidakbenar');
    await click('Masuk');
    await page.getByRole('alert').getByText('Username atau kata sandi salah.').waitFor();
    await login('penyewa','Sewa barang untuk tugasmu');
    await page.reload();
    await page.getByRole('heading',{name:'Sewa barang untuk tugasmu'}).waitFor();
    await fill('Kebutuhan','tripod');
    await click('Cari barang');
    await page.getByRole('heading',{name:'Pencarian kata kunci cadangan'}).waitFor();
    assert.deepEqual(await page.locator('.card h3').allTextContents(), ['Tripod Aluminium']);
    await shot('01_pencarian_cadangan');
    const dates = {starts:await page.locator('#search [name=starts]').inputValue(),
      ends:await page.locator('#search [name=ends]').inputValue()};
    const hiddenByPrice = await read('/api/items/search?' + new URLSearchParams({...dates,q:'tripod',budget:10000}));
    assert.equal(hiddenByPrice.actual.items.length,0);
    const fallbackUrl = process.env.TAPRENT_FALLBACK_TEST_URL;
    if (fallbackUrl) {
      const fallback = await read(fallbackUrl + '/api/items/search?' + new URLSearchParams({...dates,q:'tripod',budget:25000}));
      assert.equal(fallback.actual.mode,'keyword_fallback');
      assert.deepEqual(fallback.actual.items.map(item => item.name),['Tripod Aluminium']);
    }
    await click('Ajukan sewa');
    await page.locator('[name=accept_terms]').check();
    await click('Konfirmasi');
    await page.getByText('Pengajuan tersimpan. Jadwal dikunci.').waitFor();
    await state('MENUNGGU_PERSETUJUAN');
    assert.ok((await current()).accepted_terms);
    const noTerms = await post('/api/bookings',{...dates,item_id:3});
    assert.equal(noTerms.status,400);
    const orderId = (await current()).id;
    const spoof = await post('/api/bookings/'+orderId+'/approve',{},'penyewa',{'X-Demo-Role':'pemilik'});
    assert.equal(spoof.status,403);
    const outsider = await request.newContext({baseURL:url});
    clients.outsider = outsider;
    const registration = await outsider.post('/api/auth/register',{data:{
      username:'penyewa_lain',name:'Penyewa Lain',password:'kata-sandi-uji',role:'peminjam'}});
    assert.equal(registration.status(),201);
    assert.equal((await registration.json()).role,'peminjam');
    assert.equal((await outsider.post('/api/auth/register',{data:{username:'petugas_tidak_sah',name:'Petugas Tidak Sah',password:'kata-sandi-uji',role:'mitra'}})).status(),400);
    assert.equal((await outsider.post('/api/auth/register',{data:{username:'penyewa_lain',name:'Nama Sama',password:'kata-sandi-uji',role:'peminjam'}})).status(),409);
    assert.equal((await outsider.post('/api/auth/login',{data:{username:'penyewa_lain',password:'kata-sandi-uji'}})).status(),200);
    assert.deepEqual(await (await outsider.get('/api/bookings')).json(),[]);
    assert.equal((await outsider.post('/api/bookings/'+orderId+'/cancel',{data:{}})).status(),404);
    assert.equal((await outsider.post('/api/iot/scan',{data:{}})).status(),403);
    assert.equal((await outsider.post('/api/auth/logout',{data:{}})).status(),200);
    assert.equal((await outsider.get('/api/auth/me')).status(),401);
    const concurrent = await Promise.all(Array.from({length:3},() => post('/api/bookings',{...dates,item_id:3,accept_terms:true})));
    assert.deepEqual(concurrent.map(x=>x.status).sort(), [201,409,409]);
    const other = concurrent.find(x=>x.status===201).actual;
    assert.equal((await post('/api/bookings/'+other.id+'/reject',{},'pemilik')).actual.status,'DITOLAK');
    const relisted = await post('/api/bookings',{...dates,item_id:3,accept_terms:true});
    assert.equal(relisted.status,201);
    assert.equal((await post('/api/bookings/'+relisted.actual.id+'/cancel',{})).actual.status,'DIBATALKAN');
    const conflict = await post('/api/bookings',{...dates,item_id:2,accept_terms:true});
    assert.equal(conflict.status,409);
    assert.equal(conflict.actual.error,'SCHEDULE_CONFLICT');
    const hiddenBySchedule = await read('/api/items/search?' + new URLSearchParams({...dates,q:'tripod',budget:25000}));
    assert.equal(hiddenBySchedule.actual.items.length,0);
    await login('pemilik','Kelola pesanan sewa');
    await click('Pasang penawaran');
    const offerForm = page.getByRole('dialog');
    await offerForm.locator('[name=name]').fill('Penyangga Ponsel Meja');
    await offerForm.locator('[name=description]').fill('Dudukan smartphone stabil untuk perekaman video.');
    await offerForm.locator('[name=daily_rate]').fill('12000');
    await offerForm.locator('[name=available_from]').fill(dates.starts);
    await offerForm.locator('[name=available_until]').fill(dates.ends);
    await offerForm.locator('[name=location]').fill('Titik penitipan TapRent ITB');
    await offerForm.locator('[name=rfid_uid]').fill('DEMO-NEW-01');
    await offerForm.locator('[name=terms]').fill('Kembalikan dengan penjepit lengkap.');
    await click('Konfirmasi');
    await page.getByText('Penawaran disimpan.',{exact:true}).waitFor();
    await page.getByRole('heading',{name:'Penyangga Ponsel Meja',exact:true}).waitFor();
    await shot('09_penawaran_pemilik');
    const searchNew = await read('/api/items/search?' + new URLSearchParams({...dates,q:'penyangga',budget:25000}));
    const fresh = searchNew.actual.items.find(row => row.name === 'Penyangga Ponsel Meja');
    assert.ok(fresh);
    assert.equal(fresh.total,12000);
    assert.equal(searchNew.actual.items.some(row => row.id === 2),false);
    assert.equal((await post('/api/offers/'+fresh.id+'/visibility',{active:false},'pemilik')).status,200);
    const hidden = await read('/api/items/search?' + new URLSearchParams({...dates,q:'penyangga',budget:25000}));
    assert.equal(hidden.actual.items.some(row => row.id === fresh.id),false);
    await click('Setujui pengajuan');
    await page.getByText('Pengajuan disetujui. Penyewa dapat melakukan pembayaran simulasi.').waitFor();
    await state('DISETUJUI');
    assert.equal((await current()).pickup_code,null);
    await login('penyewa','Sewa barang untuk tugasmu');
    await click('Bayar simulasi');
    await shot('02_pembayaran_simulasi');
    await click('Konfirmasi');
    const codeNode = page.locator('#orders code');
    await codeNode.waitFor();
    const code = await codeNode.textContent();
    await state('DIPESAN');
    for (const role of ['pemilik','mitra']) {
      const order = (await read('/api/bookings','GET',undefined,{},role)).actual.find(row => row.id === orderId);
      assert.ok(order && !('pickup_code' in order));
    }

    const invalid = await post('/api/iot/scan',{tag_id:'UNKNOWN',device_id:'MITRA_01',event_id:'unknown-tag'},'mitra');
    assert.equal(invalid.status,422);
    assert.equal(invalid.actual.event.result,'TAG_NOT_REGISTERED');
    const mismatch = await post('/api/iot/scan',{tag_id:'DEMO0001',device_id:'MITRA_01',event_id:'mismatch-tag'},'mitra');
    assert.equal(mismatch.status,422);
    assert.equal(mismatch.actual.event.result,'TAG_TRANSACTION_MISMATCH');
    await login('mitra','Serah terima barang');
    await page.locator('#logs').waitFor();
    const devicePayload = {tag_uid:'DEMO0002',device_id:'MITRA_01',scan_event_id:'esp32-test-1',scanned_at:new Date().toISOString()};
    const bridge = '/api/v1/rfid/scans';
    assert.equal((await post(bridge,devicePayload)).status,401);
    assert.equal((await post(bridge,devicePayload,'mitra',{'X-Device-Key':'test-key'})).status,201);
    assert.equal((await post(bridge,devicePayload,'mitra',{'X-Device-Key':'test-key'})).status,409);
    const burst = await post('/api/iot/scan',{tag_id:'DEMO0002',device_id:'MITRA_01',event_id:'burst'},'mitra');
    assert.equal(burst.actual.event.result,'DOUBLE_TAP');
    await page.getByRole('button',{name:'Konfirmasi penitipan',exact:true}).waitFor();
    await state('DIPESAN');
    await page.getByText('Perangkat terhubung',{exact:true}).waitFor();
    await shot('03_dashboard_rfid');
    await page.getByText('Perangkat tidak terdeteksi. Gunakan catatan sementara bila perlu.').waitFor();
    await page.getByText('Catatan sementara saat perangkat terputus',{exact:true}).click();
    await fill('Barang, pesanan, dan kejadian','Tripod Aluminium, penitipan tercatat sementara');
    await click('Simpan catatan sementara');
    await page.locator('#notes').getByText('SEMENTARA',{exact:true}).waitFor();
    await state('DIPESAN');
    await shot('07_perangkat_tidak_terdeteksi');
    await click('Konfirmasi penitipan');
    await fill('Kondisi dan kelengkapan','Baik, kaki tripod dan penjepit lengkap');
    await click('Konfirmasi');
    await page.getByText('Status diperbarui · Siap diambil').waitFor();
    await state('SIAP_DIAMBIL');

    await page.getByLabel('Barang dan UID tag').selectOption('DEMO0002');
    await click('Simulasikan pindai');
    await click('Konfirmasi pengambilan');
    await fill('Kode pengambilan','SALAH');
    await fill('Kondisi dan kelengkapan','Baik, lengkap');
    await click('Konfirmasi');
    await page.getByRole('alert').getByText('INVALID_PICKUP_CODE').waitFor();
    await state('SIAP_DIAMBIL');
    await shot('04_kode_pengambilan_salah');
    await fill('Kode pengambilan',code);
    await click('Konfirmasi');
    await page.getByText('Status diperbarui · Sedang disewa').waitFor();
    await state('SEDANG_DIPINJAM');

    await page.getByLabel('Barang dan UID tag').selectOption('DEMO0002');
    await click('Simulasikan pindai');
    await click('Konfirmasi pengembalian');
    await fill('Kondisi dan kelengkapan','Diterima lengkap dan dapat digunakan');
    await click('Konfirmasi');
    await page.getByText('Status diperbarui · Menunggu pemeriksaan').waitFor();
    await state('MENUNGGU_PEMERIKSAAN');
    const returned = (await current()).timeline.at(-1);
    await new Promise(resolve => setTimeout(resolve,1200));
    await login('pemilik','Kelola pesanan sewa');
    await click('Selesaikan transaksi');
    await fill('Kondisi dan kelengkapan','Pemeriksaan akhir baik dan semua bagian lengkap');
    await click('Konfirmasi');
    await page.getByText('Transaksi selesai.',{exact:true}).waitFor();
    await state('SELESAI');
    const done = await current();
    assert.deepEqual(done.timeline.map(x=>x.status), ['MENUNGGU_PERSETUJUAN','DISETUJUI','DIPESAN',
      'SIAP_DIAMBIL','SEDANG_DIPINJAM','MENUNGGU_PEMERIKSAAN','SELESAI']);
    assert.deepEqual(done.timeline.at(-2), returned);
    assert.ok(done.timeline.at(-1).timestamp > returned.timestamp);
    const released = await read('/api/items/search?' + new URLSearchParams({...dates,q:'tripod',budget:25000}));
    assert.deepEqual(released.actual.items.map(item=>item.name),['Tripod Aluminium']);
    await shot('05_transaksi_selesai');
    await page.setViewportSize({width:390,height:844});
    await login('penyewa','Sewa barang untuk tugasmu');
    await page.getByRole('heading',{name:'Katalog barang'}).waitFor();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth),390);
    await shot('06_tampilan_seluler');
    await page.getByLabel('Filter status',{exact:true}).selectOption('SELESAI');
    assert.equal(await page.locator('#orders .card').count(),1);
    await click('Keluar');
    await page.getByRole('heading',{name:'Masuk ke TapRent'}).waitFor();
    assert.equal((await page.request.get(url+'/api/bookings')).status(),401);
    assert.deepEqual(errors,[]);
    console.log('LULUS · UT-01–UT-07, login tiga peran, registrasi dua peran, isolasi pesanan, penawaran dinamis, syarat sewa, logout, dan UI seluler.');
  } finally {
    await Promise.all(Object.values(clients).map(client => client.dispose()));
    await browser.close();
    fs.writeFileSync('tests/evidence/jejak_api.json', JSON.stringify(trace,null,2) + '\n');
  }
}

run().catch(error => { console.error(error); process.exitCode = 1; });
