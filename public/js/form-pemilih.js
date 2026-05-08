// ════════════════════════════════════════
//  form-pemilih.js — Logic Form Pemilih (v3)
//  Anti-Tremor + Auto-parse NIK
// ════════════════════════════════════════

let nikCheckTimeout = null;
let isSubmitting = false; // Anti-tremor flag

// ── Parse NIK → tanggal lahir & jenis kelamin ────────
function parseNIK(nik) {
  if (!nik || nik.length !== 16 || isNaN(nik)) return null;
  let tanggal = parseInt(nik.substring(6, 8));
  const bulan = parseInt(nik.substring(8, 10));
  let tahun   = parseInt(nik.substring(10, 12));

  let jenisKelamin = 'L';
  if (tanggal > 40) {
    jenisKelamin = 'P';
    tanggal -= 40;
  }

  const currentYear2Digit = new Date().getFullYear() % 100;
  tahun = tahun <= currentYear2Digit ? 2000 + tahun : 1900 + tahun;

  if (bulan < 1 || bulan > 12 || tanggal < 1 || tanggal > 31) return null;

  const tgl = `${tahun}-${String(bulan).padStart(2, '0')}-${String(tanggal).padStart(2, '0')}`;

  // Hitung umur
  const lahir = new Date(tgl);
  const now   = new Date();
  let umur    = now.getFullYear() - lahir.getFullYear();
  const m     = now.getMonth() - lahir.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < lahir.getDate())) umur--;

  return { tanggalLahir: tgl, jenisKelamin, umur };
}

function getNikIssueMessage(nik) {
  if (!nik) return 'NIK kosong. Data akan disimpan sebagai bermasalah.';
  if (!/^\d+$/.test(nik)) return 'NIK harus berupa angka.';
  if (nik.length !== 16) return `NIK ${nik.length} digit. Data akan disimpan sebagai bermasalah.`;
  return '';
}

// ── Event: NIK berubah → auto-fill & cek duplikat ────
function onNIKInput() {
  const nik = document.getElementById('inp-nik').value.trim();
  const tglEl  = document.getElementById('inp-tgl-lahir');
  const jkEl   = document.getElementById('inp-jk');
  const umurEl = document.getElementById('display-umur');
  const nikStatus = document.getElementById('nik-status');

  // Reset fields
  if (tglEl)  tglEl.value = '';
  if (jkEl)   jkEl.value  = '';
  if (umurEl) umurEl.textContent = '';
  if (nikStatus) { nikStatus.className = 'nik-status'; nikStatus.textContent = ''; }

  if (!nik.length) return;

  const nikIssue = getNikIssueMessage(nik);
  if (nikIssue) {
    if (nikStatus) {
      nikStatus.className = 'nik-status nik-danger';
      nikStatus.textContent = nikIssue;
    }
    return;
  }

  // Auto-fill dari NIK
  const parsed = parseNIK(nik);
  if (parsed) {
    if (tglEl)  tglEl.value = parsed.tanggalLahir;
    if (jkEl)   jkEl.value  = parsed.jenisKelamin;
    if (umurEl) umurEl.textContent = `${parsed.umur} tahun`;
  }

  // Cek duplikat real-time
  clearTimeout(nikCheckTimeout);
  nikCheckTimeout = setTimeout(async () => {
    if (nik.length !== 16) return;
    const result = await PemilihAPI.cekNIK(nik);

    if (result.exists) {
      if (nikStatus) {
        nikStatus.className = 'nik-status nik-danger';
        nikStatus.innerHTML = `🔴 <strong>NIK SUDAH TERDAFTAR</strong> — ${result.data.nama} (${result.data.namaKader})`;
      }
    } else {
      if (nikStatus) {
        nikStatus.className = 'nik-status nik-safe';
        nikStatus.innerHTML = `🟢 NIK tersedia`;
      }
    }
  }, 300);
}

// ── Helpers: Lock / Unlock tombol submit ─────────────
function lockSubmitButton(btnSelector) {
  const btn = document.querySelector(btnSelector || '.btn-primary');
  if (!btn) return;
  isSubmitting = true;
  btn.disabled = true;
  btn._originalHTML = btn.innerHTML;
  btn.innerHTML = '<span class="spinner" style="width:14px;height:14px;border-width:2px;margin-right:6px;vertical-align:middle;"></span> Memeriksa Data…';
}

function unlockSubmitButton(btnSelector) {
  const btn = document.querySelector(btnSelector || '.btn-primary');
  if (!btn) return;
  isSubmitting = false;
  btn.disabled = false;
  btn.innerHTML = btn._originalHTML || '💾 Simpan';
}

// ── Submit TAMBAH ─────────────────────────────────────
async function submitTambahPemilih() {
  if (isSubmitting) return; // Anti-tremor: tolak klik ganda

  const nama         = document.getElementById('inp-nama').value.trim();
  const nik          = document.getElementById('inp-nik').value.trim();
  const kaderId      = document.getElementById('inp-kader').value;
  const tanggalLahir = document.getElementById('inp-tgl-lahir').value;
  const jenisKelamin = document.getElementById('inp-jk').value;
  const rt           = document.getElementById('inp-rt') ? document.getElementById('inp-rt').value.trim() : '';
  const rw           = document.getElementById('inp-rw') ? document.getElementById('inp-rw').value.trim() : '';

  hideAlerts();
  if (!nama || nama.length > 100 || !/^[a-zA-Z\s]+$/.test(nama)) {
    showError('Nama harus diisi, maksimal 100 karakter, hanya huruf dan spasi!');
    return;
  }
  if (!kaderId || !/^[a-f0-9-]{1,36}$/.test(kaderId)) {
    showError('Kader harus dipilih dengan benar!');
    return;
  }

  if (nik && !/^\d+$/.test(nik)) {
    showError('NIK harus berupa angka!');
    return;
  }

  if (!nik) {
    const confirmSave = await showAppConfirm('Data tanpa NIK akan disimpan dengan status "bermasalah" dan bisa dilengkapi nanti. Lanjutkan?', {
      title: 'Simpan Tanpa NIK',
      confirmText: 'Tetap Simpan'
    });
    if (!confirmSave) return;
  } else if (nik.length !== 16) {
    const kondisiDigit = nik.length < 16 ? 'kurang' : 'lebih';
    const confirmSave = await showAppConfirm(`NIK ${kondisiDigit} dari 16 digit (${nik.length} digit). Data akan disimpan dengan status "bermasalah" dan bisa diedit nanti. Lanjutkan?`, {
      title: 'Periksa NIK',
      confirmText: 'Tetap Simpan'
    });
    if (!confirmSave) return;
  }

  // ═══ KUNCI TOMBOL ═══
  lockSubmitButton();

  try {
    const res = await PemilihAPI.tambah({ nama, nik, kaderId, tanggalLahir, jenisKelamin, rt, rw });

    if (res.error) {
      showError(res.error);
      unlockSubmitButton();
      return;
    }

    showSuccess(`${nama} berhasil didaftarkan!`);
    resetFormPemilih();
    showToast(`✅ ${nama} berhasil disimpan!`);
    // Jangan unlock — langsung redirect
    setTimeout(() => { window.location.href = '/'; }, 1800);
  } catch (e) {
    showError('Terjadi kesalahan jaringan. Coba lagi.');
    unlockSubmitButton();
  }
}

// ── Submit EDIT ───────────────────────────────────────
async function submitEditPemilih() {
  if (isSubmitting) return; // Anti-tremor

  const id           = document.getElementById('edit-id').value;
  const nama         = document.getElementById('inp-nama').value.trim();
  const nik          = document.getElementById('inp-nik').value.trim();
  const kaderId      = document.getElementById('inp-kader').value;
  const tanggalLahir = document.getElementById('inp-tgl-lahir').value;
  const jenisKelamin = document.getElementById('inp-jk').value;
  const rt           = document.getElementById('inp-rt') ? document.getElementById('inp-rt').value.trim() : '';
  const rw           = document.getElementById('inp-rw') ? document.getElementById('inp-rw').value.trim() : '';

  hideAlerts();
  if (!nama || !kaderId) { showError('Nama dan Kader wajib diisi!'); return; }

  if (nik && !/^\d+$/.test(nik)) { showError('NIK harus berupa angka!'); return; }

  if (!nik) {
    const confirmSave = await showAppConfirm('Data tanpa NIK akan tetap disimpan sebagai "bermasalah". Lanjutkan perubahan?', {
      title: 'Simpan Perubahan',
      confirmText: 'Tetap Simpan'
    });
    if (!confirmSave) return;
  } else if (nik.length !== 16) {
    const kondisiDigit = nik.length < 16 ? 'kurang' : 'lebih';
    const confirmSave = await showAppConfirm(`NIK ${kondisiDigit} dari 16 digit (${nik.length} digit). Data akan tetap disimpan sebagai "bermasalah". Lanjutkan perubahan?`, {
      title: 'Periksa NIK',
      confirmText: 'Tetap Simpan'
    });
    if (!confirmSave) return;
  }

  lockSubmitButton();

  try {
    const res = await PemilihAPI.edit(id, { nama, nik, kaderId, tanggalLahir, jenisKelamin, rt, rw });
    if (res.error) { showError(res.error); unlockSubmitButton(); return; }

    showSuccess('Data berhasil diperbarui!');
    showToast('✅ Data pemilih diperbarui!');
    setTimeout(() => { window.location.href = '/'; }, 1500);
  } catch (e) {
    showError('Terjadi kesalahan jaringan. Coba lagi.');
    unlockSubmitButton();
  }
}

// ── Helpers ───────────────────────────────────────────
function resetFormPemilih() {
  ['inp-nama','inp-nik','inp-tgl-lahir','inp-rt','inp-rw'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  const sel = document.getElementById('inp-kader');
  if (sel) sel.value = '';
  const jk = document.getElementById('inp-jk');
  if (jk) jk.value = '';
  const umur = document.getElementById('display-umur');
  if (umur) umur.textContent = '';
  const nikStatus = document.getElementById('nik-status');
  if (nikStatus) { nikStatus.className = 'nik-status'; nikStatus.textContent = ''; }
}

function showError(msg) {
  const el = document.getElementById('alert-error');
  if (!el) return;
  el.textContent = '❌ ' + msg;
  el.classList.add('show');
  // Scroll ke alert agar user pasti lihat
  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function showSuccess(msg) {
  const el = document.getElementById('alert-success');
  if (!el) return;
  el.textContent = '✅ ' + msg;
  el.classList.add('show');
}

function hideAlerts() {
  document.getElementById('alert-error')?.classList.remove('show');
  document.getElementById('alert-success')?.classList.remove('show');
}
