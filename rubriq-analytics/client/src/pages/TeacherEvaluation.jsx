import { useState, useEffect } from 'react';
import { submissionsAPI, assessmentsAPI } from '../services/api';
import DataTable from '../components/shared/DataTable';
import Modal from '../components/shared/Modal';
import StatusBadge from '../components/shared/StatusBadge';
import { PageLoader } from '../components/shared/LoadingSpinner';
import { Eye, CheckCircle, Clock, ClipboardCheck } from 'lucide-react';

export default function TeacherEvaluation() {
  const [submissions, setSubmissions] = useState([]);
  const [assessments, setAssessments] = useState([]);
  const [selectedAssessment, setSelectedAssessment] = useState('');
  const [loading, setLoading] = useState(true);
  const [viewModal, setViewModal] = useState({ open: false, submission: null });
  const [rubric, setRubric] = useState(null);

  useEffect(() => {
    assessmentsAPI.list().then(res => { setAssessments(res.data); if (res.data[0]) setSelectedAssessment(res.data[0].id.toString()); });
  }, []);

  useEffect(() => {
    if (!selectedAssessment) return;
    setLoading(true);
    submissionsAPI.list({ assessmentId: selectedAssessment, status: 'SUBMITTED' })
      .then(res => setSubmissions(res.data))
      .finally(() => setLoading(false));
  }, [selectedAssessment]);

  const viewSubmission = async (submission) => {
    const res = await submissionsAPI.get(submission.id);
    setViewModal({ open: true, submission: res.data });
  };

  const evaluated = submissions.filter(s => s.evaluation?.status === 'COMPLETED').length;
  const pending = submissions.length - evaluated;

  const columns = [
    { key: 'roll', header: 'Roll No', render: r => r.student?.rollNumber },
    { key: 'name', header: 'Student', render: r => `${r.student?.firstName} ${r.student?.lastName}` },
    { key: 'div', header: 'Div', render: r => r.student?.division?.name || '—' },
    { key: 'files', header: 'Files', render: r => <span className="text-xs text-primary-600">{r.files?.length || 0} file(s)</span> },
    { key: 'submitted', header: 'Submitted', render: r => r.submittedAt ? new Date(r.submittedAt).toLocaleDateString() : '—' },
    { key: 'total', header: 'Total Marks', render: r => r.evaluation?.totalMarks ? <span className="font-semibold text-gray-800">{r.evaluation.totalMarks}/30</span> : <span className="text-gray-400">—</span> },
    { key: 'grade', header: 'Grade', render: r => r.evaluation?.grade ? <StatusBadge status={r.evaluation.grade} /> : <span className="text-gray-400 text-xs">Pending</span> },
    { key: 'evalStatus', header: 'Eval Status', render: r => <StatusBadge status={r.evaluation?.status || 'PENDING'} /> },
    { key: 'actions', header: '', render: r => (
      <button className="btn-ghost text-xs py-1" onClick={() => viewSubmission(r)}>
        <Eye size={13} />View
      </button>
    )},
  ];

  return (
    <div className="space-y-6">
      <div className="page-header">
        <div><h1 className="text-xl font-bold text-gray-900">Teacher Evaluation</h1><p className="text-sm text-gray-500 mt-0.5">Admin view of student evaluations and rubric scores</p></div>
        <select className="select text-sm w-72" value={selectedAssessment} onChange={e => setSelectedAssessment(e.target.value)}>
          <option value="">Select assessment...</option>
          {assessments.map(a => <option key={a.id} value={a.id}>{a.title}</option>)}
        </select>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div className="card p-4"><p className="text-2xl font-bold text-gray-800">{submissions.length}</p><p className="text-xs text-gray-500 mt-0.5 flex items-center gap-1"><ClipboardCheck size={12} />Total Submissions</p></div>
        <div className="card p-4"><p className="text-2xl font-bold text-green-600">{evaluated}</p><p className="text-xs text-gray-500 mt-0.5 flex items-center gap-1"><CheckCircle size={12} />Evaluated</p></div>
        <div className="card p-4"><p className="text-2xl font-bold text-amber-600">{pending}</p><p className="text-xs text-gray-500 mt-0.5 flex items-center gap-1"><Clock size={12} />Pending</p></div>
      </div>

      {loading ? <PageLoader /> : (
        <DataTable columns={columns} data={submissions} searchPlaceholder="Search students..." emptyMessage="No submissions for this assessment." />
      )}

      {/* View Evaluation Modal */}
      <Modal open={viewModal.open} onClose={() => setViewModal({ open: false, submission: null })} title="Student Evaluation Details" size="xl">
        {viewModal.submission && (
          <div className="space-y-4">
            <div className="flex items-center gap-4 p-3 bg-gray-50 rounded-lg">
              <div><p className="text-sm font-bold text-gray-800">{viewModal.submission.student?.firstName} {viewModal.submission.student?.lastName}</p><p className="text-xs text-gray-500">{viewModal.submission.student?.rollNumber}</p></div>
              {viewModal.submission.evaluation && (
                <div className="ml-auto flex items-center gap-3">
                  <div className="text-right"><p className="text-2xl font-bold text-gray-900">{viewModal.submission.evaluation.totalMarks}/30</p><p className="text-xs text-gray-500">Total Score</p></div>
                  <StatusBadge status={viewModal.submission.evaluation.grade} />
                </div>
              )}
            </div>
            {viewModal.submission.evaluation?.scores?.length > 0 && (
              <table className="min-w-full">
                <thead><tr><th className="table-th">Criterion</th><th className="table-th">Max</th><th className="table-th">Awarded</th><th className="table-th">Level</th></tr></thead>
                <tbody>
                  {viewModal.submission.evaluation.scores.map(score => (
                    <tr key={score.id} className="hover:bg-gray-50">
                      <td className="table-td text-sm">{score.criterion?.title}</td>
                      <td className="table-td text-xs">{score.criterion?.maxMarks}</td>
                      <td className="table-td text-sm font-bold">{score.marksAwarded}</td>
                      <td className="table-td"><StatusBadge status={score.levelLabel} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {viewModal.submission.evaluation?.feedback && (
              <div className="p-3 bg-blue-50 rounded-lg"><p className="text-xs font-medium text-blue-700">Teacher Feedback</p><p className="text-sm text-blue-800 mt-1">{viewModal.submission.evaluation.feedback}</p></div>
            )}
            {!viewModal.submission.evaluation && <div className="text-center py-8 text-gray-400"><p className="text-sm">This submission has not been evaluated yet.</p></div>}
          </div>
        )}
      </Modal>
    </div>
  );
}
