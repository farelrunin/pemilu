// ════════════════════════════════════════
//  kader.js — API calls untuk Kader
// ════════════════════════════════════════

const KaderAPI = {

  async getAll() {
    const res = await fetchWithAuth('/api/kader');
    return res.json();
  },

  async getById(id) {
    const res = await fetchWithAuth(`/api/kader/${id}`);
    return res.json();
  },

  async tambah(data) {
    const res = await fetchWithAuth('/api/kader', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    return res.json();
  },

  async edit(id, data) {
    const res = await fetchWithAuth(`/api/kader/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    return res.json();
  },

  async hapus(id) {
    const res = await fetchWithAuth(`/api/kader/${id}`, { method: 'DELETE' });
    return res.json();
  }
};

// ── Render select/dropdown kader ─────────────────────
async function populateKaderSelect(selectId = 'inp-kader', selectedId = '') {
  const sel = document.getElementById(selectId);
  if (!sel) return;
  const kaders = await KaderAPI.getAll();
  sel.innerHTML = '<option value="">— Pilih Kader —</option>' +
    kaders.map(k =>
      `<option value="${k.id}" ${k.id === selectedId ? 'selected' : ''}>
        Kader ${k.nomor} — ${k.nama}
      </option>`
    ).join('');
}

// ── Render tabel kader ───────────────────────────────
function renderTabelKader(data, tbodyId = 'tbody-kader') {
  const tbody = document.getElementById(tbodyId);
  if (!tbody) return;

  if (data.length === 0) {
    tbody.innerHTML = `<tr><td colspan="4">
      <div class="empty"><div class="empty-icon">🎖️</div><p>Belum ada kader.</p></div>
    </td></tr>`;
    return;
  }

  tbody.innerHTML = data.map(k => `
    <tr>
      <td><span class="badge badge-blue">Kader ${k.nomor}</span></td>
      <td style="font-weight:600;color:var(--text);">${k.nama}</td>
      <td><span class="badge badge-green">${k.jumlahPemilih} pemilih</span></td>
      <td>
        <div class="gap-12">
          <a href="/edit-kader?id=${k.id}" class="btn btn-outline btn-xs">✏️ Edit</a>
          <button class="btn btn-danger btn-xs" onclick="konfirmasiHapusKader('${k.id}','${k.nama}',${k.nomor})">🗑️</button>
        </div>
      </td>
    </tr>
  `).join('');
}

async function konfirmasiHapusKader(id, nama, nomor) {
  // Dialog dengan 3 pilihan: Batal, Hapus Isi, Hapus Kader
  const choice = prompt(
    `Pilih aksi untuk Kader ${nomor} — ${nama}:\n\n` +
    `1 = Hapus hanya isi kader (pemilih)\n` +
    `2 = Hapus kader + semua pemilih\n` +
    `0 atau Cancel = Batalkan\n\n` +
    `Masukkan pilihan (0/1/2):`,
    '0'
  );

  if (!choice || choice === '0' || choice === 'Cancel') return;

  if (choice === '1') {
    // Hapus hanya isi kader (pemilih)
    if (!confirm(`Hapus semua data pemilih dalam Kader ${nomor} — ${nama}?\n\nIni tidak dapat dibatalkan!`)) return;
    
    try {
      const res = await fetchWithAuth(`/api/kader/${id}/pemilih/clear`, { method: 'DELETE' });
      const result = await res.json();
      if (result.error) {
        showToast(result.error, '❌');
        return;
      }
      showToast(`Semua data pemilih dalam Kader ${nomor} dihapus`, '🗑️');
      if (typeof loadKader === 'function') loadKader();
      if (typeof updateHeaderStats === 'function') updateHeaderStats();
    } catch (e) {
      showToast(e.message, '❌');
    }
  } else if (choice === '2') {
    // Hapus kader + semua isi
    if (!confirm(
      `Hapus Kader ${nomor} — ${nama} + semua data pemilih (${parseInt(nomor)} orang)?\n\n` +
      `⚠️ PERHATIAN: Data akan dihapus PERMANEN!\n\n` +
      `Klik OK untuk melanjutkan, atau Cancel untuk batal.`
    )) return;

    try {
      const res = await KaderAPI.hapus(id);
      if (res.success) {
        showToast(`Kader ${nomor} — ${nama} dan semua datanya dihapus`, '🗑️');
        if (typeof loadKader === 'function') loadKader();
        if (typeof updateHeaderStats === 'function') updateHeaderStats();
      } else {
        showToast(res.error || 'Gagal menghapus', '❌');
      }
    } catch (e) {
      showToast(e.message, '❌');
    }
  } else {
    showToast('Pilihan tidak valid', '⚠️');
  }
}
