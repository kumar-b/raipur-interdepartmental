/* =====================================================
   DEPARTMENT DASHBOARD — dashboard.js
   Loaded on: pages/dashboard.html
   Responsibilities:
     - Auth guard (redirects non-dept users)
     - Load and render the department's inbox (received notices)
     - Load and render the department's outbox (sent notices)
     - Open notice detail modal (marks notice as read)
     - Open action modal to respond (Noted / Completed + optional reply file)
     - Delete fully-completed notices
   ===================================================== */

// ── Auth guard — runs synchronously before any async work ────────────────────
// If there is no token or user in localStorage, the session has expired or
// the user has never logged in — redirect immediately to the login page.
const token = localStorage.getItem('portal_token');
const user  = JSON.parse(localStorage.getItem('portal_user') || 'null');

if (!token || !user) {
  window.location.href = 'login.html';
} else if (user.role === 'admin') {
  // Admin users have their own dashboard — redirect them there.
  window.location.href = 'admin.html';
}

// ── Authenticated fetch wrapper ───────────────────────────────────────────────
/**
 * fetchAuth — wraps fetch with JWT authentication and centralised error handling.
 *
 * Behaviour:
 *   - Attaches "Authorization: Bearer <token>" to every request.
 *   - On 401 (expired/invalid token): clears storage and redirects to login.
 *   - On any other non-2xx status: rejects with a descriptive error message.
 *   - On network failure: rejects with a "server not running" message.
 *
 * @param {string}      url
 * @param {RequestInit} options — standard fetch options
 * @returns {Promise<Response>}
 */
async function fetchAuth(url, options = {}) {
  let res;
  try {
    res = await fetch(url, {
      ...options,
      headers: { ...(options.headers || {}), 'Authorization': `Bearer ${token}` }
    });
  } catch (networkErr) {
    throw new Error('Network error — is the server running?');
  }

  if (res.status === 401) {
    // Token is invalid or has expired — force re-login.
    localStorage.removeItem('portal_token');
    localStorage.removeItem('portal_user');
    window.location.href = 'login.html';
    throw new Error('Session expired.');
  }

  if (!res.ok) {
    // Parse the server's error message if available, else use a generic one.
    let errMsg = `Server error (HTTP ${res.status})`;
    try { const d = await res.json(); errMsg = d.error || errMsg; } catch (_) {}
    throw new Error(errMsg);
  }

  return res;
}

// ── Module-level state ────────────────────────────────────────────────────────
// Caching the full inbox/outbox arrays allows instant client-side filtering
// without additional network requests.
let allInbox  = [];
let allOutbox = [];

// ── Logout handler — event delegation on document ────────────────────────────
// Using delegation rather than direct binding means this works even if the
// nav hasn't finished rendering when the script runs.
document.addEventListener('click', function (e) {
  const target = e.target.closest('#nav-logout');
  if (!target) return;
  e.preventDefault();
  localStorage.removeItem('portal_token');
  localStorage.removeItem('portal_user');
  window.location.href = 'login.html';
});

// ── DOMContentLoaded — safe entry point for all DOM manipulation ──────────────
document.addEventListener('DOMContentLoaded', () => {
  // Each setup step is wrapped independently so a single failure does not
  // block the rest of the dashboard from initialising.
  try { if (typeof setFooterYear === 'function') setFooterYear(); } catch(e) { console.error(e); }
  try { if (typeof initNavToggle === 'function') initNavToggle(); } catch(e) { console.error(e); }

  // Populate header date and logged-in user info.
  try {
    const metaEl = document.getElementById('header-meta');
    if (metaEl) metaEl.textContent = new Date().toLocaleDateString('en-IN', { day:'2-digit', month:'short', year:'numeric' });
    const titleEl = document.getElementById('dash-title');
    if (titleEl) titleEl.textContent = user.dept_name || 'Department Dashboard';
    const subEl = document.getElementById('dash-subtitle');
    if (subEl) subEl.textContent = `Logged in as: ${user.username}`;
  } catch(e) { console.error('header setup:', e); }

  // Tab switching — clicking a tab shows the matching panel.
  document.querySelectorAll('.dash-tab').forEach(tab => {
    tab.addEventListener('click', () => switchTab(tab.dataset.tab));
  });

  // Inbox filter buttons — re-renders with the selected status filter applied.
  document.getElementById('inbox-filter').addEventListener('click', e => {
    const btn = e.target.closest('.filter-btn');
    if (!btn) return;
    document.querySelectorAll('#inbox-filter .filter-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    renderInbox(btn.dataset.status);
  });

  // Modal close handlers — backdrop click or × button closes the modal.
  document.getElementById('notice-modal').addEventListener('click', e => {
    if (e.target.id === 'notice-modal') closeModal('notice-modal');
  });
  document.getElementById('notice-modal-close').addEventListener('click', () => closeModal('notice-modal'));
  document.getElementById('action-modal').addEventListener('click', e => {
    if (e.target.id === 'action-modal') closeModal('action-modal');
  });
  document.getElementById('action-modal-close').addEventListener('click', () => closeModal('action-modal'));
  document.getElementById('action-modal-close-2').addEventListener('click', () => closeModal('action-modal'));

  // Wire up the action form (Noted/Completed response).
  document.getElementById('action-form').addEventListener('submit', submitAction);

  loadDashboard();
});

/**
 * switchTab — activates the selected tab and its corresponding panel.
 * @param {string} tab — data-tab value ('inbox' or 'outbox')
 */
function switchTab(tab) {
  document.querySelectorAll('.dash-tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.dash-panel').forEach(p => p.classList.remove('active'));
  document.querySelector(`[data-tab="${tab}"]`).classList.add('active');
  document.getElementById(`panel-${tab}`).classList.add('active');
}

/**
 * loadDashboard — fetches inbox and outbox data in parallel.
 */
async function loadDashboard() {
  await Promise.all([loadInbox(), loadOutbox()]);
}

// ── INBOX ─────────────────────────────────────────────────────────────────────

/**
 * loadInbox — fetches notices addressed to this department and renders them.
 * Also updates the pending count badge next to the Inbox tab label.
 */
async function loadInbox() {
  try {
    const res  = await fetchAuth(`${API}/portal/notices/inbox`);
    allInbox   = await res.json();

    // Count Pending items to display in the tab badge.
    const pend = allInbox.filter(n => n.status === 'Pending').length;
    const ctr  = document.getElementById('inbox-pending-count');
    if (pend > 0) ctr.textContent = `(${pend} pending)`;
    renderInbox('all');
  } catch {
    document.getElementById('inbox-list').innerHTML =
      '<p class="text-muted text-small">Could not load inbox.</p>';
  }
}

/**
 * renderInbox — renders the inbox list filtered by the given status.
 * Each row shows priority/status badges, overdue warning, unread indicator,
 * and a "Respond" button for notices that are not yet completed.
 * @param {string} filterStatus — 'all', 'Pending', 'Noted', or 'Completed'
 */
function renderInbox(filterStatus) {
  const list  = document.getElementById('inbox-list');
  const items = filterStatus === 'all' ? allInbox : allInbox.filter(n => n.status === filterStatus);

  if (!items.length) {
    list.innerHTML = `<div class="empty-state">No notices in this category.</div>`;
    return;
  }

  list.innerHTML = items.map(n => {
    // Overdue badge — shown when deadline has passed and notice is not completed.
    const overdueBadge = n.is_overdue
      ? `<span class="overdue-badge">OVERDUE &mdash; ${n.days_lapsed}d lapsed</span>`
      : '';
    // Unread indicator — a dot and bolder row styling for unread notices.
    const unreadClass = n.is_read === 0 ? 'unread' : '';
    const unreadDot   = n.is_read === 0 ? '<span class="unread-dot"></span>' : '';
    // Respond button — only shown while the notice is still actionable.
    const actionBtn   = n.status !== 'Completed'
      ? `<button class="btn btn-sm btn-outline" data-action-id="${n.id}" data-action-title="${esc(n.title)}">Respond</button>`
      : '';

    return `
      <div class="inbox-row ${unreadClass}">
        <div class="notice-date">
          ${fmt(n.created_at ? n.created_at.slice(0,10) : '')}
          <span class="year">${n.source_dept_code || ''}</span>
        </div>
        <div>
          ${unreadDot}
          <a href="#" class="notice-title" data-notice-id="${n.id}">${esc(n.title)}</a>
          <div class="notice-meta" style="margin-top:0.3rem; display:flex; flex-wrap:wrap; gap:0.3rem; align-items:center;">
            <span class="prio-badge ${n.priority}">${esc(n.priority)}</span>
            <span class="status-badge ${n.status}${n.is_overdue && n.status!=='Completed' ? ' overdue' : ''}">${esc(n.status)}</span>
            <span class="text-muted" style="font-size:0.68rem;">From: ${esc(n.source_dept_name || n.created_by_username)}</span>
            <span class="text-muted" style="font-size:0.68rem;">Deadline: ${fmt(n.deadline)}</span>
            ${overdueBadge}
          </div>
          ${n.remark ? `<p class="text-muted text-small" style="margin-top:0.4rem;font-style:italic;">"${esc(n.remark)}"</p>` : ''}
        </div>
        <div style="display:flex; flex-direction:column; gap:0.4rem; align-items:flex-end;">
          ${actionBtn}
        </div>
      </div>`;
  }).join('');

  // Attach click handlers after innerHTML is set (elements exist in DOM now).
  list.querySelectorAll('[data-notice-id]').forEach(el => {
    el.addEventListener('click', e => {
      e.preventDefault();
      openNoticeDetail(parseInt(el.dataset.noticeId));
    });
  });

  list.querySelectorAll('[data-action-id]').forEach(el => {
    el.addEventListener('click', () =>
      openActionModal(parseInt(el.dataset.actionId), el.dataset.actionTitle)
    );
  });
}

// ── OUTBOX ─────────────────────────────────────────────────────────────────────

/**
 * loadOutbox — fetches notices sent by this department and renders them.
 */
async function loadOutbox() {
  try {
    const res = await fetchAuth(`${API}/portal/notices/outbox`);
    allOutbox = await res.json();
    renderOutbox();
  } catch {
    document.getElementById('outbox-list').innerHTML =
      '<p class="text-muted text-small">Could not load outbox.</p>';
  }
}

/**
 * renderOutbox — renders the outbox list.
 * Each row shows target department chips (coloured by acknowledgement status),
 * pending/noted/completed counts, overdue badge, and an attachment link.
 */
function renderOutbox() {
  const list = document.getElementById('outbox-list');
  if (!allOutbox.length) {
    list.innerHTML = `<div class="empty-state">No notices issued yet.<br /><a href="notice-compose.html">Create your first notice &rarr;</a></div>`;
    return;
  }

  list.innerHTML = allOutbox.map(n => {
    const overdueBadge = n.is_overdue
      ? `<span class="overdue-badge">OVERDUE &mdash; ${n.days_lapsed}d lapsed</span>`
      : '';
    // Target chips — coloured by each user's individual acknowledgement status.
    const targetsHtml = n.targets.map(t => {
      const statusClass = t.username === 'All Users' ? '' : (t.status || '');
      const label = t.username === 'All Users'
        ? 'All Users'
        : (t.dept_code ? `${t.username} (${t.dept_code})` : t.username);
      return `<span class="target-chip ${statusClass}">${esc(label)}</span>`;
    }).join('');

    return `
      <div class="inbox-row">
        <div class="notice-date">
          ${fmt(n.created_at ? n.created_at.slice(0,10) : '')}
          <span class="year">${n.priority}</span>
        </div>
        <div>
          <a href="#" class="notice-title" data-notice-id="${n.id}">${esc(n.title)}</a>
          <div class="notice-meta" style="margin-top:0.3rem; display:flex; flex-wrap:wrap; gap:0.3rem; align-items:center;">
            <span class="prio-badge ${n.priority}">${esc(n.priority)}</span>
            <span class="text-muted" style="font-size:0.68rem;">Deadline: ${fmt(n.deadline)}</span>
            ${overdueBadge}
          </div>
          <div class="target-chips">${targetsHtml}</div>
          <p class="text-muted text-small" style="margin-top:0.3rem;">
            ${n.pending_count} pending &bull; ${n.noted_count} noted &bull; ${n.completed_count} completed
            (of ${n.total_targets} targets)
          </p>
          ${n.attachment_name ? `<a class="attachment-link" href="${n.attachment_path}" target="_blank">&#128206; ${esc(n.attachment_name)}</a>` : ''}
        </div>
      </div>`;
  }).join('');

  list.querySelectorAll('[data-notice-id]').forEach(el => {
    el.addEventListener('click', e => {
      e.preventDefault();
      openNoticeDetail(parseInt(el.dataset.noticeId));
    });
  });
}

// ── Notice Detail Modal ────────────────────────────────────────────────────────

/**
 * openNoticeDetail — fetches full notice details (including per-dept statuses)
 * and renders them in the notice-modal overlay.
 * Opening the detail automatically marks the notice as read for this dept.
 * Shows a "Delete Notice" button if the sender is viewing and all depts have completed.
 * @param {number} id — notice ID
 */
async function openNoticeDetail(id) {
  const modal   = document.getElementById('notice-modal');
  const content = document.getElementById('notice-modal-content');

  // Show loading state immediately so the modal appears without delay.
  content.innerHTML = `<button class="modal-close" id="notice-modal-close">&times;</button><p class="text-muted text-small">Loading&hellip;</p>`;
  modal.style.display  = 'block';
  document.body.style.overflow = 'hidden';

  document.getElementById('notice-modal-close').addEventListener('click', () => closeModal('notice-modal'));

  try {
    const res    = await fetchAuth(`${API}/portal/notices/${id}`);
    const notice = await res.json();

    // Build the status table rows — one row per recipient user.
    const statusRows = notice.statuses.map(s => `
      <tr>
        <td>${esc(s.username)}${s.dept_code ? ` <span class="text-muted text-small">(${esc(s.dept_code)})</span>` : ''}</td>
        <td><span class="status-badge ${s.status}">${esc(s.status)}</span></td>
        <td class="text-small">${s.remark ? esc(s.remark) : '<span class="text-muted">—</span>'}</td>
        <td>${s.reply_path ? `<a class="attachment-link" href="${s.reply_path}" target="_blank">Reply</a>` : '<span class="text-muted text-small">—</span>'}</td>
      </tr>`).join('');

    // Determine if the "Close Notice" button should be shown.
    // Dept users: only when they own the notice AND all recipients have completed.
    // (Admin close logic is handled separately in admin.js.)
    const isOwnNotice  = notice.created_by === user.id;
    const allCompleted = notice.statuses.length > 0 &&
      notice.statuses.every(s => s.status === 'Completed');

    content.innerHTML = `
      <button class="modal-close" id="notice-modal-close-2">&times;</button>
      <p class="text-muted" style="font-size:0.65rem; letter-spacing:0.15em; text-transform:uppercase; margin-bottom:0.5rem;">
        ${esc(notice.source_dept_name || notice.created_by_username)} &mdash; ${fmt(notice.created_at.slice(0,10))}
      </p>
      <h2 style="margin-bottom:0.8rem;">${esc(notice.title)}</h2>
      <div style="display:flex; gap:0.5rem; flex-wrap:wrap; margin-bottom:1rem;">
        <span class="prio-badge ${notice.priority}">${esc(notice.priority)}</span>
        <span class="tag">Deadline: ${fmt(notice.deadline)}</span>
        ${notice.is_overdue ? `<span class="overdue-badge">OVERDUE</span>` : ''}
      </div>
      <hr class="rule" />
      <p style="white-space:pre-wrap;">${esc(notice.body)}</p>
      ${notice.attachment_name ? `<p><a class="attachment-link" href="${notice.attachment_path}" target="_blank">&#128206; ${esc(notice.attachment_name)}</a></p>` : ''}
      <hr class="rule" />
      <h3 style="font-size:0.7rem; letter-spacing:0.15em; text-transform:uppercase; color:var(--muted); margin-bottom:0.8rem;">Status per Recipient</h3>
      <div class="table-scroll">
        <table class="officials-table">
          <thead><tr><th>Recipient</th><th>Status</th><th>Remark</th><th>Reply</th></tr></thead>
          <tbody>${statusRows}</tbody>
        </table>
      </div>
      ${isOwnNotice && allCompleted ? `
      <div style="margin-top:1rem;padding-top:1rem;border-top:1px solid var(--rule);display:flex;align-items:center;gap:0.8rem;flex-wrap:wrap;">
        <button class="btn btn-sm" style="background:var(--accent-3);color:#fff;" data-close-id="${id}">Close Notice</button>
        <span class="text-muted text-small">All recipients completed &mdash; closing will permanently delete files and archive statistics.</span>
      </div>` : ''}`;

    document.getElementById('notice-modal-close-2').addEventListener('click', () => closeModal('notice-modal'));
    content.querySelector('[data-close-id]')?.addEventListener('click', () => closeNotice(id));

    // Reload inbox in background so the unread dot disappears (is_read was set on the server).
    loadInbox();
  } catch {
    content.innerHTML += '<p class="text-muted text-small">Could not load notice details.</p>';
  }
}

// ── Action Modal (Noted / Completed response) ──────────────────────────────────

/**
 * openActionModal — opens the response form for a specific notice.
 * Pre-fills the notice ID hidden field and resets all form inputs.
 * @param {number} noticeId — ID of the notice to respond to
 * @param {string} title    — notice title displayed in the modal header
 */
function openActionModal(noticeId, title) {
  document.getElementById('action-notice-id').value          = noticeId;
  document.getElementById('action-modal-title').textContent  = `Respond to: ${title}`;
  document.getElementById('action-remark').value             = '';
  document.getElementById('action-reply-file').value         = '';
  document.getElementById('action-status').style.display     = 'none';
  document.getElementById('action-status-select-el').value   = 'Noted'; // default to Noted
  document.getElementById('action-modal').style.display      = 'block';
  document.body.style.overflow = 'hidden';
}

/**
 * submitAction — handles the action form submission.
 * Sends a PATCH request with the selected status, remark, and optional reply file.
 * On success: shows a brief confirmation then reloads the dashboard.
 * On failure: displays the server error message in the modal.
 * @param {Event} e — form submit event
 */
async function submitAction(e) {
  e.preventDefault();
  const btn       = document.getElementById('action-submit-btn');
  const statusEl  = document.getElementById('action-status');
  const noticeId  = document.getElementById('action-notice-id').value;
  const remark    = document.getElementById('action-remark').value.trim();
  const statusVal = document.getElementById('action-status-select-el')?.value || 'Completed';
  const replyFile = document.getElementById('action-reply-file').files[0];

  // Client-side validation — remark is mandatory.
  if (!remark) {
    statusEl.className   = 'form-status error';
    statusEl.textContent = 'Remark is required.';
    statusEl.style.display = 'block';
    return;
  }

  btn.disabled    = true;
  btn.textContent = 'Submitting...';
  statusEl.style.display = 'none';

  try {
    // Use FormData so the optional reply file can be included as multipart.
    const fd = new FormData();
    fd.append('status', statusVal);
    fd.append('remark', remark);
    if (replyFile) fd.append('reply', replyFile);

    const res  = await fetchAuth(`${API}/portal/notices/${noticeId}/status`, { method: 'PATCH', body: fd });
    const data = await res.json();

    statusEl.className   = 'form-status success';
    statusEl.textContent = data.message;
    statusEl.style.display = 'block';

    // Brief pause so the user can read the success message before the modal closes.
    setTimeout(() => {
      closeModal('action-modal');
      loadDashboard(); // refresh both inbox and outbox
    }, 1000);
  } catch (err) {
    statusEl.className   = 'form-status error';
    statusEl.textContent = err.message;
    statusEl.style.display = 'block';
  }

  btn.disabled    = false;
  btn.textContent = 'Submit';
}

// ── Utility functions ──────────────────────────────────────────────────────────

/**
 * closeModal — hides a modal overlay and restores page scrolling.
 * @param {string} id — element ID of the modal container
 */
function closeModal(id) {
  document.getElementById(id).style.display = 'none';
  document.body.style.overflow = '';
}

/**
 * esc — XSS-safe HTML escape for user-supplied content inserted via innerHTML.
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

// ── Close Notice ───────────────────────────────────────────────────────────────

/**
 * closeNotice — closes a notice after user confirmation.
 *
 * "Closing" permanently removes the notice record, deletes all uploaded files
 * (attachment + reply files) from storage, and archives completion statistics
 * so the monthly chart is not affected.
 *
 * Available to the issuing department only when ALL target departments have
 * marked the notice as Completed. The server enforces this rule.
 *
 * @param {number} id — notice ID to close
 */
async function closeNotice(id) {
  if (!confirm('Close this notice permanently?\n\nAll uploaded files will be deleted. Statistics will be preserved. This cannot be undone.')) return;
  try {
    await fetchAuth(`${API}/portal/notices/${id}`, { method: 'DELETE' });
    closeModal('notice-modal');
    await loadDashboard();
  } catch(e) {
    alert('Could not close notice: ' + e.message);
  }
}
