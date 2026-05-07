import { useState, useEffect, useRef } from 'react';
import { externalExamAPI, coursesAPI, evalCyclesAPI, divisionsAPI } from '../services/api';
import { useFilters } from '../context/FilterContext';
import { PageLoader } from '../components/shared/LoadingSpinner';
import {
  FileSpreadsheet, Upload, Sparkles, ChevronRight, ChevronDown,
  CheckCircle, AlertCircle, ArrowLeft, RefreshCw, Eye,
} from 'lucide-react';

// ─── Smart Import Wizard ──────────────────────────────────────────────────────

const WIZARD_STEPS = ['Upload File', 'Review Mapping', 'Import'];

function StepIndicator({ step }) {
  return (
    <div className="flex items-center gap-2 mb-6">
      {WIZARD_STEPS.map((label, i) => (
        <div key={i} className="flex items-center gap-2">
          <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold ${step > i ? 'bg-green-500 text-white' : step === i ? 'bg-primary-600 text-white' : 'bg-gray-200 text-gray-500'}`}>
            {step > i ? <CheckCircle size={14} /> : i + 1}
          </div>
          <span className={`text-xs font-medium ${step === i ? 'text-gray-900' : 'text-gray-400'}`}>{label}</span>
          {i < WIZARD_STEPS.length - 1 && <div className={`w-8 h-0.5 ${step > i ? 'bg-green-400' : 'bg-gray-200'}`} />}
        </div>
      ))}
    </div>
  );
}

function SmartImportWizard({ courses, onDone, onCancel }) {
  const [step, setStep] = useState(0);
  const [file, setFile] = useState(null);
  const [courseId, setCourseId] = useState('');
  const [evalCycleId, setEvalCycleId] = useState('');
  const [divisionId, setDivisionId] = useState('');
  const [examTitle, setExamTitle] = useState('');
  const [cycles, setCycles] = useState([]);
  const [divisions, setDivisions] = useState([]);
  const [parsing, setParsing] = useState(false);
  const [parseResult, setParseResult] = useState(null); // { jobId, detected, headers, sampleRows }
  const [mapping, setMapping] = useState(null); // user-editable version of detected
  const [importing, setImporting] = useState(false);
  const [importProgress, setImportProgress] = useState(0);
  const [importResult, setImportResult] = useState(null);
  const [error, setError] = useState('');
  const fileRef = useRef();

  const CO_COLORS = ['bg-purple-100 text-purple-700', 'bg-blue-100 text-blue-700', 'bg-green-100 text-green-700', 'bg-amber-100 text-amber-700', 'bg-red-100 text-red-700', 'bg-indigo-100 text-indigo-700'];

  useEffect(() => {
    divisionsAPI.list().then(r => setDivisions(r.data || []));
  }, []);

  const loadCycles = async (semId) => {
    if (!semId) return;
    const res = await evalCyclesAPI.list({ semesterId: semId });
    setCycles(res.data || []);
  };

  const handleParse = async () => {
    if (!file || !courseId || !evalCycleId) { setError('Select course, evaluation cycle and upload a file'); return; }
    setParsing(true); setError('');
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await externalExamAPI.smartParse(fd);
      const { detected, headers, sampleRows, jobId } = res.data;

      // Build editable mapping from detected
      const editableMapping = {
        rollCol: detected.rollCol ?? 0,
        nameCol: detected.nameCol ?? 1,
        questions: (detected.questions || []).map((q, i) => ({
          colIndex: q.colIndex,
          questionNo: q.questionNo ?? i + 1,
          coCode: q.coCode || '',
          maxMarks: q.maxMarks ?? 0,
          label: q.label || `Q${q.questionNo ?? i + 1}`,
        })),
      };

      setParseResult({ jobId, detected, headers, sampleRows });
      setMapping(editableMapping);
      setExamTitle(detected.suggestedTitle || 'External Examination');
      setStep(1);
    } catch (err) {
      setError(err.response?.data?.error || 'Parsing failed. Check file format.');
    } finally { setParsing(false); }
  };

  const handleImport = async () => {
    setImporting(true); setImportProgress(10); setError('');
    const tick = setInterval(() => setImportProgress(p => Math.min(p + 8, 90)), 600);
    try {
      const res = await externalExamAPI.smartConfirm({
        jobId: parseResult.jobId,
        courseId,
        evaluationCycleId: evalCycleId,
        divisionId: divisionId || null,
        title: examTitle,
        mapping,
      });
      clearInterval(tick);
      setImportProgress(100);
      setImportResult(res.data);
      setStep(2);
    } catch (err) {
      clearInterval(tick);
      setError(err.response?.data?.error || 'Import failed');
    } finally { setImporting(false); }
  };

  const updateQuestion = (i, field, value) => {
    setMapping(m => {
      const qs = [...m.questions];
      qs[i] = { ...qs[i], [field]: value };
      return { ...m, questions: qs };
    });
  };

  const removeQuestion = (i) => setMapping(m => ({ ...m, questions: m.questions.filter((_, idx) => idx !== i) }));

  return (
    <div className="card p-6">
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-base font-bold text-gray-900 flex items-center gap-2"><Sparkles size={18} className="text-amber-500" />Smart Import — External Exam Marks</h2>
        <button className="text-xs text-gray-400 hover:text-gray-600 flex items-center gap-1" onClick={onCancel}><ArrowLeft size={13} />Back to list</button>
      </div>
      <p className="text-xs text-gray-500 mb-5">Upload the file shared by the exam department — AI detects question columns and CO mapping automatically.</p>

      <StepIndicator step={step} />

      {error && <div className="mb-4 p-3 bg-red-50 border border-red-200 text-sm text-red-700 rounded-lg flex gap-2"><AlertCircle size={16} className="shrink-0 mt-0.5" />{error}</div>}

      {/* Step 0: Upload */}
      {step === 0 && (
        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label text-xs">Course <span className="text-red-500">*</span></label>
              <select className="select" value={courseId} onChange={e => setCourseId(e.target.value)}>
                <option value="">Select course</option>
                {courses.map(c => <option key={c.id} value={c.id}>{c.code} — {c.name}</option>)}
              </select>
            </div>
            <div>
              <label className="label text-xs">Division</label>
              <select className="select" value={divisionId} onChange={e => setDivisionId(e.target.value)}>
                <option value="">All divisions</option>
                {divisions.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </div>
            <div className="col-span-2">
              <label className="label text-xs">Evaluation Cycle <span className="text-red-500">*</span></label>
              <select className="select" value={evalCycleId} onChange={e => setEvalCycleId(e.target.value)}>
                <option value="">Select evaluation cycle</option>
                {cycles.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
              </select>
              {!cycles.length && <p className="text-xs text-amber-600 mt-1">No cycles found — select a semester in the header filter first, then return here.</p>}
            </div>
          </div>

          {/* File drop zone */}
          <div
            className={`border-2 border-dashed rounded-xl p-10 text-center cursor-pointer transition-all ${file ? 'border-primary-400 bg-primary-50' : 'border-gray-200 hover:border-primary-300 hover:bg-gray-50'}`}
            onClick={() => fileRef.current.click()}
            onDragOver={e => e.preventDefault()}
            onDrop={e => { e.preventDefault(); setFile(e.dataTransfer.files[0]); }}
          >
            <input ref={fileRef} type="file" className="hidden" accept=".xlsx,.xls,.csv" onChange={e => setFile(e.target.files[0])} />
            {file ? (
              <div className="space-y-2">
                <CheckCircle size={32} className="text-primary-500 mx-auto" />
                <p className="font-semibold text-gray-800">{file.name}</p>
                <p className="text-sm text-gray-500">{(file.size / 1024).toFixed(0)} KB — Click to change</p>
              </div>
            ) : (
              <div className="space-y-3">
                <FileSpreadsheet size={36} className="text-gray-300 mx-auto" />
                <p className="font-semibold text-gray-700">Drop exam marks file here or click to browse</p>
                <p className="text-sm text-gray-400">Supports Excel (.xlsx, .xls) or CSV — any column format</p>
                <div className="flex flex-wrap justify-center gap-2 mt-3">
                  {['Roll No | Name | Q1(CO1) | Q2(CO2) | Total', 'PRN | Q1 | Q2 | Q3 | Grand Total', 'Enrollment | CO1 | CO2 | CO3'].map(f => (
                    <span key={f} className="text-xs bg-gray-100 text-gray-500 px-2 py-1 rounded font-mono">{f}</span>
                  ))}
                </div>
                <p className="text-xs text-gray-400">AI handles any of these formats automatically</p>
              </div>
            )}
          </div>

          <div className="flex justify-end">
            <button className="btn-primary" onClick={handleParse} disabled={!file || !courseId || !evalCycleId || parsing}>
              {parsing ? (
                <><span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />Analysing file with AI...</>
              ) : (
                <><Sparkles size={15} />Analyse & Detect Mapping</>
              )}
            </button>
          </div>
        </div>
      )}

      {/* Step 1: Review mapping */}
      {step === 1 && mapping && parseResult && (
        <div className="space-y-5">
          {/* Exam title */}
          <div>
            <label className="label text-xs">Exam Title</label>
            <input className="input" value={examTitle} onChange={e => setExamTitle(e.target.value)} />
          </div>

          {/* Detected columns */}
          <div>
            <p className="text-sm font-semibold text-gray-700 mb-2 flex items-center gap-2"><Eye size={15} />AI-Detected Mapping — Review & Edit Before Importing</p>
            <div className="grid grid-cols-2 gap-3 mb-4">
              <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg">
                <p className="text-xs font-semibold text-blue-700 mb-1">Roll Number Column</p>
                <p className="text-sm font-bold text-blue-900">"{parseResult.headers[mapping.rollCol]}"</p>
                <select className="select text-xs mt-1" value={mapping.rollCol} onChange={e => setMapping(m => ({ ...m, rollCol: parseInt(e.target.value) }))}>
                  {parseResult.headers.map((h, i) => <option key={i} value={i}>[{i}] {h}</option>)}
                </select>
              </div>
              <div className="p-3 bg-gray-50 border border-gray-200 rounded-lg">
                <p className="text-xs font-semibold text-gray-600 mb-1">Student Name Column</p>
                <p className="text-sm font-bold text-gray-800">"{mapping.nameCol !== null ? parseResult.headers[mapping.nameCol] : '— None —'}"</p>
                <select className="select text-xs mt-1" value={mapping.nameCol ?? ''} onChange={e => setMapping(m => ({ ...m, nameCol: e.target.value !== '' ? parseInt(e.target.value) : null }))}>
                  <option value="">— Not present —</option>
                  {parseResult.headers.map((h, i) => <option key={i} value={i}>[{i}] {h}</option>)}
                </select>
              </div>
            </div>

            {/* Question mapping table */}
            <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide mb-2">Question → CO Mapping ({mapping.questions.length} detected)</p>
            <div className="overflow-x-auto border border-gray-100 rounded-lg">
              <table className="min-w-full text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="table-th">Column Header</th>
                    <th className="table-th w-16">Q No.</th>
                    <th className="table-th w-28">CO Code</th>
                    <th className="table-th w-24">Max Marks</th>
                    <th className="table-th w-8"></th>
                  </tr>
                </thead>
                <tbody>
                  {mapping.questions.map((q, i) => (
                    <tr key={i} className="border-t border-gray-50">
                      <td className="table-td font-mono text-xs text-gray-600">{parseResult.headers[q.colIndex]}</td>
                      <td className="table-td">
                        <input className="input text-xs w-16" type="number" value={q.questionNo} onChange={e => updateQuestion(i, 'questionNo', parseInt(e.target.value))} />
                      </td>
                      <td className="table-td">
                        <div className="flex items-center gap-1">
                          <span className={`text-xs px-2 py-0.5 rounded-full font-semibold shrink-0 ${CO_COLORS[i % CO_COLORS.length]}`}>{q.coCode || '?'}</span>
                          <input className="input text-xs" value={q.coCode} onChange={e => updateQuestion(i, 'coCode', e.target.value)} placeholder="CO1" />
                        </div>
                      </td>
                      <td className="table-td">
                        <input className="input text-xs" type="number" value={q.maxMarks} onChange={e => updateQuestion(i, 'maxMarks', parseFloat(e.target.value))} />
                      </td>
                      <td className="table-td">
                        <button className="text-red-400 hover:text-red-600 text-xs" onClick={() => removeQuestion(i)}>✕</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Sample data preview */}
          {parseResult.sampleRows?.length > 0 && (
            <details className="bg-gray-50 rounded-lg border border-gray-100">
              <summary className="px-4 py-2 text-xs font-semibold text-gray-600 cursor-pointer">Preview — first {parseResult.sampleRows.length} rows from file</summary>
              <div className="p-3 overflow-x-auto">
                <table className="text-xs font-mono">
                  <thead><tr>{parseResult.headers.map((h, i) => <th key={i} className="px-2 py-1 bg-gray-100 text-left border">[{i}] {h}</th>)}</tr></thead>
                  <tbody>{parseResult.sampleRows.map((row, ri) => <tr key={ri}>{row.map((v, ci) => <td key={ci} className="px-2 py-1 border border-gray-100">{v}</td>)}</tr>)}</tbody>
                </table>
              </div>
            </details>
          )}

          <div className="flex justify-between">
            <button className="btn-secondary flex items-center gap-1" onClick={() => { setStep(0); setParseResult(null); setMapping(null); }}>
              <ArrowLeft size={14} />Re-upload
            </button>
            <button className="btn-primary" onClick={handleImport} disabled={importing || !mapping.questions.length}>
              <CheckCircle size={15} />Import {mapping.questions.length} questions for all students
            </button>
          </div>
        </div>
      )}

      {/* Step 2: Importing progress / result */}
      {(importing || step === 2) && (
        <div className="space-y-5">
          {importing && (
            <div className="space-y-3">
              <p className="text-sm font-semibold text-gray-700">Importing marks for all students...</p>
              <div className="w-full h-3 bg-gray-100 rounded-full overflow-hidden">
                <div className="h-full rounded-full transition-all duration-500"
                  style={{ width: `${importProgress}%`, background: 'linear-gradient(90deg,#2563eb,#7c3aed)' }} />
              </div>
              <p className="text-xs text-gray-400 text-center">Creating exam, questions and uploading marks — please wait</p>
            </div>
          )}

          {importResult && (
            <div className="space-y-4">
              <div className="text-center space-y-2 py-4">
                <CheckCircle size={48} className="text-green-500 mx-auto" />
                <h3 className="text-lg font-bold text-gray-900">Import Complete!</h3>
                <p className="text-sm text-gray-500">{importResult.imported} students imported successfully</p>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div className="bg-green-50 border border-green-200 rounded-lg p-4 text-center">
                  <p className="text-2xl font-bold text-green-700">{importResult.imported}</p>
                  <p className="text-xs text-green-600 mt-0.5">Students Imported</p>
                </div>
                <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 text-center">
                  <p className="text-2xl font-bold text-gray-700">{importResult.total}</p>
                  <p className="text-xs text-gray-500 mt-0.5">Total Rows</p>
                </div>
                <div className={`rounded-lg p-4 text-center border ${importResult.errors?.length ? 'bg-amber-50 border-amber-200' : 'bg-green-50 border-green-200'}`}>
                  <p className={`text-2xl font-bold ${importResult.errors?.length ? 'text-amber-700' : 'text-green-700'}`}>{importResult.errors?.length || 0}</p>
                  <p className={`text-xs mt-0.5 ${importResult.errors?.length ? 'text-amber-600' : 'text-green-600'}`}>Skipped Rows</p>
                </div>
              </div>

              {importResult.errors?.length > 0 && (
                <details className="bg-amber-50 border border-amber-200 rounded-lg">
                  <summary className="px-4 py-2 text-xs font-semibold text-amber-700 cursor-pointer">View {importResult.errors.length} skipped rows</summary>
                  <ul className="px-4 pb-3 space-y-1">
                    {importResult.errors.map((e, i) => <li key={i} className="text-xs text-amber-700">• {e}</li>)}
                  </ul>
                </details>
              )}

              <div className="flex gap-3 justify-center">
                <button className="btn-secondary" onClick={() => { setStep(0); setFile(null); setParseResult(null); setMapping(null); setImportResult(null); setImportProgress(0); }}>
                  <RefreshCw size={14} />Import Another File
                </button>
                <button className="btn-primary" onClick={onDone}>View All Exams</button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function ExternalExam() {
  const { filters } = useFilters();
  const [view, setView] = useState('list'); // 'list' | 'import'
  const [exams, setExams] = useState([]);
  const [courses, setCourses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(null);
  const [examDetail, setExamDetail] = useState({});

  const load = async () => {
    setLoading(true);
    const params = {};
    if (filters.courseId) params.courseId = filters.courseId;
    if (filters.semesterId) params.semesterId = filters.semesterId;
    if (filters.evalCycleId) params.evalCycleId = filters.evalCycleId;
    const [examRes, courseRes] = await Promise.all([
      externalExamAPI.list(params),
      coursesAPI.list(),
    ]);
    setExams(examRes.data);
    setCourses(courseRes.data?.courses || courseRes.data || []);
    setLoading(false);
  };

  useEffect(() => { load(); }, [filters.courseId, filters.semesterId, filters.evalCycleId]);

  const toggleExam = async (id) => {
    if (expanded === id) { setExpanded(null); return; }
    setExpanded(id);
    if (!examDetail[id]) {
      const res = await externalExamAPI.get(id);
      setExamDetail(d => ({ ...d, [id]: res.data }));
    }
  };

  if (loading && view === 'list') return <PageLoader />;

  if (view === 'import') {
    return (
      <div className="space-y-6">
        <div className="page-header">
          <div>
            <h1 className="text-xl font-bold text-gray-900 flex items-center gap-2"><FileSpreadsheet size={20} className="text-primary-600" />External Exam Marks</h1>
            <p className="text-sm text-gray-500 mt-0.5">Smart import — AI reads any exam format from the exam department</p>
          </div>
        </div>
        <SmartImportWizard courses={courses} onDone={() => { setView('list'); load(); }} onCancel={() => setView('list')} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="page-header">
        <div>
          <h1 className="text-xl font-bold text-gray-900 flex items-center gap-2"><FileSpreadsheet size={20} className="text-primary-600" />External Exam Marks</h1>
          <p className="text-sm text-gray-500 mt-0.5">Upload question-wise marks from the exam department — AI maps COs automatically</p>
        </div>
        <button className="btn-primary" onClick={() => setView('import')}>
          <Sparkles size={15} />Smart Import
        </button>
      </div>

      {/* Exam list */}
      <div className="space-y-3">
        {exams.length === 0 && (
          <div className="card p-12 text-center">
            <FileSpreadsheet size={40} className="text-gray-200 mx-auto mb-4" />
            <p className="text-sm font-semibold text-gray-600 mb-1">No external exam records yet</p>
            <p className="text-xs text-gray-400 mb-4">Click "Smart Import" to upload the exam department's marks sheet — any format supported.</p>
            <button className="btn-primary mx-auto" onClick={() => setView('import')}><Sparkles size={14} />Start Smart Import</button>
          </div>
        )}

        {exams.map(exam => {
          const detail = examDetail[exam.id];
          const isOpen = expanded === exam.id;
          return (
            <div key={exam.id} className="card overflow-hidden">
              <div className="px-5 py-4 flex items-center gap-4 cursor-pointer hover:bg-gray-50" onClick={() => toggleExam(exam.id)}>
                <div className="w-10 h-10 bg-primary-50 rounded-lg flex items-center justify-center shrink-0">
                  <FileSpreadsheet size={18} className="text-primary-600" />
                </div>
                <div className="flex-1">
                  <p className="font-semibold text-gray-900 text-sm">{exam.title}</p>
                  <p className="text-xs text-gray-500 mt-0.5">{exam.course?.code} — {exam.evaluationCycle?.label}{exam.division ? ` · ${exam.division.name}` : ''}</p>
                </div>
                <div className="flex items-center gap-4 text-xs text-gray-400 shrink-0">
                  <span>{exam._count?.examQuestions || 0} questions</span>
                  <span>Max: {exam.totalMarks} marks</span>
                </div>
                {isOpen ? <ChevronDown size={16} className="text-gray-400" /> : <ChevronRight size={16} className="text-gray-400" />}
              </div>

              {isOpen && detail && (
                <div className="border-t border-gray-100 p-5">
                  <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide mb-3">Questions & CO Mapping</p>
                  <div className="overflow-x-auto">
                    <table className="min-w-full text-sm">
                      <thead className="bg-gray-50">
                        <tr><th className="table-th w-16">Q No.</th><th className="table-th">Description</th><th className="table-th w-28">CO Mapped</th><th className="table-th w-24">Max Marks</th></tr>
                      </thead>
                      <tbody>
                        {detail.examQuestions?.map(q => (
                          <tr key={q.id} className="border-t border-gray-50">
                            <td className="table-td font-bold text-center text-primary-700">Q{q.number}</td>
                            <td className="table-td text-gray-600">{q.text || '—'}</td>
                            <td className="table-td">
                              <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${q.co ? 'bg-purple-50 text-purple-700' : 'bg-gray-100 text-gray-400'}`}>{q.co?.code || 'Not mapped'}</span>
                            </td>
                            <td className="table-td text-center font-semibold">{q.maxMarks}</td>
                          </tr>
                        ))}
                        {!detail.examQuestions?.length && <tr><td colSpan={4} className="table-td text-center text-gray-400 py-4">No questions</td></tr>}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
