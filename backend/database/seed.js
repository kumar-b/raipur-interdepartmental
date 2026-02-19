require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const bcrypt = require('bcryptjs');
const db = require('./db');

const COST = 12;

// ── 1. Seed departments ──────────────────────────────
const depts = require('../data/departments.json');
const insertDept = db.prepare(`
  INSERT OR IGNORE INTO departments (id, code, name, website, description, category)
  VALUES (?, ?, ?, ?, ?, ?)
`);
depts.forEach(d => insertDept.run(d.id, d.code, d.name, d.website, d.description, d.category));
console.log(`✓ Seeded ${depts.length} departments`);

// ── 2. Seed users ────────────────────────────────────
const users = [
  { username: 'admin',           role: 'admin',      dept_id: null, pwd: 'Admin@Portal2024!' },
  { username: 'dept_revenue',    role: 'department', dept_id: 1,    pwd: 'REVENUE@2024'      },
  { username: 'dept_prd',        role: 'department', dept_id: 2,    pwd: 'PRD@2024'          },
  { username: 'dept_health',     role: 'department', dept_id: 3,    pwd: 'HEALTH@2024'       },
  { username: 'dept_agri',       role: 'department', dept_id: 4,    pwd: 'AGRI@2024'         },
  { username: 'dept_food',       role: 'department', dept_id: 5,    pwd: 'FOOD@2024'         },
  { username: 'dept_edu',        role: 'department', dept_id: 6,    pwd: 'EDU@2024'          },
  { username: 'dept_commerce',   role: 'department', dept_id: 7,    pwd: 'COMMERCE@2024'     },
  { username: 'dept_mining',     role: 'department', dept_id: 8,    pwd: 'MINING@2024'       },
  { username: 'dept_home',       role: 'department', dept_id: 9,    pwd: 'HOME@2024'         },
  { username: 'dept_transport',  role: 'department', dept_id: 10,   pwd: 'TRANSPORT@2024'    },
  { username: 'dept_labour',     role: 'department', dept_id: 11,   pwd: 'LABOUR@2024'       },
  { username: 'dept_pwd',        role: 'department', dept_id: 12,   pwd: 'PWD@2024'          },
  { username: 'dept_social',     role: 'department', dept_id: 13,   pwd: 'SOCIAL@2024'       },
  { username: 'dept_higher_edu', role: 'department', dept_id: 14,   pwd: 'HIGHER_EDU@2024'   },
  { username: 'dept_finance',    role: 'department', dept_id: 15,   pwd: 'FINANCE@2024'      },
];
const insertUser = db.prepare(`
  INSERT OR IGNORE INTO users (username, password_hash, role, dept_id)
  VALUES (?, ?, ?, ?)
`);
users.forEach(u => {
  const hash = bcrypt.hashSync(u.pwd, COST);
  insertUser.run(u.username, hash, u.role, u.dept_id);
});
console.log(`✓ Seeded ${users.length} users`);

// ── 3. Seed sample notices ───────────────────────────
// Get user IDs
const adminUser    = db.prepare('SELECT id FROM users WHERE username = ?').get('admin');
const financeUser  = db.prepare('SELECT id FROM users WHERE username = ?').get('dept_finance');
const homeUser     = db.prepare('SELECT id FROM users WHERE username = ?').get('dept_home');
const revenueUser  = db.prepare('SELECT id FROM users WHERE username = ?').get('dept_revenue');

const insertNotice = db.prepare(`
  INSERT OR IGNORE INTO notices (title, body, priority, deadline, source_dept_id, target_all, created_by, created_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`);
const insertTarget = db.prepare(`
  INSERT OR IGNORE INTO notice_targets (notice_id, dept_id) VALUES (?, ?)
`);
const insertStatus = db.prepare(`
  INSERT OR IGNORE INTO notice_status (notice_id, dept_id, status) VALUES (?, ?, 'Pending')
`);

// Notice 1: Finance → ALL departments (overdue — past deadline)
const n1 = insertNotice.run(
  'Annual Budget Utilisation Report — FY 2025-26',
  'All departments are directed to submit their budget utilisation reports for FY 2025-26 to the Finance Department at the earliest. Non-submission will be noted in the performance review.',
  'High',
  '2026-02-10',   // past deadline — will appear as overdue
  15,             // source: Finance
  1,              // target_all
  financeUser.id,
  '2026-02-01 09:00:00'
);
// For target_all notices, create notice_status for every department
depts.filter(d => d.id !== 15).forEach(d => {
  insertStatus.run(n1.lastInsertRowid, d.id);
});
console.log('✓ Notice 1 seeded (Finance → ALL, overdue)');

// Notice 2: Revenue → Health, Education, Social Welfare
const n2 = insertNotice.run(
  'Inter-Departmental Coordination Meeting — March 2026',
  'A coordination meeting for reviewing joint schemes (National Health Mission, Mid-Day Meal, Social Welfare convergence) is scheduled for 5 March 2026 at 10:30 AM, Conference Room 2, Collectorate. Please confirm attendance by 28 February 2026.',
  'Normal',
  '2026-03-05',
  1,             // source: Revenue
  0,             // specific targets
  revenueUser.id,
  '2026-02-12 11:00:00'
);
[3, 6, 13].forEach(deptId => {
  insertTarget.run(n2.lastInsertRowid, deptId);
  insertStatus.run(n2.lastInsertRowid, deptId);
});
console.log('✓ Notice 2 seeded (Revenue → Health, Education, Social)');

// Notice 3: Home → Transport, PWD
const n3 = insertNotice.run(
  'Road Safety Inspection — State Highway 10',
  'The Home Department has received complaints regarding unsafe road conditions on SH-10 near Tatibandh flyover. Transport and PWD departments are requested to conduct a joint inspection by 10 March 2026 and submit a report with remediation timeline.',
  'High',
  '2026-03-10',
  9,             // source: Home
  0,
  homeUser.id,
  '2026-02-14 14:30:00'
);
[10, 12].forEach(deptId => {
  insertTarget.run(n3.lastInsertRowid, deptId);
  insertStatus.run(n3.lastInsertRowid, deptId);
});
console.log('✓ Notice 3 seeded (Home → Transport, PWD)');

console.log('\n✅ Seed complete. Login credentials:');
console.log('   Admin:        admin / Admin@Portal2024!');
console.log('   Dept users:   dept_<code> / <CODE>@2024');
console.log('   Example:      dept_revenue / REVENUE@2024');
