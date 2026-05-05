# RubriQ Analytics — Phase 1

**Rubric-Based Academic Assessment, Evidence Preservation & Accreditation Analytics Platform**

> Phase 1 implements the complete Administrator module. Faculty, Student, HoD, and Reviewer modules are scaffolded and ready for future phases.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 18 + Vite + Tailwind CSS |
| Backend | Node.js + Express |
| Database | MySQL + Prisma ORM |
| Auth | JWT + bcrypt |
| File Upload | Multer |
| Excel | ExcelJS |
| Charts | Recharts |
| Deployment | Hostinger Node.js + MySQL |

---

## Default Demo Credentials

```
Email:    admin@rubriq.edu
Password: Admin@2026
```

---

## Local Development Setup

### Prerequisites

- Node.js 18+
- MySQL 8.0+
- npm or yarn

### 1. Clone and navigate

```bash
cd rubriq-analytics
```

### 2. Backend Setup

```bash
cd server
cp .env.example .env
# Edit .env with your MySQL credentials
npm install
```

#### Configure `.env`

```env
DATABASE_URL="mysql://root:password@localhost:3306/rubriq_analytics"
JWT_SECRET="your-secure-secret-key"
PORT=5000
CLIENT_URL=http://localhost:5173
ADMIN_EMAIL=admin@rubriq.edu
ADMIN_PASSWORD=Admin@2026
```

#### Database setup

```bash
# Create the database first in MySQL:
# CREATE DATABASE rubriq_analytics;

npx prisma generate
npx prisma migrate dev --name init
node prisma/seed.js
```

#### Start backend

```bash
npm run dev
```

### 3. Frontend Setup

```bash
cd ../client
npm install
npm run dev
```

Open `http://localhost:5173`

---

## Production Deployment (Hostinger)

### 1. Upload files

Upload the `rubriq-analytics/` folder to your Hostinger server via FTP or SSH.

### 2. Backend on Hostinger Node.js

```bash
cd server
cp .env.example .env
# Edit .env with production MySQL credentials
npm install --production

npx prisma generate
npx prisma migrate deploy
node prisma/seed.js

npm start
```

Configure your Hostinger Node.js app to use `src/index.js` as the entry point on port 5000 (or your configured port).

### 3. Frontend build

```bash
cd client
# Create .env.production
echo "VITE_API_URL=https://yourdomain.com/api" > .env.production

npm install
npm run build
```

Upload the `client/dist/` folder to your Hostinger public_html or configure a reverse proxy to serve it.

### 4. Nginx / Apache reverse proxy (if applicable)

Configure your web server to:
- Serve `client/dist/` for frontend requests
- Proxy `/api/*` to `http://localhost:5000/api/*`

---

## Project Structure

```
rubriq-analytics/
├── server/                     # Node.js + Express API
│   ├── prisma/
│   │   ├── schema.prisma       # Full database schema
│   │   └── seed.js             # Demo data seeder
│   ├── src/
│   │   ├── index.js            # App entry point
│   │   ├── middleware/         # Auth, upload, error handlers
│   │   ├── routes/             # All API route files
│   │   └── utils/              # Audit logging etc.
│   ├── uploads/                # Private file storage (git-ignored)
│   └── .env.example
├── client/                     # React + Vite frontend
│   ├── src/
│   │   ├── components/
│   │   │   ├── layout/         # Sidebar, Topbar, Layout
│   │   │   └── shared/         # KPICard, DataTable, Modal, etc.
│   │   ├── pages/              # All 20+ admin pages
│   │   ├── context/            # Auth, Filter context
│   │   └── services/api.js     # All API calls
│   └── vite.config.js
└── README.md
```

---

## Admin Modules (Phase 1)

| # | Module | Status |
|---|---|---|
| 1 | Admin Login | ✅ Full |
| 2 | Admin Dashboard | ✅ Full with charts |
| 3 | Academic Setup (Institutions, Departments) | ✅ Full CRUD |
| 4 | Programs & Courses | ✅ Full CRUD |
| 5 | Evaluation Plan (Years, Semesters, Divisions, Cycles) | ✅ Full CRUD |
| 6 | Assessment Management | ✅ Full CRUD |
| 7 | Rubric Matrix Builder | ✅ Full with criteria & levels |
| 8 | Student Management + Excel Import | ✅ Full |
| 9 | Student Submissions Repository | ✅ Full |
| 10 | Teacher Evaluation (Admin View) | ✅ Full |
| 11 | Bulk Marks Upload with Column Mapping | ✅ Full wizard |
| 12 | Mapping & Validation | ✅ Full |
| 13 | Class Analysis Dashboard | ✅ Full with charts |
| 14 | Reports (Evaluation + Compliance) | ✅ Full |
| 15 | Student Progress Dashboard | ✅ Full |
| 16 | Evidence Repository | ✅ Full |
| 17 | Accreditation Evidence Pack | ✅ Full with checklist |
| 18 | Continuous Improvement (CQI) | ✅ Full |
| 19 | Audit Logs | ✅ Full |
| 20 | Settings | ✅ Full |
| 21 | User Management | ✅ Full (Admin only) |

---

## API Endpoints Summary

| Resource | Base Path |
|---|---|
| Auth | `/api/auth` |
| Dashboard | `/api/dashboard` |
| Institutions | `/api/institutions` |
| Departments | `/api/departments` |
| Programs | `/api/programs` |
| Courses | `/api/courses` |
| Academic Years | `/api/academic-years` |
| Semesters | `/api/semesters` |
| Divisions | `/api/divisions` |
| Evaluation Cycles | `/api/evaluation-cycles` |
| Assessments | `/api/assessments` |
| Rubrics | `/api/rubrics` |
| Students | `/api/students` |
| Submissions | `/api/submissions` |
| Bulk Upload | `/api/bulk-upload` |
| Reports | `/api/reports` |
| Accreditation | `/api/accreditation` |
| Continuous Improvement | `/api/continuous-improvement` |
| Audit Logs | `/api/audit-logs` |
| Settings | `/api/settings` |
| Users | `/api/users` |

---

## File Upload Security

**Allowed:** PDF, DOC, DOCX, XLS, XLSX, CSV, PPT, PPTX, TXT, JPG, JPEG, PNG, WEBP, ZIP

**Blocked:** EXE, BAT, CMD, SH, PHP, JS, HTML, MSI, and all script/executable types

Files are stored in the private `uploads/` folder (not served publicly by default). Only metadata and file paths are stored in MySQL.

---

## Future Phases

- **Phase 2:** Faculty portal — evaluation interface, rubric scoring, feedback
- **Phase 3:** Student portal — submission, progress view, feedback
- **Phase 4:** HoD Dashboard — department-wide analytics
- **Phase 5:** External Reviewer module — accreditation review workflow

All database tables and navigation placeholders for these modules are already in place.
