const prisma = require('../db');
const router = require('express').Router();
const { authenticate, requireAdmin } = require('../middleware/auth');

router.get('/', authenticate, async (req, res, next) => {
  try {
    const { semesterId } = req.query;
    const where = semesterId ? { semesterId: parseInt(semesterId) } : {};
    const cycles = await prisma.evaluationCycle.findMany({
      where,
      include: { semester: { select: { label: true, academicYear: { select: { label: true } } } }, _count: { select: { assessments: true } } },
      orderBy: [{ semesterId: 'asc' }, { number: 'asc' }],
    });
    res.json(cycles);
  } catch (err) { next(err); }
});

router.post('/', authenticate, requireAdmin, async (req, res, next) => {
  try {
    const { semesterId, number, label, startDate, endDate } = req.body;
    if (!semesterId || !number || !label) return res.status(400).json({ error: 'semesterId, number and label required' });
    const cycle = await prisma.evaluationCycle.create({ data: { semesterId: parseInt(semesterId), number: parseInt(number), label, startDate: startDate ? new Date(startDate) : null, endDate: endDate ? new Date(endDate) : null } });
    res.status(201).json(cycle);
  } catch (err) { next(err); }
});

router.put('/:id/activate', authenticate, requireAdmin, async (req, res, next) => {
  try {
    await prisma.evaluationCycle.updateMany({ data: { isActive: false } });
    const cycle = await prisma.evaluationCycle.update({ where: { id: parseInt(req.params.id) }, data: { isActive: true } });
    res.json(cycle);
  } catch (err) { next(err); }
});

router.put('/:id', authenticate, requireAdmin, async (req, res, next) => {
  try {
    const { label, startDate, endDate, isActive } = req.body;
    const cycle = await prisma.evaluationCycle.update({ where: { id: parseInt(req.params.id) }, data: { label, startDate: startDate ? new Date(startDate) : undefined, endDate: endDate ? new Date(endDate) : undefined, isActive } });
    res.json(cycle);
  } catch (err) { next(err); }
});

module.exports = router;
