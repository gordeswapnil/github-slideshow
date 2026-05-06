const router = require('express').Router();
const { PrismaClient } = require('@prisma/client');
const { authenticate, requireAdmin } = require('../middleware/auth');
const { logAudit } = require('../utils/audit');
const prisma = new PrismaClient();

router.get('/', authenticate, async (req, res, next) => {
  try {
    const { courseId } = req.query;
    const where = courseId ? { courseId: parseInt(courseId) } : {};
    const rubrics = await prisma.rubric.findMany({
      where,
      include: {
        course: { select: { name: true, code: true } },
        assessment: { select: { title: true, course: { select: { name: true, code: true } } } },
        _count: { select: { criteria: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    res.json(rubrics);
  } catch (err) { next(err); }
});

router.get('/:id', authenticate, async (req, res, next) => {
  try {
    const rubric = await prisma.rubric.findUnique({
      where: { id: parseInt(req.params.id) },
      include: {
        assessment: true,
        criteria: {
          include: { levels: { orderBy: { maxMarks: 'desc' } }, outcomeMappings: { include: { co: true, lo: true } } },
          orderBy: { orderIndex: 'asc' },
        },
      },
    });
    if (!rubric) return res.status(404).json({ error: 'Rubric not found' });
    res.json(rubric);
  } catch (err) { next(err); }
});

router.post('/', authenticate, requireAdmin, async (req, res, next) => {
  try {
    const { assessmentId, courseId, title, description, totalMarks } = req.body;
    if (!title) return res.status(400).json({ error: 'title is required' });
    const data = { title, description, totalMarks: parseInt(totalMarks) || 30 };
    if (assessmentId) data.assessmentId = parseInt(assessmentId);
    if (courseId) data.courseId = parseInt(courseId);
    const rubric = await prisma.rubric.create({ data });
    await logAudit({ userId: req.user.id, action: 'CREATE', entity: 'Rubric', entityId: rubric.id, req });
    res.status(201).json(rubric);
  } catch (err) { next(err); }
});

router.put('/:id', authenticate, requireAdmin, async (req, res, next) => {
  try {
    const { title, description, totalMarks, isPublished } = req.body;
    const rubric = await prisma.rubric.update({ where: { id: parseInt(req.params.id) }, data: { title, description, totalMarks, isPublished } });
    res.json(rubric);
  } catch (err) { next(err); }
});

// Criterion CRUD
router.post('/:rubricId/criteria', authenticate, requireAdmin, async (req, res, next) => {
  try {
    const { title, maxMarks, bloomLevel, weightage, orderIndex } = req.body;
    if (!title || !maxMarks) return res.status(400).json({ error: 'title and maxMarks are required' });
    const criterion = await prisma.rubricCriterion.create({
      data: { rubricId: parseInt(req.params.rubricId), title, maxMarks: parseInt(maxMarks), bloomLevel, weightage: parseFloat(weightage) || 1.0, orderIndex: parseInt(orderIndex) || 0 },
    });
    res.status(201).json(criterion);
  } catch (err) { next(err); }
});

router.put('/criteria/:id', authenticate, requireAdmin, async (req, res, next) => {
  try {
    const { title, maxMarks, bloomLevel, weightage, orderIndex } = req.body;
    const criterion = await prisma.rubricCriterion.update({ where: { id: parseInt(req.params.id) }, data: { title, maxMarks, bloomLevel, weightage, orderIndex } });
    res.json(criterion);
  } catch (err) { next(err); }
});

router.delete('/criteria/:id', authenticate, requireAdmin, async (req, res, next) => {
  try {
    await prisma.rubricCriterion.delete({ where: { id: parseInt(req.params.id) } });
    res.json({ message: 'Criterion deleted' });
  } catch (err) { next(err); }
});

// Level CRUD
router.post('/criteria/:criterionId/levels', authenticate, requireAdmin, async (req, res, next) => {
  try {
    const { label, minMarks, maxMarks, descriptor, colorCode } = req.body;
    if (!label || minMarks === undefined || maxMarks === undefined) return res.status(400).json({ error: 'label, minMarks and maxMarks are required' });
    const level = await prisma.rubricLevel.create({ data: { criterionId: parseInt(req.params.criterionId), label, minMarks: parseFloat(minMarks), maxMarks: parseFloat(maxMarks), descriptor, colorCode } });
    res.status(201).json(level);
  } catch (err) { next(err); }
});

router.put('/levels/:id', authenticate, requireAdmin, async (req, res, next) => {
  try {
    const { label, minMarks, maxMarks, descriptor, colorCode } = req.body;
    const level = await prisma.rubricLevel.update({ where: { id: parseInt(req.params.id) }, data: { label, minMarks, maxMarks, descriptor, colorCode } });
    res.json(level);
  } catch (err) { next(err); }
});

router.delete('/levels/:id', authenticate, requireAdmin, async (req, res, next) => {
  try {
    await prisma.rubricLevel.delete({ where: { id: parseInt(req.params.id) } });
    res.json({ message: 'Level deleted' });
  } catch (err) { next(err); }
});

module.exports = router;
