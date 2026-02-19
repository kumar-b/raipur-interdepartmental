# Raipur Interdepartmental Portal

Official interdepartmental coordination portal for District Administration, Raipur — Government of Chhattisgarh.

Departments can issue notices to each other, track action statuses, and upload replies. The admin has a central dashboard to monitor all activity across the district.

---

## Stack

| Layer | Technology |
|---|---|
| Frontend | HTML5, CSS3, Vanilla JS (Archivist/typewriter theme) |
| Backend | Node.js + Express |
| Database | SQLite via `better-sqlite3` |
| Auth | JWT (JSON Web Tokens) + bcryptjs |
| File uploads | Multer |
| Tests | Jest + Supertest |

---

## Project Structure

```
raipur-interdepartmental/
├── frontend/
│   ├── index.html                  # Public homepage
│   ├── css/
│   │   ├── style.css               # Main styles (Archivist theme)
│   │   └── responsive.css          # Mobile breakpoints
│   ├── js/
│   │   ├── main.js                 # Shared utilities
│   │   ├── admin.js                # Admin dashboard logic
│   │   ├── dashboard.js            # Department dashboard logic
│   │   └── compose.js              # Notice compose logic
│   └── pages/
│       ├── login.html
│       ├── admin.html              # Admin dashboard
│       ├── dashboard.html          # Department dashboard
│       ├── notice-compose.html     # Compose a notice
│       ├── notices.html            # Public notices board
│       ├── departments.html        # Departments directory
│       ├── officials.html          # Who's Who
│       └── contact.html
├── backend/
│   ├── server.js                   # Entry point
│   ├── app.js                      # Express app + route mounting
│   ├── database/
│   │   ├── db.js                   # SQLite connection + schema
│   │   ├── seed.js                 # Seed script
│   │   └── portal.db               # SQLite database file
│   ├── middleware/
│   │   ├── auth.js                 # requireAuth / requireAdmin
│   │   └── upload.js               # Multer file upload config
│   ├── routes/
│   │   ├── auth.js                 # Login, /me, change-password
│   │   ├── departments.js          # Departments CRUD
│   │   ├── notices.js              # Public notices
│   │   ├── notices-auth.js         # Authenticated notice actions
│   │   ├── users.js                # Admin user management
│   │   └── contact.js              # Contact form
│   ├── data/
│   │   ├── departments.json
│   │   ├── notices.json
│   │   └── officials.json
│   ├── tests/
│   │   ├── auth.test.js
│   │   ├── departments.test.js
│   │   ├── notices.test.js
│   │   ├── users.test.js
│   │   └── testDb.js               # In-memory test database
│   └── package.json
├── .gitignore
└── README.md
```

---

## Getting Started

### Prerequisites
- Node.js v18+
- npm

### Install & Run

```bash
cd backend
npm install
npm start
```

Server runs at **http://localhost:3000**

The frontend is served statically by the Express server — open `http://localhost:3000` in your browser.

### Development (auto-reload)

```bash
npm run dev
```

### Environment Variables

Create a `.env` file inside `backend/`:

```
JWT_SECRET=your-secret-key-at-least-32-characters
PORT=3000
```

---

## Features

### Admin Dashboard
- View all notices across the district with overdue highlighting
- Summary cards — total notices, pending actions, overdue count
- **Manage Users** — create department/admin users, assign departments, reset passwords, activate/deactivate accounts
- **Add new departments** inline when creating a user
- **Monthly Stats** — horizontal bar chart of completed actions per month across the district

### Department Dashboard
- Inbox — receive and action notices (mark as Noted / Completed with remark and optional file reply)
- Outbox — track notices sent by your department and their per-department status
- Compose — create notices targeting specific departments or all departments, with optional file attachment

### Authentication
- JWT-based login with role separation (`admin` / `department`)
- Token stored in `localStorage`; all authenticated routes require `Authorization: Bearer <token>`
- Admin cannot be deactivated from the UI

---

## API Endpoints

### Public

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/departments` | List all departments (optional `?category=`) |
| GET | `/api/departments/:id` | Get a single department |
| GET | `/api/departments/officials/all` | Get Who's Who list |
| GET | `/api/notices` | Public notices list |
| POST | `/api/contact` | Submit contact form |

### Auth

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/auth/login` | Login — returns JWT |
| GET | `/api/auth/me` | Get current user info |
| POST | `/api/auth/change-password` | Change own password |

### Portal (authenticated)

| Method | Endpoint | Access | Description |
|--------|----------|--------|-------------|
| GET | `/api/portal/notices/summary` | Admin | Totals: total, pending, overdue |
| GET | `/api/portal/notices/all` | Admin | All notices with metadata |
| GET | `/api/portal/notices/monthly-stats` | Admin | Completed actions grouped by month |
| GET | `/api/portal/notices/inbox` | Dept | Notices addressed to your department |
| GET | `/api/portal/notices/outbox` | Dept | Notices sent by your department |
| POST | `/api/portal/notices` | Dept | Create a new notice |
| GET | `/api/portal/notices/:id` | Both | Notice detail + status per department |
| PATCH | `/api/portal/notices/:id/status` | Dept | Update status (Noted / Completed) |
| GET | `/api/portal/users` | Admin | List all users |
| POST | `/api/portal/users` | Admin | Create a new user |
| PATCH | `/api/portal/users/:id/status` | Admin | Activate / deactivate a user |
| PATCH | `/api/portal/users/:id/password` | Admin | Reset a user's password |
| POST | `/api/departments` | Admin | Create a new department |

---

## Running Tests

Tests run against a clean in-memory SQLite database — no data is affected.

```bash
cd backend
npm test
```

### Test Coverage

| File | Routes Tested | Tests |
|------|--------------|-------|
| `auth.test.js` | `/api/auth/login`, `/me`, `/change-password` | 13 |
| `departments.test.js` | `/api/departments` | 8 |
| `notices.test.js` | `/api/portal/notices/*` | 25 |
| `users.test.js` | `/api/portal/users/*` | 18 |

---

## Default Credentials (seed data)

| Username | Password | Role |
|----------|----------|------|
| `admin` | *(set in seed)* | Admin |
| `dept_revenue` | *(set in seed)* | Department |
| `dept_health` | *(set in seed)* | Department |

> Passwords are hashed with bcryptjs. Change them after first login.

---

## License

Government of Chhattisgarh — District Administration Raipur.
