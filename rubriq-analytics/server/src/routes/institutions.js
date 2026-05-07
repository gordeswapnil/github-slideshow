const prisma = require('../db');
const router = require('express').Router();
const { authenticate, requireAdmin } = require('../middleware/auth');
const { logAudit } = require('../utils/audit');


router.get('/', authenticate, async (req, res, next) => {
  try {
    const institutions = await prisma.institution.findMany({
      include: { _count: { select: { departments: true } } },
      orderBy: { name: 'asc' },
    });
    res.json(institutions);
  } catch (err) { next(err); }
});

router.get('/:id', authenticate, async (req, res, next) => {
  try {
    const inst = await prisma.institution.findUnique({
      where: { id: parseInt(req.params.id) },
      include: { departments: { include: { programs: true } } },
    });
    if (!inst) return res.status(404).json({ error: 'Institution not found' });
    res.json(inst);
  } catch (err) { next(err); }
});

router.post('/', authenticate, requireAdmin, async (req, res, next) => {
  try {
    const { name, code, address, website, accredBody } = req.body;
    if (!name || !code) return res.status(400).json({ error: 'Name and code are required' });
    const inst = await prisma.institution.create({ data: { name, code: code.toUpperCase(), address, website, accredBody } });
    await logAudit({ userId: req.user.id, action: 'CREATE', entity: 'Institution', entityId: inst.id, req });
    res.status(201).json(inst);
  } catch (err) { next(err); }
});

router.put('/:id', authenticate, requireAdmin, async (req, res, next) => {
  try {
    const { name, code, address, website, accredBody, isActive } = req.body;
    const inst = await prisma.institution.update({
      where: { id: parseInt(req.params.id) },
      data: { name, code, address, website, accredBody, isActive },
    });
    await logAudit({ userId: req.user.id, action: 'UPDATE', entity: 'Institution', entityId: inst.id, req });
    res.json(inst);
  } catch (err) { next(err); }
});

router.delete('/:id', authenticate, requireAdmin, async (req, res, next) => {
  try {
    await prisma.institution.update({ where: { id: parseInt(req.params.id) }, data: { isActive: false } });
    await logAudit({ userId: req.user.id, action: 'DELETE', entity: 'Institution', entityId: parseInt(req.params.id), req });
    res.json({ message: 'Institution deactivated' });
  } catch (err) { next(err); }
});

module.exports = router;
