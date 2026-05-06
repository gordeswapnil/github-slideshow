const router = require('express').Router();
const { PrismaClient } = require('@prisma/client');
const { authenticate, requireAdmin } = require('../middleware/auth');
const { logAudit } = require('../utils/audit');
const prisma = new PrismaClient();

router.get('/archives', authenticate, async (req, res, next) => {
  try {
    const archives = await prisma.evidenceArchive.findMany({
      include: { generatedBy: { select: { firstName: true, lastName: true } } },
      orderBy: { createdAt: 'desc' },
    });
    res.json(archives);
  } catch (err) { next(err); }
});

router.post('/generate', authenticate, requireAdmin, async (req, res, next) => {
  try {
    const { title, archiveType, components, description } = req.body;
    if (!title || !components) return res.status(400).json({ error: 'title and components are required' });

    const archive = await prisma.evidenceArchive.create({
      data: {
        title,
        description,
        archiveType: archiveType || 'ACCREDITATION',
        components,
        generatedById: req.user.id,
        status: 'GENERATED',
      },
    });

    await logAudit({ userId: req.user.id, action: 'GENERATE_EVIDENCE', entity: 'EvidenceArchive', entityId: archive.id, details: { components }, req });
    res.status(201).json({ archive, message: 'Evidence pack generated successfully' });
  } catch (err) { next(err); }
});

router.delete('/archives/:id', authenticate, requireAdmin, async (req, res, next) => {
  try {
    await prisma.evidenceArchive.delete({ where: { id: parseInt(req.params.id) } });
    res.json({ message: 'Archive deleted' });
  } catch (err) { next(err); }
});

router.get('/checklist', authenticate, async (req, res, next) => {
  try {
    const [rubrics, submissions, evaluations, students] = await Promise.all([
      prisma.rubric.count({ where: { isPublished: true } }),
      prisma.submissionFile.count(),
      prisma.teacherEvaluation.count({ where: { status: 'COMPLETED' } }),
      prisma.student.count({ where: { isActive: true } }),
    ]);

    const checklist = [
      { item: 'Rubric Matrix', status: rubrics > 0 ? 'COMPLETE' : 'MISSING', count: rubrics, formats: ['PDF', 'XLSX'] },
      { item: 'Student Uploaded Files', status: submissions > 0 ? 'COMPLETE' : 'MISSING', count: submissions, formats: ['ZIP'] },
      { item: 'Teacher Evaluation Sheets', status: evaluations > 0 ? 'COMPLETE' : 'MISSING', count: evaluations, formats: ['PDF'] },
      { item: 'Criterion-wise Marks', status: evaluations > 0 ? 'COMPLETE' : 'MISSING', count: evaluations, formats: ['XLSX'] },
      { item: 'Mapping Confirmation Sheet', status: rubrics > 0 ? 'COMPLETE' : 'PENDING', count: rubrics, formats: ['PDF'] },
      { item: 'Validation Summary', status: 'COMPLETE', count: 1, formats: ['PDF'] },
      { item: 'Evaluation-wise Report', status: evaluations > 0 ? 'COMPLETE' : 'PENDING', count: evaluations, formats: ['PDF'] },
      { item: 'Semester Report', status: evaluations > 0 ? 'COMPLETE' : 'PENDING', count: 1, formats: ['PDF'] },
      { item: 'Annual Report', status: 'PENDING', count: 0, formats: ['PDF'] },
      { item: 'CO Attainment Report', status: evaluations > 0 ? 'COMPLETE' : 'PENDING', count: 1, formats: ['PDF'] },
      { item: 'Bloom\'s Taxonomy Report', status: evaluations > 0 ? 'COMPLETE' : 'PENDING', count: 1, formats: ['PDF'] },
      { item: 'Submission Compliance Report', status: students > 0 ? 'COMPLETE' : 'PENDING', count: 1, formats: ['PDF'] },
      { item: 'Continuous Improvement Report', status: 'COMPLETE', count: 1, formats: ['PDF'] },
      { item: 'Audit Log', status: 'COMPLETE', count: 1, formats: ['XLSX'] },
    ];

    const completeness = Math.round((checklist.filter(c => c.status === 'COMPLETE').length / checklist.length) * 100);
    res.json({ checklist, completeness });
  } catch (err) { next(err); }
});

module.exports = router;
