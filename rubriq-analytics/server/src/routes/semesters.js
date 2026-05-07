const prisma = require('../db');
const router = require('express').Router();
const { authenticate, requireAdmin } = require('../middleware/auth');
const { logAudit } = require('../utils/audit');

router.get('/', authenticate, async (req, res, next) => {
  try {
    const { academicYearId } = req.query;
    const where = academicYearId ? { academicYearId: parseInt(academicYearId) } : {};
    const semesters = await prisma.semester.findMany({
      where,
      include: { academicYear: { select: { label: true } }, _count: { select: { evaluationCycles: true, divisions: true } } },
      orderBy: [{ academicYearId: 'desc' }, { number: 'asc' }],
    });
    res.json(semesters);
  } catch (err) { next(err); }
});

router.post('/', authenticate, requireAdmin, async (req, res, next) => {
  try {
    const { academicYearId, number, label, startDate, endDate } = req.body;
    if (!academicYearId || !number || !label) return res.status(400).json({ error: 'academicYearId, number and label are required' });
    const sem = await prisma.semester.create({ data: { academicYearId: parseInt(academicYearId), number: parseInt(number), label, startDate: startDate ? new Date(startDate) : null, endDate: endDate ? new Date(endDate) : null } });
    res.status(201).json(sem);
  } catch (err) { next(err); }
});

router.put('/:id/activate', authenticate, requireAdmin, async (req, res, next) => {
  try {
    await prisma.semester.updateMany({ data: { isActive: false } });
    const sem = await prisma.semester.update({ where: { id: parseInt(req.params.id) }, data: { isActive: true } });
    res.json(sem);
  } catch (err) { next(err); }
});

router.put('/:id', authenticate, requireAdmin, async (req, res, next) => {
  try {
    const { label, startDate, endDate, isActive } = req.body;
    const sem = await prisma.semester.update({ where: { id: parseInt(req.params.id) }, data: { label, startDate: startDate ? new Date(startDate) : undefined, endDate: endDate ? new Date(endDate) : undefined, isActive } });
    res.json(sem);
  } catch (err) { next(err); }
});

module.exports = router;
