import { useState, useEffect, useRef } from 'react';
import { externalExamAPI, coursesAPI, evalCyclesAPI, divisionsAPI } from '../services/api';
import { useFilters } from '../context/FilterContext';
import Modal from '../components/shared/Modal';
import FormSection, { FormGrid, FormField } from '../components/shared/FormSection';
import { PageLoader } from '../components/shared/LoadingSpinner';
import { FileSpreadsheet, Plus, Upload, Download, Trash2, Edit2, AlertCircle, CheckCircle, ChevronDown, ChevronRight } from 'lucide-react';

export default function ExternalExam() {
  const { filters } = useFilters();
  const [exams, setExams] = useState([]);
  const [courses, setCourses] = useState([]);
  const [cycles, setCycles] = useState([]);
  const [divisions, setDivisions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(null);
  const [expanded, setExpanded] = useState(null);
  const [modal, setModal] = useState({ open: false, type: '' });
  const [form, setForm] = useState({});
  const [qForm, setQForm] = useState({ number: '', text: '', coId: '', maxMarks: '' });
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadResult, setUploadResult] = useState(null);
  const [error, setError] = useState('');
  const fileRef = useRef();

  const load = async () => {
    const params = {};
    if (filters.courseId) params.courseId = filters.courseId;
    if (filters.semesterId) params.semesterId = filters.semesterId;
    if (filters.evalCycleId) params.evalCycleId = filters.evalCycleId;
    const [examRes, courseRes, divRes] = await Promise.all([
      externalExamAPI.list(params),
      coursesAPI.list(),
      divisionsAPI.list(),
    ]);
    setExams(examRes.data);
    setCourses(courseRes.data?.courses || courseRes.data || []);
    setDivisions(divRes.data);
    setLoading(false);
  };

  useEffect(() => { load(); }, [filters.courseId, filters.semesterId, filters.evalCycleId]);

  const loadCycles = async (semId) => {
    if (!semId) return;
    const res = await evalCyclesAPI.list({ semesterId: semId });
    setCycles(res.data);
  };

  const openCreate = () => { setForm({}); setError(''); setModal({ open: true, type: 'create' }); };
  const closeModal = () => { setModal({ open: false, type: '' }); setError(''); };

  const handleCreate = async () => {
    setSaving(true); setError('');
    try {
      await externalExamAPI.create(form);
      load(); closeModal();
    } catch (err) { setError(err.response?.data?.error || 'Create failed'); }
    finally { setSaving(false); }
  };

  const loadExam = async (id) => {
    const res = await externalExamAPI.get(id);
    setSelected(res.data);
    setExpanded(id);
  };

  const handleAddQuestion = async () => {
    if (!selected || !qForm.maxMarks) return;
    setSaving(true); setError('');
    try {
      await externalExamAPI.addQuestion(selected.id, { ...qForm, number: qForm.number || (selected.examQuestions?.length || 0) + 1 });
      await loadExam(selected.id);
      setQForm({ number: '', text: '', coId: '', maxMarks: '' });
    } catch (err) { setError(err.response?.data?.error || 'Failed'); }
    finally { setSaving(false); }
  };

  const handleDeleteQuestion = async (qid) => {
    if (!window.confirm('Delete this question?')) return;
    await externalExamAPI.deleteQuestion(selected.id, qid);
    await loadExam(selected.id);
  };

  const handleUpload = async (e) => {
    const file = e.target.files[0];
    if (!file || !selected) return;
    setUploading(true); setUploadResult(null); setError('');
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await externalExamAPI.uploadMarks(selected.id, fd);
      setUploadResult(res.data);
    } catch (err) { setError(err.response?.data?.error || 'Upload failed'); }
    finally { setUploading(false); e.target.value = ''; }
  };

  const handleTemplate = async () => {
    if (!selected) return;
    const res = await externalExamAPI.getTemplate(selected.id);
    const url = URL.createObjectURL(res.data);
    const a = document.createElement('a'); a.href = url; a.download = `exam-template-${selected.id}.xlsx`; a.click();
    URL.revokeObjectURL(url);
  };

  if (loading) return <PageLoader />;

  const totalMax = selected?.examQuestions?.reduce((s, q) => s + q.maxMarks, 0) || 0;
  const courseOutcomes = selected?.course?.courseOutcomes || [];

  return (
    <div className="space-y-6">
      <div className="page-header">
        <div>
          <h1 className="text-xl font-bold text-gray-900 flex items-center gap-2"><FileSpreadsheet size={20} className="text-primary-600" />External Exam Marks</h1>
          <p className="text-sm text-gray-500 mt-0.5">Upload end-semester question-wise marks with CO mapping for attainment calculation</p>
        </div>
        <button className="btn-primary" onClick={openCreate}><Plus size={15} />New Exam</button>
      </div>

      {error && <div className="p-3 bg-red-50 border border-red-200 text-sm text-red-700 rounded-lg flex gap-2"><AlertCircle size={16} className="shrink-0 mt-0.5" />{error}</div>}

      {/* Exam list */}
      <div className="space-y-3">
        {exams.length === 0 && (
          <div className="card p-10 text-center text-sm text-gray-400">No external exams yet. Click "New Exam" to create one.</div>
        )}
        {exams.map(exam => (
          <div key={exam.id} className="card overflow-hidden">
            <div className="px-5 py-4 flex items-center gap-4 cursor-pointer hover:bg-gray-50" onClick={() => { if (expanded === exam.id) { setExpanded(null); setSelected(null); } else loadExam(exam.id); }}>
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <p className="font-semibold text-gray-900 text-sm">{exam.title}</p>
                  <span className="text-xs bg-blue-50 text-blue-700 px-2 py-0.5 rounded-full">External</span>
                </div>
                <p className="text-xs text-gray-500 mt-0.5">{exam.course?.code} — {exam.evaluationCycle?.label} {exam.division ? `· ${exam.division.name}` : ''}</p>
              </div>
              <div className="flex items-center gap-4 text-xs text-gray-500">
                <span>{exam._count?.examQuestions || 0} questions</span>
                <span>Max: {exam.totalMarks} marks</span>
              </div>
              {expanded === exam.id ? <ChevronDown size={16} className="text-gray-400" /> : <ChevronRight size={16} className="text-gray-400" />}
            </div>

            {expanded === exam.id && selected && (
              <div className="border-t border-gray-100 p-5 space-y-5">
                {/* Question Table */}
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <p className="text-sm font-semibold text-gray-700">Questions & CO Mapping</p>
                    <span className="text-xs text-gray-500">Total: {totalMax} marks</span>
                  </div>
                  <table className="min-w-full text-sm border border-gray-100 rounded-lg overflow-hidden">
                    <thead className="bg-gray-50"><tr><th className="table-th w-12">Q No.</th><th className="table-th">Question / Description</th><th className="table-th w-24">CO Mapped</th><th className="table-th w-24">Max Marks</th><th className="table-th w-12"></th></tr></thead>
                    <tbody>
                      {selected.examQuestions?.map(q => (
                        <tr key={q.id} className="border-t border-gray-50">
                          <td className="table-td font-bold text-center text-primary-700">Q{q.number}</td>
                          <td className="table-td text-gray-600">{q.text || '—'}</td>
                          <td className="table-td"><span className={`text-xs px-2 py-0.5 rounded-full ${q.co ? 'bg-purple-50 text-purple-700' : 'bg-gray-100 text-gray-400'}`}>{q.co?.code || 'Not mapped'}</span></td>
                          <td className="table-td text-center font-semibold">{q.maxMarks}</td>
                          <td className="table-td"><button className="text-red-400 hover:text-red-600" onClick={() => handleDeleteQuestion(q.id)}><Trash2 size={13} /></button></td>
                        </tr>
                      ))}
                      {(!selected.examQuestions || selected.examQuestions.length === 0) && (
                        <tr><td colSpan={5} className="table-td text-center text-gray-400 py-4">No questions yet</td></tr>
                      )}
                    </tbody>
                  </table>

                  {/* Add Question row */}
                  <div className="mt-3 grid grid-cols-5 gap-2 items-end">
                    <div><label className="label text-xs">Q No.</label><input className="input text-xs" type="number" placeholder="1" value={qForm.number} onChange={e => setQForm(f => ({ ...f, number: e.target.value }))} /></div>
                    <div className="col-span-2"><label className="label text-xs">Description (optional)</label><input className="input text-xs" placeholder="e.g. Unit I — Journal entries" value={qForm.text} onChange={e => setQForm(f => ({ ...f, text: e.target.value }))} /></div>
                    <div><label className="label text-xs">CO Mapping</label>
                      <select className="select text-xs" value={qForm.coId} onChange={e => setQForm(f => ({ ...f, coId: e.target.value }))}>
                        <option value="">— Not mapped —</option>
                        {courseOutcomes.map(co => <option key={co.id} value={co.id}>{co.code}</option>)}
                      </select>
                    </div>
                    <div><label className="label text-xs">Max Marks</label><input className="input text-xs" type="number" placeholder="10" value={qForm.maxMarks} onChange={e => setQForm(f => ({ ...f, maxMarks: e.target.value }))} /></div>
                    <button className="btn-primary text-xs py-2" onClick={handleAddQuestion} disabled={saving}><Plus size={13} />Add</button>
                  </div>
                </div>

                {/* Upload section */}
                <div className="border-t border-gray-100 pt-4">
                  <p className="text-sm font-semibold text-gray-700 mb-3">Upload Student Marks (Excel)</p>
                  <div className="flex items-center gap-3">
                    <button className="btn-secondary text-xs" onClick={handleTemplate}><Download size={13} />Download Template</button>
                    <button className="btn-primary text-xs" onClick={() => fileRef.current.click()} disabled={uploading || !selected.examQuestions?.length}>
                      {uploading ? <><span className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />Uploading...</> : <><Upload size={13} />Upload Excel</>}
                    </button>
                    <input ref={fileRef} type="file" className="hidden" accept=".xlsx,.xls" onChange={handleUpload} />
                  </div>
                  <p className="text-xs text-gray-400 mt-2">Format: Roll Number | Student Name | Q1 marks | Q2 marks | ...</p>
                  {uploadResult && (
                    <div className={`mt-3 p-3 rounded-lg text-sm flex items-center gap-2 ${uploadResult.errors?.length ? 'bg-amber-50 border border-amber-200 text-amber-700' : 'bg-green-50 border border-green-200 text-green-700'}`}>
                      <CheckCircle size={16} />
                      <span>{uploadResult.imported} students imported.{uploadResult.errors?.length ? ` ${uploadResult.errors.length} rows skipped.` : ''}</span>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Create Exam Modal */}
      <Modal open={modal.open && modal.type === 'create'} onClose={closeModal} title="Create External Exam"
        footer={<><button className="btn-secondary" onClick={closeModal}>Cancel</button><button className="btn-primary" onClick={handleCreate} disabled={saving}>{saving ? 'Creating...' : 'Create'}</button></>}>
        {error && <div className="mb-3 p-3 bg-red-50 border border-red-200 text-sm text-red-700 rounded-lg">{error}</div>}
        <FormSection>
          <FormField label="Exam Title" required><input className="input" placeholder="e.g. Financial Accounting — End Sem 2025" value={form.title || ''} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} /></FormField>
          <FormGrid cols={2}>
            <FormField label="Course" required>
              <select className="select" value={form.courseId || ''} onChange={e => setForm(f => ({ ...f, courseId: e.target.value }))}>
                <option value="">Select course</option>
                {courses.map(c => <option key={c.id} value={c.id}>{c.code} — {c.name}</option>)}
              </select>
            </FormField>
            <FormField label="Evaluation Cycle" required>
              <select className="select" value={form.evaluationCycleId || ''} onChange={e => setForm(f => ({ ...f, evaluationCycleId: e.target.value }))}>
                <option value="">Select cycle</option>
                {cycles.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
              </select>
            </FormField>
          </FormGrid>
          <FormGrid cols={2}>
            <FormField label="Division">
              <select className="select" value={form.divisionId || ''} onChange={e => setForm(f => ({ ...f, divisionId: e.target.value }))}>
                <option value="">All divisions</option>
                {divisions.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </FormField>
            <FormField label="Total Marks">
              <input className="input" type="number" placeholder="100" value={form.totalMarks || ''} onChange={e => setForm(f => ({ ...f, totalMarks: e.target.value }))} />
            </FormField>
          </FormGrid>
          <FormField label="Description"><textarea className="input" rows={2} value={form.description || ''} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} /></FormField>
        </FormSection>
        <p className="text-xs text-gray-400 mt-2">After creating, add questions and CO mappings, then upload the Excel marks sheet.</p>
      </Modal>
    </div>
  );
}
