const prisma = require('../db');
const router = require('express').Router();
const { authenticate, requireAdmin } = require('../middleware/auth');
const { logAudit } = require('../utils/audit');

async function hardDeleteCourse(tx, courseId) {
  const assessments = await tx.assessment.findMany({ where: { courseId }, select: { id: true } });
  const assessmentIds = assessments.map(a => a.id);

  if (assessmentIds.length) {
    // Exam marks chain
    const examQs = await tx.examQuestion.findMany({ where: { assessmentId: { in: assessmentIds } }, select: { id: true } });
    const examQIds = examQs.map(q => q.id);
    if (examQIds.length) await tx.externalExamMark.deleteMany({ where: { questionId: { in: examQIds } } });
    await tx.examQuestion.deleteMany({ where: { OR: [{ assessmentId: { in: assessmentIds } }, { courseId }] } });

    // Submissions chain
    const subs = await tx.studentSubmission.findMany({ where: { assessmentId: { in: assessmentIds } }, select: { id: true } });
    const subIds = subs.map(s => s.id);
    if (subIds.length) {
      const evals = await tx.teacherEvaluation.findMany({ where: { submissionId: { in: subIds } }, select: { id: true } });
      const evalIds = evals.map(e => e.id);
      if (evalIds.length) await tx.teacherEvaluationScore.deleteMany({ where: { evaluationId: { in: evalIds } } });
      await tx.teacherEvaluation.deleteMany({ where: { submissionId: { in: subIds } } });
      await tx.submissionFile.deleteMany({ where: { submissionId: { in: subIds } } });
      await tx.studentSubmission.deleteMany({ where: { assessmentId: { in: assessmentIds } } });
    }

    // Marks upload batches
    const batches = await tx.marksUploadBatch.findMany({ where: { assessmentId: { in: assessmentIds } }, select: { id: true } });
    const batchIds = batches.map(b => b.id);
    if (batchIds.length) {
      await tx.validationError.deleteMany({ where: { batchId: { in: batchIds } } });
      await tx.columnMapping.deleteMany({ where: { batchId: { in: batchIds } } });
      await tx.marksUploadBatch.deleteMany({ where: { id: { in: batchIds } } });
    }

    // Rubrics linked to assessments
    const rubrics = await tx.rubric.findMany({ where: { assessmentId: { in: assessmentIds } }, select: { id: true } });
    const rubricIds = rubrics.map(r => r.id);
    if (rubricIds.length) {
      const criteria = await tx.rubricCriterion.findMany({ where: { rubricId: { in: rubricIds } }, select: { id: true } });
      const criterionIds = criteria.map(c => c.id);
      if (criterionIds.length) {
        await tx.teacherEvaluationScore.deleteMany({ where: { criterionId: { in: criterionIds } } });
        await tx.criterionOutcomeMapping.deleteMany({ where: { criterionId: { in: criterionIds } } });
        await tx.rubricLevel.deleteMany({ where: { criterionId: { in: criterionIds } } });
        await tx.rubricCriterion.deleteMany({ where: { rubricId: { in: rubricIds } } });
      }
      await tx.rubric.deleteMany({ where: { id: { in: rubricIds } } });
    }

    await tx.assessment.deleteMany({ where: { courseId } });
  }

  // Rubrics linked directly to course (templates)
  const courseRubrics = await tx.rubric.findMany({ where: { courseId, assessmentId: null }, select: { id: true } });
  const cRubricIds = courseRubrics.map(r => r.id);
  if (cRubricIds.length) {
    const criteria = await tx.rubricCriterion.findMany({ where: { rubricId: { in: cRubricIds } }, select: { id: true } });
    const criterionIds = criteria.map(c => c.id);
    if (criterionIds.length) {
      await tx.teacherEvaluationScore.deleteMany({ where: { criterionId: { in: criterionIds } } });
      await tx.criterionOutcomeMapping.deleteMany({ where: { criterionId: { in: criterionIds } } });
      await tx.rubricLevel.deleteMany({ where: { criterionId: { in: criterionIds } } });
      await tx.rubricCriterion.deleteMany({ where: { rubricId: { in: cRubricIds } } });
    }
    await tx.rubric.deleteMany({ where: { id: { in: cRubricIds } } });
  }

  // Course outcomes and CO-PO mappings
  const cos = await tx.courseOutcome.findMany({ where: { courseId }, select: { id: true } });
  const coIds = cos.map(c => c.id);
  if (coIds.length) {
    await tx.cOPOMapping.deleteMany({ where: { coId: { in: coIds } } });
    await tx.criterionOutcomeMapping.deleteMany({ where: { coId: { in: coIds } } });
    await tx.courseOutcome.deleteMany({ where: { courseId } });
  }

  // Learning outcomes
  const los = await tx.learningOutcome.findMany({ where: { courseId }, select: { id: true } });
  const loIds = los.map(l => l.id);
  if (loIds.length) {
    await tx.criterionOutcomeMapping.deleteMany({ where: { loId: { in: loIds } } });
    await tx.learningOutcome.deleteMany({ where: { courseId } });
  }

  await tx.facultyCourseAssignment.deleteMany({ where: { courseId } });
  await tx.examQuestion.deleteMany({ where: { courseId } });
  await tx.course.delete({ where: { id: courseId } });
}

module.exports.hardDeleteCourse = hardDeleteCourse;

router.get('/', authenticate, async (req, res, next) => {
  try {
    const { programId } = req.query;
    const where = programId ? { programId: parseInt(programId) } : {};
    const courses = await prisma.course.findMany({
      where,
      include: { program: { select: { name: true, code: true } }, _count: { select: { assessments: true, courseOutcomes: true } } },
      orderBy: { name: 'asc' },
    });
    res.json(courses);
  } catch (err) { next(err); }
});

router.get('/:id', authenticate, async (req, res, next) => {
  try {
    const course = await prisma.course.findUnique({
      where: { id: parseInt(req.params.id) },
      include: { courseOutcomes: true, learningOutcomes: true, assessments: { include: { evaluationCycle: true } } },
    });
    if (!course) return res.status(404).json({ error: 'Course not found' });
    res.json(course);
  } catch (err) { next(err); }
});

router.post('/', authenticate, requireAdmin, async (req, res, next) => {
  try {
    const { programId, name, code, credits, semester, description } = req.body;
    if (!programId || !name || !code) return res.status(400).json({ error: 'programId, name and code are required' });
    const pid = parseInt(programId);
    const upperCode = code.toUpperCase().trim();
    const trimName = name.trim();
    const existing = await prisma.course.findFirst({
      where: { programId: pid, OR: [{ code: upperCode }, { name: { equals: trimName, mode: 'insensitive' } }] },
    });
    if (existing) {
      const clash = existing.code === upperCode ? `code "${upperCode}"` : `name "${trimName}"`;
      return res.status(409).json({ error: `A course with the same ${clash} already exists in this program.` });
    }
    const course = await prisma.course.create({ data: { programId: pid, name: trimName, code: upperCode, credits: parseInt(credits) || 3, semester: semester ? parseInt(semester) : null, description } });
    await logAudit({ userId: req.user.id, action: 'CREATE', entity: 'Course', entityId: course.id, req });
    res.status(201).json(course);
  } catch (err) { next(err); }
});

router.put('/:id', authenticate, requireAdmin, async (req, res, next) => {
  try {
    const id = parseInt(req.params.id);
    const { name, code, credits, semester, description, isActive } = req.body;
    if (name || code) {
      const current = await prisma.course.findUnique({ where: { id } });
      if (current) {
        const upperCode = code ? code.toUpperCase().trim() : current.code;
        const trimName = name ? name.trim() : current.name;
        const conflict = await prisma.course.findFirst({
          where: { programId: current.programId, id: { not: id }, OR: [{ code: upperCode }, { name: { equals: trimName, mode: 'insensitive' } }] },
        });
        if (conflict) {
          const clash = conflict.code === upperCode ? `code "${upperCode}"` : `name "${trimName}"`;
          return res.status(409).json({ error: `Another course with the same ${clash} already exists in this program.` });
        }
      }
    }
    const course = await prisma.course.update({ where: { id }, data: { name, code: code?.toUpperCase().trim(), credits, semester, description, isActive } });
    res.json(course);
  } catch (err) { next(err); }
});

router.delete('/:id', authenticate, requireAdmin, async (req, res, next) => {
  try {
    const courseId = parseInt(req.params.id);
    await prisma.$transaction(async (tx) => {
      await hardDeleteCourse(tx, courseId);
    }, { timeout: 30000 });
    await logAudit({ userId: req.user.id, action: 'DELETE', entity: 'Course', entityId: courseId, req });
    res.json({ message: 'Course and all related data permanently deleted.' });
  } catch (err) { next(err); }
});

// Course Outcomes CRUD
router.get('/:id/outcomes', authenticate, async (req, res, next) => {
  try {
    const outcomes = await prisma.courseOutcome.findMany({ where: { courseId: parseInt(req.params.id) }, orderBy: { code: 'asc' } });
    res.json(outcomes);
  } catch (err) { next(err); }
});

router.post('/:id/outcomes', authenticate, requireAdmin, async (req, res, next) => {
  try {
    const { code, description, bloomLevel } = req.body;
    const co = await prisma.courseOutcome.create({ data: { courseId: parseInt(req.params.id), code, description, bloomLevel } });
    res.status(201).json(co);
  } catch (err) { next(err); }
});

module.exports = router;
