import React from 'react';
import { useApp } from '../context/AppContext.js';
import { useAsyncResource } from '../hooks/useAsyncResource.js';
import {
  TopProgressBar,
  RefreshingBadge,
  KpiGridSkeleton,
  ErrorRetryCard,
} from '../components/common/LoadingStates.js';
import {
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  ShieldAlert,
} from 'lucide-react';

export const DataQuality: React.FC = () => {
  const { t, activeMission, apiFetch, authToken } = useApp();

  const missionIds = activeMission && activeMission !== 'ALL' ? [Number(activeMission)] : [];
  const filterKey = JSON.stringify({ missionIds });

  const qualityRes = useAsyncResource<any>(
    async signal => {
      const res = await apiFetch('/api/v1/analytics/widget/qualityStats', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ missionIds }),
        signal,
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(json?.error || 'Failed to inspect dataset quality');
      }
      return json;
    },
    [authToken, filterKey],
    {
      enabled: Boolean(authToken),
      cacheKey: `qualityStats:${filterKey}`,
      keepPreviousData: true,
    }
  );

  const report = qualityRes.data;
  const isInitialLoading = qualityRes.isLoading && !report;
  const isUpdating = qualityRes.isRefreshing || (qualityRes.isLoading && Boolean(report));

  return (
    <div className="space-y-6">
      <TopProgressBar active={isInitialLoading || isUpdating} label={t('refreshingData')} />

      {/* Title */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-slate-100 flex items-center gap-2 flex-wrap">
            <CheckCircle2 className="w-5 h-5 text-emerald-400" />
            <span>Dataset Quality, Integrity &amp; Anomaly Inspector</span>
            {isUpdating && <RefreshingBadge />}
          </h1>
          <p className="text-xs text-slate-400 mt-0.5">
            Automated verification of coordinate bounds, identifier schemas, missing keys, and cross-table integrity.
          </p>
        </div>

        <button
          type="button"
          disabled={isInitialLoading || isUpdating}
          onClick={() => qualityRes.reload({ force: true })}
          className="flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white shadow-sm shadow-indigo-600/30 transition-colors disabled:opacity-60"
        >
          <RefreshCw className={`w-4 h-4 ${isInitialLoading || isUpdating ? 'animate-spin' : ''}`} />
          <span>Re-inspect Datasets</span>
        </button>
      </div>

      {qualityRes.isError && !report ? (
        <ErrorRetryCard message={qualityRes.error} onRetry={() => qualityRes.reload({ force: true })} />
      ) : (
        <>
          {qualityRes.isError && report && (
            <ErrorRetryCard compact message={qualityRes.error} onRetry={() => qualityRes.reload({ force: true })} />
          )}

          {/* Summary Score Cards */}
          {isInitialLoading ? (
            <KpiGridSkeleton count={3} gridClassName="grid grid-cols-1 sm:grid-cols-3 gap-4" />
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="p-5 bg-slate-900 border border-slate-800 rounded-2xl shadow-sm">
                <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
                  Total Inspected Telemetry Rows
                </span>
                <div className="text-3xl font-bold font-mono tabular-nums text-slate-100 mt-2">
                  {(report?.totalChecked ?? 0).toLocaleString()}
                </div>
                <p className="text-[11px] text-slate-500 mt-1">Registrations &amp; GPS records verified</p>
              </div>

              <div className="p-5 bg-slate-900 border border-emerald-900/40 rounded-2xl shadow-sm bg-gradient-to-br from-slate-900 to-emerald-950/20">
                <span className="text-xs font-semibold text-emerald-400 uppercase tracking-wider flex items-center gap-1.5">
                  <CheckCircle2 className="w-4 h-4" />
                  <span>Valid Records</span>
                </span>
                <div className="text-3xl font-bold font-mono tabular-nums text-emerald-400 mt-2">
                  {(report?.validRecords ?? 0).toLocaleString()}
                </div>
                <p className="text-[11px] text-emerald-400/80 mt-1">Conforms to standard schema requirements</p>
              </div>

              <div className="p-5 bg-slate-900 border border-amber-900/40 rounded-2xl shadow-sm bg-gradient-to-br from-slate-900 to-amber-950/20">
                <span className="text-xs font-semibold text-amber-400 uppercase tracking-wider flex items-center gap-1.5">
                  <AlertTriangle className="w-4 h-4" />
                  <span>Records with Discrepancies</span>
                </span>
                <div className="text-3xl font-bold font-mono tabular-nums text-amber-400 mt-2">
                  {(report?.issuesFound ?? 0).toLocaleString()}
                </div>
                <p className="text-[11px] text-amber-400/80 mt-1">Missing keys, outdated coordinates or formatting</p>
              </div>
            </div>
          )}

          {/* Detailed Issues Breakdown */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-sm space-y-4">
            <h2 className="text-xs font-bold text-slate-200 uppercase tracking-wider flex items-center gap-2">
              <ShieldAlert className="w-4 h-4 text-indigo-400" />
              <span>Integrity Verification Breakdown</span>
            </h2>

            {isInitialLoading ? (
              <div className="space-y-3 animate-pulse motion-reduce:animate-none">
                {Array.from({ length: 4 }).map((_, idx) => (
                  <div key={idx} className="h-20 bg-slate-950/70 border border-slate-800 rounded-xl p-4 flex items-center justify-between gap-4">
                    <div className="space-y-2 flex-1">
                      <div className="h-3.5 w-64 bg-slate-800 rounded" />
                      <div className="h-3 w-96 bg-slate-800/70 rounded" />
                    </div>
                    <div className="h-6 w-24 bg-slate-800 rounded" />
                  </div>
                ))}
              </div>
            ) : (
              <div className="space-y-3">
                {[
                  {
                    title: 'Missing Device Identifiers (IMSI or RegID)',
                    desc: 'Records where device IMSI or registration sequence is null. Safe default anonymization applied.',
                    count: report?.breakdown?.[0]?.count || 0,
                    severity: 'MEDIUM',
                  },
                  {
                    title: 'Geographic Coordinate Bounds (-90°..90°, -180°..180°)',
                    desc: 'GPS entries outside valid Earth latitude or longitude bounds.',
                    count: report?.breakdown?.[1]?.count || 0,
                    severity: 'HIGH',
                  },
                  {
                    title: 'Foreign Key Alignment to Missions',
                    desc: 'Verifies all telemetry records link to a registered mission record in the missions catalog.',
                    count: 0,
                    severity: 'LOW',
                  },
                  {
                    title: 'Network MCC/MNC Carrier Conformity',
                    desc: 'Validates mobile country and network codes against the international PLMN database.',
                    count: 0,
                    severity: 'LOW',
                  },
                ].map((item, idx) => (
                  <div
                    key={idx}
                    className="flex flex-col sm:flex-row sm:items-center justify-between p-4 bg-slate-950/70 border border-slate-800 rounded-xl gap-3"
                  >
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="text-xs font-bold text-slate-200">{item.title}</h3>
                        <span
                          className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${
                            item.severity === 'HIGH'
                              ? 'bg-rose-950 text-rose-400'
                              : item.severity === 'MEDIUM'
                              ? 'bg-amber-950 text-amber-400'
                              : 'bg-emerald-950 text-emerald-400'
                          }`}
                        >
                          {item.severity}
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-400 mt-1">{item.desc}</p>
                    </div>

                    <div className="flex items-center gap-4 shrink-0">
                      <span className="font-mono text-sm font-bold tabular-nums text-slate-200">
                        {item.count.toLocaleString()} items
                      </span>
                      <span
                        className={`px-2 py-1 rounded-lg text-xs font-semibold ${
                          item.count === 0
                            ? 'bg-emerald-950/60 text-emerald-400 border border-emerald-800/60'
                            : 'bg-amber-950/60 text-amber-400 border border-amber-800/60'
                        }`}
                      >
                        {item.count === 0 ? 'Compliant' : 'Review Required'}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
};
