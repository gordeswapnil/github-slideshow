const prisma = require('../db');
const router = require('express').Router();
const { authenticate, requireAdmin } = require('../middleware/auth');
const { logAudit } = require('../utils/audit');

router.get('/', authenticate, async (req, res, next) => {
  try {
    const settings = await prisma.setting.findMany({ orderBy: [{ group: 'asc' }, { key: 'asc' }] });
    const grouped = settings.reduce((acc, s) => {
      if (!acc[s.group]) acc[s.group] = [];
      acc[s.group].push(s);
      return acc;
    }, {});
    res.json(grouped);
  } catch (err) { next(err); }
});

router.put('/', authenticate, requireAdmin, async (req, res, next) => {
  try {
    const { settings } = req.body;
    for (const { key, value } of settings) {
      await prisma.setting.upsert({ where: { key }, update: { value }, create: { key, value, group: 'general', label: key, type: 'string' } });
    }
    await logAudit({ userId: req.user.id, action: 'UPDATE_SETTINGS', entity: 'Settings', req });
    res.json({ message: 'Settings updated' });
  } catch (err) { next(err); }
});

module.exports = router;
