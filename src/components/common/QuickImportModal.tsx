import React, { useState } from 'react';
import { useApp } from '../../context/AppContext.js';
import { requestCache } from '../../utils/requestCache.js';
import { X, Upload, CheckCircle2, AlertTriangle, RefreshCw } from 'lucide-react';

export const QuickImportModal: React.FC = () => {
  const { quickImportOpen, setQuickImportOpen, t, addNotification, apiFetch, refreshMissions } = useApp();

  const [file, setFile] = useState<File | null>(null);
  const [targetTable, setTargetTable] = useState('registrations');
  const [loading, setLoading] = useState(false);
  const [stageLabel, setStageLabel] = useState<string | null>(null);
  const [result, setResult] = useState<any | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!quickImportOpen) return null;

  const resetAndClose = () => {
    setQuickImportOpen(false);
    setFile(null);
    setResult(null);
    setError(null);
    setStageLabel(null);
  };

  const handleQuickUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file) return;

    setLoading(true);
    setStageLabel(`${t('uploadInProgress')} Inspecting schema...`);
    setError(null);
    setResult(null);

    const formData = new FormData();
    formData.append('file', file);

    try {
      // 1. Inspect
      const inspectRes = await apiFetch('/api/v1/imports/inspect', {
        method: 'POST',
        body: formData,
      });
      if (!inspectRes.ok) {
        const json = await inspectRes.json().catch(() => null);
        throw new Error(json?.error || 'Inspection failed');
      }
      const inspectJson = await inspectRes.json();

      // 2. Auto build mapping
      let sourceCols: string[] = [];
      if (inspectJson.type === 'EXCEL' && inspectJson.sheets?.[0]) {
        sourceCols = inspectJson.sheets[0].columns;
      } else if (inspectJson.type === 'SQLITE' && inspectJson.tables?.[0]) {
        sourceCols = inspectJson.tables[0].columns.map((c: any) => c.name);
      } else if (inspectJson.type === 'CSV' && inspectJson.columns) {
        sourceCols = inspectJson.columns;
      }

      const mapping: Record<string, string> = {};
      sourceCols.forEach(col => {
        mapping[col] = col;
      });

      // 3. Execute
      setStageLabel(`Importing rows into ${targetTable}...`);
      const execRes = await apiFetch('/api/v1/imports/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filePath: inspectJson.filePath,
          originalName: inspectJson.originalName,
          destinationTable: targetTable,
          sheetOrTable: inspectJson.sheets?.[0]?.sheetName || inspectJson.tables?.[0]?.tableName,
          columnMapping: mapping,
          importMode: 'INSERT_OR_UPDATE',
        }),
      });

      if (!execRes.ok) {
        const json = await execRes.json().catch(() => null);
        throw new Error(json?.error || 'Execution failed');
      }

      const execJson = await execRes.json();
      setResult(execJson.result);
      requestCache.clear();
      refreshMissions();

      addNotification({
        title: 'Quick Import Successful',
        message: `Imported ${execJson.result.inserted} rows to ${targetTable}`,
        type: 'success',
      });
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
      setStageLabel(null);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/75 backdrop-blur-sm">
      <div className="relative w-full max-w-lg bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl p-6 space-y-4">
        <div className="flex items-center justify-between pb-3 border-b border-slate-800">
          <div className="flex items-center gap-2">
            <Upload className="w-5 h-5 text-indigo-400" />
            <h2 className="text-base font-bold text-slate-100">{t('quickImport')}</h2>
          </div>
          <button
            type="button"
            onClick={resetAndClose}
            className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {error && (
          <div className="p-3 bg-rose-500/10 border border-rose-500/30 rounded-xl text-xs text-rose-300 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {loading && stageLabel && (
          <div
            role="status"
            aria-live="polite"
            className="p-3 bg-indigo-950/40 border border-indigo-700/50 rounded-xl text-xs text-indigo-200 flex items-center gap-2"
          >
            <RefreshCw className="w-4 h-4 animate-spin text-indigo-400 shrink-0" />
            <span>{stageLabel}</span>
          </div>
        )}

        {result ? (
          <div className="space-y-4">
            <div className="p-4 rounded-xl bg-emerald-950/40 border border-emerald-800 text-emerald-300 flex items-center gap-3">
              <CheckCircle2 className="w-6 h-6 text-emerald-400 shrink-0" />
              <div>
                <h3 className="text-xs font-bold">Import Completed</h3>
                <p className="text-[11px] text-emerald-400/90 mt-0.5 tabular-nums">
                  Inserted: {result.inserted} | Updated: {result.updated} | Skipped: {result.skipped}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={resetAndClose}
              className="w-full py-2 text-xs font-semibold rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white"
            >
              Done
            </button>
          </div>
        ) : (
          <form onSubmit={handleQuickUpload} className="space-y-4">
            <div className="space-y-1">
              <label className="text-xs font-semibold text-slate-300">Destination Table</label>
              <select
                disabled={loading}
                value={targetTable}
                onChange={e => setTargetTable(e.target.value)}
                className="w-full h-9 px-3 text-xs bg-slate-950 border border-slate-800 rounded-lg text-slate-200 focus:outline-none focus:border-indigo-500 disabled:opacity-60"
              >
                <option value="registrations">registrations</option>
                <option value="network_cells">network_cells</option>
                <option value="gps_history">gps_history</option>
                <option value="targets">targets</option>
                <option value="wifi_access_points">wifi_access_points</option>
                <option value="map_cells">map_cells</option>
                <option value="plmn_storage">plmn_storage</option>
                <option value="sms_calls">sms_calls</option>
              </select>
            </div>

            <div className="space-y-1">
              <label className="text-xs font-semibold text-slate-300">File (.xlsx, .csv, .db)</label>
              <input
                type="file"
                required
                disabled={loading}
                accept=".xlsx,.xls,.csv,.db,.sqlite,.sqlite3"
                onChange={e => {
                  if (e.target.files && e.target.files[0]) {
                    setFile(e.target.files[0]);
                  }
                }}
                className="w-full text-xs text-slate-400 file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-semibold file:bg-slate-800 file:text-indigo-400 hover:file:bg-slate-700 disabled:opacity-60"
              />
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-slate-800">
              <button
                type="button"
                onClick={resetAndClose}
                className="px-4 py-2 text-xs font-medium rounded-lg bg-slate-800 text-slate-300"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={loading || !file}
                className="flex items-center gap-1.5 px-4 py-2 text-xs font-bold rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white disabled:opacity-50"
              >
                {loading && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
                <span>{loading ? (stageLabel || 'Processing...') : 'Upload & Ingest'}</span>
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
};
