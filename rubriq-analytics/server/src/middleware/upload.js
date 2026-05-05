const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');

const ALLOWED_EXTENSIONS = new Set([
  'pdf', 'doc', 'docx', 'xls', 'xlsx', 'csv',
  'ppt', 'pptx', 'txt', 'jpg', 'jpeg', 'png', 'webp', 'zip',
]);

const BLOCKED_EXTENSIONS = new Set([
  'exe', 'bat', 'cmd', 'sh', 'php', 'js', 'html', 'htm',
  'msi', 'vbs', 'ps1', 'py', 'rb', 'pl', 'jar',
]);

const uploadDir = path.join(__dirname, '..', '..', process.env.UPLOAD_DIR || 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const subDir = req.uploadSubDir || 'misc';
    const dest = path.join(uploadDir, subDir);
    if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });
    cb(null, dest);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase().replace('.', '');
    const storedName = `${uuidv4()}.${ext}`;
    cb(null, storedName);
  },
});

const fileFilter = (req, file, cb) => {
  const ext = path.extname(file.originalname).toLowerCase().replace('.', '');
  if (BLOCKED_EXTENSIONS.has(ext)) {
    return cb(new Error(`File type .${ext} is not allowed for security reasons`), false);
  }
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    return cb(new Error(`File type .${ext} is not supported`), false);
  }
  cb(null, true);
};

const maxSizeMB = parseInt(process.env.MAX_FILE_SIZE_MB || '25', 10);

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: maxSizeMB * 1024 * 1024 },
});

const excelFilter = (req, file, cb) => {
  const ext = path.extname(file.originalname).toLowerCase();
  if (!['.xlsx', '.xls', '.csv'].includes(ext)) {
    return cb(new Error('Only Excel and CSV files are allowed for bulk upload'), false);
  }
  cb(null, true);
};

const excelUpload = multer({
  storage,
  fileFilter: excelFilter,
  limits: { fileSize: 10 * 1024 * 1024 },
});

module.exports = { upload, excelUpload, uploadDir };
