const router = require('express').Router();
const { PrismaClient } = require('@prisma/client');
const { authenticate, requireAdmin } = require('../middleware/auth');
const bcrypt = require('bcryptjs');
const { logAudit } = require('../utils/audit');
const { sendWelcomeEmail } = require('../utils/email');
const prisma = new PrismaClient();

function generatePassword() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  const special = '@#$!';
  let pass = '';
  for (let i = 0; i < 8; i++) pass += chars[Math.floor(Math.random() * chars.length)];
  pass += special[Math.floor(Math.random() * special.length)];
  pass += Math.floor(Math.random() * 90 + 10);
  return pass;
}

router.get('/', authenticate, requireAdmin, async (req, res, next) => {
  try {
    const users = await prisma.user.findMany({
      include: { role: true },
      orderBy: { createdAt: 'desc' },
    });
    res.json(users.map(({ passwordHash, ...u }) => u));
  } catch (err) { next(err); }
});

router.post('/', authenticate, requireAdmin, async (req, res, next) => {
  try {
    const { email, firstName, lastName, roleId } = req.body;
    if (!email || !firstName || !lastName || !roleId) return res.status(400).json({ error: 'All fields are required' });

    const role = await prisma.role.findUnique({ where: { id: parseInt(roleId) } });
    if (!role) return res.status(400).json({ error: 'Invalid role' });

    const plainPassword = generatePassword();
    const passwordHash = await bcrypt.hash(plainPassword, 10);

    const user = await prisma.user.create({
      data: { email: email.toLowerCase().trim(), passwordHash, firstName, lastName, roleId: parseInt(roleId) },
      include: { role: true },
    });

    try {
      await sendWelcomeEmail({ firstName, lastName, email, password: plainPassword, role: role.name });
    } catch (emailErr) {
      console.error('Email send failed:', emailErr.message);
    }

    await logAudit({ userId: req.user.id, action: 'CREATE_USER', entity: 'User', entityId: user.id, req });
    const { passwordHash: _, ...userOut } = user;
    res.status(201).json({ ...userOut, emailSent: true });
  } catch (err) { next(err); }
});

router.put('/:id', authenticate, requireAdmin, async (req, res, next) => {
  try {
    const { firstName, lastName, roleId, isActive } = req.body;
    const user = await prisma.user.update({
      where: { id: parseInt(req.params.id) },
      data: { firstName, lastName, roleId: roleId ? parseInt(roleId) : undefined, isActive },
      include: { role: true },
    });
    await logAudit({ userId: req.user.id, action: 'UPDATE_USER', entity: 'User', entityId: user.id, req });
    const { passwordHash, ...userOut } = user;
    res.json(userOut);
  } catch (err) { next(err); }
});

router.post('/:id/reset-password', authenticate, requireAdmin, async (req, res, next) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: parseInt(req.params.id) }, include: { role: true } });
    if (!user) return res.status(404).json({ error: 'User not found' });

    const plainPassword = generatePassword();
    const passwordHash = await bcrypt.hash(plainPassword, 10);
    await prisma.user.update({ where: { id: user.id }, data: { passwordHash } });

    try {
      await sendWelcomeEmail({ firstName: user.firstName, lastName: user.lastName, email: user.email, password: plainPassword, role: user.role.name });
    } catch (emailErr) {
      console.error('Email send failed:', emailErr.message);
    }

    await logAudit({ userId: req.user.id, action: 'RESET_PASSWORD', entity: 'User', entityId: user.id, req });
    res.json({ message: 'Password reset and emailed successfully' });
  } catch (err) { next(err); }
});

router.get('/roles', authenticate, async (req, res, next) => {
  try {
    const roles = await prisma.role.findMany({ orderBy: { name: 'asc' } });
    res.json(roles);
  } catch (err) { next(err); }
});

module.exports = router;
