const router = require('express').Router();
const { PrismaClient } = require('@prisma/client');
const { authenticate, requireAdmin } = require('../middleware/auth');
const prisma = new PrismaClient();

router.get('/', authenticate, async (req, res, next) => {
  try {
    const { semesterId } = req.query;
    const where = semesterId ? { semesterId: parseInt(semesterId) } : {};
    const divisions = await prisma.division.findMany({
      where,
      include: { _count: { select: { students: true } } },
      orderBy: { name: 'asc' },
    });
    res.json(divisions);
  } catch (err) { next(err); }
});

router.post('/', authenticate, requireAdmin, async (req, res, next) => {
  try {
    const { semesterId, name, capacity } = req.body;
    if (!semesterId || !name) return res.status(400).json({ error: 'semesterId and name are required' });
    const div = await prisma.division.create({ data: { semesterId: parseInt(semesterId), name, capacity: parseInt(capacity) || 60 } });
    res.status(201).json(div);
  } catch (err) { next(err); }
});

router.put('/:id', authenticate, requireAdmin, async (req, res, next) => {
  try {
    const { name, capacity, isActive } = req.body;
    const div = await prisma.division.update({ where: { id: parseInt(req.params.id) }, data: { name, capacity, isActive } });
    res.json(div);
  } catch (err) { next(err); }
});

module.exports = router;
