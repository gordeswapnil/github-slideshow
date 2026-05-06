import { useState, useEffect } from 'react';
import { usersAPI } from '../services/api';
import DataTable from '../components/shared/DataTable';
import Modal from '../components/shared/Modal';
import StatusBadge from '../components/shared/StatusBadge';
import FormSection, { FormGrid, FormField } from '../components/shared/FormSection';
import { PageLoader } from '../components/shared/LoadingSpinner';
import { Plus, Edit2, RefreshCw, Mail, ShieldCheck } from 'lucide-react';

const ROLE_COLORS = {
  ADMIN: 'bg-purple-50 text-purple-700',
  FACULTY: 'bg-blue-50 text-blue-700',
  HOD: 'bg-green-50 text-green-700',
  STUDENT: 'bg-amber-50 text-amber-700',
  REVIEWER: 'bg-gray-50 text-gray-700',
};

export default function UserManagement() {
  const [users, setUsers] = useState([]);
  const [roles, setRoles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState({ open: false, data: null });
  const [form, setForm] = useState({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [resetting, setResetting] = useState(null);

  const load = () => {
    Promise.all([usersAPI.list(), usersAPI.getRoles()])
      .then(([uR, rR]) => { setUsers(uR.data); setRoles(rR.data.filter(r => r.name !== 'ADMIN')); })
      .finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, []);

  const handleSave = async () => {
    setSaving(true); setError('');
    try {
      if (modal.data) {
        await usersAPI.update(modal.data.id, form);
        setSuccessMsg('User updated successfully.');
      } else {
        await usersAPI.create(form);
        setSuccessMsg(`User created! Login credentials have been emailed to ${form.email}.`);
      }
      load(); setModal({ open: false, data: null });
      setTimeout(() => setSuccessMsg(''), 5000);
    } catch (err) { setError(err.response?.data?.error || 'Save failed'); }
    finally { setSaving(false); }
  };

  const handleResetPassword = async (user) => {
    if (!window.confirm(`Reset password for ${user.firstName} ${user.lastName} and send new credentials to ${user.email}?`)) return;
    setResetting(user.id);
    try {
      await usersAPI.resetPassword(user.id);
      setSuccessMsg(`New password emailed to ${user.email}.`);
      setTimeout(() => setSuccessMsg(''), 5000);
    } catch { setSuccessMsg('Password reset failed.'); }
    finally { setResetting(null); }
  };

  if (loading) return <PageLoader />;

  const columns = [
    { key: 'name', header: 'Name', render: r => <div><p className="font-medium text-sm text-gray-900">{r.firstName} {r.lastName}</p><p className="text-xs text-gray-400">{r.email}</p></div> },
    { key: 'role', header: 'Role', render: r => <span className={`text-xs px-2.5 py-0.5 rounded-full font-medium ${ROLE_COLORS[r.role?.name] || 'bg-gray-50 text-gray-700'}`}>{r.role?.name}</span> },
    { key: 'lastLogin', header: 'Last Login', render: r => r.lastLogin ? new Date(r.lastLogin).toLocaleDateString() : <span className="text-xs text-gray-400">Never</span> },
    { key: 'status', header: 'Status', render: r => <StatusBadge status={r.isActive ? 'ACTIVE' : 'INACTIVE'} /> },
    { key: 'created', header: 'Created', render: r => new Date(r.createdAt).toLocaleDateString() },
    {
      key: 'actions', header: '', render: r => (
        <div className="flex gap-1">
          <button className="btn-ghost text-xs py-1" onClick={() => { setForm({ ...r, roleId: r.role?.id?.toString() }); setError(''); setModal({ open: true, data: r }); }}><Edit2 size={12} />Edit</button>
          <button className="btn-ghost text-xs py-1" onClick={() => handleResetPassword(r)} disabled={resetting === r.id} title="Reset password & email">
            {resetting === r.id ? <RefreshCw size={12} className="animate-spin" /> : <RefreshCw size={12} />}Reset
          </button>
        </div>
      )
    },
  ];

  return (
    <div className="space-y-6">
      <div className="page-header">
        <div>
          <h1 className="text-xl font-bold text-gray-900">User Management</h1>
          <p className="text-sm text-gray-500 mt-0.5">{users.length} users · Credentials are emailed automatically on account creation</p>
        </div>
        <button className="btn-primary" onClick={() => { setForm({}); setError(''); setModal({ open: true, data: null }); }}><Plus size={15} />Add User</button>
      </div>

      {successMsg && (
        <div className="card p-4 bg-green-50 border border-green-200 flex items-center gap-2">
          <Mail size={16} className="text-green-600 shrink-0" />
          <p className="text-sm text-green-800">{successMsg}</p>
        </div>
      )}

      <div className="grid grid-cols-4 gap-3">
        {['FACULTY', 'HOD', 'STUDENT', 'REVIEWER'].map(role => (
          <div key={role} className="card p-4">
            <p className="text-2xl font-bold text-gray-900">{users.filter(u => u.role?.name === role).length}</p>
            <p className="text-xs text-gray-500 mt-0.5">{role}</p>
          </div>
        ))}
      </div>

      <div className="card p-4 bg-blue-50 border border-blue-200">
        <p className="text-sm text-blue-800 flex items-center gap-2">
          <ShieldCheck size={14} />
          When you create a user, a secure password is auto-generated and emailed to them. Use the Reset button to send new credentials anytime.
        </p>
      </div>

      <DataTable columns={columns} data={users} searchPlaceholder="Search users..." />

      <Modal open={modal.open} onClose={() => setModal({ open: false, data: null })} title={modal.data ? 'Edit User' : 'Add User'}
        footer={<><button className="btn-secondary" onClick={() => setModal({ open: false, data: null })}>Cancel</button><button className="btn-primary" onClick={handleSave} disabled={saving}>{saving ? 'Saving...' : modal.data ? 'Save Changes' : 'Create & Send Email'}</button></>}>
        {error && <div className="mb-4 p-3 bg-red-50 border border-red-200 text-sm text-red-700 rounded-lg">{error}</div>}
        {!modal.data && <div className="mb-4 p-3 bg-blue-50 border border-blue-200 text-sm text-blue-700 rounded-lg flex items-center gap-2"><Mail size={14} />A login password will be auto-generated and emailed to the user.</div>}
        <FormSection>
          <FormGrid cols={2}>
            <FormField label="First Name" required><input className="input" value={form.firstName || ''} onChange={e => setForm(f => ({ ...f, firstName: e.target.value }))} /></FormField>
            <FormField label="Last Name" required><input className="input" value={form.lastName || ''} onChange={e => setForm(f => ({ ...f, lastName: e.target.value }))} /></FormField>
          </FormGrid>
          <FormField label="Email" required><input className="input" type="email" value={form.email || ''} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} disabled={!!modal.data} /></FormField>
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
