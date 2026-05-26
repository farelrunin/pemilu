// ════════════════════════════════════════════════════
//  tps.js — API Client untuk TPS Comparison
// ════════════════════════════════════════════════════

const TPS_API = {
  // 1️⃣ Upload data TPS
  uploadTPS: async (file, namaTps) => {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('nama_tps', namaTps);

    const res = await fetch('/api/tps/upload', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${getToken()}` },
      body: formData
    });

    if (!res.ok) {
      const error = await res.json();
      throw new Error(error.error || 'Upload gagal');
    }

    return res.json();
  },

  // 2️⃣ List TPS yang sudah di-upload
  listTPS: async (page = 1, limit = 20) => {
    const res = await fetch(`/api/tps/list?page=${page}&limit=${limit}`, {
      headers: { 'Authorization': `Bearer ${getToken()}` }
    });

    if (!res.ok) {
      const error = await res.json();
      throw new Error(error.error || 'List TPS gagal');
    }

    return res.json();
  },

  getTPSData: async (namaTps, page = 1, limit = 100, q = '') => {
    let url = `/api/tps/${encodeURIComponent(namaTps)}/data?page=${page}&limit=${limit}`;
    if (q) url += `&q=${encodeURIComponent(q)}`;
    const res = await fetch(url, {
      headers: { 'Authorization': `Bearer ${getToken()}` }
    });

    if (!res.ok) {
      const error = await res.json();
      throw new Error(error.error || 'Detail TPS gagal dimuat');
    }

    return res.json();
  },

  updateTPSRow: async (id, payload) => {
    const res = await fetch(`/api/tps/data/${id}`, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${getToken()}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    if (!res.ok) {
      const error = await res.json();
      throw new Error(error.error || 'Update data TPS gagal');
    }

    return res.json();
  },

  deleteTPSRow: async (id) => {
    const res = await fetch(`/api/tps/data/${id}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${getToken()}` }
    });

    if (!res.ok) {
      const error = await res.json();
      throw new Error(error.error || 'Hapus baris TPS gagal');
    }

    return res.json();
  },

  deleteTPSGroup: async (namaTps) => {
    const res = await fetch(`/api/tps/${encodeURIComponent(namaTps)}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${getToken()}` }
    });

    if (!res.ok) {
      const error = await res.json();
      throw new Error(error.error || 'Hapus TPS gagal');
    }

    return res.json();
  },

  // 3️⃣ Trigger perbandingan
  triggerPerbandingan: async (namaTps) => {
    const res = await fetch(`/api/tps/${encodeURIComponent(namaTps)}/perbandingan`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${getToken()}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({})
    });

    if (!res.ok) {
      const error = await res.json();
      throw new Error(error.error || 'Perbandingan gagal');
    }

    return res.json();
  },

  // 4️⃣ Get hasil perbandingan
  getHasilPerbandingan: async (namaTps, page = 1, limit = 50, status = null, sort = null) => {
    let url = `/api/tps/${encodeURIComponent(namaTps)}/hasil?page=${page}&limit=${limit}`;
    if (status) url += `&status=${status}`;
    if (sort) url += `&sort=${sort}`;

    const res = await fetch(url, {
      headers: { 'Authorization': `Bearer ${getToken()}` }
    });

    if (!res.ok) {
      const error = await res.json();
      throw new Error(error.error || 'Get hasil gagal');
    }

    return res.json();
  },

  // 5️⃣ Get statistik TPS
  getStatistik: async () => {
    const res = await fetch('/api/tps/statistik', {
      headers: { 'Authorization': `Bearer ${getToken()}` }
    });

    if (!res.ok) {
      const error = await res.json();
      throw new Error(error.error || 'Get statistik gagal');
    }

    return res.json();
  }
};

// Utility function dari auth.js
function getToken() {
  const token = localStorage.getItem('token');
  if (!token) {
    window.location.href = '/login';
  }
  return token;
}
