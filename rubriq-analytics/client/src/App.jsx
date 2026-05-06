import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { FilterProvider } from './context/FilterContext';
import Layout from './components/layout/Layout';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import AcademicSetup from './pages/AcademicSetup';
import ProgramsCourses from './pages/ProgramsCourses';
import EvaluationPlan from './pages/EvaluationPlan';
import Assessments from './pages/Assessments';
import RubricMatrix from './pages/RubricMatrix';
import Students from './pages/Students';
import StudentSubmissions from './pages/StudentSubmissions';
import TeacherEvaluation from './pages/TeacherEvaluation';
import BulkMarksUpload from './pages/BulkMarksUpload';
import MappingValidation from './pages/MappingValidation';
import AnalysisDashboard from './pages/AnalysisDashboard';
import Reports from './pages/Reports';
import StudentProgress from './pages/StudentProgress';
import EvidenceRepository from './pages/EvidenceRepository';
import Accreditation from './pages/Accreditation';
import ContinuousImprovement from './pages/ContinuousImprovement';
import AuditLogs from './pages/AuditLogs';
import Settings from './pages/Settings';
import UserManagement from './pages/UserManagement';
import { PageLoader } from './components/shared/LoadingSpinner';

const ADMIN_ONLY = ['/academic-setup', '/programs-courses', '/evaluation-plan', '/audit-logs', '/settings', '/user-management'];
const STUDENT_BLOCKED = ['/academic-setup', '/programs-courses', '/evaluation-plan', '/teacher-evaluation', '/bulk-marks-upload', '/mapping-validation', '/audit-logs', '/settings', '/user-management', '/accreditation', '/continuous-improvement', '/students'];
const REVIEWER_ALLOWED = ['/dashboard', '/reports', '/analysis-dashboard', '/accreditation', '/evidence-repository'];

function ProtectedRoute({ children, path }) {
  const { user, loading } = useAuth();
  if (loading) return <PageLoader />;
  if (!user) return <Navigate to="/login" replace />;
  const role = user.role;
  if (role === 'STUDENT' && STUDENT_BLOCKED.includes(path)) return <Navigate to="/dashboard" replace />;
  if (role === 'REVIEWER' && path && !REVIEWER_ALLOWED.includes(path)) return <Navigate to="/dashboard" replace />;
  if (!['ADMIN'].includes(role) && ADMIN_ONLY.includes(path)) return <Navigate to="/dashboard" replace />;
  return <Layout>{children}</Layout>;
}

function AppRoutes() {
  const { user, loading } = useAuth();
  if (loading) return <PageLoader />;

  return (
    <Routes>
      <Route path="/login" element={user ? <Navigate to="/dashboard" replace /> : <Login />} />
      <Route path="/" element={<Navigate to="/dashboard" replace />} />
      <Route path="/dashboard" element={<ProtectedRoute path="/dashboard"><Dashboard /></ProtectedRoute>} />
      <Route path="/academic-setup" element={<ProtectedRoute path="/academic-setup"><AcademicSetup /></ProtectedRoute>} />
      <Route path="/programs-courses" element={<ProtectedRoute path="/programs-courses"><ProgramsCourses /></ProtectedRoute>} />
      <Route path="/evaluation-plan" element={<ProtectedRoute path="/evaluation-plan"><EvaluationPlan /></ProtectedRoute>} />
      <Route path="/assessments" element={<ProtectedRoute path="/assessments"><Assessments /></ProtectedRoute>} />
      <Route path="/rubric-matrix" element={<ProtectedRoute path="/rubric-matrix"><RubricMatrix /></ProtectedRoute>} />
      <Route path="/students" element={<ProtectedRoute path="/students"><Students /></ProtectedRoute>} />
      <Route path="/student-submissions" element={<ProtectedRoute path="/student-submissions"><StudentSubmissions /></ProtectedRoute>} />
      <Route path="/teacher-evaluation" element={<ProtectedRoute path="/teacher-evaluation"><TeacherEvaluation /></ProtectedRoute>} />
      <Route path="/bulk-marks-upload" element={<ProtectedRoute path="/bulk-marks-upload"><BulkMarksUpload /></ProtectedRoute>} />
      <Route path="/mapping-validation" element={<ProtectedRoute path="/mapping-validation"><MappingValidation /></ProtectedRoute>} />
      <Route path="/analysis-dashboard" element={<ProtectedRoute path="/analysis-dashboard"><AnalysisDashboard /></ProtectedRoute>} />
      <Route path="/reports" element={<ProtectedRoute path="/reports"><Reports /></ProtectedRoute>} />
      <Route path="/student-progress" element={<ProtectedRoute path="/student-progress"><StudentProgress /></ProtectedRoute>} />
      <Route path="/evidence-repository" element={<ProtectedRoute path="/evidence-repository"><EvidenceRepository /></ProtectedRoute>} />
      <Route path="/accreditation" element={<ProtectedRoute path="/accreditation"><Accreditation /></ProtectedRoute>} />
      <Route path="/continuous-improvement" element={<ProtectedRoute path="/continuous-improvement"><ContinuousImprovement /></ProtectedRoute>} />
      <Route path="/audit-logs" element={<ProtectedRoute path="/audit-logs"><AuditLogs /></ProtectedRoute>} />
      <Route path="/settings" element={<ProtectedRoute path="/settings"><Settings /></ProtectedRoute>} />
      <Route path="/user-management" element={<ProtectedRoute path="/user-management"><UserManagement /></ProtectedRoute>} />
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <FilterProvider>
          <AppRoutes />
        </FilterProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}
