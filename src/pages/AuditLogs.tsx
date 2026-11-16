import React, { useState, useEffect } from 'react';
import { useApp } from '../context/AppContext.js';
import {
  ShieldAlert,
  Search,
  Filter,
  RefreshCw,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Clock,
  ShieldCheck,
} from 'lucide-react';

export const AuditLogs: React.FC = () => {
  const { apiFetch, authToken } = useApp();

  const [logs, setLogs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [moduleFilter, setModuleFilter] = useState('ALL');
  const [page, setPage] = useState(1);
  const [, setTotalPages] = useState(1);
  const [, setTotal] = useState(0);

  const fetchLogs = () => {
    if (!authToken) return;
    setLoading(true);
    const params = new URLSearchParams({
      page: String(page),
      pageSize: '30',
    });
    if (search.trim()) params.append('search', search.trim());
    if (moduleFilter !== 'ALL') params.append('module', moduleFilter);

    apiFetch(`/api/v1/audit-logs?${params.toString()}`)
      .then(res => (res.ok ? res.json() : { logs: [], pagination: {} }))
      .then(json => {
        setLogs(json.logs || []);
        setTotal(json.pagination?.total || 0);
        setTotalPages(json.pagination?.totalPages || 1);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    if (authToken) {
      fetchLogs();
    }
  }, [page, moduleFilter, authToken]);

  return (
    <div className="space-y-6">
      {/* Title */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-slate-100 flex items-center gap-2">
            <ShieldAlert className="w-5 h-5 text-indigo-400" />
            <span>Immutable Security & Operations Audit Trail</span>
          </h1>
          <p className="text-xs text-slate-400 mt-0.5">
            Tamper-evident record of all logins, dataset imports, exports, mutations, and permissions.
          </p>
        </div>

        <button
          onClick={fetchLogs}
          className="p-2 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 border border-slate-800 transition-colors self-start sm:self-auto"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin text-indigo-400' : ''}`} />
        </button>
      </div>

      {/* Filter & Search Bar */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-3 bg-slate-900/80 p-3 rounded-2xl border border-slate-800">
        <div className="relative flex-1 w-full">
          <Search className="absolute left-3 top-2.5 w-4 h-4 text-slate-500 rtl:right-3 rtl:left-auto" />
          <input
            type="text"
            value={search}
            onChange={e => {
              setSearch(e.target.value);
              setPage(1);
            }}
            onKeyDown={e => e.key === 'Enter' && fetchLogs()}
            placeholder="Search audit trail by user, action, details..."
            className="w-full h-9 pl-9 pr-3 rtl:pr-9 rtl:pl-3 text-xs bg-slate-950/70 border border-slate-800 rounded-lg text-slate-200 placeholder-slate-500 focus:outline-none focus:border-indigo-500"
          />
        </div>

        <div className="flex items-center gap-2 w-full sm:w-auto">
          <select
            value={moduleFilter}
            onChange={e => {
              setModuleFilter(e.target.value);
              setPage(1);
            }}
            className="h-9 px-3 text-xs bg-slate-950 border border-slate-800 rounded-lg text-slate-200 focus:outline-none focus:border-indigo-500"
          >
            <option value="ALL">All Modules</option>
            <option value="Authentication">Authentication</option>
            <option value="registrations">registrations</option>
            <option value="targets">targets</option>
            <option value="network_cells">network_cells</option>
            <option value="missions">missions</option>
            <option value="System">System</option>
          </select>
        </div>
      </div>

      {/* Audit Table */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left rtl:text-right text-xs">
            <thead className="bg-slate-950/70 text-slate-400 border-b border-slate-800 text-[11px] uppercase tracking-wider">
              <tr>
                <th className="px-5 py-3">Timestamp</th>
                <th className="px-5 py-3">Operator</th>
                <th className="px-5 py-3">Action</th>
                <th className="px-5 py-3">Module</th>
                <th className="px-5 py-3">Result</th>
                <th className="px-5 py-3">Details</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 text-slate-300">
              {loading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i} className="animate-pulse">
                    <td colSpan={6} className="px-5 py-3.5">
                      <div className="h-4 bg-slate-800 rounded w-full" />
                    </td>
                  </tr>
                ))
              ) : logs.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-5 py-8 text-center text-slate-500">
                    No audit records found matching criteria.
                  </td>
                </tr>
              ) : (
                logs.map(log => (
                  <tr key={log.id} className="hover:bg-slate-800/40 font-mono text-[11px]">
                    <td className="px-5 py-3 text-slate-400 whitespace-nowrap">
                      {new Date(log.timestamp).toLocaleString()}
                    </td>
                    <td className="px-5 py-3 font-semibold text-slate-200">
                      {log.username}
                    </td>
                    <td className="px-5 py-3">
                      <span className="px-2 py-0.5 rounded bg-slate-800 text-indigo-300 border border-slate-700">
                        {log.action}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-slate-300">{log.module}</td>
                    <td className="px-5 py-3">
                      <span
                        className={`inline-flex items-center gap-1 font-bold ${
                          log.result === 'SUCCESS'
                            ? 'text-emerald-400'
                            : log.result === 'DENIED'
                            ? 'text-rose-400'
                            : 'text-amber-400'
                        }`}
                      >
                        {log.result === 'SUCCESS' ? '✓' : '✗'} {log.result}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-slate-400 max-w-sm truncate" title={log.details}>
                      {log.details || '-'}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
