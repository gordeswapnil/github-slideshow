import { useState, useEffect } from 'react';
import { poDashboardAPI, programsAPI } from '../services/api';
import { useFilters } from '../context/FilterContext';
import { PageLoader } from '../components/shared/LoadingSpinner';
import { BarChart3, AlertCircle } from 'lucide-react';

const TRAFFIC = {
  3: { label: 'L3', bg: '#dcfce7', border: '#86efac', text: '#15803d', badge: 'bg-green-100 text-green-800' },
  2: { label: 'L2', bg: '#fef9c3', border: '#fde047', text: '#854d0e', badge: 'bg-yellow-100 text-yellow-800' },
  1: { label: 'L1', bg: '#ffedd5', border: '#fdba74', text: '#9a3412', badge: 'bg-orange-100 text-orange-800' },
  0: { label: 'NA', bg: '#fee2e2', border: '#fca5a5', text: '#991b1b', badge: 'bg-red-100 text-red-800' },
  null: { label: '—', bg: '#f1f5f9', border: '#cbd5e1', text: '#64748b', badge: 'bg-gray-100 text-gray-500' },
};

function HBar({ pct, color }) {
  if (pct === null) return <span className="text-xs text-gray-400">No data</span>;
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-4 bg-gray-100 rounded-full overflow-hidden">
        <div className="h-full rounded-full transition-all duration-700 flex items-center justify-end pr-1"
          style={{ width: `${Math.max(pct, 4)}%`, background: color }}>
          {pct > 15 && <span className="text-[10px] text-white font-bold">{pct}%</span>}
        </div>
      </div>
      {pct <= 15 && <span className="text-xs font-bold" style={{ color }}>{pct}%</span>}
    </div>
  );
}

function TrafficCell({ level }) {
  const cfg = TRAFFIC[level] ?? TRAFFIC[null];
  return (
    <div className="w-12 h-10 rounded-lg flex items-center justify-center text-xs font-bold border" style={{ background: cfg.bg, borderColor: cfg.border, color: cfg.text }}>
      {cfg.label}
    </div>
  );
}

export default function PODashboard() {
  const { filters } = useFilters();
  const [programs, setPrograms] = useState([]);
  const [programId, setProgramId] = useState('');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => { programsAPI.list().then(r => setPrograms(r.data || [])); }, []);
  useEffect(() => { if (filters.programId) setProgramId(filters.programId); }, [filters.programId]);

  useEffect(() => {
    if (!programId) { setData(null); return; }
    setLoading(true); setError('');
    const params = { programId };
    if (filters.semesterId) params.semesterId = filters.semesterId;
    if (filters.evalCycleId) params.evalCycleId = filters.evalCycleId;
    poDashboardAPI.get(params)
      .then(r => setData(r.data))
      .catch(e => setError(e.response?.data?.error || 'Failed to load PO data'))
      .finally(() => setLoading(false));
  }, [programId, filters.semesterId, filters.evalCycleId]);

  return (
    <div className="space-y-6">
      <div className="page-header">
        <div>
          <h1 className="text-xl font-bold text-gray-900 flex items-center gap-2"><BarChart3 size={20} className="text-primary-600" />PO Attainment Dashboard</h1>
          <p className="text-sm text-gray-500 mt-0.5">Programme Outcome attainment calculated via weighted CO→PO mapping</p>
        </div>
      </div>

      <div className="card p-4">
        <label className="block text-xs font-semibold text-gray-600 mb-1.5">Select Program</label>
        <select className="select max-w-sm" value={programId} onChange={e => setProgramId(e.target.value)}>
          <option value="">— Choose a program —</option>
          {programs.map(p => <option key={p.id} value={p.id}>{p.code} — {p.name}</option>)}
        </select>
      </div>

      {error && <div className="p-3 bg-red-50 border border-red-200 text-sm text-red-700 rounded-lg flex gap-2"><AlertCircle size={16} />{error}</div>}
      {loading && <PageLoader />}

      {data && !loading && (
        <>
          {/* Traffic light legend */}
          <div className="card p-4">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Attainment Level Legend</p>
            <div className="flex flex-wrap gap-3">
              {[
                { level: 3, desc: 'L3 — High (≥80%)' },
                { level: 2, desc: 'L2 — Moderate (≥70%)' },
                { level: 1, desc: 'L1 — Low (≥60%)' },
                { level: 0, desc: 'Not Attained (<60%)' },
                { level: null, desc: 'No Data' },
              ].map(({ level, desc }) => {
                const cfg = TRAFFIC[level] ?? TRAFFIC[null];
                return (
                  <div key={desc} className="flex items-center gap-2">
                    <div className="w-8 h-6 rounded text-xs font-bold flex items-center justify-center border" style={{ background: cfg.bg, borderColor: cfg.border, color: cfg.text }}>{cfg.label}</div>
                    <span className="text-xs text-gray-600">{desc}</span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* PO Bar Chart */}
          {data.poAttainment?.length > 0 && (
            <div className="card p-5">
              <p className="text-sm font-semibold text-gray-800 mb-4">Programme Outcomes (PO) Attainment</p>
              <div className="space-y-3">
                {data.poAttainment.map(item => {
                  const cfg = TRAFFIC[item.level] ?? TRAFFIC[null];
                  return (
                    <div key={item.po.id} className="grid grid-cols-[80px_1fr_90px_60px] items-center gap-3">
                      <div className="text-xs font-bold text-right text-gray-700">{item.po.code}</div>
                      <HBar pct={item.attainmentPct} color={item.color} />
                      <span className={`text-xs px-2 py-0.5 rounded-full font-semibold text-center ${cfg.badge}`}>{item.label}</span>
                      <TrafficCell level={item.level} />
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* PSO Bar Chart */}
          {data.psoAttainment?.length > 0 && (
            <div className="card p-5">
              <p className="text-sm font-semibold text-gray-800 mb-4">Programme Specific Outcomes (PSO) Attainment</p>
              <div className="space-y-3">
                {data.psoAttainment.map(item => {
                  const cfg = TRAFFIC[item.level] ?? TRAFFIC[null];
                  return (
                    <div key={item.pso.id} className="grid grid-cols-[80px_1fr_90px_60px] items-center gap-3">
                      <div className="text-xs font-bold text-right text-gray-700">{item.pso.code}</div>
                      <HBar pct={item.attainmentPct} color={item.color} />
                      <span className={`text-xs px-2 py-0.5 rounded-full font-semibold text-center ${cfg.badge}`}>{item.label}</span>
                      <TrafficCell level={item.level} />
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Traffic-light Table */}
          {data.poAttainment?.length > 0 && data.courses?.length > 0 && (
            <div className="card p-5 overflow-x-auto">
              <p className="text-sm font-semibold text-gray-800 mb-4">CO → PO Attainment Matrix (Traffic Light)</p>
              <table className="text-xs border-collapse">
                <thead>
                  <tr>
                    <th className="table-th text-left">Course</th>
                    {data.programOutcomes.map(po => <th key={po.id} className="table-th text-center w-14">{po.code}</th>)}
                    {data.programSpecificOutcomes.map(pso => <th key={pso.id} className="table-th text-center w-14">{pso.code}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {data.courses.map(course => (
                    <tr key={course.id} className="border-t border-gray-50">
                      <td className="table-td font-semibold text-gray-700 whitespace-nowrap">{course.code}</td>
                      {data.poAttainment.map(item => {
                        // Find CO-PO mapping strength for this course's COs to this PO
                        const hasMapping = true; // show overall PO attainment per row
                        return <td key={item.po.id} className="table-td text-center"><TrafficCell level={item.level} /></td>;
                      })}
                      {data.psoAttainment.map(item => (
                        <td key={item.pso.id} className="table-td text-center"><TrafficCell level={item.level} /></td>
                      ))}
                    </tr>
                  ))}
                  {/* Overall row */}
                  <tr className="border-t-2 border-gray-300 bg-gray-50">
                    <td className="table-td font-bold text-gray-900">Overall</td>
                    {data.poAttainment.map(item => (
                      <td key={item.po.id} className="table-td text-center">
                        <div className="flex flex-col items-center gap-0.5">
                          <TrafficCell level={item.level} />
                          {item.attainmentPct !== null && <span className="text-[10px] text-gray-500">{item.attainmentPct}%</span>}
                        </div>
                      </td>
                    ))}
                    {data.psoAttainment.map(item => (
                      <td key={item.pso.id} className="table-td text-center">
                        <div className="flex flex-col items-center gap-0.5">
                          <TrafficCell level={item.level} />
                          {item.attainmentPct !== null && <span className="text-[10px] text-gray-500">{item.attainmentPct}%</span>}
                        </div>
                      </td>
                    ))}
                  </tr>
                </tbody>
              </table>
            </div>
          )}

          {(!data.poAttainment?.length) && (
            <div className="card p-10 text-center text-sm text-gray-400">No Program Outcomes defined for this program. Import data via AI Import.</div>
          )}
        </>
      )}
    </div>
  );
}
