import { useState, useEffect } from 'react';
import { reportsAPI, studentsAPI } from '../services/api';
import StatusBadge from '../components/shared/StatusBadge';
import { PageLoader } from '../components/shared/LoadingSpinner';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { TrendingUp, Search } from 'lucide-react';

export default function StudentProgress() {
  const [students, setStudents] = useState([]);
  const [selectedStudent, setSelectedStudent] = useState('');
  const [progress, setProgress] = useState(null);
  const [loading, setLoading] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');

  useEffect(() => {
    studentsAPI.list().then(res => setStudents(res.data));
  }, []);

  useEffect(() => {
    if (!selectedStudent) return;
    setLoading(true);
    reportsAPI.getStudentProgress(selectedStudent).then(res => setProgress(res.data)).catch(() => {}).finally(() => setLoading(false));
  }, [selectedStudent]);

  const filteredStudents = students.filter(s =>
    `${s.firstName} ${s.lastName} ${s.rollNumber}`.toLowerCase().includes(searchTerm.toLowerCase())
  ).slice(0, 10);

  return (
    <div className="space-y-6">
      <div className="page-header">
        <div><h1 className="text-xl font-bold text-gray-900">Student Progress</h1><p className="text-sm text-gray-500 mt-0.5">Individual student performance across evaluation cycles</p></div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Student Selector */}
        <div className="card p-4">
          <div className="relative mb-3">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input className="input pl-8 text-xs" placeholder="Search students..." value={searchTerm} onChange={e => setSearchTerm(e.target.value)} />
          </div>
          <div className="space-y-1 max-h-96 overflow-y-auto">
            {filteredStudents.map(s => (
              <button key={s.id} onClick={() => setSelectedStudent(s.id.toString())}
                className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors ${selectedStudent === s.id.toString() ? 'bg-primary-50 border border-primary-200' : 'hover:bg-gray-50'}`}>
                <p className="font-medium text-gray-800">{s.firstName} {s.lastName}</p>
                <p className="text-xs text-gray-400">{s.rollNumber} · {s.division?.name}</p>
              </button>
            ))}
            {filteredStudents.length === 0 && <p className="text-xs text-gray-400 text-center py-4">No students found</p>}
          </div>
        </div>

        {/* Progress Panel */}
        <div className="lg:col-span-2 space-y-4">
          {!selectedStudent && (
            <div className="card p-12 text-center"><TrendingUp size={32} className="text-gray-300 mx-auto mb-3" /><p className="text-sm text-gray-500">Select a student to view their progress</p></div>
          )}

          {loading && <PageLoader />}

          {progress && !loading && (
            <>
              <div className="card p-4 flex items-center gap-4">
                <div className="w-10 h-10 rounded-full bg-primary-100 text-primary-700 flex items-center justify-center font-bold text-sm">
                  {progress.student.firstName[0]}{progress.student.lastName[0]}
                </div>
                <div>
                  <p className="font-semibold text-gray-900">{progress.student.firstName} {progress.student.lastName}</p>
                  <p className="text-xs text-gray-500">{progress.student.rollNumber} · {progress.student.program?.name} · Batch {progress.student.batch}</p>
                </div>
              </div>

              {progress.progressData.length > 0 ? (
                <>
                  <div className="card p-4">
                    <h3 className="text-sm font-semibold text-gray-800 mb-4">Score Progression</h3>
                    <ResponsiveContainer width="100%" height={180}>
                      <LineChart data={progress.progressData}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                        <XAxis dataKey="evaluation" tick={{ fontSize: 10 }} />
                        <YAxis domain={[0, 30]} tick={{ fontSize: 10 }} />
                        <Tooltip formatter={(val) => [`${val}/30`, 'Score']} />
                        <Line type="monotone" dataKey="totalMarks" stroke="#2563eb" strokeWidth={2} dot={{ fill: '#2563eb', r: 4 }} />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>

                  <div className="card overflow-hidden">
                    <div className="px-4 py-3 border-b border-gray-100"><h3 className="font-semibold text-gray-800">Evaluation History</h3></div>
                    <table className="min-w-full">
                      <thead><tr><th className="table-th">Evaluation</th><th className="table-th">Assessment</th><th className="table-th">Score</th><th className="table-th">%</th><th className="table-th">Grade</th></tr></thead>
                      <tbody>
                        {progress.progressData.map((p, i) => (
                          <tr key={i} className="hover:bg-gray-50">
                            <td className="table-td text-xs">{p.evaluation}</td>
                            <td className="table-td text-sm">{p.assessment}</td>
                            <td className="table-td text-sm font-bold">{p.totalMarks}/{p.maxMarks}</td>
                            <td className="table-td text-xs">{p.percentage}%</td>
                            <td className="table-td"><StatusBadge status={p.grade} /></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              ) : (
                <div className="card p-8 text-center"><p className="text-sm text-gray-400">No evaluation data for this student yet.</p></div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
