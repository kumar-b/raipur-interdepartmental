/* =====================================================
   ADMIN DASHBOARD — admin.js
   Loaded on: pages/admin.html
   Responsibilities:
     - Auth guard (only admin role allowed)
     - Summary stat cards (total / pending / overdue)
     - All-notices table with overdue/priority filters
     - Notice detail modal (admin read-only + delete if all completed)
     - User management table (list, activate/deactivate, reset password)
     - Create user modal (also handles adding a new department inline)
     - Monthly completion stats bar chart
   ===================================================== */

// ── Helpers (also defined in main.js — safe to redefine here) ────────────────

/**
 * esc — XSS-safe HTML escape for user-supplied content.
 * Must be called before inserting any server data into innerHTML.
 * @param {string|any} str
 * @returns {string}
 */
function esc(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ── Auth guard — synchronous, runs at script load time ───────────────────────
// Reads credentials from localStorage before any async activity so there is
// no flash of admin content for unauthenticated users.
const _token = localStorage.getItem('portal_token');
const _user  = JSON.parse(localStorage.getItem('portal_user') || 'null');

if (!_token || !_user) {
  window.location.href = 'login.html';           // no session at all
} else if (_user.role !== 'admin') {
  window.location.href = 'dashboard.html';       // logged in but not admin
}

// ── fetchAuth — authenticated fetch with centralised error handling ───────────
/**
 * fetchAuth — wraps fetch with JWT auth header and standard error handling.
 *   - 401 → clears storage, redirects to login.
 *   - non-2xx → rejects with the server's error message.
 *   - network failure → rejects with a helpful message.
 * @param {string}      url
 * @param {RequestInit} options
 * @returns {Promise<Response>}
 */
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
    // Token has expired or was revoked — force re-authentication.
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

// ── Module-level state ────────────────────────────────────────────────────────
// Cached arrays allow client-side filtering without extra network requests.
let allNotices = [];
let allUsers   = [];
let allDepts   = [];

// ── Logout — event delegation on document ────────────────────────────────────
// Registered outside DOMContentLoaded so it is active even before the DOM
// is fully parsed (the nav may be rendered lazily by another script).
document.addEventListener('click', function handleLogout(e) {
  const target = e.target.closest('#nav-logout');
  if (!target) return;
  e.preventDefault();
  localStorage.removeItem('portal_token');
  localStorage.removeItem('portal_user');
  window.location.href = 'login.html';
});

// ── DOMContentLoaded — main init ──────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  // Wrap each setup block independently so one failure does not block others.
  try { if (typeof setFooterYear === 'function') setFooterYear(); } catch(e) { console.error('setFooterYear:', e); }
  try { if (typeof initNavToggle === 'function') initNavToggle(); } catch(e) { console.error('initNavToggle:', e); }

  // Header date display.
  try {
    const metaEl = document.getElementById('header-meta');
    if (metaEl) metaEl.textContent = new Date().toLocaleDateString('en-IN', { day:'2-digit', month:'short', year:'numeric' });
  } catch(e) { console.error('header-meta:', e); }

  // Dashboard tab switching.
  try {
    document.querySelectorAll('.dash-tab').forEach(tab => {
      tab.addEventListener('click', () => switchTab(tab.dataset.tab));
    });
  } catch(e) { console.error('tabs:', e); }

  // Notice table filter buttons — re-renders table with selected filter applied.
  try {
    document.getElementById('admin-notice-filter').addEventListener('click', e => {
      const btn = e.target.closest('.filter-btn');
      if (!btn) return;
      document.querySelectorAll('#admin-notice-filter .filter-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      renderNoticesTable(btn.dataset.filter);
    });
  } catch(e) { console.error('notice filter:', e); }

  // Manual refresh button — re-fetches all data from the server.
  try {
    document.getElementById('refresh-btn').addEventListener('click', loadAll);
  } catch(e) { console.error('refresh-btn:', e); }

  // Notice detail modal — backdrop click or × button closes it.
  try {
    document.getElementById('notice-detail-modal').addEventListener('click', e => {
      if (e.target.id === 'notice-detail-modal') closeModal('notice-detail-modal');
    });
    document.getElementById('notice-detail-close').addEventListener('click', () => closeModal('notice-detail-modal'));
  } catch(e) { console.error('notice-detail-modal:', e); }

  // Create user modal — also handles inline "add new department" flow.
  try {
    document.getElementById('create-user-btn').addEventListener('click', openCreateUserModal);
    document.getElementById('create-user-modal').addEventListener('click', e => {
      if (e.target.id === 'create-user-modal') closeModal('create-user-modal');
    });
    document.getElementById('create-user-close').addEventListener('click', () => closeModal('create-user-modal'));

    // Show/hide the department selector based on the selected role.
    document.getElementById('new-role').addEventListener('change', function () {
      document.getElementById('new-dept-group').style.display = this.value === 'department' ? 'block' : 'none';
    });

    // Show/hide the "new department name" input when "+ Add new department" is chosen.
    document.getElementById('new-dept').addEventListener('change', function () {
      document.getElementById('new-dept-name-group').style.display = this.value === '__new__' ? 'block' : 'none';
    });

    document.getElementById('create-user-form').addEventListener('submit', submitCreateUser);
  } catch(e) { console.error('create-user-modal:', e); }

  // Reset password modal setup.
  try {
    document.getElementById('reset-pw-modal').addEventListener('click', e => {
      if (e.target.id === 'reset-pw-modal') closeModal('reset-pw-modal');
    });
    document.getElementById('reset-pw-close').addEventListener('click', () => closeModal('reset-pw-modal'));
    document.getElementById('reset-pw-form').addEventListener('submit', submitResetPassword);
  } catch(e) { console.error('reset-pw-modal:', e); }

  // Initial data load — runs all fetches in parallel.
  loadAll().catch(err => console.error('loadAll failed:', err));
});

/**
 * loadAll — fetches all dashboard data in parallel.
 * Called on init and whenever the refresh button is clicked.
 */
async function loadAll() {
  await Promise.all([loadSummary(), loadNotices(), loadUsers(), loadDepts(), loadMonthlyStats()]);
}

/**
 * switchTab — activates the selected tab and its corresponding panel.
 * @param {string} tab — data-tab value (e.g. 'notices', 'users', 'stats')
 */
function switchTab(tab) {
  document.querySelectorAll('.dash-tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.dash-panel').forEach(p => p.classList.remove('active'));
  document.querySelector(`[data-tab="${tab}"]`).classList.add('active');
  document.getElementById(`panel-${tab}`).classList.add('active');
}

// ── Summary Stat Cards ────────────────────────────────────────────────────────

/**
 * loadSummary — fetches aggregate notice counts and populates the three
 * stat cards at the top of the admin dashboard.
 */
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

// ── All Notices Table ─────────────────────────────────────────────────────────

/**
 * loadNotices — fetches all notices and hands them off to renderNoticesTable.
 * Displays a loading row while the request is in flight.
 */
async function loadNotices() {
  const tbody = document.getElementById('admin-notices-tbody');
  try {
    tbody.innerHTML = '<tr><td colspan="7" class="text-muted text-small" style="padding:1rem;">Loading&hellip;</td></tr>';
    const res  = await fetchAuth(`${API}/portal/notices/all`);
    const data = await res.json();

    // Guard against unexpected server responses (e.g. error objects).
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

/**
 * renderNoticesTable — renders the notice rows filtered by the given filter key.
 * Each row is clickable and opens the notice detail modal.
 * @param {string} filter — 'all', 'overdue', 'High', or 'pending'
 */
function renderNoticesTable(filter) {
  const tbody = document.getElementById('admin-notices-tbody');

  if (!Array.isArray(allNotices)) {
    tbody.innerHTML = '<tr><td colspan="7" style="padding:1rem; color:var(--accent-3);">Data error — please refresh.</td></tr>';
    return;
  }

  // Apply the selected filter to the cached notice list.
  let items = allNotices;
  if (filter === 'overdue') items = allNotices.filter(n => n.is_overdue);
  if (filter === 'High')    items = allNotices.filter(n => n.priority === 'High');
  if (filter === 'pending') items = allNotices.filter(n => n.pending_count > 0);

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

  // Attach row-click handlers after innerHTML is set.
  tbody.querySelectorAll('tr[data-notice-id]').forEach(row => {
    row.addEventListener('click', () => openNoticeDetail(parseInt(row.dataset.noticeId)));
  });
}

/**
 * openNoticeDetail — fetches and displays full notice details in the admin modal.
 * Includes a per-department status table with remarks, timestamps, and reply links.
 * Shows a "Delete Notice" button when all departments have completed the notice.
 * @param {number} id — notice ID
 */
async function openNoticeDetail(id) {
  const modal   = document.getElementById('notice-detail-modal');
  const content = document.getElementById('notice-detail-content');

  // Show a loading indicator immediately.
  content.innerHTML = `<button class="modal-close" id="notice-detail-close-2">&times;</button><p class="text-muted text-small">Loading&hellip;</p>`;
  modal.style.display  = 'block';
  document.body.style.overflow = 'hidden';

  document.getElementById('notice-detail-close-2').addEventListener('click', () => closeModal('notice-detail-modal'));

  try {
    const res    = await fetchAuth(`${API}/portal/notices/${id}`);
    const notice = await res.json();

    // Build the per-dept status table — includes remark, updated date, reply link.
    const statusRows = (notice.statuses || []).map(s => `
      <tr>
        <td>${esc(s.dept_name)}</td>
        <td><span class="status-badge ${esc(s.status)}">${esc(s.status)}</span></td>
        <td class="text-small">${s.remark ? esc(s.remark) : '<span class="text-muted">—</span>'}</td>
        <td class="text-small">${s.updated_at ? (s.updated_at.slice(0,10)) : '<span class="text-muted">—</span>'}</td>
        <td>${s.reply_path ? `<a class="attachment-link" href="${esc(s.reply_path)}" target="_blank">Reply</a>` : '<span class="text-muted text-small">—</span>'}</td>
      </tr>`).join('');

    const createdDate  = (notice.created_at || '').slice(0, 10);
    const allCompleted = (notice.statuses || []).length > 0 &&
      (notice.statuses || []).every(s => s.status === 'Completed');

    // Admin can close ANY notice regardless of completion status.
    // The caption below the button changes to warn about force-closing pending notices.
    const closeCaption = allCompleted
      ? 'All departments completed &mdash; closing will permanently delete files and archive statistics.'
      : '&#9888; Admin override: force-closing will remove this notice even though some departments have not yet completed it. Statistics for any completed actions will be preserved.';

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
      </div>
      <div style="margin-top:1rem;padding-top:1rem;border-top:1px solid var(--rule);display:flex;align-items:center;gap:0.8rem;flex-wrap:wrap;">
        <button class="btn btn-sm" style="background:var(--accent-3);color:#fff;" onclick="closeNotice(${id})">Close Notice</button>
        <span class="text-muted text-small">${closeCaption}</span>
      </div>`;

    document.getElementById('notice-detail-close-3').addEventListener('click', () => closeModal('notice-detail-modal'));
  } catch(e) {
    content.innerHTML = `
      <button class="modal-close" onclick="closeModal('notice-detail-modal')">&times;</button>
      <p style="color:var(--accent-3); padding:1rem;">${esc(e.message)}</p>`;
  }
}

// ── User Management ────────────────────────────────────────────────────────────

/**
 * loadUsers — fetches all portal user accounts and renders them in the table.
 */
async function loadUsers() {
  const tbody = document.getElementById('users-tbody');
  try {
    const res  = await fetchAuth(`${API}/portal/users`);
    const data = await res.json();
    if (!Array.isArray(data)) throw new Error('Unexpected response format.');
    allUsers = data;
    renderUsersTable();
  } catch(e) {
    console.error('loadUsers error:', e.message);
    tbody.innerHTML = `<tr><td colspan="6" style="padding:1rem; color:var(--accent-3);">${esc(e.message)}</td></tr>`;
  }
}

/**
 * renderUsersTable — renders the users table from the cached allUsers array.
 * Each row has Activate/Deactivate and Reset PW action buttons (admins excluded from toggle).
 * Inactive users get a dimmed row styling via the 'user-inactive' CSS class.
 */
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

  // Activate/Deactivate button click.
  tbody.querySelectorAll('[data-toggle-id]').forEach(btn => {
    btn.addEventListener('click', () => toggleUserStatus(
      parseInt(btn.dataset.toggleId),
      parseInt(btn.dataset.toggleActive)
    ));
  });

  // Reset password button click — opens the reset modal for the selected user.
  tbody.querySelectorAll('[data-reset-id]').forEach(btn => {
    btn.addEventListener('click', () => openResetPwModal(
      parseInt(btn.dataset.resetId),
      btn.dataset.resetUsername
    ));
  });
}

/**
 * toggleUserStatus — sends a PATCH to flip a user's is_active flag,
 * then reloads the user table to reflect the change.
 * @param {number} userId        — target user's ID
 * @param {number} currentActive — current is_active value (1 or 0)
 */
async function toggleUserStatus(userId, currentActive) {
  try {
    await fetchAuth(`${API}/portal/users/${userId}/status`, {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ is_active: currentActive ? 0 : 1 }) // toggle the value
    });
    await loadUsers();
  } catch(e) {
    alert('Could not update user status: ' + e.message);
  }
}

// ── Create User modal ─────────────────────────────────────────────────────────

/**
 * loadDepts — fetches all departments so the "Create User" modal can populate
 * the department dropdown. Called once during loadAll.
 */
async function loadDepts() {
  try {
    const res = await fetch(`${API}/departments`); // public endpoint, no auth needed
    if (!res.ok) throw new Error('Failed to load departments');
    allDepts = await res.json();
  } catch(e) {
    console.error('loadDepts:', e.message);
  }
}

/**
 * openCreateUserModal — populates the department dropdown and resets the form,
 * then shows the modal overlay.
 */
function openCreateUserModal() {
  const sel = document.getElementById('new-dept');
  // Build option elements from the cached department list.
  sel.innerHTML = '<option value="">— Select Department —</option>' +
    allDepts.map(d => `<option value="${d.id}">${esc(d.name)}</option>`).join('') +
    '<option value="__new__">+ Add new department...</option>'; // inline dept creation

  document.getElementById('create-user-form').reset();
  document.getElementById('create-user-status').style.display    = 'none';
  document.getElementById('new-dept-name-group').style.display   = 'none'; // hidden unless __new__ selected
  document.getElementById('new-dept-group').style.display        = 'block';
  document.getElementById('create-user-modal').style.display     = 'block';
  document.body.style.overflow = 'hidden';
}

/**
 * submitCreateUser — handles the create-user form submission.
 * If "__new__" is selected in the department dropdown, creates the department first
 * via POST /api/departments, then uses the returned ID when creating the user.
 * @param {Event} e — form submit event
 */
async function submitCreateUser(e) {
  e.preventDefault();
  const btn    = this.querySelector('button[type=submit]');
  const status = document.getElementById('create-user-status');
  btn.disabled = true;
  status.style.display = 'none';

  try {
    const role = document.getElementById('new-role').value;
    let dept_id;

    if (role === 'department') {
      const selectedDept = document.getElementById('new-dept').value;

      if (selectedDept === '__new__') {
        // Create a new department first, then use its ID for the user.
        const newDeptName = document.getElementById('new-dept-name').value.trim();
        if (!newDeptName) {
          status.className   = 'form-status error';
          status.textContent = 'Please enter a name for the new department.';
          status.style.display = 'block';
          btn.disabled = false;
          return;
        }
        const deptRes = await fetchAuth(`${API}/departments`, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ name: newDeptName })
        });
        const newDept = await deptRes.json();
        dept_id       = newDept.id;
        await loadDepts(); // refresh cached dept list for next time
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

    // Brief pause before closing so the user can see the success message.
    setTimeout(() => { closeModal('create-user-modal'); loadUsers(); }, 1000);
  } catch(e) {
    status.className   = 'form-status error';
    status.textContent = e.message;
    status.style.display = 'block';
  }
  btn.disabled = false;
}

// ── Reset Password modal ───────────────────────────────────────────────────────

/**
 * openResetPwModal — pre-fills the reset password modal with the target user's
 * ID and username, then shows the overlay.
 * @param {number} userId   — ID of the user whose password will be reset
 * @param {string} username — displayed in the modal header for confirmation
 */
function openResetPwModal(userId, username) {
  document.getElementById('reset-pw-uid').value            = userId;
  document.getElementById('reset-pw-label').textContent    = `Resetting password for: ${username}`;
  document.getElementById('reset-pw-input').value          = '';
  document.getElementById('reset-pw-status').style.display = 'none';
  document.getElementById('reset-pw-modal').style.display  = 'block';
  document.body.style.overflow = 'hidden';
}

/**
 * submitResetPassword — sends a PATCH request with the new password for the
 * target user. The admin does not need to know the old password.
 * @param {Event} e — form submit event
 */
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

// ── Monthly Completion Stats ────────────────────────────────────────────────────

/**
 * loadMonthlyStats — fetches monthly completed-action counts and renders a
 * simple horizontal bar chart in the Stats tab.
 * Bars are sized proportionally relative to the month with the highest count.
 */
async function loadMonthlyStats() {
  const content = document.getElementById('monthly-stats-content');
  try {
    const res  = await fetchAuth(`${API}/portal/notices/monthly-stats`);
    const data = await res.json();

    if (!data.length) {
      content.innerHTML = '<p class="text-muted text-small" style="padding:1rem;">No completed actions recorded yet.</p>';
      return;
    }

    // Find the maximum count to normalise bar widths to 100%.
    const max   = Math.max(...data.map(d => d.completed));
    const total = data.reduce((s, d) => s + d.completed, 0);

    const rows = data.map(d => {
      const pct      = Math.round((d.completed / max) * 100); // percentage width relative to max
      const [yr, mo] = d.month.split('-');
      // Format 'YYYY-MM' into a readable label like "Feb 2026".
      const label    = new Date(parseInt(yr), parseInt(mo) - 1).toLocaleString('en-IN', { month: 'short', year: 'numeric' });
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

// ── Utility ─────────────────────────────────────────────────────────────────────

/**
 * closeModal — hides a modal overlay and restores page scrolling.
 * @param {string} id — element ID of the modal container
 */
function closeModal(id) {
  const el = document.getElementById(id);
  if (el) el.style.display = 'none';
  document.body.style.overflow = '';
}

// Expose closeModal globally so inline onclick handlers in dynamically rendered
// modal HTML (e.g. the error state button) can call it.
window.closeModal = closeModal;

// ── Close Notice ─────────────────────────────────────────────────────────────────

/**
 * closeNotice — closes (permanently removes) a notice after admin confirmation.
 *
 * Admin can close ANY notice — including pending/incomplete ones — regardless
 * of department or completion status. The server enforces the same rules.
 *
 * Closing removes the notice record, deletes all uploaded files from storage,
 * and archives any completion statistics so the monthly chart is preserved.
 *
 * Exposed globally to support the inline onclick="closeNotice(id)" in modal HTML.
 *
 * @param {number} id — notice ID to close
 */
async function closeNotice(id) {
  if (!confirm('Close this notice permanently?\n\nAll uploaded files will be deleted. Statistics will be preserved. This cannot be undone.')) return;
  try {
    await fetchAuth(`${API}/portal/notices/${id}`, { method: 'DELETE' });
    closeModal('notice-detail-modal');
    await loadAll(); // refresh the entire dashboard after close
  } catch(e) {
    alert('Could not close notice: ' + e.message);
  }
}
window.closeNotice = closeNotice;
