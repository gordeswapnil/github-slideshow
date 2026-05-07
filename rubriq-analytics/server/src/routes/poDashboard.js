const prisma = require('../db');
const router = require('express').Router();
const { authenticate } = require('../middleware/auth');

// GET /api/po-dashboard?programId=X&semesterId=Y
router.get('/', authenticate, async (req, res, next) => {
  try {
    const { programId, semesterId, evalCycleId } = req.query;
    if (!programId) return res.status(400).json({ error: 'programId required' });

    const pid = parseInt(programId);
    const sid = semesterId ? parseInt(semesterId) : null;
    const ecid = evalCycleId ? parseInt(evalCycleId) : null;

    // All POs and PSOs for program
    const [programOutcomes, programSpecificOutcomes, courses] = await Promise.all([
      prisma.programOutcome.findMany({ where: { programId: pid }, orderBy: { code: 'asc' } }),
      prisma.programSpecificOutcome.findMany({ where: { programId: pid }, orderBy: { code: 'asc' } }),
      prisma.course.findMany({ where: { programId: pid, isActive: true }, select: { id: true, code: true, name: true } }),
    ]);

    if (!programOutcomes.length) return res.json({ programOutcomes: [], programSpecificOutcomes: [], poAttainment: [], psoAttainment: [] });

    // CO-PO mappings for all courses in program
    const courseIds = courses.map(c => c.id);
    const coPOMappings = await prisma.cOPOMapping.findMany({
      where: { co: { courseId: { in: courseIds } } },
      include: { co: { select: { id: true, code: true, courseId: true } } },
    });

    // Calculate CO attainment for each course
    const coAttainmentMap = {}; // coId → attainmentPct (0-100)

    for (const course of courses) {
      const cid = course.id;
      const courseOutcomes = await prisma.courseOutcome.findMany({ where: { courseId: cid } });
      if (!courseOutcomes.length) continue;

      const students = await prisma.student.findMany({ where: { programId: pid, isActive: true }, select: { id: true } });
      if (!students.length) continue;
      const studentIds = students.map(s => s.id);

      const internalScores = await prisma.teacherEvaluationScore.findMany({
        where: { evaluation: { student: { id: { in: studentIds } } }, criterion: { outcomeMappings: { some: { outcomeType: 'CO', co: { courseId: cid } } } } },
        include: { criterion: { include: { outcomeMappings: { where: { outcomeType: 'CO' }, include: { co: { select: { id: true } } } } } }, evaluation: { select: { studentId: true } } },
      });

      const assessmentWhere = { courseId: cid, type: 'EXTERNAL_EXAM' };
      if (ecid) assessmentWhere.evaluationCycleId = ecid;
      else if (sid) assessmentWhere.evaluationCycle = { semesterId: sid };

      const externalMarks = await prisma.externalExamMark.findMany({
        where: { studentId: { in: studentIds }, question: { assessment: assessmentWhere } },
        include: { question: { select: { coId: true, maxMarks: true } } },
      });

      const THRESHOLD = 0.60;

      for (const co of courseOutcomes) {
        const studentScores = {};
        for (const s of students) studentScores[s.id] = { obtained: 0, max: 0 };

        for (const score of internalScores) {
          const mapping = score.criterion.outcomeMappings.find(m => m.coId === co.id);
          if (!mapping) continue;
          const studentId = score.evaluation.studentId;
          if (!studentScores[studentId]) continue;
          studentScores[studentId].obtained += score.marksAwarded;
          studentScores[studentId].max += score.criterion.maxMarks;
        }

        for (const mark of externalMarks) {
          if (mark.question.coId !== co.id) continue;
          const studentId = mark.studentId;
          if (!studentScores[studentId]) continue;
          studentScores[studentId].obtained += mark.marks;
          studentScores[studentId].max += mark.question.maxMarks;
        }

        const scored = Object.values(studentScores).filter(v => v.max > 0);
        if (!scored.length) { coAttainmentMap[co.id] = null; continue; }

        const attainedCount = scored.filter(v => (v.obtained / v.max) >= THRESHOLD).length;
        const attainmentPct = (attainedCount / scored.length) * 100;
        // Attainment level fraction for PO formula (L1=0.6, L2=0.7, L3=0.8 → scale to 0-1 for PO weighted avg)
        const levelPct = attainedCount / scored.length;
        coAttainmentMap[co.id] = Math.round(levelPct * 100);
      }
    }

    // PO Attainment = Σ(CO_attainment × strength) / Σ(strength) for all mapped COs
    const calcOutcomeAttainment = (outcomeId, mappings, ispo = true) => {
      const relevant = mappings.filter(m => ispo ? m.poId === outcomeId : m.psoId === outcomeId);
      if (!relevant.length) return null;

      let weightedSum = 0, strengthSum = 0;
      for (const m of relevant) {
        const coAtt = coAttainmentMap[m.coId];
        if (coAtt === null || coAtt === undefined) continue;
        weightedSum += (coAtt / 100) * m.strength;
        strengthSum += m.strength;
      }
      if (!strengthSum) return null;
      return Math.round((weightedSum / strengthSum) * 100);
    };

    const poAttainment = programOutcomes.map(po => {
      const pct = calcOutcomeAttainment(po.id, coPOMappings, true);
      return {
        po,
        attainmentPct: pct,
        level: pct === null ? null : pct >= 80 ? 3 : pct >= 70 ? 2 : pct >= 60 ? 1 : 0,
        label: pct === null ? 'No Data' : pct >= 80 ? 'L3 — High' : pct >= 70 ? 'L2 — Moderate' : pct >= 60 ? 'L1 — Low' : 'Not Attained',
        color: pct === null ? '#94a3b8' : pct >= 80 ? '#16a34a' : pct >= 70 ? '#f59e0b' : pct >= 60 ? '#f97316' : '#ef4444',
      };
    });

    const psoAttainment = programSpecificOutcomes.map(pso => {
      const pct = calcOutcomeAttainment(pso.id, coPOMappings, false);
      return {
        pso,
        attainmentPct: pct,
        level: pct === null ? null : pct >= 80 ? 3 : pct >= 70 ? 2 : pct >= 60 ? 1 : 0,
        label: pct === null ? 'No Data' : pct >= 80 ? 'L3 — High' : pct >= 70 ? 'L2 — Moderate' : pct >= 60 ? 'L1 — Low' : 'Not Attained',
        color: pct === null ? '#94a3b8' : pct >= 80 ? '#16a34a' : pct >= 70 ? '#f59e0b' : pct >= 60 ? '#f97316' : '#ef4444',
      };
    });

    res.json({ programOutcomes, programSpecificOutcomes, poAttainment, psoAttainment, courses, coAttainmentMap });
  } catch (err) { next(err); }
});

module.exports = router;
