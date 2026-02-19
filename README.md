# Raipur Interdepartmental Portal

Official interdepartmental coordination portal for Raipur Municipal and District Departments.

## Stack
- **Frontend**: HTML5, CSS3, Vanilla JS (Archivist-inspired design)
- **Backend**: Node.js + Express
- **Data**: JSON (mock data, swap with DB as needed)

## Project Structure
```
raipur-interdepartmental/
├── frontend/
│   ├── index.html          # Homepage
│   ├── pages/
│   │   ├── departments.html
│   │   ├── notices.html
│   │   └── contact.html
│   ├── css/
│   │   ├── style.css       # Main styles (Archivist theme)
│   │   └── responsive.css  # Mobile breakpoints
│   └── js/
│       └── main.js         # Frontend logic
├── backend/
│   ├── server.js           # Express server
│   ├── routes/
│   │   ├── departments.js
│   │   ├── notices.js
│   │   └── contact.js
│   ├── data/
│   │   ├── departments.json
│   │   └── notices.json
│   └── package.json
└── .gitignore
```

## Getting Started

```bash
cd backend
npm install
npm start
```

Then open `frontend/index.html` in your browser, or serve it with any static server.

## API Endpoints

| Method | Endpoint              | Description           |
|--------|-----------------------|-----------------------|
| GET    | /api/departments      | List all departments  |
| GET    | /api/departments/:id  | Get one department    |
| GET    | /api/notices          | List all notices      |
| GET    | /api/notices/:id      | Get one notice        |
| POST   | /api/contact          | Submit contact form   |
