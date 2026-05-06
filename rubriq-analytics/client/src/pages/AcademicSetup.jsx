import { useState, useEffect } from 'react';
import { institutionsAPI, collegesAPI, departmentsAPI, usersAPI, facultyAssignmentsAPI, academicYearsAPI, semestersAPI, coursesAPI } from '../services/api';
import DataTable from '../components/shared/DataTable';
import Modal from '../components/shared/Modal';
import StatusBadge from '../components/shared/StatusBadge';
import FormSection, { FormGrid, FormField } from '../components/shared/FormSection';
import { Plus, Edit2 } from 'lucide-react';
import { PageLoader } from '../components/shared/LoadingSpinner';

const TABS = [
  ['institutions', 'Institutions'],
  ['colleges', 'Colleges'],
  ['departments', 'Departments'],
  ['faculty', 'Faculty Assignments'],
];

export default function AcademicSetup() {
  const [tab, setTab] = useState('institutions');
  const [institutions, setInstitutions] = useState([]);
  const [colleges, setColleges] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [facultyList, setFacultyList] = useState([]);
  const [assignments, setAssignments] = useState([]);
  const [courses, setCourses] = useState([]);
  const [semesters, setSemesters] = useState([]);
  const [academicYears, setAcademicYears] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState({ open: false, type: '', data: null });
  const [form, setForm] = useState({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const loadAll = async () => {
    const [iRes, cRes, dRes, uRes, aRes, ayRes, sRes, coRes] = await Promise.all([
      institutionsAPI.list(),
      collegesAPI.list(),
      departmentsAPI.list(),
      usersAPI.list(),
      facultyAssignmentsAPI.list(),
      academicYearsAPI.list(),
      semestersAPI.list(),
      coursesAPI.list(),
    ]);
    setInstitutions(iRes.data);
    setColleges(cRes.data);
    setDepartments(dRes.data);
    setFacultyList(uRes.data.filter(u => ['FACULTY', 'HOD'].includes(u.role)));
    setAssignments(aRes.data);
    setAcademicYears(ayRes.data);
    setSemesters(sRes.data);
    setCourses(coRes.data);
  };

  useEffect(() => { loadAll().finally(() => setLoading(false)); }, []);

  const openModal = (type, data = null) => {
    setForm(data ? { ...data } : {});
    setError('');
    setModal({ open: true, type, data });
  };

  const handleSave = async () => {
    setSaving(true); setError('');
    try {
      if (modal.type === 'institution') {
        modal.data ? await institutionsAPI.update(modal.data.id, form) : await institutionsAPI.create(form);
      } else if (modal.type === 'college') {
        modal.data ? await collegesAPI.update(modal.data.id, form) : await collegesAPI.create(form);
      } else if (modal.type === 'department') {
        modal.data ? await departmentsAPI.update(modal.data.id, form) : await departmentsAPI.create(form);
      } else if (modal.type === 'faculty') {
        await facultyAssignmentsAPI.create(form);
      }
      await loadAll();
      setModal({ open: false, type: '', data: null });
    } catch (err) {
      setError(err.response?.data?.error || 'Save failed');
    } finally { setSaving(false); }
  };

  const handleRemoveAssignment = async (id) => {
    if (!confirm('Remove this faculty assignment?')) return;
    await facultyAssignmentsAPI.remove(id);
    await loadAll();
  };

  if (loading) return <PageLoader />;

  const addLabel = { institutions: 'Institution', colleges: 'College', departments: 'Department', faculty: 'Assignment' };

  const instColumns = [
    { key: 'name', header: 'University / Institution', accessor: 'name' },
    { key: 'code', header: 'Code', accessor: 'code' },
    { key: 'accredBody', header: 'Accreditation', accessor: 'accredBody' },
    { key: 'status', header: 'Status', render: r => <StatusBadge status={r.isActive ? 'ACTIVE' : 'INACTIVE'} /> },
    { key: 'actions', header: '', render: r => <button className="btn-ghost text-xs py-1" onClick={() => openModal('institution', r)}><Edit2 size={13} />Edit</button> },
  ];

  const collegeColumns = [
    { key: 'name', header: 'College Name', accessor: 'name' },
    { key: 'code', header: 'Code', accessor: 'code' },
    { key: 'institution', header: 'University', render: r => r.institution?.name },
    { key: 'principal', header: 'Principal', accessor: 'principalName' },
    { key: 'depts', header: 'Departments', render: r => r._count?.departments || 0 },
    { key: 'status', header: 'Status', render: r => <StatusBadge status={r.isActive ? 'ACTIVE' : 'INACTIVE'} /> },
    { key: 'actions', header: '', render: r => <button className="btn-ghost text-xs py-1" onClick={() => openModal('college', r)}><Edit2 size={13} />Edit</button> },
  ];

  const deptColumns = [
    { key: 'name', header: 'Department', accessor: 'name' },
    { key: 'code', header: 'Code', accessor: 'code' },
    { key: 'college', header: 'College', render: r => r.college?.name || '—' },
    { key: 'institution', header: 'University', render: r => r.institution?.name },
    { key: 'hod', header: 'HoD', accessor: 'hodName' },
    { key: 'programs', header: 'Programs', render: r => r._count?.programs || 0 },
    { key: 'status', header: 'Status', render: r => <StatusBadge status={r.isActive ? 'ACTIVE' : 'INACTIVE'} /> },
    { key: 'actions', header: '', render: r => <button className="btn-ghost text-xs py-1" onClick={() => openModal('department', r)}><Edit2 size={13} />Edit</button> },
  ];

  const facultyColumns = [
    { key: 'faculty', header: 'Faculty', render: r => `${r.faculty?.firstName} ${r.faculty?.lastName}` },
    { key: 'course', header: 'Course', render: r => `${r.course?.name} (${r.course?.code})` },
    { key: 'program', header: 'Program', render: r => r.course?.program?.name },
    { key: 'semester', header: 'Semester', render: r => r.semester?.label },
    { key: 'ay', header: 'Academic Year', render: r => r.academicYear?.label },
    { key: 'status', header: 'Status', render: r => <StatusBadge status={r.isActive ? 'ACTIVE' : 'INACTIVE'} /> },
    { key: 'actions', header: '', render: r => <button className="btn-ghost text-xs py-1 text-red-500" onClick={() => handleRemoveAssignment(r.id)}>Remove</button> },
  ];

  const filteredColleges = colleges.filter(c => !form.institutionId || c.institutionId === parseInt(form.institutionId));

  return (
    <div className="space-y-6">
      <div className="page-header">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Academic Setup</h1>
          <p className="text-sm text-gray-500 mt-0.5">Manage university hierarchy, departments and faculty assignments</p>
        </div>
        <button className="btn-primary" onClick={() => openModal(tab === 'faculty' ? 'faculty' : tab.slice(0, -1))}>
          <Plus size={15} />Add {addLabel[tab]}
        </button>
      </div>

      <div className="flex gap-1 bg-gray-100 p-1 rounded-lg w-fit flex-wrap">
        {TABS.map(([key, label]) => (
          <button key={key} onClick={() => setTab(key)} className={`px-4 py-1.5 text-sm font-medium rounded-md transition-all ${tab === key ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500 hover:text-gray-700'}`}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'institutions' && <DataTable columns={instColumns} data={institutions} searchPlaceholder="Search institutions..." emptyMessage="No institutions found." />}
      {tab === 'colleges' && <DataTable columns={collegeColumns} data={colleges} searchPlaceholder="Search colleges..." emptyMessage="No colleges found." />}
      {tab === 'departments' && <DataTable columns={deptColumns} data={departments} searchPlaceholder="Search departments..." emptyMessage="No departments found." />}
      {tab === 'faculty' && <DataTable columns={facultyColumns} data={assignments} searchPlaceholder="Search assignments..." emptyMessage="No faculty assignments yet." />}

      <Modal
        open={modal.open}
        onClose={() => setModal({ open: false, type: '', data: null })}
        title={`${modal.data ? 'Edit' : 'Add'} ${addLabel[modal.type] || ''}`}
        size="md"
        footer={<><button className="btn-secondary" onClick={() => setModal({ open: false, type: '', data: null })}>Cancel</button><button className="btn-primary" onClick={handleSave} disabled={saving}>{saving ? 'Saving...' : 'Save'}</button></>}
      >
        {error && <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg">{error}</div>}

        {modal.type === 'institution' && (
          <FormSection>
            <FormGrid cols={2}>
              <FormField label="University / Institution Name" required>
                <input className="input" value={form.name || ''} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. RubriQ University" />
              </FormField>
              <FormField label="Short Code" required>
                <input className="input" value={form.code || ''} onChange={e => setForm(f => ({ ...f, code: e.target.value }))} placeholder="e.g. RU" />
              </FormField>
            </FormGrid>
            <FormField label="Address">
              <textarea className="input" rows={2} value={form.address || ''} onChange={e => setForm(f => ({ ...f, address: e.target.value }))} />
            </FormField>
            <FormGrid cols={2}>
              <FormField label="Website">
                <input className="input" value={form.website || ''} onChange={e => setForm(f => ({ ...f, website: e.target.value }))} placeholder="https://..." />
              </FormField>
              <FormField label="Accreditation Bodies">
                <input className="input" value={form.accredBody || ''} onChange={e => setForm(f => ({ ...f, accredBody: e.target.value }))} placeholder="NAAC, NBA, IQAC" />
              </FormField>
            </FormGrid>
          </FormSection>
        )}

        {modal.type === 'college' && (
          <FormSection>
            <FormField label="University" required>
              <select className="select" value={form.institutionId || ''} onChange={e => setForm(f => ({ ...f, institutionId: e.target.value }))}>
                <option value="">Select university</option>
                {institutions.map(i => <option key={i.id} value={i.id}>{i.name}</option>)}
              </select>
            </FormField>
            <FormGrid cols={2}>
              <FormField label="College Name" required>
                <input className="input" value={form.name || ''} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. College of Management" />
              </FormField>
              <FormField label="Code" required>
                <input className="input" value={form.code || ''} onChange={e => setForm(f => ({ ...f, code: e.target.value }))} placeholder="e.g. COM" />
              </FormField>
            </FormGrid>
            <FormField label="Principal Name">
              <input className="input" value={form.principalName || ''} onChange={e => setForm(f => ({ ...f, principalName: e.target.value }))} placeholder="Dr. Name" />
            </FormField>
          </FormSection>
        )}

        {modal.type === 'department' && (
          <FormSection>
            <FormGrid cols={2}>
              <FormField label="University" required>
                <select className="select" value={form.institutionId || ''} onChange={e => setForm(f => ({ ...f, institutionId: e.target.value, collegeId: '' }))}>
                  <option value="">Select university</option>
                  {institutions.map(i => <option key={i.id} value={i.id}>{i.name}</option>)}
                </select>
              </FormField>
              <FormField label="College">
                <select className="select" value={form.collegeId || ''} onChange={e => setForm(f => ({ ...f, collegeId: e.target.value }))}>
                  <option value="">Select college (optional)</option>
                  {filteredColleges.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </FormField>
            </FormGrid>
            <FormGrid cols={2}>
              <FormField label="Department Name" required>
                <input className="input" value={form.name || ''} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. Finance & FinTech" />
              </FormField>
              <FormField label="Code" required>
                <input className="input" value={form.code || ''} onChange={e => setForm(f => ({ ...f, code: e.target.value }))} placeholder="e.g. FIN" />
              </FormField>
            </FormGrid>
            <FormField label="Head of Department">
              <input className="input" value={form.hodName || ''} onChange={e => setForm(f => ({ ...f, hodName: e.target.value }))} placeholder="Dr. Name" />
            </FormField>
          </FormSection>
        )}

        {modal.type === 'faculty' && (
          <FormSection>
            <FormField label="Faculty Member" required>
              <select className="select" value={form.facultyId || ''} onChange={e => setForm(f => ({ ...f, facultyId: e.target.value }))}>
                <option value="">Select faculty</option>
                {facultyList.map(u => <option key={u.id} value={u.id}>{u.firstName} {u.lastName} ({u.role})</option>)}
              </select>
            </FormField>
            <FormField label="Course" required>
              <select className="select" value={form.courseId || ''} onChange={e => setForm(f => ({ ...f, courseId: e.target.value }))}>
                <option value="">Select course</option>
                {courses.map(c => <option key={c.id} value={c.id}>{c.name} ({c.code})</option>)}
              </select>
            </FormField>
            <FormGrid cols={2}>
              <FormField label="Academic Year" required>
                <select className="select" value={form.academicYearId || ''} onChange={e => setForm(f => ({ ...f, academicYearId: e.target.value }))}>
                  <option value="">Select year</option>
                  {academicYears.map(y => <option key={y.id} value={y.id}>{y.label}</option>)}
                </select>
              </FormField>
              <FormField label="Semester" required>
                <select className="select" value={form.semesterId || ''} onChange={e => setForm(f => ({ ...f, semesterId: e.target.value }))}>
                  <option value="">Select semester</option>
                  {semesters.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
                </select>
              </FormField>
            </FormGrid>
          </FormSection>
        )}
      </Modal>
    </div>
  );
}
