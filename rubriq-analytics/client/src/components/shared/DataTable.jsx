import { useState } from 'react';
import { Search, ChevronLeft, ChevronRight } from 'lucide-react';

export default function DataTable({ columns, data, searchPlaceholder, onSearch, pageSize = 15, loading = false, emptyMessage = 'No records found', actions }) {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');

  const filtered = search && !onSearch
    ? data.filter(row => columns.some(col => String(col.accessor ? (typeof col.accessor === 'function' ? col.accessor(row) : row[col.accessor]) : '').toLowerCase().includes(search.toLowerCase())))
    : data;

  const totalPages = Math.ceil(filtered.length / pageSize);
  const paginated = filtered.slice((page - 1) * pageSize, page * pageSize);

  const handleSearch = (val) => {
    setSearch(val);
    setPage(1);
    onSearch?.(val);
  };

  if (loading) {
    return (
      <div className="card overflow-hidden">
        <div className="p-4 border-b border-gray-100 flex items-center justify-between">
          <div className="h-8 w-48 bg-gray-100 animate-pulse rounded" />
        </div>
        <div className="divide-y divide-gray-50">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="px-4 py-3 flex gap-4">
              {columns.map((_, j) => <div key={j} className="h-4 bg-gray-100 animate-pulse rounded flex-1" />)}
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="card overflow-hidden">
      <div className="p-3 border-b border-gray-100 flex items-center justify-between gap-3">
        <div className="relative flex-1 max-w-xs">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            className="input pl-8 py-1.5 text-xs"
            placeholder={searchPlaceholder || 'Search...'}
            value={search}
            onChange={e => handleSearch(e.target.value)}
          />
        </div>
        <div className="flex items-center gap-2">
          {actions}
          <span className="text-xs text-gray-400">{filtered.length} records</span>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="min-w-full">
          <thead>
            <tr>
              {columns.map(col => (
                <th key={col.key} className="table-th first:pl-4 last:pr-4">{col.header}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {paginated.length === 0 ? (
              <tr>
                <td colSpan={columns.length} className="text-center py-12 text-gray-400 text-sm">
                  {emptyMessage}
                </td>
              </tr>
            ) : (
              paginated.map((row, i) => (
                <tr key={row.id || i} className="hover:bg-gray-50/50 transition-colors">
                  {columns.map(col => (
                    <td key={col.key} className="table-td first:pl-4 last:pr-4">
                      {col.render ? col.render(row) : col.accessor ? (typeof col.accessor === 'function' ? col.accessor(row) : row[col.accessor]) : null}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="px-4 py-3 border-t border-gray-100 flex items-center justify-between">
          <span className="text-xs text-gray-500">Page {page} of {totalPages}</span>
          <div className="flex items-center gap-1">
            <button className="btn-ghost p-1" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}>
              <ChevronLeft size={14} />
            </button>
            {[...Array(Math.min(5, totalPages))].map((_, i) => {
              const p = i + 1;
              return (
                <button key={p} onClick={() => setPage(p)} className={`w-7 h-7 text-xs rounded ${page === p ? 'bg-primary-600 text-white' : 'hover:bg-gray-100 text-gray-600'}`}>
                  {p}
                </button>
              );
            })}
            <button className="btn-ghost p-1" onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}>
              <ChevronRight size={14} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
