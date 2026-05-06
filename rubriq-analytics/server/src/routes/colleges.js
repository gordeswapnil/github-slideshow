const router = require('express').Router();
const { PrismaClient } = require('@prisma/client');
const { authenticate, requireAdmin } = require('../middleware/auth');
const { logAudit } = require('../utils/audit');
const prisma = new PrismaClient();

router.get('/', authenticate, async (req, res, next) => {
  try {
    const { institutionId } = req.query;
    const where = { isActive: true };
    if (institutionId) where.institutionId = parseInt(institutionId);
    const colleges = await prisma.college.findMany({
      where,
      include: {
        institution: { select: { name: true } },
        _count: { select: { departments: true } },
      },
      orderBy: { name: 'asc' },
    });
    res.json(colleges);
  } catch (err) { next(err); }
});

router.post('/', authenticate, requireAdmin, async (req, res, next) => {
  try {
    const { institutionId, name, code, principalName } = req.body;
    if (!institutionId || !name || !code) return res.status(400).json({ error: 'institutionId, name and code are required' });
    const college = await prisma.college.create({
      data: { institutionId: parseInt(institutionId), name, code: code.toUpperCase(), principalName },
    });
    await logAudit({ userId: req.user.id, action: 'CREATE', entity: 'College', entityId: college.id, req });
    res.status(201).json(college);
  } catch (err) { next(err); }
});

router.put('/:id', authenticate, requireAdmin, async (req, res, next) => {
  try {
    const { name, code, principalName, isActive } = req.body;
    const college = await prisma.college.update({
      where: { id: parseInt(req.params.id) },
      data: { name, code, principalName, isActive },
    });
    await logAudit({ userId: req.user.id, action: 'UPDATE', entity: 'College', entityId: college.id, req });
    res.json(college);
  } catch (err) { next(err); }
});

module.exports = router;
