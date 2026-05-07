import { useState, useEffect } from 'react';
import { coAttainmentAPI, coursesAPI } from '../services/api';
import { useFilters } from '../context/FilterContext';
import { PageLoader } from '../components/shared/LoadingSpinner';
import { Target, ChevronDown, ChevronRight, AlertCircle } from 'lucide-react';

const LEVEL_CONFIG = {
  3: { label: 'L3 — High', bg: 'bg-green-50', border: 'border-green-300', text: 'text-green-700', badge: 'bg-green-100 text-green-800', bar: '#16a34a' },
  2: { label: 'L2 — Moderate', bg: 'bg-amber-50', border: 'border-amber-300', text: 'text-amber-700', badge: 'bg-amber-100 text-amber-800', bar: '#f59e0b' },
  1: { label: 'L1 — Low', bg: 'bg-orange-50', border: 'border-orange-300', text: 'text-orange-700', badge: 'bg-orange-100 text-orange-800', bar: '#f97316' },
  0: { label: 'Not Attained', bg: 'bg-red-50', border: 'border-red-200', text: 'text-red-700', badge: 'bg-red-100 text-red-800', bar: '#ef4444' },
};

function AttainmentBar({ pct, color }) {
  return (
    <div className="w-full h-2.5 bg-gray-100 rounded-full overflow-hidden">
      <div className="h-full rounded-full transition-all duration-700" style={{ width: `${pct}%`, background: color }} />
    </div>
  );
}

export default function COAttainment() {
  const { filters } = useFilters();
  const [courses, setCourses] = useState([]);
  const [courseId, setCourseId] = useState('');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [expanded, setExpanded] = useState(null);

  useEffect(() => {
    coursesAPI.list().then(r => setCourses(r.data?.courses || r.data || []));
  }, []);

  useEffect(() => {
    if (filters.courseId) setCourseId(filters.courseId);
  }, [filters.courseId]);

  useEffect(() => {
    if (!courseId) { setData(null); return; }
    setLoading(true); setError('');
    const params = { courseId };
    if (filters.semesterId) params.semesterId = filters.semesterId;
    if (filters.evalCycleId) params.evalCycleId = filters.evalCycleId;
    coAttainmentAPI.get(params)
      .then(r => setData(r.data))
      .catch(e => setError(e.response?.data?.error || 'Failed to load attainment data'))
      .finally(() => setLoading(false));
  }, [courseId, filters.semesterId, filters.evalCycleId]);

  const overallLevel = data?.attainment?.length
    ? Math.round(data.attainment.reduce((s, a) => s + a.attainmentLevel, 0) / data.attainment.length)
    : null;

  return (
    <div className="space-y-6">
      <div className="page-header">
        <div>
          <h1 className="text-xl font-bold text-gray-900 flex items-center gap-2"><Target size={20} className="text-primary-600" />CO Attainment</h1>
          <p className="text-sm text-gray-500 mt-0.5">Course Outcome attainment at L1 (60%), L2 (70%), L3 (80%) student pass threshold</p>
        </div>
      </div>

      {/* Course selector */}
      <div className="card p-4">
        <label className="block text-xs font-semibold text-gray-600 mb-1.5">Select Course</label>
        <select className="select max-w-sm" value={courseId} onChange={e => setCourseId(e.target.value)}>
          <option value="">— Choose a course —</option>
          {courses.map(c => <option key={c.id} value={c.id}>{c.code} — {c.name}</option>)}
        </select>
      </div>

      {error && <div className="p-3 bg-red-50 border border-red-200 text-sm text-red-700 rounded-lg flex gap-2"><AlertCircle size={16} className="shrink-0" />{error}</div>}
      {loading && <PageLoader />}

      {data && !loading && (
        <>
          {/* Thresholds legend */}
          <div className="grid grid-cols-4 gap-3">
            {[
              { level: 3, label: 'L3 — High Attainment', desc: '≥80% students pass threshold' },
              { level: 2, label: 'L2 — Moderate', desc: '≥70% students pass threshold' },
              { level: 1, label: 'L1 — Low', desc: '≥60% students pass threshold' },
              { level: 0, label: 'Not Attained', desc: '<60% students pass threshold' },
            ].map(({ level, label, desc }) => {
              const cfg = LEVEL_CONFIG[level];
              return (
                <div key={level} className={`rounded-lg p-3 border ${cfg.bg} ${cfg.border}`}>
                  <p className={`text-xs font-bold ${cfg.text}`}>{label}</p>
                  <p className="text-xs text-gray-500 mt-0.5">{desc}</p>
                </div>
              );
            })}
          </div>

          {/* CO cards */}
          {data.attainment.length === 0 && (
            <div className="card p-10 text-center text-sm text-gray-400">No course outcomes found. Import course data via AI Import.</div>
          )}

          <div className="space-y-3">
            {data.attainment.map((item, i) => {
              const cfg = LEVEL_CONFIG[item.attainmentLevel] || LEVEL_CONFIG[0];
              const isOpen = expanded === item.co.id;
              return (
                <div key={item.co.id} className={`card border ${cfg.border} overflow-hidden`}>
                  <div className="px-5 py-4 flex items-center gap-4 cursor-pointer" onClick={() => setExpanded(isOpen ? null : item.co.id)}>
                    <div className={`w-10 h-10 rounded-lg flex items-center justify-center text-xs font-bold shrink-0 ${cfg.bg} ${cfg.text}`}>
                      {item.co.code}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-gray-900 truncate">{item.co.description}</p>
                      <div className="flex items-center gap-4 mt-1">
                        <AttainmentBar pct={item.attainmentPct} color={cfg.bar} />
                        <span className="text-xs font-bold shrink-0" style={{ color: cfg.bar }}>{item.attainmentPct}%</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${cfg.badge}`}>{item.label}</span>
                      <span className="text-xs text-gray-400">{item.studentsAttained}/{item.totalStudents} students</span>
                      {isOpen ? <ChevronDown size={16} className="text-gray-400" /> : <ChevronRight size={16} className="text-gray-400" />}
                    </div>
                  </div>

                  {isOpen && item.studentBreakdown?.length > 0 && (
                    <div className="border-t border-gray-100 p-4">
                      <p className="text-xs font-semibold text-gray-600 mb-3 uppercase tracking-wide">Student-level breakdown (threshold: 60%)</p>
                      <div className="overflow-x-auto">
                        <table className="min-w-full text-xs">
                          <thead><tr className="bg-gray-50"><th className="table-th">Roll No.</th><th className="table-th">Name</th><th className="table-th">Obtained</th><th className="table-th">Max</th><th className="table-th">Score %</th><th className="table-th">Status</th></tr></thead>
                          <tbody>
                            {item.studentBreakdown.sort((a, b) => b.pct - a.pct).map(s => (
                              <tr key={s.studentId} className="border-t border-gray-50">
                                <td className="table-td font-mono">{s.rollNumber}</td>
                                <td className="table-td">{s.name}</td>
                                <td className="table-td text-center">{s.obtained.toFixed(1)}</td>
                                <td className="table-td text-center">{s.max}</td>
                                <td className="table-td text-center font-semibold">{s.pct}%</td>
                                <td className="table-td">
                                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${s.attained ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                                    {s.attained ? 'Attained' : 'Not Attained'}
                                  </span>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                  {isOpen && item.attainmentPct === 0 && item.studentsAttained === 0 && item.totalStudents === 0 && (
                    <div className="border-t border-gray-100 p-4 text-xs text-gray-400 text-center">No marks uploaded for this CO yet.</div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Summary table */}
          {data.attainment.length > 0 && (
            <div className="card p-5">
              <p className="text-sm font-semibold text-gray-800 mb-4">CO Attainment Summary</p>
              <table className="min-w-full text-sm">
                <thead><tr><th className="table-th">CO</th><th className="table-th">Students Assessed</th><th className="table-th">Students Attained</th><th className="table-th">Attainment %</th><th className="table-th">Level</th></tr></thead>
                <tbody>
                  {data.attainment.map(item => {
                    const cfg = LEVEL_CONFIG[item.attainmentLevel] || LEVEL_CONFIG[0];
                    return (
                      <tr key={item.co.id} className="border-t border-gray-50">
                        <td className="table-td font-semibold text-primary-700">{item.co.code}</td>
                        <td className="table-td text-center">{item.totalStudents}</td>
                        <td className="table-td text-center">{item.studentsAttained}</td>
                        <td className="table-td text-center font-bold">{item.attainmentPct}%</td>
                        <td className="table-td"><span className={`text-xs px-2.5 py-1 rounded-full font-semibold ${cfg.badge}`}>{item.label}</span></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
