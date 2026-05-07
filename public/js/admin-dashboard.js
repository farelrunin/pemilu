// admin-dashboard.js — Admin dashboard logic

async function requireAdminDashboard() {
  try {
    const response = await fetchWithAuth('/api/admin/check', { method: 'GET' });
    if (!response.ok) throw new Error('Akses admin ditolak');
    return await response.json();
  } catch (error) {
    window.location.href = '/login.html';
    return null;
  }
}

function formatDateTime(value) {
  if (!value) return '-';
  return new Date(value).toLocaleString('id-ID', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit'
  });
}

function showToast(message, emoji = '✅') {
  const toast = document.getElementById('toast');
  toast.textContent = `${emoji} ${message}`;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 3000);
}

async function loadAdminStats() {
  const usersRes = await fetchWithAuth('/api/admin/users');
  if (!usersRes.ok) throw new Error('Gagal mengambil data user');
  const users = await usersRes.json();

  const totalUsers = users.length;
  const adminCount = users.filter(u => u.role === 'Superadmin' || u.role === 'admin').length;
  const normalCount = totalUsers - adminCount;

  document.getElementById('stat-total-users').textContent = totalUsers;
  document.getElementById('stat-active-users').textContent = totalUsers;
  document.getElementById('stat-login-history').textContent = 'Data login ada di backend';

  const tbody = document.getElementById('tbody-admin-users');
  tbody.innerHTML = '';
  users.slice(0, 8).forEach((user, index) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${index + 1}</td>
      <td>${user.username}</td>
      <td>${user.role}</td>
      <td>${formatDateTime(user.created_at)}</td>
    `;
    tbody.appendChild(tr);
  });
  if (!users.length) {
    tbody.innerHTML = '<tr><td colspan="4">Belum ada user</td></tr>';
  }
}

async function loadLoginHistory() {
  const table = document.getElementById('tbody-login-history');
  table.innerHTML = '<tr><td colspan="3"><div class="loading"><span class="spinner"></span> Memuat…</div></td></tr>';

  try {
    const response = await fetchWithAuth('/api/admin/login-history');
    if (!response.ok) throw new Error('Gagal mengambil login history');
    const history = await response.json();
    table.innerHTML = '';

    if (!history.length) {
      table.innerHTML = '<tr><td colspan="3">Belum ada riwayat login</td></tr>';
      return;
    }

    history.slice(0, 8).forEach(item => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${formatDateTime(item.login_at)}</td>
        <td>${item.username || item.user_id}</td>
        <td>${item.success ? 'Sukses' : 'Gagal'}</td>
      `;
      table.appendChild(tr);
    });
  } catch (error) {
    table.innerHTML = '<tr><td colspan="3">Tidak dapat memuat login history</td></tr>';
  }
}

async function loadImportHistory() {
  const table = document.getElementById('tbody-import-history');
  table.innerHTML = '<tr><td colspan="3"><div class="loading"><span class="spinner"></span> Memuat…</div></td></tr>';

  try {
    const response = await fetchWithAuth('/api/admin/import-history');
    if (!response.ok) throw new Error('Gagal mengambil riwayat impor');
    const logs = await response.json();
    table.innerHTML = '';

    if (!logs.length) {
      table.innerHTML = '<tr><td colspan="3">Belum ada riwayat impor</td></tr>';
      return;
    }

    logs.slice(0, 8).forEach(item => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${formatDateTime(item.imported_at)}</td>
        <td>${item.username || item.user_id}</td>
        <td>${item.imported_count}</td>
      `;
      table.appendChild(tr);
    });
  } catch (error) {
    table.innerHTML = '<tr><td colspan="3">Tidak dapat memuat riwayat impor</td></tr>';
  }
}

async function initAdminDashboard() {
  try {
    await requireAdminDashboard();
    await loadAdminStats();
    await loadLoginHistory();
    await loadImportHistory();
  } catch (error) {
    showToast(error.message, '❌');
  }
}

window.addEventListener('DOMContentLoaded', initAdminDashboard);
