/* =====================================================
   NOTICE COMPOSE — compose.js
   ===================================================== */

// ── Auth guard ────────────────────────────────────────
const token = localStorage.getItem('portal_token');
const user  = JSON.parse(localStorage.getItem('portal_user') || 'null');

if (!token || !user) {
  window.location.href = 'login.html';
} else if (user.role === 'admin') {
  window.location.href = 'admin.html';
}

function esc(str) {
  return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

document.addEventListener('DOMContentLoaded', async () => {
  setFooterYear();
  initNavToggle();

  document.getElementById('header-meta').textContent    = fmt(new Date().toISOString().slice(0,10));
  document.getElementById('compose-eyebrow').textContent = `${user.dept_name || user.username} — New Notice`;

  // Set min date to today
  document.getElementById('deadline').min = new Date().toISOString().slice(0,10);

  // Target mode toggle
  document.getElementById('target_all_radio').addEventListener('change', () => {
    document.getElementById('dept-checkbox-grid').style.display = 'none';
  });
  document.getElementById('target_specific_radio').addEventListener('change', () => {
    document.getElementById('dept-checkbox-grid').style.display = 'grid';
  });

  // Load departments for checkboxes
  try {
    const res   = await fetch(`${API}/departments`);
    const depts = await res.json();
    const grid  = document.getElementById('dept-checkbox-grid');

    grid.innerHTML = depts
      .filter(d => d.id !== user.dept_id)
      .map(d => `
        <label class="dept-checkbox-item">
          <input type="checkbox" name="target_dept_ids" value="${d.id}" />
          ${esc(d.name)}
        </label>`).join('');
  } catch {
    document.getElementById('dept-checkbox-grid').innerHTML =
      '<p class="text-muted text-small">Could not load departments.</p>';
  }

  // Form submit
  document.getElementById('compose-form').addEventListener('submit', async function (e) {
    e.preventDefault();
    const btn    = this.querySelector('button[type=submit]');
    const status = document.getElementById('compose-status');
    btn.disabled = true;
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
      const checked = [...document.querySelectorAll('input[name=target_dept_ids]:checked')];
      if (checked.length === 0) {
        status.className   = 'form-status error';
        status.textContent = 'Please select at least one target department, or choose "All Departments".';
        status.style.display = 'block';
        btn.disabled     = false;
        btn.textContent  = 'Issue Notice';
        return;
      }
      checked.forEach(cb => fd.append('target_dept_ids', cb.value));
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

      status.className   = 'form-status success';
      status.textContent = data.message;
      status.style.display = 'block';

      setTimeout(() => { window.location.href = 'dashboard.html'; }, 1200);
    } catch (err) {
      status.className   = 'form-status error';
      status.textContent = err.message;
      status.style.display = 'block';
      btn.disabled   = false;
      btn.textContent = 'Issue Notice';
    }
  });
});
