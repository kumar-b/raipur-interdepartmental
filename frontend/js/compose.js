/* =====================================================
   NOTICE COMPOSE — compose.js
   Responsibilities:
     - Auth guard (department users only)
     - Load all active users for the recipient picker
     - Group users by department label for visual clarity
     - Live search filter across the user list
     - Handle "All Users" vs specific user selection
     - Submit notice via POST /api/portal/notices
   ===================================================== */

const token = localStorage.getItem('portal_token');
const user  = JSON.parse(localStorage.getItem('portal_user') || 'null');

if (!token || !user) {
  window.location.href = 'login.html';
} else if (user.role === 'admin') {
  window.location.href = 'admin.html';
}

function esc(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

document.addEventListener('DOMContentLoaded', async () => {
  setFooterYear();
  initNavToggle();

  document.getElementById('header-meta').textContent     = fmt(new Date().toISOString().slice(0, 10));
  document.getElementById('compose-eyebrow').textContent = `${user.dept_name || user.username} — New Notice`;
  document.getElementById('deadline').min = new Date().toISOString().slice(0, 10);

  // ── Target mode toggle ────────────────────────────────────────────────────
  const userPickerWrap = document.getElementById('user-picker-wrap');

  document.getElementById('target_all_radio').addEventListener('change', () => {
    userPickerWrap.style.display = 'none';
  });
  document.getElementById('target_specific_radio').addEventListener('change', () => {
    userPickerWrap.style.display = 'block';
  });

  // ── Load active users and render grouped picker ───────────────────────────
  try {
    const res   = await fetch(`${API}/portal/users/active`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const users = await res.json();
    const grid  = document.getElementById('user-checkbox-grid');

    if (!users.length) {
      grid.innerHTML = '<p class="text-muted text-small">No other users available.</p>';
    } else {
      // Group users by their department label.
      const byDept = {};
      users.forEach(u => {
        const key = u.dept_name || 'No Department';
        if (!byDept[key]) byDept[key] = [];
        byDept[key].push(u);
      });

      grid.innerHTML = Object.entries(byDept).map(([deptName, deptUsers]) => `
        <div class="user-group">
          <div class="user-group-label">${esc(deptName)}</div>
          ${deptUsers.map(u => `
            <label class="dept-checkbox-item">
              <input type="checkbox" name="target_user_ids" value="${u.id}" />
              ${esc(u.username)}
            </label>`).join('')}
        </div>`).join('');
    }
  } catch {
    document.getElementById('user-checkbox-grid').innerHTML =
      '<p class="text-muted text-small">Could not load users.</p>';
  }

  // ── Live search filter ────────────────────────────────────────────────────
  document.getElementById('user-search').addEventListener('input', function () {
    const q = this.value.toLowerCase();
    document.querySelectorAll('#user-checkbox-grid .dept-checkbox-item').forEach(item => {
      item.style.display = item.textContent.toLowerCase().includes(q) ? '' : 'none';
    });
    // Hide group headers when all their users are hidden.
    document.querySelectorAll('#user-checkbox-grid .user-group').forEach(group => {
      const anyVisible = [...group.querySelectorAll('.dept-checkbox-item')]
        .some(i => i.style.display !== 'none');
      group.style.display = anyVisible ? '' : 'none';
    });
  });

  // ── Form submit ───────────────────────────────────────────────────────────
  document.getElementById('compose-form').addEventListener('submit', async function (e) {
    e.preventDefault();
    const btn    = this.querySelector('button[type=submit]');
    const status = document.getElementById('compose-status');
    btn.disabled    = true;
    btn.textContent = 'Issuing notice...';
    status.style.display = 'none';

    const isTargetAll = document.getElementById('target_all_radio').checked;

    const fd = new FormData();
    fd.append('title',      document.getElementById('title').value.trim());
    fd.append('body',       document.getElementById('body').value.trim());
    fd.append('priority',   document.getElementById('priority').value);
    fd.append('deadline',   document.getElementById('deadline').value);
    fd.append('target_all', isTargetAll ? '1' : '0');

    if (!isTargetAll) {
      const checked = [...document.querySelectorAll('input[name=target_user_ids]:checked')];
      if (checked.length === 0) {
        status.className     = 'form-status error';
        status.textContent   = 'Please select at least one recipient, or choose "All Users".';
        status.style.display = 'block';
        btn.disabled    = false;
        btn.textContent = 'Issue Notice';
        return;
      }
      checked.forEach(cb => fd.append('target_user_ids', cb.value));
    }

    const attachFile = document.getElementById('attachment').files[0];
    if (attachFile) fd.append('attachment', attachFile);

    try {
      const res  = await fetch(`${API}/portal/notices`, {
        method:  'POST',
        headers: { 'Authorization': `Bearer ${token}` },
        body:    fd
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to create notice.');

      status.className     = 'form-status success';
      status.textContent   = data.message;
      status.style.display = 'block';
      setTimeout(() => { window.location.href = 'dashboard.html'; }, 1200);
    } catch (err) {
      status.className     = 'form-status error';
      status.textContent   = err.message;
      status.style.display = 'block';
      btn.disabled    = false;
      btn.textContent = 'Issue Notice';
    }
  });
});
