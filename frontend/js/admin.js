/* =====================================================
   ADMIN DASHBOARD — admin.js
   ===================================================== */

// ── Helpers (also defined in main.js — safe to redefine) ──
function esc(str) {
  return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ── Auth guard (synchronous, runs at script load) ─────
const _token = localStorage.getItem('portal_token');
const _user  = JSON.parse(localStorage.getItem('portal_user') || 'null');

if (!_token || !_user) {
  window.location.href = 'login.html';
} else if (_user.role !== 'admin') {
  window.location.href = 'dashboard.html';
}

// ── fetchAuth: throws on any non-2xx response ─────────
async function fetchAuth(url, options = {}) {
  let res;
  try {
    res = await fetch(url, {
      ...options,
      headers: {
        ...(options.headers || {}),
        'Authorization': `Bearer ${_token}`
      }
    });
  } catch (networkErr) {
    throw new Error('Network error — is the server running? (' + networkErr.message + ')');
  }

  if (res.status === 401) {
    localStorage.removeItem('portal_token');
    localStorage.removeItem('portal_user');
    window.location.href = 'login.html';
    throw new Error('Session expired. Redirecting to login...');
  }

  if (!res.ok) {
    let errMsg = `Server error (HTTP ${res.status})`;
    try { const d = await res.json(); errMsg = d.error || errMsg; } catch (_) {}
    throw new Error(errMsg);
  }

  return res;
}

// ── State ─────────────────────────────────────────────
let allNotices = [];
let allUsers   = [];
let allDepts   = [];

// ── Logout: set up immediately (not inside DOMContentLoaded)
// Uses event delegation on document so it works even if nav isn't rendered yet
document.addEventListener('click', function handleLogout(e) {
  const target = e.target.closest('#nav-logout');
  if (!target) return;
  e.preventDefault();
  localStorage.removeItem('portal_token');
  localStorage.removeItem('portal_user');
  window.location.href = 'login.html';
});

// ── Init ──────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  // Run each setup step independently so one failure doesn't block others
  try { if (typeof setFooterYear === 'function') setFooterYear(); } catch(e) { console.error('setFooterYear:', e); }
  try { if (typeof initNavToggle === 'function') initNavToggle(); } catch(e) { console.error('initNavToggle:', e); }

  try {
    const metaEl = document.getElementById('header-meta');
    if (metaEl) metaEl.textContent = new Date().toLocaleDateString('en-IN', { day:'2-digit', month:'short', year:'numeric' });
  } catch(e) { console.error('header-meta:', e); }

  // Tabs
  try {
    document.querySelectorAll('.dash-tab').forEach(tab => {
      tab.addEventListener('click', () => switchTab(tab.dataset.tab));
    });
  } catch(e) { console.error('tabs:', e); }

  // Admin notice filter
  try {
    document.getElementById('admin-notice-filter').addEventListener('click', e => {
      const btn = e.target.closest('.filter-btn');
      if (!btn) return;
      document.querySelectorAll('#admin-notice-filter .filter-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      renderNoticesTable(btn.dataset.filter);
    });
  } catch(e) { console.error('notice filter:', e); }

  // Refresh button
  try {
    document.getElementById('refresh-btn').addEventListener('click', loadAll);
  } catch(e) { console.error('refresh-btn:', e); }

  // Notice detail modal
  try {
    document.getElementById('notice-detail-modal').addEventListener('click', e => {
      if (e.target.id === 'notice-detail-modal') closeModal('notice-detail-modal');
    });
    document.getElementById('notice-detail-close').addEventListener('click', () => closeModal('notice-detail-modal'));
  } catch(e) { console.error('notice-detail-modal:', e); }

  // Create user modal
  try {
    document.getElementById('create-user-btn').addEventListener('click', openCreateUserModal);
    document.getElementById('create-user-modal').addEventListener('click', e => {
      if (e.target.id === 'create-user-modal') closeModal('create-user-modal');
    });
    document.getElementById('create-user-close').addEventListener('click', () => closeModal('create-user-modal'));
    document.getElementById('new-role').addEventListener('change', function () {
      document.getElementById('new-dept-group').style.display = this.value === 'department' ? 'block' : 'none';
    });
    document.getElementById('new-dept').addEventListener('change', function () {
      document.getElementById('new-dept-name-group').style.display = this.value === '__new__' ? 'block' : 'none';
    });
    document.getElementById('create-user-form').addEventListener('submit', submitCreateUser);
  } catch(e) { console.error('create-user-modal:', e); }

  // Reset password modal
  try {
    document.getElementById('reset-pw-modal').addEventListener('click', e => {
      if (e.target.id === 'reset-pw-modal') closeModal('reset-pw-modal');
    });
    document.getElementById('reset-pw-close').addEventListener('click', () => closeModal('reset-pw-modal'));
    document.getElementById('reset-pw-form').addEventListener('submit', submitResetPassword);
  } catch(e) { console.error('reset-pw-modal:', e); }

  // Load all data
  loadAll().catch(err => console.error('loadAll failed:', err));
});

async function loadAll() {
  await Promise.all([loadSummary(), loadNotices(), loadUsers(), loadDepts(), loadMonthlyStats()]);
}

function switchTab(tab) {
  document.querySelectorAll('.dash-tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.dash-panel').forEach(p => p.classList.remove('active'));
  document.querySelector(`[data-tab="${tab}"]`).classList.add('active');
  document.getElementById(`panel-${tab}`).classList.add('active');
}

// ── Summary Cards ─────────────────────────────────────
async function loadSummary() {
  try {
    const res  = await fetchAuth(`${API}/portal/notices/summary`);
    const data = await res.json();
    document.getElementById('stat-total').textContent   = data.total   ?? '—';
    document.getElementById('stat-pending').textContent = data.pending ?? '—';
    document.getElementById('stat-overdue').textContent = data.overdue ?? '—';
  } catch(e) {
    console.error('loadSummary error:', e.message);
  }
}

// ── All Notices Table ─────────────────────────────────
async function loadNotices() {
  const tbody = document.getElementById('admin-notices-tbody');
  try {
    tbody.innerHTML = '<tr><td colspan="7" class="text-muted text-small" style="padding:1rem;">Loading&hellip;</td></tr>';
    const res  = await fetchAuth(`${API}/portal/notices/all`);
    const data = await res.json();

    // Guard: must be an array
    if (!Array.isArray(data)) {
      throw new Error('Unexpected response format from server.');
    }
    allNotices = data;
    renderNoticesTable('all');
  } catch(e) {
    console.error('loadNotices error:', e.message);
    tbody.innerHTML = `<tr><td colspan="7" style="padding:1rem; color:var(--accent-3);">${esc(e.message)}</td></tr>`;
  }
}

function renderNoticesTable(filter) {
  const tbody = document.getElementById('admin-notices-tbody');

  if (!Array.isArray(allNotices)) {
    tbody.innerHTML = '<tr><td colspan="7" style="padding:1rem; color:var(--accent-3);">Data error — please refresh.</td></tr>';
    return;
  }

  let items = allNotices;
  if (filter === 'overdue')  items = allNotices.filter(n => n.is_overdue);
  if (filter === 'High')     items = allNotices.filter(n => n.priority === 'High');
  if (filter === 'pending')  items = allNotices.filter(n => n.pending_count > 0);

  if (!items.length) {
    tbody.innerHTML = '<tr><td colspan="7" class="text-muted text-small" style="padding:1rem;">No notices match this filter.</td></tr>';
    return;
  }

  tbody.innerHTML = items.map(n => {
    const createdDate = (n.created_at || '').slice(0, 10);
    const overdueHtml = n.is_overdue
      ? `<span class="overdue-badge">${n.days_lapsed}d overdue</span>`
      : '';
    const rowClass = n.is_overdue ? 'overdue-row' : '';

    return `
      <tr class="${rowClass}" style="cursor:pointer;" data-notice-id="${n.id}">
        <td class="text-small text-muted">${createdDate}</td>
        <td><span class="official-name" style="font-size:0.85rem;">${esc(n.title)}</span></td>
        <td class="text-small">${esc(n.source_dept_code || '')}</td>
        <td><span class="prio-badge ${esc(n.priority)}">${esc(n.priority)}</span></td>
        <td class="text-small">${esc(n.deadline)}&nbsp;${overdueHtml}</td>
        <td class="text-small">${n.pending_count} / ${n.total_targets}</td>
        <td>
          ${n.pending_count === 0
            ? `<span class="status-badge Completed">All Done</span>`
            : `<span class="status-badge Pending">${n.pending_count} Pending</span>`}
        </td>
      </tr>`;
  }).join('');

  tbody.querySelectorAll('tr[data-notice-id]').forEach(row => {
    row.addEventListener('click', () => openNoticeDetail(parseInt(row.dataset.noticeId)));
  });
}

async function openNoticeDetail(id) {
  const modal   = document.getElementById('notice-detail-modal');
  const content = document.getElementById('notice-detail-content');
  content.innerHTML = `<button class="modal-close" id="notice-detail-close-2">&times;</button><p class="text-muted text-small">Loading&hellip;</p>`;
  modal.style.display = 'block';
  document.body.style.overflow = 'hidden';

  document.getElementById('notice-detail-close-2').addEventListener('click', () => closeModal('notice-detail-modal'));

  try {
    const res    = await fetchAuth(`${API}/portal/notices/${id}`);
    const notice = await res.json();

    const statusRows = (notice.statuses || []).map(s => `
      <tr>
        <td>${esc(s.dept_name)}</td>
        <td><span class="status-badge ${esc(s.status)}">${esc(s.status)}</span></td>
        <td class="text-small">${s.remark ? esc(s.remark) : '<span class="text-muted">—</span>'}</td>
        <td class="text-small">${s.updated_at ? (s.updated_at.slice(0,10)) : '<span class="text-muted">—</span>'}</td>
        <td>${s.reply_path ? `<a class="attachment-link" href="${esc(s.reply_path)}" target="_blank">Reply</a>` : '<span class="text-muted text-small">—</span>'}</td>
      </tr>`).join('');

    const createdDate = (notice.created_at || '').slice(0, 10);

    content.innerHTML = `
      <button class="modal-close" id="notice-detail-close-3">&times;</button>
      <p class="text-muted" style="font-size:0.65rem; letter-spacing:0.15em; text-transform:uppercase; margin-bottom:0.5rem;">
        ${esc(notice.source_dept_name || '')} &mdash; ${createdDate}
      </p>
      <h2 style="margin-bottom:0.8rem;">${esc(notice.title)}</h2>
      <div style="display:flex; gap:0.5rem; flex-wrap:wrap; margin-bottom:1rem;">
        <span class="prio-badge ${esc(notice.priority)}">${esc(notice.priority)}</span>
        <span class="tag">Deadline: ${esc(notice.deadline)}</span>
        ${notice.is_overdue ? `<span class="overdue-badge">OVERDUE</span>` : ''}
      </div>
      <hr class="rule" />
      <p style="white-space:pre-wrap;">${esc(notice.body)}</p>
      ${notice.attachment_name ? `<p><a class="attachment-link" href="${esc(notice.attachment_path)}" target="_blank">&#128206; ${esc(notice.attachment_name)}</a></p>` : ''}
      <hr class="rule" />
      <h3 style="font-size:0.7rem; letter-spacing:0.15em; text-transform:uppercase; color:var(--muted); margin-bottom:0.8rem;">Status per Department</h3>
      <div class="table-scroll">
        <table class="officials-table">
          <thead><tr><th>Department</th><th>Status</th><th>Remark</th><th>Updated</th><th>Reply</th></tr></thead>
          <tbody>${statusRows || '<tr><td colspan="5" class="text-muted text-small">No status data.</td></tr>'}</tbody>
        </table>
      </div>`;

    document.getElementById('notice-detail-close-3').addEventListener('click', () => closeModal('notice-detail-modal'));
  } catch(e) {
    content.innerHTML = `
      <button class="modal-close" onclick="closeModal('notice-detail-modal')">&times;</button>
      <p style="color:var(--accent-3); padding:1rem;">${esc(e.message)}</p>`;
  }
}

// ── Manage Users ──────────────────────────────────────
async function loadUsers() {
  const tbody = document.getElementById('users-tbody');
  try {
    const res = await fetchAuth(`${API}/portal/users`);
    const data = await res.json();
    if (!Array.isArray(data)) throw new Error('Unexpected response format.');
    allUsers  = data;
    renderUsersTable();
  } catch(e) {
    console.error('loadUsers error:', e.message);
    tbody.innerHTML = `<tr><td colspan="6" style="padding:1rem; color:var(--accent-3);">${esc(e.message)}</td></tr>`;
  }
}

function renderUsersTable() {
  const tbody = document.getElementById('users-tbody');
  if (!allUsers.length) {
    tbody.innerHTML = '<tr><td colspan="6" class="text-muted text-small" style="padding:1rem;">No users found.</td></tr>';
    return;
  }

  tbody.innerHTML = allUsers.map(u => `
    <tr class="${u.is_active ? '' : 'user-inactive'}">
      <td class="official-name">${esc(u.username)}</td>
      <td class="text-small text-upper">${esc(u.role)}</td>
      <td class="text-small">${u.dept_name ? esc(u.dept_name) : '<span class="text-muted">—</span>'}</td>
      <td>
        ${u.is_active
          ? '<span class="status-badge Completed">Active</span>'
          : '<span class="status-badge Pending">Inactive</span>'}
      </td>
      <td class="text-small text-muted">${u.last_login ? u.last_login.slice(0,10) : 'Never'}</td>
      <td>
        <div style="display:flex; gap:0.4rem; flex-wrap:wrap;">
          ${u.role !== 'admin' ? `<button class="btn btn-sm btn-outline" data-toggle-id="${u.id}" data-toggle-active="${u.is_active}">
            ${u.is_active ? 'Deactivate' : 'Activate'}
          </button>` : ''}
          <button class="btn btn-sm btn-outline" data-reset-id="${u.id}" data-reset-username="${esc(u.username)}">
            Reset PW
          </button>
        </div>
      </td>
    </tr>`).join('');

  tbody.querySelectorAll('[data-toggle-id]').forEach(btn => {
    btn.addEventListener('click', () => toggleUserStatus(
      parseInt(btn.dataset.toggleId),
      parseInt(btn.dataset.toggleActive)
    ));
  });

  tbody.querySelectorAll('[data-reset-id]').forEach(btn => {
    btn.addEventListener('click', () => openResetPwModal(
      parseInt(btn.dataset.resetId),
      btn.dataset.resetUsername
    ));
  });
}

async function toggleUserStatus(userId, currentActive) {
  try {
    await fetchAuth(`${API}/portal/users/${userId}/status`, {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ is_active: currentActive ? 0 : 1 })
    });
    await loadUsers();
  } catch(e) {
    alert('Could not update user status: ' + e.message);
  }
}

// ── Create User ───────────────────────────────────────
async function loadDepts() {
  try {
    const res = await fetch(`${API}/departments`);
    if (!res.ok) throw new Error('Failed to load departments');
    allDepts  = await res.json();
  } catch(e) {
    console.error('loadDepts:', e.message);
  }
}

function openCreateUserModal() {
  const sel = document.getElementById('new-dept');
  sel.innerHTML = '<option value="">— Select Department —</option>' +
    allDepts.map(d => `<option value="${d.id}">${esc(d.name)}</option>`).join('') +
    '<option value="__new__">+ Add new department...</option>';

  document.getElementById('create-user-form').reset();
  document.getElementById('create-user-status').style.display = 'none';
  document.getElementById('new-dept-name-group').style.display = 'none';
  document.getElementById('new-dept-group').style.display = 'block';
  document.getElementById('create-user-modal').style.display = 'block';
  document.body.style.overflow = 'hidden';
}

async function submitCreateUser(e) {
  e.preventDefault();
  const btn    = this.querySelector('button[type=submit]');
  const status = document.getElementById('create-user-status');
  btn.disabled = true;
  status.style.display = 'none';

  try {
    const role    = document.getElementById('new-role').value;
    let   dept_id;

    if (role === 'department') {
      const selectedDept = document.getElementById('new-dept').value;

      if (selectedDept === '__new__') {
        const newDeptName = document.getElementById('new-dept-name').value.trim();
        if (!newDeptName) {
          status.className   = 'form-status error';
          status.textContent = 'Please enter a name for the new department.';
          status.style.display = 'block';
          btn.disabled = false;
          return;
        }
        const deptRes  = await fetchAuth(`${API}/departments`, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ name: newDeptName })
        });
        const newDept  = await deptRes.json();
        dept_id        = newDept.id;
        await loadDepts();
      } else {
        dept_id = parseInt(selectedDept);
      }
    }

    const body = {
      username: document.getElementById('new-username').value.trim().toLowerCase(),
      password: document.getElementById('new-password').value,
      role,
      dept_id
    };

    await fetchAuth(`${API}/portal/users`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(body)
    });
    status.className   = 'form-status success';
    status.textContent = 'User created successfully.';
    status.style.display = 'block';
    setTimeout(() => { closeModal('create-user-modal'); loadUsers(); }, 1000);
  } catch(e) {
    status.className   = 'form-status error';
    status.textContent = e.message;
    status.style.display = 'block';
  }
  btn.disabled = false;
}

// ── Reset Password ────────────────────────────────────
function openResetPwModal(userId, username) {
  document.getElementById('reset-pw-uid').value    = userId;
  document.getElementById('reset-pw-label').textContent = `Resetting password for: ${username}`;
  document.getElementById('reset-pw-input').value  = '';
  document.getElementById('reset-pw-status').style.display = 'none';
  document.getElementById('reset-pw-modal').style.display = 'block';
  document.body.style.overflow = 'hidden';
}

async function submitResetPassword(e) {
  e.preventDefault();
  const btn    = this.querySelector('button[type=submit]');
  const status = document.getElementById('reset-pw-status');
  btn.disabled = true;
  status.style.display = 'none';

  try {
    const userId = document.getElementById('reset-pw-uid').value;
    const newPw  = document.getElementById('reset-pw-input').value;
    await fetchAuth(`${API}/portal/users/${userId}/password`, {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ newPassword: newPw })
    });
    status.className   = 'form-status success';
    status.textContent = 'Password reset successfully.';
    status.style.display = 'block';
    setTimeout(() => closeModal('reset-pw-modal'), 1000);
  } catch(e) {
    status.className   = 'form-status error';
    status.textContent = e.message;
    status.style.display = 'block';
  }
  btn.disabled = false;
}

// ── Monthly Stats ─────────────────────────────────────
async function loadMonthlyStats() {
  const content = document.getElementById('monthly-stats-content');
  try {
    const res  = await fetchAuth(`${API}/portal/notices/monthly-stats`);
    const data = await res.json();

    if (!data.length) {
      content.innerHTML = '<p class="text-muted text-small" style="padding:1rem;">No completed actions recorded yet.</p>';
      return;
    }

    const max   = Math.max(...data.map(d => d.completed));
    const total = data.reduce((s, d) => s + d.completed, 0);

    const rows = data.map(d => {
      const pct   = Math.round((d.completed / max) * 100);
      const [yr, mo] = d.month.split('-');
      const label = new Date(parseInt(yr), parseInt(mo) - 1).toLocaleString('en-IN', { month: 'short', year: 'numeric' });
      return `
        <div class="month-stat-row">
          <span class="month-stat-label">${label}</span>
          <div class="month-stat-bar-wrap">
            <div class="month-stat-bar" style="width:${pct}%"></div>
          </div>
          <span class="month-stat-count">${d.completed}</span>
        </div>`;
    }).join('');

    content.innerHTML = `
      <div class="month-stats-chart">${rows}</div>
      <div class="month-stat-row month-stat-total">
        <span class="month-stat-label">Total</span>
        <div class="month-stat-bar-wrap" style="background:transparent; border:none;"></div>
        <span class="month-stat-count" style="color:var(--accent); font-size:0.9rem;">${total}</span>
      </div>`;
  } catch(e) {
    content.innerHTML = `<p style="padding:1rem; color:var(--accent-3);">${esc(e.message)}</p>`;
  }
}

// ── Utility ───────────────────────────────────────────
function closeModal(id) {
  const el = document.getElementById(id);
  if (el) el.style.display = 'none';
  document.body.style.overflow = '';
}

// expose closeModal globally for inline onclick handlers
window.closeModal = closeModal;
