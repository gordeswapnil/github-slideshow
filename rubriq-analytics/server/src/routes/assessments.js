const prisma = require('../db');
const router = require('express').Router();
const { authenticate, requireAdmin } = require('../middleware/auth');
const { logAudit } = require('../utils/audit');

router.get('/', authenticate, async (req, res, next) => {
  try {
    const { courseId, evaluationCycleId, divisionId } = req.query;
    const where = {};
    if (courseId) where.courseId = parseInt(courseId);
    if (evaluationCycleId) where.evaluationCycleId = parseInt(evaluationCycleId);
    if (divisionId) where.divisionId = parseInt(divisionId);
    const assessments = await prisma.assessment.findMany({
      where,
      include: {
        course: { select: { name: true, code: true } },
        evaluationCycle: { select: { label: true, number: true } },
        division: { select: { name: true } },
        rubric: { select: { id: true, isPublished: true } },
        _count: { select: { submissions: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    res.json(assessments);
  } catch (err) { next(err); }
});

router.get('/:id', authenticate, async (req, res, next) => {
  try {
    const assessment = await prisma.assessment.findUnique({
      where: { id: parseInt(req.params.id) },
      include: {
        course: true,
        evaluationCycle: { include: { semester: { include: { academicYear: true } } } },
        division: true,
        rubric: { include: { criteria: { include: { levels: true, outcomeMappings: true }, orderBy: { orderIndex: 'asc' } } } },
        _count: { select: { submissions: true } },
      },
    });
    if (!assessment) return res.status(404).json({ error: 'Assessment not found' });
    res.json(assessment);
  } catch (err) { next(err); }
});

router.post('/', authenticate, requireAdmin, async (req, res, next) => {
  try {
    const { courseId, evaluationCycleId, divisionId, title, type, description, totalMarks, passingMarks, submissionDeadline } = req.body;
    if (!courseId || !evaluationCycleId || !title) return res.status(400).json({ error: 'courseId, evaluationCycleId and title are required' });
    const assessment = await prisma.assessment.create({
      data: {
        courseId: parseInt(courseId),
        evaluationCycleId: parseInt(evaluationCycleId),
        divisionId: divisionId ? parseInt(divisionId) : null,
        title,
        type: type || 'Assignment',
        description,
        totalMarks: parseInt(totalMarks) || 30,
        passingMarks: parseInt(passingMarks) || 12,
        submissionDeadline: submissionDeadline ? new Date(submissionDeadline) : null,
      },
    });
    await logAudit({ userId: req.user.id, action: 'CREATE', entity: 'Assessment', entityId: assessment.id, req });
    res.status(201).json(assessment);
  } catch (err) { next(err); }
});

router.put('/:id', authenticate, requireAdmin, async (req, res, next) => {
  try {
    const { title, type, description, totalMarks, passingMarks, submissionDeadline, isActive } = req.body;
    const assessment = await prisma.assessment.update({
      where: { id: parseInt(req.params.id) },
      data: { title, type, description, totalMarks, passingMarks, submissionDeadline: submissionDeadline ? new Date(submissionDeadline) : undefined, isActive },
    });
    res.json(assessment);
  } catch (err) { next(err); }
});

module.exports = router;
