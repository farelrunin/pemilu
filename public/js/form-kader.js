// ════════════════════════════════════════
//  form-kader.js — Logic Form Kader (v2)
// ════════════════════════════════════════

// ── Submit form TAMBAH KADER ──────────────────────────
async function submitTambahKader() {
  const nama  = document.getElementById('kader-nama').value.trim();
  const nomor = document.getElementById('kader-nomor').value;
  const dusun = document.getElementById('kader-dusun').value.trim();
  const kordus = document.getElementById('kader-kordus').value.trim();
  const targetSuara = document.getElementById('kader-target')?.value || 0;

  hideKaderAlerts();
  if (!nama || !nomor || !dusun || !kordus) {
    showKaderError('Nama, nomor, dusun, dan kordus wajib diisi!'); return;
  }
  if (parseInt(nomor) < 1) {
    showKaderError('Nomor kader harus lebih dari 0!'); return;
  }

  const res = await KaderAPI.tambah({ nama, nomor, dusun, kordus, targetSuara });
  if (res.error) { showKaderError(res.error); return; }

  showKaderSuccess(`Kader ${nomor} — ${nama} berhasil ditambahkan!`);
  document.getElementById('kader-nama').value  = '';
  document.getElementById('kader-nomor').value = '';
  document.getElementById('kader-dusun').value = '';
  document.getElementById('kader-kordus').value = '';
  if (document.getElementById('kader-target')) document.getElementById('kader-target').value = '';
  showToast(`✅ Kader ${nomor} berhasil disimpan!`);
  setTimeout(() => { window.location.href = '/kader'; }, 1500);
}

// ── Submit form EDIT KADER ────────────────────────────
async function submitEditKader() {
  const id    = document.getElementById('edit-id').value;
  const nama  = document.getElementById('kader-nama').value.trim();
  const nomor = document.getElementById('kader-nomor').value;
  const dusun = document.getElementById('kader-dusun').value.trim();
  const kordus = document.getElementById('kader-kordus').value.trim();
  const targetSuara = document.getElementById('kader-target')?.value || 0;

  hideKaderAlerts();
  if (!nama || !nomor || !dusun || !kordus) {
    showKaderError('Nama, nomor, dusun, dan kordus wajib diisi!'); return;
  }

  const res = await KaderAPI.edit(id, { nama, nomor, dusun, kordus, targetSuara });
  if (res.error) { showKaderError(res.error); return; }

  showKaderSuccess('Kader berhasil diperbarui!');
  showToast('✅ Data kader diperbarui!');
  setTimeout(() => { window.location.href = '/kader'; }, 1500);
}

// ── Helpers ───────────────────────────────────────────
function showKaderError(msg) {
  const el = document.getElementById('alert-error');
  if (!el) return;
  el.textContent = '❌ ' + msg;
  el.classList.add('show');
}

function showKaderSuccess(msg) {
  const el = document.getElementById('alert-success');
  if (!el) return;
  el.textContent = '✅ ' + msg;
  el.classList.add('show');
}

function hideKaderAlerts() {
  document.getElementById('alert-error')?.classList.remove('show');
  document.getElementById('alert-success')?.classList.remove('show');
}
