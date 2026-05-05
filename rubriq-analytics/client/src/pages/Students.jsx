import { useState, useEffect } from 'react';
import { studentsAPI, programsAPI, divisionsAPI } from '../services/api';
import DataTable from '../components/shared/DataTable';
import Modal from '../components/shared/Modal';
import StatusBadge from '../components/shared/StatusBadge';
import FormSection, { FormGrid, FormField } from '../components/shared/FormSection';
import FileUploadCard from '../components/shared/FileUploadCard';
import { PageLoader } from '../components/shared/LoadingSpinner';
import { Plus, Upload, Edit2, Trash2, Download, GraduationCap } from 'lucide-react';

export default function Students() {
  const [students, setStudents] = useState([]);
  const [programs, setPrograms] = useState([]);
  const [divisions, setDivisions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState({ open: false, type: '', data: null });
  const [form, setForm] = useState({});
  const [importFiles, setImportFiles] = useState([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [importResult, setImportResult] = useState(null);

  const load = () => {
    Promise.all([studentsAPI.list(), programsAPI.list(), divisionsAPI.list()])
      .then(([sRes, pRes, dRes]) => { setStudents(sRes.data); setPrograms(pRes.data); setDivisions(dRes.data); })
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const openModal = (type, data = null) => {
    setForm(data ? { ...data, programId: data.programId?.toString(), divisionId: data.divisionId?.toString() } : {});
    setError(''); setImportResult(null);
    setModal({ open: true, type, data });
  };

  const handleSave = async () => {
    setSaving(true); setError('');
    try {
      if (modal.data) await studentsAPI.update(modal.data.id, form);
      else await studentsAPI.create(form);
      load();
      setModal({ open: false, type: '', data: null });
    } catch (err) {
      setError(err.response?.data?.error || 'Save failed');
    } finally { setSaving(false); }
  };

  const handleImport = async () => {
    if (!importFiles[0]) return setError('Please select an Excel file');
    setSaving(true); setError(''); setImportResult(null);
    try {
      const fd = new FormData();
      fd.append('file', importFiles[0]);
      fd.append('programId', form.programId || programs[0]?.id);
      fd.append('divisionId', form.divisionId || '');
      const res = await studentsAPI.importExcel(fd);
      setImportResult(res.data);
      load();
    } catch (err) {
      setError(err.response?.data?.error || 'Import failed');
    } finally { setSaving(false); }
  };

  const handleDelete = async (id) => {
    if (!confirm('Deactivate this student?')) return;
    await studentsAPI.delete(id);
    load();
  };

  if (loading) return <PageLoader />;

  const columns = [
    { key: 'roll', header: 'Roll No', accessor: 'rollNumber' },
    { key: 'name', header: 'Student Name', render: r => `${r.firstName} ${r.lastName}` },
    { key: 'email', header: 'Email', accessor: 'email' },
    { key: 'program', header: 'Program', render: r => r.program?.code || '—' },
    { key: 'division', header: 'Division', render: r => r.division?.name || '—' },
    { key: 'batch', header: 'Batch', accessor: 'batch' },
    { key: 'submissions', header: 'Submissions', render: r => r._count?.submissions || 0 },
    { key: 'status', header: 'Status', render: r => <StatusBadge status={r.isActive ? 'ACTIVE' : 'INACTIVE'} /> },
    {
      key: 'actions', header: '', render: r => (
        <div className="flex items-center gap-1">
          <button className="btn-ghost p-1.5" onClick={() => openModal('edit', r)} title="Edit"><Edit2 size={13} /></button>
          <button className="btn-ghost p-1.5 text-red-500 hover:text-red-600" onClick={() => handleDelete(r.id)} title="Deactivate"><Trash2 size={13} /></button>
        </div>
      )
    },
  ];

  const totalActive = students.filter(s => s.isActive).length;

  return (
    <div className="space-y-6">
      <div className="page-header">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Student Management</h1>
          <p className="text-sm text-gray-500 mt-0.5">{totalActive} active students enrolled</p>
        </div>
        <div className="flex gap-2">
          <button className="btn-secondary" onClick={() => openModal('import')}>
            <Upload size={15} />Import Excel
          </button>
          <button className="btn-primary" onClick={() => openModal('add')}>
            <Plus size={15} />Add Student
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-3">
        {[
          { label: 'Total Enrolled', value: totalActive, color: 'text-blue-700', bg: 'bg-blue-50' },
          { label: 'With Submissions', value: students.filter(s => s._count?.submissions > 0).length, color: 'text-green-700', bg: 'bg-green-50' },
          { label: 'Evaluated', value: students.filter(s => s._count?.evaluations > 0).length, color: 'text-purple-700', bg: 'bg-purple-50' },
          { label: 'Pending', value: totalActive - students.filter(s => s._count?.submissions > 0).length, color: 'text-amber-700', bg: 'bg-amber-50' },
        ].map(s => (
          <div key={s.label} className={`card p-4 ${s.bg}`}>
            <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
            <p className="text-xs text-gray-600 mt-0.5">{s.label}</p>
          </div>
        ))}
      </div>

      <DataTable columns={columns} data={students} searchPlaceholder="Search by name or roll number..." emptyMessage="No students found. Add or import students." />

      {/* Add/Edit Modal */}
      <Modal
        open={modal.open && (modal.type === 'add' || modal.type === 'edit')}
        onClose={() => setModal({ open: false, type: '', data: null })}
        title={modal.type === 'edit' ? 'Edit Student' : 'Add Student'}
        footer={
          <>
            <button className="btn-secondary" onClick={() => setModal({ open: false, type: '', data: null })}>Cancel</button>
            <button className="btn-primary" onClick={handleSave} disabled={saving}>{saving ? 'Saving...' : 'Save'}</button>
          </>
        }
      >
        {error && <div className="mb-4 p-3 bg-red-50 border border-red-200 text-sm text-red-700 rounded-lg">{error}</div>}
        <FormSection>
          <FormGrid cols={2}>
            <FormField label="First Name" required>
              <input className="input" value={form.firstName || ''} onChange={e => setForm(f => ({ ...f, firstName: e.target.value }))} />
            </FormField>
            <FormField label="Last Name" required>
              <input className="input" value={form.lastName || ''} onChange={e => setForm(f => ({ ...f, lastName: e.target.value }))} />
            </FormField>
          </FormGrid>
          <FormField label="Roll Number" required>
            <input className="input" value={form.rollNumber || ''} onChange={e => setForm(f => ({ ...f, rollNumber: e.target.value }))} placeholder="e.g. MBA26001" />
          </FormField>
          <FormField label="Email">
            <input className="input" type="email" value={form.email || ''} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} />
          </FormField>
          <FormGrid cols={2}>
            <FormField label="Program" required>
              <select className="select" value={form.programId || ''} onChange={e => setForm(f => ({ ...f, programId: e.target.value }))}>
                <option value="">Select program</option>
                {programs.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </FormField>
            <FormField label="Division">
              <select className="select" value={form.divisionId || ''} onChange={e => setForm(f => ({ ...f, divisionId: e.target.value }))}>
                <option value="">Select division</option>
                {divisions.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </FormField>
          </FormGrid>
          <FormGrid cols={2}>
            <FormField label="Batch">
              <input className="input" value={form.batch || ''} onChange={e => setForm(f => ({ ...f, batch: e.target.value }))} placeholder="e.g. 2026-28" />
            </FormField>
            <FormField label="Phone">
              <input className="input" value={form.phone || ''} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} />
            </FormField>
          </FormGrid>
        </FormSection>
      </Modal>

      {/* Import Modal */}
      <Modal
        open={modal.open && modal.type === 'import'}
        onClose={() => setModal({ open: false, type: '', data: null })}
        title="Import Students from Excel"
        size="md"
        footer={
          <>
            <button className="btn-secondary" onClick={() => setModal({ open: false, type: '', data: null })}>Close</button>
            <button className="btn-primary" onClick={handleImport} disabled={saving}>{saving ? 'Importing...' : 'Import'}</button>
          </>
        }
      >
        {error && <div className="mb-4 p-3 bg-red-50 border border-red-200 text-sm text-red-700 rounded-lg">{error}</div>}
        {importResult && (
          <div className="mb-4 p-3 bg-green-50 border border-green-200 rounded-lg">
            <p className="text-sm font-medium text-green-700">Import Complete!</p>
            <p className="text-xs text-green-600 mt-1">{importResult.imported} imported · {importResult.skipped} skipped</p>
          </div>
        )}
        <FormSection>
          <div className="grid grid-cols-2 gap-4 mb-4">
            <FormField label="Program" required>
              <select className="select" value={form.programId || ''} onChange={e => setForm(f => ({ ...f, programId: e.target.value }))}>
                <option value="">Select program</option>
                {programs.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </FormField>
            <FormField label="Division">
              <select className="select" value={form.divisionId || ''} onChange={e => setForm(f => ({ ...f, divisionId: e.target.value }))}>
                <option value="">Select division</option>
                {divisions.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </FormField>
          </div>
          <FileUploadCard onFiles={setImportFiles} multiple={false} excelOnly />
          <div className="mt-3 p-3 bg-blue-50 rounded-lg border border-blue-100">
            <p className="text-xs font-semibold text-blue-700 mb-1">Required Excel Columns:</p>
            <p className="text-xs text-blue-600">RollNumber, FirstName, LastName, Email (optional), Phone (optional), Batch (optional)</p>
          </div>
        </FormSection>
      </Modal>
    </div>
  );
}
