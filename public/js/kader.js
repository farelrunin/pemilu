// ════════════════════════════════════════
//  kader.js — API calls untuk Kader
// ════════════════════════════════════════

const KaderAPI = {

  async getAll(params = {}) {
    const qs = new URLSearchParams();
    if (params.q) qs.set('q', params.q);
    if (params.koordinatorId) qs.set('koordinatorId', params.koordinatorId);
    const query = qs.toString();
    const res = await fetchWithAuth(`/api/kader${query ? `?${query}` : ''}`);
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
        Kader ${k.nomor} — ${k.nama} (${k.namaKoordinator || k.kordus || '-'})
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
          <a href="/view-kader?id=${k.id}" class="btn btn-outline btn-xs" aria-label="Lihat detail kader ${k.nama}">👁️</a>
          <a href="/edit-kader?id=${k.id}" class="btn btn-outline btn-xs">✏️ Edit</a>
          <button class="btn btn-danger btn-xs" onclick="konfirmasiHapusKader('${k.id}','${k.nama}',${k.nomor})">🗑️</button>
        </div>
      </td>
    </tr>
  `).join('');
}

async function konfirmasiHapusKader(id, nama, nomor) {
  const choice = await showAppChoiceDialog(
    `Pilih aksi untuk Kader ${nomor} - ${nama}.`,
    [
      {
        value: '1',
        label: 'Hapus isi kader',
        description: 'Kader tetap ada, hanya data pemilih di dalamnya yang dihapus.',
        className: 'btn-outline'
      },
      {
        value: '2',
        label: 'Hapus kader + semua pemilih',
        description: 'Kader dan seluruh data pemilihnya dihapus permanen.',
        className: 'btn-danger'
      }
    ],
    { title: 'Aksi Hapus Kader' }
  );

  if (!choice) return;

  if (choice === '1') {
    const confirmDelete = await showAppConfirm(`Hapus semua data pemilih dalam Kader ${nomor} - ${nama}?`, {
      title: 'Hapus Isi Kader',
      confirmText: 'Hapus Isi',
      confirmClassName: 'btn-danger',
      dangerNote: 'Semua data pemilih dalam kader ini akan dihapus permanen.'
    });
    if (!confirmDelete) return;
    
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
    const confirmDelete = await showAppConfirm(`Hapus Kader ${nomor} - ${nama} beserta semua data pemilihnya?`, {
      title: 'Hapus Kader Permanen',
      confirmText: 'Hapus Permanen',
      confirmClassName: 'btn-danger',
      dangerNote: 'Kader dan seluruh data pemilihnya akan dihapus permanen dan tidak bisa dikembalikan.'
    });
    if (!confirmDelete) return;

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

// ── Searchable Select Kader (Reusable) ──────────────
async function initKaderSearchableSelect(config = {}) {
  const {
    searchInputId = 'inp-kader-search',
    selectId      = 'inp-kader',
    metaId        = 'kader-search-meta',
    initialId     = ''
  } = config;

  const searchInput = document.getElementById(searchInputId);
  const select      = document.getElementById(selectId);
  const meta        = document.getElementById(metaId);

  if (!searchInput || !select) return;

  function formatKaderOption(k) {
    return `Kader ${k.nomor} — ${k.nama} (${k.namaKoordinator || k.kordus || '-'})`;
  }

  function renderOptions(kaders, selectedId = '') {
    const activeValue = selectedId || select.value || '';
    select.innerHTML = '<option value="">— Pilih Kader —</option>' +
      kaders.map(k => `
        <option value="${k.id}" ${k.id === activeValue ? 'selected' : ''}>
          ${formatKaderOption(k)}
        </option>
      `).join('');

    if (meta) {
      meta.textContent = kaders.length
        ? `${kaders.length} kader ditemukan.`
        : 'Tidak ada kader yang cocok.';
    }
  }

  async function loadAndRender(keyword = '', selectedId = '') {
    try {
      const kaders = await KaderAPI.getAll(keyword ? { q: keyword } : {});
      renderOptions(kaders, selectedId);
      return kaders;
    } catch (err) {
      if (meta) meta.textContent = 'Gagal memuat daftar kader.';
      return [];
    }
  }

  // Event: Input search
  let searchTimeout = null;
  searchInput.addEventListener('input', (e) => {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => {
      loadAndRender(e.target.value.trim());
    }, 200);
  });

  // Event: Select change (update search field)
  select.addEventListener('change', () => {
    const opt = select.selectedOptions[0];
    if (opt && select.value) {
      searchInput.value = opt.textContent.trim();
    }
  });

  // Initial load
  const initialKaders = await loadAndRender('', initialId);
  if (initialId) {
    const found = initialKaders.find(k => k.id === initialId);
    if (found) searchInput.value = formatKaderOption(found);
  }
}
