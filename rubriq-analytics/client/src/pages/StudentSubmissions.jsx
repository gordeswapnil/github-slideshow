import { useState, useEffect } from 'react';
import { submissionsAPI, assessmentsAPI } from '../services/api';
import DataTable from '../components/shared/DataTable';
import StatusBadge from '../components/shared/StatusBadge';
import { PageLoader } from '../components/shared/LoadingSpinner';
import { Eye, FileText, Mail, Download, Filter } from 'lucide-react';

export default function StudentSubmissions() {
  const [submissions, setSubmissions] = useState([]);
  const [assessments, setAssessments] = useState([]);
  const [selectedAssessment, setSelectedAssessment] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    assessmentsAPI.list().then(res => { setAssessments(res.data); if (res.data[0]) setSelectedAssessment(res.data[0].id.toString()); });
  }, []);

  useEffect(() => {
    if (!selectedAssessment) return;
    setLoading(true);
    submissionsAPI.list({ assessmentId: selectedAssessment }).then(res => setSubmissions(res.data)).finally(() => setLoading(false));
  }, [selectedAssessment]);

  const assessment = assessments.find(a => a.id.toString() === selectedAssessment);
  const total = submissions.length;
  const submitted = submissions.filter(s => s.status === 'SUBMITTED').length;
  const notSubmitted = submissions.filter(s => s.status === 'PENDING').length;
  const late = submissions.filter(s => s.isLate).length;
  const evaluated = submissions.filter(s => s.evaluation?.status === 'COMPLETED').length;
  const pending = submitted - evaluated;

  const columns = [
    { key: 'roll', header: 'Roll No', accessor: r => r.student?.rollNumber },
    { key: 'name', header: 'Student Name', render: r => `${r.student?.firstName} ${r.student?.lastName}` },
    { key: 'div', header: 'Div', render: r => r.student?.division?.name || '—' },
    { key: 'status', header: 'Submission Status', render: r => <StatusBadge status={r.status === 'SUBMITTED' && r.isLate ? 'LATE' : r.status} /> },
    { key: 'files', header: 'Files', render: r => r.files?.length > 0 ? <span className="text-xs text-primary-600 font-medium">{r.files.length} File{r.files.length > 1 ? 's' : ''}</span> : <span className="text-gray-300">—</span> },
    { key: 'submittedAt', header: 'Submitted At', render: r => r.submittedAt ? new Date(r.submittedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—' },
    { key: 'evalStatus', header: 'Evaluation Status', render: r => <StatusBadge status={r.evaluation?.status || 'PENDING'} /> },
    {
      key: 'actions', header: 'Actions', render: r => (
        <div className="flex items-center gap-1">
          {r.files?.length > 0 && <button className="btn-ghost p-1.5" title="View files"><Eye size={13} /></button>}
          <button className="btn-ghost p-1.5" title="Download"><Download size={13} /></button>
          {r.status === 'PENDING' && <button className="btn-ghost p-1.5 text-primary-500" title="Send reminder"><Mail size={13} /></button>}
        </div>
      )
    },
  ];

  return (
    <div className="space-y-6">
      <div className="page-header">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Student Submissions</h1>
          <p className="text-sm text-gray-500 mt-0.5">{assessment ? `${assessment.course?.name} — ${assessment.evaluationCycle?.label}` : 'Select an assessment'}</p>
        </div>
        <div className="flex gap-2">
          <select className="select text-sm w-72" value={selectedAssessment} onChange={e => setSelectedAssessment(e.target.value)}>
            <option value="">Select assessment...</option>
            {assessments.map(a => <option key={a.id} value={a.id}>{a.title}</option>)}
          </select>
          <button className="btn-secondary text-sm"><Download size={14} />Export</button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 md:grid-cols-6 gap-3">
        {[
          { label: 'Total Students', value: total, color: 'text-gray-700 bg-gray-50' },
          { label: 'Submitted', value: `${submitted} (${total ? Math.round((submitted/total)*100) : 0}%)`, color: 'text-green-700 bg-green-50' },
          { label: 'Not Submitted', value: notSubmitted, color: 'text-red-700 bg-red-50' },
          { label: 'Late', value: late, color: 'text-amber-700 bg-amber-50' },
          { label: 'Evaluated', value: `${evaluated}/${submitted}`, color: 'text-blue-700 bg-blue-50' },
          { label: 'Pending Eval', value: pending, color: 'text-purple-700 bg-purple-50' },
        ].map(s => (
          <div key={s.label} className={`card p-3 ${s.color}`}>
            <p className="text-xl font-bold">{s.value}</p>
            <p className="text-xs mt-0.5 text-gray-500">{s.label}</p>
          </div>
        ))}
      </div>

      {loading ? <PageLoader /> : (
        <DataTable
          columns={columns}
          data={submissions}
          searchPlaceholder="Search by roll number or name..."
          emptyMessage="No submissions found for this assessment."
        />
      )}
    </div>
  );
}
