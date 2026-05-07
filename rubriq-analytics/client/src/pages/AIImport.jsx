import { useState, useRef, useEffect } from 'react';
import { aiImportAPI } from '../services/api';
import { Upload, Sparkles, CheckCircle, AlertCircle, FileText, Loader, ChevronDown, ChevronUp } from 'lucide-react';

const IMPORT_STEPS = [
  { label: 'Saving University & College...', pct: 10 },
  { label: 'Saving Department...', pct: 20 },
  { label: 'Saving Program...', pct: 32 },
  { label: 'Saving Course...', pct: 44 },
  { label: 'Saving Program Outcomes (POs)...', pct: 55 },
  { label: 'Saving Program Specific Outcomes (PSOs)...', pct: 64 },
  { label: 'Saving Course Outcomes (COs)...', pct: 74 },
  { label: 'Saving CO-PO Mappings...', pct: 83 },
  { label: 'Creating Rubric Template...', pct: 91 },
  { label: 'Finalising & verifying...', pct: 96 },
];

function ImportProgress({ active, done }) {
  const [stepIdx, setStepIdx] = useState(0);
  const [pct, setPct] = useState(0);

  useEffect(() => {
    if (!active) { setStepIdx(0); setPct(0); return; }
    setStepIdx(0); setPct(0);
    let i = 0;
    const tick = () => {
      if (i < IMPORT_STEPS.length) {
        setStepIdx(i);
        setPct(IMPORT_STEPS[i].pct);
        i++;
      }
    };
    tick();
    const id = setInterval(tick, 600);
    return () => clearInterval(id);
  }, [active]);

  const displayPct = done ? 100 : pct;
  const label = done ? 'Import complete!' : (IMPORT_STEPS[stepIdx]?.label || 'Processing...');

  if (!active && !done) return null;

  return (
    <div className="card p-8 space-y-6">
      <div className="text-center space-y-1">
        <div className="w-12 h-12 rounded-full bg-primary-50 flex items-center justify-center mx-auto mb-4">
          {done
            ? <CheckCircle size={28} className="text-green-500" />
            : <Loader size={28} className="text-primary-600 animate-spin" />}
        </div>
        <h3 className="text-base font-semibold text-gray-900">
          {done ? 'All records saved!' : 'Importing records...'}
        </h3>
        <p className="text-sm text-gray-500">{label}</p>
      </div>

      <div className="space-y-2">
        <div className="flex justify-between text-xs text-gray-500">
          <span>Progress</span>
          <span>{displayPct}%</span>
        </div>
        <div className="w-full h-3 bg-gray-100 rounded-full overflow-hidden">
          <div
            className="h-full rounded-full transition-all duration-500"
            style={{
              width: `${displayPct}%`,
              background: done
                ? 'linear-gradient(90deg, #16a34a, #22c55e)'
                : 'linear-gradient(90deg, #2563eb, #7c3aed)',
            }}
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        {IMPORT_STEPS.map((s, i) => (
          <div key={i} className={`flex items-center gap-2 text-xs px-3 py-2 rounded-lg transition-all ${
            done || i < stepIdx
              ? 'bg-green-50 text-green-700'
              : i === stepIdx
              ? 'bg-primary-50 text-primary-700 font-medium'
              : 'bg-gray-50 text-gray-400'
          }`}>
            <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${
              done || i < stepIdx ? 'bg-green-500' : i === stepIdx ? 'bg-primary-500' : 'bg-gray-300'
            }`} />
            {s.label.replace('...', '')}
          </div>
        ))}
      </div>

      {!done && (
        <p className="text-center text-xs text-gray-400">Please wait — this may take a few seconds</p>
      )}
    </div>
  );
}

const BLOOM_LEVELS = ['Remember', 'Understand', 'Apply', 'Analyze', 'Evaluate', 'Create'];
const CONFIDENCE_COLOR = (v) => v >= 0.85 ? 'text-green-600 bg-green-50' : v >= 0.6 ? 'text-amber-600 bg-amber-50' : 'text-red-600 bg-red-50';
const CONFIDENCE_LABEL = (v) => v >= 0.85 ? 'High' : v >= 0.6 ? 'Review' : 'Low — Edit required';

function ConfidenceBadge({ value }) {
  if (!value) return null;
  return <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${CONFIDENCE_COLOR(value)}`}>{CONFIDENCE_LABEL(value)}</span>;
}

function Section({ title, confidence, children, defaultOpen = true }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="card overflow-hidden">
      <button className="w-full px-5 py-3 flex items-center justify-between border-b border-gray-100 hover:bg-gray-50" onClick={() => setOpen(o => !o)}>
        <div className="flex items-center gap-3">
          <span className="font-semibold text-gray-800 text-sm">{title}</span>
          <ConfidenceBadge value={confidence} />
        </div>
        {open ? <ChevronUp size={16} className="text-gray-400" /> : <ChevronDown size={16} className="text-gray-400" />}
      </button>
      {open && <div className="p-5">{children}</div>}
    </div>
  );
}

function Field({ label, value, onChange, type = 'text', options }) {
  const cls = `input text-sm ${value === null || value === '' ? 'border-amber-300 bg-amber-50' : ''}`;
  if (options) return (
    <div>
      <label className="label text-xs">{label}</label>
      <select className={cls} value={value || ''} onChange={e => onChange(e.target.value)}>
        <option value="">— Not found —</option>
        {options.map(o => <option key={o} value={o}>{o}</option>)}
      </select>
    </div>
  );
  return (
    <div>
      <label className="label text-xs">{label}</label>
      <input type={type} className={cls} value={value || ''} onChange={e => onChange(type === 'number' ? Number(e.target.value) : e.target.value)} placeholder="Not extracted — enter manually" />
    </div>
  );
}

export default function AIImport() {
  const [step, setStep] = useState(1);
  const [file, setFile] = useState(null);
  const [extracting, setExtracting] = useState(false);
  const [extracted, setExtracted] = useState(null);
  const [fileName, setFileName] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [importDone, setImportDone] = useState(false);
  const [results, setResults] = useState(null);
  const [error, setError] = useState('');
  const inputRef = useRef();

  const handleFile = (f) => {
    setFile(f);
    setError('');
  };

  const handleExtract = async () => {
    if (!file) return;
    setExtracting(true); setError('');
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await aiImportAPI.extract(fd);
      setExtracted(res.data.extracted);
      setFileName(res.data.fileName);
      setStep(2);
    } catch (err) {
      setError(err.response?.data?.error || 'Extraction failed. Please try again.');
    } finally { setExtracting(false); }
  };

  const handleConfirm = async () => {
    setConfirming(true); setImportDone(false); setError('');
    try {
      const res = await aiImportAPI.confirm(extracted);
      setImportDone(true);
      await new Promise(r => setTimeout(r, 900));
      setResults(res.data.results);
      setStep(3);
    } catch (err) {
      setError(err.response?.data?.error || 'Import failed.');
    } finally { setConfirming(false); setImportDone(false); }
  };

  const update = (path, value) => {
    setExtracted(prev => {
      const next = { ...prev };
      const keys = path.split('.');
      let obj = next;
      for (let i = 0; i < keys.length - 1; i++) {
        obj[keys[i]] = { ...obj[keys[i]] };
        obj = obj[keys[i]];
      }
      obj[keys[keys.length - 1]] = value;
      return next;
    });
  };

  const updateArray = (key, index, field, value) => {
    setExtracted(prev => {
      const arr = [...(prev[key] || [])];
      arr[index] = { ...arr[index], [field]: value };
      return { ...prev, [key]: arr };
    });
  };

  const addRow = (key, template) => setExtracted(prev => ({ ...prev, [key]: [...(prev[key] || []), template] }));
  const removeRow = (key, index) => setExtracted(prev => ({ ...prev, [key]: prev[key].filter((_, i) => i !== index) }));

  return (
    <div className="space-y-6">
      <div className="page-header">
        <div>
          <h1 className="text-xl font-bold text-gray-900 flex items-center gap-2"><Sparkles size={20} className="text-amber-500" />AI Syllabus Import</h1>
          <p className="text-sm text-gray-500 mt-0.5">Upload your course syllabus — AI extracts all master data automatically</p>
        </div>
        <div className="flex items-center gap-2">
          {[1, 2, 3].map(s => (
            <div key={s} className="flex items-center gap-1">
              <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${step >= s ? 'bg-primary-600 text-white' : 'bg-gray-200 text-gray-500'}`}>{s}</div>
              {s < 3 && <div className={`w-8 h-0.5 ${step > s ? 'bg-primary-600' : 'bg-gray-200'}`} />}
            </div>
          ))}
          <span className="text-xs text-gray-500 ml-1">{step === 1 ? 'Upload' : step === 2 ? 'Review' : 'Done'}</span>
        </div>
      </div>

      {error && <div className="p-3 bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg flex items-center gap-2"><AlertCircle size={16} />{error}</div>}

      {/* Step 1: Upload */}
      {step === 1 && (
        <div className="space-y-4">
          <div
            className={`card border-2 border-dashed p-12 text-center cursor-pointer transition-all ${file ? 'border-primary-400 bg-primary-50' : 'border-gray-200 hover:border-primary-300 hover:bg-gray-50'}`}
            onClick={() => inputRef.current.click()}
            onDragOver={e => e.preventDefault()}
            onDrop={e => { e.preventDefault(); handleFile(e.dataTransfer.files[0]); }}
          >
            <input ref={inputRef} type="file" className="hidden" accept=".pdf,.docx,.doc,.xlsx,.xls,.jpg,.jpeg,.png" onChange={e => handleFile(e.target.files[0])} />
            {file ? (
              <div className="space-y-2">
                <CheckCircle size={32} className="text-primary-500 mx-auto" />
                <p className="font-semibold text-gray-800">{file.name}</p>
                <p className="text-sm text-gray-500">{(file.size / 1024).toFixed(0)} KB — Click to change</p>
              </div>
            ) : (
              <div className="space-y-3">
                <Upload size={32} className="text-gray-300 mx-auto" />
                <p className="font-semibold text-gray-700">Drop your syllabus here or click to browse</p>
                <p className="text-sm text-gray-400">Supports PDF, Word, Excel, or scanned image (JPG/PNG)</p>
                <p className="text-xs text-gray-400">No fixed format — AI reads any standard syllabus document</p>
              </div>
            )}
          </div>

          <div className="card p-4 bg-amber-50 border border-amber-200">
            <p className="text-sm font-semibold text-amber-800 mb-2">What will be extracted:</p>
            <div className="flex flex-wrap gap-2">
              {['University', 'College', 'Department', 'Program', 'Course', 'Course Outcomes (COs)', 'Program Outcomes (POs)', 'CO-PO Mapping', 'Rubric Criteria', 'Assessment Config'].map(i => (
                <span key={i} className="text-xs px-2 py-1 bg-white border border-amber-200 rounded text-amber-700">{i}</span>
              ))}
            </div>
          </div>

          <div className="flex justify-end">
            <button className="btn-primary" onClick={handleExtract} disabled={!file || extracting}>
              {extracting ? <><Loader size={15} className="animate-spin" />Analysing document...</> : <><Sparkles size={15} />Extract with AI</>}
            </button>
          </div>
        </div>
      )}

      {/* Step 2: Review */}
      {step === 2 && extracted && (
        <div className="space-y-4">
          {confirming ? (
            <ImportProgress active={confirming} done={importDone} />
          ) : (<>
          <div className="flex items-center justify-between">
            <p className="text-sm text-gray-500">Extracted from: <span className="font-medium text-gray-700">{fileName}</span> — Review and edit before importing</p>
            <div className="flex gap-2">
              <button className="btn-secondary text-sm" onClick={() => setStep(1)}>← Re-upload</button>
              <button className="btn-primary text-sm" onClick={handleConfirm} disabled={confirming}>
                {confirming ? <><Loader size={14} className="animate-spin" />Importing...</> : <><CheckCircle size={14} />Import All Records</>}
              </button>
            </div>
          </div>

          {/* University / College / Dept / Program */}
          <Section title="University & College" confidence={extracted.confidence?.university}>
            <div className="grid grid-cols-2 gap-4">
              <Field label="University Name" value={extracted.university?.name} onChange={v => update('university.name', v)} />
              <Field label="University Code" value={extracted.university?.code} onChange={v => update('university.code', v)} />
              <Field label="College Name" value={extracted.college?.name} onChange={v => update('college.name', v)} />
              <Field label="College Code" value={extracted.college?.code} onChange={v => update('college.code', v)} />
              <Field label="Department Name" value={extracted.department?.name} onChange={v => update('department.name', v)} />
              <Field label="Department Code" value={extracted.department?.code} onChange={v => update('department.code', v)} />
            </div>
          </Section>

          <Section title="Program & Course" confidence={extracted.confidence?.program}>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Program Name" value={extracted.program?.name} onChange={v => update('program.name', v)} />
              <Field label="Program Code" value={extracted.program?.code} onChange={v => update('program.code', v)} />
              <Field label="Level" value={extracted.program?.level} onChange={v => update('program.level', v)} options={['UG', 'PG', 'PhD', 'Diploma']} />
              <Field label="Duration (years)" value={extracted.program?.duration} onChange={v => update('program.duration', v)} type="number" />
              <Field label="Course Name" value={extracted.course?.name} onChange={v => update('course.name', v)} />
              <Field label="Course Code" value={extracted.course?.code} onChange={v => update('course.code', v)} />
              <Field label="Credits" value={extracted.course?.credits} onChange={v => update('course.credits', v)} type="number" />
              <Field label="Semester Number" value={extracted.course?.semester} onChange={v => update('course.semester', v)} type="number" />
            </div>
          </Section>

          <Section title={`Course Outcomes (${extracted.courseOutcomes?.length || 0})`} confidence={extracted.confidence?.courseOutcomes}>
            <table className="min-w-full text-sm">
              <thead><tr><th className="table-th w-16">Code</th><th className="table-th">Description</th><th className="table-th w-36">Bloom's Level</th><th className="table-th w-8"></th></tr></thead>
              <tbody>
                {(extracted.courseOutcomes || []).map((co, i) => (
                  <tr key={i} className="border-b border-gray-50">
                    <td className="table-td"><input className="input text-xs w-16" value={co.code || ''} onChange={e => updateArray('courseOutcomes', i, 'code', e.target.value)} /></td>
                    <td className="table-td"><input className="input text-xs w-full" value={co.description || ''} onChange={e => updateArray('courseOutcomes', i, 'description', e.target.value)} /></td>
                    <td className="table-td">
                      <select className="select text-xs" value={co.bloomLevel || ''} onChange={e => updateArray('courseOutcomes', i, 'bloomLevel', e.target.value)}>
                        <option value="">Select</option>
                        {BLOOM_LEVELS.map(b => <option key={b} value={b}>{b}</option>)}
                      </select>
                    </td>
                    <td className="table-td"><button className="text-red-400 hover:text-red-600 text-xs" onClick={() => removeRow('courseOutcomes', i)}>✕</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
            <button className="mt-3 text-xs text-primary-600 hover:underline" onClick={() => addRow('courseOutcomes', { code: `CO${(extracted.courseOutcomes?.length || 0) + 1}`, description: '', bloomLevel: '' })}>+ Add CO</button>
          </Section>

          <Section title={`Program Outcomes (${extracted.programOutcomes?.length || 0})`} confidence={extracted.confidence?.programOutcomes} defaultOpen={false}>
            <table className="min-w-full text-sm">
              <thead><tr><th className="table-th w-16">Code</th><th className="table-th">Description</th><th className="table-th w-8"></th></tr></thead>
              <tbody>
                {(extracted.programOutcomes || []).map((po, i) => (
                  <tr key={i} className="border-b border-gray-50">
                    <td className="table-td"><input className="input text-xs w-16" value={po.code || ''} onChange={e => updateArray('programOutcomes', i, 'code', e.target.value)} /></td>
                    <td className="table-td"><input className="input text-xs w-full" value={po.description || ''} onChange={e => updateArray('programOutcomes', i, 'description', e.target.value)} /></td>
                    <td className="table-td"><button className="text-red-400 hover:text-red-600 text-xs" onClick={() => removeRow('programOutcomes', i)}>✕</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
            <button className="mt-3 text-xs text-primary-600 hover:underline" onClick={() => addRow('programOutcomes', { code: `PO${(extracted.programOutcomes?.length || 0) + 1}`, description: '' })}>+ Add PO</button>
          </Section>

          <Section title={`CO-PO Mapping (${extracted.coPOMapping?.length || 0} entries)`} confidence={extracted.confidence?.coPOMapping} defaultOpen={false}>
            <table className="min-w-full text-sm">
              <thead><tr><th className="table-th">CO</th><th className="table-th">PO</th><th className="table-th w-24">Strength</th><th className="table-th w-8"></th></tr></thead>
              <tbody>
                {(extracted.coPOMapping || []).map((m, i) => (
                  <tr key={i} className="border-b border-gray-50">
                    <td className="table-td"><input className="input text-xs w-20" value={m.co || ''} onChange={e => updateArray('coPOMapping', i, 'co', e.target.value)} /></td>
                    <td className="table-td"><input className="input text-xs w-20" value={m.po || ''} onChange={e => updateArray('coPOMapping', i, 'po', e.target.value)} /></td>
                    <td className="table-td">
                      <select className="select text-xs" value={m.strength || 3} onChange={e => updateArray('coPOMapping', i, 'strength', parseInt(e.target.value))}>
                        <option value={1}>1 — Low</option><option value={2}>2 — Medium</option><option value={3}>3 — High</option>
                      </select>
                    </td>
                    <td className="table-td"><button className="text-red-400 hover:text-red-600 text-xs" onClick={() => removeRow('coPOMapping', i)}>✕</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
            <button className="mt-3 text-xs text-primary-600 hover:underline" onClick={() => addRow('coPOMapping', { co: '', po: '', strength: 3 })}>+ Add Mapping</button>
          </Section>

          {extracted.rubricCriteria?.length > 0 && (
            <Section title={`Rubric Criteria (${extracted.rubricCriteria.length})`} confidence={extracted.confidence?.rubricCriteria} defaultOpen={false}>
              <div className="space-y-3">
                {extracted.rubricCriteria.map((c, i) => (
                  <div key={i} className="border border-gray-100 rounded-lg p-4 space-y-2">
                    <div className="grid grid-cols-3 gap-3">
                      <div className="col-span-2"><label className="label text-xs">Criterion Title</label><input className="input text-xs" value={c.title || ''} onChange={e => { const arr = [...extracted.rubricCriteria]; arr[i] = { ...arr[i], title: e.target.value }; setExtracted(p => ({ ...p, rubricCriteria: arr })); }} /></div>
                      <div><label className="label text-xs">Max Marks</label><input type="number" className="input text-xs" value={c.maxMarks || ''} onChange={e => { const arr = [...extracted.rubricCriteria]; arr[i] = { ...arr[i], maxMarks: Number(e.target.value) }; setExtracted(p => ({ ...p, rubricCriteria: arr })); }} /></div>
                    </div>
                  </div>
                ))}
              </div>
            </Section>
          )}

          <Section title="Assessment Configuration" confidence={1} defaultOpen={false}>
            <div className="grid grid-cols-3 gap-4">
              <Field label="Internal Weightage (%)" value={extracted.assessmentConfig?.internalWeightage} onChange={v => update('assessmentConfig.internalWeightage', Number(v))} type="number" />
              <Field label="External Weightage (%)" value={extracted.assessmentConfig?.externalWeightage} onChange={v => update('assessmentConfig.externalWeightage', Number(v))} type="number" />
              <Field label="Attainment Threshold (%)" value={extracted.assessmentConfig?.attainmentThreshold} onChange={v => update('assessmentConfig.attainmentThreshold', Number(v))} type="number" />
            </div>
          </Section>

          <div className="flex justify-end gap-2 pt-2">
            <button className="btn-secondary" onClick={() => setStep(1)}>← Re-upload</button>
            <button className="btn-primary" onClick={handleConfirm} disabled={confirming}>
              {confirming ? <><Loader size={14} className="animate-spin" />Importing...</> : <><CheckCircle size={14} />Import All Records</>}
            </button>
          </div>
          </>)}
        </div>
      )}

      {/* Step 3: Success */}
      {step === 3 && results && (
        <div className="space-y-4">
          <div className="card p-8 text-center space-y-3">
            <CheckCircle size={48} className="text-green-500 mx-auto" />
            <h2 className="text-lg font-bold text-gray-900">Import Successful!</h2>
            <p className="text-sm text-gray-500">All master records have been created from your syllabus.</p>
          </div>

          <div className="card p-5">
            <h3 className="font-semibold text-gray-800 mb-4">Import Summary</h3>
            <div className="grid grid-cols-2 gap-4">
              {Object.entries(results.created || {}).map(([key, val]) => (
                <div key={key} className="flex items-center gap-2 p-3 bg-green-50 rounded-lg">
                  <CheckCircle size={16} className="text-green-500 shrink-0" />
                  <div>
                    <p className="text-xs font-semibold text-green-800 capitalize">{key.replace(/([A-Z])/g, ' $1')}</p>
                    <p className="text-xs text-green-600">{typeof val === 'number' ? `${val} record(s)` : val}</p>
                  </div>
                </div>
              ))}
              {Object.entries(results.skipped || {}).map(([key, val]) => (
                <div key={key} className="flex items-center gap-2 p-3 bg-gray-50 rounded-lg">
                  <FileText size={16} className="text-gray-400 shrink-0" />
                  <div>
                    <p className="text-xs font-semibold text-gray-600 capitalize">{key} — already exists</p>
                    <p className="text-xs text-gray-400">{val}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="flex gap-2 justify-center">
            <button className="btn-secondary" onClick={() => { setStep(1); setFile(null); setExtracted(null); setResults(null); setImportDone(false); }}>Import Another Syllabus</button>
            <a href="/programs-courses" className="btn-primary">View Programs & Courses →</a>
          </div>
        </div>
      )}
    </div>
  );
}
