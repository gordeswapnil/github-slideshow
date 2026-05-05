import { useState, useEffect } from 'react';
import { institutionsAPI, departmentsAPI } from '../services/api';
import DataTable from '../components/shared/DataTable';
import Modal from '../components/shared/Modal';
import StatusBadge from '../components/shared/StatusBadge';
import FormSection, { FormGrid, FormField } from '../components/shared/FormSection';
import { Plus, Building2, Edit2, Settings2 } from 'lucide-react';
import { PageLoader } from '../components/shared/LoadingSpinner';

export default function AcademicSetup() {
  const [tab, setTab] = useState('institutions');
  const [institutions, setInstitutions] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState({ open: false, type: '', data: null });
  const [form, setForm] = useState({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    Promise.all([institutionsAPI.list(), departmentsAPI.list()])
      .then(([iRes, dRes]) => { setInstitutions(iRes.data); setDepartments(dRes.data); })
      .finally(() => setLoading(false));
  }, []);

  const openModal = (type, data = null) => {
    setForm(data ? { ...data } : {});
    setError('');
    setModal({ open: true, type, data });
  };

  const handleSave = async () => {
    setSaving(true);
    setError('');
    try {
      if (modal.type === 'institution') {
        if (modal.data) await institutionsAPI.update(modal.data.id, form);
        else await institutionsAPI.create(form);
        const res = await institutionsAPI.list();
        setInstitutions(res.data);
      } else if (modal.type === 'department') {
        if (modal.data) await departmentsAPI.update(modal.data.id, form);
        else await departmentsAPI.create(form);
        const res = await departmentsAPI.list();
        setDepartments(res.data);
      }
      setModal({ open: false, type: '', data: null });
    } catch (err) {
      setError(err.response?.data?.error || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <PageLoader />;

  const instColumns = [
    { key: 'name', header: 'Institution Name', accessor: 'name' },
    { key: 'code', header: 'Code', accessor: 'code' },
    { key: 'accredBody', header: 'Accreditation', accessor: 'accredBody' },
    { key: 'depts', header: 'Departments', render: r => r._count?.departments || 0 },
    { key: 'status', header: 'Status', render: r => <StatusBadge status={r.isActive ? 'ACTIVE' : 'INACTIVE'} /> },
    { key: 'actions', header: '', render: r => (
      <button className="btn-ghost text-xs py-1" onClick={() => openModal('institution', r)}><Edit2 size={13} />Edit</button>
    )},
  ];

  const deptColumns = [
    { key: 'name', header: 'Department', accessor: 'name' },
    { key: 'code', header: 'Code', accessor: 'code' },
    { key: 'institution', header: 'Institution', accessor: r => r.institution?.name },
    { key: 'hod', header: 'HoD', accessor: 'hodName' },
    { key: 'programs', header: 'Programs', render: r => r._count?.programs || 0 },
    { key: 'status', header: 'Status', render: r => <StatusBadge status={r.isActive ? 'ACTIVE' : 'INACTIVE'} /> },
    { key: 'actions', header: '', render: r => (
      <button className="btn-ghost text-xs py-1" onClick={() => openModal('department', r)}><Edit2 size={13} />Edit</button>
    )},
  ];

  return (
    <div className="space-y-6">
      <div className="page-header">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Academic Setup</h1>
          <p className="text-sm text-gray-500 mt-0.5">Manage institutions and departments</p>
        </div>
        <div className="flex gap-2">
          <button className="btn-primary" onClick={() => openModal(tab === 'institutions' ? 'institution' : 'department')}>
            <Plus size={15} />
            Add {tab === 'institutions' ? 'Institution' : 'Department'}
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-gray-100 p-1 rounded-lg w-fit">
        {[['institutions', 'Institutions'], ['departments', 'Departments']].map(([key, label]) => (
          <button key={key} onClick={() => setTab(key)} className={`px-4 py-1.5 text-sm font-medium rounded-md transition-all ${tab === key ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500 hover:text-gray-700'}`}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'institutions' ? (
        <DataTable columns={instColumns} data={institutions} searchPlaceholder="Search institutions..." emptyMessage="No institutions found. Add your first institution." />
      ) : (
        <DataTable columns={deptColumns} data={departments} searchPlaceholder="Search departments..." emptyMessage="No departments found." />
      )}

      <Modal
        open={modal.open}
        onClose={() => setModal({ open: false, type: '', data: null })}
        title={modal.data ? `Edit ${modal.type}` : `Add ${modal.type}`}
        size="md"
        footer={
          <>
            <button className="btn-secondary" onClick={() => setModal({ open: false, type: '', data: null })}>Cancel</button>
            <button className="btn-primary" onClick={handleSave} disabled={saving}>{saving ? 'Saving...' : 'Save'}</button>
          </>
        }
      >
        {error && <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg">{error}</div>}
        {modal.type === 'institution' && (
          <FormSection>
            <FormGrid cols={2}>
              <FormField label="Institution Name" required>
                <input className="input" value={form.name || ''} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="Full institution name" />
              </FormField>
              <FormField label="Short Code" required>
                <input className="input" value={form.code || ''} onChange={e => setForm(f => ({ ...f, code: e.target.value }))} placeholder="e.g. RIMS" />
              </FormField>
            </FormGrid>
            <FormField label="Address">
              <textarea className="input" rows={2} value={form.address || ''} onChange={e => setForm(f => ({ ...f, address: e.target.value }))} placeholder="Full address" />
            </FormField>
            <FormGrid cols={2}>
              <FormField label="Website">
                <input className="input" value={form.website || ''} onChange={e => setForm(f => ({ ...f, website: e.target.value }))} placeholder="https://..." />
              </FormField>
              <FormField label="Accreditation Bodies">
                <input className="input" value={form.accredBody || ''} onChange={e => setForm(f => ({ ...f, accredBody: e.target.value }))} placeholder="NAAC, NBA, IQAC" />
              </FormField>
            </FormGrid>
          </FormSection>
        )}
        {modal.type === 'department' && (
          <FormSection>
            <FormField label="Institution" required>
              <select className="select" value={form.institutionId || ''} onChange={e => setForm(f => ({ ...f, institutionId: e.target.value }))}>
                <option value="">Select institution</option>
                {institutions.map(i => <option key={i.id} value={i.id}>{i.name}</option>)}
              </select>
            </FormField>
            <FormGrid cols={2}>
              <FormField label="Department Name" required>
                <input className="input" value={form.name || ''} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. Finance & FinTech" />
              </FormField>
              <FormField label="Code" required>
                <input className="input" value={form.code || ''} onChange={e => setForm(f => ({ ...f, code: e.target.value }))} placeholder="e.g. FIN-FINTECH" />
              </FormField>
            </FormGrid>
            <FormField label="Head of Department">
              <input className="input" value={form.hodName || ''} onChange={e => setForm(f => ({ ...f, hodName: e.target.value }))} placeholder="Dr. Name" />
            </FormField>
          </FormSection>
        )}
      </Modal>
    </div>
  );
}
