const router = require('express').Router();
const { PrismaClient } = require('@prisma/client');
const { authenticate, requireAdmin } = require('../middleware/auth');
const { logAudit } = require('../utils/audit');
const prisma = new PrismaClient();

router.get('/', authenticate, async (req, res, next) => {
  try {
    const { semesterId, facultyId, courseId } = req.query;
    const where = { isActive: true };
    if (semesterId) where.semesterId = parseInt(semesterId);
    if (facultyId) where.facultyId = parseInt(facultyId);
    if (courseId) where.courseId = parseInt(courseId);

    const assignments = await prisma.facultyCourseAssignment.findMany({
      where,
      include: {
        faculty: { select: { id: true, firstName: true, lastName: true, email: true } },
        course: { select: { id: true, name: true, code: true, program: { select: { name: true } } } },
        semester: { select: { id: true, label: true } },
        academicYear: { select: { id: true, label: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    res.json(assignments);
  } catch (err) { next(err); }
});

// Get courses assigned to a specific faculty (used to filter dashboards)
router.get('/my-courses', authenticate, async (req, res, next) => {
  try {
    const assignments = await prisma.facultyCourseAssignment.findMany({
      where: { facultyId: req.user.id, isActive: true },
      include: {
        course: {
          include: {
            program: { select: { id: true, name: true, code: true } },
          },
        },
        semester: { select: { id: true, label: true, isActive: true } },
      },
    });
    const courses = assignments.map(a => ({ ...a.course, semesterId: a.semesterId, semesterLabel: a.semester.label }));
    res.json(courses);
  } catch (err) { next(err); }
});

router.post('/', authenticate, requireAdmin, async (req, res, next) => {
  try {
    const { facultyId, courseId, semesterId, academicYearId } = req.body;
    if (!facultyId || !courseId || !semesterId || !academicYearId)
      return res.status(400).json({ error: 'facultyId, courseId, semesterId and academicYearId are required' });

    const assignment = await prisma.facultyCourseAssignment.upsert({
      where: { facultyId_courseId_semesterId: { facultyId: parseInt(facultyId), courseId: parseInt(courseId), semesterId: parseInt(semesterId) } },
      create: { facultyId: parseInt(facultyId), courseId: parseInt(courseId), semesterId: parseInt(semesterId), academicYearId: parseInt(academicYearId) },
      update: { isActive: true, academicYearId: parseInt(academicYearId) },
    });
    await logAudit({ userId: req.user.id, action: 'CREATE', entity: 'FacultyCourseAssignment', entityId: assignment.id, req });
    res.status(201).json(assignment);
  } catch (err) { next(err); }
});

router.delete('/:id', authenticate, requireAdmin, async (req, res, next) => {
  try {
    await prisma.facultyCourseAssignment.update({ where: { id: parseInt(req.params.id) }, data: { isActive: false } });
    res.json({ message: 'Assignment removed' });
  } catch (err) { next(err); }
});

module.exports = router;
