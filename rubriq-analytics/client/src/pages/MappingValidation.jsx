import { useState, useEffect } from 'react';
import { bulkUploadAPI } from '../services/api';
import DataTable from '../components/shared/DataTable';
import StatusBadge from '../components/shared/StatusBadge';
import { PageLoader } from '../components/shared/LoadingSpinner';
import { GitMerge, AlertCircle, CheckCircle } from 'lucide-react';

export default function MappingValidation() {
  const [batches, setBatches] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    bulkUploadAPI.list().then(res => setBatches(res.data)).finally(() => setLoading(false));
  }, []);

  const columns = [
    { key: 'file', header: 'File Name', accessor: 'fileName' },
    { key: 'assessment', header: 'Assessment', render: r => r.assessment?.title || '—' },
    { key: 'uploadedBy', header: 'Uploaded By', render: r => `${r.uploadedBy?.firstName} ${r.uploadedBy?.lastName}` },
    { key: 'total', header: 'Total Rows', accessor: 'totalRows' },
    { key: 'valid', header: 'Valid', render: r => <span className="text-green-600 font-semibold">{r.validRows}</span> },
    { key: 'errors', header: 'Errors', render: r => <span className={r.errorRows > 0 ? 'text-red-600 font-semibold' : 'text-gray-400'}>{r.errorRows}</span> },
    { key: 'status', header: 'Status', render: r => <StatusBadge status={r.status} /> },
    { key: 'date', header: 'Date', render: r => new Date(r.createdAt).toLocaleDateString() },
  ];

  if (loading) return <PageLoader />;

  return (
    <div className="space-y-6">
      <div className="page-header">
        <div><h1 className="text-xl font-bold text-gray-900">Mapping &amp; Validation</h1><p className="text-sm text-gray-500 mt-0.5">Review upload batches, column mappings, and validation results</p></div>
      </div>

      {batches.length === 0 ? (
        <div className="card p-12 text-center">
          <GitMerge size={32} className="text-gray-300 mx-auto mb-3" />
          <p className="text-sm font-medium text-gray-600">No upload batches yet</p>
          <p className="text-xs text-gray-400 mt-1">Use Bulk Marks Upload to import student marks</p>
          <a href="/bulk-marks-upload" className="btn-primary mt-4 inline-flex">Go to Bulk Upload</a>
        </div>
      ) : (
        <DataTable columns={columns} data={batches} searchPlaceholder="Search batches..." />
      )}
    </div>
  );
}
