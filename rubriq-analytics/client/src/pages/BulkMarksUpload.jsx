import { useState, useEffect } from 'react';
import { bulkUploadAPI, assessmentsAPI } from '../services/api';
import WizardStepper from '../components/shared/WizardStepper';
import FileUploadCard from '../components/shared/FileUploadCard';
import StatusBadge from '../components/shared/StatusBadge';
import { PageLoader } from '../components/shared/LoadingSpinner';
import { Upload, Check, AlertCircle, ChevronRight, ChevronLeft, Loader, Info } from 'lucide-react';

const STEPS = ['Upload File', 'Detect Columns', 'Map Fields', 'Validate', 'Confirm'];

export default function BulkMarksUpload() {
  const [step, setStep] = useState(1);
  const [assessments, setAssessments] = useState([]);
  const [selectedAssessment, setSelectedAssessment] = useState('');
  const [files, setFiles] = useState([]);
  const [analyzing, setAnalyzing] = useState(false);
  const [batchId, setBatchId] = useState(null);
  const [mappings, setMappings] = useState([]);
  const [validation, setValidation] = useState(null);
  const [validating, setValidating] = useState(false);
  const [error, setError] = useState('');
  const [recentBatches, setRecentBatches] = useState([]);

  useEffect(() => {
    Promise.all([assessmentsAPI.list(), bulkUploadAPI.list()])
      .then(([aRes, bRes]) => { setAssessments(aRes.data); setRecentBatches(bRes.data.slice(0, 5)); });
  }, []);

  const handleAnalyze = async () => {
    if (!files[0]) return setError('Please select a file');
    if (!selectedAssessment) return setError('Please select an assessment');
    setError(''); setAnalyzing(true);
    try {
      const fd = new FormData();
      fd.append('file', files[0]);
      fd.append('assessmentId', selectedAssessment);
      const res = await bulkUploadAPI.analyze(fd);
      setBatchId(res.data.batchId);
      setMappings(res.data.mappings);
      setStep(3);
    } catch (err) {
      setError(err.response?.data?.error || 'Analysis failed');
    } finally { setAnalyzing(false); }
  };

  const handleValidate = async () => {
    setError(''); setValidating(true);
    try {
      await bulkUploadAPI.confirmMappings(batchId, { mappings });
      const res = await bulkUploadAPI.validate(batchId);
      setValidation(res.data);
      setStep(4);
    } catch (err) {
      setError(err.response?.data?.error || 'Validation failed');
    } finally { setValidating(false); }
  };

  const confidenceColor = (status) => ({
    HIGH: 'text-green-700 bg-green-50 border-green-200',
    MEDIUM: 'text-amber-700 bg-amber-50 border-amber-200',
    LOW: 'text-red-700 bg-red-50 border-red-200',
    UNMAPPED: 'text-gray-500 bg-gray-50 border-gray-200',
  }[status] || 'text-gray-500 bg-gray-50');

  return (
    <div className="space-y-6">
      <div className="page-header">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Bulk Marks Upload</h1>
          <p className="text-sm text-gray-500 mt-0.5">Import student marks from Excel with intelligent column mapping</p>
        </div>
      </div>

      <div className="card p-6">
        <WizardStepper steps={STEPS} currentStep={step} />
      </div>

      {error && (
        <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
          <AlertCircle size={16} />{error}
        </div>
      )}

      {/* Step 1: Upload */}
      {step === 1 && (
        <div className="card p-6 space-y-4">
          <h3 className="font-semibold text-gray-800">Select Assessment & Upload File</h3>
          <div>
            <label className="label">Assessment <span className="text-red-500">*</span></label>
            <select className="select max-w-lg" value={selectedAssessment} onChange={e => setSelectedAssessment(e.target.value)}>
              <option value="">Select assessment...</option>
              {assessments.map(a => <option key={a.id} value={a.id}>{a.title} — {a.course?.name}</option>)}
            </select>
          </div>
          <FileUploadCard onFiles={setFiles} multiple={false} excelOnly />
          <div className="p-3 bg-blue-50 border border-blue-100 rounded-lg">
            <p className="text-xs font-semibold text-blue-700 flex items-center gap-1.5 mb-1"><Info size={12} />Expected Excel Format</p>
            <p className="text-xs text-blue-600">Columns: Roll Number, Student Name, C1 (Understanding), C2 (Application), C3 (Financial Analysis), C4 (Evidence), C5 (Risk/Ethics), C6 (Structure), C7 (Recommendations), C8 (Referencing), Total</p>
          </div>
          <div className="flex justify-end">
            <button className="btn-primary" onClick={handleAnalyze} disabled={analyzing || !files[0] || !selectedAssessment}>
              {analyzing ? <><Loader size={14} className="animate-spin" />Analyzing...</> : <>Analyze File <ChevronRight size={14} /></>}
            </button>
          </div>
        </div>
      )}

      {/* Step 3: Column Mapping */}
      {step === 3 && (
        <div className="card overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
            <h3 className="font-semibold text-gray-800">Column Mapping Preview</h3>
            <p className="text-xs text-gray-500">{mappings.filter(m => m.status === 'HIGH').length}/{mappings.length} auto-mapped</p>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full">
              <thead>
                <tr>
                  {['Excel Column', 'Sample Values', 'Detected Field', 'Mapped To', 'Confidence', 'Status', 'Action'].map(h => (
                    <th key={h} className="table-th">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {mappings.map((m, i) => (
                  <tr key={i} className="hover:bg-gray-50">
                    <td className="table-td font-medium text-gray-800">{m.excelColumn}</td>
                    <td className="table-td text-gray-500 text-xs max-w-[120px] truncate">{m.sampleValues}</td>
                    <td className="table-td text-xs text-gray-600">{m.detectedField || '—'}</td>
                    <td className="table-td">
                      <select
                        className="text-xs border border-gray-200 rounded px-2 py-1 bg-white"
                        value={m.mappedTo || ''}
                        onChange={e => setMappings(prev => prev.map((p, idx) => idx === i ? { ...p, mappedTo: e.target.value } : p))}
                      >
                        <option value="">Ignore</option>
                        <option value="rollNumber">Roll Number</option>
                        <option value="studentName">Student Name</option>
                        {['c1','c2','c3','c4','c5','c6','c7','c8'].map(c => <option key={c} value={c}>Criterion {c.slice(1)}</option>)}
                        <option value="total">Total Marks</option>
                      </select>
                    </td>
                    <td className="table-td">
                      <span className="text-xs font-semibold text-gray-700">{m.confidence}%</span>
                    </td>
                    <td className="table-td">
                      <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${confidenceColor(m.status)}`}>
                        {m.status}
                      </span>
                    </td>
                    <td className="table-td">
                      {!m.isConfirmed && m.status !== 'HIGH' && (
                        <button className="text-xs text-primary-600 hover:underline" onClick={() => setMappings(prev => prev.map((p, idx) => idx === i ? { ...p, isConfirmed: true, status: 'HIGH' } : p))}>
                          Confirm
                        </button>
                      )}
                      {m.isConfirmed && <Check size={14} className="text-green-500" />}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="px-5 py-4 border-t border-gray-100 flex items-center justify-between">
            <button className="btn-secondary" onClick={() => setStep(1)}><ChevronLeft size={14} />Back</button>
            <button className="btn-primary" onClick={handleValidate} disabled={validating}>
              {validating ? <><Loader size={14} className="animate-spin" />Validating...</> : <>Validate Data <ChevronRight size={14} /></>}
            </button>
          </div>
        </div>
      )}

      {/* Step 4: Validation */}
      {step === 4 && validation && (
        <div className="space-y-4">
          <div className="grid grid-cols-4 gap-3">
            {[
              { label: 'Total Rows', value: validation.totalRows, color: 'blue' },
              { label: 'Valid Rows', value: validation.validRows, color: 'green' },
              { label: 'Error Rows', value: validation.errorRows, color: 'red' },
              { label: 'Ready to Import', value: validation.validRows, color: 'purple' },
            ].map(s => (
              <div key={s.label} className="card p-4">
                <p className={`text-2xl font-bold text-${s.color}-600`}>{s.value}</p>
                <p className="text-xs text-gray-500 mt-0.5">{s.label}</p>
              </div>
            ))}
          </div>

          {validation.errors.length > 0 && (
            <div className="card overflow-hidden">
              <div className="px-4 py-3 bg-red-50 border-b border-red-100 flex items-center gap-2">
                <AlertCircle size={16} className="text-red-500" />
                <p className="text-sm font-medium text-red-700">{validation.errorRows} validation errors found</p>
              </div>
              <div className="overflow-x-auto max-h-64">
                <table className="min-w-full">
                  <thead><tr><th className="table-th">Row</th><th className="table-th">Roll Number</th><th className="table-th">Field</th><th className="table-th">Error</th></tr></thead>
                  <tbody>
                    {validation.errors.slice(0, 20).map((e, i) => (
                      <tr key={i} className="hover:bg-red-50/50">
                        <td className="table-td text-xs">{e.row}</td>
                        <td className="table-td text-xs">{e.rollNumber || '—'}</td>
                        <td className="table-td text-xs">{e.errors?.[0]?.field}</td>
                        <td className="table-td text-xs text-red-600">{e.errors?.[0]?.message}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div className="flex items-center justify-between">
            <button className="btn-secondary" onClick={() => setStep(3)}><ChevronLeft size={14} />Back to Mapping</button>
            <button className="btn-primary" onClick={() => setStep(5)} disabled={validation.validRows === 0}>
              Confirm & Import {validation.validRows} Records <ChevronRight size={14} />
            </button>
          </div>
        </div>
      )}

      {/* Step 5: Done */}
      {step === 5 && (
        <div className="card p-12 text-center">
          <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <Check size={28} className="text-green-600" />
          </div>
          <h3 className="text-lg font-bold text-gray-900 mb-2">Import Successful</h3>
          <p className="text-sm text-gray-500 mb-6">Student marks have been imported and evaluations are ready for review.</p>
          <div className="flex items-center justify-center gap-3">
            <button className="btn-secondary" onClick={() => { setStep(1); setBatchId(null); setMappings([]); setValidation(null); setFiles([]); }}>
              New Import
            </button>
            <a href="/analysis-dashboard" className="btn-primary">View Analysis Dashboard</a>
          </div>
        </div>
      )}

      {/* Recent Uploads */}
      {recentBatches.length > 0 && step === 1 && (
        <div className="card overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100">
            <h3 className="text-sm font-semibold text-gray-800">Recent Upload Batches</h3>
          </div>
          <table className="min-w-full">
            <thead><tr><th className="table-th">File Name</th><th className="table-th">Assessment</th><th className="table-th">Uploaded By</th><th className="table-th">Total / Valid / Errors</th><th className="table-th">Status</th><th className="table-th">Date</th></tr></thead>
            <tbody>
              {recentBatches.map(b => (
                <tr key={b.id} className="hover:bg-gray-50">
                  <td className="table-td text-xs font-medium">{b.fileName}</td>
                  <td className="table-td text-xs">{b.assessment?.title}</td>
                  <td className="table-td text-xs">{b.uploadedBy?.firstName} {b.uploadedBy?.lastName}</td>
                  <td className="table-td text-xs">{b.totalRows} / {b.validRows} / {b.errorRows}</td>
                  <td className="table-td"><StatusBadge status={b.status} /></td>
                  <td className="table-td text-xs text-gray-500">{new Date(b.createdAt).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
