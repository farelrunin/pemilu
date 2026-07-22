// ════════════════════════════════════════
//  auth.js — LOCAL MODE (no auth required)
// ════════════════════════════════════════

// Sistem berjalan full local — tidak ada login, tidak ada token, tidak ada redirect
const isLoginPage = false;
const token = 'local';
const userRole = 'Superadmin';

// ── Helper Fetch — langsung tanpa token ──
window.fetchWithAuth = async function(url, options = {}) {
  if (!options.headers) options.headers = {};
  const isFormData = options.body instanceof FormData;
  if (!isFormData && !options.headers['Content-Type']) {
    options.headers['Content-Type'] = 'application/json';
  }
  try {
    return await fetch(url, options);
  } catch (error) {
    console.error('Fetch Error:', error);
    throw error;
  }
};

window.logout = function() { window.location.href = '/'; };
window.loadUserInfo = function() {};
window.getToken = function() { return 'local'; };

// ── Dialog & UI Helpers ──
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
  // ── Collapsible Sidebar Sections ──
  document.querySelectorAll('.sidebar-section-header').forEach(header => {
    const sectionName = header.getAttribute('data-section');
    const targetNav = header.nextElementSibling;
    if (targetNav && targetNav.classList.contains('nav')) {
      const hasActive = targetNav.querySelector('a.active');
      const isCollapsed = localStorage.getItem(`sidebar_collapsed_${sectionName}`) === 'true';
      if (hasActive) {
        targetNav.classList.remove('collapsed');
        header.classList.remove('collapsed');
      } else if (isCollapsed) {
        targetNav.classList.add('collapsed');
        header.classList.add('collapsed');
      }
      header.addEventListener('click', () => {
        const isNowCollapsed = targetNav.classList.toggle('collapsed');
        header.classList.toggle('collapsed', isNowCollapsed);
        localStorage.setItem(`sidebar_collapsed_${sectionName}`, isNowCollapsed ? 'true' : 'false');
      });
    }
  });
});
