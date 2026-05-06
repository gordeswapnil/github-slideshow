import { useState, useEffect, useRef } from 'react';
import { Bell, ChevronDown } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useFilters } from '../../context/FilterContext';
import { auditLogsAPI } from '../../services/api';

const ACADEMIC_YEARS = ['2026-27', '2025-26', '2024-25'];
const SEMESTERS = [{ value: '', label: 'All Semesters' }, { value: '1', label: 'Semester 1' }, { value: '2', label: 'Semester 2' }];
const EVAL_CYCLES = [{ value: '', label: 'All Cycles' }, { value: '1', label: 'Evaluation 1' }, { value: '2', label: 'Evaluation 2' }, { value: '3', label: 'Evaluation 3' }, { value: '4', label: 'Evaluation 4' }];

const ACTION_COLORS = {
  LOGIN: 'bg-green-100 text-green-700',
  CREATE: 'bg-blue-100 text-blue-700',
  CREATE_USER: 'bg-blue-100 text-blue-700',
  UPDATE: 'bg-amber-100 text-amber-700',
  DELETE: 'bg-red-100 text-red-700',
  RESET_PASSWORD: 'bg-purple-100 text-purple-700',
};

function timeAgo(date) {
  const diff = Math.floor((Date.now() - new Date(date)) / 1000);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [unread, setUnread] = useState(0);
  const ref = useRef(null);

  useEffect(() => {
    auditLogsAPI.notifications().then(res => {
      setNotifications(res.data);
      setUnread(res.data.length > 0 ? Math.min(res.data.length, 5) : 0);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const handleOpen = () => { setOpen(o => !o); setUnread(0); };

  return (
    <div className="relative" ref={ref}>
      <button onClick={handleOpen} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-500 relative">
        <Bell size={16} />
        {unread > 0 && (
          <span className="absolute -top-0.5 -right-0.5 w-4 h-4 bg-red-500 rounded-full text-white text-[9px] flex items-center justify-center font-bold">{unread}</span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-9 w-80 bg-white rounded-xl shadow-xl border border-gray-100 z-50 overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
            <p className="text-sm font-semibold text-gray-900">Recent Activity</p>
            <span className="text-xs text-gray-400">{notifications.length} events</span>
          </div>
          <div className="max-h-80 overflow-y-auto">
            {notifications.length === 0 && <p className="text-sm text-gray-400 text-center py-8">No recent activity</p>}
            {notifications.map(n => (
              <div key={n.id} className="px-4 py-3 border-b border-gray-50 hover:bg-gray-50">
                <div className="flex items-start gap-2">
                  <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded mt-0.5 shrink-0 ${ACTION_COLORS[n.action] || 'bg-gray-100 text-gray-600'}`}>{n.action}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-gray-700">{n.entity} {n.entityId ? `#${n.entityId}` : ''}</p>
                    <p className="text-xs text-gray-400">{n.user ? `${n.user.firstName} ${n.user.lastName}` : 'System'} · {timeAgo(n.createdAt)}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default function Topbar({ onMenuToggle }) {
  const { user } = useAuth();
  const { filters, updateFilter } = useFilters();

  return (
    <header className="fixed top-0 right-0 left-56 h-12 bg-white border-b border-gray-100 flex items-center px-4 gap-3 z-20 print:hidden">
      <div className="flex items-center gap-2 flex-1 overflow-x-auto">
        <FilterSelect value={filters.academicYear} onChange={v => updateFilter('academicYear', v)} options={ACADEMIC_YEARS.map(y => ({ value: y, label: y }))} label="AY" />
        <FilterSelect value={filters.semester} onChange={v => updateFilter('semester', v)} options={SEMESTERS} label="SEM" />
        <FilterSelect value={filters.evalCycle} onChange={v => updateFilter('evalCycle', v)} options={EVAL_CYCLES} label="CYCLE" />
        <FilterPill label="MBA Finance" active />
        <FilterPill label="AI in Finance" active />
        <FilterPill label="Div A" />
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <NotificationBell />
        <div className="flex items-center gap-2 pl-2 border-l border-gray-100">
          <div className="w-7 h-7 rounded-full bg-primary-700 flex items-center justify-center text-xs font-bold text-white">
            {user?.firstName?.[0]}{user?.lastName?.[0]}
          </div>
        </div>
      </div>
    </header>
  );
}

function FilterSelect({ value, onChange, options, label }) {
  return (
    <div className="flex items-center gap-1 shrink-0">
      <span className="text-xs font-semibold text-gray-400">{label}</span>
      <select value={value} onChange={e => onChange(e.target.value)} className="text-xs border-0 bg-transparent text-gray-700 font-medium focus:outline-none cursor-pointer py-0.5">
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  );
}

function FilterPill({ label, active }) {
  return (
    <span className={`shrink-0 text-xs px-2.5 py-1 rounded-full font-medium cursor-pointer transition-colors ${active ? 'bg-primary-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
      {label}
    </span>
  );
}
