import { useState, useEffect } from 'react';
import { academicYearsAPI, semestersAPI, divisionsAPI, evalCyclesAPI } from '../services/api';
import DataTable from '../components/shared/DataTable';
import Modal from '../components/shared/Modal';
import StatusBadge from '../components/shared/StatusBadge';
import FormSection, { FormGrid, FormField } from '../components/shared/FormSection';
import { PageLoader } from '../components/shared/LoadingSpinner';
import { Plus, Edit2, Zap, Calendar } from 'lucide-react';

export default function EvaluationPlan() {
  const [tab, setTab] = useState('years');
  const [years, setYears] = useState([]);
  const [semesters, setSemesters] = useState([]);
  const [divisions, setDivisions] = useState([]);
  const [cycles, setCycles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState({ open: false, type: '', data: null });
  const [form, setForm] = useState({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const load = () => {
    Promise.all([academicYearsAPI.list(), semestersAPI.list(), divisionsAPI.list(), evalCyclesAPI.list()])
      .then(([yR, sR, dR, cR]) => { setYears(yR.data); setSemesters(sR.data); setDivisions(dR.data); setCycles(cR.data); })
      .finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, []);

  const openModal = (type, data = null) => { setForm(data || {}); setError(''); setModal({ open: true, type, data }); };

  const handleSave = async () => {
    setSaving(true); setError('');
    try {
      const fns = { year: [academicYearsAPI.create, academicYearsAPI.update], semester: [semestersAPI.create, semestersAPI.update], division: [divisionsAPI.create, divisionsAPI.update], cycle: [evalCyclesAPI.create, evalCyclesAPI.update] };
      const [createFn, updateFn] = fns[modal.type] || [];
      if (modal.data) await updateFn(modal.data.id, form);
      else await createFn(form);
      load(); setModal({ open: false, type: '', data: null });
    } catch (err) { setError(err.response?.data?.error || 'Save failed'); }
    finally { setSaving(false); }
  };

  const activate = async (type, id) => {
    const fns = { year: academicYearsAPI.activate, semester: semestersAPI.activate, cycle: evalCyclesAPI.activate };
    await fns[type]?.(id); load();
  };

  if (loading) return <PageLoader />;

  const tabs = [['years', 'Academic Years'], ['semesters', 'Semesters'], ['divisions', 'Divisions'], ['cycles', 'Eval Cycles']];

  const yearCols = [
    { key: 'label', header: 'Year', accessor: 'label' },
    { key: 'years', header: 'Period', render: r => `${r.startYear}–${r.endYear}` },
    { key: 'sems', header: 'Semesters', render: r => r._count?.semesters || 0 },
    { key: 'active', header: 'Status', render: r => <StatusBadge status={r.isActive ? 'ACTIVE' : 'INACTIVE'} /> },
    { key: 'actions', header: '', render: r => <div className="flex gap-1"><button className="btn-ghost text-xs py-1" onClick={() => openModal('year', r)}><Edit2 size={12} />Edit</button>{!r.isActive && <button className="btn-ghost text-xs py-1 text-green-600" onClick={() => activate('year', r.id)}><Zap size={12} />Activate</button>}</div> },
  ];

  const semCols = [
    { key: 'label', header: 'Semester', accessor: 'label' },
    { key: 'year', header: 'Academic Year', render: r => r.academicYear?.label },
    { key: 'start', header: 'Start', render: r => r.startDate ? new Date(r.startDate).toLocaleDateString() : '—' },
    { key: 'end', header: 'End', render: r => r.endDate ? new Date(r.endDate).toLocaleDateString() : '—' },
    { key: 'cycles', header: 'Eval Cycles', render: r => r._count?.evaluationCycles || 0 },
    { key: 'active', header: 'Status', render: r => <StatusBadge status={r.isActive ? 'ACTIVE' : 'INACTIVE'} /> },
    { key: 'actions', header: '', render: r => <div className="flex gap-1"><button className="btn-ghost text-xs py-1" onClick={() => openModal('semester', r)}><Edit2 size={12} />Edit</button>{!r.isActive && <button className="btn-ghost text-xs py-1 text-green-600" onClick={() => activate('semester', r.id)}><Zap size={12} />Activate</button>}</div> },
  ];

  const divCols = [
    { key: 'name', header: 'Division', accessor: 'name' },
    { key: 'capacity', header: 'Capacity', accessor: 'capacity' },
    { key: 'students', header: 'Students', render: r => r._count?.students || 0 },
    { key: 'active', header: 'Status', render: r => <StatusBadge status={r.isActive ? 'ACTIVE' : 'INACTIVE'} /> },
    { key: 'actions', header: '', render: r => <button className="btn-ghost text-xs py-1" onClick={() => openModal('division', r)}><Edit2 size={12} />Edit</button> },
  ];

  const cycleCols = [
    { key: 'label', header: 'Evaluation Cycle', accessor: 'label' },
    { key: 'sem', header: 'Semester', render: r => r.semester?.label },
    { key: 'start', header: 'Start', render: r => r.startDate ? new Date(r.startDate).toLocaleDateString() : '—' },
    { key: 'end', header: 'End', render: r => r.endDate ? new Date(r.endDate).toLocaleDateString() : '—' },
    { key: 'assessments', header: 'Assessments', render: r => r._count?.assessments || 0 },
    { key: 'active', header: 'Status', render: r => <StatusBadge status={r.isActive ? 'ACTIVE' : 'INACTIVE'} /> },
    { key: 'actions', header: '', render: r => <div className="flex gap-1"><button className="btn-ghost text-xs py-1" onClick={() => openModal('cycle', r)}><Edit2 size={12} />Edit</button>{!r.isActive && <button className="btn-ghost text-xs py-1 text-green-600" onClick={() => activate('cycle', r.id)}><Zap size={12} />Activate</button>}</div> },
  ];

  const dataMap = { years: [yearCols, years], semesters: [semCols, semesters], divisions: [divCols, divisions], cycles: [cycleCols, cycles] };
  const [cols, data] = dataMap[tab] || [];

  return (
    <div className="space-y-6">
      <div className="page-header">
        <div><h1 className="text-xl font-bold text-gray-900">Evaluation Plan</h1><p className="text-sm text-gray-500 mt-0.5">Configure academic calendar, semesters, divisions, and evaluation cycles</p></div>
        <button className="btn-primary" onClick={() => openModal(tab === 'years' ? 'year' : tab === 'semesters' ? 'semester' : tab === 'divisions' ? 'division' : 'cycle')}><Plus size={15} />Add</button>
      </div>
      <div className="flex gap-1 bg-gray-100 p-1 rounded-lg w-fit">
        {tabs.map(([k, l]) => <button key={k} onClick={() => setTab(k)} className={`px-4 py-1.5 text-sm font-medium rounded-md transition-all ${tab === k ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500'}`}>{l}</button>)}
      </div>
      {cols && <DataTable columns={cols} data={data} />}

      <Modal open={modal.open} onClose={() => setModal({ open: false, type: '', data: null })} title={modal.data ? 'Edit' : 'Add'}
        footer={<><button className="btn-secondary" onClick={() => setModal({ open: false, type: '', data: null })}>Cancel</button><button className="btn-primary" onClick={handleSave} disabled={saving}>{saving ? 'Saving...' : 'Save'}</button></>}>
        {error && <div className="mb-4 p-3 bg-red-50 border border-red-200 text-sm text-red-700 rounded-lg">{error}</div>}
        <FormSection>
          {modal.type === 'year' && <><FormField label="Label (e.g. 2026-27)" required><input className="input" value={form.label || ''} onChange={e => setForm(f => ({ ...f, label: e.target.value }))} /></FormField><FormGrid cols={2}><FormField label="Start Year"><input className="input" type="number" value={form.startYear || ''} onChange={e => setForm(f => ({ ...f, startYear: e.target.value }))} /></FormField><FormField label="End Year"><input className="input" type="number" value={form.endYear || ''} onChange={e => setForm(f => ({ ...f, endYear: e.target.value }))} /></FormField></FormGrid></>}
          {modal.type === 'semester' && <><FormField label="Academic Year" required><select className="select" value={form.academicYearId || ''} onChange={e => setForm(f => ({ ...f, academicYearId: e.target.value }))}><option value="">Select year</option>{years.map(y => <option key={y.id} value={y.id}>{y.label}</option>)}</select></FormField><FormGrid cols={2}><FormField label="Semester Number"><input className="input" type="number" value={form.number || ''} onChange={e => setForm(f => ({ ...f, number: e.target.value }))} /></FormField><FormField label="Label"><input className="input" value={form.label || ''} onChange={e => setForm(f => ({ ...f, label: e.target.value }))} /></FormField></FormGrid><FormGrid cols={2}><FormField label="Start Date"><input className="input" type="date" value={form.startDate?.split?.('T')?.[0] || ''} onChange={e => setForm(f => ({ ...f, startDate: e.target.value }))} /></FormField><FormField label="End Date"><input className="input" type="date" value={form.endDate?.split?.('T')?.[0] || ''} onChange={e => setForm(f => ({ ...f, endDate: e.target.value }))} /></FormField></FormGrid></>}
          {modal.type === 'division' && <><FormField label="Semester"><select className="select" value={form.semesterId || ''} onChange={e => setForm(f => ({ ...f, semesterId: e.target.value }))}><option value="">Select semester</option>{semesters.map(s => <option key={s.id} value={s.id}>{s.label} ({s.academicYear?.label})</option>)}</select></FormField><FormGrid cols={2}><FormField label="Division Name"><input className="input" value={form.name || ''} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. Division A" /></FormField><FormField label="Capacity"><input className="input" type="number" value={form.capacity || 60} onChange={e => setForm(f => ({ ...f, capacity: e.target.value }))} /></FormField></FormGrid></>}
          {modal.type === 'cycle' && <><FormField label="Semester"><select className="select" value={form.semesterId || ''} onChange={e => setForm(f => ({ ...f, semesterId: e.target.value }))}><option value="">Select semester</option>{semesters.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}</select></FormField><FormGrid cols={2}><FormField label="Cycle Number"><input className="input" type="number" value={form.number || ''} onChange={e => setForm(f => ({ ...f, number: e.target.value }))} /></FormField><FormField label="Label"><input className="input" value={form.label || ''} onChange={e => setForm(f => ({ ...f, label: e.target.value }))} /></FormField></FormGrid><FormGrid cols={2}><FormField label="Start Date"><input className="input" type="date" value={form.startDate?.split?.('T')?.[0] || ''} onChange={e => setForm(f => ({ ...f, startDate: e.target.value }))} /></FormField><FormField label="End Date"><input className="input" type="date" value={form.endDate?.split?.('T')?.[0] || ''} onChange={e => setForm(f => ({ ...f, endDate: e.target.value }))} /></FormField></FormGrid></>}
        </FormSection>
      </Modal>
    </div>
  );
}
