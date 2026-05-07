const prisma = require('../db');
const router = require('express').Router();
const { authenticate, requireAdmin } = require('../middleware/auth');
const { logAudit } = require('../utils/audit');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const uploadDir = path.join(__dirname, '../../uploads/external-exam/');
fs.mkdirSync(uploadDir, { recursive: true });

const upload = multer({ dest: uploadDir, limits: { fileSize: 10 * 1024 * 1024 } });

// GET /api/external-exams?courseId=&semesterId=
router.get('/', authenticate, async (req, res, next) => {
  try {
    const { courseId, semesterId, evalCycleId } = req.query;
    const where = { type: 'EXTERNAL_EXAM' };
    if (courseId) where.courseId = parseInt(courseId);
    if (evalCycleId) where.evaluationCycleId = parseInt(evalCycleId);
    if (semesterId) where.evaluationCycle = { semesterId: parseInt(semesterId) };

    const exams = await prisma.assessment.findMany({
      where,
      include: {
        course: { select: { name: true, code: true } },
        evaluationCycle: { select: { label: true, semester: { select: { label: true } } } },
        division: { select: { name: true } },
        examQuestions: { include: { co: { select: { code: true, description: true } } }, orderBy: { number: 'asc' } },
        _count: { select: { examQuestions: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    res.json(exams);
  } catch (err) { next(err); }
});

// POST /api/external-exams
router.post('/', authenticate, requireAdmin, async (req, res, next) => {
  try {
    const { courseId, evaluationCycleId, divisionId, title, description, totalMarks, questions } = req.body;
    if (!courseId || !evaluationCycleId || !title) return res.status(400).json({ error: 'courseId, evaluationCycleId and title required' });

    const exam = await prisma.$transaction(async (tx) => {
      const assessment = await tx.assessment.create({
        data: {
          courseId: parseInt(courseId),
          evaluationCycleId: parseInt(evaluationCycleId),
          divisionId: divisionId ? parseInt(divisionId) : null,
          title,
          type: 'EXTERNAL_EXAM',
          description: description || null,
          totalMarks: parseInt(totalMarks) || 100,
          passingMarks: Math.round((parseInt(totalMarks) || 100) * 0.4),
        },
      });
      if (questions?.length) {
        for (let i = 0; i < questions.length; i++) {
          const q = questions[i];
          await tx.examQuestion.create({
            data: {
              assessmentId: assessment.id,
              courseId: parseInt(courseId),
              number: q.number || i + 1,
              text: q.text || null,
              coId: q.coId ? parseInt(q.coId) : null,
              maxMarks: parseFloat(q.maxMarks) || 0,
            },
          });
        }
      }
      return assessment;
    });

    await logAudit({ userId: req.user.id, action: 'CREATE', entity: 'ExternalExam', entityId: exam.id, details: { title }, req });
    res.status(201).json(exam);
  } catch (err) { next(err); }
});

// GET /api/external-exams/:id
router.get('/:id', authenticate, async (req, res, next) => {
  try {
    const exam = await prisma.assessment.findUnique({
      where: { id: parseInt(req.params.id) },
      include: {
        course: { select: { id: true, name: true, code: true, courseOutcomes: { orderBy: { code: 'asc' } } } },
        evaluationCycle: { select: { label: true } },
        division: { select: { name: true } },
        examQuestions: { include: { co: { select: { code: true } } }, orderBy: { number: 'asc' } },
      },
    });
    if (!exam) return res.status(404).json({ error: 'Exam not found' });
    res.json(exam);
  } catch (err) { next(err); }
});

// POST /api/external-exams/:id/questions
router.post('/:id/questions', authenticate, requireAdmin, async (req, res, next) => {
  try {
    const assessmentId = parseInt(req.params.id);
    const exam = await prisma.assessment.findUnique({ where: { id: assessmentId } });
    if (!exam) return res.status(404).json({ error: 'Exam not found' });

    const { number, text, coId, maxMarks } = req.body;
    const q = await prisma.examQuestion.create({
      data: { assessmentId, courseId: exam.courseId, number: parseInt(number), text: text || null, coId: coId ? parseInt(coId) : null, maxMarks: parseFloat(maxMarks) || 0 },
      include: { co: { select: { code: true } } },
    });
    res.status(201).json(q);
  } catch (err) { next(err); }
});

// PUT /api/external-exams/:id/questions/:qid
router.put('/:id/questions/:qid', authenticate, requireAdmin, async (req, res, next) => {
  try {
    const { text, coId, maxMarks } = req.body;
    const q = await prisma.examQuestion.update({
      where: { id: parseInt(req.params.qid) },
      data: { text: text || null, coId: coId ? parseInt(coId) : null, maxMarks: parseFloat(maxMarks) || 0 },
      include: { co: { select: { code: true } } },
    });
    res.json(q);
  } catch (err) { next(err); }
});

// DELETE /api/external-exams/:id/questions/:qid
router.delete('/:id/questions/:qid', authenticate, requireAdmin, async (req, res, next) => {
  try {
    await prisma.externalExamMark.deleteMany({ where: { questionId: parseInt(req.params.qid) } });
    await prisma.examQuestion.delete({ where: { id: parseInt(req.params.qid) } });
    res.json({ success: true });
  } catch (err) { next(err); }
});

// POST /api/external-exams/:id/upload — Excel upload with question-wise marks
router.post('/:id/upload', authenticate, requireAdmin, upload.single('file'), async (req, res, next) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  try {
    const ExcelJS = require('exceljs');
    const assessmentId = parseInt(req.params.id);

    const questions = await prisma.examQuestion.findMany({ where: { assessmentId }, orderBy: { number: 'asc' } });
    if (!questions.length) return res.status(400).json({ error: 'No questions defined for this exam. Add questions first.' });

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(req.file.path);
    const sheet = workbook.worksheets[0];

    const rows = [];
    sheet.eachRow((row, idx) => { if (idx > 1) rows.push(row.values); });

    // Header row (row 1): RollNo, Name, Q1, Q2, Q3 ...
    const header = sheet.getRow(1).values;

    let imported = 0, errors = [];
    for (const rowVals of rows) {
      const rollNumber = String(rowVals[1] || '').trim();
      if (!rollNumber) continue;

      const student = await prisma.student.findFirst({ where: { rollNumber } });
      if (!student) { errors.push(`Roll No ${rollNumber} not found`); continue; }

      for (let i = 0; i < questions.length; i++) {
        const colIdx = i + 3;
        const marksRaw = rowVals[colIdx];
        const marks = parseFloat(marksRaw) || 0;
        await prisma.externalExamMark.upsert({
          where: { questionId_studentId: { questionId: questions[i].id, studentId: student.id } },
          create: { questionId: questions[i].id, studentId: student.id, marks },
          update: { marks },
        });
      }
      imported++;
    }

    fs.unlink(req.file.path, () => {});
    await logAudit({ userId: req.user.id, action: 'CREATE', entity: 'ExternalExamMarks', entityId: assessmentId, details: { imported, errors: errors.length }, req });
    res.json({ imported, errors });
  } catch (err) {
    fs.unlink(req.file.path, () => {});
    next(err);
  }
});

// GET /api/external-exams/:id/marks — get all student marks
router.get('/:id/marks', authenticate, async (req, res, next) => {
  try {
    const assessmentId = parseInt(req.params.id);
    const questions = await prisma.examQuestion.findMany({ where: { assessmentId }, include: { co: { select: { code: true } } }, orderBy: { number: 'asc' } });

    const marks = await prisma.externalExamMark.findMany({
      where: { question: { assessmentId } },
      include: { student: { select: { rollNumber: true, firstName: true, lastName: true } }, question: { select: { number: true, maxMarks: true, coId: true } } },
    });

    // Group by student
    const byStudent = {};
    for (const m of marks) {
      const key = m.studentId;
      if (!byStudent[key]) byStudent[key] = { student: m.student, marks: {} };
      byStudent[key].marks[m.question.number] = { obtained: m.marks, max: m.question.maxMarks };
    }

    res.json({ questions, students: Object.values(byStudent) });
  } catch (err) { next(err); }
});

// GET /api/external-exams/:id/template — download Excel template
router.get('/:id/template', authenticate, async (req, res, next) => {
  try {
    const assessmentId = parseInt(req.params.id);
    const questions = await prisma.examQuestion.findMany({ where: { assessmentId }, include: { co: { select: { code: true } } }, orderBy: { number: 'asc' } });
    const ExcelJS = require('exceljs');
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Marks');

    const headers = ['Roll Number', 'Student Name', ...questions.map(q => `Q${q.number}${q.co ? ` (${q.co.code})` : ''} [Max:${q.maxMarks}]`)];
    const headerRow = ws.addRow(headers);
    headerRow.eachCell(cell => { cell.font = { bold: true }; cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE3F0FF' } }; });
    ws.getColumn(1).width = 18;
    ws.getColumn(2).width = 25;
    for (let i = 3; i <= headers.length; i++) ws.getColumn(i).width = 20;

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="exam-marks-template.xlsx"`);
    await wb.xlsx.write(res);
    res.end();
  } catch (err) { next(err); }
});

module.exports = router;
