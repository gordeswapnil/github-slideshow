import { useState, useEffect } from 'react';
import { dashboardAPI } from '../services/api';
import KPICard from '../components/shared/KPICard';
import ChartCard from '../components/shared/ChartCard';
import { PageLoader } from '../components/shared/LoadingSpinner';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, RadialBarChart, RadialBar, Legend,
  LineChart, Line, AreaChart, Area,
} from 'recharts';
import {
  Users, FileText, CheckCircle, Clock, AlertCircle, Archive,
  GraduationCap, TrendingUp, Shield, BarChart3, Download,
} from 'lucide-react';

const COLORS = { Excellent: '#16a34a', Good: '#2563eb', Satisfactory: '#f59e0b', 'Needs Improvement': '#ef4444' };
const PIE_COLORS = ['#16a34a', '#2563eb', '#f59e0b', '#ef4444'];

export default function Dashboard() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    dashboardAPI.getStats()
      .then(res => setData(res.data))
      .catch(err => setError(err.response?.data?.error || 'Failed to load dashboard'))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <PageLoader />;
  if (error) return (
    <div className="flex items-center justify-center min-h-[400px]">
      <div className="text-center">
        <AlertCircle size={32} className="text-red-400 mx-auto mb-2" />
        <p className="text-sm text-gray-600">{error}</p>
      </div>
    </div>
  );

  const { kpis, charts } = data;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Admin Dashboard</h1>
          <p className="text-sm text-gray-500 mt-0.5">RubriQ Institute of Management Studies · {kpis.activeAcademicYear}</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-green-50 border border-green-200 text-green-700 rounded-full text-xs font-medium">
            <span className="w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse" />
            {kpis.activeEvalCycle}
          </span>
          <button className="btn-secondary text-xs" onClick={() => window.print()}>
            <Download size={13} />
            Export Report
          </button>
        </div>
      </div>

      {/* Context Bar */}
      <div className="card p-3 flex items-center gap-4 text-xs">
        <InfoChip label="Academic Year" value={kpis.activeAcademicYear} />
        <div className="w-px h-5 bg-gray-200" />
        <InfoChip label="Semester" value={kpis.activeSemester} />
        <div className="w-px h-5 bg-gray-200" />
        <InfoChip label="Active Cycle" value={kpis.activeEvalCycle} />
        <div className="w-px h-5 bg-gray-200" />
        <InfoChip label="Course" value="AI in Finance (MBA-FIN-402)" />
        <div className="w-px h-5 bg-gray-200" />
        <InfoChip label="Division" value="Division A" />
      </div>

      {/* KPI Row 1 */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
        <KPICard title="Total Students" value={kpis.totalStudents} icon={GraduationCap} color="blue" />
        <KPICard title="Submissions Received" value={kpis.submissionsReceived} icon={FileText} color="green" />
        <KPICard title="Pending Submissions" value={kpis.pendingSubmissions} icon={Clock} color="amber" />
        <KPICard title="Evaluations Done" value={kpis.completedEvaluations} icon={CheckCircle} color="green" />
        <KPICard title="Pending Evaluations" value={kpis.pendingEvaluations} icon={AlertCircle} color="red" />
        <KPICard title="Evidence Records" value={kpis.evidenceRecords} icon={Archive} color="purple" />
      </div>

      {/* KPI Row 2 */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KPICard title="Reports Generated" value={kpis.reportsGenerated} icon={BarChart3} color="blue" subtitle="This cycle" />
        <KPICard title="Weak COs Identified" value={kpis.weakCOsIdentified} icon={AlertCircle} color="amber" subtitle="Requires action" />
        <KPICard title="Accreditation Ready" value={`${kpis.accreditationCompleteness}%`} icon={Shield} color="green" subtitle="Evidence completeness" />
        <KPICard title="Overall Progress" value={`${Math.round((kpis.completedEvaluations / Math.max(kpis.totalStudents, 1)) * 100)}%`} icon={TrendingUp} color="blue" subtitle="Evaluation completion" />
      </div>

      {/* Charts Row 1 */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Evaluation Progress */}
        <ChartCard title="Evaluation Cycle Progress" subtitle="Completion status across all 4 evaluations" className="lg:col-span-1">
          <div className="space-y-3">
            {charts.evalProgress.map(e => (
              <div key={e.name}>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-medium text-gray-700">{e.name}</span>
                  <span className="text-xs text-gray-500">{e.completed}/{e.total} · {e.percentage}%</span>
                </div>
                <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all ${e.percentage === 100 ? 'bg-green-500' : e.percentage > 50 ? 'bg-blue-500' : e.percentage > 0 ? 'bg-amber-400' : 'bg-gray-200'}`}
                    style={{ width: `${e.percentage}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </ChartCard>

        {/* Performance Distribution */}
        <ChartCard title="Performance Distribution" subtitle="Current evaluation cycle" className="lg:col-span-1">
          {charts.performanceDist.length > 0 ? (
            <ResponsiveContainer width="100%" height={180}>
              <PieChart>
                <Pie data={charts.performanceDist} cx="50%" cy="50%" innerRadius={45} outerRadius={75} dataKey="count" nameKey="grade" paddingAngle={3}>
                  {charts.performanceDist.map((entry, i) => (
                    <Cell key={i} fill={COLORS[entry.grade] || PIE_COLORS[i % 4]} />
                  ))}
                </Pie>
                <Tooltip formatter={(val) => [`${val} students`]} />
                <Legend iconType="circle" iconSize={8} formatter={(val) => <span className="text-xs text-gray-600">{val}</span>} />
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex items-center justify-center h-40 text-sm text-gray-400">No evaluation data yet</div>
          )}
        </ChartCard>

        {/* Submission Compliance */}
        <ChartCard title="Submission Status" subtitle="Current assessment">
          <div className="space-y-4">
            {[
              { label: 'Submitted On-Time', val: charts.submissionCompliance.submitted - charts.submissionCompliance.late, color: 'bg-green-500', total: kpis.totalStudents },
              { label: 'Late Submissions', val: charts.submissionCompliance.late, color: 'bg-amber-400', total: kpis.totalStudents },
              { label: 'Not Submitted', val: charts.submissionCompliance.pending, color: 'bg-red-400', total: kpis.totalStudents },
            ].map(item => (
              <div key={item.label}>
                <div className="flex justify-between mb-1">
                  <span className="text-xs text-gray-600">{item.label}</span>
                  <span className="text-xs font-semibold text-gray-800">{item.val}</span>
                </div>
                <div className="h-2 bg-gray-100 rounded-full">
                  <div className={`h-full rounded-full ${item.color}`} style={{ width: `${(item.val / item.total) * 100}%` }} />
                </div>
              </div>
            ))}
            <div className="pt-2 border-t border-gray-100">
              <p className="text-xs font-semibold text-gray-700">
                Overall Compliance: {Math.round(((charts.submissionCompliance.submitted) / Math.max(kpis.totalStudents, 1)) * 100)}%
              </p>
            </div>
          </div>
        </ChartCard>
      </div>

      {/* Criteria Chart */}
      {charts.criteriaChart.length > 0 && (
        <ChartCard title="Criteria-wise Average Performance" subtitle="Average marks per criterion across all evaluated students">
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={charts.criteriaChart} barSize={28} margin={{ top: 5, right: 10, left: -20, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="name" tick={{ fontSize: 10, fill: '#6b7280' }} />
              <YAxis tick={{ fontSize: 10, fill: '#6b7280' }} />
              <Tooltip
                contentStyle={{ fontSize: 11, borderRadius: 8, border: '1px solid #e5e7eb', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.1)' }}
                formatter={(val, name) => [val, 'Avg Marks']}
                labelFormatter={(label) => charts.criteriaChart.find(c => c.name === label)?.fullName || label}
              />
              <Bar dataKey="average" fill="#3b82f6" radius={[4, 4, 0, 0]} />
              <Bar dataKey="maxMarks" fill="#e5e7eb" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
          <div className="flex items-center gap-4 mt-2 justify-center">
            <div className="flex items-center gap-1.5"><span className="w-3 h-2 bg-blue-500 rounded-sm" /><span className="text-xs text-gray-500">Average</span></div>
            <div className="flex items-center gap-1.5"><span className="w-3 h-2 bg-gray-200 rounded-sm" /><span className="text-xs text-gray-500">Maximum</span></div>
          </div>
        </ChartCard>
      )}
    </div>
  );
}

function InfoChip({ label, value }) {
  return (
    <div>
      <span className="text-gray-400">{label}: </span>
      <span className="font-semibold text-gray-700">{value}</span>
    </div>
  );
}
