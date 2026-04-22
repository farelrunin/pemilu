// ════════════════════════════════════════
//  auth.js — Otentikasi & JWT Helper Frontend
// ════════════════════════════════════════

// ── 1. Cek Login Otomatis di setiap halaman (kecuali login) ──
const isLoginPage = window.location.pathname === '/login';
const token = localStorage.getItem('token');
const userRole = localStorage.getItem('userRole');

if (!token && !isLoginPage) {
  // Belum login, tendang ke halaman login
  window.location.href = '/login';
} else if (token && isLoginPage) {
  // Sudah login tapi akses halaman login, tendang ke dashboard
  window.location.href = '/';
}

// ── 2. Helper Fetch dengan Bearer Token ──
window.fetchWithAuth = async function(url, options = {}) {
  // Pastikan headers ada
  if (!options.headers) {
    options.headers = {};
  }
  
  // Tambahkan Authorization token jika ada (dan bukan hapus multipart form data)
  const isFormData = options.body instanceof FormData;
  if (!isFormData && !options.headers['Content-Type']) {
    options.headers['Content-Type'] = 'application/json';
  }
  
  if (token) {
    options.headers['Authorization'] = `Bearer ${token}`;
  }

  try {
    const response = await fetch(url, options);
    
    // Jika token kadaluarsa atau tidak valid (401), tendang ke login
    if (response.status === 401 && !isLoginPage) {
      localStorage.removeItem('token');
      localStorage.removeItem('userRole');
      localStorage.removeItem('username');
      localStorage.removeItem('namaKader');
      window.location.href = '/login?expired=1';
    }
    
    return response;
  } catch (error) {
    console.error('Fetch Error:', error);
    throw error;
  }
};

// ── 3. Logout ──
window.logout = function() {
  localStorage.clear();
  window.location.href = '/login';
};

// ── 4. UI Manipulation (Render info user & kosmetik admin) ──
document.addEventListener('DOMContentLoaded', () => {
  if (isLoginPage) return;

  // Render info user di header
  const username = localStorage.getItem('username') || '';
  const namaKader = localStorage.getItem('namaKader') && localStorage.getItem('namaKader') !== 'null' 
    ? localStorage.getItem('namaKader') 
    : userRole; // Jika null (Superadmin), tampilkan role

  const headerStats = document.querySelector('.header-stats');
  const headerUserSlot = document.querySelector('.header-user-slot');
  const headerNav = document.querySelector('.nav');
  if (headerUserSlot || headerStats || headerNav) {
    const userHtml = `
      <div class="user-profile">
        <div>
          <div class="u-name">${username}</div>
          <div class="u-role">${namaKader}</div>
        </div>
        <button onclick="logout()" class="btn btn-outline btn-sm btn-danger" style="padding:4px 8px;">Logout</button>
      </div>
    `;

    if (headerUserSlot) {
      headerUserSlot.insertAdjacentHTML('beforeend', userHtml);
    } else if (headerStats) {
      headerStats.insertAdjacentHTML('beforeend', userHtml);
    } else {
      headerNav.insertAdjacentHTML('beforeend', userHtml);
    }
  }

  // Kosmetik RBAC: Sembunyikan elemen Superadmin / Admin Kantor sesuai role
  if (userRole === 'Kader') {
    document.querySelectorAll('.superadmin-only, .admin-only').forEach(el => el.style.display = 'none');
  } else if (userRole === 'AdminKantor') {
    // Admin Kantor tidak perlu lihat log duplikat / fitur superadmin
    document.querySelectorAll('.superadmin-only').forEach(el => el.style.display = 'none');
  }

  // Pastikan bila user klik back setelah logout, mereka langsung diarahkan login lagi
  window.addEventListener('pageshow', (event) => {
    const navType = performance.getEntriesByType('navigation')[0];
    const isBack = event.persisted || (navType && navType.type === 'back_forward');
    if (isBack && !token && !isLoginPage) {
      window.location.replace('/login');
    }
  });
});
