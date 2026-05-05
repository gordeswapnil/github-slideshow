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

function ProtectedRoute({ children }) {
  const { user, loading } = useAuth();
  if (loading) return <PageLoader />;
  if (!user) return <Navigate to="/login" replace />;
  return <Layout>{children}</Layout>;
}

function AppRoutes() {
  const { user, loading } = useAuth();
  if (loading) return <PageLoader />;

  return (
    <Routes>
      <Route path="/login" element={user ? <Navigate to="/dashboard" replace /> : <Login />} />
      <Route path="/" element={<Navigate to="/dashboard" replace />} />
      <Route path="/dashboard" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
      <Route path="/academic-setup" element={<ProtectedRoute><AcademicSetup /></ProtectedRoute>} />
      <Route path="/programs-courses" element={<ProtectedRoute><ProgramsCourses /></ProtectedRoute>} />
      <Route path="/evaluation-plan" element={<ProtectedRoute><EvaluationPlan /></ProtectedRoute>} />
      <Route path="/assessments" element={<ProtectedRoute><Assessments /></ProtectedRoute>} />
      <Route path="/rubric-matrix" element={<ProtectedRoute><RubricMatrix /></ProtectedRoute>} />
      <Route path="/students" element={<ProtectedRoute><Students /></ProtectedRoute>} />
      <Route path="/student-submissions" element={<ProtectedRoute><StudentSubmissions /></ProtectedRoute>} />
      <Route path="/teacher-evaluation" element={<ProtectedRoute><TeacherEvaluation /></ProtectedRoute>} />
      <Route path="/bulk-marks-upload" element={<ProtectedRoute><BulkMarksUpload /></ProtectedRoute>} />
      <Route path="/mapping-validation" element={<ProtectedRoute><MappingValidation /></ProtectedRoute>} />
      <Route path="/analysis-dashboard" element={<ProtectedRoute><AnalysisDashboard /></ProtectedRoute>} />
      <Route path="/reports" element={<ProtectedRoute><Reports /></ProtectedRoute>} />
      <Route path="/student-progress" element={<ProtectedRoute><StudentProgress /></ProtectedRoute>} />
      <Route path="/evidence-repository" element={<ProtectedRoute><EvidenceRepository /></ProtectedRoute>} />
      <Route path="/accreditation" element={<ProtectedRoute><Accreditation /></ProtectedRoute>} />
      <Route path="/continuous-improvement" element={<ProtectedRoute><ContinuousImprovement /></ProtectedRoute>} />
      <Route path="/audit-logs" element={<ProtectedRoute><AuditLogs /></ProtectedRoute>} />
      <Route path="/settings" element={<ProtectedRoute><Settings /></ProtectedRoute>} />
      <Route path="/user-management" element={<ProtectedRoute><UserManagement /></ProtectedRoute>} />
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
