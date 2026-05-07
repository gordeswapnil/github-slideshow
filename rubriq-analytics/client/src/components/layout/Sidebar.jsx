import { NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import {
  LayoutDashboard, Settings2, BookOpen, Calendar, ClipboardList, Grid3X3,
  FileText, GraduationCap, Upload, GitMerge, BarChart3, FileBarChart,
  TrendingUp, Archive, Shield, RefreshCw, ClipboardCheck, Settings, UserCog,
  LogOut, Zap, Sparkles, FileSpreadsheet, Target,
} from 'lucide-react';

const NAV_BY_ROLE = {
  ADMIN: [
    { to: '/dashboard', icon: LayoutDashboard, label: 'Dashboard' },
    { divider: true, label: 'Setup' },
    { to: '/ai-import', icon: Sparkles, label: 'AI Import', badge: 'NEW' },
    { to: '/academic-setup', icon: Settings2, label: 'Academic Setup' },
    { to: '/programs-courses', icon: BookOpen, label: 'Programs & Courses' },
    { to: '/evaluation-plan', icon: Calendar, label: 'Evaluation Plan' },
    { to: '/assessments', icon: ClipboardList, label: 'Assessments' },
    { to: '/rubric-matrix', icon: Grid3X3, label: 'Rubric Matrix' },
    { divider: true, label: 'Students' },
    { to: '/students', icon: GraduationCap, label: 'Students' },
    { to: '/student-submissions', icon: FileText, label: 'Student Submissions' },
    { to: '/teacher-evaluation', icon: ClipboardCheck, label: 'Teacher Evaluation' },
    { divider: true, label: 'Data & Upload' },
    { to: '/bulk-marks-upload', icon: Upload, label: 'Bulk Marks Upload' },
    { to: '/external-exam', icon: FileSpreadsheet, label: 'External Exam Marks' },
    { to: '/mapping-validation', icon: GitMerge, label: 'Mapping & Validation' },
    { divider: true, label: 'Analytics' },
    { to: '/co-attainment', icon: Target, label: 'CO Attainment' },
    { to: '/po-dashboard', icon: BarChart3, label: 'PO Dashboard' },
    { to: '/analysis-dashboard', icon: BarChart3, label: 'Analysis Dashboard' },
    { to: '/reports', icon: FileBarChart, label: 'Reports' },
    { to: '/student-progress', icon: TrendingUp, label: 'Student Progress' },
    { to: '/evidence-repository', icon: Archive, label: 'Evidence Repository' },
    { divider: true, label: 'Compliance' },
    { to: '/accreditation', icon: Shield, label: 'Accreditation' },
    { to: '/continuous-improvement', icon: RefreshCw, label: 'Continuous Improvement' },
    { divider: true, label: 'Admin' },
    { to: '/audit-logs', icon: ClipboardCheck, label: 'Audit Logs' },
    { to: '/settings', icon: Settings, label: 'Settings' },
    { to: '/user-management', icon: UserCog, label: 'User Management' },
  ],
  FACULTY: [
    { to: '/dashboard', icon: LayoutDashboard, label: 'Dashboard' },
    { divider: true, label: 'Setup' },
    { to: '/ai-import', icon: Sparkles, label: 'AI Import', badge: 'NEW' },
    { to: '/assessments', icon: ClipboardList, label: 'Assessments' },
    { to: '/rubric-matrix', icon: Grid3X3, label: 'Rubric Matrix' },
    { divider: true, label: 'Students' },
    { to: '/students', icon: GraduationCap, label: 'Students' },
    { to: '/student-submissions', icon: FileText, label: 'Student Submissions' },
    { to: '/teacher-evaluation', icon: ClipboardCheck, label: 'Teacher Evaluation' },
    { divider: true, label: 'Data & Upload' },
    { to: '/bulk-marks-upload', icon: Upload, label: 'Bulk Marks Upload' },
    { to: '/external-exam', icon: FileSpreadsheet, label: 'External Exam Marks' },
    { divider: true, label: 'Analytics' },
    { to: '/co-attainment', icon: Target, label: 'CO Attainment' },
    { to: '/po-dashboard', icon: BarChart3, label: 'PO Dashboard' },
    { to: '/analysis-dashboard', icon: BarChart3, label: 'Analysis Dashboard' },
    { to: '/reports', icon: FileBarChart, label: 'Reports' },
    { to: '/student-progress', icon: TrendingUp, label: 'Student Progress' },
    { to: '/evidence-repository', icon: Archive, label: 'Evidence Repository' },
  ],
  HOD: [
    { to: '/dashboard', icon: LayoutDashboard, label: 'Dashboard' },
    { divider: true, label: 'Setup' },
    { to: '/ai-import', icon: Sparkles, label: 'AI Import', badge: 'NEW' },
    { to: '/assessments', icon: ClipboardList, label: 'Assessments' },
    { to: '/rubric-matrix', icon: Grid3X3, label: 'Rubric Matrix' },
    { divider: true, label: 'Students' },
    { to: '/students', icon: GraduationCap, label: 'Students' },
    { to: '/student-submissions', icon: FileText, label: 'Student Submissions' },
    { to: '/teacher-evaluation', icon: ClipboardCheck, label: 'Teacher Evaluation' },
    { divider: true, label: 'Analytics' },
    { to: '/co-attainment', icon: Target, label: 'CO Attainment' },
    { to: '/po-dashboard', icon: BarChart3, label: 'PO Dashboard' },
    { to: '/analysis-dashboard', icon: BarChart3, label: 'Analysis Dashboard' },
    { to: '/reports', icon: FileBarChart, label: 'Reports' },
    { to: '/student-progress', icon: TrendingUp, label: 'Student Progress' },
    { to: '/evidence-repository', icon: Archive, label: 'Evidence Repository' },
    { divider: true, label: 'Compliance' },
    { to: '/accreditation', icon: Shield, label: 'Accreditation' },
    { to: '/continuous-improvement', icon: RefreshCw, label: 'Continuous Improvement' },
  ],
  STUDENT: [
    { to: '/dashboard', icon: LayoutDashboard, label: 'Dashboard' },
    { to: '/assessments', icon: ClipboardList, label: 'Assessments' },
    { to: '/student-submissions', icon: FileText, label: 'My Submissions' },
    { to: '/student-progress', icon: TrendingUp, label: 'My Progress' },
    { to: '/evidence-repository', icon: Archive, label: 'Evidence' },
  ],
  REVIEWER: [
    { to: '/dashboard', icon: LayoutDashboard, label: 'Dashboard' },
    { to: '/reports', icon: FileBarChart, label: 'Reports' },
    { to: '/analysis-dashboard', icon: BarChart3, label: 'Analysis Dashboard' },
    { to: '/accreditation', icon: Shield, label: 'Accreditation' },
    { to: '/evidence-repository', icon: Archive, label: 'Evidence Repository' },
  ],
};

export default function Sidebar({ collapsed }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const navItems = NAV_BY_ROLE[user?.role] || NAV_BY_ROLE.ADMIN;

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  return (
    <aside className={`fixed left-0 top-0 h-screen flex flex-col transition-all duration-300 z-30 ${collapsed ? 'w-16' : 'w-56'}`}
      style={{ background: 'linear-gradient(180deg, #0f2035 0%, #1a2f4a 100%)' }}>

      {/* Logo */}
      <div className="flex items-center gap-3 px-4 py-4 border-b border-white/10">
        <div className="w-8 h-8 rounded-lg bg-primary-600 flex items-center justify-center shrink-0">
          <Zap size={16} className="text-white" />
        </div>
        {!collapsed && (
          <div>
            <p className="text-sm font-bold text-white leading-tight">RubriQ Analytics</p>
            <p className="text-xs text-gray-400">Finance & FinTech</p>
          </div>
        )}
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto py-2 px-2 space-y-0.5">
        {navItems.map((item, i) => {
          if (item.divider) {
            return collapsed ? <div key={i} className="my-2 border-t border-white/10" /> : (
              <div key={i} className="px-2 pt-3 pb-1">
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">{item.label}</p>
              </div>
            );
          }
          const Icon = item.icon;
          return (
            <NavLink key={item.to} to={item.to}
              className={({ isActive }) => `sidebar-link ${isActive ? 'active' : ''} ${collapsed ? 'justify-center px-2' : ''}`}
              title={collapsed ? item.label : undefined}>
              <Icon size={16} className="shrink-0" />
              {!collapsed && <span className="truncate flex-1">{item.label}</span>}
              {!collapsed && item.badge && <span className="text-[9px] font-bold px-1 py-0.5 rounded bg-amber-400 text-amber-900 leading-none">{item.badge}</span>}
            </NavLink>
          );
        })}
      </nav>

      {/* User */}
      <div className="border-t border-white/10 p-3">
        {!collapsed ? (
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-full bg-primary-600 flex items-center justify-center text-xs font-bold text-white shrink-0">
              {user?.firstName?.[0]}{user?.lastName?.[0]}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium text-white truncate">{user?.firstName} {user?.lastName}</p>
              <p className="text-xs text-gray-400">{user?.role}</p>
            </div>
            <button onClick={handleLogout} className="p-1 rounded hover:bg-white/10 text-gray-400 hover:text-white transition-colors" title="Logout">
              <LogOut size={14} />
            </button>
          </div>
        ) : (
          <button onClick={handleLogout} className="w-full flex justify-center p-2 rounded-lg hover:bg-white/10 text-gray-400 hover:text-white transition-colors" title="Logout">
            <LogOut size={16} />
          </button>
        )}
      </div>
    </aside>
  );
}
