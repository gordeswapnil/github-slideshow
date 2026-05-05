import { useState, useEffect } from 'react';
import { reportsAPI, assessmentsAPI } from '../services/api';
import ChartCard from '../components/shared/ChartCard';
import StatusBadge from '../components/shared/StatusBadge';
import { PageLoader } from '../components/shared/LoadingSpinner';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';
import { Download, FileBarChart } from 'lucide-react';

export default function Reports() {
  const [assessments, setAssessments] = useState([]);
  const [selectedId, setSelectedId] = useState('');
  const [reportType, setReportType] = useState('analysis');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    assessmentsAPI.list().then(res => { setAssessments(res.data); if (res.data[0]) setSelectedId(res.data[0].id.toString()); });
  }, []);

  useEffect(() => {
    if (!selectedId) return;
    setLoading(true); setData(null);
    const fn = reportType === 'analysis' ? reportsAPI.getAnalysis : reportsAPI.getCompliance;
    fn(selectedId).then(res => setData(res.data)).catch(() => {}).finally(() => setLoading(false));
  }, [selectedId, reportType]);

  const REPORT_TYPES = [
    { key: 'analysis', label: 'Evaluation Report' },
    { key: 'compliance', label: 'Submission Compliance' },
  ];

  return (
    <div className="space-y-6">
      <div className="page-header">
        <div><h1 className="text-xl font-bold text-gray-900">Reports</h1><p className="text-sm text-gray-500 mt-0.5">Evaluation, compliance, and accreditation reports</p></div>
        <div className="flex gap-2">
          <select className="select text-sm w-72" value={selectedId} onChange={e => setSelectedId(e.target.value)}>
            <option value="">Select assessment...</option>
            {assessments.map(a => <option key={a.id} value={a.id}>{a.title}</option>)}
          </select>
          <button className="btn-secondary text-sm"><Download size={14} />Export PDF</button>
        </div>
      </div>

      <div className="flex gap-1 bg-gray-100 p-1 rounded-lg w-fit">
        {REPORT_TYPES.map(t => <button key={t.key} onClick={() => setReportType(t.key)} className={`px-4 py-1.5 text-sm font-medium rounded-md transition-all ${reportType === t.key ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500'}`}>{t.label}</button>)}
      </div>

      {loading && <PageLoader />}

      {!loading && !data && (
        <div className="card p-12 text-center"><FileBarChart size={32} className="text-gray-300 mx-auto mb-3" /><p className="text-sm text-gray-500">Select an assessment to generate a report</p></div>
      )}

      {data && reportType === 'analysis' && (
        <div className="space-y-6">
          {/* Report Header */}
          <div className="card p-6" style={{ background: 'linear-gradient(135deg, #f8fafc, #eff6ff)' }}>
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">RubriQ Institute of Management Studies</p>
                <h2 className="text-lg font-bold text-gray-900 mt-1">{data.assessment.title}</h2>
                <div className="flex items-center gap-3 mt-2 text-xs text-gray-500">
                  <span>{data.assessment.course?.name} ({data.assessment.course?.code})</span>
                  <span>·</span><span>{data.assessment.evaluationCycle?.label}</span>
                  <span>·</span><span>{data.assessment.type}</span>
                </div>
              </div>
              <div className="text-right"><p className="text-3xl font-bold text-gray-900">{data.summary.classAverage}/30</p><p className="text-xs text-gray-500">Class Average</p></div>
            </div>
          </div>

          {/* Summary Cards */}
          <div className="grid grid-cols-5 gap-3">
            {[
              { label: 'Students', value: data.summary.totalStudents },
              { label: 'Class Avg', value: data.summary.classAverage },
              { label: 'Highest', value: data.summary.highestScore },
              { label: 'Lowest', value: data.summary.lowestScore },
              { label: 'Pass Rate', value: `${data.summary.passPercentage}%` },
            ].map(s => <div key={s.label} className="card p-3 text-center"><p className="text-xl font-bold text-gray-900">{s.value}</p><p className="text-xs text-gray-400 mt-0.5">{s.label}</p></div>)}
          </div>

          {/* Criteria Table */}
          <div className="card overflow-hidden">
            <div className="px-5 py-3 border-b border-gray-100"><h3 className="font-semibold text-gray-800">Criterion-wise Performance</h3></div>
            <table className="min-w-full">
              <thead><tr><th className="table-th">Criterion</th><th className="table-th">Max</th><th className="table-th">Avg</th><th className="table-th">Attainment</th><th className="table-th">Status</th></tr></thead>
              <tbody>
                {data.criteriaStats.map((c, i) => (
                  <tr key={c.id} className="hover:bg-gray-50">
                    <td className="table-td"><span className="text-xs text-gray-400 mr-2">C{i+1}</span>{c.title}</td>
                    <td className="table-td text-xs text-center">{c.maxMarks}</td>
                    <td className="table-td text-sm font-semibold text-center">{c.average}</td>
                    <td className="table-td">
                      <div className="flex items-center gap-2"><div className="flex-1 h-2 bg-gray-100 rounded-full"><div className={`h-full rounded-full ${c.attainment >= 70 ? 'bg-green-500' : c.attainment >= 50 ? 'bg-amber-400' : 'bg-red-400'}`} style={{ width: `${c.attainment}%` }} /></div><span className="text-xs font-semibold w-10 text-right">{c.attainment}%</span></div>
                    </td>
                    <td className="table-td">{c.weak ? <StatusBadge status="Needs Improvement" /> : <StatusBadge status="COMPLETED" />}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Student Results */}
          <div className="card overflow-hidden">
            <div className="px-5 py-3 border-b border-gray-100"><h3 className="font-semibold text-gray-800">Student-wise Results</h3></div>
            <table className="min-w-full">
              <thead><tr><th className="table-th">Roll No</th><th className="table-th">Name</th><th className="table-th">Division</th><th className="table-th">Total / 30</th><th className="table-th">Grade</th></tr></thead>
              <tbody>
                {data.studentReports.map((s, i) => (
                  <tr key={i} className="hover:bg-gray-50">
                    <td className="table-td text-xs">{s.student.rollNumber}</td>
                    <td className="table-td text-sm font-medium">{s.student.firstName} {s.student.lastName}</td>
                    <td className="table-td text-xs">{s.student.division?.name || '—'}</td>
                    <td className="table-td text-sm font-bold">{s.totalMarks}</td>
                    <td className="table-td"><StatusBadge status={s.grade} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {data && reportType === 'compliance' && (
        <div className="space-y-4">
          <div className="grid grid-cols-5 gap-3">
            {[
              { label: 'Total Students', value: data.totalStudents, color: 'text-gray-800' },
              { label: 'Submitted', value: data.submitted, color: 'text-green-600' },
              { label: 'Not Submitted', value: data.notSubmitted, color: 'text-red-600' },
              { label: 'Late', value: data.late, color: 'text-amber-600' },
              { label: 'Compliance %', value: `${data.compliancePercentage}%`, color: 'text-blue-600' },
            ].map(s => <div key={s.label} className="card p-3 text-center"><p className={`text-xl font-bold ${s.color}`}>{s.value}</p><p className="text-xs text-gray-400 mt-0.5">{s.label}</p></div>)}
          </div>
          <div className="card overflow-hidden">
            <div className="px-5 py-3 border-b border-gray-100"><h3 className="font-semibold text-gray-800">Student Compliance</h3></div>
            <table className="min-w-full">
              <thead><tr><th className="table-th">Roll No</th><th className="table-th">Name</th><th className="table-th">Division</th><th className="table-th">Submission</th><th className="table-th">Date</th><th className="table-th">Late</th><th className="table-th">Evaluation</th></tr></thead>
              <tbody>
                {data.students.map((s, i) => (
                  <tr key={i} className="hover:bg-gray-50">
                    <td className="table-td text-xs">{s.rollNumber}</td>
                    <td className="table-td text-sm">{s.firstName} {s.lastName}</td>
                    <td className="table-td text-xs">{s.division?.name || '—'}</td>
                    <td className="table-td"><StatusBadge status={s.submissionStatus} /></td>
                    <td className="table-td text-xs">{s.submittedAt ? new Date(s.submittedAt).toLocaleDateString() : '—'}</td>
                    <td className="table-td text-xs">{s.isLate ? <span className="text-amber-600 font-medium">Yes</span> : <span className="text-gray-400">No</span>}</td>
                    <td className="table-td"><StatusBadge status={s.evaluationStatus} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
