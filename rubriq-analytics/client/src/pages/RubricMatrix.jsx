import { useState, useEffect } from 'react';
import { rubricsAPI, coursesAPI } from '../services/api';
import Modal from '../components/shared/Modal';
import FormSection, { FormGrid, FormField } from '../components/shared/FormSection';
import { PageLoader } from '../components/shared/LoadingSpinner';
import { Plus, Edit2, ChevronDown, ChevronRight, Download, BookOpen } from 'lucide-react';

const BLOOM_LEVELS = ['Remember', 'Understand', 'Apply', 'Analyze', 'Evaluate', 'Create'];
const LEVEL_COLORS = { Excellent: '#16a34a', Good: '#2563eb', Satisfactory: '#f59e0b', 'Needs Improvement': '#ef4444' };

export default function RubricMatrix() {
  const [courses, setCourses] = useState([]);
  const [selectedCourseId, setSelectedCourseId] = useState('');
  const [rubrics, setRubrics] = useState([]);
  const [selectedRubric, setSelectedRubric] = useState(null);
  const [loading, setLoading] = useState(true);
  const [expandedCriteria, setExpandedCriteria] = useState(new Set());
  const [modal, setModal] = useState({ open: false, type: '', data: null, parentId: null });
  const [form, setForm] = useState({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    coursesAPI.list().then(r => {
      setCourses(r.data?.courses || r.data || []);
      setLoading(false);
    });
  }, []);

  useEffect(() => {
    if (!selectedCourseId) { setRubrics([]); setSelectedRubric(null); return; }
    rubricsAPI.list({ courseId: selectedCourseId }).then(async r => {
      const list = r.data || [];
      setRubrics(list);
      if (list.length > 0) {
        const full = await rubricsAPI.get(list[0].id);
        setSelectedRubric(full.data);
      } else {
        setSelectedRubric(null);
      }
    });
  }, [selectedCourseId]);

  const loadRubric = async (id) => {
    const res = await rubricsAPI.get(id);
    setSelectedRubric(res.data);
  };

  const toggleCriterion = (id) => setExpandedCriteria(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const openModal = (type, data = null, parentId = null) => {
    setForm(data || {});
    setError('');
    setModal({ open: true, type, data, parentId });
  };

  const closeModal = () => setModal({ open: false, type: '', data: null, parentId: null });

  const handleCreateTemplate = async () => {
    setSaving(true); setError('');
    try {
      const course = courses.find(c => c.id === parseInt(selectedCourseId));
      const res = await rubricsAPI.create({
        courseId: parseInt(selectedCourseId),
        title: `${course?.name || 'Course'} Rubric`,
        description: 'Course-level rubric template',
        totalMarks: 30,
        isPublished: false,
      });
      const full = await rubricsAPI.get(res.data.id);
      setRubrics(prev => [...prev, res.data]);
      setSelectedRubric(full.data);
      closeModal();
    } catch (err) {
      setError(err.response?.data?.error || 'Create failed');
    } finally { setSaving(false); }
  };

  const handleSave = async () => {
    setSaving(true); setError('');
    try {
      if (modal.type === 'criterion') {
        if (modal.data) await rubricsAPI.updateCriterion(modal.data.id, form);
        else await rubricsAPI.addCriterion(selectedRubric.id, form);
      } else if (modal.type === 'level') {
        if (modal.data) await rubricsAPI.updateLevel(modal.data.id, form);
        else await rubricsAPI.addLevel(modal.parentId, form);
      }
      await loadRubric(selectedRubric.id);
      closeModal();
    } catch (err) {
      setError(err.response?.data?.error || 'Save failed');
    } finally { setSaving(false); }
  };

  if (loading) return <PageLoader />;

  const criteria = selectedRubric?.criteria || [];
  const totalMarks = criteria.reduce((sum, c) => sum + (c.maxMarks || 0), 0);

  return (
    <div className="space-y-6">
      <div className="page-header">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Rubric Matrix Builder</h1>
          <p className="text-sm text-gray-500 mt-0.5">Design and manage course-level rubric templates with performance level descriptors</p>
        </div>
        <div className="flex gap-2">
          <button className="btn-secondary text-sm" onClick={() => window.print()}><Download size={14} />Export Rubric</button>
        </div>
      </div>

      {/* Course Selector */}
      <div className="card p-4">
        <div className="flex items-center gap-4">
          <BookOpen size={18} className="text-primary-600 shrink-0" />
          <div className="flex-1">
            <label className="block text-xs font-semibold text-gray-600 mb-1">Select Course</label>
            <select className="select" value={selectedCourseId} onChange={e => setSelectedCourseId(e.target.value)}>
              <option value="">— Choose a course to view/edit its rubric template —</option>
              {courses.map(c => (
                <option key={c.id} value={c.id}>{c.code} — {c.name}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Rubric tabs (if multiple rubrics for course) */}
      {rubrics.length > 1 && (
        <div className="flex gap-2 overflow-x-auto pb-1">
          {rubrics.map(r => (
            <button key={r.id} onClick={() => loadRubric(r.id)}
              className={`shrink-0 px-3 py-1.5 text-xs font-medium rounded-lg border transition-all ${selectedRubric?.id === r.id ? 'bg-primary-600 text-white border-primary-600' : 'bg-white text-gray-600 border-gray-200 hover:border-gray-300'}`}>
              {r.title}
            </button>
          ))}
        </div>
      )}

      {/* No rubric yet — offer to create */}
      {selectedCourseId && rubrics.length === 0 && (
        <div className="card p-10 text-center">
          <div className="w-14 h-14 bg-primary-50 rounded-full flex items-center justify-center mx-auto mb-4">
            <BookOpen size={24} className="text-primary-500" />
          </div>
          <p className="text-sm font-semibold text-gray-700 mb-1">No rubric template for this course yet</p>
          <p className="text-xs text-gray-500 mb-5">Create a rubric template to define performance criteria and levels for assessment.</p>
          <button className="btn-primary text-sm mx-auto" onClick={handleCreateTemplate} disabled={saving}>
            <Plus size={14} />{saving ? 'Creating...' : 'Create Rubric Template'}
          </button>
        </div>
      )}

      {/* No course selected */}
      {!selectedCourseId && (
        <div className="card p-10 text-center text-sm text-gray-400">
          Select a course above to view or build its rubric template.
        </div>
      )}

      {selectedRubric && (
        <>
          {/* Rubric Header */}
          <div className="card p-5 text-white" style={{ background: 'linear-gradient(135deg, #1e3a5f, #2563eb)' }}>
            <div className="flex items-start justify-between">
              <div>
                <h2 className="text-base font-bold text-white">{selectedRubric.title}</h2>
                <p className="text-sm text-blue-200 mt-1">{selectedRubric.description}</p>
                <div className="flex items-center gap-3 mt-3">
                  <span className="text-xs bg-white/20 px-2.5 py-1 rounded-full">Total: {totalMarks} marks</span>
                  <span className="text-xs bg-white/20 px-2.5 py-1 rounded-full">{criteria.length} criteria</span>
                  {selectedRubric.isPublished && <span className="text-xs bg-green-500/30 border border-green-400/50 px-2.5 py-1 rounded-full text-green-300">Published</span>}
                </div>
              </div>
              <button className="text-xs px-3 py-1.5 bg-white/10 hover:bg-white/20 rounded-lg text-white border border-white/20 transition-colors flex items-center gap-1.5" onClick={() => openModal('criterion')}>
                <Plus size={13} />Add Criterion
              </button>
            </div>
          </div>

          {/* Performance Level Legend */}
          <div className="card p-4">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Performance Level Legend</p>
            <div className="grid grid-cols-4 gap-3">
              {[
                { level: 'Excellent', color: '#16a34a', bg: '#f0fdf4', border: '#bbf7d0' },
                { level: 'Good', color: '#2563eb', bg: '#eff6ff', border: '#bfdbfe' },
                { level: 'Satisfactory', color: '#f59e0b', bg: '#fffbeb', border: '#fde68a' },
                { level: 'Needs Improvement', color: '#ef4444', bg: '#fef2f2', border: '#fecaca' },
              ].map(l => (
                <div key={l.level} className="rounded-lg px-3 py-2.5 border" style={{ background: l.bg, borderColor: l.border }}>
                  <p className="text-xs font-bold" style={{ color: l.color }}>{l.level}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Criteria */}
          <div className="space-y-3">
            {criteria.length === 0 && (
              <div className="card p-8 text-center text-sm text-gray-400">
                No criteria yet. Click "Add Criterion" to get started.
              </div>
            )}
            {criteria.map((criterion, idx) => (
              <div key={criterion.id} className="card overflow-hidden">
                <div
                  className="px-5 py-3.5 flex items-center gap-3 cursor-pointer hover:bg-gray-50 transition-colors"
                  onClick={() => toggleCriterion(criterion.id)}
                >
                  <div className="w-7 h-7 bg-primary-100 text-primary-700 rounded-lg flex items-center justify-center text-xs font-bold shrink-0">
                    {idx + 1}
                  </div>
                  <div className="flex-1">
                    <p className="text-sm font-semibold text-gray-900">{criterion.title}</p>
                    <div className="flex items-center gap-3 mt-0.5">
                      <span className="text-xs text-gray-500">Max: {criterion.maxMarks} marks</span>
                      {criterion.bloomLevel && <span className="text-xs bg-purple-50 text-purple-700 px-2 py-0.5 rounded-full">{criterion.bloomLevel}</span>}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button className="btn-ghost py-1 text-xs" onClick={e => { e.stopPropagation(); openModal('criterion', criterion); }}>
                      <Edit2 size={12} />Edit
                    </button>
                    <button className="btn-ghost py-1 text-xs" onClick={e => { e.stopPropagation(); openModal('level', null, criterion.id); }}>
                      <Plus size={12} />Level
                    </button>
                    {expandedCriteria.has(criterion.id) ? <ChevronDown size={16} className="text-gray-400" /> : <ChevronRight size={16} className="text-gray-400" />}
                  </div>
                </div>

                {expandedCriteria.has(criterion.id) && (
                  <div className="border-t border-gray-100">
                    <div className="grid grid-cols-4 divide-x divide-gray-100">
                      {criterion.levels.map(level => (
                        <div key={level.id} className="p-4" style={{ borderLeft: `3px solid ${LEVEL_COLORS[level.label] || '#94a3b8'}20` }}>
                          <div className="flex items-center justify-between mb-2">
                            <div className="flex items-center gap-2">
                              <span className="w-2.5 h-2.5 rounded-full" style={{ background: LEVEL_COLORS[level.label] || '#94a3b8' }} />
                              <span className="text-xs font-bold" style={{ color: LEVEL_COLORS[level.label] }}>{level.label}</span>
                            </div>
                            <span className="text-xs text-gray-500">{level.minMarks}–{level.maxMarks}</span>
                          </div>
                          <p className="text-xs text-gray-600 leading-relaxed">{level.descriptor}</p>
                          <button className="text-xs text-primary-500 hover:text-primary-700 mt-2 flex items-center gap-1" onClick={() => openModal('level', level, criterion.id)}>
                            <Edit2 size={10} />Edit
                          </button>
                        </div>
                      ))}
                      {criterion.levels.length === 0 && (
                        <div className="col-span-4 py-8 text-center text-sm text-gray-400">No performance levels defined</div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </>
      )}

      {/* Criterion Modal */}
      <Modal open={modal.open && modal.type === 'criterion'} onClose={closeModal}
        title={modal.data ? 'Edit Criterion' : 'Add Criterion'}
        footer={<><button className="btn-secondary" onClick={closeModal}>Cancel</button><button className="btn-primary" onClick={handleSave} disabled={saving}>{saving ? 'Saving...' : 'Save'}</button></>}>
        {error && <div className="mb-4 p-3 bg-red-50 border border-red-200 text-sm text-red-700 rounded-lg">{error}</div>}
        <FormSection>
          <FormField label="Criterion Title" required><input className="input" value={form.title || ''} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} /></FormField>
          <FormGrid cols={3}>
            <FormField label="Max Marks" required><input className="input" type="number" value={form.maxMarks || ''} onChange={e => setForm(f => ({ ...f, maxMarks: e.target.value }))} /></FormField>
            <FormField label="Bloom's Level"><select className="select" value={form.bloomLevel || ''} onChange={e => setForm(f => ({ ...f, bloomLevel: e.target.value }))}><option value="">Select</option>{BLOOM_LEVELS.map(b => <option key={b} value={b}>{b}</option>)}</select></FormField>
            <FormField label="Order"><input className="input" type="number" value={form.orderIndex || ''} onChange={e => setForm(f => ({ ...f, orderIndex: e.target.value }))} /></FormField>
          </FormGrid>
          <FormField label="Description"><textarea className="input" rows={2} value={form.description || ''} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} /></FormField>
        </FormSection>
      </Modal>

      {/* Level Modal */}
      <Modal open={modal.open && modal.type === 'level'} onClose={closeModal}
        title={modal.data ? 'Edit Performance Level' : 'Add Performance Level'}
        footer={<><button className="btn-secondary" onClick={closeModal}>Cancel</button><button className="btn-primary" onClick={handleSave} disabled={saving}>{saving ? 'Saving...' : 'Save'}</button></>}>
        {error && <div className="mb-4 p-3 bg-red-50 border border-red-200 text-sm text-red-700 rounded-lg">{error}</div>}
        <FormSection>
          <FormGrid cols={3}>
            <FormField label="Level Label" required><select className="select" value={form.label || ''} onChange={e => setForm(f => ({ ...f, label: e.target.value }))}><option value="">Select</option><option>Excellent</option><option>Good</option><option>Satisfactory</option><option>Needs Improvement</option></select></FormField>
            <FormField label="Min Marks" required><input className="input" type="number" step="0.1" value={form.minMarks ?? ''} onChange={e => setForm(f => ({ ...f, minMarks: e.target.value }))} /></FormField>
            <FormField label="Max Marks" required><input className="input" type="number" step="0.1" value={form.maxMarks ?? ''} onChange={e => setForm(f => ({ ...f, maxMarks: e.target.value }))} /></FormField>
          </FormGrid>
          <FormField label="Performance Descriptor"><textarea className="input" rows={4} value={form.descriptor || ''} onChange={e => setForm(f => ({ ...f, descriptor: e.target.value }))} placeholder="Describe what this performance level looks like..." /></FormField>
        </FormSection>
      </Modal>
    </div>
  );
}
