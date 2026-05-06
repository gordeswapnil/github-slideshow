const router = require('express').Router();
const { PrismaClient } = require('@prisma/client');
const { authenticate, requireAdmin } = require('../middleware/auth');
const { logAudit } = require('../utils/audit');
const prisma = new PrismaClient();

router.get('/', authenticate, async (req, res, next) => {
  try {
    const { institutionId, collegeId } = req.query;
    const where = {};
    if (institutionId) where.institutionId = parseInt(institutionId);
    if (collegeId) where.collegeId = parseInt(collegeId);
    const departments = await prisma.department.findMany({
      where,
      include: {
        institution: { select: { name: true } },
        college: { select: { name: true } },
        _count: { select: { programs: true } },
      },
      orderBy: { name: 'asc' },
    });
    res.json(departments);
  } catch (err) { next(err); }
});

router.post('/', authenticate, requireAdmin, async (req, res, next) => {
  try {
    const { institutionId, collegeId, name, code, hodName } = req.body;
    if (!institutionId || !name || !code) return res.status(400).json({ error: 'institutionId, name and code are required' });
    const dept = await prisma.department.create({
      data: { institutionId: parseInt(institutionId), collegeId: collegeId ? parseInt(collegeId) : null, name, code: code.toUpperCase(), hodName },
    });
    await logAudit({ userId: req.user.id, action: 'CREATE', entity: 'Department', entityId: dept.id, req });
    res.status(201).json(dept);
  } catch (err) { next(err); }
});

router.put('/:id', authenticate, requireAdmin, async (req, res, next) => {
  try {
    const { name, code, hodName, collegeId, isActive } = req.body;
    const dept = await prisma.department.update({
      where: { id: parseInt(req.params.id) },
      data: { name, code, hodName, isActive, ...(collegeId !== undefined && { collegeId: collegeId ? parseInt(collegeId) : null }) },
    });
    await logAudit({ userId: req.user.id, action: 'UPDATE', entity: 'Department', entityId: dept.id, req });
    res.json(dept);
  } catch (err) { next(err); }
});

router.delete('/:id', authenticate, requireAdmin, async (req, res, next) => {
  try {
    await prisma.department.update({ where: { id: parseInt(req.params.id) }, data: { isActive: false } });
    res.json({ message: 'Department deactivated' });
  } catch (err) { next(err); }
});

module.exports = router;
