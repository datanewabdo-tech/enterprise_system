import React, { useState, useEffect } from 'react';
import { useApp } from '../context/AppContext.js';
import { ImportInspection, ColumnMeta, SqliteInspectedTable } from '../types/index.js';
import {
  FileUp,
  Database,
  ArrowRight,
  CheckCircle2,
  AlertTriangle,
  FileSpreadsheet,
  Sparkles,
  Clock,
  RefreshCw,
  Compass,
  ChevronDown,
  ChevronUp,
  Play,
  ShieldCheck,
} from 'lucide-react';

interface MultiSqliteConfigState {
  selected: boolean;
  sourceTable: string;
  destinationTable: string;
  columnMapping: Record<string, string>;
  conflictMode: 'skip' | 'update' | 'replace';
  matchKey: string;
  destColumns: ColumnMeta[];
  expanded: boolean;
}

const KNOWN_DEST_TABLES = [
  'missions',
  'registrations',
  'targets',
  'network_cells',
  'gps_history',
  'wifi_access_points',
  'wifi_access_point_clients',
  'map_cell_databases',
  'map_cells',
  'plmn_storage',
  'sms_calls',
  'map_user_markers',
  'map_user_polygons',
  'map_user_circles',
  'mission_extras',
  'location_extras',
  'mission_files',
  'location_files',
  'target_files',
  'whitelist_targets',
  'tac_numbers',
  'scheduled_tasks',
  'map_layers',
];

export const ImportCenter: React.FC = () => {
  const { t, addNotification, apiFetch, refreshMissions } = useApp();

  // Wizard Step (1 to 7) for Excel/CSV; Multi-table workflow activates automatically for SQLITE
  const [currentStep, setCurrentStep] = useState(1);

  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [inspection, setInspection] = useState<ImportInspection | null>(null);

  // Single-Table (Excel / CSV) State
  const [selectedSheetOrTable, setSelectedSheetOrTable] = useState<string>('');
  const [destinationTable, setDestinationTable] = useState<string>('registrations');
  const [destColumns, setDestColumns] = useState<ColumnMeta[]>([]);
  const [columnMapping, setColumnMapping] = useState<Record<string, string>>({});
  const [importMode, setImportMode] = useState<'INSERT_ONLY' | 'UPDATE_EXISTING' | 'INSERT_OR_UPDATE'>('INSERT_OR_UPDATE');
  const [matchKey] = useState<string>('id');
  const [enableCoordParser, setEnableCoordParser] = useState(false);
  const [combinedCoordCol, setCombinedCoordCol] = useState('');
  const [latCol] = useState('');
  const [lngCol] = useState('');
  const [targetLatCol, setTargetLatCol] = useState('latitude');
  const [targetLngCol, setTargetLngCol] = useState('longitude');
  const [coordOrder, setCoordOrder] = useState<'LAT_LNG' | 'LNG_LAT'>('LAT_LNG');
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<any | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Multi-Table SQLite State
  const [multiConfigs, setMultiConfigs] = useState<Record<string, MultiSqliteConfigState>>({});
  const [estimating, setEstimating] = useState(false);
  const [estimates, setEstimates] = useState<any[] | null>(null);
  const [multiExecuting, setMultiExecuting] = useState(false);
  const [multiResult, setMultiResult] = useState<any | null>(null);

  // Import History
  const [history, setHistory] = useState<any[]>([]);

  const fetchHistory = () => {
    apiFetch('/api/v1/imports/history')
      .then(res => res.json())
      .then(data => setHistory(Array.isArray(data) ? data : []))
      .catch(() => {});
  };

  useEffect(() => {
    fetchHistory();
  }, []);

  useEffect(() => {
    apiFetch(`/api/v1/tables/${destinationTable}?pageSize=1`)
      .then(res => res.json())
      .then(data => {
        if (data.columns) setDestColumns(data.columns);
      })
      .catch(() => {});
  }, [destinationTable, apiFetch]);

  const initializeMultiSqliteConfigs = (tables: SqliteInspectedTable[]) => {
    const next: Record<string, MultiSqliteConfigState> = {};
    for (const tb of tables) {
      const dest = tb.suggestedDestination || 'registrations';
      next[tb.tableName] = {
        selected: tb.rowCount > 0,
        sourceTable: tb.tableName,
        destinationTable: dest,
        columnMapping: tb.suggestedMapping || {},
        conflictMode: 'skip',
        matchKey: dest === 'plmn_storage' ? 'mcc' : dest === 'tac_numbers' ? 'tac' : dest === 'wifi_access_points' ? 'bssid' : 'id',
        destColumns: tb.destColumns || [],
        expanded: false,
      };
    }
    setMultiConfigs(next);
    setEstimates(null);
    setMultiResult(null);
  };

  const handleFileUpload = async (file: File) => {
    setSelectedFile(file);
    setUploading(true);
    setErrorMsg(null);
    setEstimates(null);
    setMultiResult(null);
    setImportResult(null);

    const formData = new FormData();
    formData.append('file', file);

    try {
      const res = await apiFetch('/api/v1/imports/inspect', {
        method: 'POST',
        body: formData,
      });

      if (!res.ok) {
        const json = await res.json();
        throw new Error(json.error || 'File inspection failed');
      }

      const data: ImportInspection = await res.json();
      setInspection(data);

      if (data.type === 'SQLITE' && data.tables) {
        initializeMultiSqliteConfigs(data.tables);
        setCurrentStep(2);
      } else if (data.type === 'EXCEL' && data.sheets && data.sheets.length > 0) {
        setSelectedSheetOrTable(data.sheets[0].sheetName);
        autoMap(data.sheets[0].columns);
        setCurrentStep(2);
      } else if (data.type === 'CSV' && data.columns) {
        autoMap(data.columns);
        setCurrentStep(2);
      }
    } catch (err: any) {
      setErrorMsg(err.message);
    } finally {
      setUploading(false);
    }
  };

  const autoMap = (sourceCols: string[]) => {
    const mapping: Record<string, string> = {};
    const destNames = destColumns.map(c => c.name);
    sourceCols.forEach(src => {
      const normalizedSrc = src.toLowerCase().replace(/[^a-z0-9]/g, '');
      const match = destNames.find(dst => dst.toLowerCase().replace(/[^a-z0-9]/g, '') === normalizedSrc);
      if (match) mapping[src] = match;
    });
    setColumnMapping(mapping);
  };

  const handleMultiDestChange = async (sourceTable: string, newDest: string) => {
    const res = await apiFetch(`/api/v1/tables/${newDest}?pageSize=1`);
    const json = res.ok ? await res.json() : { columns: [] };
    const cols: ColumnMeta[] = json.columns || [];
    const srcCols = inspection?.tables?.find(x => x.tableName === sourceTable)?.columns.map(c => c.name) || [];

    const mapping: Record<string, string> = {};
    srcCols.forEach(src => {
      const n = src.toLowerCase().replace(/[^a-z0-9]/g, '');
      const found = cols.find(d => d.name.toLowerCase().replace(/[^a-z0-9]/g, '') === n);
      if (found) mapping[src] = found.name;
    });

    setMultiConfigs(prev => ({
      ...prev,
      [sourceTable]: {
        ...prev[sourceTable],
        destinationTable: newDest,
        destColumns: cols,
        columnMapping: mapping,
      },
    }));
    setEstimates(null);
  };

  const setAllMultiSelected = (selected: boolean) => {
    setMultiConfigs(prev => {
      const copy = { ...prev };
      for (const k of Object.keys(copy)) {
        copy[k] = { ...copy[k], selected };
      }
      return copy;
    });
    setEstimates(null);
  };

  const getSelectedMultiPayload = (forceAll = false) => {
    return Object.values(multiConfigs)
      .filter(c => forceAll || c.selected)
      .map(c => ({
        sourceTable: c.sourceTable,
        destinationTable: c.destinationTable,
        columnMapping: c.columnMapping,
        conflictMode: c.conflictMode,
        matchKey: c.matchKey,
      }));
  };

  const handleEstimateMultiSqlite = async () => {
    if (!inspection) return;
    const tables = getSelectedMultiPayload(false);
    if (tables.length === 0) {
      setErrorMsg('Select at least one SQLite table to validate and estimate.');
      return;
    }

    setEstimating(true);
    setErrorMsg(null);
    try {
      const res = await apiFetch('/api/v1/imports/sqlite/estimate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filePath: inspection.filePath,
          originalName: inspection.originalName,
          tables,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Estimation failed');
      setEstimates(json.estimates || []);
    } catch (err: any) {
      setErrorMsg(err.message);
    } finally {
      setEstimating(false);
    }
  };

  const handleExecuteMultiSqlite = async (forceAll = false) => {
    if (!inspection) return;
    if (forceAll) setAllMultiSelected(true);
    const tables = getSelectedMultiPayload(forceAll);
    if (tables.length === 0) {
      setErrorMsg('Select at least one SQLite table to import.');
      return;
    }

    setMultiExecuting(true);
    setErrorMsg(null);
    try {
      const res = await apiFetch('/api/v1/imports/sqlite/multi-execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filePath: inspection.filePath,
          originalName: inspection.originalName,
          tables,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Multi-table SQLite import failed');

      setMultiResult(json);
      fetchHistory();
      refreshMissions();
      addNotification({
        title: 'Multi-Table SQLite Import Completed',
        message: `Imported ${json.totals.inserted} inserted, ${json.totals.updated} updated across ${json.tableResults.length} tables.`,
        type: json.totals.errors > 0 ? 'warning' : 'success',
      });
    } catch (err: any) {
      setErrorMsg(err.message);
    } finally {
      setMultiExecuting(false);
    }
  };

  const handleExecuteImport = async () => {
    if (!inspection) return;
    setImporting(true);
    setErrorMsg(null);

    try {
      const payload: any = {
        filePath: inspection.filePath,
        originalName: inspection.originalName,
        destinationTable,
        sheetOrTable: selectedSheetOrTable,
        columnMapping,
        importMode,
        matchKey,
      };

      if (enableCoordParser) {
        payload.coordinateConfig = {
          combinedCol: combinedCoordCol || undefined,
          latCol: latCol || undefined,
          lngCol: lngCol || undefined,
          targetLatCol,
          targetLngCol,
          order: coordOrder,
        };
      }

      const res = await apiFetch('/api/v1/imports/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const json = await res.json();
        throw new Error(json.error || 'Import failed');
      }

      const json = await res.json();
      setImportResult(json.result);
      setCurrentStep(7);
      addNotification({
        title: 'Import Complete',
        message: `Imported ${json.result.inserted} rows to ${destinationTable}`,
        type: 'success',
      });
      fetchHistory();
      refreshMissions();
    } catch (err: any) {
      setErrorMsg(err.message);
    } finally {
      setImporting(false);
    }
  };

  const getSourceColumns = (): string[] => {
    if (!inspection) return [];
    if (inspection.type === 'EXCEL' && inspection.sheets) {
      const s = inspection.sheets.find(x => x.sheetName === selectedSheetOrTable);
      return s ? s.columns : [];
    }
    if (inspection.type === 'SQLITE' && inspection.tables) {
      const tb = inspection.tables.find(x => x.tableName === selectedSheetOrTable);
      return tb ? tb.columns.map(c => c.name) : [];
    }
    return inspection.columns || [];
  };

  const getPreviewRows = (): any[] => {
    if (!inspection) return [];
    if (inspection.type === 'EXCEL' && inspection.sheets) {
      const s = inspection.sheets.find(x => x.sheetName === selectedSheetOrTable);
      return s ? s.preview : [];
    }
    if (inspection.type === 'SQLITE' && inspection.tables) {
      const tb = inspection.tables.find(x => x.tableName === selectedSheetOrTable);
      return tb ? tb.preview : [];
    }
    return inspection.preview || [];
  };

  const selectedCount = Object.values(multiConfigs).filter(c => c.selected).length;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-slate-100 flex items-center gap-2">
          <FileUp className="w-5 h-5 text-indigo-400" />
          <span>{t('importWizardTitle')}</span>
        </h1>
        <p className="text-xs text-slate-400 mt-0.5">{t('importWizardSubtitle')}</p>
      </div>

      {/* Stepper Bar (shown for Excel/CSV or initial upload) */}
      {inspection?.type !== 'SQLITE' && (
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 shadow-sm">
          <div className="flex items-center justify-between text-xs font-semibold overflow-x-auto pb-1 gap-2">
            {[
              { num: 1, label: t('step1Upload') },
              { num: 2, label: t('step2Sheet') },
              { num: 3, label: t('step3Target') },
              { num: 4, label: t('step4Mapping') },
              { num: 5, label: t('step5Coords') },
              { num: 6, label: t('step6Preview') },
              { num: 7, label: t('step7Execute') },
            ].map(s => {
              const isActive = currentStep === s.num;
              const isDone = currentStep > s.num;
              return (
                <div
                  key={s.num}
                  className={`flex items-center gap-1.5 shrink-0 px-2.5 py-1 rounded-lg ${
                    isActive ? 'bg-indigo-600 text-white font-bold' : isDone ? 'text-emerald-400' : 'text-slate-500'
                  }`}
                >
                  <span
                    className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] ${
                      isActive ? 'bg-white text-indigo-600 font-bold' : isDone ? 'bg-emerald-950 text-emerald-400' : 'bg-slate-800 text-slate-400'
                    }`}
                  >
                    {isDone ? '✓' : s.num}
                  </span>
                  <span className="text-[11px]">{s.label}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {errorMsg && (
        <div className="p-3 bg-rose-500/10 border border-rose-500/30 rounded-xl text-xs text-rose-300 flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}

      {/* Main Content Card */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 shadow-sm">
        {/* STEP 1: File Upload */}
        {currentStep === 1 && (
          <div className="space-y-4">
            <h2 className="text-sm font-bold text-slate-200">{t('step1Upload')}</h2>
            <div
              onDragOver={e => e.preventDefault()}
              onDrop={e => {
                e.preventDefault();
                if (e.dataTransfer.files && e.dataTransfer.files[0]) {
                  handleFileUpload(e.dataTransfer.files[0]);
                }
              }}
              className="border-2 border-dashed border-slate-700 hover:border-indigo-500 rounded-2xl p-8 text-center bg-slate-950/40 cursor-pointer transition-colors"
              onClick={() => document.getElementById('file-upload-input')?.click()}
            >
              <input
                id="file-upload-input"
                type="file"
                accept=".xlsx,.xls,.csv,.db,.sqlite,.sqlite3"
                className="hidden"
                onChange={e => {
                  if (e.target.files && e.target.files[0]) {
                    handleFileUpload(e.target.files[0]);
                  }
                }}
              />
              <div className="flex flex-col items-center justify-center gap-3">
                <div className="w-12 h-12 rounded-full bg-indigo-600/20 text-indigo-400 flex items-center justify-center">
                  <FileSpreadsheet className="w-6 h-6" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-slate-200">{t('uploadDropzone')}</p>
                  <p className="text-xs text-slate-400 mt-1">{t('uploadSupported')}</p>
                  {selectedFile && !uploading && (
                    <p className="text-xs text-indigo-300 mt-1">Selected: {selectedFile.name}</p>
                  )}
                </div>
                {uploading && (
                  <div className="flex items-center gap-2 text-xs text-indigo-400 font-semibold animate-pulse">
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    <span>Inspecting schema structure and sample rows...</span>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* DEDICATED MULTI-TABLE SQLITE WORKFLOW */}
        {currentStep >= 2 && inspection?.type === 'SQLITE' && inspection.tables && (
          <div className="space-y-5">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-800">
              <div>
                <h2 className="text-sm font-bold text-slate-100 flex items-center gap-2">
                  <Database className="w-4 h-4 text-indigo-400" />
                  <span>{t('multiSqliteTitle')}</span>
                </h2>
                <p className="text-xs text-slate-400 mt-0.5">
                  Source: <strong className="text-slate-200">{inspection.originalName}</strong> •{' '}
                  {inspection.tables.length} non-system tables detected •{' '}
                  <strong className="text-indigo-300">{selectedCount}</strong> selected
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setInspection(null);
                  setCurrentStep(1);
                }}
                className="px-3 py-1.5 text-xs rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300"
              >
                Upload Another File
              </button>
            </div>

            {/* Bulk Selection & Execution Toolbar */}
            <div className="flex flex-wrap items-center justify-between gap-2 p-3 rounded-xl bg-slate-950/70 border border-slate-800">
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => setAllMultiSelected(true)}
                  className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700"
                >
                  {t('selectAllTables')}
                </button>
                <button
                  type="button"
                  onClick={() => setAllMultiSelected(false)}
                  className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700"
                >
                  {t('deselectAllTables')}
                </button>
                <button
                  type="button"
                  onClick={() => setAllMultiSelected(false)}
                  className="px-3 py-1.5 text-xs font-medium rounded-lg bg-slate-900 hover:bg-slate-800 text-slate-400 border border-slate-800"
                >
                  {t('clearSelection')}
                </button>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={handleEstimateMultiSqlite}
                  disabled={estimating || selectedCount === 0}
                  className="flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold rounded-lg bg-amber-600/20 hover:bg-amber-600/30 text-amber-300 border border-amber-600/40 disabled:opacity-40"
                >
                  {estimating ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <ShieldCheck className="w-3.5 h-3.5" />}
                  <span>{t('validateEstimate')}</span>
                </button>

                <button
                  type="button"
                  onClick={() => handleExecuteMultiSqlite(true)}
                  disabled={multiExecuting}
                  className="flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold rounded-lg bg-indigo-600/20 hover:bg-indigo-600/30 text-indigo-300 border border-indigo-500/40 disabled:opacity-40"
                >
                  <Play className="w-3.5 h-3.5" />
                  <span>{t('importAllTables')}</span>
                </button>

                <button
                  type="button"
                  onClick={() => handleExecuteMultiSqlite(false)}
                  disabled={multiExecuting || selectedCount === 0}
                  className="flex items-center gap-1.5 px-4 py-1.5 text-xs font-bold rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white disabled:opacity-40"
                >
                  {multiExecuting ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
                  <span>{multiExecuting ? 'Executing Transactions...' : `${t('startMultiImport')} (${selectedCount})`}</span>
                </button>
              </div>
            </div>

            {/* Table Checklist & Per-Table Mapping Cards */}
            <div className="space-y-3">
              {inspection.tables.map(tb => {
                const cfg = multiConfigs[tb.tableName];
                if (!cfg) return null;
                const est = estimates?.find(e => e.sourceTable === tb.tableName);
                const mappedCount = Object.values(cfg.columnMapping).filter(Boolean).length;

                return (
                  <div
                    key={tb.tableName}
                    className={`rounded-xl border transition-colors ${
                      cfg.selected ? 'bg-slate-950/70 border-indigo-500/50' : 'bg-slate-950/30 border-slate-800 opacity-75'
                    }`}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-3 p-3.5">
                      <div className="flex items-center gap-3 min-w-0">
                        <input
                          type="checkbox"
                          checked={cfg.selected}
                          onChange={e =>
                            setMultiConfigs(prev => ({
                              ...prev,
                              [tb.tableName]: { ...prev[tb.tableName], selected: e.target.checked },
                            }))
                          }
                          className="rounded bg-slate-900 border-slate-700 text-indigo-600"
                        />
                        <div>
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-xs font-mono font-bold text-slate-100">{tb.tableName}</span>
                            <span className="px-1.5 py-0.5 rounded bg-slate-800 text-slate-300 text-[10px]">
                              {tb.rowCount.toLocaleString()} rows
                            </span>
                            <span className="px-1.5 py-0.5 rounded bg-indigo-950 text-indigo-300 text-[10px]">
                              Tier {tb.dependencyOrder ?? 3}
                            </span>
                            <span className="text-[10px] text-slate-400">
                              {mappedCount}/{tb.columns.length} cols mapped
                            </span>
                          </div>
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center gap-2">
                        <select
                          value={cfg.destinationTable}
                          onChange={e => handleMultiDestChange(tb.tableName, e.target.value)}
                          className="h-8 px-2 text-xs bg-slate-900 border border-slate-700 rounded-lg text-slate-200"
                        >
                          {KNOWN_DEST_TABLES.map(dt => (
                            <option key={dt} value={dt}>
                              &rarr; {dt}
                            </option>
                          ))}
                        </select>

                        <select
                          value={cfg.conflictMode}
                          onChange={e =>
                            setMultiConfigs(prev => ({
                              ...prev,
                              [tb.tableName]: { ...prev[tb.tableName], conflictMode: e.target.value as any },
                            }))
                          }
                          className="h-8 px-2 text-xs bg-slate-900 border border-slate-700 rounded-lg text-slate-200"
                        >
                          <option value="skip">Conflict: Skip</option>
                          <option value="update">Conflict: Update Existing</option>
                          <option value="replace">Conflict: Replace / Upsert</option>
                        </select>

                        <button
                          type="button"
                          onClick={() =>
                            setMultiConfigs(prev => ({
                              ...prev,
                              [tb.tableName]: { ...prev[tb.tableName], expanded: !prev[tb.tableName].expanded },
                            }))
                          }
                          className="px-2.5 h-8 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs text-slate-200 flex items-center gap-1"
                        >
                          <span>Mapping &amp; Preview</span>
                          {cfg.expanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                        </button>
                      </div>
                    </div>

                    {/* Dry-Run Estimate Row if available */}
                    {est && (
                      <div className="px-4 py-2 bg-amber-950/20 border-t border-slate-800 flex flex-wrap items-center gap-4 text-[11px]">
                        <span className="font-semibold text-amber-300">Dry-Run Estimate:</span>
                        <span className="text-emerald-400">+{est.estimatedInsert} insert</span>
                        <span className="text-sky-400">~{est.estimatedUpdate} update</span>
                        <span className="text-slate-400">{est.estimatedSkip} skip</span>
                        <span className={est.estimatedErrors > 0 ? 'text-rose-400 font-bold' : 'text-slate-400'}>
                          {est.estimatedErrors} validation errors
                        </span>
                        {est.requiredMissing?.length > 0 && (
                          <span className="text-rose-300">Missing required: {est.requiredMissing.join(', ')}</span>
                        )}
                      </div>
                    )}

                    {/* Expanded Column Mapping & Sample Rows */}
                    {cfg.expanded && (
                      <div className="p-4 border-t border-slate-800 space-y-3 bg-slate-900/50">
                        <div className="flex items-center justify-between">
                          <span className="text-[11px] font-bold text-slate-300 uppercase">Column Mapping ({tb.tableName} &rarr; {cfg.destinationTable})</span>
                          <div className="flex items-center gap-2 text-[11px]">
                            <span className="text-slate-400">Match Key:</span>
                            <select
                              value={cfg.matchKey}
                              onChange={e =>
                                setMultiConfigs(prev => ({
                                  ...prev,
                                  [tb.tableName]: { ...prev[tb.tableName], matchKey: e.target.value },
                                }))
                              }
                              className="h-7 px-2 bg-slate-950 border border-slate-700 rounded text-slate-200"
                            >
                              {cfg.destColumns.map(dc => (
                                <option key={dc.name} value={dc.name}>
                                  {dc.name}
                                </option>
                              ))}
                            </select>
                          </div>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-2 max-h-56 overflow-y-auto">
                          {tb.columns.map(sc => (
                            <div key={sc.name} className="flex items-center justify-between gap-2 p-2 rounded-lg bg-slate-950 border border-slate-800">
                              <span className="text-[11px] font-mono text-slate-300 truncate">{sc.name}</span>
                              <select
                                value={cfg.columnMapping[sc.name] || ''}
                                onChange={e =>
                                  setMultiConfigs(prev => ({
                                    ...prev,
                                    [tb.tableName]: {
                                      ...prev[tb.tableName],
                                      columnMapping: { ...prev[tb.tableName].columnMapping, [sc.name]: e.target.value },
                                    },
                                  }))
                                }
                                className="h-7 w-44 px-2 text-[11px] bg-slate-900 border border-slate-700 rounded text-slate-200"
                              >
                                <option value="">-- Ignore --</option>
                                {cfg.destColumns.map(dc => (
                                  <option key={dc.name} value={dc.name}>
                                    {dc.name} ({dc.type})
                                  </option>
                                ))}
                              </select>
                            </div>
                          ))}
                        </div>

                        {tb.preview.length > 0 && (
                          <div className="overflow-x-auto rounded-lg border border-slate-800 max-h-36">
                            <table className="w-full text-[10px] font-mono text-left">
                              <thead className="bg-slate-950 text-slate-400 border-b border-slate-800">
                                <tr>
                                  {tb.columns.map(c => (
                                    <th key={c.name} className="px-2 py-1.5">{c.name}</th>
                                  ))}
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-slate-800/60 text-slate-300">
                                {tb.preview.slice(0, 5).map((r, i) => (
                                  <tr key={i}>
                                    {tb.columns.map(c => (
                                      <td key={c.name} className="px-2 py-1 truncate max-w-[120px]">
                                        {r[c.name] !== null && r[c.name] !== undefined ? String(r[c.name]) : '-'}
                                      </td>
                                    ))}
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Multi-Table Execution Summary */}
            {multiResult && (
              <div className="p-4 rounded-xl bg-emerald-950/30 border border-emerald-800/70 space-y-3">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div className="flex items-center gap-2 text-emerald-300 font-bold text-sm">
                    <CheckCircle2 className="w-5 h-5 text-emerald-400" />
                    <span>Multi-Table SQLite Import Complete</span>
                  </div>
                  <div className="text-xs font-mono text-slate-200">
                    Inserted: <strong className="text-emerald-400">{multiResult.totals.inserted}</strong> | Updated:{' '}
                    <strong className="text-sky-400">{multiResult.totals.updated}</strong> | Skipped:{' '}
                    <strong>{multiResult.totals.skipped}</strong> | Errors:{' '}
                    <strong className="text-rose-400">{multiResult.totals.errors}</strong>
                    {multiResult.totals.ambiguousMissions > 0 && (
                      <span className="ml-2 text-amber-300">| Ambiguous Missions: {multiResult.totals.ambiguousMissions}</span>
                    )}
                  </div>
                </div>

                <div className="overflow-x-auto rounded-lg border border-slate-800">
                  <table className="w-full text-[11px] text-left">
                    <thead className="bg-slate-950 text-slate-400">
                      <tr>
                        <th className="px-3 py-2">Source Table</th>
                        <th className="px-3 py-2">Destination</th>
                        <th className="px-3 py-2">Status</th>
                        <th className="px-3 py-2">Inserted</th>
                        <th className="px-3 py-2">Updated</th>
                        <th className="px-3 py-2">Skipped</th>
                        <th className="px-3 py-2">Errors</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800 text-slate-300">
                      {multiResult.tableResults.map((tr: any) => (
                        <tr key={tr.sourceTable}>
                          <td className="px-3 py-1.5 font-mono">{tr.sourceTable}</td>
                          <td className="px-3 py-1.5 font-mono text-indigo-300">{tr.destinationTable}</td>
                          <td className="px-3 py-1.5">{tr.status}</td>
                          <td className="px-3 py-1.5 text-emerald-400 font-mono">{tr.inserted}</td>
                          <td className="px-3 py-1.5 text-sky-400 font-mono">{tr.updated}</td>
                          <td className="px-3 py-1.5 font-mono">{tr.skipped}</td>
                          <td className="px-3 py-1.5 text-rose-400 font-mono">{tr.errors}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}

        {/* LEGACY EXCEL / CSV WIZARD STEPS (2-7) */}
        {currentStep === 2 && inspection && inspection.type !== 'SQLITE' && (
          <div className="space-y-4">
            <h2 className="text-sm font-bold text-slate-200">{t('step2Sheet')}</h2>
            <p className="text-xs text-slate-400">
              File uploaded: <strong className="text-slate-200">{inspection.originalName}</strong> (
              {(inspection.size / 1024 / 1024).toFixed(2)} MB, Type: {inspection.type})
            </p>

            {inspection.type === 'EXCEL' && inspection.sheets && (
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                {inspection.sheets.map(sh => (
                  <button
                    key={sh.sheetName}
                    onClick={() => {
                      setSelectedSheetOrTable(sh.sheetName);
                      autoMap(sh.columns);
                    }}
                    className={`p-4 rounded-xl border text-start transition-all ${
                      selectedSheetOrTable === sh.sheetName
                        ? 'bg-indigo-600/20 border-indigo-500 text-white shadow-md'
                        : 'bg-slate-950/60 border-slate-800 text-slate-300 hover:bg-slate-800'
                    }`}
                  >
                    <div className="text-xs font-bold">{sh.sheetName}</div>
                    <div className="text-[11px] text-slate-400 mt-1">
                      {sh.rowCount.toLocaleString()} rows • {sh.columns.length} columns
                    </div>
                  </button>
                ))}
              </div>
            )}

            {inspection.type === 'CSV' && (
              <div className="p-4 rounded-xl bg-slate-950/60 border border-slate-800 text-xs text-slate-300">
                CSV dataset detected with <strong>{inspection.columns?.length || 0}</strong> columns.
              </div>
            )}

            <div className="flex justify-between pt-4 border-t border-slate-800">
              <button onClick={() => setCurrentStep(1)} className="px-4 py-2 text-xs font-medium rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300">
                Back
              </button>
              <button onClick={() => setCurrentStep(3)} className="flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white">
                <span>Continue</span>
                <ArrowRight className="w-4 h-4 rtl:rotate-180" />
              </button>
            </div>
          </div>
        )}

        {currentStep === 3 && inspection?.type !== 'SQLITE' && (
          <div className="space-y-4">
            <h2 className="text-sm font-bold text-slate-200">{t('step3Target')}</h2>
            <div className="space-y-2">
              <label className="text-xs text-slate-400 font-semibold uppercase">{t('selectDestinationTable')}</label>
              <select
                value={destinationTable}
                onChange={e => {
                  setDestinationTable(e.target.value);
                  setTimeout(() => autoMap(getSourceColumns()), 200);
                }}
                className="w-full h-10 px-3 text-xs bg-slate-950 border border-slate-800 rounded-lg text-slate-200 focus:outline-none focus:border-indigo-500"
              >
                {KNOWN_DEST_TABLES.map(dt => (
                  <option key={dt} value={dt}>
                    {dt}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex justify-between pt-4 border-t border-slate-800">
              <button onClick={() => setCurrentStep(2)} className="px-4 py-2 text-xs font-medium rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300">
                Back
              </button>
              <button
                onClick={() => {
                  autoMap(getSourceColumns());
                  setCurrentStep(4);
                }}
                className="flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white"
              >
                <span>Continue</span>
                <ArrowRight className="w-4 h-4 rtl:rotate-180" />
              </button>
            </div>
          </div>
        )}

        {currentStep === 4 && inspection?.type !== 'SQLITE' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-sm font-bold text-slate-200">{t('step4Mapping')}</h2>
                <p className="text-xs text-slate-400">Map fields from source file to destination columns.</p>
              </div>
              <button
                onClick={() => autoMap(getSourceColumns())}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-slate-800 hover:bg-slate-700 text-indigo-300 border border-slate-700"
              >
                <Sparkles className="w-3.5 h-3.5" />
                <span>{t('autoMapColumns')}</span>
              </button>
            </div>

            <div className="max-h-96 overflow-y-auto space-y-2 pr-1">
              {getSourceColumns().map(srcCol => (
                <div key={srcCol} className="flex items-center justify-between p-2.5 rounded-lg bg-slate-950/70 border border-slate-800 gap-4">
                  <div className="w-1/2">
                    <span className="text-xs font-mono font-medium text-slate-200">{srcCol}</span>
                  </div>
                  <div className="w-1/2">
                    <select
                      value={columnMapping[srcCol] || ''}
                      onChange={e => setColumnMapping({ ...columnMapping, [srcCol]: e.target.value })}
                      className="w-full h-8 px-2 text-xs bg-slate-900 border border-slate-700 rounded-lg text-slate-200"
                    >
                      <option value="">{t('ignoreColumn')}</option>
                      {destColumns.map(dc => (
                        <option key={dc.name} value={dc.name}>
                          {dc.name} ({dc.type})
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              ))}
            </div>

            <div className="flex justify-between pt-4 border-t border-slate-800">
              <button onClick={() => setCurrentStep(3)} className="px-4 py-2 text-xs font-medium rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300">
                Back
              </button>
              <button onClick={() => setCurrentStep(5)} className="flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white">
                <span>Continue</span>
                <ArrowRight className="w-4 h-4 rtl:rotate-180" />
              </button>
            </div>
          </div>
        )}

        {currentStep === 5 && inspection?.type !== 'SQLITE' && (
          <div className="space-y-4">
            <h2 className="text-sm font-bold text-slate-200 flex items-center gap-2">
              <Compass className="w-4 h-4 text-indigo-400" />
              <span>{t('step5Coords')}</span>
            </h2>
            <label className="flex items-center gap-2 text-xs text-slate-200 cursor-pointer">
              <input
                type="checkbox"
                checked={enableCoordParser}
                onChange={e => setEnableCoordParser(e.target.checked)}
                className="rounded bg-slate-950 border-slate-700 text-indigo-600"
              />
              <span className="font-semibold">Enable Advanced Coordinate Parsing for this dataset</span>
            </label>

            {enableCoordParser && (
              <div className="p-4 rounded-xl bg-slate-950/60 border border-slate-800 grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="text-[11px] font-semibold text-slate-400">Combined Coordinate Column</label>
                  <select
                    value={combinedCoordCol}
                    onChange={e => setCombinedCoordCol(e.target.value)}
                    className="w-full h-8 px-2 text-xs bg-slate-900 border border-slate-700 rounded-lg text-slate-200"
                  >
                    <option value="">-- None --</option>
                    {getSourceColumns().map(c => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-[11px] font-semibold text-slate-400">Coordinate Order</label>
                  <select
                    value={coordOrder}
                    onChange={e => setCoordOrder(e.target.value as any)}
                    className="w-full h-8 px-2 text-xs bg-slate-900 border border-slate-700 rounded-lg text-slate-200"
                  >
                    <option value="LAT_LNG">{t('orderLatLng')}</option>
                    <option value="LNG_LAT">{t('orderLngLat')}</option>
                  </select>
                </div>
                <div>
                  <label className="text-[11px] font-semibold text-slate-400">Target Latitude Column</label>
                  <select value={targetLatCol} onChange={e => setTargetLatCol(e.target.value)} className="w-full h-8 px-2 text-xs bg-slate-900 border border-slate-700 rounded-lg text-slate-200">
                    {destColumns.map(c => (<option key={c.name} value={c.name}>{c.name}</option>))}
                  </select>
                </div>
                <div>
                  <label className="text-[11px] font-semibold text-slate-400">Target Longitude Column</label>
                  <select value={targetLngCol} onChange={e => setTargetLngCol(e.target.value)} className="w-full h-8 px-2 text-xs bg-slate-900 border border-slate-700 rounded-lg text-slate-200">
                    {destColumns.map(c => (<option key={c.name} value={c.name}>{c.name}</option>))}
                  </select>
                </div>
              </div>
            )}

            <div className="flex justify-between pt-4 border-t border-slate-800">
              <button onClick={() => setCurrentStep(4)} className="px-4 py-2 text-xs font-medium rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300">
                Back
              </button>
              <button onClick={() => setCurrentStep(6)} className="flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white">
                <span>Continue</span>
                <ArrowRight className="w-4 h-4 rtl:rotate-180" />
              </button>
            </div>
          </div>
        )}

        {currentStep === 6 && inspection?.type !== 'SQLITE' && (
          <div className="space-y-4">
            <h2 className="text-sm font-bold text-slate-200">{t('step6Preview')}</h2>
            <div className="p-3.5 rounded-xl bg-slate-950/60 border border-slate-800 space-y-2">
              <label className="text-xs font-semibold text-slate-300 uppercase tracking-wider block">
                {t('duplicateStrategy')}
              </label>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                {[
                  { mode: 'INSERT_ONLY', label: t('strategyInsertOnly') },
                  { mode: 'UPDATE_EXISTING', label: t('strategyUpdateExisting') },
                  { mode: 'INSERT_OR_UPDATE', label: t('strategyInsertOrUpdate') },
                ].map(s => (
                  <button
                    key={s.mode}
                    type="button"
                    onClick={() => setImportMode(s.mode as any)}
                    className={`p-2.5 rounded-lg border text-xs font-medium text-start transition-colors ${
                      importMode === s.mode ? 'bg-indigo-600/20 border-indigo-500 text-white' : 'bg-slate-900 border-slate-800 text-slate-400 hover:bg-slate-800'
                    }`}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="overflow-x-auto rounded-lg border border-slate-800 max-h-64">
              <table className="w-full text-left rtl:text-right text-[11px] font-mono">
                <thead className="bg-slate-950 text-slate-400 border-b border-slate-800 sticky top-0">
                  <tr>
                    {getSourceColumns().map(c => (<th key={c} className="px-3 py-2">{c}</th>))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60 text-slate-300">
                  {getPreviewRows().map((row, idx) => (
                    <tr key={idx} className="hover:bg-slate-800/40">
                      {getSourceColumns().map(c => (
                        <td key={c} className="px-3 py-1.5 truncate max-w-[140px]">
                          {row[c] !== null && row[c] !== undefined ? String(row[c]) : '-'}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex justify-between pt-4 border-t border-slate-800">
              <button onClick={() => setCurrentStep(5)} className="px-4 py-2 text-xs font-medium rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300">
                Back
              </button>
              <button
                onClick={handleExecuteImport}
                disabled={importing}
                className="flex items-center gap-2 px-6 py-2.5 text-xs font-bold rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white disabled:opacity-50"
              >
                <CheckCircle2 className="w-4 h-4" />
                <span>{importing ? t('importingNotice') : t('startImport')}</span>
              </button>
            </div>
          </div>
        )}

        {currentStep === 7 && importResult && inspection?.type !== 'SQLITE' && (
          <div className="space-y-4">
            <div className="p-4 rounded-xl bg-emerald-950/40 border border-emerald-800 text-emerald-300 flex items-center gap-3">
              <CheckCircle2 className="w-8 h-8 text-emerald-400 shrink-0" />
              <div>
                <h3 className="text-sm font-bold">{t('importSuccess')}</h3>
                <p className="text-xs text-emerald-400/90 mt-0.5">All transactional rows processed and committed.</p>
              </div>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="p-3 bg-slate-950 border border-slate-800 rounded-xl">
                <span className="text-[10px] text-slate-400 uppercase font-semibold">{t('insertedCount')}</span>
                <span className="block text-xl font-bold text-emerald-400 mt-1">{importResult.inserted}</span>
              </div>
              <div className="p-3 bg-slate-950 border border-slate-800 rounded-xl">
                <span className="text-[10px] text-slate-400 uppercase font-semibold">{t('updatedCount')}</span>
                <span className="block text-xl font-bold text-sky-400 mt-1">{importResult.updated}</span>
              </div>
              <div className="p-3 bg-slate-950 border border-slate-800 rounded-xl">
                <span className="text-[10px] text-slate-400 uppercase font-semibold">{t('skippedCount')}</span>
                <span className="block text-xl font-bold text-slate-400 mt-1">{importResult.skipped}</span>
              </div>
              <div className="p-3 bg-slate-950 border border-slate-800 rounded-xl">
                <span className="text-[10px] text-slate-400 uppercase font-semibold">{t('errorsCount')}</span>
                <span className="block text-xl font-bold text-rose-400 mt-1">{importResult.errors}</span>
              </div>
            </div>
            <div className="flex justify-end pt-4 border-t border-slate-800">
              <button
                onClick={() => {
                  setCurrentStep(1);
                  setInspection(null);
                  setSelectedFile(null);
                  setImportResult(null);
                }}
                className="px-4 py-2 text-xs font-semibold rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white"
              >
                Import Another Dataset
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Previous Import History Table */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 shadow-sm space-y-3">
        <h2 className="text-xs font-bold text-slate-200 uppercase tracking-wider flex items-center gap-2">
          <Clock className="w-4 h-4 text-indigo-400" />
          <span>{t('recentImports')}</span>
        </h2>

        <div className="overflow-x-auto rounded-lg border border-slate-800">
          <table className="w-full text-left rtl:text-right text-xs">
            <thead className="bg-slate-950/60 text-slate-400 border-b border-slate-800 text-[11px] uppercase">
              <tr>
                <th className="px-4 py-2.5">Date</th>
                <th className="px-4 py-2.5">Filename</th>
                <th className="px-4 py-2.5">Destination Table</th>
                <th className="px-4 py-2.5">Inserted</th>
                <th className="px-4 py-2.5">Updated</th>
                <th className="px-4 py-2.5">Skipped</th>
                <th className="px-4 py-2.5">Errors</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 text-slate-300">
              {history.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-6 text-center text-slate-500">
                    No import history records found
                  </td>
                </tr>
              ) : (
                history.map((h, i) => (
                  <tr key={i} className="hover:bg-slate-800/40">
                    <td className="px-4 py-2.5 font-mono text-[11px]">{new Date(h.created_at).toLocaleString()}</td>
                    <td className="px-4 py-2.5 font-medium text-slate-200">{h.filename}</td>
                    <td className="px-4 py-2.5 font-mono text-indigo-400">{h.destination_table}</td>
                    <td className="px-4 py-2.5 text-emerald-400 font-mono">{h.inserted_count}</td>
                    <td className="px-4 py-2.5 text-sky-400 font-mono">{h.updated_count}</td>
                    <td className="px-4 py-2.5 font-mono text-slate-400">{h.skipped_count}</td>
                    <td className="px-4 py-2.5 text-rose-400 font-mono">{h.error_count}</td>
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
