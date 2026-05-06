require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const path = require('path');
const rateLimit = require('express-rate-limit');

const { errorHandler } = require('./middleware/errorHandler');
const authRoutes = require('./routes/auth');
const dashboardRoutes = require('./routes/dashboard');
const institutionRoutes = require('./routes/institutions');
const departmentRoutes = require('./routes/departments');
const programRoutes = require('./routes/programs');
const courseRoutes = require('./routes/courses');
const academicYearRoutes = require('./routes/academicYears');
const semesterRoutes = require('./routes/semesters');
const divisionRoutes = require('./routes/divisions');
const evalCycleRoutes = require('./routes/evaluationCycles');
const assessmentRoutes = require('./routes/assessments');
const rubricRoutes = require('./routes/rubrics');
const studentRoutes = require('./routes/students');
const submissionRoutes = require('./routes/submissions');
const bulkUploadRoutes = require('./routes/bulkUpload');
const reportRoutes = require('./routes/reports');
const accreditationRoutes = require('./routes/accreditation');
const ciRoutes = require('./routes/continuousImprovement');
const auditLogRoutes = require('./routes/auditLogs');
const settingsRoutes = require('./routes/settings');
const userRoutes = require('./routes/users');

const app = express();
const PORT = process.env.PORT || 5000;

app.set('trust proxy', 1);

const allowedOrigins = process.env.CLIENT_URL
  ? process.env.CLIENT_URL.split(',').map(u => u.trim())
  : ['http://localhost:5173', 'http://localhost:3000'];

app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
app.use(cors({
  origin: process.env.NODE_ENV === 'production' ? true : (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
    callback(new Error('Not allowed by CORS'));
  },
  credentials: true,
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));

const limiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 500, standardHeaders: true, legacyHeaders: false });
app.use('/api', limiter);

const uploadDir = path.join(__dirname, '..', process.env.UPLOAD_DIR || 'uploads');
app.use('/uploads', express.static(uploadDir));

app.get('/api/health', (req, res) => res.json({ status: 'ok', timestamp: new Date().toISOString() }));

app.use('/api/auth', authRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/institutions', institutionRoutes);
app.use('/api/departments', departmentRoutes);
app.use('/api/programs', programRoutes);
app.use('/api/courses', courseRoutes);
app.use('/api/academic-years', academicYearRoutes);
app.use('/api/semesters', semesterRoutes);
app.use('/api/divisions', divisionRoutes);
app.use('/api/evaluation-cycles', evalCycleRoutes);
app.use('/api/assessments', assessmentRoutes);
app.use('/api/rubrics', rubricRoutes);
app.use('/api/students', studentRoutes);
app.use('/api/submissions', submissionRoutes);
app.use('/api/bulk-upload', bulkUploadRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/accreditation', accreditationRoutes);
app.use('/api/continuous-improvement', ciRoutes);
app.use('/api/audit-logs', auditLogRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/users', userRoutes);

app.use(errorHandler);

// Serve React frontend in production
if (process.env.NODE_ENV === 'production') {
  const clientBuild = path.join(__dirname, '..', '..', 'client', 'dist');
  app.use(express.static(clientBuild));
  app.get('*', (req, res) => {
    res.sendFile(path.join(clientBuild, 'index.html'));
  });
}

app.listen(PORT, () => {
  console.log(`RubriQ Analytics server running on port ${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV}`);
});

module.exports = app;
