const router = require('express').Router();
const { PrismaClient } = require('@prisma/client');
const { authenticate, requireAdmin } = require('../middleware/auth');
const { logAudit } = require('../utils/audit');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const prisma = new PrismaClient();

const uploadDir = path.join(__dirname, '../../uploads/ai-import/');
fs.mkdirSync(uploadDir, { recursive: true });

const upload = multer({
  dest: uploadDir,
  limits: { fileSize: 20 * 1024 * 1024 },
});

// POST /api/ai-import/extract — upload file and extract data
router.post('/extract', authenticate, requireAdmin, upload.single('file'), async (req, res, next) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  try {
    const { parseDocument } = require('../services/documentParser');
    const { extractFromDocument } = require('../services/claudeExtractor');
    const parsed = await parseDocument(req.file.path, req.file.mimetype);
    const extracted = await extractFromDocument(parsed);
    // Clean up temp file
    fs.unlink(req.file.path, () => {});
    res.json({ extracted, fileName: req.file.originalname });
  } catch (err) {
    fs.unlink(req.file.path, () => {});
    next(err);
  }
});

// POST /api/ai-import/confirm — create all master records in one transaction
router.post('/confirm', authenticate, requireAdmin, async (req, res, next) => {
  try {
    const { extracted } = req.body;
    const results = { created: {}, skipped: {} };

    await prisma.$transaction(async (tx) => {

      // 1. Institution
      let institution = null;
      if (extracted.university?.name) {
        institution = await tx.institution.upsert({
          where: { code: (extracted.university.code || extracted.university.name.slice(0, 10)).toUpperCase() },
          create: { name: extracted.university.name, code: (extracted.university.code || extracted.university.name.slice(0, 10)).toUpperCase() },
          update: {},
        });
        results.created.institution = institution.name;
      }

      // 2. College
      let college = null;
      if (institution && extracted.college?.name) {
        const collegeCode = (extracted.college.code || extracted.college.name.slice(0, 10)).toUpperCase();
        const existing = await tx.college.findFirst({ where: { institutionId: institution.id, code: collegeCode } });
        if (existing) { college = existing; results.skipped.college = existing.name; }
        else {
          college = await tx.college.create({ data: { institutionId: institution.id, name: extracted.college.name, code: collegeCode } });
          results.created.college = college.name;
        }
      }

      // 3. Department
      let department = null;
      if (institution && extracted.department?.name) {
        const deptCode = (extracted.department.code || extracted.department.name.slice(0, 10)).toUpperCase();
        const existing = await tx.department.findFirst({ where: { institutionId: institution.id, code: deptCode } });
        if (existing) { department = existing; results.skipped.department = existing.name; }
        else {
          department = await tx.department.create({
            data: { institutionId: institution.id, collegeId: college?.id || null, name: extracted.department.name, code: deptCode, hodName: extracted.department.hodName },
          });
          results.created.department = department.name;
        }
      }

      // 4. Program
      let program = null;
      if (department && extracted.program?.name) {
        const progCode = (extracted.program.code || extracted.program.name.slice(0, 10)).toUpperCase();
        const existing = await tx.program.findFirst({ where: { departmentId: department.id, code: progCode } });
        if (existing) { program = existing; results.skipped.program = existing.name; }
        else {
          program = await tx.program.create({
            data: { departmentId: department.id, name: extracted.program.name, code: progCode, level: extracted.program.level || 'PG', duration: extracted.program.duration || 2 },
          });
          results.created.program = program.name;
        }
      }

      // 5. Course
      let course = null;
      if (program && extracted.course?.name) {
        const courseCode = (extracted.course.code || extracted.course.name.slice(0, 10)).toUpperCase();
        const existing = await tx.course.findFirst({ where: { programId: program.id, code: courseCode } });
        if (existing) { course = existing; results.skipped.course = existing.name; }
        else {
          course = await tx.course.create({
            data: { programId: program.id, name: extracted.course.name, code: courseCode, credits: extracted.course.credits || 3, semester: extracted.course.semester, description: extracted.course.description },
          });
          results.created.course = course.name;
        }
      }

      // 6. Program Outcomes
      const poMap = {};
      if (program && extracted.programOutcomes?.length) {
        for (const po of extracted.programOutcomes) {
          if (!po.code || !po.description) continue;
          const existing = await tx.programOutcome.findFirst({ where: { programId: program.id, code: po.code } });
          if (existing) { poMap[po.code] = existing.id; }
          else {
            const created = await tx.programOutcome.create({ data: { programId: program.id, code: po.code, description: po.description } });
            poMap[po.code] = created.id;
          }
        }
        results.created.programOutcomes = Object.keys(poMap).length;
      }

      // 7. PSOs
      const psoMap = {};
      if (program && extracted.programSpecificOutcomes?.length) {
        for (const pso of extracted.programSpecificOutcomes) {
          if (!pso.code || !pso.description) continue;
          const existing = await tx.programSpecificOutcome.findFirst({ where: { programId: program.id, code: pso.code } });
          if (existing) { psoMap[pso.code] = existing.id; }
          else {
            const created = await tx.programSpecificOutcome.create({ data: { programId: program.id, code: pso.code, description: pso.description } });
            psoMap[pso.code] = created.id;
          }
        }
        results.created.psos = Object.keys(psoMap).length;
      }

      // 8. Course Outcomes
      const coMap = {};
      if (course && extracted.courseOutcomes?.length) {
        for (const co of extracted.courseOutcomes) {
          if (!co.code || !co.description) continue;
          const existing = await tx.courseOutcome.findFirst({ where: { courseId: course.id, code: co.code } });
          if (existing) { coMap[co.code] = existing.id; }
          else {
            const created = await tx.courseOutcome.create({ data: { courseId: course.id, code: co.code, description: co.description, bloomLevel: co.bloomLevel } });
            coMap[co.code] = created.id;
          }
        }
        results.created.courseOutcomes = Object.keys(coMap).length;
      }

      // 9. CO-PO Mapping
      if (extracted.coPOMapping?.length) {
        let mappingCount = 0;
        for (const m of extracted.coPOMapping) {
          const coId = coMap[m.co];
          const poId = poMap[m.po];
          if (!coId || !poId) continue;
          const existing = await tx.cOPOMapping.findFirst({ where: { coId, poId } });
          if (!existing) {
            await tx.cOPOMapping.create({ data: { coId, poId, strength: m.strength || 3 } });
            mappingCount++;
          }
        }
        results.created.coPOMappings = mappingCount;
      }

      // 10. PSO Mapping
      if (extracted.coPSOMapping?.length) {
        for (const m of extracted.coPSOMapping) {
          const coId = coMap[m.co];
          const psoId = psoMap[m.pso];
          if (!coId || !psoId) continue;
          const existing = await tx.cOPOMapping.findFirst({ where: { coId, psoId } });
          if (!existing) await tx.cOPOMapping.create({ data: { coId, psoId, strength: m.strength || 2 } });
        }
      }

      // 11. Rubric Template (course-level)
      if (course && extracted.rubricCriteria?.length) {
        const rubric = await tx.rubric.create({
          data: {
            courseId: course.id,
            title: `${extracted.course?.name || 'Course'} Rubric`,
            description: `Auto-imported from syllabus`,
            totalMarks: extracted.assessmentConfig?.totalMarks || 30,
            isPublished: false,
          },
        });

        for (let i = 0; i < extracted.rubricCriteria.length; i++) {
          const c = extracted.rubricCriteria[i];
          if (!c.title) continue;
          const criterion = await tx.rubricCriterion.create({
            data: { rubricId: rubric.id, title: c.title, maxMarks: c.maxMarks || 5, bloomLevel: c.bloomLevel, orderIndex: c.orderIndex ?? i },
          });
          // Levels
          if (c.levels?.length) {
            for (const lv of c.levels) {
              if (lv.label && lv.maxMarks !== null) {
                await tx.rubricLevel.create({
                  data: { criterionId: criterion.id, label: lv.label, minMarks: lv.minMarks || 0, maxMarks: lv.maxMarks, descriptor: lv.descriptor },
                });
              }
            }
          }
          // CO Mapping
          if (c.mappedCO && coMap[c.mappedCO]) {
            await tx.criterionOutcomeMapping.create({ data: { criterionId: criterion.id, outcomeType: 'CO', coId: coMap[c.mappedCO], strength: 3 } });
          }
        }
        results.created.rubricTemplate = rubric.title;
        results.created.rubricCriteria = extracted.rubricCriteria.length;
      }

    });

    await logAudit({ userId: req.user.id, action: 'CREATE', entity: 'AIImport', details: results, req });
    res.json({ success: true, results });
  } catch (err) { next(err); }
});

module.exports = router;
