const router = require('express').Router();
const { PrismaClient } = require('@prisma/client');
const { authenticate, requireAdmin } = require('../middleware/auth');
const { logAudit } = require('../utils/audit');
const prisma = new PrismaClient();

router.get('/', authenticate, async (req, res, next) => {
  try {
    const actions = await prisma.continuousImprovementAction.findMany({ orderBy: { createdAt: 'desc' } });
    const stats = {
      total: actions.length,
      weaknesses: actions.filter(a => a.status !== 'COMPLETED').length,
      planned: actions.filter(a => a.status === 'PLANNED').length,
      inProgress: actions.filter(a => a.status === 'IN_PROGRESS').length,
      completed: actions.filter(a => a.status === 'COMPLETED').length,
      reviewed: actions.filter(a => a.status === 'REVIEWED').length,
    };
    res.json({ actions, stats });
  } catch (err) { next(err); }
});

router.post('/', authenticate, requireAdmin, async (req, res, next) => {
  try {
    const { weakArea, evidence, proposedAction, responsibility, timelineStart, timelineEnd } = req.body;
    if (!weakArea || !proposedAction) return res.status(400).json({ error: 'weakArea and proposedAction are required' });
    const action = await prisma.continuousImprovementAction.create({
      data: { weakArea, evidence, proposedAction, responsibility, timelineStart: timelineStart ? new Date(timelineStart) : null, timelineEnd: timelineEnd ? new Date(timelineEnd) : null },
    });
    await logAudit({ userId: req.user.id, action: 'CREATE', entity: 'CIAction', entityId: action.id, req });
    res.status(201).json(action);
  } catch (err) { next(err); }
});

router.put('/:id', authenticate, requireAdmin, async (req, res, next) => {
  try {
    const { weakArea, evidence, proposedAction, responsibility, timelineStart, timelineEnd, status, outcomeNote } = req.body;
    const action = await prisma.continuousImprovementAction.update({
      where: { id: parseInt(req.params.id) },
      data: { weakArea, evidence, proposedAction, responsibility, timelineStart: timelineStart ? new Date(timelineStart) : undefined, timelineEnd: timelineEnd ? new Date(timelineEnd) : undefined, status, outcomeNote },
    });
    res.json(action);
  } catch (err) { next(err); }
});

router.delete('/:id', authenticate, requireAdmin, async (req, res, next) => {
  try {
    await prisma.continuousImprovementAction.delete({ where: { id: parseInt(req.params.id) } });
    res.json({ message: 'Action deleted' });
  } catch (err) { next(err); }
});

module.exports = router;
