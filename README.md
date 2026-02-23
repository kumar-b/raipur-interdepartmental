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
| File uploads | Multer + AWS S3 (optional) / Local disk (fallback) |
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
│   │   ├── main.js                 # Shared utilities + public page init
│   │   ├── login.js                # Login page — session redirect + form submit
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
│   ├── storage.js                  # File storage (S3 or local disk)
│   ├── middleware/
│   │   ├── auth.js                 # requireAuth / requireAdmin
│   │   └── upload.js               # Multer memoryStorage config
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
│   │   ├── storage.test.js         # Local disk + S3 mode tests
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

Copy `backend/.env.example` to `backend/.env` and fill in the values:

```bash
cp backend/.env.example backend/.env
```

| Variable | Required | Description |
|---|---|---|
| `JWT_SECRET` | Yes | Secret for signing JWTs — min 32 characters |
| `PORT` | No | Server port (default: `3000`) |
| `AWS_ACCESS_KEY_ID` | S3 only | IAM access key with `s3:PutObject` permission |
| `AWS_SECRET_ACCESS_KEY` | S3 only | IAM secret key |
| `AWS_S3_BUCKET` | S3 only | S3 bucket name (must already exist) |
| `AWS_REGION` | S3 only | Bucket region (default: `us-east-1`) |

---

## File Storage

File uploads (notice attachments and department reply files) support two storage backends, selected automatically based on environment variables:

### AWS S3 (recommended for production)
Set all three AWS variables in `.env`:
```
AWS_ACCESS_KEY_ID=your_key
AWS_SECRET_ACCESS_KEY=your_secret
AWS_S3_BUCKET=your_bucket
AWS_REGION=ap-south-1
```
Files are uploaded to `s3://<bucket>/uploads/` and stored as public S3 URLs in the database. The local `/uploads` folder is not used.

### Local Disk (default fallback)
If any AWS variable is missing, files are saved to `backend/uploads/` and served via Express static at `/uploads/<filename>`. Suitable for development and single-server deployments.

| | Local Disk | AWS S3 |
|---|---|---|
| Config needed | None | 3 env vars |
| Survives redeploy | Only if folder is persisted | Yes |
| Scales | Single server only | Yes |
| Cost | Free | Pay per GB |

---

## Features

### Admin Dashboard
- View all notices across the district with overdue highlighting
- Summary cards — total notices, pending actions, overdue count
- **Manage Users** — create department/admin users, assign departments, reset passwords, activate/deactivate accounts
- **Add new departments** inline when creating a user
- **Monthly Stats** — horizontal bar chart of completed actions per month across the district; counts are preserved even after notices are closed
- **Close Notice** — a "Close Notice" button is visible on every notice detail modal. Admin can force-close any notice regardless of whether target departments have completed it. On close: all uploaded files (attachment + reply files) are permanently deleted from disk or S3, and the database record is removed. Completion statistics are archived so the monthly chart remains accurate after closure.

### Department Dashboard
- Inbox — receive and action notices (mark as Noted / Completed with remark and optional file reply)
- Outbox — track notices sent by your department and their per-department status
- Compose — create notices targeting specific departments or all departments, with optional file attachment
- **Close Notice (Outbox)** — once every target department has marked a notice "Completed", a "Close Notice" button appears on the outbox detail view. Only the department that created the notice (or admin) can close it. Closing permanently deletes all uploaded files and removes the record; statistics are preserved.

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
| DELETE | `/api/portal/notices/:id` | Admin / Dept (own) | Close a notice — dept: only when all targets completed; admin: any notice regardless of status. Deletes all uploaded files; archives completion stats. |
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

| File | What is tested | Tests |
|------|---------------|-------|
| `auth.test.js` | `/api/auth/login`, `/me`, `/change-password` | 13 |
| `departments.test.js` | `GET /api/departments`, `GET /api/departments/:id`, `GET /api/departments/officials/all`, `POST /api/departments` | 18 |
| `notices.test.js` | `/api/portal/notices/*` — create, inbox, outbox, detail, status-update, close notice, monthly-stats | 50 |
| `users.test.js` | `/api/portal/users/*` — list, create, toggle status, reset password | 27 |
| `storage.test.js` | `saveFile` + `deleteFile` — local disk mode and S3 mode (mocked SDK) | 23 |
| **Total** | | **131** |

---

## Default Credentials (seed data)

| Username | Password | Role |
|----------|----------|------|
| `admin` | *(set in seed)* | Admin |
| `dept_revenue` | *(set in seed)* | Department |
| `dept_health` | *(set in seed)* | Department |

> Passwords are hashed with bcryptjs. Change them after first login.

---

## Changelog

### Bug fixes & hardening (code review)

**Production / CSP fixes**
- Fixed hardcoded `http://localhost:3000/api` API base URL — changed to root-relative `/api` so all API calls work on the production HTTPS host without triggering mixed-content browser blocks
- Replaced all `onclick="..."` inline event handlers (blocked by `script-src-attr 'none'` CSP) with `addEventListener` in `admin.js` and `dashboard.js`
- Removed all inline `<script>` blocks from HTML files (blocked by `script-src-elem` CSP); nav-link updater logic moved to `main.js`, login page logic extracted to a new `login.js` file

**Backend**
- Added global JSON error handler middleware to `app.js` — Express previously returned an HTML 500 page on unhandled errors, which the frontend couldn't parse
- Added `try/catch` to the `monthly-stats` route so errors surface as JSON instead of crashing the request
- Added `isNaN()` guards to all parameterised routes in `notices-auth.js` (`GET/PATCH/DELETE /notices/:id`) and `users.js` (`PATCH /users/:id/status` and `PATCH /users/:id/password`) — a non-numeric ID previously either silently did nothing or returned a misleading 403
- Fixed `storage.test.js` — a mid-describe `jest.resetModules()` call was corrupting the module mock cache and causing 4 S3 `deleteFile` tests to fail; fixed by re-registering the mock and re-requiring `storage` after the offending test

**Frontend**
- Removed stale `window.closeModal` global export from `admin.js` (left over after inline onclick removal)
- Removed dead `if (!res.ok)` check in `dashboard.js submitAction` — `fetchAuth` already throws on non-2xx responses so the check was unreachable
- Fixed XSS in `main.js deptCardHTML` — department `name`, `code`, and `category` values (from the database) are now HTML-escaped before insertion into `innerHTML`; `website` URLs are validated to only allow `http://` or `https://` schemes, preventing `javascript:` URL injection

---

## License

Government of Chhattisgarh — District Administration Raipur.
