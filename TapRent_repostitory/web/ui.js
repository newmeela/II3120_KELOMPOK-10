const workspace = document.querySelector('#workspace');
const notice = document.querySelector('#notice');
const authPanel = document.querySelector('#auth');
const account = document.querySelector('#account');
const hero = document.querySelector('#hero');
const roleNames = {penyewa:'Peminjam', pemilik:'Penyewa (Pemilik Barang)', mitra:'Petugas Mitra'};
const internalRole = {peminjam:'penyewa', penyewa_pemilik:'pemilik', mitra:'mitra'};
let user = null;
let currentOrders = [];
let statusFilter = '';
const headers = {
  penyewa: ['KATALOG KAMPUS', 'Sewa barang untuk tugasmu', 'Ceritakan kebutuhanmu dan temukan barang sesuai jadwal dan anggaran.'],
  pemilik: ['DASHBOARD PEMILIK', 'Kelola pesanan sewa', 'Setujui pengajuan dan selesaikan transaksi setelah memeriksa barang.'],
  mitra: ['TITIK PENITIPAN', 'Serah terima barang', 'Pantau pemindaian RFID dan konfirmasi pemeriksaan fisik.']
};
const names = {
  MENUNGGU_PERSETUJUAN: 'Menunggu persetujuan', DISETUJUI: 'Disetujui', DIPESAN: 'Dipesan', SIAP_DIAMBIL: 'Siap diambil',
  SEDANG_DIPINJAM: 'Sedang disewa', MENUNGGU_PEMERIKSAAN: 'Menunggu pemeriksaan', SELESAI: 'Selesai', DITOLAK: 'Ditolak', DIBATALKAN: 'Dibatalkan'
};
const scanLabels = {DIPESAN: 'Konfirmasi penitipan', SIAP_DIAMBIL: 'Konfirmasi pengambilan',
  SEDANG_DIPINJAM: 'Konfirmasi pengembalian'};
const modes = {sentence_transformer:'Hasil pencarian kontekstual',
  keyword_fallback:'Pencarian kata kunci cadangan', no_candidates:'Penawaran tidak tersedia'};
const rupiah = value => new Intl.NumberFormat('id-ID', {style:'currency',currency:'IDR',maximumFractionDigits:0}).format(value);
const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({
  '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'
})[char]);
let role = null;
let view = 0;
let items = [];
let ownerOffers = [];
let deviceId = "MITRA_01";
let dateFields = {};
let searchResult = null;

function dates(offset) {
  const date = new Date(Date.now() + offset * 86400000);
  return new Intl.DateTimeFormat('en-CA', {timeZone:'Asia/Jakarta', year:'numeric', month:'2-digit', day:'2-digit'}).format(date);
}

async function api(path, data) {
  const response = await fetch(path, {method:data === undefined ? 'GET' : 'POST',
    headers:{'Content-Type':'application/json'}, body:JSON.stringify(data)});
  const result = await response.json();
  if (response.status === 401 && user && !path.startsWith('/api/auth/')) showLogin(false, 'Sesi telah berakhir. Silakan masuk kembali.');
  if (!response.ok) throw new Error(result.error || result.event?.result || 'Permintaan gagal.');
  return result;
}

function flash(message, error = false) {
  notice.hidden = !message;
  notice.classList.toggle('error', error);
  notice.textContent = message;
}

const category = {1:['∑','Kalkulator'],2:['⌖','Tripod'],3:['♫','Audio']};
function itemImage(item) {
  return item.photo ? `<img class="item-photo" src="${esc(item.photo)}" alt="${esc(item.name)}" loading="lazy">` :
    `<div class="item-symbol item-${item.id}" aria-hidden="true">${category[item.id]?.[0] || '•'}</div>`;
}

function itemCards(list) {
  return list.length ? list.map(item => `
    <article class="card item">${itemImage(item)}<h3>${esc(item.name)}</h3><p class="muted">${esc(item.description)}</p>
    <p><strong>${rupiah(item.daily_rate)}</strong> / hari</p><small class="muted">${esc(item.location)}</small>
    ${item.total ? `<p>Total ${rupiah(item.total)} ${item.score === undefined ? '' : '· Skor ' + item.score}</p>` : ''}
    <button type="button" class="secondary" data-detail="${item.id}">Detail penawaran</button><button data-book="${item.id}">Ajukan sewa</button></article>`).join('') :
    '<p class="muted">Tidak ada penawaran yang cocok. Coba ubah kebutuhan, tanggal, atau anggaran.</p>';
}

function bookingCards(bookings) {
  return bookings.length ? bookings.map(order => `
    <article class="card"><span class="pill">${names[order.status]}</span>
    <h3>#${order.id} · ${esc(order.item_name)}</h3>
    <p>${esc(order.starts)} → ${esc(order.ends)} · ${rupiah(order.total)}</p>
    ${role === 'penyewa' && ['DIPESAN','SIAP_DIAMBIL'].includes(order.status) ?
      `<p>Kode pengambilan <strong><code>${esc(order.pickup_code)}</code></strong> <button type="button" class="secondary copy" data-copy="${esc(order.pickup_code)}">Salin kode</button></p>` : ''}
    ${['MENUNGGU_PEMERIKSAAN','SELESAI'].includes(order.status) ? `<p><strong>Bukti terima pengembalian</strong><br><small>${esc(order.timeline.find(step => step.status === 'MENUNGGU_PEMERIKSAAN')?.timestamp)}</small></p>` : ''}
    <p class="muted">Titik serah terima · ${esc(order.location)}</p>
    ${order.accepted_terms ? `<details><summary>Ketentuan yang disetujui</summary><p>${esc(order.accepted_terms)}</p></details>` : ''}
    ${['DIPESAN','SIAP_DIAMBIL','SEDANG_DIPINJAM','MENUNGGU_PEMERIKSAAN','SELESAI'].includes(order.status) ? '<p class="pill">Pembayaran simulasi tercatat</p>' : ''}
    <details open><summary>Linimasa</summary><ol class="timeline">
    ${order.timeline.map(step => `<li>${names[step.status]} <small>${esc(step.timestamp)} · ${esc(step.note)}</small></li>`).join('')}
    </ol></details>
    ${role === 'pemilik' && order.status === 'MENUNGGU_PERSETUJUAN' ? `<button data-approve="${order.id}">Setujui pengajuan</button>` : ''}
    ${role === 'pemilik' && order.status === 'MENUNGGU_PERSETUJUAN' ? `<button class="secondary" data-action="reject" data-order="${order.id}">Tolak pengajuan</button>` : ''}
    ${role === 'penyewa' && order.status === 'DISETUJUI' ? `<button data-action="pay" data-order="${order.id}">Bayar simulasi</button>` : ''}
    ${role === 'penyewa' && ['MENUNGGU_PERSETUJUAN','DISETUJUI','DIPESAN'].includes(order.status) ? `<button class="secondary" data-action="cancel" data-order="${order.id}">Batalkan reservasi</button>` : ''}
    ${role === 'pemilik' && order.status === 'MENUNGGU_PEMERIKSAAN'  ? `<button data-finish="${order.id}">Selesaikan transaksi</button>` : ''}
    </article>`).join('') : '<p class="muted">Belum ada pesanan.</p>';
}

function manualNotes() {
  return JSON.parse(localStorage.getItem('taprent-catatan-sementara-' + user.id) || '[]');
}

function noteList() {
  return manualNotes().map(note =>
    `<li><strong>SEMENTARA</strong> · ${esc(note.time)} · ${esc(note.text)}</li>`).join('');
}

function deviceMessage(device) {
  return device.online ? 'Perangkat terhubung' : 'Perangkat tidak terdeteksi. Gunakan catatan sementara bila perlu.';
}

function logCards(logs) {
  return logs.length ? logs.map(log => `
    <article class="card"><span class="pill">${esc(log.confirmed_at ? 'DIKONFIRMASI' : log.result)}</span>
    <h3><code>${esc(log.tag_id)}</code> · ${esc(log.device_id)}</h3>
    <p>${log.booking_id ? 'Pesanan #' + log.booking_id + ' · ' + names[log.stage] : 'Pesanan aktif tidak ditemukan'}</p>
    <p class="muted">${esc(log.timestamp)}</p><small>ID <code>${esc(log.event_id)}</code></small>
    ${log.result === 'VALID' && !log.confirmed_at ?
      `<button data-confirm="${esc(log.event_id)}" data-stage="${esc(log.stage)}">${scanLabels[log.stage]}</button>` : ''}
    </article>`).join('') : '<p class="muted">Menunggu pindai RFID.</p>';
}

async function render() {
  const renderId = ++view;
  const [eyebrow,title,description] = headers[role];
  document.querySelector('#hero').innerHTML = `<small>${eyebrow}</small><h1>${title}</h1><p>${description}</p>`;

  const [catalogue, bookings, logs, config, device, own] = await Promise.all([
    api('/api/items'), api('/api/bookings'), role === 'mitra' ? api('/api/iot/logs') : [], api('/api/config'), role === 'mitra' ? api('/api/iot/status') : null, role === 'pemilik' ? api('/api/offers') : []]);
  if (renderId !== view) return;
  items = catalogue;
  ownerOffers = own;
  deviceId = config.device_id;
  const starts = dateFields.starts || dates(0);
  const ends = dateFields.ends || dates(1);
  const titleItems = searchResult ? modes[searchResult.mode] : 'Katalog barang';
  let panel = '';
  if (role === 'penyewa') panel = `
    <section class="panel"><h2>Cari barang dengan AI</h2><p class="muted">Masukkan kebutuhan. TapRent mencocokkan makna dengan penawaran aktif, jadwal, dan anggaran total.</p><form id="search">
    <label class="query">Kebutuhan<input required name="q" maxlength="200" placeholder="Contoh: penyangga HP untuk rekam video" value="${esc(dateFields.q)}"></label>
    <label>Mulai<input required name="starts" type="date" value="${esc(starts)}"></label>
    <label>Selesai<input required name="ends" type="date" value="${esc(ends)}"></label>
    <label>Anggaran total<input required name="budget" type="number" min="1" max="999999999" value="${esc(dateFields.budget || 25000)}"></label>
    <button>Cari barang</button></form>
    <div class="suggestions" aria-label="Contoh pencarian"><button type="button" class="secondary" data-query="penyangga HP untuk rekam video">Rekam tugas</button><button type="button" class="secondary" data-query="mikrofon untuk podcast">Podcast</button><button type="button" class="secondary" data-query="menghitung statistika">Statistika</button>${searchResult ? '<button type="button" class="secondary" data-clear>Reset hasil</button>' : ''}</div></section>
    <section class="panel"><h2>${titleItems}</h2>
    ${searchResult ? `<p class="muted">${searchResult.items.length} penawaran · ${searchResult.criteria.days} hari · maksimal ${rupiah(searchResult.criteria.budget)} · ${esc(searchResult.criteria.starts)} → ${esc(searchResult.criteria.ends)}</p>` : ''}
    <div class="grid">${itemCards(searchResult?.items || items)}</div></section>`;
  if (role === 'pemilik') panel = `
    <section class="panel"><div class="section-top"><h2>Penawaran saya</h2><button type="button" data-offer="new">Pasang penawaran</button></div>
    <div class="grid">${ownerOffers.length ? ownerOffers.map(item => `
      <article class="card item">${itemImage(item)}<span class="pill">${item.active ? 'Tayang' : 'Disembunyikan'}</span>
      <h3>${esc(item.name)}</h3><p>${rupiah(item.daily_rate)} / hari</p>
      <p class="muted">${esc(item.available_from)} → ${esc(item.available_until)}</p>
      <button type="button" data-offer="${item.id}">Edit penawaran</button>
      <button type="button" class="secondary" data-visibility="${item.id}">${item.active ? 'Sembunyikan' : 'Tayangkan'}</button>
      </article>`).join('') : '<p class="muted">Belum ada penawaran.</p>'}</div></section>`;
  if (role === 'mitra') panel = `
    <section class="panel"><h2>Simulasi pemindai RFID</h2>
    <p id="device-state" class="muted">${deviceMessage(device)}</p>
    <form id="scan"><label>Barang dan UID tag<select name="tag_id">${items.map(item =>
      `<option value="${esc(item.rfid_uid)}">${esc(item.name)} · ${esc(item.rfid_uid)}</option>`).join('')}</select></label>
    <button>Simulasikan pindai</button></form>
    <details><summary>Catatan sementara saat perangkat terputus</summary>
    <form id="manual-note"><label>Barang, pesanan, dan kejadian<input name="text" required maxlength="200"></label><button>Simpan catatan sementara</button></form>
    <ul id="notes">${noteList()}</ul></details></section>
    <section class="panel"><h2>Riwayat pindai RFID <small class="muted" id="poll-status"></small></h2><div class="grid" id="logs">${logCards(logs)}</div></section>`;
  currentOrders = bookings;
  previousLogs = logCards(logs);
  previousOrders = JSON.stringify(bookings);
  workspace.innerHTML = `<div class="overview" aria-label="Ringkasan pesanan">${summaryCards(bookings)}</div>` + panel + `<section class="panel"><h2>${role === 'penyewa' ? 'Pesanan saya' : 'Daftar pesanan'}</h2>
    <div class="order-tools"><label><span>Filter status</span><select id="status-filter" aria-label="Filter status"><option value="">Semua status</option>
    ${Object.entries(names).map(([value,label]) => `<option value="${value}" ${value === statusFilter ? 'selected' : ''}>${label}</option>`).join('')}</select></label>
    <button type="button" class="secondary" data-refresh>Perbarui</button></div>
    <div id="orders" class="grid">${filteredOrders()}</div></section>`;
}

function openForm(title, fields, handler) {
  const dialog = document.createElement('dialog');
  dialog.innerHTML = `<h2>${title}</h2><form>${fields}<menu>
    <button type="button" class="secondary">Batal</button><button>Konfirmasi</button></menu></form>`;
  dialog.querySelector('[type=button]').onclick = () => dialog.close();
  dialog.querySelector('form').onsubmit = async event => {
    event.preventDefault();
    const button = event.submitter;
    button.disabled = true;
    try {
      await handler(Object.fromEntries(new FormData(event.currentTarget)));
      dialog.close();
      await render();
    } catch (error) {
      let feedback = dialog.querySelector('[role=alert]');
      if (!feedback) {
        feedback = document.createElement('p');
        feedback.setAttribute('role', 'alert');
        dialog.querySelector('form').prepend(feedback);
      }
      feedback.textContent = error.message;
    } finally {
      button.disabled = false;
    }
  };
  dialog.addEventListener('close', () => dialog.remove(), {once:true});
  document.body.append(dialog);
  dialog.showModal();
}

function summaryCards(orders) {
  const active = orders.filter(order => !['SELESAI','DITOLAK','DIBATALKAN'].includes(order.status));
  return [['Total pesanan',orders.length],['Sedang berjalan',active.length],
    ['Selesai',orders.filter(order => order.status === 'SELESAI').length]]
    .map(([label,count]) => `<div class="stat"><strong>${count}</strong><span>${label}</span></div>`).join('');
}

function filteredOrders() {
  return bookingCards(statusFilter ? currentOrders.filter(order => order.status === statusFilter) : currentOrders);
}

function showLogin(register = false, message = '') {
  ++view;
  user = role = null;
  items = currentOrders = [];
  dateFields = {};
  searchResult = null;
  statusFilter = '';
  document.querySelectorAll('dialog[open]').forEach(dialog => dialog.close());
  workspace.innerHTML = '';
  hero.hidden = account.hidden = true;
  flash('');
  authPanel.hidden = false;
  authPanel.innerHTML = `<div class="access-heading"><h1>${register ? 'Daftar akun TapRent' : 'Masuk ke TapRent'}</h1>
    <p>${register ? 'Pilih peran sesuai fungsi yang ingin digunakan.' : 'Gunakan username dan kata sandi yang terdaftar.'}</p></div>
    <div class="login-shell ${register ? 'registration' : ''}">
    ${register ? '' : `<section class="login-intro"><h2>Pilih akses TapRent</h2>
      <dl><dt>Peminjam</dt><dd>Cari dan ajukan sewa barang.</dd>
      <dt>Penyewa (Pemilik Barang)</dt><dd>Pasang iklan dan kelola pesanan.</dd>
      <dt>Petugas Mitra</dt><dd>Masuk dengan akun internal.</dd></dl></section>`}
    <section class="panel login-card">
    <form id="login-form">
    ${register ? `<fieldset class="role-options"><legend>Jenis akun</legend>
      <label><input type="radio" name="role" value="peminjam" required><span>Peminjam</span></label>
      <label><input type="radio" name="role" value="penyewa_pemilik" required><span>Penyewa (Pemilik Barang)</span></label>
    </fieldset><label>Nama<input required name="name" minlength="2" maxlength="60" autocomplete="name"></label>` : ''}
    <label>Username<input required name="username" maxlength="24" autocomplete="username" autocapitalize="none"></label>
    <label>Kata sandi<input required name="password" maxlength="128" type="password" autocomplete="${register ? 'new-password':'current-password'}" ${register ? 'minlength="8"' : ''}></label>
    ${register ? '<label>Konfirmasi kata sandi<input required name="confirmation" type="password" minlength="8" maxlength="128" autocomplete="new-password"></label>' : ''}
    <button>${register ? 'Buat akun' : 'Masuk'}</button></form>
    <p id="auth-feedback" role="alert" ${message ? '' : 'hidden'}>${esc(message)}</p>
    <button type="button" class="secondary" id="auth-mode">${register ? 'Kembali ke halaman masuk' : 'Daftar akun'}</button>
    </section></div>`;
  const form = authPanel.querySelector('form');
  authPanel.querySelector('#auth-mode').onclick = () => showLogin(!register);
  form.onsubmit = async event => {
    event.preventDefault();
    const button = event.submitter;
    const feedback = authPanel.querySelector('#auth-feedback');
    button.disabled = true;
    feedback.hidden = true;
    try {
      const fields = Object.fromEntries(new FormData(form));
      if (register && fields.password !== fields.confirmation) throw new Error('Konfirmasi kata sandi berbeda.');
      delete fields.confirmation;
      const session = await api(register ? '/api/auth/register' : '/api/auth/login', fields);
      if (register) {
        showLogin(false, 'Akun berhasil dibuat. Silakan masuk.');
        authPanel.querySelector('[name=username]').value = session.username;
        authPanel.querySelector('[name=password]').focus();
        return;
      }
      await enter(session).catch(error => flash(error.message,true));
    } catch (error) {
      feedback.hidden = false;
      feedback.textContent = error.message;
    } finally { button.disabled = false; }
  };
}

async function enter(session) {
  user = session;
  role = internalRole[user.role];
  authPanel.hidden = true;
  account.hidden = hero.hidden = false;
  document.querySelector('#profile').textContent = user.name + ' / ' + roleNames[role];
  await render();
}

document.querySelector('#logout').onclick = async event => {
  const button = event.currentTarget;
  button.disabled = true;
  try {
    await api('/api/auth/logout', {});
    showLogin();
  } catch (error) { flash(error.message,true); }
  finally { button.disabled = false; }
};

workspace.addEventListener('change', event => {
  if (event.target.id === 'status-filter') {
    statusFilter = event.target.value;
    document.querySelector('#orders').innerHTML = filteredOrders();
  }
});

workspace.addEventListener('submit', async event => {
  event.preventDefault();
  const form = event.target;
  const fields = Object.fromEntries(new FormData(form));
  event.submitter.disabled = true;
  try {
    if (form.id === 'search') {
      dateFields = fields;
      searchResult = await api('/api/items/search?' + new URLSearchParams(fields));
      flash('');
    } else if (form.id === 'manual-note') {
      const notes = manualNotes();
      notes.push({time:new Date().toISOString(),text:fields.text.trim()});
      localStorage.setItem('taprent-catatan-sementara-' + user.id, JSON.stringify(notes.slice(-50)));
      document.querySelector('#notes').innerHTML = noteList();
      form.reset();
      flash('Catatan sementara disimpan di perangkat ini. Status transaksi tetap.');
      return;
    } else {
      const id = globalThis.crypto?.randomUUID?.() || 'demo-' + Date.now() + '-' + Math.random().toString(36).slice(2);
      await api('/api/iot/scan', {...fields, device_id:deviceId, event_id:id});
      flash('Tag cocok dengan pesanan. Konfirmasi pemeriksaan untuk melanjutkan.');
    }
    await render();
  } catch (error) {
    flash(error.message,true);
    if (role === 'mitra') await render().catch(() => {});
  } finally {
    event.submitter.disabled = false;
  }
});

workspace.addEventListener('click', async event => {
  const button = event.target.closest('button');
  if (!button) return;
  if (button.dataset.query) {
    const form = document.querySelector('#search');
    form.elements.q.value = button.dataset.query;
    form.requestSubmit(form.querySelector('button'));
    return;
  }
  if ('clear' in button.dataset || 'refresh' in button.dataset) {
    if ('clear' in button.dataset) { searchResult = null; dateFields = {}; }
    await render().catch(error => flash(error.message,true));
    return;
  }
  if (button.dataset.copy) {
    try {
      await navigator.clipboard.writeText(button.dataset.copy);
      flash('Kode pengambilan disalin.');
    } catch { flash('Salin kode pengambilan dari pesanan.',true); }
    return;
  }
  const {book, approve, confirm, stage, finish, detail, offer, visibility} = button.dataset;
  if (offer) {
    const item = ownerOffers.find(row => row.id === Number(offer)) || {};
    const input = (label,name,attrs='') => `<label>${label}<input required name="${name}" ${attrs} value="${esc(item[name] ?? (name === 'location' ? 'Titik penitipan TapRent ITB' : ''))}"></label>`;
    openForm(item.id ? 'Edit penawaran' : 'Pasang penawaran', `
      ${input('Nama barang','name','maxlength="80"')}
      <label>Deskripsi<textarea required name="description" maxlength="600">${esc(item.description)}</textarea></label>
      ${input('Tarif per hari','daily_rate','type="number" min="1" max="100000000"')}
      <div class="form-pair">${input('Tersedia mulai','available_from','type="date"')}${input('Tersedia sampai','available_until','type="date"')}</div>
      ${input('Titik penitipan','location','maxlength="120"')}
      ${input('UID RFID','rfid_uid','maxlength="64"')}
      <label>Ketentuan sewa<textarea required name="terms" maxlength="500">${esc(item.terms)}</textarea></label>
      <label>Foto barang (opsional, maks. 250 KiB)<input name="photo" type="file" accept="image/png,image/jpeg,image/webp"></label>`,
      async fields => {
        if (fields.photo.size > 250 * 1024) throw new Error('Ukuran foto melebihi 250 KiB.');
        if (fields.photo.size) {
          const file = fields.photo;
          fields.photo = await new Promise((resolve,reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = () => reject(new Error('Foto tidak dapat dibaca.'));
            reader.readAsDataURL(file);
          });
        } else delete fields.photo;
        fields.daily_rate = Number(fields.daily_rate);
        await api(item.id ? '/api/offers/' + item.id + '/edit' : '/api/offers', fields);
        flash('Penawaran disimpan.');
      });
    return;
  }
  if (visibility) {
    const item = ownerOffers.find(row => row.id === Number(visibility));
    button.disabled = true;
    try {
      await api('/api/offers/' + item.id + '/visibility', {active:!item.active});
      await render();
    } catch (error) { flash(error.message,true); }
    finally { button.disabled = false; }
    return;
  }
  if (detail) {
    const item = (searchResult?.items || items).find(row => row.id === Number(detail));
    const dialog = document.createElement('dialog');
    dialog.innerHTML = `<h2>${esc(item.name)}</h2>${itemImage(item)}<p>${esc(item.description)}</p>
      <p><strong>${rupiah(item.daily_rate)}</strong> / hari · ${esc(item.location)}</p>
      <p>${esc(item.available_from)} → ${esc(item.available_until)}</p><h3>Ketentuan sewa</h3><p>${esc(item.terms)}</p>
      <button class="secondary" type="button">Tutup</button>`;
    dialog.querySelector('button').onclick = () => dialog.close();
    dialog.addEventListener('close', () => dialog.remove(), {once:true});
    document.body.append(dialog);
    dialog.showModal();
    return;
  }
  const condition = '<label>Kondisi dan kelengkapan<input name="condition" required maxlength="200" placeholder="Contoh: baik, seluruh bagian lengkap"></label>';
  if (book) {
    const item = (searchResult?.items || items).find(candidate => candidate.id === Number(book));
    openForm('Ajukan ' + esc(item.name), `
      <label>Tanggal mulai<input name="starts" type="date" required value="${esc(dateFields.starts || dates(0))}"></label>
      <label>Tanggal selesai<input name="ends" type="date" required value="${esc(dateFields.ends || dates(1))}"></label>
      <div class="terms"><strong>Ketentuan sewa</strong><p>${esc(item.terms)}</p></div>
      <label class="check"><input name="accept_terms" type="checkbox" required>Saya menyetujui ketentuan sewa.</label>`,
      async fields => {
        await api('/api/bookings', {...fields, accept_terms:fields.accept_terms === 'on', expected_terms:item.terms, item_id:Number(book)});
        searchResult = null;
        flash('Pengajuan tersimpan. Jadwal dikunci.');
      });
  }
  if (approve) {
    button.disabled = true;
    try {
      await api('/api/bookings/' + approve + '/approve', {});
      flash('Pengajuan disetujui. Penyewa dapat melakukan pembayaran simulasi.');
      await render();
    } catch (error) { flash(error.message,true); }
    finally { button.disabled = false; }
  }
  if (button.dataset.action) {
    const action = button.dataset.action;
    const texts = {pay:['Pembayaran simulasi','Simulasi ini tidak memindahkan uang.'], reject:['Tolak pengajuan','Jadwal akan dilepas.'], cancel:['Batalkan reservasi','Jadwal akan dilepas.']};
    openForm(texts[action][0], `<p>${texts[action][1]}</p>`, async () => {
      await api('/api/bookings/' + button.dataset.order + '/' + action, action === 'pay' ? {simulation:true} : {});
      searchResult = null;
      flash('Status diperbarui.');
    });
  }
  if (confirm) {
    const code = stage === 'SIAP_DIAMBIL' ? '<label>Kode pengambilan<input name="pickup_code" required maxlength="32" autocomplete="off"></label>' : '';
    openForm(scanLabels[stage], code + condition, async fields => {
      const order = await api('/api/iot/confirm', {...fields, event_id:confirm});
      flash('Status diperbarui · ' + names[order.status]);
    });
  }
  if (finish) openForm('Selesaikan transaksi', condition, async fields => {
    await api('/api/bookings/' + finish + '/finish', fields);
    flash('Transaksi selesai.');
  });
});

let previousLogs = '';
let previousOrders = '';

let refreshing = false;
setInterval(async () => {
  if (role !== 'mitra' || refreshing) return;
  const renderId = view;
  refreshing = true;
  try {
    const [logs, bookings, device] = await Promise.all([api('/api/iot/logs'), api('/api/bookings'), api('/api/iot/status')]);
    if (role !== 'mitra' || renderId !== view) return;
    const logHTML = logCards(logs);
    currentOrders = bookings;
    const orderSignature = JSON.stringify(bookings);
    if (logHTML !== previousLogs) document.querySelector('#logs').innerHTML = previousLogs = logHTML;
    const orderPanel = document.querySelector('#orders');
    if (orderSignature !== previousOrders) {
      orderPanel.innerHTML = filteredOrders();
      previousOrders = orderSignature;
    }
    document.querySelector('.overview').innerHTML = summaryCards(bookings);
    document.querySelector('#device-state').textContent = deviceMessage(device);
    document.querySelector('#poll-status').textContent = '';
  } catch {
    const status = document.querySelector('#poll-status');
    if (status) status.textContent = '· Koneksi terputus, mencoba kembali';
  } finally {
    refreshing = false;
  }
}, 2000);

api('/api/auth/me').then(session => enter(session).catch(error => flash(error.message,true)))
  .catch(() => showLogin());
