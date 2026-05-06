import { useState, useEffect } from 'react';
import { accreditationAPI } from '../services/api';
import StatusBadge from '../components/shared/StatusBadge';
import { PageLoader } from '../components/shared/LoadingSpinner';
import { Shield, Download, Check, FileText, Archive, Zap, Trash2 } from 'lucide-react';

const EVIDENCE_ITEMS = [
  { key: 'rubric_matrix', label: 'Rubric Matrix', formats: ['PDF', 'XLSX'], category: 'Assessment' },
  { key: 'student_files', label: 'Student Uploaded Files', formats: ['ZIP'], category: 'Evidence' },
  { key: 'teacher_eval', label: 'Teacher Evaluation Sheets', formats: ['PDF'], category: 'Evaluation' },
  { key: 'criterion_marks', label: 'Criterion-wise Marks', formats: ['XLSX'], category: 'Evaluation' },
  { key: 'teacher_feedback', label: 'Teacher Feedback', formats: ['PDF'], category: 'Evaluation' },
  { key: 'mapping_sheet', label: 'Mapping Confirmation Sheet', formats: ['PDF'], category: 'Mapping' },
  { key: 'validation_summary', label: 'Validation Summary', formats: ['PDF'], category: 'Validation' },
  { key: 'eval_report', label: 'Evaluation-wise Report', formats: ['PDF'], category: 'Reports' },
  { key: 'semester_report', label: 'Semester Report', formats: ['PDF'], category: 'Reports' },
  { key: 'annual_report', label: 'Annual Report', formats: ['PDF'], category: 'Reports' },
  { key: 'individual_reports', label: 'Individual Student Reports', formats: ['ZIP'], category: 'Reports' },
  { key: 'division_reports', label: 'Division-wise Reports', formats: ['PDF'], category: 'Reports' },
  { key: 'co_attainment', label: 'CO Attainment Report', formats: ['PDF'], category: 'OBE' },
  { key: 'co_po_report', label: 'CO-PO / PSO Report', formats: ['PDF'], category: 'OBE' },
  { key: 'blooms_report', label: "Bloom's Taxonomy Report", formats: ['PDF'], category: 'OBE' },
  { key: 'slow_learner', label: 'Slow/Advanced Learner Report', formats: ['PDF'], category: 'Reports' },
  { key: 'compliance_report', label: 'Submission Compliance Report', formats: ['PDF'], category: 'Compliance' },
  { key: 'evidence_audit', label: 'Evidence Preservation Audit Report', formats: ['PDF'], category: 'Compliance' },
  { key: 'ci_report', label: 'Continuous Improvement Report', formats: ['PDF'], category: 'CQI' },
  { key: 'audit_log', label: 'Audit Log', formats: ['XLSX'], category: 'Admin' },
];

export default function Accreditation() {
  const [checklist, setChecklist] = useState([]);
  const [completeness, setCompleteness] = useState(0);
  const [archives, setArchives] = useState([]);
  const [selected, setSelected] = useState(new Set(EVIDENCE_ITEMS.map(i => i.key)));
  const [format, setFormat] = useState('PDF');
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);

  useEffect(() => {
    Promise.all([accreditationAPI.getChecklist(), accreditationAPI.getArchives()])
      .then(([cRes, aRes]) => { setChecklist(cRes.data.checklist); setCompleteness(cRes.data.completeness); setArchives(aRes.data); })
      .finally(() => setLoading(false));
  }, []);

  const toggleItem = (key) => {
    setSelected(prev => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  };

  const handleGenerate = async () => {
    setGenerating(true);
    try {
      await accreditationAPI.generate({
        title: `Accreditation Evidence Pack — ${new Date().toLocaleDateString()}`,
        archiveType: 'ACCREDITATION',
        components: Array.from(selected),
        description: `Generated with ${selected.size} components in ${format} format`,
      });
      const res = await accreditationAPI.getArchives();
      setArchives(res.data);
      setTimeout(() => window.print(), 300);
    } catch {}
    finally { setGenerating(false); }
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Delete this archive record?')) return;
    try {
      await accreditationAPI.deleteArchive(id);
      setArchives(prev => prev.filter(a => a.id !== id));
    } catch {}
  };

  if (loading) return <PageLoader />;

  const categories = [...new Set(EVIDENCE_ITEMS.map(i => i.category))];

  return (
    <div className="space-y-6">
      <div className="page-header">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Accreditation Evidence Pack</h1>
          <p className="text-sm text-gray-500 mt-0.5">Consolidate and export institutional evidence for NAAC, NBA, and OBE compliance</p>
        </div>
        <div className="flex items-center gap-2">
          {['NAAC', 'NBA', 'OBE', 'IQAC'].map(b => (
            <span key={b} className={`text-xs px-2.5 py-1 rounded-full font-medium border ${b === 'NAAC' ? 'bg-green-50 text-green-700 border-green-200' : b === 'NBA' ? 'bg-blue-50 text-blue-700 border-blue-200' : b === 'OBE' ? 'bg-purple-50 text-purple-700 border-purple-200' : 'bg-amber-50 text-amber-700 border-amber-200'}`}>
              {b} READY
            </span>
          ))}
        </div>
      </div>

      {/* Completeness Bar */}
      <div className="card p-4 flex items-center gap-4">
        <div className="flex-1">
          <div className="flex items-center justify-between mb-2">
            <p className="text-sm font-semibold text-gray-700">Evidence Completeness</p>
            <p className="text-lg font-bold text-gray-900">{completeness}%</p>
          </div>
          <div className="h-3 bg-gray-100 rounded-full overflow-hidden">
            <div className="h-full bg-gradient-to-r from-blue-500 to-green-500 rounded-full transition-all" style={{ width: `${completeness}%` }} />
          </div>
        </div>
        <div className="text-xs text-gray-500 shrink-0">{checklist.filter(c => c.status === 'COMPLETE').length}/{checklist.length} components ready</div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Evidence Selection */}
        <div className="lg:col-span-2 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-gray-800">Select Evidence Components</h3>
            <button className="text-xs text-primary-600 hover:underline" onClick={() => setSelected(new Set(EVIDENCE_ITEMS.map(i => i.key)))}>
              Select All
            </button>
          </div>

          {categories.map(cat => (
            <div key={cat} className="card overflow-hidden">
              <div className="px-4 py-2.5 bg-gray-50 border-b border-gray-100">
                <p className="text-xs font-semibold text-gray-600 uppercase tracking-wider">{cat}</p>
              </div>
              <div className="grid grid-cols-2 gap-0 divide-y divide-gray-50">
                {EVIDENCE_ITEMS.filter(i => i.category === cat).map(item => {
                  const checked = selected.has(item.key);
                  const status = checklist.find(c => c.item === item.label)?.status || 'PENDING';
                  return (
                    <label key={item.key} className={`flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-gray-50 transition-colors ${checked ? 'bg-blue-50/30' : ''}`}>
                      <input type="checkbox" checked={checked} onChange={() => toggleItem(item.key)} className="rounded border-gray-300 text-primary-600" />
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium text-gray-800 truncate">{item.label}</p>
                        <p className="text-xs text-gray-400">{item.formats.join(', ')}</p>
                      </div>
                      {status === 'COMPLETE' && <Check size={14} className="text-green-500 shrink-0" />}
                    </label>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        {/* Export Panel */}
        <div className="space-y-4">
          <div className="card p-5 space-y-4 sticky top-20">
            <h3 className="font-semibold text-gray-800">Export Settings</h3>

            <div>
              <p className="label">Output Format</p>
              <div className="grid grid-cols-3 gap-2">
                {['PDF', 'EXCEL', 'ZIP'].map(f => (
                  <button key={f} onClick={() => setFormat(f)} className={`py-2 text-xs font-semibold rounded-lg border transition-all ${format === f ? 'bg-primary-600 text-white border-primary-600' : 'bg-white text-gray-600 border-gray-200 hover:border-gray-300'}`}>
                    {f}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-2 text-xs text-gray-600 border-t border-gray-100 pt-3">
              <div className="flex justify-between"><span>Selected Files</span><span className="font-semibold">{selected.size}</span></div>
              <div className="flex justify-between"><span>Estimated Size</span><span className="font-semibold">~{(selected.size * 0.8).toFixed(1)} MB</span></div>
              <div className="flex justify-between"><span>Generation Time</span><span className="font-semibold">~{selected.size * 3}s</span></div>
            </div>

            <button className="btn-primary w-full justify-center py-3" onClick={handleGenerate} disabled={generating || selected.size === 0}>
              {generating ? (
                <span className="flex items-center gap-2"><span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />Generating...</span>
              ) : (
                <><Zap size={15} />Generate &amp; Download Pack</>
              )}
            </button>
            <p className="text-xs text-center text-gray-400">Pack will be digitally time-stamped for audit trail</p>

            {/* Department Context */}
            <div className="border-t border-gray-100 pt-3 space-y-2">
              <p className="text-xs font-semibold text-gray-700">Department Context</p>
              {[
                { label: 'Institution', value: 'RubriQ Institute of Management' },
                { label: 'Program', value: 'MBA Finance' },
                { label: 'Semester', value: 'Semester 1, 2026-27' },
              ].map(row => (
                <div key={row.label} className="flex justify-between text-xs">
                  <span className="text-gray-400">{row.label}</span>
                  <span className="font-medium text-gray-700 text-right max-w-[150px] truncate">{row.value}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Previous Downloads */}
      {archives.length > 0 && (
        <div className="card overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-100">
            <h3 className="font-semibold text-gray-800">Previous Downloads</h3>
          </div>
          <table className="min-w-full">
            <thead><tr><th className="table-th">Pack Title</th><th className="table-th">Date</th><th className="table-th">Components</th><th className="table-th">Generated By</th><th className="table-th">Status</th><th className="table-th">Actions</th></tr></thead>
            <tbody>
              {archives.map(a => (
                <tr key={a.id} className="hover:bg-gray-50">
                  <td className="table-td text-sm font-medium">{a.title}</td>
                  <td className="table-td text-xs text-gray-500">{new Date(a.createdAt).toLocaleDateString()}</td>
                  <td className="table-td text-xs">{Array.isArray(a.components) ? a.components.length : '—'} components</td>
                  <td className="table-td text-xs">{a.generatedBy ? `${a.generatedBy.firstName} ${a.generatedBy.lastName}` : 'System'}</td>
                  <td className="table-td"><StatusBadge status={a.status} /></td>
                  <td className="table-td">
                    <div className="flex items-center gap-2">
                      <button onClick={() => window.print()} className="btn-ghost py-1 text-xs"><Download size={13} />Download</button>
                      <button onClick={() => handleDelete(a.id)} className="btn-ghost py-1 text-xs text-red-500 hover:bg-red-50"><Trash2 size={13} />Delete</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
