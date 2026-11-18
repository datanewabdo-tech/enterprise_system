import React, { useEffect } from 'react';
import { useApp } from '../context/AppContext.js';
import { useAsyncResource } from '../hooks/useAsyncResource.js';
import {
  TopProgressBar,
  RefreshingBadge,
  KpiGridSkeleton,
  ErrorRetryCard,
} from '../components/common/LoadingStates.js';
import {
  Activity,
  Server,
  Database,
  Cpu,
  RefreshCw,
  Clock,
} from 'lucide-react';

export const SystemHealth: React.FC = () => {
  const { t, apiFetch } = useApp();

  const healthRes = useAsyncResource<any>(
    async signal => {
      const res = await apiFetch('/api/v1/system/health', { signal });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(json?.error || 'Failed to inspect system health');
      }
      return json;
    },
    [],
    {
      enabled: true,
      keepPreviousData: true,
    }
  );

  const reloadHealth = healthRes.reload;
  useEffect(() => {
    const interval = window.setInterval(() => {
      reloadHealth({ force: true });
    }, 10000);
    return () => window.clearInterval(interval);
  }, [reloadHealth]);

  const formatUptime = (secs: number) => {
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    const s = secs % 60;
    return `${h}h ${m}m ${s}s`;
  };

  const health = healthRes.data;
  const isInitialLoading = healthRes.isLoading && !health;
  const isUpdating = healthRes.isRefreshing || (healthRes.isLoading && Boolean(health));

  return (
    <div className="space-y-6">
      <TopProgressBar active={isInitialLoading || isUpdating} label={t('refreshingData')} />

      {/* Title */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-slate-100 flex items-center gap-2 flex-wrap">
            <Activity className="w-5 h-5 text-indigo-400" />
            <span>{t('healthTitle')}</span>
            {isUpdating && <RefreshingBadge />}
          </h1>
          <p className="text-xs text-slate-400 mt-0.5">
            Real-time diagnostics of Express backend, database connection, memory consumption, and disk volumes.
          </p>
        </div>

        <button
          type="button"
          disabled={isInitialLoading || isUpdating}
          onClick={() => reloadHealth({ force: true })}
          className="p-2 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 border border-slate-800 transition-colors self-start sm:self-auto disabled:opacity-60"
          title={t('refresh')}
        >
          <RefreshCw className={`w-4 h-4 ${isInitialLoading || isUpdating ? 'animate-spin text-indigo-400' : ''}`} />
        </button>
      </div>

      {healthRes.isError && !health ? (
        <ErrorRetryCard message={healthRes.error} onRetry={() => reloadHealth({ force: true })} />
      ) : (
        <>
          {healthRes.isError && health && (
            <ErrorRetryCard compact message={healthRes.error} onRetry={() => reloadHealth({ force: true })} />
          )}

          {/* Main Status Cards */}
          {isInitialLoading ? (
            <KpiGridSkeleton count={4} gridClassName="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4" />
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {/* Core Status */}
              <div className="p-5 bg-slate-900 border border-slate-800 rounded-2xl shadow-sm space-y-2">
                <div className="flex items-center justify-between text-slate-400">
                  <span className="text-xs font-semibold uppercase">API Services</span>
                  <Server className="w-4 h-4 text-emerald-400" />
                </div>
                <div className="text-2xl font-bold font-mono text-emerald-400 flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" />
                  <span>{(health?.status || 'OK').toUpperCase() === 'OK' ? 'OPERATIONAL' : String(health.status).toUpperCase()}</span>
                </div>
                <p className="text-[11px] text-slate-500">Express v4 / Node {health?.system?.nodeVersion}</p>
              </div>

              {/* Database Status */}
              <div className="p-5 bg-slate-900 border border-slate-800 rounded-2xl shadow-sm space-y-2">
                <div className="flex items-center justify-between text-slate-400">
                  <span className="text-xs font-semibold uppercase">Database Tier</span>
                  <Database className="w-4 h-4 text-indigo-400" />
                </div>
                <div className="text-2xl font-bold font-mono text-indigo-400 flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-indigo-500" />
                  <span>{String(health?.database || 'CONNECTED').toUpperCase()}</span>
                </div>
                <p className="text-[11px] text-slate-500">WAL Mode &bull; Foreign Keys Enabled</p>
              </div>

              {/* Memory RSS */}
              <div className="p-5 bg-slate-900 border border-slate-800 rounded-2xl shadow-sm space-y-2">
                <div className="flex items-center justify-between text-slate-400">
                  <span className="text-xs font-semibold uppercase">Memory RSS</span>
                  <Cpu className="w-4 h-4 text-sky-400" />
                </div>
                <div className="text-2xl font-bold font-mono tabular-nums text-slate-100">
                  {health?.system?.memoryRssMb ?? 0} MB
                </div>
                <p className="text-[11px] text-slate-500 tabular-nums">
                  Heap: {health?.system?.memoryHeapUsedMb ?? 0} MB
                </p>
              </div>

              {/* Uptime */}
              <div className="p-5 bg-slate-900 border border-slate-800 rounded-2xl shadow-sm space-y-2">
                <div className="flex items-center justify-between text-slate-400">
                  <span className="text-xs font-semibold uppercase">Server Uptime</span>
                  <Clock className="w-4 h-4 text-amber-400" />
                </div>
                <div className="text-xl font-bold font-mono tabular-nums text-slate-100">
                  {formatUptime(health?.uptimeSeconds ?? 0)}
                </div>
                <p className="text-[11px] text-slate-500">Continuous runtime</p>
              </div>
            </div>
          )}

          {/* Detailed Technical Specifications */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-sm space-y-4">
            <h2 className="text-xs font-bold text-slate-200 uppercase tracking-wider">
              Runtime &amp; Infrastructure Attributes
            </h2>

            {isInitialLoading ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 animate-pulse motion-reduce:animate-none">
                {Array.from({ length: 4 }).map((_, idx) => (
                  <div key={idx} className="h-11 bg-slate-950/70 border border-slate-800 rounded-xl" />
                ))}
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs font-mono">
                <div className="p-3 bg-slate-950/70 border border-slate-800 rounded-xl flex items-center justify-between">
                  <span className="text-slate-400 font-sans">Platform &amp; Arch:</span>
                  <span className="text-slate-200">{health?.system?.platform || '-'}</span>
                </div>

                <div className="p-3 bg-slate-950/70 border border-slate-800 rounded-xl flex items-center justify-between">
                  <span className="text-slate-400 font-sans">Database Engine:</span>
                  <span className="text-slate-200">PostgreSQL (Compatible WAL Storage)</span>
                </div>

                <div className="p-3 bg-slate-950/70 border border-slate-800 rounded-xl flex items-center justify-between">
                  <span className="text-slate-400 font-sans">Disk Storage Used:</span>
                  <span className="text-slate-200 tabular-nums">{health?.system?.storageUsedMb ?? 0} MB</span>
                </div>

                <div className="p-3 bg-slate-950/70 border border-slate-800 rounded-xl flex items-center justify-between">
                  <span className="text-slate-400 font-sans">Build Version:</span>
                  <span className="text-indigo-400 font-bold">{health?.version || '-'}</span>
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
};
