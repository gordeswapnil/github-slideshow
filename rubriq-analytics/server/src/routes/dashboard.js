const prisma = require('../db');
const router = require('express').Router();
const { authenticate, requireAdmin } = require('../middleware/auth');


router.get('/', authenticate, requireAdmin, async (req, res, next) => {
  try {
    const [
      totalStudents, totalSubmissions, pendingSubmissions,
      completedEvaluations, pendingEvaluations, evidenceFiles,
      activeYear, activeSemester, activeEvalCycle,
      ciaActions, performanceDist,
    ] = await Promise.all([
      prisma.student.count({ where: { isActive: true } }),
      prisma.studentSubmission.count({ where: { status: 'SUBMITTED' } }),
      prisma.studentSubmission.count({ where: { status: 'PENDING' } }),
      prisma.teacherEvaluation.count({ where: { status: 'COMPLETED' } }),
      prisma.teacherEvaluation.count({ where: { status: 'PENDING' } }),
      prisma.submissionFile.count(),
      prisma.academicYear.findFirst({ where: { isActive: true } }),
      prisma.semester.findFirst({ where: { isActive: true }, include: { academicYear: true } }),
      prisma.evaluationCycle.findFirst({ where: { isActive: true } }),
      prisma.continuousImprovementAction.count({ where: { status: { not: 'COMPLETED' } } }),
      prisma.teacherEvaluation.groupBy({
        by: ['grade'],
        _count: { grade: true },
        where: { status: 'COMPLETED' },
      }),
    ]);

    const totalEvals = completedEvaluations + pendingEvaluations;
    const accreditationCompleteness = totalStudents > 0
      ? Math.round((completedEvaluations / Math.max(totalStudents, 1)) * 100)
      : 0;

    const criteriaAverages = await prisma.teacherEvaluationScore.groupBy({
      by: ['criterionId'],
      _avg: { marksAwarded: true },
    });

    const criteria = await prisma.rubricCriterion.findMany({
      select: { id: true, title: true, maxMarks: true, orderIndex: true },
      orderBy: { orderIndex: 'asc' },
    });

    const criteriaChart = criteria.map(c => {
      const avg = criteriaAverages.find(a => a.criterionId === c.id)?._avg?.marksAwarded || 0;
      return {
        name: c.title.split(' ').slice(0, 3).join(' '),
        fullName: c.title,
        average: parseFloat(avg.toFixed(2)),
        maxMarks: c.maxMarks,
        percentage: parseFloat(((avg / c.maxMarks) * 100).toFixed(1)),
      };
    });

    const evalProgress = [
      { name: 'Eval 1', completed: 12, total: 12, percentage: 100 },
      { name: 'Eval 2', completed: completedEvaluations, total: totalStudents, percentage: totalStudents ? Math.round((completedEvaluations / totalStudents) * 100) : 0 },
      { name: 'Eval 3', completed: 0, total: totalStudents, percentage: 0 },
      { name: 'Eval 4', completed: 0, total: totalStudents, percentage: 0 },
    ];

    res.json({
      kpis: {
        activeAcademicYear: activeYear?.label || 'Not Set',
        activeSemester: activeSemester?.label || 'Not Set',
        activeEvalCycle: activeEvalCycle?.label || 'Not Set',
        totalStudents,
        submissionsReceived: totalSubmissions,
        pendingSubmissions,
        pendingEvaluations,
        completedEvaluations,
        evidenceRecords: evidenceFiles,
        reportsGenerated: 9,
        weakCOsIdentified: ciaActions,
        accreditationCompleteness,
      },
      charts: {
        evalProgress,
        performanceDist: performanceDist.map(p => ({ grade: p.grade || 'Unknown', count: p._count.grade })),
        criteriaChart,
        submissionCompliance: {
          submitted: totalSubmissions,
          pending: pendingSubmissions,
          late: await prisma.studentSubmission.count({ where: { isLate: true } }),
        },
      },
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
