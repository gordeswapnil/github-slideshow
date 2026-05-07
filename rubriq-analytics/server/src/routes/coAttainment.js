const prisma = require('../db');
const router = require('express').Router();
const { authenticate } = require('../middleware/auth');

// GET /api/co-attainment?courseId=X&semesterId=Y
// Returns per-CO attainment with L1/L2/L3 breakdown
router.get('/', authenticate, async (req, res, next) => {
  try {
    const { courseId, semesterId, evalCycleId } = req.query;
    if (!courseId) return res.status(400).json({ error: 'courseId required' });

    const cid = parseInt(courseId);
    const sid = semesterId ? parseInt(semesterId) : null;
    const ecid = evalCycleId ? parseInt(evalCycleId) : null;

    // Load all COs for the course
    const courseOutcomes = await prisma.courseOutcome.findMany({
      where: { courseId: cid },
      orderBy: { code: 'asc' },
    });

    if (!courseOutcomes.length) return res.json({ courseOutcomes: [], attainment: [] });

    // Load all students in the program (via course → program)
    const course = await prisma.course.findUnique({ where: { id: cid }, select: { programId: true } });
    const students = await prisma.student.findMany({
      where: { programId: course.programId, isActive: true },
      select: { id: true, rollNumber: true, firstName: true, lastName: true },
    });

    if (!students.length) return res.json({ courseOutcomes, attainment: [], students: [] });

    const studentIds = students.map(s => s.id);

    // --- INTERNAL marks: TeacherEvaluationScore per criterion, criterion mapped to CO ---
    const internalScores = await prisma.teacherEvaluationScore.findMany({
      where: {
        evaluation: { student: { id: { in: studentIds } } },
        criterion: { outcomeMappings: { some: { outcomeType: 'CO', co: { courseId: cid } } } },
      },
      include: {
        criterion: { include: { outcomeMappings: { where: { outcomeType: 'CO' }, include: { co: { select: { id: true, code: true } } } } } },
        evaluation: { select: { studentId: true } },
      },
    });

    // --- EXTERNAL marks: ExternalExamMark per question mapped to CO ---
    const assessmentWhere = { courseId: cid, type: 'EXTERNAL_EXAM' };
    if (ecid) assessmentWhere.evaluationCycleId = ecid;
    else if (sid) assessmentWhere.evaluationCycle = { semesterId: sid };

    const externalMarks = await prisma.externalExamMark.findMany({
      where: {
        studentId: { in: studentIds },
        question: { assessment: assessmentWhere },
      },
      include: {
        question: { select: { coId: true, maxMarks: true } },
      },
    });

    const THRESHOLD = 0.60; // 60% to attain a CO
    const L1 = 0.60, L2 = 0.70, L3 = 0.80; // % of students

    const attainment = courseOutcomes.map(co => {
      // Per student, accumulate marks on this CO
      const studentScores = {};
      for (const s of students) studentScores[s.id] = { obtained: 0, max: 0 };

      // Internal: criterion mapped to this CO
      for (const score of internalScores) {
        const mapping = score.criterion.outcomeMappings.find(m => m.coId === co.id);
        if (!mapping) continue;
        const sid = score.evaluation.studentId;
        if (!studentScores[sid]) continue;
        studentScores[sid].obtained += score.marksAwarded;
        studentScores[sid].max += score.criterion.maxMarks;
      }

      // External: questions mapped to this CO
      for (const mark of externalMarks) {
        if (mark.question.coId !== co.id) continue;
        const sid = mark.studentId;
        if (!studentScores[sid]) continue;
        studentScores[sid].obtained += mark.marks;
        studentScores[sid].max += mark.question.maxMarks;
      }

      // Students who have any marks recorded for this CO
      const scored = Object.entries(studentScores).filter(([, v]) => v.max > 0);
      const total = scored.length;

      if (!total) return { co, attainmentLevel: 0, attainmentPct: 0, studentsAttained: 0, totalStudents: students.length, label: 'No Data', studentBreakdown: [] };

      const attained = scored.filter(([, v]) => (v.obtained / v.max) >= THRESHOLD).length;
      const pct = attained / total;

      let level = 0, label = 'Not Attained';
      if (pct >= L3) { level = 3; label = 'L3 — High'; }
      else if (pct >= L2) { level = 2; label = 'L2 — Moderate'; }
      else if (pct >= L1) { level = 1; label = 'L1 — Low'; }

      const studentBreakdown = scored.map(([sid, v]) => {
        const student = students.find(s => s.id === parseInt(sid));
        return { studentId: parseInt(sid), rollNumber: student?.rollNumber, name: `${student?.firstName} ${student?.lastName}`, obtained: v.obtained, max: v.max, pct: v.max > 0 ? Math.round((v.obtained / v.max) * 100) : 0, attained: (v.obtained / v.max) >= THRESHOLD };
      });

      return {
        co,
        attainmentLevel: level,
        attainmentPct: Math.round(pct * 100),
        studentsAttained: attained,
        totalStudents: total,
        label,
        studentBreakdown,
      };
    });

    res.json({ courseOutcomes, attainment, thresholds: { co: 60, l1: 60, l2: 70, l3: 80 } });
  } catch (err) { next(err); }
});

module.exports = router;
