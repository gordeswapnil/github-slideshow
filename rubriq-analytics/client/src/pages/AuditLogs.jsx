import { useState, useEffect } from 'react';
import { auditLogsAPI } from '../services/api';
import DataTable from '../components/shared/DataTable';
import { PageLoader } from '../components/shared/LoadingSpinner';
import { ClipboardCheck, Download, Filter } from 'lucide-react';

const ACTION_COLORS = {
  LOGIN: 'text-green-700 bg-green-50',
  LOGOUT: 'text-gray-600 bg-gray-100',
  CREATE: 'text-blue-700 bg-blue-50',
  UPDATE: 'text-amber-700 bg-amber-50',
  DELETE: 'text-red-700 bg-red-50',
  IMPORT: 'text-purple-700 bg-purple-50',
  SEED: 'text-gray-600 bg-gray-100',
  GENERATE_EVIDENCE: 'text-purple-700 bg-purple-50',
  UPDATE_SETTINGS: 'text-amber-700 bg-amber-50',
};

export default function AuditLogs() {
  const [logs, setLogs] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);

  useEffect(() => {
    setLoading(true);
    auditLogsAPI.list({ page, limit: 50 })
      .then(res => { setLogs(res.data.logs); setTotal(res.data.total); })
      .finally(() => setLoading(false));
  }, [page]);

  const columns = [
    { key: 'time', header: 'Timestamp', render: r => new Date(r.createdAt).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit' }) },
    { key: 'user', header: 'User', render: r => r.user ? `${r.user.firstName} ${r.user.lastName}` : 'System' },
    { key: 'action', header: 'Action', render: r => (
      <span className={`text-xs px-2.5 py-0.5 rounded-full font-medium ${ACTION_COLORS[r.action] || 'text-gray-600 bg-gray-100'}`}>{r.action}</span>
    )},
    { key: 'entity', header: 'Entity', accessor: 'entity' },
    { key: 'entityId', header: 'Record ID', render: r => r.entityId || '—' },
    { key: 'ip', header: 'IP Address', accessor: 'ipAddress' },
    { key: 'details', header: 'Details', render: r => r.details ? <span className="text-xs text-gray-500 truncate max-w-[200px] block">{typeof r.details === 'object' ? JSON.stringify(r.details).slice(0, 60) : r.details}</span> : '—' },
  ];

  return (
    <div className="space-y-6">
      <div className="page-header">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Audit Logs</h1>
          <p className="text-sm text-gray-500 mt-0.5">{total} total log entries — complete activity trail</p>
        </div>
        <div className="flex gap-2">
          <button className="btn-secondary text-sm"><Download size={14} />Export Logs</button>
        </div>
      </div>

      {loading ? <PageLoader /> : (
        <DataTable columns={columns} data={logs} searchPlaceholder="Search logs..." emptyMessage="No audit log entries found." pageSize={20} />
      )}
    </div>
  );
}
