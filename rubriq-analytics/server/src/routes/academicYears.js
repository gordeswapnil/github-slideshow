const prisma = require('../db');
const router = require('express').Router();
const { authenticate, requireAdmin } = require('../middleware/auth');
const { logAudit } = require('../utils/audit');

router.get('/', authenticate, async (req, res, next) => {
  try {
    const years = await prisma.academicYear.findMany({
      include: { _count: { select: { semesters: true } } },
      orderBy: { startYear: 'desc' },
    });
    res.json(years);
  } catch (err) { next(err); }
});

router.post('/', authenticate, requireAdmin, async (req, res, next) => {
  try {
    const { label, startYear, endYear } = req.body;
    if (!label || !startYear || !endYear) return res.status(400).json({ error: 'label, startYear and endYear are required' });
    const year = await prisma.academicYear.create({ data: { label, startYear: parseInt(startYear), endYear: parseInt(endYear) } });
    await logAudit({ userId: req.user.id, action: 'CREATE', entity: 'AcademicYear', entityId: year.id, req });
    res.status(201).json(year);
  } catch (err) { next(err); }
});

router.put('/:id/activate', authenticate, requireAdmin, async (req, res, next) => {
  try {
    await prisma.academicYear.updateMany({ data: { isActive: false } });
    const year = await prisma.academicYear.update({ where: { id: parseInt(req.params.id) }, data: { isActive: true } });
    await logAudit({ userId: req.user.id, action: 'ACTIVATE', entity: 'AcademicYear', entityId: year.id, req });
    res.json(year);
  } catch (err) { next(err); }
});

router.put('/:id', authenticate, requireAdmin, async (req, res, next) => {
  try {
    const { label, startYear, endYear } = req.body;
    const year = await prisma.academicYear.update({ where: { id: parseInt(req.params.id) }, data: { label, startYear, endYear } });
    res.json(year);
  } catch (err) { next(err); }
});

module.exports = router;
