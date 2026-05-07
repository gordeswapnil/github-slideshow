import axios from 'axios';

const BASE_URL = import.meta.env.VITE_API_URL || '/api';

const api = axios.create({
  baseURL: BASE_URL,
  headers: { 'Content-Type': 'application/json' },
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('rubriq_token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem('rubriq_token');
      localStorage.removeItem('rubriq_user');
      if (window.location.pathname !== '/login') window.location.href = '/login';
    }
    return Promise.reject(error);
  }
);

export default api;

export const authAPI = {
  login: (data) => api.post('/auth/login', data),
  me: () => api.get('/auth/me'),
  logout: () => api.post('/auth/logout'),
};

export const dashboardAPI = {
  getStats: () => api.get('/dashboard'),
};

export const institutionsAPI = {
  list: () => api.get('/institutions'),
  get: (id) => api.get(`/institutions/${id}`),
  create: (data) => api.post('/institutions', data),
  update: (id, data) => api.put(`/institutions/${id}`, data),
  delete: (id) => api.delete(`/institutions/${id}`),
};

export const collegesAPI = {
  list: (params) => api.get('/colleges', { params }),
  create: (data) => api.post('/colleges', data),
  update: (id, data) => api.put(`/colleges/${id}`, data),
};

export const departmentsAPI = {
  list: (params) => api.get('/departments', { params }),
  create: (data) => api.post('/departments', data),
  update: (id, data) => api.put(`/departments/${id}`, data),
};

export const facultyAssignmentsAPI = {
  list: (params) => api.get('/faculty-assignments', { params }),
  myCourses: () => api.get('/faculty-assignments/my-courses'),
  create: (data) => api.post('/faculty-assignments', data),
  remove: (id) => api.delete(`/faculty-assignments/${id}`),
};

export const programsAPI = {
  list: (params) => api.get('/programs', { params }),
  get: (id) => api.get(`/programs/${id}`),
  create: (data) => api.post('/programs', data),
  update: (id, data) => api.put(`/programs/${id}`, data),
};

export const coursesAPI = {
  list: (params) => api.get('/courses', { params }),
  get: (id) => api.get(`/courses/${id}`),
  create: (data) => api.post('/courses', data),
  update: (id, data) => api.put(`/courses/${id}`, data),
  getOutcomes: (id) => api.get(`/courses/${id}/outcomes`),
  addOutcome: (id, data) => api.post(`/courses/${id}/outcomes`, data),
};

export const academicYearsAPI = {
  list: () => api.get('/academic-years'),
  create: (data) => api.post('/academic-years', data),
  update: (id, data) => api.put(`/academic-years/${id}`, data),
  activate: (id) => api.put(`/academic-years/${id}/activate`),
};

export const semestersAPI = {
  list: (params) => api.get('/semesters', { params }),
  create: (data) => api.post('/semesters', data),
  update: (id, data) => api.put(`/semesters/${id}`, data),
  activate: (id) => api.put(`/semesters/${id}/activate`),
};

export const divisionsAPI = {
  list: (params) => api.get('/divisions', { params }),
  create: (data) => api.post('/divisions', data),
  update: (id, data) => api.put(`/divisions/${id}`, data),
};

export const evalCyclesAPI = {
  list: (params) => api.get('/evaluation-cycles', { params }),
  create: (data) => api.post('/evaluation-cycles', data),
  update: (id, data) => api.put(`/evaluation-cycles/${id}`, data),
  activate: (id) => api.put(`/evaluation-cycles/${id}/activate`),
};

export const assessmentsAPI = {
  list: (params) => api.get('/assessments', { params }),
  get: (id) => api.get(`/assessments/${id}`),
  create: (data) => api.post('/assessments', data),
  update: (id, data) => api.put(`/assessments/${id}`, data),
};

export const rubricsAPI = {
  list: (params) => api.get('/rubrics', { params }),
  get: (id) => api.get(`/rubrics/${id}`),
  create: (data) => api.post('/rubrics', data),
  update: (id, data) => api.put(`/rubrics/${id}`, data),
  addCriterion: (rubricId, data) => api.post(`/rubrics/${rubricId}/criteria`, data),
  updateCriterion: (id, data) => api.put(`/rubrics/criteria/${id}`, data),
  deleteCriterion: (id) => api.delete(`/rubrics/criteria/${id}`),
  addLevel: (criterionId, data) => api.post(`/rubrics/criteria/${criterionId}/levels`, data),
  updateLevel: (id, data) => api.put(`/rubrics/levels/${id}`, data),
  deleteLevel: (id) => api.delete(`/rubrics/levels/${id}`),
};

export const studentsAPI = {
  list: (params) => api.get('/students', { params }),
  get: (id) => api.get(`/students/${id}`),
  create: (data) => api.post('/students', data),
  update: (id, data) => api.put(`/students/${id}`, data),
  delete: (id) => api.delete(`/students/${id}`),
  importExcel: (formData) => api.post('/students/import/excel', formData, { headers: { 'Content-Type': 'multipart/form-data' } }),
};

export const submissionsAPI = {
  list: (params) => api.get('/submissions', { params }),
  get: (id) => api.get(`/submissions/${id}`),
  update: (id, data) => api.put(`/submissions/${id}`, data),
  uploadFiles: (id, formData) => api.post(`/submissions/${id}/files`, formData, { headers: { 'Content-Type': 'multipart/form-data' } }),
  getEvaluation: (id) => api.get(`/submissions/${id}/evaluation`),
  saveEvaluation: (id, data) => api.post(`/submissions/${id}/evaluation`, data),
};

export const bulkUploadAPI = {
  list: () => api.get('/bulk-upload'),
  analyze: (formData) => api.post('/bulk-upload/analyze', formData, { headers: { 'Content-Type': 'multipart/form-data' } }),
  confirmMappings: (batchId, data) => api.post(`/bulk-upload/${batchId}/confirm-mappings`, data),
  validate: (batchId) => api.post(`/bulk-upload/${batchId}/validate`),
};

export const reportsAPI = {
  getAnalysis: (assessmentId) => api.get('/reports/analysis', { params: { assessmentId } }),
  getCompliance: (assessmentId) => api.get('/reports/submission-compliance', { params: { assessmentId } }),
  getStudentProgress: (studentId) => api.get(`/reports/student-progress/${studentId}`),
};

export const accreditationAPI = {
  getArchives: () => api.get('/accreditation/archives'),
  generate: (data) => api.post('/accreditation/generate', data),
  getChecklist: () => api.get('/accreditation/checklist'),
  deleteArchive: (id) => api.delete(`/accreditation/archives/${id}`),
};

export const ciAPI = {
  list: () => api.get('/continuous-improvement'),
  create: (data) => api.post('/continuous-improvement', data),
  update: (id, data) => api.put(`/continuous-improvement/${id}`, data),
  delete: (id) => api.delete(`/continuous-improvement/${id}`),
};

export const auditLogsAPI = {
  list: (params) => api.get('/audit-logs', { params }),
  notifications: () => api.get('/audit-logs/notifications'),
};

export const settingsAPI = {
  get: () => api.get('/settings'),
  update: (settings) => api.put('/settings', { settings }),
};

export const usersAPI = {
  list: () => api.get('/users'),
  create: (data) => api.post('/users', data),
  update: (id, data) => api.put(`/users/${id}`, data),
  resetPassword: (id) => api.post(`/users/${id}/reset-password`),
  getRoles: () => api.get('/users/roles'),
};

export const aiImportAPI = {
  extract: (formData) => api.post('/ai-import/extract', formData, { headers: { 'Content-Type': 'multipart/form-data' }, timeout: 120000 }),
  confirm: (extracted) => api.post('/ai-import/confirm', { extracted }),
};


export const externalExamAPI = {
  list: (params) => api.get('/external-exams', { params }),
  get: (id) => api.get(`/external-exams/${id}`),
  create: (data) => api.post('/external-exams', data),
  addQuestion: (id, data) => api.post(`/external-exams/${id}/questions`, data),
  updateQuestion: (id, qid, data) => api.put(`/external-exams/${id}/questions/${qid}`, data),
  deleteQuestion: (id, qid) => api.delete(`/external-exams/${id}/questions/${qid}`),
  uploadMarks: (id, formData) => api.post(`/external-exams/${id}/upload`, formData, { headers: { 'Content-Type': 'multipart/form-data' } }),
  getMarks: (id) => api.get(`/external-exams/${id}/marks`),
  getTemplate: (id) => api.get(`/external-exams/${id}/template`, { responseType: 'blob' }),
};

export const coAttainmentAPI = {
  get: (params) => api.get('/co-attainment', { params }),
};

export const poDashboardAPI = {
  get: (params) => api.get('/po-dashboard', { params }),
};
