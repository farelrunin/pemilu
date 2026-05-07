const KoordinatorAPI = {
  async getAll(q = '') {
    const params = new URLSearchParams();
    if (q) params.set('q', q);
    const qs = params.toString();
    const res = await fetchWithAuth(`/api/koordinator${qs ? `?${qs}` : ''}`);
    return res.json();
  },

  async tambah(data) {
    const res = await fetchWithAuth('/api/koordinator', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    return res.json();
  },

  async edit(id, data) {
    const res = await fetchWithAuth(`/api/koordinator/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    return res.json();
  },

  async hapus(id) {
    const res = await fetchWithAuth(`/api/koordinator/${id}`, { method: 'DELETE' });
    return res.json();
  }
};

async function populateKoordinatorSelect(selectId = 'kader-koordinator', selectedId = '', selectedName = '') {
  const sel = document.getElementById(selectId);
  if (!sel) return;

  const data = await KoordinatorAPI.getAll();
  const koordinator = Array.isArray(data) ? data : [];

  if (!koordinator.length) {
    sel.innerHTML = '<option value="">Belum ada koordinator</option>';
    return;
  }

  sel.innerHTML = '<option value="">- Pilih Koordinator -</option>' +
    koordinator.map(item => {
      const isSelected = item.id === selectedId || (!selectedId && selectedName && item.nama === selectedName);
      return `<option value="${item.id}" ${isSelected ? 'selected' : ''}>${item.nama}</option>`;
    }).join('');
}
