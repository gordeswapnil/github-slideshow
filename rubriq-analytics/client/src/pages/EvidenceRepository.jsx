import { useState, useEffect } from 'react';
import { submissionsAPI, assessmentsAPI } from '../services/api';
import StatusBadge from '../components/shared/StatusBadge';
import { PageLoader } from '../components/shared/LoadingSpinner';
import { Archive, Download, Eye, FileText, Image, FileSpreadsheet, File } from 'lucide-react';

const FILE_ICONS = { pdf: FileText, jpg: Image, jpeg: Image, png: Image, webp: Image, xlsx: FileSpreadsheet, xls: FileSpreadsheet, docx: FileText, doc: FileText };

function FileIcon({ name }) {
  const ext = name?.split('.').pop()?.toLowerCase();
  const Icon = FILE_ICONS[ext] || File;
  return <Icon size={16} className="text-gray-400" />;
}

export default function EvidenceRepository() {
  const [submissions, setSubmissions] = useState([]);
  const [assessments, setAssessments] = useState([]);
  const [selected, setSelected] = useState('');
  const [loading, setLoading] = useState(false);
  const [totalFiles, setTotalFiles] = useState(0);

  useEffect(() => {
    assessmentsAPI.list().then(res => { setAssessments(res.data); if (res.data[0]) setSelected(res.data[0].id.toString()); });
  }, []);

  useEffect(() => {
    if (!selected) return;
    setLoading(true);
    submissionsAPI.list({ assessmentId: selected }).then(res => {
      setSubmissions(res.data);
      setTotalFiles(res.data.reduce((sum, s) => sum + (s.files?.length || 0), 0));
    }).finally(() => setLoading(false));
  }, [selected]);

  const withFiles = submissions.filter(s => s.files?.length > 0);

  return (
    <div className="space-y-6">
      <div className="page-header">
        <div><h1 className="text-xl font-bold text-gray-900">Evidence Repository</h1><p className="text-sm text-gray-500 mt-0.5">Student submission files and evidence archive</p></div>
        <div className="flex gap-2">
          <select className="select text-sm w-72" value={selected} onChange={e => setSelected(e.target.value)}>
            <option value="">Select assessment...</option>
            {assessments.map(a => <option key={a.id} value={a.id}>{a.title}</option>)}
          </select>
          <button className="btn-secondary text-sm"><Download size={14} />Download All</button>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div className="card p-4"><p className="text-2xl font-bold text-blue-600">{totalFiles}</p><p className="text-xs text-gray-500 mt-0.5">Total Evidence Files</p></div>
        <div className="card p-4"><p className="text-2xl font-bold text-green-600">{withFiles.length}</p><p className="text-xs text-gray-500 mt-0.5">Students with Files</p></div>
        <div className="card p-4"><p className="text-2xl font-bold text-amber-600">{submissions.length - withFiles.length}</p><p className="text-xs text-gray-500 mt-0.5">Missing Evidence</p></div>
      </div>

      {loading ? <PageLoader /> : (
        <div className="card overflow-hidden">
          <table className="min-w-full">
            <thead><tr><th className="table-th">Roll No</th><th className="table-th">Student</th><th className="table-th">Division</th><th className="table-th">Files</th><th className="table-th">Submission Date</th><th className="table-th">Eval Status</th><th className="table-th">Actions</th></tr></thead>
            <tbody>
              {submissions.map(s => (
                <tr key={s.id} className="hover:bg-gray-50">
                  <td className="table-td text-xs font-medium">{s.student?.rollNumber}</td>
                  <td className="table-td text-sm">{s.student?.firstName} {s.student?.lastName}</td>
                  <td className="table-td text-xs">{s.student?.division?.name || '—'}</td>
                  <td className="table-td">
                    {s.files?.length > 0 ? (
                      <div className="flex flex-wrap gap-1">
                        {s.files.map(f => (
                          <span key={f.id} className="flex items-center gap-1 text-xs bg-gray-100 px-2 py-0.5 rounded">
                            <FileIcon name={f.originalName} />{f.originalName}
                          </span>
                        ))}
                      </div>
                    ) : <span className="text-xs text-red-400">No files</span>}
                  </td>
                  <td className="table-td text-xs text-gray-500">{s.submittedAt ? new Date(s.submittedAt).toLocaleDateString() : '—'}</td>
                  <td className="table-td"><StatusBadge status={s.evaluation?.status || 'PENDING'} /></td>
                  <td className="table-td">
                    <div className="flex gap-1">
                      {s.files?.length > 0 && <button className="btn-ghost p-1.5" title="Preview"><Eye size={13} /></button>}
                      {s.files?.length > 0 && <button className="btn-ghost p-1.5" title="Download"><Download size={13} /></button>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {submissions.length === 0 && <div className="py-12 text-center"><Archive size={28} className="text-gray-300 mx-auto mb-2" /><p className="text-sm text-gray-400">No submissions found</p></div>}
        </div>
      )}
    </div>
  );
}
