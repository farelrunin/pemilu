async function isiNomorKaderOtomatis() {
  const nomorInput = document.getElementById('kader-nomor');
  if (!nomorInput) return;

  nomorInput.value = '';
  nomorInput.placeholder = 'Memuat nomor berikutnya...';

  try {
    const kaders = await KaderAPI.getAll();
    const nextNomor = (Array.isArray(kaders) ? kaders : [])
      .reduce((maxNomor, kader) => Math.max(maxNomor, Number(kader.nomor) || 0), 0) + 1;

    nomorInput.value = String(nextNomor);
    nomorInput.placeholder = 'Nomor kader otomatis';
  } catch (error) {
    nomorInput.placeholder = 'Isi manual jika nomor otomatis gagal dimuat';
  }
}

async function isiKoordinatorDropdown(selectedId = '', selectedName = '') {
  const select = document.getElementById('kader-koordinator');
  if (!select || typeof populateKoordinatorSelect !== 'function') return;

  await populateKoordinatorSelect('kader-koordinator', selectedId, selectedName);
}

async function submitTambahKader() {
  const nama = document.getElementById('kader-nama').value.trim();
  const nomor = document.getElementById('kader-nomor').value;
  const dusun = document.getElementById('kader-dusun').value.trim();
  const koordinatorId = document.getElementById('kader-koordinator').value;

  hideKaderAlerts();

  // Validasi ketat untuk cegah typo dan injection
  if (!nama || nama.length > 100 || !/^[a-zA-Z\s]+$/.test(nama)) {
    showKaderError('Nama kader harus diisi, maksimal 100 karakter, hanya huruf dan spasi!');
    return;
  }
  if (!nomor || parseInt(nomor, 10) < 1 || parseInt(nomor, 10) > 9999) {
    showKaderError('Nomor kader harus angka positif, maksimal 9999!');
    return;
  }
  if (!dusun || dusun.length > 100 || !/^[a-zA-Z0-9\s\-.,]+$/.test(dusun)) {
    showKaderError('Nama dusun harus diisi, maksimal 100 karakter, hanya huruf, angka, spasi, strip, titik, koma!');
    return;
  }
  if (!koordinatorId || !/^[a-z0-9-]{1,36}$/i.test(koordinatorId)) {
    showKaderError('Koordinator harus dipilih dengan benar!');
    return;
  }

  const res = await KaderAPI.tambah({ nama, nomor, dusun, koordinatorId });
  if (res.error) {
    if (String(res.error).toLowerCase().includes('terdaftar')) {
      await isiNomorKaderOtomatis();
    }
    showKaderError(res.error);
    return;
  }

  showKaderSuccess(`Kader ${nomor} - ${nama} berhasil ditambahkan!`);
  document.getElementById('kader-nama').value = '';
  document.getElementById('kader-nomor').value = '';
  document.getElementById('kader-dusun').value = '';
  document.getElementById('kader-koordinator').value = '';

  await isiNomorKaderOtomatis();
  showToast(`OK Kader ${nomor} berhasil disimpan!`);
  setTimeout(() => { window.location.href = '/kader'; }, 1500);
}

async function submitEditKader() {
  const id = document.getElementById('edit-id').value;
  const nama = document.getElementById('kader-nama').value.trim();
  const nomor = document.getElementById('kader-nomor').value;
  const dusun = document.getElementById('kader-dusun').value.trim();
  const koordinatorId = document.getElementById('kader-koordinator').value;

  hideKaderAlerts();
  if (!nama || !nomor || !dusun || !koordinatorId) {
    showKaderError('Nama, nomor, dusun, dan koordinator wajib diisi!');
    return;
  }

  const res = await KaderAPI.edit(id, { nama, nomor, dusun, koordinatorId });
  if (res.error) {
    showKaderError(res.error);
    return;
  }

  showKaderSuccess('Kader berhasil diperbarui!');
  showToast('OK Data kader diperbarui!');
  setTimeout(() => { window.location.href = '/kader'; }, 1500);
}

function showKaderError(msg) {
  const el = document.getElementById('alert-error');
  if (!el) return;
  el.textContent = 'ERROR ' + msg;
  el.classList.add('show');
}

function showKaderSuccess(msg) {
  const el = document.getElementById('alert-success');
  if (!el) return;
  el.textContent = 'OK ' + msg;
  el.classList.add('show');
}

function hideKaderAlerts() {
  document.getElementById('alert-error')?.classList.remove('show');
  document.getElementById('alert-success')?.classList.remove('show');
}

document.addEventListener('DOMContentLoaded', async () => {
  await isiKoordinatorDropdown();
  if (document.getElementById('kader-nomor') && !document.getElementById('edit-id')) {
    await isiNomorKaderOtomatis();
  }
});
