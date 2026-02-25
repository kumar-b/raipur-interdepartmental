/**
 * seed.js — development database seed script.
 *
 * Run with:  npm run seed
 *
 * Inserts departments, users, and sample notices.
 * Uses INSERT OR IGNORE so it is safe to run multiple times.
 * Will abort if NODE_ENV=production.
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

if (process.env.NODE_ENV === 'production') {
  console.error('ABORT: seed.js must not be run in production.');
  process.exit(1);
}

const bcrypt = require('bcryptjs');
const db     = require('./db');
const COST   = 12;

// ── 1. Departments ────────────────────────────────────────────────────────────
const depts = require('../data/departments.json');
const insertDept = db.prepare(`
  INSERT OR IGNORE INTO departments (id, code, name, website, description, category)
  VALUES (?, ?, ?, ?, ?, ?)
`);
depts.forEach(d => insertDept.run(d.id, d.code, d.name, d.website, d.description, d.category));
console.log(`Seeded ${depts.length} departments`);

// ── 2. Users ──────────────────────────────────────────────────────────────────
const adminPwd = process.env.SEED_ADMIN_PASSWORD || 'Admin@Portal2024!';
const deptPwd  = process.env.SEED_DEPT_PASSWORD  || null;

const users = [
  { username: 'admin',           role: 'admin',      dept_id: null, pwd: adminPwd                    },
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
users.forEach(u => insertUser.run(u.username, bcrypt.hashSync(u.pwd, COST), u.role, u.dept_id));
console.log(`Seeded ${users.length} users`);

// ── 3. Sample notices ─────────────────────────────────────────────────────────
const get = name => db.prepare('SELECT id FROM users WHERE username = ?').get(name);
const financeUser   = get('dept_finance');
const revenueUser   = get('dept_revenue');
const homeUser      = get('dept_home');
const healthUser    = get('dept_health');
const eduUser       = get('dept_edu');
const socialUser    = get('dept_social');
const transportUser = get('dept_transport');
const pwdUser       = get('dept_pwd');

const insertNotice = db.prepare(`
  INSERT OR IGNORE INTO notices (title, body, priority, deadline, created_by, target_all, created_at)
  VALUES (?, ?, ?, ?, ?, ?, ?)
`);
const insertStatus = db.prepare(
  'INSERT OR IGNORE INTO notice_status (notice_id, user_id) VALUES (?, ?)'
);

// Notice 1: Finance → all users (broadcast)
const n1 = insertNotice.run(
  'Annual Budget Utilisation Report — FY 2025-26',
  'All departments are directed to submit their budget utilisation reports for FY 2025-26 to the Finance Department at the earliest.',
  'High', '2026-02-10', financeUser.id, 1, '2026-02-01 09:00:00'
);
users
  .filter(u => u.role !== 'admin' && u.username !== 'dept_finance')
  .map(u => get(u.username))
  .filter(Boolean)
  .forEach(u => insertStatus.run(n1.lastInsertRowid, u.id));

// Notice 2: Revenue → Health, Education, Social
const n2 = insertNotice.run(
  'Inter-Departmental Coordination Meeting — March 2026',
  'A coordination meeting for reviewing joint schemes is scheduled for 5 March 2026 at 10:30 AM, Conference Room 2, Collectorate.',
  'Normal', '2026-03-05', revenueUser.id, 0, '2026-02-12 11:00:00'
);
[healthUser, eduUser, socialUser].forEach(u => insertStatus.run(n2.lastInsertRowid, u.id));

// Notice 3: Home → Transport, PWD
const n3 = insertNotice.run(
  'Road Safety Inspection — State Highway 10',
  'Transport and PWD departments are requested to conduct a joint inspection of SH-10 by 10 March 2026.',
  'High', '2026-03-10', homeUser.id, 0, '2026-02-14 14:30:00'
);
[transportUser, pwdUser].forEach(u => insertStatus.run(n3.lastInsertRowid, u.id));

console.log('Seed complete.');
