import { useState, useEffect } from 'react';
import { programsAPI, coursesAPI, departmentsAPI } from '../services/api';
import DataTable from '../components/shared/DataTable';
import Modal from '../components/shared/Modal';
import StatusBadge from '../components/shared/StatusBadge';
import FormSection, { FormGrid, FormField } from '../components/shared/FormSection';
import { PageLoader } from '../components/shared/LoadingSpinner';
import { Plus, Edit2, Trash2, AlertTriangle } from 'lucide-react';

export default function ProgramsCourses() {
  const [tab, setTab] = useState('programs');
  const [programs, setPrograms] = useState([]);
  const [courses, setCourses] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState({ open: false, type: '', data: null });
  const [form, setForm] = useState({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [deleteConfirm, setDeleteConfirm] = useState(null); // { type, item }
  const [deleting, setDeleting] = useState(false);

  const load = () => {
    Promise.all([programsAPI.list(), coursesAPI.list(), departmentsAPI.list()])
      .then(([pRes, cRes, dRes]) => { setPrograms(pRes.data); setCourses(cRes.data); setDepartments(dRes.data); })
      .finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, []);

  const openModal = (type, data = null) => { setForm(data ? { ...data } : {}); setError(''); setModal({ open: true, type, data }); };

  const handleSave = async () => {
    setSaving(true); setError('');
    try {
      if (modal.type === 'program') {
        if (modal.data) await programsAPI.update(modal.data.id, form);
        else await programsAPI.create(form);
      } else {
        if (modal.data) await coursesAPI.update(modal.data.id, form);
        else await coursesAPI.create(form);
      }
      load(); setModal({ open: false, type: '', data: null });
    } catch (err) { setError(err.response?.data?.error || 'Save failed'); }
    finally { setSaving(false); }
  };

  const handleDelete = async () => {
    if (!deleteConfirm) return;
    setDeleting(true);
    try {
      if (deleteConfirm.type === 'program') await programsAPI.delete(deleteConfirm.item.id);
      else await coursesAPI.delete(deleteConfirm.item.id);
      load();
      setDeleteConfirm(null);
    } catch (err) {
      alert(err.response?.data?.error || 'Delete failed');
    } finally { setDeleting(false); }
  };

  if (loading) return <PageLoader />;

  const progCols = [
    { key: 'name', header: 'Program', accessor: 'name' },
    { key: 'code', header: 'Code', accessor: 'code' },
    { key: 'dept', header: 'Department', render: r => r.department?.name },
    { key: 'level', header: 'Level', accessor: 'level' },
    { key: 'duration', header: 'Duration', render: r => `${r.duration} years` },
    { key: 'courses', header: 'Courses', render: r => r._count?.courses || 0 },
    { key: 'students', header: 'Students', render: r => r._count?.students || 0 },
    { key: 'status', header: 'Status', render: r => <StatusBadge status={r.isActive ? 'ACTIVE' : 'INACTIVE'} /> },
    { key: 'actions', header: '', render: r => (
      <div className="flex gap-1">
        <button className="btn-ghost text-xs py-1" onClick={() => openModal('program', r)}><Edit2 size={13} />Edit</button>
        <button className="btn-ghost text-xs py-1 text-red-500 hover:text-red-700 hover:bg-red-50" onClick={() => setDeleteConfirm({ type: 'program', item: r })}><Trash2 size={13} />Delete</button>
      </div>
    )},
  ];

  const courseCols = [
    { key: 'name', header: 'Course', accessor: 'name' },
    { key: 'code', header: 'Code', accessor: 'code' },
    { key: 'program', header: 'Program', render: r => r.program?.code },
    { key: 'credits', header: 'Credits', accessor: 'credits' },
    { key: 'semester', header: 'Semester', render: r => r.semester || '—' },
    { key: 'assessments', header: 'Assessments', render: r => r._count?.assessments || 0 },
    { key: 'status', header: 'Status', render: r => <StatusBadge status={r.isActive ? 'ACTIVE' : 'INACTIVE'} /> },
    { key: 'actions', header: '', render: r => (
      <div className="flex gap-1">
        <button className="btn-ghost text-xs py-1" onClick={() => openModal('course', r)}><Edit2 size={13} />Edit</button>
        <button className="btn-ghost text-xs py-1 text-red-500 hover:text-red-700 hover:bg-red-50" onClick={() => setDeleteConfirm({ type: 'course', item: r })}><Trash2 size={13} />Delete</button>
      </div>
    )},
  ];

  return (
    <div className="space-y-6">
      <div className="page-header">
        <div><h1 className="text-xl font-bold text-gray-900">Programs &amp; Courses</h1><p className="text-sm text-gray-500 mt-0.5">Manage academic programs and their courses</p></div>
        <button className="btn-primary" onClick={() => openModal(tab === 'programs' ? 'program' : 'course')}><Plus size={15} />Add {tab === 'programs' ? 'Program' : 'Course'}</button>
      </div>
      <div className="flex gap-1 bg-gray-100 p-1 rounded-lg w-fit">
        {[['programs', 'Programs'], ['courses', 'Courses']].map(([k, l]) => (
          <button key={k} onClick={() => setTab(k)} className={`px-4 py-1.5 text-sm font-medium rounded-md transition-all ${tab === k ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500'}`}>{l}</button>
        ))}
      </div>
      {tab === 'programs' ? <DataTable columns={progCols} data={programs} searchPlaceholder="Search programs..." /> : <DataTable columns={courseCols} data={courses} searchPlaceholder="Search courses..." />}

      {/* Delete confirmation */}
      {deleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-white rounded-xl shadow-xl p-6 max-w-md w-full mx-4 space-y-4">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-full bg-red-100 flex items-center justify-center shrink-0">
                <AlertTriangle size={20} className="text-red-600" />
              </div>
              <div>
                <h3 className="font-semibold text-gray-900">Permanently delete {deleteConfirm.type}?</h3>
                <p className="text-sm text-gray-500 mt-1">
                  <span className="font-medium text-gray-800">{deleteConfirm.item.name} ({deleteConfirm.item.code})</span>
                  {deleteConfirm.type === 'program'
                    ? ` — This will delete all courses, assessments, submissions, marks, rubrics, students, and outcomes linked to this program.`
                    : ` — This will delete all assessments, submissions, marks, rubrics, and outcomes linked to this course.`}
                </p>
                <p className="text-xs text-red-600 font-medium mt-2">This action cannot be undone.</p>
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button className="btn-secondary" onClick={() => setDeleteConfirm(null)} disabled={deleting}>Cancel</button>
              <button
                className="px-4 py-2 text-sm font-medium rounded-lg bg-red-600 hover:bg-red-700 text-white disabled:opacity-50 flex items-center gap-1.5"
                onClick={handleDelete}
                disabled={deleting}
              >
                {deleting ? 'Deleting...' : <><Trash2 size={14} />Delete Permanently</>}
              </button>
            </div>
          </div>
        </div>
      )}

      <Modal open={modal.open} onClose={() => setModal({ open: false, type: '', data: null })} title={modal.data ? `Edit ${modal.type}` : `Add ${modal.type}`}
        footer={<><button className="btn-secondary" onClick={() => setModal({ open: false, type: '', data: null })}>Cancel</button><button className="btn-primary" onClick={handleSave} disabled={saving}>{saving ? 'Saving...' : 'Save'}</button></>}>
        {error && <div className="mb-4 p-3 bg-red-50 border border-red-200 text-sm text-red-700 rounded-lg">{error}</div>}
        <FormSection>
          {modal.type === 'program' ? (
            <>
              <FormField label="Department" required><select className="select" value={form.departmentId || ''} onChange={e => setForm(f => ({ ...f, departmentId: e.target.value }))}><option value="">Select department</option>{departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}</select></FormField>
              <FormGrid cols={2}><FormField label="Program Name" required><input className="input" value={form.name || ''} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} /></FormField><FormField label="Code" required><input className="input" value={form.code || ''} onChange={e => setForm(f => ({ ...f, code: e.target.value }))} /></FormField></FormGrid>
              <FormGrid cols={2}><FormField label="Level"><input className="input" value={form.level || ''} onChange={e => setForm(f => ({ ...f, level: e.target.value }))} placeholder="Postgraduate" /></FormField><FormField label="Duration (years)"><input className="input" type="number" value={form.duration || 2} onChange={e => setForm(f => ({ ...f, duration: e.target.value }))} /></FormField></FormGrid>
            </>
          ) : (
            <>
              <FormField label="Program" required><select className="select" value={form.programId || ''} onChange={e => setForm(f => ({ ...f, programId: e.target.value }))}><option value="">Select program</option>{programs.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></FormField>
              <FormGrid cols={2}><FormField label="Course Name" required><input className="input" value={form.name || ''} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} /></FormField><FormField label="Code" required><input className="input" value={form.code || ''} onChange={e => setForm(f => ({ ...f, code: e.target.value }))} /></FormField></FormGrid>
              <FormGrid cols={2}><FormField label="Credits"><input className="input" type="number" value={form.credits || 3} onChange={e => setForm(f => ({ ...f, credits: e.target.value }))} /></FormField><FormField label="Semester No."><input className="input" type="number" value={form.semester || ''} onChange={e => setForm(f => ({ ...f, semester: e.target.value }))} /></FormField></FormGrid>
              <FormField label="Description"><textarea className="input" rows={2} value={form.description || ''} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} /></FormField>
            </>
          )}
        </FormSection>
      </Modal>
    </div>
  );
}
