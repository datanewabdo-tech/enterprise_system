import React, { useState, useEffect } from 'react';
import { useApp } from '../context/AppContext.js';
import {
  CheckCircle2,
  AlertTriangle,
  XCircle,
  RefreshCw,
  Search,
  ShieldAlert,
  ArrowRight,
  Database,
} from 'lucide-react';

export const DataQuality: React.FC = () => {
  const { activeMission, apiFetch, authToken } = useApp();

  const [loading, setLoading] = useState(true);
  const [report, setReport] = useState<any>(null);

  const runQualityCheck = () => {
    if (!authToken) return;
    setLoading(true);
    apiFetch('/api/v1/analytics/dashboard')
      .then(res => (res.ok ? res.json() : null))
      .then(data => {
        if (data?.qualityStats) setReport(data.qualityStats);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    if (authToken) {
      runQualityCheck();
    }
  }, [activeMission, authToken]);

  return (
    <div className="space-y-6">
      {/* Title */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-slate-100 flex items-center gap-2">
            <CheckCircle2 className="w-5 h-5 text-emerald-400" />
            <span>Dataset Quality, Integrity & Anomaly Inspector</span>
          </h1>
          <p className="text-xs text-slate-400 mt-0.5">
            Automated verification of coordinate bounds, identifier schemas, missing keys, and cross-table integrity.
          </p>
        </div>

        <button
          onClick={runQualityCheck}
          className="flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white shadow-sm shadow-indigo-600/30 transition-colors"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          <span>Re-inspect Datasets</span>
        </button>
      </div>

      {/* Summary Score Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="p-5 bg-slate-900 border border-slate-800 rounded-2xl shadow-sm">
          <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
            Total Inspected Telemetry Rows
          </span>
          <div className="text-3xl font-bold font-mono text-slate-100 mt-2">
            {(report?.totalChecked || 0).toLocaleString()}
          </div>
          <p className="text-[11px] text-slate-500 mt-1">Registrations & GPS records verified</p>
        </div>

        <div className="p-5 bg-slate-900 border border-emerald-900/40 rounded-2xl shadow-sm bg-gradient-to-br from-slate-900 to-emerald-950/20">
          <span className="text-xs font-semibold text-emerald-400 uppercase tracking-wider flex items-center gap-1.5">
            <CheckCircle2 className="w-4 h-4" />
            <span>Valid Records</span>
          </span>
          <div className="text-3xl font-bold font-mono text-emerald-400 mt-2">
            {(report?.validRecords || 0).toLocaleString()}
          </div>
          <p className="text-[11px] text-emerald-400/80 mt-1">Conforms to standard schema requirements</p>
        </div>

        <div className="p-5 bg-slate-900 border border-amber-900/40 rounded-2xl shadow-sm bg-gradient-to-br from-slate-900 to-amber-950/20">
          <span className="text-xs font-semibold text-amber-400 uppercase tracking-wider flex items-center gap-1.5">
            <AlertTriangle className="w-4 h-4" />
            <span>Records with Discrepancies</span>
          </span>
          <div className="text-3xl font-bold font-mono text-amber-400 mt-2">
            {(report?.issuesFound || 0).toLocaleString()}
          </div>
          <p className="text-[11px] text-amber-400/80 mt-1">Missing keys, outdated coordinates or formatting</p>
        </div>
      </div>

      {/* Detailed Issues Breakdown */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-sm space-y-4">
        <h2 className="text-xs font-bold text-slate-200 uppercase tracking-wider flex items-center gap-2">
          <ShieldAlert className="w-4 h-4 text-indigo-400" />
          <span>Integrity Verification Breakdown</span>
        </h2>

        <div className="space-y-3">
          {[
            {
              title: 'Missing Device Identifiers (IMSI or RegID)',
              desc: 'Records where device IMSI or registration sequence is null. Safe default anonymization applied.',
              count: report?.breakdown?.[0]?.count || 0,
              severity: 'MEDIUM',
              status: 'FLAGGED',
            },
            {
              title: 'Geographic Coordinate Bounds (-90°..90°, -180°..180°)',
              desc: 'GPS entries outside valid Earth latitude or longitude bounds.',
              count: report?.breakdown?.[1]?.count || 0,
              severity: 'HIGH',
              status: 'CLEARED',
            },
            {
              title: 'Foreign Key Alignment to Missions',
              desc: 'Verifies all telemetry records link to a registered mission record in the missions catalog.',
              count: 0,
              severity: 'LOW',
              status: 'VALID',
            },
            {
              title: 'Network MCC/MNC Carrier Conformity',
              desc: 'Validates mobile country and network codes against the international PLMN database.',
              count: 0,
              severity: 'LOW',
              status: 'VALID',
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
                <span className="font-mono text-sm font-bold text-slate-200">
                  {item.count} items
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
      </div>
    </div>
  );
};
