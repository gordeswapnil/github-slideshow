const router = require('express').Router();
const { PrismaClient } = require('@prisma/client');
const { authenticate, requireAdmin } = require('../middleware/auth');
const { upload } = require('../middleware/upload');
const path = require('path');
const fs = require('fs');
const prisma = new PrismaClient();

router.get('/', authenticate, async (req, res, next) => {
  try {
    const { assessmentId, studentId, status } = req.query;
    const where = {};
    if (assessmentId) where.assessmentId = parseInt(assessmentId);
    if (studentId) where.studentId = parseInt(studentId);
    if (status) where.status = status;
    const submissions = await prisma.studentSubmission.findMany({
      where,
      include: {
        student: { select: { rollNumber: true, firstName: true, lastName: true, division: { select: { name: true } } } },
        assessment: { select: { title: true, type: true, totalMarks: true } },
        files: { select: { id: true, originalName: true, fileSize: true, mimeType: true, uploadedAt: true } },
        evaluation: { select: { totalMarks: true, grade: true, status: true, evaluatedAt: true } },
      },
      orderBy: { submittedAt: 'desc' },
    });
    res.json(submissions);
  } catch (err) { next(err); }
});

router.get('/:id', authenticate, async (req, res, next) => {
  try {
    const submission = await prisma.studentSubmission.findUnique({
      where: { id: parseInt(req.params.id) },
      include: {
        student: true,
        assessment: { include: { rubric: { include: { criteria: { include: { levels: true }, orderBy: { orderIndex: 'asc' } } } } } },
        files: true,
        evaluation: { include: { scores: { include: { criterion: true } } } },
      },
    });
    if (!submission) return res.status(404).json({ error: 'Submission not found' });
    res.json(submission);
  } catch (err) { next(err); }
});

router.post('/:id/files', authenticate, (req, res, next) => {
  req.uploadSubDir = 'submissions';
  next();
}, upload.array('files', 10), async (req, res, next) => {
  try {
    if (!req.files || req.files.length === 0) return res.status(400).json({ error: 'No files uploaded' });
    const submissionId = parseInt(req.params.id);
    const submission = await prisma.studentSubmission.findUnique({ where: { id: submissionId } });
    if (!submission) return res.status(404).json({ error: 'Submission not found' });

    const fileRecords = await Promise.all(req.files.map(f =>
      prisma.submissionFile.create({
        data: {
          submissionId,
          originalName: f.originalname,
          storedName: f.filename,
          filePath: f.path,
          mimeType: f.mimetype,
          fileSize: f.size,
        },
      })
    ));

    if (submission.status === 'PENDING') {
      await prisma.studentSubmission.update({ where: { id: submissionId }, data: { status: 'SUBMITTED', submittedAt: new Date() } });
    }
    res.json({ message: `${fileRecords.length} file(s) uploaded`, files: fileRecords });
  } catch (err) { next(err); }
});

router.put('/:id', authenticate, requireAdmin, async (req, res, next) => {
  try {
    const { status, remarks } = req.body;
    const submission = await prisma.studentSubmission.update({ where: { id: parseInt(req.params.id) }, data: { status, remarks } });
    res.json(submission);
  } catch (err) { next(err); }
});

// Evaluation endpoints
router.get('/:id/evaluation', authenticate, async (req, res, next) => {
  try {
    const evaluation = await prisma.teacherEvaluation.findUnique({
      where: { submissionId: parseInt(req.params.id) },
      include: { scores: { include: { criterion: { include: { levels: true } } } } },
    });
    res.json(evaluation);
  } catch (err) { next(err); }
});

router.post('/:id/evaluation', authenticate, requireAdmin, async (req, res, next) => {
  try {
    const { scores, feedback } = req.body;
    const submissionId = parseInt(req.params.id);
    const submission = await prisma.studentSubmission.findUnique({ where: { id: submissionId } });
    if (!submission) return res.status(404).json({ error: 'Submission not found' });

    const totalMarks = scores.reduce((sum, s) => sum + parseFloat(s.marksAwarded), 0);
    const grade = totalMarks >= 24 ? 'Excellent' : totalMarks >= 18 ? 'Good' : totalMarks >= 12 ? 'Satisfactory' : 'Needs Improvement';

    const evaluation = await prisma.teacherEvaluation.upsert({
      where: { submissionId },
      create: { submissionId, studentId: submission.studentId, totalMarks, grade, feedback, status: 'COMPLETED', evaluatedAt: new Date() },
      update: { totalMarks, grade, feedback, status: 'COMPLETED', evaluatedAt: new Date() },
    });

    for (const s of scores) {
      await prisma.teacherEvaluationScore.upsert({
        where: { evaluationId_criterionId: { evaluationId: evaluation.id, criterionId: parseInt(s.criterionId) } },
        create: { evaluationId: evaluation.id, criterionId: parseInt(s.criterionId), marksAwarded: parseFloat(s.marksAwarded), levelLabel: s.levelLabel, remarks: s.remarks },
        update: { marksAwarded: parseFloat(s.marksAwarded), levelLabel: s.levelLabel, remarks: s.remarks },
      });
    }

    res.json({ evaluation, message: 'Evaluation saved' });
  } catch (err) { next(err); }
});

module.exports = router;
