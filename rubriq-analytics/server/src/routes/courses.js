const prisma = require('../db');
const router = require('express').Router();
const { authenticate, requireAdmin } = require('../middleware/auth');
const { logAudit } = require('../utils/audit');

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
    await prisma.course.update({ where: { id: parseInt(req.params.id) }, data: { isActive: false } });
    res.json({ message: 'Course deactivated' });
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
