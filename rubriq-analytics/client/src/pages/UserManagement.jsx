import { useState, useEffect } from 'react';
import { usersAPI } from '../services/api';
import DataTable from '../components/shared/DataTable';
import Modal from '../components/shared/Modal';
import StatusBadge from '../components/shared/StatusBadge';
import FormSection, { FormGrid, FormField } from '../components/shared/FormSection';
import { PageLoader } from '../components/shared/LoadingSpinner';
import { Plus, Edit2, UserCog, Lock } from 'lucide-react';

export default function UserManagement() {
  const [users, setUsers] = useState([]);
  const [roles, setRoles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState({ open: false, data: null });
  const [form, setForm] = useState({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const load = () => {
    Promise.all([usersAPI.list(), usersAPI.getRoles()])
      .then(([uR, rR]) => { setUsers(uR.data); setRoles(rR.data); })
      .finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, []);

  const handleSave = async () => {
    setSaving(true); setError('');
    try {
      if (modal.data) await usersAPI.update(modal.data.id, form);
      else await usersAPI.create(form);
      load(); setModal({ open: false, data: null });
    } catch (err) { setError(err.response?.data?.error || 'Save failed'); }
    finally { setSaving(false); }
  };

  if (loading) return <PageLoader />;

  const columns = [
    { key: 'name', header: 'Name', render: r => `${r.firstName} ${r.lastName}` },
    { key: 'email', header: 'Email', accessor: 'email' },
    { key: 'role', header: 'Role', render: r => <span className="text-xs bg-blue-50 text-blue-700 px-2.5 py-0.5 rounded-full font-medium">{r.role?.name}</span> },
    { key: 'lastLogin', header: 'Last Login', render: r => r.lastLogin ? new Date(r.lastLogin).toLocaleDateString() : 'Never' },
    { key: 'status', header: 'Status', render: r => <StatusBadge status={r.isActive ? 'ACTIVE' : 'INACTIVE'} /> },
    { key: 'created', header: 'Created', render: r => new Date(r.createdAt).toLocaleDateString() },
    { key: 'actions', header: '', render: r => <button className="btn-ghost text-xs py-1" onClick={() => { setForm({ ...r, roleId: r.role?.id?.toString() }); setError(''); setModal({ open: true, data: r }); }}><Edit2 size={12} />Edit</button> },
  ];

  return (
    <div className="space-y-6">
      <div className="page-header">
        <div>
          <h1 className="text-xl font-bold text-gray-900">User Management</h1>
          <p className="text-sm text-gray-500 mt-0.5">{users.length} users · Faculty, Student, HoD, and Reviewer modules activate in future phases</p>
        </div>
        <button className="btn-primary" onClick={() => { setForm({}); setError(''); setModal({ open: true, data: null }); }}><Plus size={15} />Add User</button>
      </div>

      <div className="card p-4 bg-amber-50 border border-amber-200">
        <p className="text-sm text-amber-800 flex items-center gap-2"><Lock size={14} />Phase 1 includes Admin login only. Faculty, Student, HoD, and Reviewer portal access will be enabled in future phases. User records are pre-configured here.</p>
      </div>

      <DataTable columns={columns} data={users} searchPlaceholder="Search users..." />

      <Modal open={modal.open} onClose={() => setModal({ open: false, data: null })} title={modal.data ? 'Edit User' : 'Add User'}
        footer={<><button className="btn-secondary" onClick={() => setModal({ open: false, data: null })}>Cancel</button><button className="btn-primary" onClick={handleSave} disabled={saving}>{saving ? 'Saving...' : 'Save'}</button></>}>
        {error && <div className="mb-4 p-3 bg-red-50 border border-red-200 text-sm text-red-700 rounded-lg">{error}</div>}
        <FormSection>
          <FormGrid cols={2}>
            <FormField label="First Name" required><input className="input" value={form.firstName || ''} onChange={e => setForm(f => ({ ...f, firstName: e.target.value }))} /></FormField>
            <FormField label="Last Name" required><input className="input" value={form.lastName || ''} onChange={e => setForm(f => ({ ...f, lastName: e.target.value }))} /></FormField>
          </FormGrid>
          <FormField label="Email" required><input className="input" type="email" value={form.email || ''} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} /></FormField>
          {!modal.data && <FormField label="Password" required><input className="input" type="password" value={form.password || ''} onChange={e => setForm(f => ({ ...f, password: e.target.value }))} placeholder="Min 8 characters" /></FormField>}
          <FormField label="Role" required>
            <select className="select" value={form.roleId || ''} onChange={e => setForm(f => ({ ...f, roleId: e.target.value }))}>
              <option value="">Select role</option>
              {roles.map(r => <option key={r.id} value={r.id}>{r.name} — {r.description}</option>)}
            </select>
          </FormField>
          {modal.data && <FormField label="Status"><select className="select" value={form.isActive ? 'true' : 'false'} onChange={e => setForm(f => ({ ...f, isActive: e.target.value === 'true' }))}><option value="true">Active</option><option value="false">Inactive</option></select></FormField>}
        </FormSection>
      </Modal>
    </div>
  );
}
