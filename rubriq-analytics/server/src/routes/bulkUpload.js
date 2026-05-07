const prisma = require('../db');
const router = require('express').Router();
const { authenticate, requireAdmin } = require('../middleware/auth');
const { excelUpload } = require('../middleware/upload');
const ExcelJS = require('exceljs');

const FIELD_KEYWORDS = {
  rollNumber: ['roll', 'rollno', 'roll_no', 'rollnumber', 'roll_number', 'student_id'],
  studentName: ['name', 'student_name', 'full_name', 'fullname'],
  firstName: ['first', 'firstname', 'first_name'],
  lastName: ['last', 'lastname', 'last_name'],
};

const CRITERIA_KEYWORDS = [
  { key: 'c1', keywords: ['ai finance', 'understanding', 'context', 'c1', 'criterion 1', 'crit1'] },
  { key: 'c2', keywords: ['application', 'tools', 'models', 'c2', 'criterion 2', 'crit2'] },
  { key: 'c3', keywords: ['financial analysis', 'decision', 'c3', 'criterion 3', 'crit3'] },
  { key: 'c4', keywords: ['evidence', 'data', 'rigor', 'c4', 'criterion 4', 'crit4'] },
  { key: 'c5', keywords: ['risk', 'ethics', 'governance', 'c5', 'criterion 5', 'crit5'] },
  { key: 'c6', keywords: ['case analysis', 'structure', 'argument', 'c6', 'criterion 6', 'crit6'] },
  { key: 'c7', keywords: ['recommendations', 'implementation', 'c7', 'criterion 7', 'crit7'] },
  { key: 'c8', keywords: ['referencing', 'presentation', 'integrity', 'c8', 'criterion 8', 'crit8'] },
  { key: 'total', keywords: ['total', 'marks', 'score', 'grand total'] },
];

function detectFieldMapping(header) {
  const h = header.toLowerCase().trim();
  for (const [field, keywords] of Object.entries(FIELD_KEYWORDS)) {
    if (keywords.some(k => h.includes(k))) return { field, confidence: 95 };
  }
  for (const { key, keywords } of CRITERIA_KEYWORDS) {
    if (keywords.some(k => h.includes(k))) return { field: key, confidence: 85 };
  }
  return { field: null, confidence: 0 };
}

router.post('/analyze', authenticate, requireAdmin, (req, res, next) => {
  req.uploadSubDir = 'bulk_uploads';
  next();
}, excelUpload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const { assessmentId } = req.body;
    if (!assessmentId) return res.status(400).json({ error: 'assessmentId is required' });

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(req.file.path);
    const worksheet = workbook.worksheets[0];

    const headers = [];
    worksheet.getRow(1).eachCell((cell, col) => {
      headers.push({ col, value: cell.value?.toString() || `Column ${col}` });
    });

    const sampleRows = [];
    let rowCount = 0;
    worksheet.eachRow((row, rowNum) => {
      if (rowNum === 1) return;
      if (rowCount >= 3) return;
      const rowData = {};
      headers.forEach(h => { rowData[h.value] = row.getCell(h.col).value?.toString() || ''; });
      sampleRows.push(rowData);
      rowCount++;
    });

    const totalRows = worksheet.rowCount - 1;

    const mappings = headers.map(h => {
      const { field, confidence } = detectFieldMapping(h.value);
      const samples = sampleRows.map(r => r[h.value] || '').filter(Boolean).slice(0, 3);
      return {
        excelColumn: h.value,
        sampleValues: samples.join(', '),
        detectedField: field,
        mappedTo: field,
        confidence,
        status: confidence >= 90 ? 'HIGH' : confidence >= 70 ? 'MEDIUM' : field ? 'LOW' : 'UNMAPPED',
        isConfirmed: confidence >= 90,
      };
    });

    const batch = await prisma.marksUploadBatch.create({
      data: {
        assessmentId: parseInt(assessmentId),
        uploadedById: req.user.id,
        fileName: req.file.originalname,
        filePath: req.file.path,
        status: 'ANALYZED',
        totalRows,
      },
    });

    for (const m of mappings) {
      await prisma.columnMapping.create({
        data: {
          batchId: batch.id,
          excelColumn: m.excelColumn,
          sampleValues: m.sampleValues,
          mappedTo: m.mappedTo,
          confidence: m.confidence,
          isConfirmed: m.isConfirmed,
        },
      });
    }

    res.json({ batchId: batch.id, totalRows, mappings, sheets: workbook.worksheets.map(ws => ws.name) });
  } catch (err) { next(err); }
});

router.post('/:batchId/confirm-mappings', authenticate, requireAdmin, async (req, res, next) => {
  try {
    const { mappings } = req.body;
    const batchId = parseInt(req.params.batchId);
    for (const m of mappings) {
      await prisma.columnMapping.updateMany({
        where: { batchId, excelColumn: m.excelColumn },
        data: { mappedTo: m.mappedTo, isConfirmed: true },
      });
    }
    await prisma.marksUploadBatch.update({ where: { id: batchId }, data: { status: 'MAPPED' } });
    res.json({ message: 'Mappings confirmed' });
  } catch (err) { next(err); }
});

router.post('/:batchId/validate', authenticate, requireAdmin, async (req, res, next) => {
  try {
    const batchId = parseInt(req.params.batchId);
    const batch = await prisma.marksUploadBatch.findUnique({ where: { id: batchId }, include: { columnMappings: true, assessment: { include: { rubric: { include: { criteria: true } } } } } });
    if (!batch) return res.status(404).json({ error: 'Batch not found' });

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(batch.filePath);
    const worksheet = workbook.worksheets[0];

    const headerMap = {};
    batch.columnMappings.forEach(m => { if (m.mappedTo && m.isConfirmed) headerMap[m.excelColumn] = m.mappedTo; });

    const getColIndex = (headers, colName) => headers.findIndex(h => h === colName);
    const headers = [];
    worksheet.getRow(1).eachCell(cell => headers.push(cell.value?.toString() || ''));

    const errors = [];
    let validRows = 0;
    const seenRolls = new Set();

    worksheet.eachRow(async (row, rowNum) => {
      if (rowNum === 1) return;
      const rowErrors = [];
      const rollCol = Object.keys(headerMap).find(k => headerMap[k] === 'rollNumber');
      const rollNum = rollCol ? row.getCell(headers.indexOf(rollCol) + 1).value?.toString().trim() : null;

      if (!rollNum) rowErrors.push({ field: 'rollNumber', type: 'MISSING', message: 'Roll number is missing' });
      else if (seenRolls.has(rollNum)) rowErrors.push({ field: 'rollNumber', type: 'DUPLICATE', message: `Duplicate roll number: ${rollNum}` });
      else seenRolls.add(rollNum);

      const criteria = batch.assessment?.rubric?.criteria || [];
      for (const criterion of criteria) {
        const colKey = `c${criterion.orderIndex}`;
        const colName = Object.keys(headerMap).find(k => headerMap[k] === colKey);
        if (colName) {
          const val = parseFloat(row.getCell(headers.indexOf(colName) + 1).value?.toString() || '0');
          if (isNaN(val)) rowErrors.push({ field: colKey, type: 'INVALID', message: `Invalid marks for criterion ${criterion.orderIndex}` });
          else if (val < 0) rowErrors.push({ field: colKey, type: 'NEGATIVE', message: `Negative marks for criterion ${criterion.orderIndex}` });
          else if (val > criterion.maxMarks) rowErrors.push({ field: colKey, type: 'EXCEEDS_MAX', message: `Marks ${val} exceed maximum ${criterion.maxMarks} for criterion ${criterion.orderIndex}` });
        }
      }

      if (rowErrors.length > 0) {
        errors.push({ row: rowNum, rollNumber: rollNum, errors: rowErrors });
      } else {
        validRows++;
      }
    });

    await prisma.marksUploadBatch.update({ where: { id: batchId }, data: { status: 'VALIDATED', validRows, errorRows: errors.length } });

    res.json({ batchId, totalRows: batch.totalRows, validRows, errorRows: errors.length, errors: errors.slice(0, 50) });
  } catch (err) { next(err); }
});

router.get('/', authenticate, async (req, res, next) => {
  try {
    const batches = await prisma.marksUploadBatch.findMany({
      include: {
        assessment: { select: { title: true } },
        uploadedBy: { select: { firstName: true, lastName: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    res.json(batches);
  } catch (err) { next(err); }
});

module.exports = router;
