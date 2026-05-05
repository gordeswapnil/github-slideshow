const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

const prisma = new PrismaClient();

async function main() {
  console.log('Seeding database...');

  // Roles
  const adminRole = await prisma.role.upsert({
    where: { name: 'ADMIN' },
    update: {},
    create: { name: 'ADMIN', description: 'System Administrator' },
  });
  await prisma.role.upsert({
    where: { name: 'FACULTY' },
    update: {},
    create: { name: 'FACULTY', description: 'Faculty / Teacher' },
  });
  await prisma.role.upsert({
    where: { name: 'HOD' },
    update: {},
    create: { name: 'HOD', description: 'Head of Department' },
  });
  await prisma.role.upsert({
    where: { name: 'STUDENT' },
    update: {},
    create: { name: 'STUDENT', description: 'Student' },
  });
  await prisma.role.upsert({
    where: { name: 'REVIEWER' },
    update: {},
    create: { name: 'REVIEWER', description: 'External Reviewer' },
  });

  // Admin user
  const passwordHash = await bcrypt.hash(process.env.ADMIN_PASSWORD || 'Admin@2026', 10);
  const adminUser = await prisma.user.upsert({
    where: { email: process.env.ADMIN_EMAIL || 'admin@rubriq.edu' },
    update: {},
    create: {
      email: process.env.ADMIN_EMAIL || 'admin@rubriq.edu',
      passwordHash,
      firstName: 'System',
      lastName: 'Administrator',
      roleId: adminRole.id,
      isActive: true,
    },
  });

  // Institution
  const institution = await prisma.institution.upsert({
    where: { code: 'RIMS' },
    update: {},
    create: {
      name: 'RubriQ Institute of Management Studies',
      code: 'RIMS',
      address: '42 Knowledge Park, Innovation City, Maharashtra - 411001',
      website: 'https://rubriq.edu',
      accredBody: 'NAAC, NBA',
    },
  });

  // Department
  const department = await prisma.department.upsert({
    where: { institutionId_code: { institutionId: institution.id, code: 'FIN-FINTECH' } },
    update: {},
    create: {
      institutionId: institution.id,
      name: 'Finance & FinTech',
      code: 'FIN-FINTECH',
      hodName: 'Dr. Priya Sharma',
    },
  });

  // Program
  const program = await prisma.program.upsert({
    where: { departmentId_code: { departmentId: department.id, code: 'MBA-FIN' } },
    update: {},
    create: {
      departmentId: department.id,
      name: 'MBA Finance',
      code: 'MBA-FIN',
      duration: 2,
      level: 'Postgraduate',
    },
  });

  // Course
  const course = await prisma.course.upsert({
    where: { programId_code: { programId: program.id, code: 'MBA-FIN-402' } },
    update: {},
    create: {
      programId: program.id,
      name: 'AI in Finance',
      code: 'MBA-FIN-402',
      credits: 4,
      semester: 4,
      description: 'Application of Artificial Intelligence, Machine Learning, and Generative AI in Financial Services.',
    },
  });

  // Academic Year
  const academicYear = await prisma.academicYear.upsert({
    where: { label: '2026-27' },
    update: {},
    create: {
      label: '2026-27',
      startYear: 2026,
      endYear: 2027,
      isActive: true,
    },
  });

  // Semesters
  const sem1 = await prisma.semester.upsert({
    where: { academicYearId_number: { academicYearId: academicYear.id, number: 1 } },
    update: {},
    create: {
      academicYearId: academicYear.id,
      number: 1,
      label: 'Semester 1',
      startDate: new Date('2026-07-01'),
      endDate: new Date('2026-11-30'),
      isActive: true,
    },
  });
  const sem2 = await prisma.semester.upsert({
    where: { academicYearId_number: { academicYearId: academicYear.id, number: 2 } },
    update: {},
    create: {
      academicYearId: academicYear.id,
      number: 2,
      label: 'Semester 2',
      startDate: new Date('2027-01-01'),
      endDate: new Date('2027-05-31'),
      isActive: false,
    },
  });

  // Divisions
  const divA = await prisma.division.upsert({
    where: { semesterId_name: { semesterId: sem1.id, name: 'Division A' } },
    update: {},
    create: { semesterId: sem1.id, name: 'Division A', capacity: 60 },
  });
  await prisma.division.upsert({
    where: { semesterId_name: { semesterId: sem1.id, name: 'Division B' } },
    update: {},
    create: { semesterId: sem1.id, name: 'Division B', capacity: 60 },
  });

  // Evaluation Cycles
  const eval1 = await prisma.evaluationCycle.upsert({
    where: { semesterId_number: { semesterId: sem1.id, number: 1 } },
    update: {},
    create: {
      semesterId: sem1.id,
      number: 1,
      label: 'Evaluation 1 — Mid-Semester',
      startDate: new Date('2026-08-15'),
      endDate: new Date('2026-09-15'),
      isActive: false,
    },
  });
  const eval2 = await prisma.evaluationCycle.upsert({
    where: { semesterId_number: { semesterId: sem1.id, number: 2 } },
    update: {},
    create: {
      semesterId: sem1.id,
      number: 2,
      label: 'Evaluation 2 — End Semester',
      startDate: new Date('2026-10-01'),
      endDate: new Date('2026-11-15'),
      isActive: true,
    },
  });
  const eval3 = await prisma.evaluationCycle.upsert({
    where: { semesterId_number: { semesterId: sem2.id, number: 3 } },
    update: {},
    create: {
      semesterId: sem2.id,
      number: 3,
      label: 'Evaluation 3 — Mid-Semester',
      startDate: new Date('2027-02-01'),
      endDate: new Date('2027-03-01'),
      isActive: false,
    },
  });
  const eval4 = await prisma.evaluationCycle.upsert({
    where: { semesterId_number: { semesterId: sem2.id, number: 4 } },
    update: {},
    create: {
      semesterId: sem2.id,
      number: 4,
      label: 'Evaluation 4 — End Semester',
      startDate: new Date('2027-04-01'),
      endDate: new Date('2027-05-15'),
      isActive: false,
    },
  });

  // Assessment
  const assessment = await prisma.assessment.upsert({
    where: { id: 1 },
    update: {},
    create: {
      id: 1,
      courseId: course.id,
      evaluationCycleId: eval2.id,
      divisionId: divA.id,
      title: 'AI Applications in Financial Services — Case Study',
      type: 'Assignment / Case Study',
      description: 'Students analyze real-world applications of AI, ML, and Generative AI in financial services.',
      totalMarks: 30,
      passingMarks: 12,
      submissionDeadline: new Date('2026-10-24'),
      isActive: true,
    },
  });

  // Rubric
  const rubric = await prisma.rubric.upsert({
    where: { assessmentId: assessment.id },
    update: {},
    create: {
      assessmentId: assessment.id,
      title: 'MBA AI in Finance — Assessment Rubric',
      description: 'Postgraduate | Teacher Rubric | Assignment / Case Study | Total Marks: 30',
      totalMarks: 30,
      isPublished: true,
    },
  });

  // Rubric Criteria
  const criteriaData = [
    { orderIndex: 1, title: 'Understanding of AI in Finance Context', maxMarks: 4, bloomLevel: 'Understand', levels: [
      { label: 'Excellent', minMarks: 3.5, maxMarks: 4, descriptor: 'Strong understanding of AI in finance. Clearly explains the financial problem, institutional context, stakeholders, and relevance of AI. Shows postgraduate-level maturity.', colorCode: '#16a34a' },
      { label: 'Good', minMarks: 2.5, maxMarks: 3.4, descriptor: 'Good understanding of the finance context and AI relevance, but some stakeholder or institutional implications are underdeveloped.', colorCode: '#2563eb' },
      { label: 'Satisfactory', minMarks: 1.5, maxMarks: 2.4, descriptor: 'Basic understanding shown. Finance problem is identifiable but lacks depth, specificity, or contextual clarity.', colorCode: '#f59e0b' },
      { label: 'Needs Improvement', minMarks: 0, maxMarks: 1.4, descriptor: 'Weak or incorrect understanding. AI is discussed generically with little connection to finance.', colorCode: '#dc2626' },
    ]},
    { orderIndex: 2, title: 'Application of AI Concepts / Tools / Models', maxMarks: 5, bloomLevel: 'Apply', levels: [
      { label: 'Excellent', minMarks: 4.5, maxMarks: 5, descriptor: 'Applies relevant AI concepts accurately, such as ML, predictive analytics, NLP, GenAI, robo-advisory, fraud analytics, risk modelling, or decision automation.', colorCode: '#16a34a' },
      { label: 'Good', minMarks: 3.5, maxMarks: 4.4, descriptor: 'Applies relevant AI concepts with mostly accurate explanation. Justification is present but not fully rigorous.', colorCode: '#2563eb' },
      { label: 'Satisfactory', minMarks: 2, maxMarks: 3.4, descriptor: 'Mentions AI concepts but application is basic, partially descriptive, or weakly connected to the case.', colorCode: '#f59e0b' },
      { label: 'Needs Improvement', minMarks: 0, maxMarks: 1.9, descriptor: 'AI concepts are inaccurate, superficial, or unrelated to the finance problem.', colorCode: '#dc2626' },
    ]},
    { orderIndex: 3, title: 'Financial Analysis and Decision Relevance', maxMarks: 5, bloomLevel: 'Analyze', levels: [
      { label: 'Excellent', minMarks: 4.5, maxMarks: 5, descriptor: 'Strong financial reasoning. Clearly connects AI use to cost, revenue, risk, efficiency, customer value, compliance, profitability, or decision quality.', colorCode: '#16a34a' },
      { label: 'Good', minMarks: 3.5, maxMarks: 4.4, descriptor: 'Good financial analysis with clear links to business decisions, though some financial implications need more depth.', colorCode: '#2563eb' },
      { label: 'Satisfactory', minMarks: 2, maxMarks: 3.4, descriptor: 'Some financial discussion present, but mostly general. Limited evidence of decision-oriented thinking.', colorCode: '#f59e0b' },
      { label: 'Needs Improvement', minMarks: 0, maxMarks: 1.9, descriptor: 'Minimal or no financial analysis. Submission reads like a technology note rather than a finance case.', colorCode: '#dc2626' },
    ]},
    { orderIndex: 4, title: 'Evidence, Data Use, and Analytical Rigor', maxMarks: 4, bloomLevel: 'Evaluate', levels: [
      { label: 'Excellent', minMarks: 3.5, maxMarks: 4, descriptor: 'Uses relevant data, case facts, examples, academic sources, industry reports, or logical assumptions. Analysis is evidence-based and internally consistent.', colorCode: '#16a34a' },
      { label: 'Good', minMarks: 2.5, maxMarks: 3.4, descriptor: 'Uses some evidence or examples, but analysis could be more rigorous or better supported.', colorCode: '#2563eb' },
      { label: 'Satisfactory', minMarks: 1.5, maxMarks: 2.4, descriptor: 'Limited evidence. Heavy reliance on opinion or description. Assumptions are unclear.', colorCode: '#f59e0b' },
      { label: 'Needs Improvement', minMarks: 0, maxMarks: 1.4, descriptor: 'Little to no evidence. Claims are unsupported, inaccurate, or copied without analysis.', colorCode: '#dc2626' },
    ]},
    { orderIndex: 5, title: 'Risk, Ethics, Governance, and Regulatory Awareness', maxMarks: 4, bloomLevel: 'Evaluate', levels: [
      { label: 'Excellent', minMarks: 3.5, maxMarks: 4, descriptor: 'Critically evaluates model bias, explainability, data privacy, cybersecurity, accountability, model risk, governance, and regulatory concerns where relevant.', colorCode: '#16a34a' },
      { label: 'Good', minMarks: 2.5, maxMarks: 3.4, descriptor: 'Identifies major risks and ethical issues, but mitigation or governance discussion is not fully developed.', colorCode: '#2563eb' },
      { label: 'Satisfactory', minMarks: 1.5, maxMarks: 2.4, descriptor: 'Mentions ethics briefly but lacks critical evaluation.', colorCode: '#f59e0b' },
      { label: 'Needs Improvement', minMarks: 0, maxMarks: 1.4, descriptor: 'Ignores or misunderstands ethical, governance, or regulatory implications.', colorCode: '#dc2626' },
    ]},
    { orderIndex: 6, title: 'Case Analysis, Structure, and Argument Quality', maxMarks: 3, bloomLevel: 'Analyze', levels: [
      { label: 'Excellent', minMarks: 2.6, maxMarks: 3, descriptor: 'Clear, logical, and well-structured argument. Case facts are interpreted effectively. Strong flow from problem to analysis to recommendation.', colorCode: '#16a34a' },
      { label: 'Good', minMarks: 2, maxMarks: 2.5, descriptor: 'Mostly clear structure and argument. Some transitions or analytical connections could improve.', colorCode: '#2563eb' },
      { label: 'Satisfactory', minMarks: 1, maxMarks: 1.9, descriptor: 'Basic structure present, but argument is descriptive, repetitive, or incomplete.', colorCode: '#f59e0b' },
      { label: 'Needs Improvement', minMarks: 0, maxMarks: 0.9, descriptor: 'Poor structure. Lacks coherent argument or meaningful case analysis.', colorCode: '#dc2626' },
    ]},
    { orderIndex: 7, title: 'Practical Recommendations and Implementation Feasibility', maxMarks: 3, bloomLevel: 'Create', levels: [
      { label: 'Excellent', minMarks: 2.6, maxMarks: 3, descriptor: 'Recommendations are practical, finance-relevant, implementable, and linked to constraints such as cost, data availability, skills, governance, scalability, or adoption.', colorCode: '#16a34a' },
      { label: 'Good', minMarks: 2, maxMarks: 2.5, descriptor: 'Recommendations are relevant but need more implementation detail or prioritization.', colorCode: '#2563eb' },
      { label: 'Satisfactory', minMarks: 1, maxMarks: 1.9, descriptor: 'Recommendations are generic or only partly connected to the analysis.', colorCode: '#f59e0b' },
      { label: 'Needs Improvement', minMarks: 0, maxMarks: 0.9, descriptor: 'Recommendations are missing, unrealistic, or unsupported.', colorCode: '#dc2626' },
    ]},
    { orderIndex: 8, title: 'Referencing, Presentation, and Academic Integrity', maxMarks: 2, bloomLevel: 'Remember', levels: [
      { label: 'Excellent', minMarks: 1.8, maxMarks: 2, descriptor: 'Professional writing, clean formatting, correct citations, appropriate academic tone, and no signs of plagiarism or unsupported copying.', colorCode: '#16a34a' },
      { label: 'Good', minMarks: 1.3, maxMarks: 1.7, descriptor: 'Generally well presented with minor citation, formatting, or language issues.', colorCode: '#2563eb' },
      { label: 'Satisfactory', minMarks: 0.7, maxMarks: 1.2, descriptor: 'Understandable but contains several writing, formatting, or referencing weaknesses.', colorCode: '#f59e0b' },
      { label: 'Needs Improvement', minMarks: 0, maxMarks: 0.6, descriptor: 'Poorly written, poorly formatted, missing references, or serious academic-integrity concerns.', colorCode: '#dc2626' },
    ]},
  ];

  const createdCriteria = [];
  for (const c of criteriaData) {
    const existing = await prisma.rubricCriterion.findFirst({
      where: { rubricId: rubric.id, orderIndex: c.orderIndex },
    });
    let criterion;
    if (existing) {
      criterion = existing;
    } else {
      criterion = await prisma.rubricCriterion.create({
        data: {
          rubricId: rubric.id,
          orderIndex: c.orderIndex,
          title: c.title,
          maxMarks: c.maxMarks,
          bloomLevel: c.bloomLevel,
        },
      });
    }
    createdCriteria.push(criterion);

    for (const l of c.levels) {
      const existingLevel = await prisma.rubricLevel.findFirst({
        where: { criterionId: criterion.id, label: l.label },
      });
      if (!existingLevel) {
        await prisma.rubricLevel.create({
          data: { criterionId: criterion.id, ...l },
        });
      }
    }
  }

  // Course Outcomes
  const coData = [
    { code: 'CO1', description: 'Explain the role of AI, ML, and GenAI in financial services and banking.', bloomLevel: 'Understand' },
    { code: 'CO2', description: 'Apply AI tools such as NLP, predictive models, and robo-advisory systems to finance problems.', bloomLevel: 'Apply' },
    { code: 'CO3', description: 'Analyze financial datasets using AI techniques for credit scoring, fraud detection, and risk management.', bloomLevel: 'Analyze' },
    { code: 'CO4', description: 'Evaluate ethical, governance, and regulatory implications of AI adoption in finance.', bloomLevel: 'Evaluate' },
    { code: 'CO5', description: 'Synthesize practical AI-based recommendations for financial decision-making.', bloomLevel: 'Create' },
  ];
  const createdCOs = [];
  for (const co of coData) {
    const existing = await prisma.courseOutcome.findFirst({ where: { courseId: course.id, code: co.code } });
    if (!existing) {
      createdCOs.push(await prisma.courseOutcome.create({ data: { courseId: course.id, ...co } }));
    } else {
      createdCOs.push(existing);
    }
  }

  // Program Outcomes
  const poData = [
    { code: 'PO1', description: 'Financial Analysis & Decision Making' },
    { code: 'PO2', description: 'Technology & Digital Finance Competency' },
    { code: 'PO3', description: 'Ethical & Governance Awareness' },
    { code: 'PO4', description: 'Research & Evidence-Based Reasoning' },
    { code: 'PO5', description: 'Professional Communication & Presentation' },
  ];
  const createdPOs = [];
  for (const po of poData) {
    const existing = await prisma.programOutcome.findFirst({ where: { programId: program.id, code: po.code } });
    if (!existing) {
      createdPOs.push(await prisma.programOutcome.create({ data: { programId: program.id, ...po } }));
    } else {
      createdPOs.push(existing);
    }
  }

  // Students
  const studentData = [
    { rollNumber: 'MBA26001', firstName: 'Aarav', lastName: 'Sharma', email: 'aarav.sharma@student.rubriq.edu' },
    { rollNumber: 'MBA26002', firstName: 'Isha', lastName: 'Patel', email: 'isha.patel@student.rubriq.edu' },
    { rollNumber: 'MBA26003', firstName: 'Rohan', lastName: 'Gupta', email: 'rohan.gupta@student.rubriq.edu' },
    { rollNumber: 'MBA26004', firstName: 'Priya', lastName: 'Singh', email: 'priya.singh@student.rubriq.edu' },
    { rollNumber: 'MBA26005', firstName: 'Arjun', lastName: 'Mehta', email: 'arjun.mehta@student.rubriq.edu' },
    { rollNumber: 'MBA26006', firstName: 'Kavya', lastName: 'Nair', email: 'kavya.nair@student.rubriq.edu' },
    { rollNumber: 'MBA26007', firstName: 'Vikram', lastName: 'Reddy', email: 'vikram.reddy@student.rubriq.edu' },
    { rollNumber: 'MBA26008', firstName: 'Ananya', lastName: 'Kumar', email: 'ananya.kumar@student.rubriq.edu' },
    { rollNumber: 'MBA26009', firstName: 'Rahul', lastName: 'Joshi', email: 'rahul.joshi@student.rubriq.edu' },
    { rollNumber: 'MBA26010', firstName: 'Sneha', lastName: 'Verma', email: 'sneha.verma@student.rubriq.edu' },
    { rollNumber: 'MBA26011', firstName: 'Karan', lastName: 'Malhotra', email: 'karan.malhotra@student.rubriq.edu' },
    { rollNumber: 'MBA26012', firstName: 'Divya', lastName: 'Pillai', email: 'divya.pillai@student.rubriq.edu' },
  ];

  const createdStudents = [];
  for (const s of studentData) {
    const existing = await prisma.student.findUnique({ where: { rollNumber: s.rollNumber } });
    if (!existing) {
      createdStudents.push(await prisma.student.create({
        data: { ...s, programId: program.id, divisionId: divA.id, batch: '2026-28' },
      }));
    } else {
      createdStudents.push(existing);
    }
  }

  // Submissions with evaluations
  const marksData = [
    [3.5, 4.5, 4.5, 3.5, 3.5, 2.8, 2.8, 1.9],
    [3.0, 3.8, 3.6, 3.0, 3.0, 2.3, 2.2, 1.5],
    [1.8, 2.2, 2.1, 1.6, 1.8, 1.5, 1.4, 0.8],
    [2.8, 3.5, 3.2, 2.8, 2.8, 2.5, 2.5, 1.7],
    [3.8, 4.8, 4.6, 3.8, 3.8, 2.9, 2.9, 1.9],
    [2.0, 2.5, 2.3, 2.0, 2.0, 1.8, 1.6, 1.0],
    [3.2, 4.0, 3.8, 3.2, 3.0, 2.6, 2.4, 1.6],
    [3.6, 4.4, 4.2, 3.4, 3.4, 2.7, 2.7, 1.8],
    [1.2, 1.8, 1.6, 1.2, 1.4, 1.0, 0.8, 0.5],
    [2.5, 3.2, 3.0, 2.5, 2.5, 2.1, 2.0, 1.3],
    [3.4, 4.2, 4.0, 3.3, 3.3, 2.6, 2.5, 1.7],
    [2.2, 2.8, 2.6, 2.2, 2.0, 1.9, 1.8, 1.1],
  ];

  for (let i = 0; i < createdStudents.length; i++) {
    const student = createdStudents[i];
    const existing = await prisma.studentSubmission.findFirst({
      where: { studentId: student.id, assessmentId: assessment.id },
    });
    if (!existing) {
      const submission = await prisma.studentSubmission.create({
        data: {
          studentId: student.id,
          assessmentId: assessment.id,
          status: 'SUBMITTED',
          submittedAt: new Date(`2026-10-${20 + (i % 4)}`),
          isLate: i === 1,
        },
      });

      const total = marksData[i].reduce((a, b) => a + b, 0);
      const grade = total >= 24 ? 'Excellent' : total >= 18 ? 'Good' : total >= 12 ? 'Satisfactory' : 'Needs Improvement';

      const evaluation = await prisma.teacherEvaluation.create({
        data: {
          submissionId: submission.id,
          studentId: student.id,
          totalMarks: parseFloat(total.toFixed(1)),
          grade,
          status: 'COMPLETED',
          evaluatedAt: new Date(`2026-10-${25 + (i % 3)}`),
          feedback: `Student has shown ${grade.toLowerCase()} performance. ${grade === 'Needs Improvement' ? 'Requires additional support in core areas.' : 'Good application of concepts.'}`,
        },
      });

      for (let j = 0; j < createdCriteria.length; j++) {
        await prisma.teacherEvaluationScore.create({
          data: {
            evaluationId: evaluation.id,
            criterionId: createdCriteria[j].id,
            marksAwarded: marksData[i][j],
            levelLabel: marksData[i][j] >= criteriaData[j].levels[0].minMarks ? 'Excellent'
              : marksData[i][j] >= criteriaData[j].levels[1].minMarks ? 'Good'
              : marksData[i][j] >= criteriaData[j].levels[2].minMarks ? 'Satisfactory'
              : 'Needs Improvement',
          },
        });
      }
    }
  }

  // Continuous Improvement Actions
  const ciaData = [
    { weakArea: 'Low attainment in CO3 (Financial Analysis)', evidence: 'Evaluation 2 Data', proposedAction: 'Conduct remedial sessions focused on financial modelling and decision analysis.', responsibility: 'Dr. S. Mehta', status: 'IN_PROGRESS' },
    { weakArea: 'Poor application of AI Tools', evidence: 'Case Study Assignment', proposedAction: 'Introduce live demo sessions on Python, Jupyter, and FinTech APIs.', responsibility: 'Prof. A. Kumar', status: 'PLANNED' },
    { weakArea: 'Gap in regulatory knowledge', evidence: 'Industry Feedback Survey', proposedAction: 'Guest lecture series by SEBI and RBI officials on AI governance.', responsibility: 'HoD Office', status: 'COMPLETED', outcomeNote: 'Action Taken: 3 Lectures delivered successfully.' },
  ];

  for (const cia of ciaData) {
    const existing = await prisma.continuousImprovementAction.findFirst({ where: { weakArea: cia.weakArea } });
    if (!existing) {
      await prisma.continuousImprovementAction.create({ data: cia });
    }
  }

  // Settings
  const settingsData = [
    { key: 'institution_name', value: 'RubriQ Institute of Management Studies', group: 'general', label: 'Institution Name', type: 'string' },
    { key: 'academic_year_active', value: '2026-27', group: 'academic', label: 'Active Academic Year', type: 'string' },
    { key: 'max_file_size_mb', value: '25', group: 'uploads', label: 'Max File Size (MB)', type: 'number' },
    { key: 'allowed_file_types', value: 'pdf,doc,docx,xls,xlsx,csv,ppt,pptx,txt,jpg,jpeg,png,webp,zip', group: 'uploads', label: 'Allowed File Types', type: 'string' },
    { key: 'submission_reminder_days', value: '3', group: 'notifications', label: 'Submission Reminder (days before deadline)', type: 'number' },
    { key: 'accreditation_body', value: 'NAAC, NBA', group: 'accreditation', label: 'Accreditation Bodies', type: 'string' },
  ];

  for (const s of settingsData) {
    await prisma.setting.upsert({
      where: { key: s.key },
      update: { value: s.value },
      create: s,
    });
  }

  // Audit log
  await prisma.auditLog.create({
    data: {
      userId: adminUser.id,
      action: 'SEED',
      entity: 'System',
      details: { message: 'Initial database seed completed' },
      ipAddress: '127.0.0.1',
    },
  });

  console.log('Seed completed successfully!');
  console.log(`Admin login: ${process.env.ADMIN_EMAIL || 'admin@rubriq.edu'} / ${process.env.ADMIN_PASSWORD || 'Admin@2026'}`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
