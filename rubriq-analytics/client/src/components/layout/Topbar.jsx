import { useState, useEffect, useRef } from 'react';
import { Bell } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useFilters } from '../../context/FilterContext';
import { auditLogsAPI } from '../../services/api';

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

function FilterSelect({ value, onChange, options, placeholder, label }) {
  return (
    <div className="flex items-center gap-1 shrink-0">
      <span className="text-[10px] font-bold text-gray-400 tracking-wide">{label}</span>
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        className="text-xs border-0 bg-transparent text-gray-700 font-medium focus:outline-none cursor-pointer py-0.5 max-w-[120px]"
      >
        <option value="">{placeholder}</option>
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  );
}

export default function Topbar() {
  const { user } = useAuth();
  const { filters, updateFilter, academicYears, semesters, evalCycles, programs, courses, divisions } = useFilters();

  const ayOptions = academicYears.map(y => ({ value: y.id.toString(), label: y.label }));
  const semOptions = semesters.map(s => ({ value: s.id.toString(), label: s.label }));
  const cycleOptions = evalCycles.map(c => ({ value: c.id.toString(), label: c.label }));
  const programOptions = programs.map(p => ({ value: p.id.toString(), label: p.code || p.name }));
  const courseOptions = courses.map(c => ({ value: c.id.toString(), label: c.code || c.name }));
  const divOptions = divisions.map(d => ({ value: d.id.toString(), label: d.name }));
  const sep = <span className="text-gray-200 select-none">|</span>;

  return (
    <header className="fixed top-0 right-0 left-56 h-12 bg-white border-b border-gray-100 flex items-center px-4 gap-2 z-20 print:hidden">
      <div className="flex items-center gap-2 flex-1 overflow-x-auto min-w-0">
        <FilterSelect label="AY" value={filters.academicYearId} onChange={v => updateFilter('academicYearId', v)} options={ayOptions} placeholder="Year" />
        {sep}
        <FilterSelect label="SEM" value={filters.semesterId} onChange={v => updateFilter('semesterId', v)} options={semOptions} placeholder="Semester" />
        {sep}
        <FilterSelect label="CYCLE" value={filters.evalCycleId} onChange={v => updateFilter('evalCycleId', v)} options={cycleOptions} placeholder="Cycle" />
        {programOptions.length > 0 && <>{sep}<FilterSelect label="PROG" value={filters.programId} onChange={v => updateFilter('programId', v)} options={programOptions} placeholder="Program" /></>}
        {courseOptions.length > 0 && <>{sep}<FilterSelect label="COURSE" value={filters.courseId} onChange={v => updateFilter('courseId', v)} options={courseOptions} placeholder="Course" /></>}
        {divOptions.length > 0 && <>{sep}<FilterSelect label="DIV" value={filters.divisionId} onChange={v => updateFilter('divisionId', v)} options={divOptions} placeholder="Division" /></>}
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
