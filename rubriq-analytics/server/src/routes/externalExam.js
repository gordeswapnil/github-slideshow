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

// ─── SMART IMPORT ────────────────────────────────────────────────────────────

const { v4: uuidv4 } = require('uuid');
const jobStore = new Map(); // in-memory: jobId → { rows, headers }

// POST /api/external-exams/smart-parse
// Step 1: upload any Excel/CSV, Claude detects structure, returns mapping for review
router.post('/smart-parse', authenticate, requireAdmin, upload.single('file'), async (req, res, next) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  try {
    const ExcelJS = require('exceljs');
    const workbook = new ExcelJS.Workbook();

    // Support both xlsx and csv
    if (req.file.originalname?.endsWith('.csv') || req.file.mimetype === 'text/csv') {
      await workbook.csv.readFile(req.file.path);
    } else {
      await workbook.xlsx.readFile(req.file.path);
    }

    const sheet = workbook.worksheets[0];
    const allRows = [];
    sheet.eachRow((row, idx) => {
      allRows.push(row.values.slice(1)); // remove leading undefined at index 0
    });

    fs.unlink(req.file.path, () => {});
    if (allRows.length < 2) return res.status(400).json({ error: 'File is empty or has only a header row' });

    const headers = allRows[0].map(h => String(h ?? '').trim());
    const sampleRows = allRows.slice(1, 6).map(r => r.map(v => String(v ?? '').trim()));
    const dataRows = allRows.slice(1); // all data, store for later import

    // Claude AI detection
    const Anthropic = require('@anthropic-ai/sdk');
    if (!process.env.ANTHROPIC_API_KEY) return res.status(503).json({ error: 'ANTHROPIC_API_KEY not configured' });

    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const prompt = `You are analyzing an examination marks spreadsheet from an Indian university.
The file has these column headers (index starting at 0):
${headers.map((h, i) => `  [${i}] "${h}"`).join('\n')}

Sample data rows (first ${sampleRows.length}):
${sampleRows.map((r, ri) => `  Row ${ri + 1}: ${r.map((v, i) => `[${i}]="${v}"`).join(', ')}`).join('\n')}

Analyze and return ONLY a valid JSON object:
{
  "rollCol": 0,
  "nameCol": 1,
  "suggestedTitle": "End Semester Examination",
  "totalMarks": 100,
  "questions": [
    {
      "colIndex": 2,
      "questionNo": 1,
      "coCode": "CO1",
      "maxMarks": 8,
      "label": "Q1"
    }
  ],
  "skipCols": [5],
  "notes": "brief explanation"
}

Rules:
- rollCol: column index with roll number / enrollment / PRN / student ID
- nameCol: column index with student name (or null if absent)
- questions: only question/marks columns — each has colIndex, questionNo, coCode (extract from header like "CO1","CO-1","C.O.1" etc), maxMarks (look for numbers like "8M","(8)","Max:8","/8" in header or infer from data max value)
- skipCols: indices of total/grand total/sum columns to ignore
- suggestedTitle: a suitable exam title from context clues
- Return ONLY the JSON, no explanation`;

    const message = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 2048,
      messages: [{ role: 'user', content: prompt }],
    });

    const raw = message.content[0].text.trim();
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return res.status(422).json({ error: 'AI could not parse the file structure. Please check file format.' });
    const detected = JSON.parse(jsonMatch[0]);

    // Store rows for confirmation step
    const jobId = uuidv4();
    jobStore.set(jobId, { dataRows, headers });
    setTimeout(() => jobStore.delete(jobId), 30 * 60 * 1000); // expire in 30 min

    res.json({ jobId, detected, headers, sampleRows });
  } catch (err) {
    fs.unlink(req.file?.path, () => {});
    next(err);
  }
});

// POST /api/external-exams/smart-confirm
// Step 2: confirm mapping and import all rows
router.post('/smart-confirm', authenticate, requireAdmin, async (req, res, next) => {
  try {
    const { jobId, courseId, evaluationCycleId, divisionId, title, mapping } = req.body;
    // mapping = { rollCol, nameCol, questions: [{colIndex, questionNo, coCode, maxMarks}] }

    if (!jobStore.has(jobId)) return res.status(400).json({ error: 'Session expired. Please re-upload the file.' });
    const { dataRows } = jobStore.get(jobId);

    if (!courseId || !evaluationCycleId) return res.status(400).json({ error: 'courseId and evaluationCycleId required' });
    const cid = parseInt(courseId);
    const ecid = parseInt(evaluationCycleId);

    // Resolve CO codes to IDs
    const courseOutcomes = await prisma.courseOutcome.findMany({ where: { courseId: cid } });
    const coByCode = {};
    for (const co of courseOutcomes) coByCode[co.code.toUpperCase().replace(/[-.\s]/g, '')] = co.id;

    const resolveCoId = (code) => {
      if (!code) return null;
      const key = String(code).toUpperCase().replace(/[-.\s]/g, '');
      return coByCode[key] || null;
    };

    // Create the exam assessment + questions in one transaction
    let examId;
    await prisma.$transaction(async (tx) => {
      const assessment = await tx.assessment.create({
        data: {
          courseId: cid,
          evaluationCycleId: ecid,
          divisionId: divisionId ? parseInt(divisionId) : null,
          title: title || 'External Examination',
          type: 'EXTERNAL_EXAM',
          totalMarks: mapping.questions.reduce((s, q) => s + (parseFloat(q.maxMarks) || 0), 0) || 100,
          passingMarks: Math.round((mapping.questions.reduce((s, q) => s + (parseFloat(q.maxMarks) || 0), 0) || 100) * 0.4),
        },
      });
      examId = assessment.id;

      for (const q of mapping.questions) {
        await tx.examQuestion.create({
          data: {
            assessmentId: assessment.id,
            courseId: cid,
            number: parseInt(q.questionNo),
            text: q.label || null,
            coId: resolveCoId(q.coCode),
            maxMarks: parseFloat(q.maxMarks) || 0,
          },
        });
      }
    });

    // Load created questions
    const questions = await prisma.examQuestion.findMany({ where: { assessmentId: examId }, orderBy: { number: 'asc' } });

    // Import student marks row by row
    let imported = 0;
    const errors = [];

    for (const row of dataRows) {
      const rollRaw = String(row[mapping.rollCol] ?? '').trim();
      if (!rollRaw || rollRaw.toLowerCase() === 'total' || rollRaw === '') continue;

      const student = await prisma.student.findFirst({ where: { rollNumber: { contains: rollRaw } } })
        || await prisma.student.findFirst({ where: { rollNumber: rollRaw } });

      if (!student) { errors.push(`Roll No "${rollRaw}" not found in system`); continue; }

      for (let qi = 0; qi < mapping.questions.length; qi++) {
        const qMapping = mapping.questions[qi];
        const question = questions.find(q => q.number === parseInt(qMapping.questionNo));
        if (!question) continue;

        const marksRaw = row[qMapping.colIndex];
        const marks = parseFloat(marksRaw) || 0;

        await prisma.externalExamMark.upsert({
          where: { questionId_studentId: { questionId: question.id, studentId: student.id } },
          create: { questionId: question.id, studentId: student.id, marks },
          update: { marks },
        });
      }
      imported++;
    }

    jobStore.delete(jobId);
    await logAudit({ userId: req.user.id, action: 'CREATE', entity: 'ExternalExamSmartImport', entityId: examId, details: { imported, errors: errors.length, title }, req });

    res.json({ success: true, examId, imported, errors, total: dataRows.length });
  } catch (err) { next(err); }
});

module.exports = router;
