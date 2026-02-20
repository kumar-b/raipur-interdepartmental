/* =====================================================
   LOGIN PAGE — login.js
   Loaded on: pages/login.html
   Responsibilities:
     - Redirect already-authenticated users to their dashboard
     - Handle the login form submission
   ===================================================== */

// Redirect immediately if a valid session already exists.
(function () {
  const token = localStorage.getItem('portal_token');
  const user  = JSON.parse(localStorage.getItem('portal_user') || 'null');
  if (token && user) {
    window.location.href = user.role === 'admin' ? 'admin.html' : 'dashboard.html';
  }
})();

document.addEventListener('DOMContentLoaded', () => {
  // setFooterYear is provided by main.js which is loaded before this file.
  if (typeof setFooterYear === 'function') setFooterYear();

  document.getElementById('login-form').addEventListener('submit', async function (e) {
    e.preventDefault();
    const btn    = this.querySelector('button[type=submit]');
    const status = document.getElementById('login-status');
    btn.disabled    = true;
    btn.textContent = 'Signing in...';
    status.style.display = 'none';

    try {
      const res  = await fetch('/api/auth/login', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          username: document.getElementById('username').value.trim(),
          password: document.getElementById('password').value
        })
      });
      const data = await res.json();

      if (!res.ok) throw new Error(data.error || 'Login failed.');

      localStorage.setItem('portal_token', data.token);
      localStorage.setItem('portal_user',  JSON.stringify(data.user));

      window.location.href = data.user.role === 'admin' ? 'admin.html' : 'dashboard.html';
    } catch (err) {
      status.className     = 'form-status error';
      status.textContent   = err.message;
      status.style.display = 'block';
      btn.disabled         = false;
      btn.textContent      = 'Sign In';
    }
  });
});
