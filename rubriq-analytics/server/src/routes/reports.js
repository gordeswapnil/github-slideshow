const router = require('express').Router();
const { PrismaClient } = require('@prisma/client');
const { authenticate, requireAdmin } = require('../middleware/auth');
const prisma = new PrismaClient();

router.get('/analysis', authenticate, async (req, res, next) => {
  try {
    const { assessmentId } = req.query;
    if (!assessmentId) return res.status(400).json({ error: 'assessmentId is required' });

    const assessment = await prisma.assessment.findUnique({
      where: { id: parseInt(assessmentId) },
      include: {
        rubric: { include: { criteria: { orderBy: { orderIndex: 'asc' } } } },
        course: true,
        evaluationCycle: true,
      },
    });
    if (!assessment) return res.status(404).json({ error: 'Assessment not found' });

    const evaluations = await prisma.teacherEvaluation.findMany({
      where: { submission: { assessmentId: parseInt(assessmentId) }, status: 'COMPLETED' },
      include: {
        scores: { include: { criterion: true } },
        student: { select: { rollNumber: true, firstName: true, lastName: true, division: { select: { name: true } } } },
      },
    });

    const total = evaluations.length;
    const performanceDist = { Excellent: 0, Good: 0, Satisfactory: 0, 'Needs Improvement': 0 };
    let totalScore = 0;

    evaluations.forEach(e => {
      totalScore += e.totalMarks || 0;
      if (e.grade) performanceDist[e.grade] = (performanceDist[e.grade] || 0) + 1;
    });

    const criteriaStats = (assessment.rubric?.criteria || []).map(criterion => {
      const scores = evaluations.flatMap(e => e.scores.filter(s => s.criterionId === criterion.id).map(s => s.marksAwarded));
      const avg = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;
      const attainment = (avg / criterion.maxMarks) * 100;
      return {
        id: criterion.id,
        title: criterion.title,
        maxMarks: criterion.maxMarks,
        average: parseFloat(avg.toFixed(2)),
        attainment: parseFloat(attainment.toFixed(1)),
        weak: attainment < 60,
      };
    });

    const studentReports = evaluations.map(e => ({
      student: e.student,
      totalMarks: e.totalMarks,
      grade: e.grade,
      scores: e.scores.map(s => ({ criterionId: s.criterionId, criterion: s.criterion.title, marks: s.marksAwarded, levelLabel: s.levelLabel })),
    })).sort((a, b) => (b.totalMarks || 0) - (a.totalMarks || 0));

    res.json({
      assessment,
      summary: {
        totalStudents: total,
        classAverage: total ? parseFloat((totalScore / total).toFixed(2)) : 0,
        highestScore: total ? Math.max(...evaluations.map(e => e.totalMarks || 0)) : 0,
        lowestScore: total ? Math.min(...evaluations.map(e => e.totalMarks || 0)) : 0,
        performanceDist,
        passPercentage: total ? parseFloat(((evaluations.filter(e => (e.totalMarks || 0) >= assessment.passingMarks).length / total) * 100).toFixed(1)) : 0,
      },
      criteriaStats,
      studentReports,
    });
  } catch (err) { next(err); }
});

router.get('/submission-compliance', authenticate, async (req, res, next) => {
  try {
    const { assessmentId } = req.query;
    if (!assessmentId) return res.status(400).json({ error: 'assessmentId is required' });

    const assessment = await prisma.assessment.findUnique({ where: { id: parseInt(assessmentId) } });
    const totalStudents = await prisma.student.count({ where: { isActive: true } });
    const submissions = await prisma.studentSubmission.findMany({
      where: { assessmentId: parseInt(assessmentId) },
      include: {
        student: { select: { rollNumber: true, firstName: true, lastName: true, division: { select: { name: true } } } },
        evaluation: { select: { status: true, totalMarks: true } },
      },
    });

    const submitted = submissions.filter(s => s.status === 'SUBMITTED').length;
    const notSubmitted = totalStudents - submitted;
    const late = submissions.filter(s => s.isLate).length;
    const evaluated = submissions.filter(s => s.evaluation?.status === 'COMPLETED').length;

    res.json({
      totalStudents,
      submitted,
      notSubmitted,
      late,
      evaluated,
      pendingEvaluation: submitted - evaluated,
      compliancePercentage: totalStudents ? parseFloat(((submitted / totalStudents) * 100).toFixed(1)) : 0,
      students: submissions.map(s => ({
        ...s.student,
        submissionStatus: s.status,
        submittedAt: s.submittedAt,
        isLate: s.isLate,
        evaluationStatus: s.evaluation?.status || 'N/A',
        totalMarks: s.evaluation?.totalMarks || null,
      })),
    });
  } catch (err) { next(err); }
});

router.get('/student-progress/:studentId', authenticate, async (req, res, next) => {
  try {
    const student = await prisma.student.findUnique({
      where: { id: parseInt(req.params.studentId) },
      include: {
        program: true,
        submissions: {
          include: {
            assessment: { include: { evaluationCycle: true, rubric: { include: { criteria: true } } } },
            evaluation: { include: { scores: true } },
          },
          orderBy: { assessment: { evaluationCycle: { number: 'asc' } } },
        },
      },
    });
    if (!student) return res.status(404).json({ error: 'Student not found' });

    const progressData = student.submissions.map(sub => ({
      evaluation: sub.assessment.evaluationCycle.label,
      evalNumber: sub.assessment.evaluationCycle.number,
      assessment: sub.assessment.title,
      totalMarks: sub.evaluation?.totalMarks || 0,
      maxMarks: sub.assessment.rubric?.totalMarks || 30,
      grade: sub.evaluation?.grade || 'Pending',
      percentage: sub.evaluation && sub.assessment.rubric ? parseFloat(((sub.evaluation.totalMarks / sub.assessment.rubric.totalMarks) * 100).toFixed(1)) : 0,
      criteriaScores: sub.evaluation?.scores.map(s => ({ criterionId: s.criterionId, marks: s.marksAwarded })) || [],
    }));

    res.json({ student, progressData });
  } catch (err) { next(err); }
});

module.exports = router;
