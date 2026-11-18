import React, { useState } from 'react';
import { useApp } from '../context/AppContext.js';
import { useAsyncResource } from '../hooks/useAsyncResource.js';
import {
  TopProgressBar,
  RefreshingBadge,
  TableSkeletonRows,
  EmptyStateCard,
  ErrorRetryCard,
} from '../components/common/LoadingStates.js';
import {
  ShieldAlert,
  Search,
  RefreshCw,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';

interface AuditLogsPayload {
  logs: any[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
}

export const AuditLogs: React.FC = () => {
  const { t, apiFetch, authToken } = useApp();

  const [search, setSearch] = useState('');
  const [moduleFilter, setModuleFilter] = useState('ALL');
  const [page, setPage] = useState(1);

  const logsRes = useAsyncResource<AuditLogsPayload>(
    async signal => {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: '30',
      });
      if (search.trim()) params.append('search', search.trim());
      if (moduleFilter !== 'ALL') params.append('module', moduleFilter);

      const res = await apiFetch(`/api/v1/audit-logs?${params.toString()}`, { signal });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(json?.error || 'Failed to load audit logs');
      }
      return {
        logs: Array.isArray(json?.logs) ? json.logs : [],
        pagination: json?.pagination || { page, pageSize: 30, total: 0, totalPages: 1 },
      };
    },
    [page, moduleFilter, search, authToken],
    {
      enabled: Boolean(authToken),
      keepPreviousData: true,
      isEmpty: d => !d.logs || d.logs.length === 0,
    }
  );

  const logs = logsRes.data?.logs || [];
  const totalPages = logsRes.data?.pagination?.totalPages || 1;
  const total = logsRes.data?.pagination?.total;
  const hasLoadedOnce = logsRes.data !== null;
  const isInitialLoading = logsRes.isLoading && !hasLoadedOnce;
  const isUpdating = logsRes.isRefreshing || (logsRes.isLoading && hasLoadedOnce);

  return (
    <div className="space-y-6">
      {/* Title */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-slate-100 flex items-center gap-2 flex-wrap">
            <ShieldAlert className="w-5 h-5 text-indigo-400" />
            <span>Immutable Security &amp; Operations Audit Trail</span>
            {hasLoadedOnce && total !== undefined && (
              <span className="text-xs px-2 py-0.5 rounded-full bg-slate-800 text-indigo-400 font-medium tabular-nums">
                {total.toLocaleString()} {t('recordsCount')}
              </span>
            )}
            {isUpdating && <RefreshingBadge label={t('updatingTable')} />}
          </h1>
          <p className="text-xs text-slate-400 mt-0.5">
            Tamper-evident record of all logins, dataset imports, exports, mutations, and permissions.
          </p>
        </div>

        <button
          type="button"
          disabled={isInitialLoading || isUpdating}
          onClick={() => logsRes.reload({ force: true })}
          className="p-2 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 border border-slate-800 transition-colors self-start sm:self-auto disabled:opacity-60"
          title={t('refresh')}
        >
          <RefreshCw className={`w-4 h-4 ${isInitialLoading || isUpdating ? 'animate-spin text-indigo-400' : ''}`} />
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

      {logsRes.isError && logs.length > 0 && (
        <ErrorRetryCard compact message={logsRes.error} onRetry={() => logsRes.reload({ force: true })} />
      )}

      {/* Audit Table */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-sm">
        <TopProgressBar active={isInitialLoading || isUpdating} label={t('updatingTable')} />
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
            <tbody
              className={`divide-y divide-slate-800/60 text-slate-300 transition-opacity ${
                isUpdating && logs.length > 0 ? 'opacity-60' : 'opacity-100'
              }`}
            >
              {isInitialLoading ? (
                <TableSkeletonRows columns={6} rows={8} />
              ) : logsRes.isError && logs.length === 0 ? (
                <tr>
                  <td colSpan={6} className="p-6">
                    <ErrorRetryCard message={logsRes.error} onRetry={() => logsRes.reload({ force: true })} />
                  </td>
                </tr>
              ) : logs.length === 0 ? (
                <tr>
                  <td colSpan={6} className="p-6">
                    <EmptyStateCard
                      title={t('noRecordsTitle')}
                      description="No audit records found matching criteria."
                    />
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
                        {log.result === 'SUCCESS' ? '\u2713' : '\u2717'} {log.result}
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

      {/* Pagination Bar */}
      <div className="flex items-center justify-between text-xs text-slate-400 px-1">
        <div className="tabular-nums">
          {isInitialLoading ? (
            <div className="h-4 w-40 bg-slate-800 rounded animate-pulse motion-reduce:animate-none" />
          ) : (
            <>
              {t('showing')} <strong className="text-slate-200">{logs.length}</strong> {t('of')}{' '}
              <strong className="text-slate-200">{(total ?? 0).toLocaleString()}</strong> {t('recordsCount')}
            </>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={page <= 1 || isInitialLoading}
            onClick={() => setPage(p => Math.max(1, p - 1))}
            className="p-1.5 rounded-lg border border-slate-800 hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed text-slate-300"
          >
            <ChevronLeft className="w-4 h-4 rtl:rotate-180" />
          </button>
          <span className="px-2 tabular-nums">
            {t('page')} <strong className="text-slate-200">{page}</strong> / {totalPages}
          </span>
          <button
            type="button"
            disabled={page >= totalPages || isInitialLoading}
            onClick={() => setPage(p => Math.min(totalPages, p + 1))}
            className="p-1.5 rounded-lg border border-slate-800 hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed text-slate-300"
          >
            <ChevronRight className="w-4 h-4 rtl:rotate-180" />
          </button>
        </div>
      </div>
    </div>
  );
};
