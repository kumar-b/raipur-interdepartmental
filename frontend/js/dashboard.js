/* =====================================================
   DEPARTMENT DASHBOARD — dashboard.js
   ===================================================== */

// ── Auth guard ────────────────────────────────────────
const token = localStorage.getItem('portal_token');
const user  = JSON.parse(localStorage.getItem('portal_user') || 'null');

if (!token || !user) {
  window.location.href = 'login.html';
} else if (user.role === 'admin') {
  window.location.href = 'admin.html';
}

// ── Shared fetch with auth ────────────────────────────
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
    localStorage.removeItem('portal_token');
    localStorage.removeItem('portal_user');
    window.location.href = 'login.html';
    throw new Error('Session expired.');
  }

  if (!res.ok) {
    let errMsg = `Server error (HTTP ${res.status})`;
    try { const d = await res.json(); errMsg = d.error || errMsg; } catch (_) {}
    throw new Error(errMsg);
  }

  return res;
}

// ── State ─────────────────────────────────────────────
let allInbox  = [];
let allOutbox = [];

// ── Logout: event delegation so it always works ───────
document.addEventListener('click', function (e) {
  const target = e.target.closest('#nav-logout');
  if (!target) return;
  e.preventDefault();
  localStorage.removeItem('portal_token');
  localStorage.removeItem('portal_user');
  window.location.href = 'login.html';
});

// ── Init ──────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  try { if (typeof setFooterYear === 'function') setFooterYear(); } catch(e) { console.error(e); }
  try { if (typeof initNavToggle === 'function') initNavToggle(); } catch(e) { console.error(e); }

  try {
    const metaEl = document.getElementById('header-meta');
    if (metaEl) metaEl.textContent = new Date().toLocaleDateString('en-IN', { day:'2-digit', month:'short', year:'numeric' });
    const titleEl = document.getElementById('dash-title');
    if (titleEl) titleEl.textContent = user.dept_name || 'Department Dashboard';
    const subEl = document.getElementById('dash-subtitle');
    if (subEl) subEl.textContent = `Logged in as: ${user.username}`;
  } catch(e) { console.error('header setup:', e); }

  // Tabs
  document.querySelectorAll('.dash-tab').forEach(tab => {
    tab.addEventListener('click', () => switchTab(tab.dataset.tab));
  });

  // Inbox filter
  document.getElementById('inbox-filter').addEventListener('click', e => {
    const btn = e.target.closest('.filter-btn');
    if (!btn) return;
    document.querySelectorAll('#inbox-filter .filter-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    renderInbox(btn.dataset.status);
  });

  // Modal close buttons
  document.getElementById('notice-modal').addEventListener('click', e => {
    if (e.target.id === 'notice-modal') closeModal('notice-modal');
  });
  document.getElementById('notice-modal-close').addEventListener('click', () => closeModal('notice-modal'));
  document.getElementById('action-modal').addEventListener('click', e => {
    if (e.target.id === 'action-modal') closeModal('action-modal');
  });
  document.getElementById('action-modal-close').addEventListener('click', () => closeModal('action-modal'));
  document.getElementById('action-modal-close-2').addEventListener('click', () => closeModal('action-modal'));

  // Action form submit
  document.getElementById('action-form').addEventListener('submit', submitAction);

  loadDashboard();
});

function switchTab(tab) {
  document.querySelectorAll('.dash-tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.dash-panel').forEach(p => p.classList.remove('active'));
  document.querySelector(`[data-tab="${tab}"]`).classList.add('active');
  document.getElementById(`panel-${tab}`).classList.add('active');
}

async function loadDashboard() {
  await Promise.all([loadInbox(), loadOutbox()]);
}

// ── INBOX ─────────────────────────────────────────────
async function loadInbox() {
  try {
    const res  = await fetchAuth(`${API}/portal/notices/inbox`);
    allInbox   = await res.json();
    const pend = allInbox.filter(n => n.status === 'Pending').length;
    const ctr  = document.getElementById('inbox-pending-count');
    if (pend > 0) ctr.textContent = `(${pend} pending)`;
    renderInbox('all');
  } catch {
    document.getElementById('inbox-list').innerHTML = '<p class="text-muted text-small">Could not load inbox.</p>';
  }
}

function renderInbox(filterStatus) {
  const list = document.getElementById('inbox-list');
  const items = filterStatus === 'all' ? allInbox : allInbox.filter(n => n.status === filterStatus);

  if (!items.length) {
    list.innerHTML = `<div class="empty-state">No notices in this category.</div>`;
    return;
  }

  list.innerHTML = items.map(n => {
    const overdueBadge = n.is_overdue
      ? `<span class="overdue-badge">OVERDUE &mdash; ${n.days_lapsed}d lapsed</span>`
      : '';
    const unreadClass  = n.is_read === 0 ? 'unread' : '';
    const unreadDot    = n.is_read === 0 ? '<span class="unread-dot"></span>' : '';
    const actionBtn    = n.status !== 'Completed'
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
            <span class="text-muted" style="font-size:0.68rem;">From: ${esc(n.source_dept_name)}</span>
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

  // Notice detail click
  list.querySelectorAll('[data-notice-id]').forEach(el => {
    el.addEventListener('click', e => { e.preventDefault(); openNoticeDetail(parseInt(el.dataset.noticeId)); });
  });

  // Action button click
  list.querySelectorAll('[data-action-id]').forEach(el => {
    el.addEventListener('click', () => openActionModal(parseInt(el.dataset.actionId), el.dataset.actionTitle));
  });
}

// ── OUTBOX ────────────────────────────────────────────
async function loadOutbox() {
  try {
    const res  = await fetchAuth(`${API}/portal/notices/outbox`);
    allOutbox  = await res.json();
    renderOutbox();
  } catch {
    document.getElementById('outbox-list').innerHTML = '<p class="text-muted text-small">Could not load outbox.</p>';
  }
}

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
    const targetsHtml = n.targets.map(t => {
      const statusClass = t.name === 'All Departments' ? '' : (t.status || '');
      return `<span class="target-chip ${statusClass}">${esc(t.name)}</span>`;
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
    el.addEventListener('click', e => { e.preventDefault(); openNoticeDetail(parseInt(el.dataset.noticeId)); });
  });
}

// ── Notice Detail Modal ───────────────────────────────
async function openNoticeDetail(id) {
  const modal   = document.getElementById('notice-modal');
  const content = document.getElementById('notice-modal-content');
  content.innerHTML = `<button class="modal-close" id="notice-modal-close">&times;</button><p class="text-muted text-small">Loading&hellip;</p>`;
  modal.style.display = 'block';
  document.body.style.overflow = 'hidden';

  document.getElementById('notice-modal-close').addEventListener('click', () => closeModal('notice-modal'));

  try {
    const res    = await fetchAuth(`${API}/portal/notices/${id}`);
    const notice = await res.json();

    const statusRows = notice.statuses.map(s => `
      <tr>
        <td>${esc(s.dept_name)}</td>
        <td><span class="status-badge ${s.status}">${esc(s.status)}</span></td>
        <td class="text-small">${s.remark ? esc(s.remark) : '<span class="text-muted">—</span>'}</td>
        <td>${s.reply_path ? `<a class="attachment-link" href="${s.reply_path}" target="_blank">Reply</a>` : '<span class="text-muted text-small">—</span>'}</td>
      </tr>`).join('');

    content.innerHTML = `
      <button class="modal-close" id="notice-modal-close-2">&times;</button>
      <p class="text-muted" style="font-size:0.65rem; letter-spacing:0.15em; text-transform:uppercase; margin-bottom:0.5rem;">
        ${esc(notice.source_dept_name)} &mdash; ${fmt(notice.created_at.slice(0,10))}
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
      <h3 style="font-size:0.7rem; letter-spacing:0.15em; text-transform:uppercase; color:var(--muted); margin-bottom:0.8rem;">Status per Department</h3>
      <div class="table-scroll">
        <table class="officials-table">
          <thead><tr><th>Department</th><th>Status</th><th>Remark</th><th>Reply</th></tr></thead>
          <tbody>${statusRows}</tbody>
        </table>
      </div>`;

    document.getElementById('notice-modal-close-2').addEventListener('click', () => closeModal('notice-modal'));

    // Reload inbox to reflect is_read change
    loadInbox();
  } catch {
    content.innerHTML += '<p class="text-muted text-small">Could not load notice details.</p>';
  }
}

// ── Action Modal (Noted / Completed) ─────────────────
function openActionModal(noticeId, title) {
  document.getElementById('action-notice-id').value = noticeId;
  document.getElementById('action-modal-title').textContent = `Respond to: ${title}`;
  document.getElementById('action-remark').value = '';
  document.getElementById('action-reply-file').value = '';
  document.getElementById('action-status').style.display = 'none';

  // Show two buttons: Noted and Completed — rendered as a select for simplicity
  const existingSelect = document.getElementById('action-status-select');
  if (!existingSelect) {
    const sel = document.createElement('div');
    sel.className = 'form-group';
    sel.id = 'action-status-select-wrap';
    sel.innerHTML = `
      <label for="action-status-select-el">Action *</label>
      <select id="action-status-select-el">
        <option value="Noted">Mark as Noted (acknowledged, no further action)</option>
        <option value="Completed">Mark as Completed (action taken)</option>
      </select>`;
    document.getElementById('action-form').insertBefore(sel, document.getElementById('action-form').firstChild);
  }

  document.getElementById('action-modal').style.display = 'block';
  document.body.style.overflow = 'hidden';
}

async function submitAction(e) {
  e.preventDefault();
  const btn      = document.getElementById('action-submit-btn');
  const statusEl = document.getElementById('action-status');
  const noticeId = document.getElementById('action-notice-id').value;
  const remark   = document.getElementById('action-remark').value.trim();
  const statusVal = document.getElementById('action-status-select-el')?.value || 'Completed';
  const replyFile = document.getElementById('action-reply-file').files[0];

  if (!remark) {
    statusEl.className = 'form-status error';
    statusEl.textContent = 'Remark is required.';
    statusEl.style.display = 'block';
    return;
  }

  btn.disabled = true;
  btn.textContent = 'Submitting...';
  statusEl.style.display = 'none';

  try {
    const fd = new FormData();
    fd.append('status', statusVal);
    fd.append('remark', remark);
    if (replyFile) fd.append('reply', replyFile);

    const res  = await fetchAuth(`${API}/portal/notices/${noticeId}/status`, { method: 'PATCH', body: fd });
    const data = await res.json();

    if (!res.ok) throw new Error(data.error || 'Update failed.');

    statusEl.className   = 'form-status success';
    statusEl.textContent = data.message;
    statusEl.style.display = 'block';

    setTimeout(() => {
      closeModal('action-modal');
      loadDashboard();
    }, 1000);
  } catch (err) {
    statusEl.className   = 'form-status error';
    statusEl.textContent = err.message;
    statusEl.style.display = 'block';
  }

  btn.disabled = false;
  btn.textContent = 'Submit';
}

// ── Utilities ─────────────────────────────────────────
function closeModal(id) {
  document.getElementById(id).style.display = 'none';
  document.body.style.overflow = '';
}

function esc(str) {
  return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
