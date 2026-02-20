/* =====================================================
   RAIPUR INTERDEPARTMENTAL PORTAL — main.js
   Handles: nav toggle, date display, public data fetching,
            and HTML rendering for the public-facing pages.
   Loaded on: index (home), departments, notices, officials, contact.
   API base: http://localhost:3000
   ===================================================== */

// Base URL for all API calls — change this when deploying to production.
const API = 'http://localhost:3000/api';

/* ── Date / formatting helpers ─────────────────────────────────────────────── */

/**
 * fmt — formats a date string into a human-readable Indian locale format.
 * Example: "2026-02-15" → "15 Feb 2026"
 * @param {string} dateStr — ISO date string or any Date-parseable string
 * @returns {string}
 */
function fmt(dateStr) {
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

/**
 * fmtYear — extracts just the 4-digit year from a date string.
 * Used in notice cards to display the year as a secondary label.
 * @param {string} dateStr
 * @returns {number}
 */
function fmtYear(dateStr) {
  return new Date(dateStr).getFullYear();
}

/**
 * fetchJSON — lightweight fetch wrapper that throws on non-2xx responses.
 * Used for public (unauthenticated) API calls throughout main.js.
 * @param {string} url
 * @returns {Promise<any>} — parsed JSON body
 */
async function fetchJSON(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

/* ── UI helpers ─────────────────────────────────────────────────────────────── */

/**
 * setLiveDate — displays the current date in the header element #live-date.
 * Called once on DOMContentLoaded; updates the header on every page load.
 */
function setLiveDate() {
  const el = document.getElementById('live-date');
  if (!el) return;
  const now = new Date();
  el.textContent = now.toLocaleDateString('en-IN', {
    weekday: 'short', day: '2-digit', month: 'short', year: 'numeric'
  });
}

/**
 * setFooterYear — injects the current 4-digit year into #footer-year.
 * Keeps the copyright notice in the footer automatically up to date.
 */
function setFooterYear() {
  const el = document.getElementById('footer-year');
  if (el) el.textContent = new Date().getFullYear();
}

/**
 * initNavToggle — wires up the mobile hamburger menu button.
 * Toggles the 'open' class on the nav list and updates aria-expanded
 * for accessibility. Also closes the menu when any nav link is clicked.
 */
function initNavToggle() {
  const btn  = document.getElementById('nav-toggle');
  const list = document.getElementById('nav-list');
  if (!btn || !list) return;

  btn.addEventListener('click', () => {
    const isOpen = list.classList.toggle('open');
    btn.setAttribute('aria-expanded', isOpen);
  });

  // Close the menu automatically when the user navigates to a page.
  list.querySelectorAll('a').forEach(a => {
    a.addEventListener('click', () => {
      list.classList.remove('open');
      btn.setAttribute('aria-expanded', 'false');
    });
  });
}

/**
 * fetchAuth — authenticated fetch wrapper.
 * Reads the JWT from localStorage and attaches it as a Bearer token.
 * Used on pages that need to call protected /api/portal/* endpoints.
 * @param {string} url
 * @param {RequestInit} options — standard fetch options (method, body, headers…)
 * @returns {Promise<Response>}
 */
function fetchAuth(url, options = {}) {
  const t = localStorage.getItem('portal_token');
  return fetch(url, {
    ...options,
    headers: { ...(options.headers || {}), 'Authorization': `Bearer ${t}` }
  });
}

/**
 * esc — XSS-safe HTML escape for user-supplied strings.
 * Always use this before inserting any data into innerHTML.
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

/**
 * currentPage — detects which page is currently loaded by inspecting the URL path.
 * Used in the DOMContentLoaded handler to call the correct init function.
 * @returns {string} — one of: 'home', 'login', 'dashboard', 'admin', 'compose',
 *                             'departments', 'notices', 'officials', 'contact'
 */
function currentPage() {
  const path = window.location.pathname;
  if (path.includes('login'))       return 'login';
  if (path.includes('dashboard'))   return 'dashboard';
  if (path.includes('admin'))       return 'admin';
  if (path.includes('compose'))     return 'compose';
  if (path.includes('departments')) return 'departments';
  if (path.includes('notices'))     return 'notices';
  if (path.includes('officials'))   return 'officials';
  if (path.includes('contact'))     return 'contact';
  return 'home';
}

/* ═══════════════════════════════════════════════════════════════════════════
   HOME PAGE
   Loads the latest 4 notices, top 6 departments, and a preview of officials
   for the public landing page.
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * initHome — entry point for the home page.
 * Fires all three data loads in parallel for faster page display.
 */
async function initHome() {
  await Promise.all([loadLatestNotices(), loadHomeDepts(), loadHomeOfficials()]);
}

/**
 * loadLatestNotices — fetches and renders the 4 most recent public notices
 * into the #latest-notices container on the home page.
 * Falls back to static data if the API is unreachable.
 */
async function loadLatestNotices() {
  const container = document.getElementById('latest-notices');
  if (!container) return;
  try {
    const notices = await fetchJSON(`${API}/notices`);
    container.innerHTML = notices.slice(0, 4).map(n => noticeCardHTML(n)).join('');
  } catch {
    // Use built-in fallback data so the page still looks correct without a server.
    container.innerHTML = fallbackNotices().slice(0, 4).map(n => noticeCardHTML(n)).join('');
  }
}

/**
 * loadHomeDepts — fetches and renders the first 6 departments into #home-depts.
 * Provides a quick overview of available departments on the landing page.
 */
async function loadHomeDepts() {
  const container = document.getElementById('home-depts');
  if (!container) return;
  try {
    const depts = await fetchJSON(`${API}/departments`);
    container.innerHTML = depts.slice(0, 6).map(d => deptCardHTML(d)).join('');
  } catch {
    container.innerHTML = fallbackDepts().slice(0, 6).map(d => deptCardHTML(d)).join('');
  }
}

/**
 * loadHomeOfficials — fetches all officials and renders them into the home
 * officials table (without the email column to keep the preview compact).
 */
async function loadHomeOfficials() {
  const tbody = document.querySelector('#home-officials tbody');
  if (!tbody) return;
  try {
    const officials = await fetchJSON(`${API}/departments/officials/all`);
    tbody.innerHTML = officials.map(o => officialRowHTML(o, false)).join('');
  } catch {
    tbody.innerHTML = fallbackOfficials().map(o => officialRowHTML(o, false)).join('');
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   DEPARTMENTS PAGE
   Renders all departments in a filterable card grid.
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * initDepartments — loads the full department list and wires up the
 * category filter buttons so users can narrow down the grid.
 */
async function initDepartments() {
  const grid = document.getElementById('dept-grid');
  if (!grid) return;

  let allDepts = [];
  try {
    allDepts = await fetchJSON(`${API}/departments`);
  } catch {
    allDepts = fallbackDepts();
  }

  /** render — re-renders the grid filtered by the given category string.
   *  Passing 'all' shows every department regardless of category. */
  function render(cat) {
    const filtered = cat === 'all' ? allDepts : allDepts.filter(d => d.category === cat);
    grid.innerHTML = filtered.map(d => deptCardHTML(d)).join('');
  }

  render('all'); // show everything on initial load

  // Event delegation on the filter button group — only react to .filter-btn clicks.
  document.getElementById('category-filter')?.addEventListener('click', e => {
    const btn = e.target.closest('.filter-btn');
    if (!btn) return;
    // Remove 'active' from all buttons, then add it to the clicked one.
    document.querySelectorAll('#category-filter .filter-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    render(btn.dataset.cat);
  });
}

/* ═══════════════════════════════════════════════════════════════════════════
   NOTICES PAGE
   Renders public notices in a filterable list with a detail modal.
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * initNotices — loads all public notices, wires up category filters,
 * and sets up the click handler to open the notice detail modal.
 */
async function initNotices() {
  const list = document.getElementById('notices-list');
  if (!list) return;

  let allNotices = [];
  try {
    allNotices = await fetchJSON(`${API}/notices`);
  } catch {
    allNotices = fallbackNotices();
  }

  /** render — re-renders the list filtered by category, or all if 'all'. */
  function render(cat) {
    const filtered = cat === 'all' ? allNotices : allNotices.filter(n => n.category === cat);
    list.innerHTML = filtered.length
      ? filtered.map(n => noticeCardHTML(n, true)).join('')
      : '<p class="text-muted text-small" style="padding:1rem 0;">No notices in this category.</p>';
  }

  render('all');

  // Filter button group — same event delegation pattern as departments.
  document.getElementById('notice-filter')?.addEventListener('click', e => {
    const btn = e.target.closest('.filter-btn');
    if (!btn) return;
    document.querySelectorAll('#notice-filter .filter-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    render(btn.dataset.cat);
  });

  // Notice detail modal — clicking a [data-notice-id] element opens the modal.
  list.addEventListener('click', e => {
    const link = e.target.closest('[data-notice-id]');
    if (!link) return;
    e.preventDefault();
    const id     = parseInt(link.dataset.noticeId);
    const notice = allNotices.find(n => n.id === id);
    if (notice) openNoticeModal(notice);
  });

  // Close the modal when the user clicks the backdrop (outside the modal box).
  document.getElementById('notice-modal')?.addEventListener('click', e => {
    if (e.target.id === 'notice-modal') closeNoticeModal();
  });
}

/**
 * openNoticeModal — populates and displays the notice detail modal overlay.
 * @param {object} n — notice data object from the API or fallback array
 */
function openNoticeModal(n) {
  const modal   = document.getElementById('notice-modal');
  const content = document.getElementById('modal-content');
  content.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:1rem;">
      <span class="text-upper text-small text-muted">${n.category} &mdash; ${fmt(n.date)}</span>
      <button onclick="closeNoticeModal()" style="background:none;border:none;cursor:pointer;font-size:1.2rem;color:var(--muted);">&times;</button>
    </div>
    <hr class="rule" />
    <h2 style="margin-bottom:1rem;">${n.title}</h2>
    <p>${n.body}</p>
    <hr class="rule" />
    <p class="text-muted text-small"><em>Issued by: ${n.issuedBy}</em><br />Department: ${n.department}</p>
  `;
  modal.style.display = 'block';
  document.body.style.overflow = 'hidden'; // prevent background scroll while modal is open
}

/**
 * closeNoticeModal — hides the notice detail modal and restores page scrolling.
 * Exposed globally so inline onclick handlers (close button) can call it.
 */
function closeNoticeModal() {
  document.getElementById('notice-modal').style.display = 'none';
  document.body.style.overflow = '';
}
window.closeNoticeModal = closeNoticeModal;

/* ═══════════════════════════════════════════════════════════════════════════
   OFFICIALS PAGE
   Renders the full officials directory table including the email column.
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * initOfficials — fetches all officials and renders them in the full table
 * (with email column shown, unlike the home page preview).
 */
async function initOfficials() {
  const tbody = document.querySelector('#officials-table tbody');
  if (!tbody) return;
  try {
    const officials = await fetchJSON(`${API}/departments/officials/all`);
    tbody.innerHTML = officials.map(o => officialRowHTML(o, true)).join('');
  } catch {
    tbody.innerHTML = fallbackOfficials().map(o => officialRowHTML(o, true)).join('');
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   CONTACT PAGE
   Handles the public contact form — adjusts layout on resize and POSTs
   the submission to /api/contact.
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * initContact — sets up the responsive layout and the form submit handler
 * for the public contact page.
 */
function initContact() {
  // Collapse the two-column grid to single column on narrow screens.
  const layout = document.getElementById('contact-layout');
  if (layout && window.innerWidth < 640) {
    layout.style.gridTemplateColumns = '1fr';
  }
  window.addEventListener('resize', () => {
    if (!layout) return;
    layout.style.gridTemplateColumns = window.innerWidth < 640 ? '1fr' : '1fr 1fr';
  });

  const form   = document.getElementById('contact-form');
  const status = document.getElementById('form-status');
  if (!form) return;

  form.addEventListener('submit', async e => {
    e.preventDefault();
    const btn    = form.querySelector('button[type=submit]');
    btn.disabled    = true;
    btn.textContent = 'Submitting...';
    status.style.display = 'none';

    // Collect and trim all form values.
    const body = {
      name:       form.name.value.trim(),
      email:      form.email.value.trim(),
      phone:      form.phone.value.trim(),
      department: form.department.value,
      subject:    form.subject.value.trim(),
      message:    form.message.value.trim()
    };

    try {
      const res  = await fetch(`${API}/contact`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(body)
      });
      const data = await res.json();
      if (res.ok) {
        status.className = 'form-status success';
        status.textContent = data.message;
        form.reset();
      } else {
        throw new Error(data.error || 'Submission failed');
      }
    } catch (err) {
      status.className   = 'form-status error';
      status.textContent = err.message || 'Could not submit. Please try again or contact us by phone.';
    }

    status.style.display = 'block';
    btn.disabled    = false;
    btn.textContent = 'Submit Communication';
  });
}

/* ═══════════════════════════════════════════════════════════════════════════
   HTML BUILDERS
   Pure functions that return HTML strings from data objects.
   All user-supplied values are NOT escaped here because this data comes
   from the server (trusted source) — keep this in mind if the data source
   ever changes to user-submitted content.
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * noticeCardHTML — builds the HTML for a single notice card.
 * @param {object}  n          — notice data object
 * @param {boolean} clickable  — if true, wraps the title in a link for the modal
 * @returns {string} — HTML string
 */
function noticeCardHTML(n, clickable = false) {
  const dateStr = fmt(n.date);
  const yearStr = fmtYear(n.date);
  const titleEl = clickable
    ? `<a href="#" data-notice-id="${n.id}" class="notice-title">${n.title}</a>`
    : `<span class="notice-title">${n.title}</span>`;
  return `
    <div class="notice-card">
      <div class="notice-date">${dateStr}<span class="year">${yearStr}</span></div>
      <div>
        ${titleEl}
        <div class="notice-meta">
          <span class="tag ${n.priority}">${n.priority}</span>
          <span class="tag">${n.category}</span>
          ${n.department}
        </div>
      </div>
    </div>`;
}

/**
 * deptCardHTML — builds the HTML for a single department card.
 * The "Official site →" link is omitted if the department has no website.
 * @param {object} d — department data object
 * @returns {string}
 */
function deptCardHTML(d) {
  return `
    <div class="dept-card">
      <span class="dept-code">${d.code}</span>
      <span class="dept-name">${d.name}</span>
      <span class="dept-category">${d.category}</span>
      ${d.website ? `<a class="dept-link" href="${d.website}" target="_blank" rel="noopener">Official site &rarr;</a>` : ''}
    </div>`;
}

/**
 * officialRowHTML — builds an HTML <tr> for a single official.
 * @param {object}  o          — official data object
 * @param {boolean} showEmail  — whether to include the email column
 * @returns {string}
 */
function officialRowHTML(o, showEmail = true) {
  return `
    <tr>
      <td><span class="official-name">${o.name}</span><span class="official-service">${o.service}</span></td>
      <td>${o.designation}</td>
      <td>${o.division}</td>
      <td><a href="tel:${o.phone.replace(/[^0-9+]/g, '')}">${o.phone}</a></td>
      ${showEmail ? `<td><a href="mailto:${o.email}">${o.email}</a></td>` : ''}
    </tr>`;
}

/* ═══════════════════════════════════════════════════════════════════════════
   FALLBACK DATA
   Used when the backend is not running so the public pages still render
   meaningful content for demonstration or offline review.
   ═══════════════════════════════════════════════════════════════════════════ */

/** fallbackNotices — returns a static set of sample notices. */
function fallbackNotices() {
  return [
    { id:1, title:"Inter-Departmental Coordination Meeting — February 2026", date:"2026-02-15", department:"Collectorate", category:"Meeting", priority:"high", body:"All departmental heads are directed to attend the monthly coordination meeting scheduled at the Collectorate Conference Hall on 20 February 2026 at 11:00 AM.", issuedBy:"Dr. Gaurav Kumar Singh, Collector & DM" },
    { id:2, title:"Submission of Annual Performance Reports — FY 2025-26", date:"2026-02-10", department:"Collectorate", category:"Circular", priority:"high", body:"All departments are instructed to submit their Annual Performance Reports for Financial Year 2025-26 to the Collectorate by 28 February 2026.", issuedBy:"Office of the Collector, Raipur" },
    { id:3, title:"Swachh Bharat Mission — Drive Schedule Q1 2026", date:"2026-02-05", department:"Nagar Nigam", category:"Notice", priority:"normal", body:"Cleanliness drives across all wards every Saturday from March to May 2026.", issuedBy:"Shri Vishwadeep, Commissioner, Nagar Nigam" },
    { id:4, title:"Digital India Training Programme for District Officers", date:"2026-01-28", department:"Collectorate", category:"Training", priority:"normal", body:"A three-day Digital India training at NIC Raipur from 10–12 March 2026.", issuedBy:"Office of the Commissioner, Raipur Division" },
    { id:5, title:"Gram Swaraj Abhiyan — Action Plan Submission", date:"2026-01-20", department:"Zilla Panchayat", category:"Circular", priority:"normal", body:"All BDOs to submit Gram Swaraj Abhiyan action plans for 2026-27 by 10 February 2026.", issuedBy:"Kumar Biswaranjan, CEO, Zilla Panchayat" },
    { id:6, title:"Security Advisory — Election Duty Preparedness", date:"2026-01-15", department:"Police Department", category:"Advisory", priority:"high", body:"All departmental heads to ensure readiness for election duty as per ECI directives.", issuedBy:"Shri Lal Umed Singh, SSP Raipur" }
  ];
}

/** fallbackDepts — returns a static list of Raipur district departments. */
function fallbackDepts() {
  return [
    { id:1,  code:"REVENUE",    name:"Revenue Department",             website:"https://revenue.cg.nic.in",          category:"Administration"    },
    { id:2,  code:"PRD",        name:"Panchayat & Rural Development",  website:"http://prd.cg.gov.in/",             category:"Rural Development" },
    { id:3,  code:"HEALTH",     name:"Health Department",              website:"http://www.cghealth.nic.in",         category:"Social Services"   },
    { id:4,  code:"AGRI",       name:"Agriculture Department",         website:"http://agriportal.cg.nic.in",        category:"Agriculture"       },
    { id:5,  code:"FOOD",       name:"Food Department",                website:"http://www.khadya.cg.nic.in/",       category:"Social Services"   },
    { id:6,  code:"EDU",        name:"Education Department",           website:"http://eduportal.cg.nic.in",         category:"Social Services"   },
    { id:7,  code:"COMMERCE",   name:"Commerce and Industry",          website:"https://industries.cg.gov.in",       category:"Economy"           },
    { id:8,  code:"MINING",     name:"Mining Department",              website:"http://chhattisgarhmines.gov.in",    category:"Economy"           },
    { id:9,  code:"HOME",       name:"Home Department",                website:"https://home.cg.gov.in/",            category:"Administration"    },
    { id:10, code:"TRANSPORT",  name:"Transport Department",           website:"https://cgtransport.gov.in",         category:"Infrastructure"    },
    { id:11, code:"LABOUR",     name:"Labour Department",              website:"https://shramevjayate.cg.gov.in/",   category:"Social Services"   },
    { id:12, code:"PWD",        name:"Public Works Department",        website:"https://pwd.cg.nic.in/",             category:"Infrastructure"    },
    { id:13, code:"SOCIAL",     name:"Social Welfare Department",      website:"https://sw.cg.gov.in/",              category:"Social Services"   },
    { id:14, code:"HIGHER_EDU", name:"Higher Education Department",    website:"https://highereducation.cg.gov.in/", category:"Social Services"   },
    { id:15, code:"FINANCE",    name:"Finance Department",             website:"https://finance.cg.gov.in/",         category:"Administration"    }
  ];
}

/** fallbackOfficials — returns a static list of key district officials. */
function fallbackOfficials() {
  return [
    { id:1, name:"Shri Mahadev Kavre",     service:"IAS", designation:"Commissioner, Raipur Division",           division:"Commissioner's Office", email:"dcr.raipur@gmail.com",    phone:"0771-2536660" },
    { id:2, name:"Dr. Gaurav Kumar Singh", service:"IAS", designation:"Collector & District Magistrate, Raipur", division:"Collectorate",           email:"collector-rpr.cg@gov.in", phone:"0771-2426024" },
    { id:3, name:"Shri Lal Umed Singh",    service:"IPS", designation:"Senior Superintendent of Police",         division:"Police Department",      email:"raipurpolice@gmail.com",  phone:"0771-2285004" },
    { id:4, name:"Kumar Biswaranjan",      service:"IAS", designation:"CEO, District Panchayat",                 division:"Zilla Panchayat",        email:"zp-raipur.cg@nic.in",    phone:"0771-2426739" },
    { id:5, name:"Shri Vishwadeep",        service:"IAS", designation:"Commissioner, Municipal Corporation",     division:"Nagar Nigam",            email:"nigam.raipur.cg@nic.in", phone:"0771-2531014" }
  ];
}

/* ═══════════════════════════════════════════════════════════════════════════
   INIT — entry point on every public page
   ═══════════════════════════════════════════════════════════════════════════ */
document.addEventListener('DOMContentLoaded', () => {
  setLiveDate();      // populate the header date display
  setFooterYear();    // keep the footer copyright year current
  initNavToggle();    // wire up the mobile hamburger menu

  // Run the appropriate page-specific initialisation function.
  const page = currentPage();
  if (page === 'home')        initHome();
  if (page === 'departments') initDepartments();
  if (page === 'notices')     initNotices();
  if (page === 'officials')   initOfficials();
  if (page === 'contact')     initContact();
});
