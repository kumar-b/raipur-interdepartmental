/**
 * seed.js — one-time database population script.
 *
 * Run manually with:  node backend/database/seed.js
 *
 * What it does:
 *   1. Inserts all government departments from data/departments.json.
 *   2. Creates one admin account and one portal account per department.
 *   3. Seeds three realistic sample notices with status rows.
 *
 * Uses INSERT OR IGNORE so the script is safe to run multiple times —
 * existing rows are skipped rather than overwritten.
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const bcrypt = require('bcryptjs');
const db = require('./db');

// bcrypt cost factor — 12 rounds gives a good security/speed balance in production.
if (process.env.NODE_ENV === 'production') {
  console.error('ABORT: seed.js must NOT be run in production.');
  console.error('Create accounts manually via the admin panel or a secure bootstrap script.');
  process.exit(1);
}

const COST = 12;

// ── 1. Seed departments ──────────────────────────────────────────────────────
const depts = require('../data/departments.json');
const insertDept = db.prepare(`
  INSERT OR IGNORE INTO departments (id, code, name, website, description, category)
  VALUES (?, ?, ?, ?, ?, ?)
`);
depts.forEach(d => insertDept.run(d.id, d.code, d.name, d.website, d.description, d.category));
console.log(`Seeded ${depts.length} departments`);

// ── 2. Seed users ────────────────────────────────────
const adminPwd = process.env.SEED_ADMIN_PASSWORD || 'Admin@Portal2024!';
const deptPwd  = process.env.SEED_DEPT_PASSWORD  || null;

const users = [
  { username: 'admin',           role: 'admin',      dept_id: null, pwd: adminPwd },
  { username: 'dept_revenue',    role: 'department', dept_id: 1,    pwd: deptPwd || 'REVENUE@2024'   },
  { username: 'dept_prd',        role: 'department', dept_id: 2,    pwd: deptPwd || 'PRD@2024'       },
  { username: 'dept_health',     role: 'department', dept_id: 3,    pwd: deptPwd || 'HEALTH@2024'    },
  { username: 'dept_agri',       role: 'department', dept_id: 4,    pwd: deptPwd || 'AGRI@2024'      },
  { username: 'dept_food',       role: 'department', dept_id: 5,    pwd: deptPwd || 'FOOD@2024'      },
  { username: 'dept_edu',        role: 'department', dept_id: 6,    pwd: deptPwd || 'EDU@2024'       },
  { username: 'dept_commerce',   role: 'department', dept_id: 7,    pwd: deptPwd || 'COMMERCE@2024'  },
  { username: 'dept_mining',     role: 'department', dept_id: 8,    pwd: deptPwd || 'MINING@2024'    },
  { username: 'dept_home',       role: 'department', dept_id: 9,    pwd: deptPwd || 'HOME@2024'      },
  { username: 'dept_transport',  role: 'department', dept_id: 10,   pwd: deptPwd || 'TRANSPORT@2024' },
  { username: 'dept_labour',     role: 'department', dept_id: 11,   pwd: deptPwd || 'LABOUR@2024'    },
  { username: 'dept_pwd',        role: 'department', dept_id: 12,   pwd: deptPwd || 'PWD@2024'       },
  { username: 'dept_social',     role: 'department', dept_id: 13,   pwd: deptPwd || 'SOCIAL@2024'    },
  { username: 'dept_higher_edu', role: 'department', dept_id: 14,   pwd: deptPwd || 'HIGHER_EDU@2024'},
  { username: 'dept_finance',    role: 'department', dept_id: 15,   pwd: deptPwd || 'FINANCE@2024'   },
];
const insertUser = db.prepare(`
  INSERT OR IGNORE INTO users (username, password_hash, role, dept_id)
  VALUES (?, ?, ?, ?)
`);
users.forEach(u => {
  const hash = bcrypt.hashSync(u.pwd, COST);
  insertUser.run(u.username, hash, u.role, u.dept_id);
});
console.log(`Seeded ${users.length} users`);

<<<<<<< HEAD
// ── 3. Seed sample notices ───────────────────────────────────────────────────
// Look up the user IDs created above so we can reference them in the notices.
=======
// ── 3. Seed sample notices ───────────────────────────
>>>>>>> ed5f584 (feat: deployment review and deployment level changes)
const adminUser    = db.prepare('SELECT id FROM users WHERE username = ?').get('admin');
const financeUser  = db.prepare('SELECT id FROM users WHERE username = ?').get('dept_finance');
const homeUser     = db.prepare('SELECT id FROM users WHERE username = ?').get('dept_home');
const revenueUser  = db.prepare('SELECT id FROM users WHERE username = ?').get('dept_revenue');

const insertNotice = db.prepare(`
  INSERT OR IGNORE INTO notices (title, body, priority, deadline, source_dept_id, target_all, created_by, created_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`);
// Insert an explicit target department row (used when target_all = 0).
const insertTarget = db.prepare(`
  INSERT OR IGNORE INTO notice_targets (notice_id, dept_id) VALUES (?, ?)
`);
// Create the initial Pending status row for a (notice, dept) pair.
const insertStatus = db.prepare(`
  INSERT OR IGNORE INTO notice_status (notice_id, dept_id, status) VALUES (?, ?, 'Pending')
`);

<<<<<<< HEAD
// Notice 1: Finance → ALL departments (overdue — past deadline)
// target_all = 1, so we skip notice_targets and write a status row for every dept.
const n1 = insertNotice.run(
  'Annual Budget Utilisation Report — FY 2025-26',
  'All departments are directed to submit their budget utilisation reports for FY 2025-26 to the Finance Department at the earliest. Non-submission will be noted in the performance review.',
  'High',
  '2026-02-10',   // past deadline — will appear as overdue in the dashboard
  15,             // source_dept_id: Finance Department
  1,              // target_all = 1 (broadcast)
  financeUser.id,
  '2026-02-01 09:00:00'
);
// Create a Pending status row for every department except the sender (Finance, id=15).
=======
const n1 = insertNotice.run(
  'Annual Budget Utilisation Report — FY 2025-26',
  'All departments are directed to submit their budget utilisation reports for FY 2025-26 to the Finance Department at the earliest. Non-submission will be noted in the performance review.',
  'High', '2026-02-10', 15, 1, financeUser.id, '2026-02-01 09:00:00'
);
>>>>>>> ed5f584 (feat: deployment review and deployment level changes)
depts.filter(d => d.id !== 15).forEach(d => {
  insertStatus.run(n1.lastInsertRowid, d.id);
});

<<<<<<< HEAD
// Notice 2: Revenue → Health, Education, Social Welfare (specific targets)
const n2 = insertNotice.run(
  'Inter-Departmental Coordination Meeting — March 2026',
  'A coordination meeting for reviewing joint schemes (National Health Mission, Mid-Day Meal, Social Welfare convergence) is scheduled for 5 March 2026 at 10:30 AM, Conference Room 2, Collectorate. Please confirm attendance by 28 February 2026.',
  'Normal',
  '2026-03-05',
  1,             // source_dept_id: Revenue Department
  0,             // target_all = 0 (specific targets only)
  revenueUser.id,
  '2026-02-12 11:00:00'
=======
const n2 = insertNotice.run(
  'Inter-Departmental Coordination Meeting — March 2026',
  'A coordination meeting for reviewing joint schemes (National Health Mission, Mid-Day Meal, Social Welfare convergence) is scheduled for 5 March 2026 at 10:30 AM, Conference Room 2, Collectorate. Please confirm attendance by 28 February 2026.',
  'Normal', '2026-03-05', 1, 0, revenueUser.id, '2026-02-12 11:00:00'
>>>>>>> ed5f584 (feat: deployment review and deployment level changes)
);
// Health (3), Education (6), Social Welfare (13)
[3, 6, 13].forEach(deptId => {
  insertTarget.run(n2.lastInsertRowid, deptId);
  insertStatus.run(n2.lastInsertRowid, deptId);
});

<<<<<<< HEAD
// Notice 3: Home → Transport, PWD (road safety inspection)
const n3 = insertNotice.run(
  'Road Safety Inspection — State Highway 10',
  'The Home Department has received complaints regarding unsafe road conditions on SH-10 near Tatibandh flyover. Transport and PWD departments are requested to conduct a joint inspection by 10 March 2026 and submit a report with remediation timeline.',
  'High',
  '2026-03-10',
  9,             // source_dept_id: Home Department
  0,
  homeUser.id,
  '2026-02-14 14:30:00'
=======
const n3 = insertNotice.run(
  'Road Safety Inspection — State Highway 10',
  'The Home Department has received complaints regarding unsafe road conditions on SH-10 near Tatibandh flyover. Transport and PWD departments are requested to conduct a joint inspection by 10 March 2026 and submit a report with remediation timeline.',
  'High', '2026-03-10', 9, 0, homeUser.id, '2026-02-14 14:30:00'
>>>>>>> ed5f584 (feat: deployment review and deployment level changes)
);
// Transport (10), PWD (12)
[10, 12].forEach(deptId => {
  insertTarget.run(n3.lastInsertRowid, deptId);
  insertStatus.run(n3.lastInsertRowid, deptId);
});

console.log('Seed complete (development mode).');
console.log('IMPORTANT: Change all passwords before any non-local use.');
