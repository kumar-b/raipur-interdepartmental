/* =====================================================
   NOTICE COMPOSE — compose.js
   Loaded on: pages/notice-compose.html
   Responsibilities:
     - Auth guard (only department users may compose notices)
     - Populate the target department checkbox grid
     - Handle "All Departments" vs specific targets toggle
     - Validate and submit the notice creation form via POST /api/portal/notices
     - Redirect to dashboard on success
   ===================================================== */

// ── Auth guard — synchronous, runs before DOM parsing completes ───────────────
// Redirect immediately so non-authorised users never see the compose form.
const token = localStorage.getItem('portal_token');
const user  = JSON.parse(localStorage.getItem('portal_user') || 'null');

if (!token || !user) {
  window.location.href = 'login.html';   // no active session
} else if (user.role === 'admin') {
  window.location.href = 'admin.html';   // admin uses the admin dashboard instead
}

/**
 * esc — XSS-safe HTML escape for department names inserted into the checkbox grid.
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

// ── Main init (waits for DOM) ─────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  // Shared utilities from main.js (setFooterYear, initNavToggle, fmt).
  setFooterYear();
  initNavToggle();

  // Header — show current date and the composing department name.
  document.getElementById('header-meta').textContent     = fmt(new Date().toISOString().slice(0,10));
  document.getElementById('compose-eyebrow').textContent = `${user.dept_name || user.username} — New Notice`;

  // Prevent selecting past dates in the deadline date picker.
  document.getElementById('deadline').min = new Date().toISOString().slice(0,10);

  // ── Target mode toggle ──────────────────────────────────────────────────────
  // "All Departments" radio hides the checkbox grid (not needed).
  // "Specific Departments" radio reveals it so the user can pick targets.
  document.getElementById('target_all_radio').addEventListener('change', () => {
    document.getElementById('dept-checkbox-grid').style.display = 'none';
  });
  document.getElementById('target_specific_radio').addEventListener('change', () => {
    document.getElementById('dept-checkbox-grid').style.display = 'grid';
  });

  // ── Load department checkboxes ──────────────────────────────────────────────
  // Public endpoint — no auth needed to list departments.
  // Filter out the current department so a dept cannot target itself.
  try {
    const res   = await fetch(`${API}/departments`);
    const depts = await res.json();
    const grid  = document.getElementById('dept-checkbox-grid');

    grid.innerHTML = depts
      .filter(d => d.id !== user.dept_id) // exclude own department
      .map(d => `
        <label class="dept-checkbox-item">
          <input type="checkbox" name="target_dept_ids" value="${d.id}" />
          ${esc(d.name)}
        </label>`).join('');
  } catch {
    // Show a graceful error if the department list cannot be fetched.
    document.getElementById('dept-checkbox-grid').innerHTML =
      '<p class="text-muted text-small">Could not load departments.</p>';
  }

  // ── Form submit handler ─────────────────────────────────────────────────────
  document.getElementById('compose-form').addEventListener('submit', async function (e) {
    e.preventDefault();
    const btn    = this.querySelector('button[type=submit]');
    const status = document.getElementById('compose-status');
    btn.disabled    = true;
    btn.textContent = 'Issuing notice...';
    status.style.display = 'none';

    const isTargetAll = document.getElementById('target_all_radio').checked;

    // Build FormData so the optional file attachment is sent as multipart.
    const fd = new FormData();
    fd.append('title',      document.getElementById('title').value.trim());
    fd.append('body',       document.getElementById('body').value.trim());
    fd.append('priority',   document.getElementById('priority').value);
    fd.append('deadline',   document.getElementById('deadline').value);
    fd.append('target_all', isTargetAll ? '1' : '0');

    if (!isTargetAll) {
      // Collect all checked department IDs.
      const checked = [...document.querySelectorAll('input[name=target_dept_ids]:checked')];
      if (checked.length === 0) {
        // Client-side guard — the server also validates this, but giving
        // immediate feedback avoids an unnecessary network round-trip.
        status.className   = 'form-status error';
        status.textContent = 'Please select at least one target department, or choose "All Departments".';
        status.style.display = 'block';
        btn.disabled     = false;
        btn.textContent  = 'Issue Notice';
        return;
      }
      // Append each selected dept ID as a separate FormData entry.
      checked.forEach(cb => fd.append('target_dept_ids', cb.value));
    }

    // Append the optional file attachment if one was selected.
    const attachFile = document.getElementById('attachment').files[0];
    if (attachFile) fd.append('attachment', attachFile);

    try {
      // POST to the authenticated notices endpoint — include JWT manually
      // because FormData prevents using a JSON Content-Type header.
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

      // Redirect to the dashboard after a short delay so the user can read
      // the success message before the page changes.
      setTimeout(() => { window.location.href = 'dashboard.html'; }, 1200);
    } catch (err) {
      status.className   = 'form-status error';
      status.textContent = err.message;
      status.style.display = 'block';
      btn.disabled    = false;
      btn.textContent = 'Issue Notice';
    }
  });
});
