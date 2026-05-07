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
  // Sudah login tapi akses halaman login
  // Jika Superadmin, bawa ke halaman admin khusus
  const userRole = localStorage.getItem('userRole');
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

// ── 3b. Load User Info ──
window.loadUserInfo = function() {
  const username = localStorage.getItem('username') || '';
  const userRole = localStorage.getItem('userRole') || '';
  const namaKader = localStorage.getItem('namaKader') || userRole;
  
  const userInfoEl = document.getElementById('userInfo');
  if (userInfoEl) {
    userInfoEl.innerHTML = `${username} (${namaKader})`;
  }
};

// ── 4. Get Token ──
window.getToken = function() {
  return localStorage.getItem('token');
};

// ── 4. UI Manipulation (Render info user & kosmetik admin) ──
window.showAppDialog = function(config = {}) {
  const previous = document.getElementById('app-dialog-overlay');
  if (previous) previous.remove();

  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.id = 'app-dialog-overlay';
    overlay.className = 'app-dialog-overlay is-open';

    const dialog = document.createElement('div');
    dialog.className = 'app-dialog card';
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    overlay.appendChild(dialog);

    const head = document.createElement('div');
    head.className = 'app-dialog-head';
    const title = document.createElement('h3');
    title.className = 'app-dialog-title';
    title.textContent = config.title || 'Konfirmasi';
    head.appendChild(title);
    dialog.appendChild(head);

    const body = document.createElement('div');
    body.className = 'app-dialog-body';
    body.textContent = config.message || '';
    dialog.appendChild(body);

    let inputEl = null;
    if (config.input) {
      inputEl = document.createElement('input');
      inputEl.className = 'app-dialog-input';
      inputEl.type = 'text';
      inputEl.value = config.inputValue || '';
      inputEl.placeholder = config.inputPlaceholder || '';
      dialog.appendChild(inputEl);
    }

    if (config.dangerNote) {
      const note = document.createElement('div');
      note.className = 'app-dialog-danger-note';
      note.textContent = config.dangerNote;
      dialog.appendChild(note);
    }

    let resolved = false;
    const cleanup = () => {
      overlay.classList.remove('is-open');
      overlay.remove();
      document.removeEventListener('keydown', onKeydown);
    };

    const resolveOnce = (value) => {
      if (resolved) return;
      resolved = true;
      cleanup();
      resolve(value);
    };

    if (Array.isArray(config.choices) && config.choices.length) {
      const choiceList = document.createElement('div');
      choiceList.className = 'app-dialog-choice-list';
      config.choices.forEach(choice => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = `btn ${choice.className || 'btn-outline'} app-dialog-choice-btn`;
        btn.innerHTML = choice.description
          ? `${choice.label}<small>${choice.description}</small>`
          : choice.label;
        btn.addEventListener('click', () => resolveOnce(choice.value));
        choiceList.appendChild(btn);
      });
      dialog.appendChild(choiceList);
    }

    const actions = document.createElement('div');
    actions.className = 'app-dialog-actions';

    if (config.showCancel !== false) {
      const cancelBtn = document.createElement('button');
      cancelBtn.type = 'button';
      cancelBtn.className = 'btn btn-outline';
      cancelBtn.textContent = config.cancelText || 'Batal';
      cancelBtn.addEventListener('click', () => resolveOnce(config.cancelValue ?? null));
      actions.appendChild(cancelBtn);
    }

    if (config.confirmText) {
      const confirmBtn = document.createElement('button');
      confirmBtn.type = 'button';
      confirmBtn.className = `btn ${config.confirmClassName || 'btn-primary'}`;
      confirmBtn.textContent = config.confirmText;
      confirmBtn.addEventListener('click', () => {
        resolveOnce(inputEl ? inputEl.value : (config.confirmValue ?? true));
      });
      actions.appendChild(confirmBtn);
    }

    if (actions.childElementCount) {
      dialog.appendChild(actions);
    }

    function onKeydown(event) {
      if (event.key === 'Escape') {
        event.preventDefault();
        resolveOnce(config.cancelValue ?? null);
      } else if (event.key === 'Enter' && inputEl) {
        event.preventDefault();
        resolveOnce(inputEl.value);
      }
    }

    overlay.addEventListener('click', (event) => {
      if (event.target === overlay) {
        resolveOnce(config.cancelValue ?? null);
      }
    });

    document.addEventListener('keydown', onKeydown);
    document.body.appendChild(overlay);

    if (inputEl) {
      queueMicrotask(() => {
        inputEl.focus();
        inputEl.select();
      });
    }
  });
};

window.showAppAlert = function(message, options = {}) {
  return window.showAppDialog({
    title: options.title || 'Informasi',
    message,
    confirmText: options.confirmText || 'OK',
    confirmClassName: options.confirmClassName || 'btn-primary',
    showCancel: false,
    confirmValue: true
  });
};

window.showAppConfirm = async function(message, options = {}) {
  const result = await window.showAppDialog({
    title: options.title || 'Konfirmasi',
    message,
    confirmText: options.confirmText || 'Lanjutkan',
    confirmClassName: options.confirmClassName || 'btn-primary',
    cancelText: options.cancelText || 'Batal',
    confirmValue: true,
    cancelValue: false,
    dangerNote: options.dangerNote || ''
  });
  return Boolean(result);
};

window.showAppPrompt = async function(message, options = {}) {
  return window.showAppDialog({
    title: options.title || 'Input',
    message,
    input: true,
    inputValue: options.defaultValue || '',
    inputPlaceholder: options.placeholder || '',
    confirmText: options.confirmText || 'Simpan',
    confirmClassName: options.confirmClassName || 'btn-primary',
    cancelText: options.cancelText || 'Batal',
    cancelValue: null
  });
};

window.showAppChoiceDialog = function(message, choices = [], options = {}) {
  return window.showAppDialog({
    title: options.title || 'Pilih Aksi',
    message,
    choices,
    showCancel: options.showCancel !== false,
    cancelText: options.cancelText || 'Batal',
    cancelValue: options.cancelValue ?? null
  });
};

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
