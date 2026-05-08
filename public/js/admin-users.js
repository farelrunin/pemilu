// ════════════════════════════════════════
//  admin-users.js — Manage User (v1)
// ════════════════════════════════════════

let users = [];
let currentEditId = null;

// ── Init ──────────────────────────────────
async function initAdmin() {
  // Cek apakah user adalah admin
  const adminCheck = await fetchWithAuth('/api/admin/check', { method: 'GET' });
  if (!adminCheck.ok) {
    window.location.href = '/';
    return;
  }

  loadUsers();
}

// ── Load Users ────────────────────────────
async function loadUsers() {
  try {
    const res = await fetchWithAuth('/api/admin/users', { method: 'GET' });
    if (!res.ok) throw new Error('Gagal mengambil data user');
    users = await res.json();
    renderUsers();
  } catch (e) {
    showError('Gagal memuat user: ' + e.message);
  }
}

// ── Render Users ──────────────────────────
function renderUsers() {
  const tbody = document.getElementById('tbody-users');
  tbody.innerHTML = '';

  if (!Array.isArray(users) || users.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" class="text-center">Belum ada user.</td></tr>';
    return;
  }

  users.forEach((u, idx) => {
    const tr = document.createElement('tr');

    const td1 = document.createElement('td');
    td1.textContent = idx + 1;
    tr.appendChild(td1);

    const td2 = document.createElement('td');
    td2.textContent = u.username || '-';
    tr.appendChild(td2);

    const td3 = document.createElement('td');
    const badge = document.createElement('span');
    let roleClass = 'badge-blue';
    let roleLabel = u.role;
    
    if (u.role === 'Superadmin') { roleClass = 'badge-orange'; roleLabel = 'Superadmin'; }
    else if (u.role === 'AdminKantor') { roleClass = 'badge-green'; roleLabel = 'Admin Kantor'; }
    else if (u.role === 'Kader') { roleClass = 'badge-blue'; roleLabel = 'Kader'; }
    else if (u.role === 'User') { roleClass = 'badge-gray'; roleLabel = 'User (Read-only)'; }
    
    badge.className = 'badge ' + roleClass;
    badge.textContent = roleLabel;
    td3.appendChild(badge);
    tr.appendChild(td3);

    const td4 = document.createElement('td');
    td4.textContent = formatDate(u.created_at);
    tr.appendChild(td4);

    const td5 = document.createElement('td');
    const div = document.createElement('div');
    div.style.display = 'flex';
    div.style.gap = '8px';

    const editBtn = document.createElement('button');
    editBtn.className = 'btn btn-outline btn-xs';
    editBtn.textContent = '✏️ Edit';
    editBtn.addEventListener('click', () => openModalUser(u.id, u.username, u.role));
    div.appendChild(editBtn);

    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'btn btn-danger btn-xs';
    deleteBtn.textContent = '🗑️ Hapus';
    deleteBtn.addEventListener('click', () => confirmDeleteUser(u.id, u.username));
    div.appendChild(deleteBtn);

    td5.appendChild(div);
    tr.appendChild(td5);

    tbody.appendChild(tr);
  });
}

// ── Modal Functions ───────────────────────
function openModalUser(id = null, username = '', role = 'User') {
  currentEditId = id;
  document.getElementById('modal-title').textContent = id ? 'Edit Password User' : 'Tambah User Baru';
  document.getElementById('modal-username').value = username;
  document.getElementById('modal-username').disabled = !!id; // Username tidak bisa diubah
  document.getElementById('modal-password').value = '';
  document.getElementById('modal-password').placeholder = id ? 'Kosongkan jika tidak ingin ubah' : 'Minimal 6 karakter';
  document.getElementById('modal-role').value = role;
  document.getElementById('modal-alert').textContent = '';
  document.getElementById('modal-user').classList.add('is-open');
}

function closeModalUser() {
  document.getElementById('modal-user').classList.remove('is-open');
  currentEditId = null;
}

// ── Save User ─────────────────────────────
async function saveUser() {
  const username = document.getElementById('modal-username').value.trim();
  const password = document.getElementById('modal-password').value;
  const role = document.getElementById('modal-role').value;
  const alert = document.getElementById('modal-alert');

  alert.textContent = '';

  if (!username || !/^[a-zA-Z0-9_]+$/.test(username)) {
    alert.textContent = '❌ Username tidak valid! (hanya huruf, angka, underscore)';
    return;
  }

  if (!currentEditId && (!password || password.length < 6)) {
    alert.textContent = '❌ Password harus minimal 6 karakter!';
    return;
  }

  try {
    const method = currentEditId ? 'PUT' : 'POST';
    const url = currentEditId ? `/api/admin/users/${currentEditId}` : '/api/admin/users';
    const body = currentEditId ? { password } : { username, password, role };

    const res = await fetchWithAuth(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    if (!res.ok) {
      const err = await res.json();
      alert.textContent = '❌ ' + (err.error || 'Gagal menyimpan user');
      return;
    }

    closeModalUser();
    showToast(currentEditId ? '✅ Password berhasil diubah!' : '✅ User berhasil ditambahkan!');
    loadUsers();
  } catch (e) {
    alert.textContent = '❌ Error: ' + e.message;
  }
}

// ── Delete User ───────────────────────────
async function confirmDeleteUser(id, username) {
  if (!confirm(`Hapus user "${username}"? Ini tidak bisa dibatalkan.`)) return;

  try {
    const res = await fetchWithAuth(`/api/admin/users/${id}`, { method: 'DELETE' });
    if (!res.ok) throw new Error('Gagal menghapus user');

    showToast('✅ User berhasil dihapus!');
    loadUsers();
  } catch (e) {
    showToast('❌ ' + e.message, '❌');
  }
}

// ── Helpers ───────────────────────────────
function formatDate(ts) {
  if (!ts) return '-';
  return new Date(ts).toLocaleString('id-ID', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function showError(msg) {
  const el = document.getElementById('alert-error');
  if (!el) return;
  el.textContent = '❌ ' + msg;
  el.classList.add('show');
}

function showSuccess(msg) {
  const el = document.getElementById('alert-success');
  if (!el) return;
  el.textContent = '✅ ' + msg;
  el.classList.add('show');
}

// ── Event Listeners ───────────────────────
document.getElementById('btnTambahUser')?.addEventListener('click', () => openModalUser());

// ── Init on load ──────────────────────────
document.addEventListener('DOMContentLoaded', initAdmin);
