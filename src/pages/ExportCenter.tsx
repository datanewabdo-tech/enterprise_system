import React, { useState } from 'react';
import { useApp } from '../context/AppContext.js';
import { ErrorRetryCard } from '../components/common/LoadingStates.js';
import {
  FileDown,
  FileSpreadsheet,
  Download,
  Database,
  Layers,
  ShieldCheck,
  CheckCircle2,
  RefreshCw,
} from 'lucide-react';

export const ExportCenter: React.FC = () => {
  const { t, activeMission, missions, missionsLoading, missionsError, refreshMissions, apiFetch } = useApp();

  const [selectedTable, setSelectedTable] = useState('registrations');
  const [selectedFormat, setSelectedFormat] = useState<'xlsx' | 'csv' | 'json' | 'geojson'>('xlsx');
  const [selectedMission, setSelectedMission] = useState(activeMission);
  const [downloading, setDownloading] = useState(false);
  const [successNotice, setSuccessNotice] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const tables = [
    { id: 'missions', label: 'missions (Field Missions)' },
    { id: 'registrations', label: 'registrations (Device Telemetry)' },
    { id: 'targets', label: 'targets (Monitored Targets)' },
    { id: 'network_cells', label: 'network_cells (Cellular Antennas & Sectors)' },
    { id: 'gps_history', label: 'gps_history (GPS Locations & Power Logs)' },
    { id: 'wifi_access_points', label: 'wifi_access_points (WiFi SSIDs & BSSIDs)' },
    { id: 'wifi_access_point_clients', label: 'wifi_access_point_clients (WiFi Connected MACs)' },
    { id: 'map_cells', label: 'map_cells (Base Station Coordinate Database)' },
    { id: 'plmn_storage', label: 'plmn_storage (Mobile Country & Network Codes)' },
    { id: 'sms_calls', label: 'sms_calls (Intercept Logs)' },
    { id: 'map_user_markers', label: 'map_user_markers (Tactical Map Pins)' },
    { id: 'map_user_polygons', label: 'map_user_polygons (Perimeter Boundaries)' },
    { id: 'map_user_circles', label: 'map_user_circles (Exclusion Radii)' },
    { id: 'whitelist_targets', label: 'whitelist_targets (Authorized Assets)' },
    { id: 'tac_numbers', label: 'tac_numbers (Type Allocation Codes)' },
    { id: 'audit_logs', label: 'audit_logs (Security & Audit Trail)' },
  ];

  const handleDownload = async () => {
    setDownloading(true);
    setSuccessNotice(false);
    setErrorMsg(null);

    try {
      const params = new URLSearchParams({
        table: selectedTable,
        format: selectedFormat,
      });
      if (selectedMission && selectedMission !== 'ALL') {
        params.append('mission', selectedMission);
      }

      const res = await apiFetch(`/api/v1/exports/download?${params.toString()}`);
      if (!res.ok) {
        const json = await res.json().catch(() => null);
        throw new Error(json?.error || `Export failed (${res.status})`);
      }

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${selectedTable}_export.${selectedFormat}`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);

      setSuccessNotice(true);
    } catch (err: any) {
      setErrorMsg(err?.message || 'Failed to generate export');
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Title */}
      <div>
        <h1 className="text-xl font-bold text-slate-100 flex items-center gap-2">
          <FileDown className="w-5 h-5 text-indigo-400" />
          <span>{t('exportCenterTitle')}</span>
        </h1>
        <p className="text-xs text-slate-400 mt-0.5">{t('exportCenterSubtitle')}</p>
      </div>

      {/* Main Export Card */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-sm space-y-6 max-w-3xl">
        {/* Table Selector */}
        <div className="space-y-2">
          <label className="text-xs font-semibold text-slate-300 uppercase tracking-wider block">
            {t('selectExportTable')}
          </label>
          <select
            value={selectedTable}
            onChange={e => setSelectedTable(e.target.value)}
            className="w-full h-11 px-3.5 text-xs bg-slate-950 border border-slate-800 rounded-xl text-slate-200 focus:outline-none focus:border-indigo-500"
          >
            {tables.map(tb => (
              <option key={tb.id} value={tb.id}>
                {tb.label}
              </option>
            ))}
          </select>
        </div>

        {/* Format Selector */}
        <div className="space-y-2">
          <label className="text-xs font-semibold text-slate-300 uppercase tracking-wider block">
            {t('selectExportFormat')}
          </label>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { id: 'xlsx', label: 'Excel (.xlsx)', desc: 'Full formatting & headers', icon: FileSpreadsheet, color: 'text-emerald-400' },
              { id: 'csv', label: 'CSV (.csv)', desc: 'Universal raw tabular', icon: Download, color: 'text-sky-400' },
              { id: 'json', label: 'JSON (.json)', desc: 'REST structured payloads', icon: Database, color: 'text-amber-400' },
              { id: 'geojson', label: 'GeoJSON (.geojson)', desc: 'GIS & spatial layers', icon: Layers, color: 'text-purple-400' },
            ].map(fmt => {
              const Icon = fmt.icon;
              const isSelected = selectedFormat === fmt.id;
              return (
                <button
                  key={fmt.id}
                  type="button"
                  onClick={() => setSelectedFormat(fmt.id as any)}
                  className={`p-3.5 rounded-xl border text-start transition-all ${
                    isSelected
                      ? 'bg-indigo-600/20 border-indigo-500 text-white shadow-md'
                      : 'bg-slate-950/60 border-slate-800 text-slate-300 hover:bg-slate-800'
                  }`}
                >
                  <Icon className={`w-5 h-5 mb-1.5 ${fmt.color}`} />
                  <div className="text-xs font-bold">{fmt.label}</div>
                  <div className="text-[10px] text-slate-400 mt-0.5">{fmt.desc}</div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Mission Filter Selector */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-xs font-semibold text-slate-300 uppercase tracking-wider block">
              {t('applyMissionFilter')}
            </label>
            {missionsLoading && <RefreshCw className="w-3.5 h-3.5 animate-spin text-indigo-400" />}
          </div>
          <select
            disabled={missionsLoading}
            value={selectedMission}
            onChange={e => setSelectedMission(e.target.value)}
            className="w-full h-10 px-3.5 text-xs bg-slate-950 border border-slate-800 rounded-xl text-slate-200 focus:outline-none focus:border-indigo-500 disabled:opacity-60"
          >
            <option value="ALL">
              {missionsLoading ? t('loadingOptions') : t('allMissions')}
            </option>
            {missions.map(m => (
              <option key={m.id} value={String(m.id)}>
                {m.mission} &mdash; {m.location} (#{m.id})
              </option>
            ))}
          </select>
          {missionsError && (
            <ErrorRetryCard compact message={missionsError} onRetry={refreshMissions} />
          )}
        </div>

        {/* Audit Compliance Notice */}
        <div className="p-3 rounded-xl bg-slate-950/70 border border-slate-800 flex items-center gap-2.5 text-xs text-slate-400">
          <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0" />
          <span>All data export operations are immutably logged with user identity and timestamp for compliance.</span>
        </div>

        {errorMsg && (
          <ErrorRetryCard compact message={errorMsg} onRetry={handleDownload} />
        )}

        {/* Success Notice */}
        {successNotice && (
          <div className="p-3 bg-emerald-950/40 border border-emerald-800 rounded-xl text-xs text-emerald-300 flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
            <span>{t('exportSuccessMessage')}</span>
          </div>
        )}

        {/* Submit Download */}
        <div className="pt-2">
          <button
            type="button"
            onClick={handleDownload}
            disabled={downloading}
            className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-60 text-white font-bold text-xs shadow-lg shadow-indigo-600/25 transition-all"
          >
            {downloading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
            <span>{downloading ? 'Preparing Stream...' : t('downloadExport')}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
