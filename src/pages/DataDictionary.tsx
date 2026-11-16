import React, { useState } from 'react';
import { useApp } from '../context/AppContext.js';
import { useAsyncResource } from '../hooks/useAsyncResource.js';
import {
  TopProgressBar,
  RefreshingBadge,
  EmptyStateCard,
  ErrorRetryCard,
} from '../components/common/LoadingStates.js';
import { BookOpen, Search, Database, Key, RefreshCw } from 'lucide-react';

export const DataDictionary: React.FC = () => {
  const { t, apiFetch, authToken } = useApp();
  const [search, setSearch] = useState('');

  const dictRes = useAsyncResource<any[]>(
    async signal => {
      const res = await apiFetch('/api/v1/system/data-dictionary', { signal });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(json?.error || 'Failed to load data dictionary');
      }
      return Array.isArray(json) ? json : [];
    },
    [authToken],
    {
      enabled: Boolean(authToken),
      cacheKey: 'system:data-dictionary',
      isEmpty: data => !data || data.length === 0,
    }
  );

  const dictionary = dictRes.data || [];
  const isInitialLoading = dictRes.isLoading && !dictRes.data;

  const filtered = dictionary.filter(
    item =>
      item.table.toLowerCase().includes(search.toLowerCase()) ||
      item.columns.some((c: any) => c.name.toLowerCase().includes(search.toLowerCase()))
  );

  return (
    <div className="space-y-6">
      <TopProgressBar active={isInitialLoading || dictRes.isRefreshing} label={t('refreshingData')} />

      {/* Title */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-100 flex items-center gap-2 flex-wrap">
            <BookOpen className="w-5 h-5 text-indigo-400" />
            <span>{t('dictionaryTitle')}</span>
            {dictRes.isRefreshing && <RefreshingBadge />}
          </h1>
          <p className="text-xs text-slate-400 mt-0.5">{t('dictionarySubtitle')}</p>
        </div>
        <button
          type="button"
          disabled={isInitialLoading || dictRes.isRefreshing}
          onClick={() => dictRes.reload({ force: true })}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition-colors self-start disabled:opacity-60"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isInitialLoading || dictRes.isRefreshing ? 'animate-spin' : ''}`} />
          <span>{t('refresh')}</span>
        </button>
      </div>

      {/* Search Input */}
      <div className="relative max-w-md">
        <Search className="absolute left-3 top-2.5 w-4 h-4 text-slate-500 rtl:right-3 rtl:left-auto" />
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Filter tables or column names..."
          className="w-full h-9 pl-9 pr-3 rtl:pr-9 rtl:pl-3 text-xs bg-slate-900 border border-slate-800 rounded-lg text-slate-200 placeholder-slate-500 focus:outline-none focus:border-indigo-500"
        />
      </div>

      {/* Content */}
      {isInitialLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 animate-pulse motion-reduce:animate-none">
          {Array.from({ length: 6 }).map((_, idx) => (
            <div key={idx} className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-3">
              <div className="flex items-center justify-between border-b border-slate-800 pb-2.5">
                <div className="h-4 w-36 bg-slate-800 rounded" />
                <div className="h-4 w-20 bg-slate-800 rounded-full" />
              </div>
              <div className="space-y-2">
                {Array.from({ length: 5 }).map((__, r) => (
                  <div key={r} className="h-7 bg-slate-950/60 rounded" />
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : dictRes.isError && !dictRes.data ? (
        <ErrorRetryCard message={dictRes.error} onRetry={() => dictRes.reload({ force: true })} />
      ) : filtered.length === 0 ? (
        <EmptyStateCard
          title={t('noRecordsTitle')}
          description={search ? 'No tables or columns match your filter.' : t('noRecordsHint')}
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {filtered.map(table => (
            <div
              key={table.table}
              className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-sm space-y-3"
            >
              <div className="flex items-center justify-between border-b border-slate-800 pb-2.5">
                <div className="flex items-center gap-2">
                  <Database className="w-4 h-4 text-indigo-400" />
                  <span className="font-mono text-sm font-bold text-slate-100">{table.table}</span>
                </div>
                <span className="text-[11px] px-2 py-0.5 rounded-full bg-slate-800 text-slate-300 font-mono tabular-nums">
                  {table.rowCount.toLocaleString()} rows
                </span>
              </div>

              <div className="max-h-60 overflow-y-auto space-y-1 pr-1">
                {table.columns.map((col: any) => (
                  <div
                    key={col.name}
                    className="flex items-center justify-between p-1.5 rounded bg-slate-950/60 text-xs font-mono"
                  >
                    <div className="flex items-center gap-1.5">
                      {col.primaryKey && <Key className="w-3 h-3 text-amber-400" />}
                      <span className="text-slate-200">{col.name}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] text-indigo-400 font-semibold">{col.type}</span>
                      <span className="text-[10px] text-slate-500">
                        {col.nullable ? 'NULL' : 'NOT NULL'}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
