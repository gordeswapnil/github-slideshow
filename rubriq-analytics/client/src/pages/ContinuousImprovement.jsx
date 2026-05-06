import { useState, useEffect } from 'react';
import { ciAPI } from '../services/api';
import Modal from '../components/shared/Modal';
import StatusBadge from '../components/shared/StatusBadge';
import FormSection, { FormGrid, FormField } from '../components/shared/FormSection';
import { PageLoader } from '../components/shared/LoadingSpinner';
import { Plus, Edit2, Trash2, RefreshCw, Download, ChevronRight, Check, AlertTriangle, Wrench, Eye } from 'lucide-react';

const STATUS_OPTIONS = ['PLANNED', 'IN_PROGRESS', 'COMPLETED', 'REVIEWED'];

export default function ContinuousImprovement() {
  const [data, setData] = useState({ actions: [], stats: {} });
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState({ open: false, data: null });
  const [form, setForm] = useState({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const load = () => {
    ciAPI.list().then(res => setData(res.data)).finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, []);

  const openModal = (data = null) => {
    setForm(data ? { ...data } : { status: 'PLANNED' });
    setError('');
    setModal({ open: true, data });
  };

  const handleSave = async () => {
    setSaving(true); setError('');
    try {
      if (modal.data) await ciAPI.update(modal.data.id, form);
      else await ciAPI.create(form);
      load();
      setModal({ open: false, data: null });
    } catch (err) {
      setError(err.response?.data?.error || 'Save failed');
    } finally { setSaving(false); }
  };

  const handleDelete = async (id) => {
    if (!confirm('Delete this action?')) return;
    await ciAPI.delete(id);
    load();
  };

  if (loading) return <PageLoader />;

  const { actions, stats } = data;

  const CQI_STEPS = [
    { num: 1, label: 'Assessment', icon: Check, active: true, done: true },
    { num: 2, label: 'Analysis', icon: Check, active: true, done: true },
    { num: 3, label: 'Weakness Identified', icon: AlertTriangle, active: true, done: false, current: true },
    { num: 4, label: 'Action Taken', icon: Wrench, active: false, done: false },
    { num: 5, label: 'Reassessment', icon: RefreshCw, active: false, done: false },
  ];

  return (
    <div className="space-y-6">
      <div className="page-header">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Continuous Quality Improvement (CQI)</h1>
          <p className="text-sm text-gray-500 mt-0.5">Closing the loop for NBA/NAAC compliance in MBA Finance</p>
        </div>
        <div className="flex gap-2">
          <button className="btn-secondary text-sm" onClick={() => window.print()}><Download size={14} />Export CQI Report</button>
          <button className="btn-primary text-sm" onClick={() => openModal()}>
            <Plus size={14} />Add Improvement Action
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* CQI Process Cycle */}
        <div className="space-y-4">
          <div className="card p-5">
            <h3 className="font-semibold text-gray-800 mb-4">CQI Process Cycle</h3>
            <div className="space-y-2">
              {CQI_STEPS.map((step, i) => {
                const Icon = step.icon;
                return (
                  <div key={i} className={`flex items-center gap-3 p-3 rounded-xl border transition-all ${step.current ? 'border-red-200 bg-red-50' : step.done ? 'border-green-200 bg-green-50' : 'border-gray-100 bg-gray-50'}`}>
                    <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${step.current ? 'bg-red-100 text-red-600' : step.done ? 'bg-green-100 text-green-600' : 'bg-gray-100 text-gray-400'}`}>
                      <Icon size={16} />
                    </div>
                    <div>
                      <p className={`text-xs ${step.current ? 'text-red-600 font-semibold' : step.done ? 'text-green-700 font-medium' : 'text-gray-400'}`}>Step {step.num}</p>
                      <p className={`text-sm font-medium ${step.current ? 'text-red-700' : step.done ? 'text-green-800' : 'text-gray-400'}`}>{step.label}</p>
                    </div>
                    {step.current && <span className="ml-auto text-xs bg-red-500 text-white rounded-full w-2 h-2 animate-pulse" />}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Stats */}
          <div className="card p-5">
            <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Current Cycle Status</h3>
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-red-50 rounded-lg p-3 text-center">
                <p className="text-2xl font-bold text-red-600">{stats.weaknesses || 0}</p>
                <p className="text-xs text-gray-500 mt-0.5">Weaknesses</p>
              </div>
              <div className="bg-blue-50 rounded-lg p-3 text-center">
                <p className="text-2xl font-bold text-blue-600">{stats.total || 0}</p>
                <p className="text-xs text-gray-500 mt-0.5">Actions Planned</p>
              </div>
              <div className="col-span-2 bg-gray-50 rounded-lg p-3">
                <div className="flex items-center justify-between mb-1">
                  <p className="text-xs text-gray-500">Completed Reviews</p>
                  <p className="text-lg font-bold text-gray-700">{stats.completed || 0}</p>
                </div>
                <div className="relative w-16 h-16 mx-auto">
                  <svg viewBox="0 0 36 36" className="w-full h-full -rotate-90">
                    <path d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" fill="none" stroke="#e5e7eb" strokeWidth="3" />
                    <path d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" fill="none" stroke="#16a34a" strokeWidth="3" strokeDasharray={`${stats.total > 0 ? (stats.completed / stats.total) * 100 : 0}, 100`} />
                  </svg>
                  <div className="absolute inset-0 flex items-center justify-center">
                    <p className="text-xs font-bold text-gray-700">{stats.total > 0 ? Math.round((stats.completed / stats.total) * 100) : 0}%</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Actions Table */}
        <div className="lg:col-span-2 card overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
            <h3 className="font-semibold text-gray-800">Improvement Action Plan</h3>
            <button className="text-gray-400 hover:text-gray-600"><ChevronRight size={16} /></button>
          </div>

          {actions.length === 0 ? (
            <div className="p-12 text-center">
              <RefreshCw size={28} className="text-gray-300 mx-auto mb-3" />
              <p className="text-sm text-gray-500">No improvement actions yet. Add your first action.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full">
                <thead>
                  <tr>
                    <th className="table-th">Weak Area & Evidence</th>
                    <th className="table-th">Proposed Action</th>
                    <th className="table-th">Responsibility</th>
                    <th className="table-th">Timeline</th>
                    <th className="table-th">Status</th>
                    <th className="table-th">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {actions.map(action => (
                    <tr key={action.id} className={`hover:bg-gray-50 ${action.status === 'COMPLETED' ? 'opacity-75' : ''}`}>
                      <td className="table-td">
                        <p className={`text-sm font-medium ${action.status !== 'COMPLETED' ? 'text-red-600' : 'text-gray-500'}`}>{action.weakArea}</p>
                        {action.evidence && <p className="text-xs text-gray-400 flex items-center gap-1 mt-0.5"><span className="w-3 h-px bg-gray-300 inline-block" />{action.evidence}</p>}
                      </td>
                      <td className="table-td max-w-xs">
                        <p className={`text-xs ${action.status === 'COMPLETED' ? 'line-through text-gray-400' : 'text-gray-700'}`}>{action.proposedAction}</p>
                        {action.outcomeNote && <p className="text-xs text-green-600 mt-1 font-medium">{action.outcomeNote}</p>}
                      </td>
                      <td className="table-td text-xs text-gray-600">{action.responsibility || '—'}</td>
                      <td className="table-td text-xs text-gray-500">
                        {action.timelineStart ? new Date(action.timelineStart).toLocaleDateString('en-GB', { month: 'short', day: 'numeric' }) : '—'}
                        {action.timelineEnd ? ` - ${new Date(action.timelineEnd).toLocaleDateString('en-GB', { month: 'short', day: 'numeric' })}` : ''}
                      </td>
                      <td className="table-td"><StatusBadge status={action.status} /></td>
                      <td className="table-td">
                        <div className="flex items-center gap-1">
                          <button className="btn-ghost p-1.5" onClick={() => openModal(action)} title="Edit"><Edit2 size={13} /></button>
                          <button className="btn-ghost p-1.5 text-red-500" onClick={() => handleDelete(action.id)} title="Delete"><Trash2 size={13} /></button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="px-5 py-3 border-t border-gray-100 text-xs text-gray-400 text-center">
            Showing {actions.length} improvement action{actions.length !== 1 ? 's' : ''} for current context
          </div>
        </div>
      </div>

      <Modal
        open={modal.open}
        onClose={() => setModal({ open: false, data: null })}
        title={modal.data ? 'Edit Improvement Action' : 'Add Improvement Action'}
        size="lg"
        footer={
          <>
            <button className="btn-secondary" onClick={() => setModal({ open: false, data: null })}>Cancel</button>
            <button className="btn-primary" onClick={handleSave} disabled={saving}>{saving ? 'Saving...' : 'Save Action'}</button>
          </>
        }
      >
        {error && <div className="mb-4 p-3 bg-red-50 border border-red-200 text-sm text-red-700 rounded-lg">{error}</div>}
        <FormSection>
          <FormField label="Weak Area Identified" required>
            <input className="input" value={form.weakArea || ''} onChange={e => setForm(f => ({ ...f, weakArea: e.target.value }))} placeholder="e.g. Low attainment in CO3 (Financial Analysis)" />
          </FormField>
          <FormField label="Evidence Source">
            <input className="input" value={form.evidence || ''} onChange={e => setForm(f => ({ ...f, evidence: e.target.value }))} placeholder="e.g. Evaluation 2 Data" />
          </FormField>
          <FormField label="Proposed Action" required>
            <textarea className="input" rows={3} value={form.proposedAction || ''} onChange={e => setForm(f => ({ ...f, proposedAction: e.target.value }))} placeholder="Describe the corrective action..." />
          </FormField>
          <FormGrid cols={2}>
            <FormField label="Responsibility">
              <input className="input" value={form.responsibility || ''} onChange={e => setForm(f => ({ ...f, responsibility: e.target.value }))} placeholder="e.g. Dr. S. Mehta" />
            </FormField>
            <FormField label="Status">
              <select className="select" value={form.status || 'PLANNED'} onChange={e => setForm(f => ({ ...f, status: e.target.value }))}>
                {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
              </select>
            </FormField>
          </FormGrid>
          <FormGrid cols={2}>
            <FormField label="Timeline Start">
              <input className="input" type="date" value={form.timelineStart?.split?.('T')?.[0] || ''} onChange={e => setForm(f => ({ ...f, timelineStart: e.target.value }))} />
            </FormField>
            <FormField label="Timeline End">
              <input className="input" type="date" value={form.timelineEnd?.split?.('T')?.[0] || ''} onChange={e => setForm(f => ({ ...f, timelineEnd: e.target.value }))} />
            </FormField>
          </FormGrid>
          {form.status === 'COMPLETED' && (
            <FormField label="Outcome Note">
              <textarea className="input" rows={2} value={form.outcomeNote || ''} onChange={e => setForm(f => ({ ...f, outcomeNote: e.target.value }))} placeholder="Describe the outcome or result..." />
            </FormField>
          )}
        </FormSection>
      </Modal>
    </div>
  );
}
