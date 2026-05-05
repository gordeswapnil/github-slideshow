import { useState, useEffect } from 'react';
import { assessmentsAPI, coursesAPI, evalCyclesAPI, divisionsAPI } from '../services/api';
import DataTable from '../components/shared/DataTable';
import Modal from '../components/shared/Modal';
import StatusBadge from '../components/shared/StatusBadge';
import FormSection, { FormGrid, FormField } from '../components/shared/FormSection';
import { PageLoader } from '../components/shared/LoadingSpinner';
import { Plus, Edit2, ClipboardList, Grid3X3 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

export default function Assessments() {
  const [assessments, setAssessments] = useState([]);
  const [courses, setCourses] = useState([]);
  const [cycles, setCycles] = useState([]);
  const [divisions, setDivisions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState({ open: false, data: null });
  const [form, setForm] = useState({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const navigate = useNavigate();

  const load = () => {
    Promise.all([assessmentsAPI.list(), coursesAPI.list(), evalCyclesAPI.list(), divisionsAPI.list()])
      .then(([aR, cR, eR, dR]) => { setAssessments(aR.data); setCourses(cR.data); setCycles(eR.data); setDivisions(dR.data); })
      .finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, []);

  const handleSave = async () => {
    setSaving(true); setError('');
    try {
      if (modal.data) await assessmentsAPI.update(modal.data.id, form);
      else await assessmentsAPI.create(form);
      load(); setModal({ open: false, data: null });
    } catch (err) { setError(err.response?.data?.error || 'Save failed'); }
    finally { setSaving(false); }
  };

  if (loading) return <PageLoader />;

  const columns = [
    { key: 'title', header: 'Assessment Title', accessor: 'title' },
    { key: 'course', header: 'Course', render: r => <span>{r.course?.code}<span className="text-gray-400 ml-1">{r.course?.name}</span></span> },
    { key: 'type', header: 'Type', accessor: 'type' },
    { key: 'cycle', header: 'Eval Cycle', render: r => r.evaluationCycle?.label },
    { key: 'division', header: 'Division', render: r => r.division?.name || 'All' },
    { key: 'marks', header: 'Total Marks', accessor: 'totalMarks' },
    { key: 'deadline', header: 'Deadline', render: r => r.submissionDeadline ? new Date(r.submissionDeadline).toLocaleDateString() : '—' },
    { key: 'rubric', header: 'Rubric', render: r => r.rubric ? <StatusBadge status={r.rubric.isPublished ? 'PUBLISHED' : 'DRAFT'} /> : <span className="text-xs text-gray-400">None</span> },
    { key: 'submissions', header: 'Submissions', render: r => r._count?.submissions || 0 },
    { key: 'actions', header: '', render: r => (
      <div className="flex gap-1">
        <button className="btn-ghost text-xs py-1" onClick={() => { setForm({ ...r }); setError(''); setModal({ open: true, data: r }); }}><Edit2 size={12} />Edit</button>
        {r.rubric && <button className="btn-ghost text-xs py-1 text-purple-600" onClick={() => navigate('/rubric-matrix')}><Grid3X3 size={12} />Rubric</button>}
      </div>
    )},
  ];

  return (
    <div className="space-y-6">
      <div className="page-header">
        <div><h1 className="text-xl font-bold text-gray-900">Assessments</h1><p className="text-sm text-gray-500 mt-0.5">{assessments.length} assessment{assessments.length !== 1 ? 's' : ''} configured</p></div>
        <button className="btn-primary" onClick={() => { setForm({}); setError(''); setModal({ open: true, data: null }); }}><Plus size={15} />New Assessment</button>
      </div>
      <DataTable columns={columns} data={assessments} searchPlaceholder="Search assessments..." emptyMessage="No assessments found. Create your first assessment." />

      <Modal open={modal.open} onClose={() => setModal({ open: false, data: null })} title={modal.data ? 'Edit Assessment' : 'New Assessment'} size="lg"
        footer={<><button className="btn-secondary" onClick={() => setModal({ open: false, data: null })}>Cancel</button><button className="btn-primary" onClick={handleSave} disabled={saving}>{saving ? 'Saving...' : 'Save'}</button></>}>
        {error && <div className="mb-4 p-3 bg-red-50 border border-red-200 text-sm text-red-700 rounded-lg">{error}</div>}
        <FormSection>
          <FormField label="Assessment Title" required><input className="input" value={form.title || ''} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} /></FormField>
          <FormGrid cols={2}>
            <FormField label="Course" required><select className="select" value={form.courseId || ''} onChange={e => setForm(f => ({ ...f, courseId: e.target.value }))}><option value="">Select course</option>{courses.map(c => <option key={c.id} value={c.id}>{c.code} — {c.name}</option>)}</select></FormField>
            <FormField label="Evaluation Cycle" required><select className="select" value={form.evaluationCycleId || ''} onChange={e => setForm(f => ({ ...f, evaluationCycleId: e.target.value }))}><option value="">Select cycle</option>{cycles.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}</select></FormField>
          </FormGrid>
          <FormGrid cols={3}>
            <FormField label="Assessment Type"><input className="input" value={form.type || ''} onChange={e => setForm(f => ({ ...f, type: e.target.value }))} placeholder="e.g. Assignment" /></FormField>
            <FormField label="Total Marks"><input className="input" type="number" value={form.totalMarks || 30} onChange={e => setForm(f => ({ ...f, totalMarks: e.target.value }))} /></FormField>
            <FormField label="Passing Marks"><input className="input" type="number" value={form.passingMarks || 12} onChange={e => setForm(f => ({ ...f, passingMarks: e.target.value }))} /></FormField>
          </FormGrid>
          <FormGrid cols={2}>
            <FormField label="Division"><select className="select" value={form.divisionId || ''} onChange={e => setForm(f => ({ ...f, divisionId: e.target.value }))}><option value="">All Divisions</option>{divisions.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}</select></FormField>
            <FormField label="Submission Deadline"><input className="input" type="date" value={form.submissionDeadline?.split?.('T')?.[0] || ''} onChange={e => setForm(f => ({ ...f, submissionDeadline: e.target.value }))} /></FormField>
          </FormGrid>
          <FormField label="Description"><textarea className="input" rows={2} value={form.description || ''} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} /></FormField>
        </FormSection>
      </Modal>
    </div>
  );
}
