// ════════════════════════════════════════
//  pemilih.js — API calls untuk Pemilih (v2)
// ════════════════════════════════════════

const PemilihAPI = {

  async getAll(query = '', kaderId = '', page = 1, limit = 50, statusFilter = '') {
    const params = new URLSearchParams();
    if (query)   params.set('q', query);
    if (kaderId) params.set('kaderId', kaderId);
    if (statusFilter) params.set('statusFilter', statusFilter);
    params.set('page', page);
    params.set('limit', limit);
    const res = await fetchWithAuth(`/api/pemilih?${params}`);
    return res.json();
  },

  async getById(id) {
    const res = await fetchWithAuth(`/api/pemilih/${id}`);
    return res.json();
  },

  async cekNIK(nik) {
    const res = await fetchWithAuth(`/api/pemilih/cek-nik/${nik}`);
    return res.json();
  },

  async tambah(data) {
    const res = await fetchWithAuth('/api/pemilih', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    return { status: res.status, ...(await res.json()) };
  },

  async edit(id, data) {
    const res = await fetchWithAuth(`/api/pemilih/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    return res.json();
  },

  async hapus(id) {
    const res = await fetchWithAuth(`/api/pemilih/${id}`, { method: 'DELETE' });
    return res.json();
  },

  async importExcel(formData) {
    const res = await fetchWithAuth('/api/pemilih/import', {
      method: 'POST',
      body: formData
    });
    return res.json();
  },

  async previewImport(formData) {
    const res = await fetchWithAuth('/api/pemilih/import/preview', {
      method: 'POST',
      body: formData
    });
    return res.json();
  }
};

async function konfirmasiHapusPemilih(id, nama) {
  const confirmDelete = await showAppConfirm(`Hapus data pemilih "${nama}"?`, {
    title: 'Hapus Pemilih',
    confirmText: 'Hapus',
    confirmClassName: 'btn-danger',
    dangerNote: 'Data pemilih yang dihapus tidak bisa dikembalikan.'
  });
  if (!confirmDelete) return;
  const res = await PemilihAPI.hapus(id);
  if (res.success) {
    showToast(`${nama} berhasil dihapus.`, '🗑️');
    if (typeof loadPemilih === 'function') loadPemilih();
    if (typeof loadTabel === 'function') loadTabel();
    if (typeof updateHeaderStats === 'function') updateHeaderStats();
  } else {
    showToast(res.error || 'Gagal menghapus.', '❌');
  }
}
