const prisma = require('../db');
const router = require('express').Router();
const { authenticate, requireAdmin } = require('../middleware/auth');
const { logAudit } = require('../utils/audit');
const { hardDeleteCourse } = require('./courses');

router.get('/', authenticate, async (req, res, next) => {
  try {
    const { departmentId } = req.query;
    const where = departmentId ? { departmentId: parseInt(departmentId) } : {};
    const programs = await prisma.program.findMany({
      where,
      include: { department: { select: { name: true } }, _count: { select: { courses: true, students: true } } },
      orderBy: { name: 'asc' },
    });
    res.json(programs);
  } catch (err) { next(err); }
});

router.get('/:id', authenticate, async (req, res, next) => {
  try {
    const program = await prisma.program.findUnique({
      where: { id: parseInt(req.params.id) },
      include: { courses: true, programOutcomes: true, programSpecificOutcomes: true },
    });
    if (!program) return res.status(404).json({ error: 'Program not found' });
    res.json(program);
  } catch (err) { next(err); }
});

router.post('/', authenticate, requireAdmin, async (req, res, next) => {
  try {
    const { departmentId, name, code, duration, level } = req.body;
    if (!departmentId || !name || !code) return res.status(400).json({ error: 'departmentId, name and code are required' });
    const program = await prisma.program.create({ data: { departmentId: parseInt(departmentId), name, code: code.toUpperCase(), duration: parseInt(duration) || 2, level } });
    await logAudit({ userId: req.user.id, action: 'CREATE', entity: 'Program', entityId: program.id, req });
    res.status(201).json(program);
  } catch (err) { next(err); }
});

router.put('/:id', authenticate, requireAdmin, async (req, res, next) => {
  try {
    const { name, code, duration, level, isActive } = req.body;
    const program = await prisma.program.update({ where: { id: parseInt(req.params.id) }, data: { name, code, duration, level, isActive } });
    res.json(program);
  } catch (err) { next(err); }
});

router.delete('/:id', authenticate, requireAdmin, async (req, res, next) => {
  try {
    const programId = parseInt(req.params.id);
    await prisma.$transaction(async (tx) => {
      // Delete all courses (and their full data chain) first
      const courses = await tx.course.findMany({ where: { programId }, select: { id: true } });
      for (const c of courses) await hardDeleteCourse(tx, c.id);

      // Delete students (submissions already gone via course deletion)
      await tx.student.deleteMany({ where: { programId } });

      // Delete PO/PSO mappings
      const pos = await tx.programOutcome.findMany({ where: { programId }, select: { id: true } });
      const poIds = pos.map(p => p.id);
      if (poIds.length) {
        await tx.cOPOMapping.deleteMany({ where: { poId: { in: poIds } } });
        await tx.programOutcome.deleteMany({ where: { programId } });
      }
      const psos = await tx.programSpecificOutcome.findMany({ where: { programId }, select: { id: true } });
      const psoIds = psos.map(p => p.id);
      if (psoIds.length) {
        await tx.cOPOMapping.deleteMany({ where: { psoId: { in: psoIds } } });
        await tx.programSpecificOutcome.deleteMany({ where: { programId } });
      }

      await tx.program.delete({ where: { id: programId } });
    }, { timeout: 60000 });
    await logAudit({ userId: req.user.id, action: 'DELETE', entity: 'Program', entityId: programId, req });
    res.json({ message: 'Program and all related data permanently deleted.' });
  } catch (err) { next(err); }
});

module.exports = router;
