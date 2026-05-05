import { Bell, Search, ChevronDown, Menu } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useFilters } from '../../context/FilterContext';

const ACADEMIC_YEARS = ['2026-27', '2025-26', '2024-25'];
const SEMESTERS = [{ value: '', label: 'All Semesters' }, { value: '1', label: 'Semester 1' }, { value: '2', label: 'Semester 2' }];
const EVAL_CYCLES = [{ value: '', label: 'All Cycles' }, { value: '1', label: 'Evaluation 1' }, { value: '2', label: 'Evaluation 2' }, { value: '3', label: 'Evaluation 3' }, { value: '4', label: 'Evaluation 4' }];

export default function Topbar({ onMenuToggle }) {
  const { user } = useAuth();
  const { filters, updateFilter } = useFilters();

  return (
    <header className="fixed top-0 right-0 left-56 h-12 bg-white border-b border-gray-100 flex items-center px-4 gap-3 z-20">
      <button onClick={onMenuToggle} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-500 lg:hidden">
        <Menu size={18} />
      </button>

      {/* Global Filters */}
      <div className="flex items-center gap-2 flex-1 overflow-x-auto">
        <FilterSelect
          value={filters.academicYear}
          onChange={v => updateFilter('academicYear', v)}
          options={ACADEMIC_YEARS.map(y => ({ value: y, label: y }))}
          label="AY"
        />
        <FilterSelect
          value={filters.semester}
          onChange={v => updateFilter('semester', v)}
          options={SEMESTERS}
          label="SEM"
        />
        <FilterSelect
          value={filters.evalCycle}
          onChange={v => updateFilter('evalCycle', v)}
          options={EVAL_CYCLES}
          label="CYCLE"
        />
        <FilterPill label="MBA Finance" active />
        <FilterPill label="AI in Finance" active />
        <FilterPill label="Div A" />
      </div>

      {/* Right Actions */}
      <div className="flex items-center gap-2 shrink-0">
        <button className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-500 relative">
          <Bell size={16} />
          <span className="absolute top-1 right-1 w-1.5 h-1.5 bg-red-500 rounded-full" />
        </button>
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
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        className="text-xs border-0 bg-transparent text-gray-700 font-medium focus:outline-none cursor-pointer py-0.5"
      >
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
