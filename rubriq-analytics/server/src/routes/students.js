const prisma = require('../db');
const router = require('express').Router();
const { authenticate, requireAdmin } = require('../middleware/auth');
const { logAudit } = require('../utils/audit');
const { excelUpload } = require('../middleware/upload');
const ExcelJS = require('exceljs');

router.get('/', authenticate, async (req, res, next) => {
  try {
    const { programId, divisionId, search } = req.query;
    const where = { isActive: true };
    if (programId) where.programId = parseInt(programId);
    if (divisionId) where.divisionId = parseInt(divisionId);
    if (search) {
      where.OR = [
        { firstName: { contains: search } },
        { lastName: { contains: search } },
        { rollNumber: { contains: search } },
        { email: { contains: search } },
      ];
    }
    const students = await prisma.student.findMany({
      where,
      include: {
        program: { select: { name: true, code: true } },
        division: { select: { name: true } },
        _count: { select: { submissions: true, evaluations: true } },
      },
      orderBy: { rollNumber: 'asc' },
    });
    res.json(students);
  } catch (err) { next(err); }
});

router.get('/:id', authenticate, async (req, res, next) => {
  try {
    const student = await prisma.student.findUnique({
      where: { id: parseInt(req.params.id) },
      include: {
        program: true,
        division: true,
        submissions: {
          include: {
            assessment: { select: { title: true, type: true, evaluationCycle: { select: { label: true } } } },
            evaluation: { select: { totalMarks: true, grade: true, status: true } },
            files: { select: { originalName: true, fileSize: true, uploadedAt: true } },
          },
        },
      },
    });
    if (!student) return res.status(404).json({ error: 'Student not found' });
    res.json(student);
  } catch (err) { next(err); }
});

router.post('/', authenticate, requireAdmin, async (req, res, next) => {
  try {
    const { programId, divisionId, rollNumber, firstName, lastName, email, phone, batch } = req.body;
    if (!programId || !rollNumber || !firstName || !lastName) return res.status(400).json({ error: 'programId, rollNumber, firstName and lastName are required' });
    const student = await prisma.student.create({ data: { programId: parseInt(programId), divisionId: divisionId ? parseInt(divisionId) : null, rollNumber, firstName, lastName, email, phone, batch } });
    await logAudit({ userId: req.user.id, action: 'CREATE', entity: 'Student', entityId: student.id, req });
    res.status(201).json(student);
  } catch (err) { next(err); }
});

router.put('/:id', authenticate, requireAdmin, async (req, res, next) => {
  try {
    const { firstName, lastName, email, phone, batch, divisionId, isActive } = req.body;
    const student = await prisma.student.update({ where: { id: parseInt(req.params.id) }, data: { firstName, lastName, email, phone, batch, divisionId: divisionId ? parseInt(divisionId) : undefined, isActive } });
    res.json(student);
  } catch (err) { next(err); }
});

router.delete('/:id', authenticate, requireAdmin, async (req, res, next) => {
  try {
    await prisma.student.update({ where: { id: parseInt(req.params.id) }, data: { isActive: false } });
    res.json({ message: 'Student deactivated' });
  } catch (err) { next(err); }
});

// Excel import
router.post('/import/excel', authenticate, requireAdmin, (req, res, next) => {
  req.uploadSubDir = 'imports';
  next();
}, excelUpload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const { programId, divisionId } = req.body;
    if (!programId) return res.status(400).json({ error: 'programId is required' });

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(req.file.path);
    const worksheet = workbook.worksheets[0];

    const headers = [];
    worksheet.getRow(1).eachCell((cell) => headers.push(cell.value?.toString().trim().toLowerCase()));

    const required = ['rollnumber', 'firstname', 'lastname'];
    const missing = required.filter(h => !headers.some(header => header?.includes(h.toLowerCase())));
    if (missing.length > 0) {
      return res.status(400).json({ error: `Missing required columns: ${missing.join(', ')}` });
    }

    const getIdx = (keywords) => headers.findIndex(h => h && keywords.some(k => h.includes(k)));
    const rollIdx = getIdx(['roll', 'rollno', 'rollnumber', 'roll_number']);
    const firstIdx = getIdx(['first', 'firstname', 'first_name']);
    const lastIdx = getIdx(['last', 'lastname', 'last_name']);
    const emailIdx = getIdx(['email', 'mail']);
    const phoneIdx = getIdx(['phone', 'mobile', 'contact']);
    const batchIdx = getIdx(['batch', 'year', 'cohort']);

    const results = { imported: 0, skipped: 0, errors: [] };
    const rows = [];
    worksheet.eachRow((row, rowNum) => {
      if (rowNum === 1) return;
      const rollNumber = row.getCell(rollIdx + 1).value?.toString().trim();
      const firstName = row.getCell(firstIdx + 1).value?.toString().trim();
      const lastName = row.getCell(lastIdx + 1).value?.toString().trim();
      if (!rollNumber || !firstName || !lastName) {
        results.errors.push({ row: rowNum, error: 'Missing required fields' });
        return;
      }
      rows.push({
        programId: parseInt(programId),
        divisionId: divisionId ? parseInt(divisionId) : null,
        rollNumber,
        firstName,
        lastName,
        email: emailIdx >= 0 ? row.getCell(emailIdx + 1).value?.toString().trim() || null : null,
        phone: phoneIdx >= 0 ? row.getCell(phoneIdx + 1).value?.toString().trim() || null : null,
        batch: batchIdx >= 0 ? row.getCell(batchIdx + 1).value?.toString().trim() || null : null,
      });
    });

    for (const data of rows) {
      try {
        await prisma.student.upsert({ where: { rollNumber: data.rollNumber }, update: { firstName: data.firstName, lastName: data.lastName, email: data.email, phone: data.phone, batch: data.batch, divisionId: data.divisionId }, create: data });
        results.imported++;
      } catch (e) {
        results.skipped++;
        results.errors.push({ rollNumber: data.rollNumber, error: e.message });
      }
    }

    await logAudit({ userId: req.user.id, action: 'IMPORT', entity: 'Student', details: results, req });
    res.json({ message: `Import complete. ${results.imported} students imported, ${results.skipped} skipped.`, ...results });
  } catch (err) { next(err); }
});

module.exports = router;
