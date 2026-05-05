const router = require('express').Router();
const { PrismaClient } = require('@prisma/client');
const { authenticate, requireAdmin } = require('../middleware/auth');
const bcrypt = require('bcryptjs');
const { logAudit } = require('../utils/audit');
const prisma = new PrismaClient();

router.get('/', authenticate, requireAdmin, async (req, res, next) => {
  try {
    const users = await prisma.user.findMany({
      select: { id: true, email: true, firstName: true, lastName: true, role: true, isActive: true, lastLogin: true, createdAt: true },
      include: { role: true },
      orderBy: { createdAt: 'desc' },
    });
    res.json(users);
  } catch (err) { next(err); }
});

router.post('/', authenticate, requireAdmin, async (req, res, next) => {
  try {
    const { email, password, firstName, lastName, roleId } = req.body;
    if (!email || !password || !firstName || !lastName || !roleId) return res.status(400).json({ error: 'All fields are required' });
    const passwordHash = await bcrypt.hash(password, 10);
    const user = await prisma.user.create({ data: { email: email.toLowerCase().trim(), passwordHash, firstName, lastName, roleId: parseInt(roleId) } });
    await logAudit({ userId: req.user.id, action: 'CREATE_USER', entity: 'User', entityId: user.id, req });
    const { passwordHash: _, ...userOut } = user;
    res.status(201).json(userOut);
  } catch (err) { next(err); }
});

router.put('/:id', authenticate, requireAdmin, async (req, res, next) => {
  try {
    const { firstName, lastName, roleId, isActive } = req.body;
    const user = await prisma.user.update({
      where: { id: parseInt(req.params.id) },
      data: { firstName, lastName, roleId: roleId ? parseInt(roleId) : undefined, isActive },
      select: { id: true, email: true, firstName: true, lastName: true, isActive: true },
    });
    res.json(user);
  } catch (err) { next(err); }
});

router.get('/roles', authenticate, async (req, res, next) => {
  try {
    const roles = await prisma.role.findMany({ orderBy: { name: 'asc' } });
    res.json(roles);
  } catch (err) { next(err); }
});

module.exports = router;
