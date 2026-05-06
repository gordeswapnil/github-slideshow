import { useState, useEffect } from 'react';
import { reportsAPI, assessmentsAPI } from '../services/api';
import ChartCard from '../components/shared/ChartCard';
import StatusBadge from '../components/shared/StatusBadge';
import { PageLoader } from '../components/shared/LoadingSpinner';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, RadarChart, PolarGrid, PolarAngleAxis, Radar, Legend,
} from 'recharts';
import { Download, Filter, TrendingUp, Users, Award, AlertCircle } from 'lucide-react';

const GRADE_COLORS = { Excellent: '#16a34a', Good: '#2563eb', Satisfactory: '#f59e0b', 'Needs Improvement': '#ef4444' };
const PIE_COLORS = ['#16a34a', '#2563eb', '#f59e0b', '#ef4444'];

export default function AnalysisDashboard() {
  const [assessments, setAssessments] = useState([]);
  const [selectedId, setSelectedId] = useState('');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    assessmentsAPI.list().then(res => {
      setAssessments(res.data);
      if (res.data.length > 0) setSelectedId(res.data[0].id.toString());
    });
  }, []);

  useEffect(() => {
    if (!selectedId) return;
    setLoading(true);
    setData(null);
    reportsAPI.getAnalysis(selectedId)
      .then(res => setData(res.data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [selectedId]);

  const pieData = data ? Object.entries(data.summary.performanceDist).map(([grade, count]) => ({ name: grade, value: count })).filter(d => d.value > 0) : [];

  const radarData = data?.criteriaStats.map(c => ({
    criterion: `C${data.criteriaStats.indexOf(c) + 1}`,
    attainment: c.attainment,
    fullMark: 100,
  })) || [];

  return (
    <div className="space-y-6">
      <div className="page-header">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Class Analysis Dashboard</h1>
          <p className="text-sm text-gray-500 mt-0.5">Detailed performance analytics for teacher evaluation data</p>
        </div>
        <div className="flex gap-2">
          <select className="select text-sm" value={selectedId} onChange={e => setSelectedId(e.target.value)}>
            <option value="">Select assessment...</option>
            {assessments.map(a => <option key={a.id} value={a.id}>{a.title}</option>)}
          </select>
          <button className="btn-secondary text-sm" onClick={() => window.print()}><Download size={14} />Export</button>
        </div>
      </div>

      {loading && <PageLoader />}

      {!loading && !data && (
        <div className="card p-12 text-center">
          <BarChart size={32} className="text-gray-300 mx-auto mb-3" />
          <p className="text-sm text-gray-500">Select an assessment to view analysis</p>
        </div>
      )}

      {data && (
        <>
          {/* Context */}
          <div className="card p-3 text-xs flex items-center gap-4 text-gray-600">
            <span className="font-semibold text-gray-800">{data.assessment.course?.name}</span>
            <span className="text-gray-300">|</span>
            <span>{data.assessment.evaluationCycle?.label}</span>
            <span className="text-gray-300">|</span>
            <span>{data.assessment.title}</span>
          </div>

          {/* Summary KPIs */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            {[
              { label: 'Students Evaluated', value: data.summary.totalStudents, icon: Users, color: 'blue' },
              { label: 'Class Average', value: `${data.summary.classAverage}/30`, icon: TrendingUp, color: 'blue' },
              { label: 'Highest Score', value: data.summary.highestScore, icon: Award, color: 'green' },
              { label: 'Lowest Score', value: data.summary.lowestScore, icon: AlertCircle, color: 'red' },
              { label: 'Pass Rate', value: `${data.summary.passPercentage}%`, icon: TrendingUp, color: 'green' },
            ].map(kpi => (
              <div key={kpi.label} className="card p-4">
                <p className="text-xs text-gray-500 uppercase tracking-wider">{kpi.label}</p>
                <p className={`text-xl font-bold text-${kpi.color}-600 mt-1`}>{kpi.value}</p>
              </div>
            ))}
          </div>

          {/* Performance Distribution + Radar */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <ChartCard title="Performance Level Distribution">
              <ResponsiveContainer width="100%" height={220}>
                <PieChart>
                  <Pie data={pieData} cx="50%" cy="50%" innerRadius={50} outerRadius={85} dataKey="value" nameKey="name" paddingAngle={3} label={({ name, percent }) => `${(percent * 100).toFixed(0)}%`} labelLine={false}>
                    {pieData.map((entry, i) => <Cell key={i} fill={GRADE_COLORS[entry.name] || PIE_COLORS[i]} />)}
                  </Pie>
                  <Tooltip />
                  <Legend iconType="circle" iconSize={8} formatter={val => <span className="text-xs">{val}</span>} />
                </PieChart>
              </ResponsiveContainer>
            </ChartCard>

            <ChartCard title="CO Attainment Radar" subtitle="Criteria performance as attainment %">
              <ResponsiveContainer width="100%" height={220}>
                <RadarChart data={radarData} cx="50%" cy="50%" outerRadius={80}>
                  <PolarGrid stroke="#e5e7eb" />
                  <PolarAngleAxis dataKey="criterion" tick={{ fontSize: 11 }} />
                  <Radar name="Attainment %" dataKey="attainment" stroke="#2563eb" fill="#2563eb" fillOpacity={0.15} strokeWidth={2} />
                  <Tooltip formatter={(val) => [`${val}%`, 'Attainment']} />
                </RadarChart>
              </ResponsiveContainer>
            </ChartCard>
          </div>

          {/* Criteria Analysis Table */}
          <div className="card overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-100">
              <h3 className="font-semibold text-gray-800">Criterion-wise Analysis</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full">
                <thead>
                  <tr>
                    <th className="table-th">#</th>
                    <th className="table-th">Criterion</th>
                    <th className="table-th">Max Marks</th>
                    <th className="table-th">Class Average</th>
                    <th className="table-th">Attainment %</th>
                    <th className="table-th">Performance Bar</th>
                    <th className="table-th">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {data.criteriaStats.map((c, i) => (
                    <tr key={c.id} className="hover:bg-gray-50">
                      <td className="table-td text-xs font-medium text-gray-400">C{i + 1}</td>
                      <td className="table-td text-sm font-medium text-gray-800 max-w-xs">{c.title}</td>
                      <td className="table-td text-xs text-center">{c.maxMarks}</td>
                      <td className="table-td text-xs font-semibold text-center">{c.average}</td>
                      <td className="table-td text-xs font-bold text-center">
                        <span className={c.attainment >= 70 ? 'text-green-600' : c.attainment >= 50 ? 'text-amber-600' : 'text-red-600'}>
                          {c.attainment}%
                        </span>
                      </td>
                      <td className="table-td w-32">
                        <div className="h-2 bg-gray-100 rounded-full">
                          <div className={`h-full rounded-full ${c.attainment >= 70 ? 'bg-green-500' : c.attainment >= 50 ? 'bg-amber-400' : 'bg-red-400'}`} style={{ width: `${c.attainment}%` }} />
                        </div>
                      </td>
                      <td className="table-td">
                        {c.weak ? <StatusBadge status="Needs Improvement" /> : <StatusBadge status="COMPLETED" />}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Student Report Table */}
          <div className="card overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
              <h3 className="font-semibold text-gray-800">Student-wise Results</h3>
              <span className="text-xs text-gray-500">{data.studentReports.length} students</span>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full">
                <thead>
                  <tr>
                    <th className="table-th">Roll No</th>
                    <th className="table-th">Student</th>
                    <th className="table-th">Division</th>
                    <th className="table-th">Total</th>
                    <th className="table-th">%</th>
                    <th className="table-th">Grade</th>
                  </tr>
                </thead>
                <tbody>
                  {data.studentReports.map((s, i) => (
                    <tr key={i} className="hover:bg-gray-50">
                      <td className="table-td text-xs font-medium">{s.student.rollNumber}</td>
                      <td className="table-td text-sm font-medium">{s.student.firstName} {s.student.lastName}</td>
                      <td className="table-td text-xs">{s.student.division?.name || '—'}</td>
                      <td className="table-td text-sm font-bold">{s.totalMarks}/30</td>
                      <td className="table-td text-xs">{((s.totalMarks / 30) * 100).toFixed(0)}%</td>
                      <td className="table-td"><StatusBadge status={s.grade} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
