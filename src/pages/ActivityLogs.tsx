import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Copy,
  Database,
  Download,
  Eye,
  FileSpreadsheet,
  FileText,
  Filter,
  History,
  RefreshCw,
  Search,
  SlidersHorizontal,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { useApp } from '../context/AppContext.js';
import { EmptyStateCard, ErrorRetryCard, TopProgressBar } from '../components/common/LoadingStates.js';

const FIELD_KEYS = Array.from({ length: 50 }, (_, i) => `field${i + 1}` as const);
type FieldKey = typeof FIELD_KEYS[number];

interface ActivityLogRow {
  id: string | number;
  lineNumber?: number | null;
  recordType?: string | null;
  originalRecord?: string | null;
  sourceFile?: string | null;
  importBatchId?: string | number | null;
  createdAt?: string | null;
  [key: string]: any;
}

interface BatchRow {
  id: string | number;
  filename: string;
  fileHash?: string;
  totalRecords: number;
  importedRecords: number;
  failedRecords: number;
  status: string;
  uploadedAt: string;
  uploadedBy?: string | null;
  progress?: any;
  errors?: Array<{ line: number; message: string; code?: string; originalRecord?: string; actualFieldCount?: number }>;
}

interface PreviewResult {
  filename: string;
  size: number;
  fileHash: string;
  totalRecords: number;
  validRecords: number;
  invalidRecords: number;
  exceededFieldLimitRecords: number;
  isDuplicate: boolean;
  duplicateBatch?: BatchRow | null;
  sampleRecords: Array<{ lineNumber: number; recordType: string | null; fields: Array<string | null>; originalRecord: string; exceededFieldLimit: boolean }>;
  errors: Array<{ line: number; message: string; code?: string; originalRecord?: string; actualFieldCount?: number }>;
  filePath?: string;
  originalName?: string;
}

const ALL_COLUMNS = [
  'id', 'lineNumber', 'recordType',
  ...FIELD_KEYS,
  'sourceFile', 'importBatchId', 'createdAt', 'originalRecord',
] as const;
type ColumnKey = typeof ALL_COLUMNS[number];

const DEFAULT_VISIBLE: ColumnKey[] = ['id', 'lineNumber', 'recordType', 'field1', 'field2', 'field3', 'sourceFile', 'createdAt'];

function isNullish(v: unknown) {
  return v === null || v === undefined;
}

function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes)) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDateTime(v: unknown) {
  if (!v) return null;
  const d = new Date(String(v));
  return Number.isNaN(d.getTime()) ? String(v) : d.toLocaleString();
}

function truncateText(value: string, max = 48) {
  if (value.length <= max) return value;
  return `${value.slice(0, max - 1)}…`;
}

export const ActivityLogs: React.FC = () => {
  const { t, language, apiFetch, addNotification } = useApp();
  const isAr = language === 'ar';

  const [activeTab, setActiveTab] = useState<'records' | 'import' | 'history'>('records');

  // Records/list state
  const [rows, setRows] = useState<ActivityLogRow[]>([]);
  const [rowsLoading, setRowsLoading] = useState(false);
  const [rowsError, setRowsError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [search, setSearch] = useState('');
  const [recordTypeFilter, setRecordTypeFilter] = useState('');
  const [sourceFileFilter, setSourceFileFilter] = useState('');
  const [lineNumberFilter, setLineNumberFilter] = useState('');
  const [sortBy, setSortBy] = useState<string>('id');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  const [visibleColumns, setVisibleColumns] = useState<ColumnKey[]>([...DEFAULT_VISIBLE]);
  const [showColumnMenu, setShowColumnMenu] = useState(false);
  const [selectedRecord, setSelectedRecord] = useState<ActivityLogRow | null>(null);

  // Stats
  const [stats, setStats] = useState<any | null>(null);
  const [statsLoading, setStatsLoading] = useState(false);
  const [statsError, setStatsError] = useState<string | null>(null);

  // Import
  const [file, setFile] = useState<File | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [confirmLoading, setConfirmLoading] = useState(false);
  const [forceDuplicate, setForceDuplicate] = useState(false);
  const [activeBatchId, setActiveBatchId] = useState<string | number | null>(null);
  const [activeBatch, setActiveBatch] = useState<BatchRow | null>(null);
  const pollRef = useRef<number | null>(null);

  // History
  const [batches, setBatches] = useState<BatchRow[]>([]);
  const [batchesLoading, setBatchesLoading] = useState(false);
  const [batchesError, setBatchesError] = useState<string | null>(null);
  const [undoingId, setUndoingId] = useState<string | number | null>(null);
  const [pendingUndo, setPendingUndo] = useState<BatchRow | null>(null);

  // Export
  const [exporting, setExporting] = useState<string | null>(null);
  const [showExportMenu, setShowExportMenu] = useState(false);
  const [exportSelected, setExportSelected] = useState<Set<string>>(new Set(ALL_COLUMNS as unknown as string[]));
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const columnLabel = useCallback((key: ColumnKey) => {
    const base: Record<string, string> = {
      id: t('activityLogsId'),
      lineNumber: t('activityLogsLineNumber'),
      recordType: t('activityLogsRecordType'),
      originalRecord: t('activityLogsOriginalRecord'),
      sourceFile: t('activityLogsSourceFile'),
      importBatchId: t('activityLogsBatchId'),
      createdAt: t('activityLogsCreatedAt'),
    };
    if (base[key]) return base[key];
    const m = /^field(\d+)$/.exec(key);
    if (m) return isAr ? `الحقل ${m[1]}` : `Field ${m[1]}`;
    return key;
  }, [isAr, t]);

  const buildQueryParams = useCallback((opts?: { forExport?: boolean }) => {
    const params = new URLSearchParams();
    if (!opts?.forExport) {
      params.set('page', String(page));
      params.set('pageSize', String(pageSize));
    }
    params.set('sortBy', sortBy);
    params.set('sortOrder', sortOrder);
    if (search.trim()) params.set('search', search.trim());
    if (recordTypeFilter.trim()) params.set('recordType', recordTypeFilter.trim());
    if (sourceFileFilter.trim()) params.set('sourceFile', sourceFileFilter.trim());
    if (lineNumberFilter.trim()) params.set('lineNumber', lineNumberFilter.trim());
    return params;
  }, [page, pageSize, sortBy, sortOrder, search, recordTypeFilter, sourceFileFilter, lineNumberFilter]);

  const fetchRows = useCallback(async () => {
    setRowsLoading(true);
    setRowsError(null);
    try {
      const res = await apiFetch(`/api/v1/activity-logs?${buildQueryParams().toString()}`);
      const json = await res.json().catch(() => null);
      if (!res.ok) throw new Error(json?.error || 'Failed to load activity logs');
      setRows(json?.data || []);
      setTotal(json?.pagination?.total || 0);
      setTotalPages(json?.pagination?.totalPages || 1);
    } catch (err: any) {
      setRowsError(err?.message || 'Failed to load activity logs');
    } finally {
      setRowsLoading(false);
    }
  }, [apiFetch, buildQueryParams]);

  const fetchStats = useCallback(async () => {
    setStatsLoading(true);
    setStatsError(null);
    try {
      const params = new URLSearchParams();
      if (search.trim()) params.set('search', search.trim());
      if (recordTypeFilter.trim()) params.set('recordType', recordTypeFilter.trim());
      if (sourceFileFilter.trim()) params.set('sourceFile', sourceFileFilter.trim());
      if (lineNumberFilter.trim()) params.set('lineNumber', lineNumberFilter.trim());
      const qs = params.toString();
      const res = await apiFetch(`/api/v1/activity-logs/statistics${qs ? `?${qs}` : ''}`);
      const json = await res.json().catch(() => null);
      if (!res.ok) throw new Error(json?.error || 'Failed to load statistics');
      setStats(json);
    } catch (err: any) {
      setStatsError(err?.message || 'Failed to load statistics');
    } finally {
      setStatsLoading(false);
    }
  }, [apiFetch, search, recordTypeFilter, sourceFileFilter, lineNumberFilter]);

  const fetchBatches = useCallback(async () => {
    setBatchesLoading(true);
    setBatchesError(null);
    try {
      const res = await apiFetch('/api/v1/activity-logs/imports');
      const json = await res.json().catch(() => null);
      if (!res.ok) throw new Error(json?.error || 'Failed to load import history');
      setBatches(Array.isArray(json) ? json : []);
    } catch (err: any) {
      setBatchesError(err?.message || 'Failed to load import history');
    } finally {
      setBatchesLoading(false);
    }
  }, [apiFetch]);

  useEffect(() => { fetchRows(); }, [fetchRows]);
  useEffect(() => { fetchStats(); }, [fetchStats]);
  useEffect(() => { fetchBatches(); }, [fetchBatches]);

  useEffect(() => {
    if (!activeBatchId) return;
    let cancelled = false;
    const poll = async () => {
      try {
        const res = await apiFetch(`/api/v1/activity-logs/imports/${activeBatchId}`);
        const json = await res.json().catch(() => null);
        if (!res.ok || cancelled) return;
        setActiveBatch(json);
        const st = String(json?.status || '').toUpperCase();
        if (['COMPLETED', 'COMPLETED_WITH_ERRORS', 'FAILED', 'UNDONE'].includes(st)) {
          if (pollRef.current) { window.clearInterval(pollRef.current); pollRef.current = null; }
          fetchRows(); fetchStats(); fetchBatches();
          if (st === 'COMPLETED') addNotification({ title: t('activityLogsImportCompleted'), message: `${json.importedRecords}/${json.totalRecords}`, type: 'success' });
          else if (st === 'COMPLETED_WITH_ERRORS') addNotification({ title: t('activityLogsImportCompletedWithErrors'), message: `${json.importedRecords}/${json.totalRecords}, ${json.failedRecords} ${t('activityLogsFailedCount')}`, type: 'warning' });
          else if (st === 'FAILED') addNotification({ title: t('activityLogsImportFailed'), message: json.filename, type: 'error' });
        }
      } catch {
        // ignore transient poll errors
      }
    };
    poll();
    pollRef.current = window.setInterval(poll, 1500);
    return () => {
      cancelled = true;
      if (pollRef.current) window.clearInterval(pollRef.current);
      pollRef.current = null;
    };
  }, [activeBatchId, apiFetch, fetchRows, fetchStats, fetchBatches, addNotification, t]);

  const onFileSelected = (f: File | null) => {
    setFile(f);
    setPreview(null);
    setPreviewError(null);
    setForceDuplicate(false);
  };

  const handlePreview = async () => {
    if (!file) return;
    if (file.size > 100 * 1024 * 1024) {
      setPreviewError('File exceeds maximum allowed size (100 MB).');
      return;
    }
    const ext = file.name.toLowerCase();
    if (!ext.endsWith('.log') && !ext.endsWith('.txt')) {
      setPreviewError('Only .log and .txt files are supported.');
      return;
    }
    setPreviewLoading(true);
    setPreviewError(null);
    try {
      const form = new FormData();
      form.append('file', file);
      const res = await apiFetch('/api/v1/activity-logs/import/preview', { method: 'POST', body: form });
      const json = await res.json().catch(() => null);
      if (!res.ok) throw new Error(json?.error || 'Failed to preview file');
      setPreview(json);
      setForceDuplicate(false);
    } catch (err: any) {
      setPreviewError(err?.message || 'Failed to preview file');
    } finally {
      setPreviewLoading(false);
    }
  };

  const handleConfirmImport = async () => {
    if (!preview?.filePath) return;
    setConfirmLoading(true);
    try {
      const res = await apiFetch('/api/v1/activity-logs/import/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filePath: preview.filePath, originalName: preview.originalName || preview.filename, forceDuplicate }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) throw new Error(json?.error || t('activityLogsImportFailed'));
      setActiveBatchId(json.batchId);
      setActiveBatch({ id: json.batchId, filename: preview.filename, totalRecords: preview.totalRecords, importedRecords: 0, failedRecords: 0, status: 'PROCESSING', uploadedAt: new Date().toISOString() } as any);
      addNotification({ title: t('activityLogsImportStarted'), message: `#${json.batchId}`, type: 'info' });
      setActiveTab('import');
    } catch (err: any) {
      addNotification({ title: t('activityLogsImportFailed'), message: err?.message || 'Import failed', type: 'error' });
    } finally {
      setConfirmLoading(false);
    }
  };

  const handleUndo = async () => {
    if (!pendingUndo) return;
    setUndoingId(pendingUndo.id);
    try {
      const res = await apiFetch(`/api/v1/activity-logs/imports/${pendingUndo.id}`, { method: 'DELETE' });
      const json = await res.json().catch(() => null);
      if (!res.ok) throw new Error(json?.error || t('activityLogsUndoFailed'));
      addNotification({ title: t('activityLogsUndoSuccess'), message: `${pendingUndo.filename} (${json.deletedRecords ?? 0})`, type: 'success' });
      setPendingUndo(null);
      fetchBatches(); fetchStats(); fetchRows();
    } catch (err: any) {
      addNotification({ title: t('activityLogsUndoFailed'), message: err?.message || 'Undo failed', type: 'error' });
    } finally {
      setUndoingId(null);
    }
  };

  const handleExport = async (format: 'csv' | 'xlsx' | 'pdf') => {
    try {
      setExporting(format);
      const params = buildQueryParams({ forExport: true });
      params.set('format', format);
      params.set('lang', language);
      const cols = Array.from(exportSelected);
      if (cols.length > 0 && cols.length < ALL_COLUMNS.length) params.set('columns', cols.join(','));
      const res = await apiFetch(`/api/v1/activity-logs/export?${params.toString()}`);
      if (!res.ok) {
        const json = await res.json().catch(() => null);
        throw new Error(json?.error || t('activityLogsExportFailed'));
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = res.headers.get('X-Export-Filename') || `activity_logs_export.${format}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setShowExportMenu(false);
    } catch (err: any) {
      addNotification({ title: t('activityLogsExportFailed'), message: err?.message || 'Export failed', type: 'error' });
    } finally {
      setExporting(null);
    }
  };

  const downloadErrorReport = async (batchId: string | number) => {
    try {
      const res = await apiFetch(`/api/v1/activity-logs/imports/${batchId}/errors`);
      if (!res.ok) {
        const json = await res.json().catch(() => null);
        throw new Error(json?.error || 'Failed to download error report');
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = res.headers.get('X-Export-Filename') || `activity_logs_import_errors_batch_${batchId}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err: any) {
      addNotification({ title: t('loadErrorTitle'), message: err?.message || 'Download failed', type: 'error' });
    }
  };

  const toggleSort = (field: string) => {
    if (sortBy === field) setSortOrder((o) => (o === 'asc' ? 'desc' : 'asc'));
    else { setSortBy(field); setSortOrder(field === 'id' ? 'desc' : 'asc'); }
    setPage(1);
  };

  const copyText = async (text: string, key: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(key);
      window.setTimeout(() => setCopiedKey((k) => (k === key ? null : k)), 1200);
    } catch {
      // ignore
    }
  };

  const NullCell = () => <span className="italic text-slate-500 text-[10px]">{t('activityLogsNull')}</span>;

  const renderCellValue = (row: ActivityLogRow, col: ColumnKey) => {
    const v = (row as any)[col];
    if (isNullish(v)) return <NullCell />;
    const str = String(v);
    const long = str.length > 60 || col === 'originalRecord';
    const display = col === 'originalRecord' || str.length > 48 ? truncateText(str, col === 'originalRecord' ? 60 : 48) : str;
    return (
      <div className="flex items-center gap-1.5 min-w-0">
        <span className="truncate font-mono text-[11px]" title={str}>{display}</span>
        {long && (
          <>
            <button type="button" onClick={() => copyText(str, `${row.id}-${col}`)} className="p-0.5 text-slate-500 hover:text-indigo-400 shrink-0" title={t('activityLogsCopy')}>
              {copiedKey === `${row.id}-${col}` ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
            </button>
            <button type="button" onClick={() => setSelectedRecord(row)} className="p-0.5 text-slate-500 hover:text-indigo-400 shrink-0" title={t('activityLogsViewFull')}>
              <Eye className="w-3.5 h-3.5" />
            </button>
          </>
        )}
      </div>
    );
  };

  const visibleCols = useMemo(() => ALL_COLUMNS.filter((c) => visibleColumns.includes(c)), [visibleColumns]);
  const progressPct = activeBatch?.totalRecords ? Math.min(100, Math.round(((Number(activeBatch.importedRecords || 0) + Number(activeBatch.failedRecords || 0)) / Number(activeBatch.totalRecords || 1)) * 100)) : 0;

  const StatCard = ({ label, value }: { label: string; value: any }) => (
    <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
      <div className="text-[11px] uppercase tracking-wide text-slate-400">{label}</div>
      <div className="mt-1 text-xl font-bold text-slate-100 tabular-nums">{Number(value || 0).toLocaleString()}</div>
    </div>
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-100 flex items-center gap-2">
            <Database className="w-5 h-5 text-indigo-400" />
            <span>{t('activityLogsTitle')}</span>
          </h1>
          <p className="text-xs text-slate-400 mt-0.5">{t('activityLogsDescription')}</p>
        </div>
        <button type="button" onClick={() => { fetchStats(); fetchRows(); fetchBatches(); }} className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border border-slate-700 text-slate-300 hover:bg-slate-800 self-start">
          <RefreshCw className={`w-3.5 h-3.5 ${rowsLoading || statsLoading ? 'animate-spin' : ''}`} />
          {t('activityLogsRefresh')}
        </button>
      </div>

      <div className="space-y-3">
        {statsError && <ErrorRetryCard compact message={statsError} onRetry={fetchStats} />}
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3">
          <StatCard label={t('activityLogsStatsTotal')} value={stats?.totalActivityLogsRecords} />
          <StatCard label={t('activityLogsStatsUniqueRecordTypes')} value={stats?.uniqueRecordTypes} />
          <StatCard label={t('activityLogsStatsImportedSourceFiles')} value={stats?.importedSourceFiles} />
          <StatCard label={t('activityLogsStatsImportBatches')} value={stats?.importBatches} />
          <StatCard label={t('activityLogsStatsFailedImportRecords')} value={stats?.failedImportRecords} />
        </div>
        <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
          <div className="text-sm font-semibold text-slate-100 mb-3">{t('activityLogsRecordTypeBreakdown')}</div>
          {Array.isArray(stats?.recordTypeBreakdown) && stats.recordTypeBreakdown.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-xs text-left rtl:text-right">
                <thead>
                  <tr className="text-slate-400 border-b border-slate-800">
                    <th className="py-2 pr-3">{t('activityLogsBreakdownType')}</th>
                    <th className="py-2 pr-3">{t('activityLogsBreakdownCount')}</th>
                    <th className="py-2">{t('activityLogsBreakdownPercentage')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60">
                  {stats.recordTypeBreakdown.map((r: any, i: number) => (
                    <tr key={`${r.recordType ?? 'null'}-${i}`}>
                      <td className="py-2 pr-3 text-slate-200 font-mono">{isNullish(r.recordType) ? <NullCell /> : String(r.recordType)}</td>
                      <td className="py-2 pr-3 text-slate-200 tabular-nums">{Number(r.count || 0).toLocaleString()}</td>
                      <td className="py-2 text-slate-300 tabular-nums">{Number(r.percentage || 0).toFixed(2)}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="text-xs text-slate-500">{t('noChartData')}</div>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2 border-b border-slate-800">
        {([
          { id: 'records', label: t('activityLogsRecords'), icon: FileSpreadsheet },
          { id: 'import', label: t('activityLogsImport'), icon: Upload },
          { id: 'history', label: t('activityLogsHistory'), icon: History },
        ] as const).map(tab => {
          const Icon = tab.icon;
          const active = activeTab === tab.id;
          return (
            <button key={tab.id} type="button" onClick={() => setActiveTab(tab.id)} className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium border-b-2 transition-colors ${active ? 'border-indigo-500 text-indigo-300' : 'border-transparent text-slate-400 hover:text-slate-200'}`}>
              <Icon className="w-4 h-4" /> {tab.label}
            </button>
          );
        })}
      </div>

      {activeTab === 'records' && (
        <div className="space-y-4">
          <div className="flex flex-col lg:flex-row gap-3 lg:items-end lg:justify-between bg-slate-900/70 border border-slate-800 rounded-xl p-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2 flex-1">
              <div className="relative sm:col-span-2">
                <Search className="absolute left-2.5 top-2.5 w-4 h-4 text-slate-500 rtl:right-2.5 rtl:left-auto" />
                <input value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} placeholder={t('activityLogsSearchPlaceholder')} className="w-full h-9 pl-9 pr-3 rtl:pr-9 rtl:pl-3 text-xs bg-slate-950 border border-slate-800 rounded-lg text-slate-200" />
              </div>
              <div>
                <label className="block text-[10px] text-slate-400 mb-1">{t('activityLogsFilterRecordType')}</label>
                <input value={recordTypeFilter} onChange={e => setRecordTypeFilter(e.target.value)} className="w-full h-9 px-2.5 text-xs bg-slate-950 border border-slate-800 rounded-lg text-slate-200" />
              </div>
              <div>
                <label className="block text-[10px] text-slate-400 mb-1">{t('activityLogsFilterSourceFile')}</label>
                <input value={sourceFileFilter} onChange={e => setSourceFileFilter(e.target.value)} className="w-full h-9 px-2.5 text-xs bg-slate-950 border border-slate-800 rounded-lg text-slate-200" />
              </div>
              <div>
                <label className="block text-[10px] text-slate-400 mb-1">{t('activityLogsFilterLineNumber')}</label>
                <input value={lineNumberFilter} onChange={e => setLineNumberFilter(e.target.value)} inputMode="numeric" className="w-full h-9 px-2.5 text-xs bg-slate-950 border border-slate-800 rounded-lg text-slate-200" />
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" onClick={() => { setPage(1); fetchRows(); fetchStats(); }} className="h-9 px-3 text-xs rounded-lg border border-slate-700 text-slate-300 hover:bg-slate-800 flex items-center gap-1.5"><Filter className="w-3.5 h-3.5" />{t('activityLogsApplyFilters')}</button>
              <button type="button" onClick={() => { setSearch(''); setRecordTypeFilter(''); setSourceFileFilter(''); setLineNumberFilter(''); setPage(1); setTimeout(() => { fetchRows(); fetchStats(); }, 0); }} className="h-9 px-3 text-xs rounded-lg border border-slate-700 text-slate-300 hover:bg-slate-800">{t('activityLogsClearFilters')}</button>
              <div className="relative">
                <button type="button" onClick={() => setShowColumnMenu(v => !v)} className="h-9 px-3 text-xs rounded-lg border border-slate-700 text-slate-300 hover:bg-slate-800 flex items-center gap-1.5"><SlidersHorizontal className="w-3.5 h-3.5" />{t('activityLogsColumnVisibility')}</button>
                {showColumnMenu && (
                  <div className="absolute right-0 rtl:left-0 rtl:right-auto mt-2 w-72 max-h-80 overflow-y-auto bg-slate-900 border border-slate-800 rounded-xl shadow-xl p-2 z-30">
                    <div className="flex items-center justify-between mb-2 px-1">
                      <button type="button" onClick={() => setVisibleColumns([...ALL_COLUMNS])} className="text-[11px] text-indigo-400 hover:text-indigo-300">{t('activityLogsShowAllColumns')}</button>
                      <button type="button" onClick={() => setVisibleColumns([...DEFAULT_VISIBLE])} className="text-[11px] text-slate-400 hover:text-slate-200">{t('activityLogsResetColumns')}</button>
                    </div>
                    {ALL_COLUMNS.map(c => (
                      <label key={c} className="flex items-center gap-2 px-1.5 py-1 text-xs text-slate-300 hover:bg-slate-800 rounded cursor-pointer">
                        <input type="checkbox" checked={visibleColumns.includes(c)} onChange={() => setVisibleColumns(prev => prev.includes(c) ? (prev.length > 1 ? prev.filter(x => x !== c) : prev) : [...prev, c])} className="rounded bg-slate-950 border-slate-700 text-indigo-600 focus:ring-0" />
                        <span className="truncate" title={columnLabel(c)}>{columnLabel(c)}</span>
                      </label>
                    ))}
                  </div>
                )}
              </div>
              <div className="relative">
                <button type="button" onClick={() => setShowExportMenu(v => !v)} className="h-9 px-3 text-xs rounded-lg border border-slate-700 text-slate-300 hover:bg-slate-800 flex items-center gap-1.5"><Download className="w-3.5 h-3.5" />{t('activityLogsExport')}</button>
                {showExportMenu && (
                  <div className="absolute right-0 rtl:left-0 rtl:right-auto mt-2 w-80 bg-slate-900 border border-slate-800 rounded-xl shadow-xl p-3 z-30 space-y-3">
                    <div className="text-xs font-semibold text-slate-200">{t('activityLogsExportColumns')}</div>
                    <div className="max-h-44 overflow-y-auto space-y-1 pr-1">
                      {ALL_COLUMNS.map(c => (
                        <label key={c} className="flex items-center gap-2 text-xs text-slate-300">
                          <input type="checkbox" checked={exportSelected.has(c)} onChange={() => setExportSelected(prev => { const n = new Set(prev); if (n.has(c)) n.delete(c); else n.add(c); return n; })} className="rounded bg-slate-950 border-slate-700 text-indigo-600 focus:ring-0" />
                          <span className="truncate">{columnLabel(c)}</span>
                        </label>
                      ))}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button type="button" disabled={!!exporting || exportSelected.size === 0} onClick={() => handleExport('csv')} className="px-2.5 py-1.5 text-xs rounded border border-slate-700 hover:bg-slate-800 disabled:opacity-50">{exporting === 'csv' ? '...' : t('activityLogsExportCsv')}</button>
                      <button type="button" disabled={!!exporting || exportSelected.size === 0} onClick={() => handleExport('xlsx')} className="px-2.5 py-1.5 text-xs rounded border border-slate-700 hover:bg-slate-800 disabled:opacity-50">{exporting === 'xlsx' ? '...' : t('activityLogsExportExcel')}</button>
                      <button type="button" disabled={!!exporting || exportSelected.size === 0} onClick={() => handleExport('pdf')} className="px-2.5 py-1.5 text-xs rounded border border-slate-700 hover:bg-slate-800 disabled:opacity-50">{exporting === 'pdf' ? '...' : t('activityLogsExportPdf')}</button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          {rowsError && <ErrorRetryCard compact message={rowsError} onRetry={fetchRows} />}

          <div className="rounded-xl border border-slate-800 bg-slate-900/50 overflow-hidden">
            <TopProgressBar active={rowsLoading} />
            <div className="overflow-x-auto">
              <table className="w-full text-left rtl:text-right border-collapse min-w-[980px]">
                <thead>
                  <tr className="border-b border-slate-800 bg-slate-950/60 text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
                    {visibleCols.map(col => (
                      <th key={col} onClick={() => toggleSort(col)} className="px-3 py-2 cursor-pointer hover:bg-slate-800/40 select-none whitespace-nowrap" title={columnLabel(col)}>
                        <div className="flex items-center gap-1.5">
                          <span>{columnLabel(col)}</span>
                          {sortBy === col ? (sortOrder === 'asc' ? <ArrowUp className="w-3 h-3 text-indigo-400" /> : <ArrowDown className="w-3 h-3 text-indigo-400" />) : <ArrowUpDown className="w-3 h-3 text-slate-600" />}
                        </div>
                      </th>
                    ))}
                    <th className="px-3 py-2 w-20 text-center">{t('activityLogsActions')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60 text-xs text-slate-300">
                  {rowsLoading && rows.length === 0 ? (
                    Array.from({ length: 8 }).map((_, i) => (
                      <tr key={i}><td colSpan={visibleCols.length + 1} className="px-4 py-3"><div className="h-4 bg-slate-800 rounded animate-pulse" /></td></tr>
                    ))
                  ) : rows.length === 0 ? (
                    <tr>
                      <td colSpan={visibleCols.length + 1} className="p-6">
                        <EmptyStateCard title={t('activityLogsNoRecords')} description={t('activityLogsNoRecordsHint')} />
                      </td>
                    </tr>
                  ) : rows.map(row => (
                    <tr key={String(row.id)} className="hover:bg-slate-800/30">
                      {visibleCols.map(col => (
                        <td key={col} className="px-3 py-2 align-top max-w-[320px]">
                          {col === 'createdAt'
                            ? (isNullish(row.createdAt) ? <NullCell /> : <span className="font-mono text-[11px] whitespace-nowrap">{String(formatDateTime(row.createdAt))}</span>)
                            : renderCellValue(row, col)}
                        </td>
                      ))}
                      <td className="px-3 py-2 text-center align-top">
                        <button type="button" onClick={() => setSelectedRecord(row)} className="p-1 text-slate-400 hover:text-indigo-400" title={t('activityLogsDetails')}><Eye className="w-4 h-4" /></button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-slate-400">
            <div className="tabular-nums">{t('showing')} <strong className="text-slate-200">{rows.length}</strong> {t('of')} <strong className="text-slate-200">{total.toLocaleString()}</strong> {t('activityLogsRecordCount')}</div>
            <div className="flex items-center gap-2">
              <span>{t('activityLogsPageSize')}:</span>
              <select value={pageSize} onChange={e => { setPageSize(Number(e.target.value)); setPage(1); }} className="h-8 px-2 bg-slate-900 border border-slate-800 rounded text-slate-200">
                {[10,25,50,100,200].map(n => <option key={n} value={n}>{n}</option>)}
              </select>
              <button type="button" onClick={() => setPage(1)} disabled={page <= 1} className="p-1.5 rounded border border-slate-800 hover:bg-slate-800 disabled:opacity-40"><ChevronsLeft className="w-4 h-4 rtl:rotate-180" /></button>
              <button type="button" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1} className="p-1.5 rounded border border-slate-800 hover:bg-slate-800 disabled:opacity-40"><ChevronLeft className="w-4 h-4 rtl:rotate-180" /></button>
              <span className="tabular-nums">{page} / {totalPages}</span>
              <button type="button" onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page >= totalPages} className="p-1.5 rounded border border-slate-800 hover:bg-slate-800 disabled:opacity-40"><ChevronRight className="w-4 h-4 rtl:rotate-180" /></button>
              <button type="button" onClick={() => setPage(totalPages)} disabled={page >= totalPages} className="p-1.5 rounded border border-slate-800 hover:bg-slate-800 disabled:opacity-40"><ChevronsRight className="w-4 h-4 rtl:rotate-180" /></button>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'import' && (
        <div className="space-y-4">
          <div className="bg-slate-900/70 border border-slate-800 rounded-xl p-4 space-y-4">
            <div
              onDragOver={e => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={e => { e.preventDefault(); setDragOver(false); const f = e.dataTransfer.files?.[0]; if (f) onFileSelected(f); }}
              className={`border-2 border-dashed rounded-xl p-6 text-center transition-colors ${dragOver ? 'border-indigo-500 bg-indigo-500/5' : 'border-slate-700 bg-slate-950/40'}`}
            >
              <Upload className="w-8 h-8 mx-auto text-slate-400 mb-2" />
              <div className="text-sm text-slate-200 font-medium">{t('activityLogsSelectFile')}</div>
              <div className="text-xs text-slate-400 mt-1">{t('activityLogsFileHint')}</div>
              <div className="mt-3 flex items-center justify-center gap-2 flex-wrap">
                <label className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 cursor-pointer">
                  <FileText className="w-3.5 h-3.5" />
                  <span>Browse</span>
                  <input type="file" accept=".log,.txt,text/plain" className="hidden" onChange={e => onFileSelected(e.target.files?.[0] || null)} />
                </label>
                {file && <span className="text-xs text-slate-300 truncate max-w-xs" title={file.name}>{file.name} ({formatBytes(file.size)})</span>}
              </div>
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              <button type="button" onClick={handlePreview} disabled={!file || previewLoading} className="px-4 py-2 text-xs font-semibold rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white flex items-center gap-1.5">
                {previewLoading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Eye className="w-4 h-4" />}
                {previewLoading ? t('activityLogsPreviewing') : t('activityLogsPreviewAction')}
              </button>
              {preview && (
                <button type="button" onClick={() => { setPreview(null); setPreviewError(null); setForceDuplicate(false); }} className="px-3 py-2 text-xs rounded-lg border border-slate-700 text-slate-300 hover:bg-slate-800">{t('activityLogsCancelPreview')}</button>
              )}
            </div>

            {previewError && <ErrorRetryCard compact message={previewError} onRetry={handlePreview} />}

            {preview && (
              <div className="space-y-4 border-t border-slate-800 pt-4">
                <h3 className="text-sm font-semibold text-slate-100 flex items-center gap-2"><FileSpreadsheet className="w-4 h-4 text-indigo-400" />{t('activityLogsPreviewTitle')}</h3>

                {preview.isDuplicate && (
                  <div className="rounded-lg border border-amber-700/60 bg-amber-950/20 p-3 text-xs text-amber-200 space-y-2">
                    <div className="flex items-center gap-2 font-semibold"><AlertTriangle className="w-4 h-4" />{t('activityLogsDuplicateWarning')}</div>
                    <div>{t('activityLogsDuplicateMessage')}</div>
                    {preview.duplicateBatch && <div className="text-amber-300/90">#{String(preview.duplicateBatch.id)} — {preview.duplicateBatch.filename} ({String(preview.duplicateBatch.status)})</div>}
                    <label className="inline-flex items-center gap-2 cursor-pointer">
                      <input type="checkbox" checked={forceDuplicate} onChange={e => setForceDuplicate(e.target.checked)} className="rounded bg-slate-950 border-slate-700 text-indigo-600 focus:ring-0" />
                      <span>{t('activityLogsForceDuplicate')}</span>
                    </label>
                  </div>
                )}

                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2 text-xs">
                  <div className="rounded-lg border border-slate-800 bg-slate-950/50 p-2.5"><div className="text-slate-400">{t('activityLogsFilename')}</div><div className="text-slate-100 font-medium truncate" title={preview.filename}>{preview.filename}</div></div>
                  <div className="rounded-lg border border-slate-800 bg-slate-950/50 p-2.5"><div className="text-slate-400">{t('activityLogsFileSize')}</div><div className="text-slate-100 font-medium">{formatBytes(preview.size || 0)}</div></div>
                  <div className="rounded-lg border border-slate-800 bg-slate-950/50 p-2.5"><div className="text-slate-400">{t('activityLogsTotalRecords')}</div><div className="text-slate-100 font-medium">{Number(preview.totalRecords || 0).toLocaleString()}</div></div>
                  <div className="rounded-lg border border-slate-800 bg-slate-950/50 p-2.5"><div className="text-slate-400">{t('activityLogsValidRecords')}</div><div className="text-emerald-300 font-medium">{Number(preview.validRecords || 0).toLocaleString()}</div></div>
                  <div className="rounded-lg border border-slate-800 bg-slate-950/50 p-2.5"><div className="text-slate-400">{t('activityLogsInvalidRecords')}</div><div className="text-rose-300 font-medium">{Number(preview.invalidRecords || 0).toLocaleString()}</div></div>
                  <div className="rounded-lg border border-slate-800 bg-slate-950/50 p-2.5"><div className="text-slate-400">{t('activityLogsExceededFields')}</div><div className="text-amber-300 font-medium">{Number(preview.exceededFieldLimitRecords || 0).toLocaleString()}</div></div>
                </div>
                <div className="text-[11px] text-slate-400 font-mono break-all"><span className="text-slate-500">{t('activityLogsFileHash')}: </span>{preview.fileHash}</div>

                <div>
                  <div className="text-xs font-semibold text-slate-200 mb-2">{t('activityLogsSampleRecords')}</div>
                  <div className="overflow-x-auto rounded-lg border border-slate-800">
                    <table className="w-full text-[11px]">
                      <thead className="bg-slate-950/60 text-slate-400">
                        <tr>
                          <th className="px-2 py-1.5 text-left rtl:text-right">{t('activityLogsLineNumber')}</th>
                          <th className="px-2 py-1.5 text-left rtl:text-right">{t('activityLogsRecordType')}</th>
                          <th className="px-2 py-1.5 text-left rtl:text-right">{columnLabel('field1')}</th>
                          <th className="px-2 py-1.5 text-left rtl:text-right">{columnLabel('field2')}</th>
                          <th className="px-2 py-1.5 text-left rtl:text-right">{columnLabel('field3')}</th>
                          <th className="px-2 py-1.5 text-left rtl:text-right">{t('activityLogsOriginalRecord')}</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800/60 text-slate-300">
                        {(preview.sampleRecords || []).map((s, idx) => (
                          <tr key={idx}>
                            <td className="px-2 py-1.5 font-mono">{s.lineNumber}</td>
                            <td className="px-2 py-1.5 font-mono">{isNullish(s.recordType) ? <NullCell /> : String(s.recordType)}</td>
                            <td className="px-2 py-1.5 font-mono max-w-[140px] truncate" title={s.fields?.[0] ?? ''}>{isNullish(s.fields?.[0]) ? <NullCell /> : String(s.fields?.[0])}</td>
                            <td className="px-2 py-1.5 font-mono max-w-[140px] truncate" title={s.fields?.[1] ?? ''}>{isNullish(s.fields?.[1]) ? <NullCell /> : String(s.fields?.[1])}</td>
                            <td className="px-2 py-1.5 font-mono max-w-[140px] truncate" title={s.fields?.[2] ?? ''}>{isNullish(s.fields?.[2]) ? <NullCell /> : String(s.fields?.[2])}</td>
                            <td className="px-2 py-1.5 font-mono max-w-[260px] truncate" title={s.originalRecord}>{s.originalRecord}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                <div>
                  <div className="flex items-center justify-between mb-2">
                    <div className="text-xs font-semibold text-slate-200">{t('activityLogsValidationErrors')}</div>
                    {(preview.errors || []).length > 0 && <span className="text-[11px] text-rose-300">{preview.errors.length.toLocaleString()}</span>}
                  </div>
                  {(preview.errors || []).length === 0 ? (
                    <div className="text-xs text-emerald-300 flex items-center gap-1.5"><CheckCircle2 className="w-4 h-4" />{t('activityLogsNoErrors')}</div>
                  ) : (
                    <div className="max-h-56 overflow-auto rounded-lg border border-rose-900/40 bg-rose-950/10">
                      <table className="w-full text-[11px]">
                        <thead className="bg-slate-950/50 text-slate-400 sticky top-0">
                          <tr>
                            <th className="px-2 py-1.5 text-left rtl:text-right">{t('activityLogsErrorsLine')}</th>
                            <th className="px-2 py-1.5 text-left rtl:text-right">Code</th>
                            <th className="px-2 py-1.5 text-left rtl:text-right">{t('activityLogsErrorsMessage')}</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-800/60 text-slate-300">
                          {preview.errors.slice(0, 100).map((e, idx) => (
                            <tr key={idx}>
                              <td className="px-2 py-1.5 font-mono text-rose-300">{e.line}</td>
                              <td className="px-2 py-1.5 font-mono">{e.code || ''}</td>
                              <td className="px-2 py-1.5">{e.message}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>

                <div className="flex items-center gap-2 pt-1 flex-wrap">
                  <button type="button" onClick={handleConfirmImport} disabled={confirmLoading || (preview.isDuplicate && !forceDuplicate)} className="px-4 py-2 text-xs font-semibold rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white flex items-center gap-1.5">
                    {confirmLoading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                    {confirmLoading ? t('activityLogsConfirming') : t('activityLogsConfirmImport')}
                  </button>
                  {preview.isDuplicate && !forceDuplicate && <span className="text-xs text-amber-300">{t('activityLogsDuplicateMessage')}</span>}
                </div>
              </div>
            )}
          </div>

          {activeBatch && (
            <div className="bg-slate-900/70 border border-slate-800 rounded-xl p-4 space-y-3">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div className="text-sm font-semibold text-slate-100 flex items-center gap-2"><RefreshCw className={`w-4 h-4 ${['PROCESSING', 'PENDING', 'RUNNING'].includes(String(activeBatch.status).toUpperCase()) ? 'animate-spin text-indigo-400' : 'text-slate-400'}`} />{t('activityLogsImportProgress')}</div>
                <div className="text-xs text-slate-400">#{String(activeBatch.id)} — {activeBatch.filename}</div>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
                <div className="rounded border border-slate-800 bg-slate-950/40 p-2.5"><div className="text-slate-400">{t('activityLogsStatus')}</div><div className="text-slate-100 font-medium">{String(activeBatch.status)}</div></div>
                <div className="rounded border border-slate-800 bg-slate-950/40 p-2.5"><div className="text-slate-400">{t('activityLogsTotalRecords')}</div><div className="text-slate-100 font-medium">{Number(activeBatch.totalRecords || 0).toLocaleString()}</div></div>
                <div className="rounded border border-slate-800 bg-slate-950/40 p-2.5"><div className="text-slate-400">{t('activityLogsImportedCount')}</div><div className="text-emerald-300 font-medium">{Number(activeBatch.importedRecords || 0).toLocaleString()}</div></div>
                <div className="rounded border border-slate-800 bg-slate-950/40 p-2.5"><div className="text-slate-400">{t('activityLogsFailedCount')}</div><div className="text-rose-300 font-medium">{Number(activeBatch.failedRecords || 0).toLocaleString()}</div></div>
              </div>
              <div className="w-full h-2 rounded-full bg-slate-800 overflow-hidden">
                <div className="h-full bg-indigo-500 transition-all" style={{ width: `${progressPct}%` }} />
              </div>
              <div className="flex items-center gap-2 flex-wrap text-xs text-slate-400">
                <span>{t('activityLogsImportDate')}: <span className="text-slate-200">{String(formatDateTime(activeBatch.uploadedAt) || '')}</span></span>
              </div>
              {Number(activeBatch.failedRecords || 0) > 0 && (
                <button type="button" onClick={() => downloadErrorReport(activeBatch.id)} className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border border-slate-700 text-slate-300 hover:bg-slate-800">
                  <Download className="w-3.5 h-3.5" /> {t('activityLogsDownloadErrorReport')}
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {activeTab === 'history' && (
        <div className="space-y-3">
          {batchesError && <ErrorRetryCard compact message={batchesError} onRetry={fetchBatches} />}
          <div className="rounded-xl border border-slate-800 bg-slate-900/50 overflow-hidden">
            <TopProgressBar active={batchesLoading} />
            <div className="overflow-x-auto">
              <table className="w-full text-left rtl:text-right text-xs min-w-[980px]">
                <thead className="bg-slate-950/60 text-slate-400 border-b border-slate-800">
                  <tr>
                    <th className="px-3 py-2">{t('activityLogsBatchId')}</th>
                    <th className="px-3 py-2">{t('activityLogsFilename')}</th>
                    <th className="px-3 py-2">{t('activityLogsImportDate')}</th>
                    <th className="px-3 py-2">{t('activityLogsUploadedBy')}</th>
                    <th className="px-3 py-2">{t('activityLogsTotalRecords')}</th>
                    <th className="px-3 py-2">{t('activityLogsImportedCount')}</th>
                    <th className="px-3 py-2">{t('activityLogsFailedCount')}</th>
                    <th className="px-3 py-2">{t('activityLogsStatus')}</th>
                    <th className="px-3 py-2 text-center">{t('activityLogsActions')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60 text-slate-300">
                  {batches.length === 0 && !batchesLoading ? (
                    <tr><td colSpan={9} className="p-6"><EmptyStateCard title={t('activityLogsNoHistory')} description="" /></td></tr>
                  ) : batches.map(b => (
                    <tr key={String(b.id)} className="hover:bg-slate-800/30">
                      <td className="px-3 py-2 font-mono">#{String(b.id)}</td>
                      <td className="px-3 py-2 max-w-[260px] truncate" title={b.filename}>{b.filename}</td>
                      <td className="px-3 py-2 whitespace-nowrap">{String(formatDateTime(b.uploadedAt) || '')}</td>
                      <td className="px-3 py-2">{b.uploadedBy || <NullCell />}</td>
                      <td className="px-3 py-2 tabular-nums">{Number(b.totalRecords || 0).toLocaleString()}</td>
                      <td className="px-3 py-2 tabular-nums text-emerald-300">{Number(b.importedRecords || 0).toLocaleString()}</td>
                      <td className="px-3 py-2 tabular-nums text-rose-300">{Number(b.failedRecords || 0).toLocaleString()}</td>
                      <td className="px-3 py-2">{String(b.status)}</td>
                      <td className="px-3 py-2">
                        <div className="flex items-center justify-center gap-1.5">
                          {Number(b.failedRecords || 0) > 0 && (
                            <button type="button" onClick={() => downloadErrorReport(b.id)} className="p-1.5 text-slate-400 hover:text-indigo-400" title={t('activityLogsDownloadErrorReport')}><Download className="w-4 h-4" /></button>
                          )}
                          <button type="button" onClick={() => setPendingUndo(b)} disabled={String(b.status).toUpperCase() === 'UNDONE' || undoingId === b.id} className="p-1.5 text-slate-400 hover:text-rose-400 disabled:opacity-40" title={t('activityLogsUndo')}>
                            {undoingId === b.id ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {selectedRecord && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <div className="absolute inset-0 bg-black/50" onClick={() => setSelectedRecord(null)} />
          <div className="relative w-full max-w-3xl h-full bg-slate-900 border-l border-slate-800 shadow-2xl overflow-y-auto">
            <div className="sticky top-0 z-10 flex items-center justify-between px-4 py-3 border-b border-slate-800 bg-slate-900/95">
              <div>
                <h3 className="text-sm font-semibold text-slate-100">{t('activityLogsRecordDetails')}</h3>
                <p className="text-[11px] text-slate-400">ID: {String(selectedRecord.id)}</p>
              </div>
              <button type="button" onClick={() => setSelectedRecord(null)} className="p-1.5 text-slate-400 hover:text-white rounded hover:bg-slate-800"><X className="w-4 h-4" /></button>
            </div>
            <div className="p-4 space-y-4">
              <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-3">
                <div className="text-xs font-semibold uppercase tracking-wide text-indigo-300 mb-2">{t('activityLogsOriginalRecord')}</div>
                <div className="flex items-start gap-2">
                  <pre className="flex-1 whitespace-pre-wrap break-all text-[11px] font-mono text-slate-200 bg-slate-950 border border-slate-800 rounded p-2">{isNullish(selectedRecord.originalRecord) ? t('activityLogsNull') : String(selectedRecord.originalRecord)}</pre>
                  {!isNullish(selectedRecord.originalRecord) && (
                    <button type="button" onClick={() => copyText(String(selectedRecord.originalRecord), `detail-original-${selectedRecord.id}`)} className="p-1.5 text-slate-400 hover:text-indigo-400 shrink-0" title={t('activityLogsCopy')}>
                      {copiedKey === `detail-original-${selectedRecord.id}` ? <CheckCircle2 className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
                    </button>
                  )}
                </div>
              </div>
              <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-3">
                <div className="text-xs font-semibold uppercase tracking-wide text-indigo-300 mb-2">{t('activityLogsRecordDetails')}</div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2">
                  {ALL_COLUMNS.map(col => (
                    <div key={col} className="min-w-0">
                      <div className="text-[10px] uppercase tracking-wide text-slate-500 truncate" title={columnLabel(col)}>{columnLabel(col)}</div>
                      <div className="text-xs text-slate-200 font-mono break-all flex items-start gap-1.5">
                        <span className="flex-1">{isNullish((selectedRecord as any)[col]) ? <NullCell /> : (col === 'createdAt' ? String(formatDateTime((selectedRecord as any)[col])) : String((selectedRecord as any)[col]))}</span>
                        {!isNullish((selectedRecord as any)[col]) && (
                          <button type="button" onClick={() => copyText(col === 'createdAt' ? String(formatDateTime((selectedRecord as any)[col])) : String((selectedRecord as any)[col]), `detail-${col}-${selectedRecord.id}`)} className="p-0.5 text-slate-500 hover:text-indigo-400 shrink-0" title={t('activityLogsCopy')}>
                            {copiedKey === `detail-${col}-${selectedRecord.id}` ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {pendingUndo && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/60" onClick={() => setPendingUndo(null)} />
          <div className="relative w-full max-w-md bg-slate-900 border border-slate-800 rounded-xl shadow-2xl p-5 space-y-4">
            <div className="flex items-start gap-3">
              <div className="p-2 rounded-lg bg-rose-500/10 text-rose-400"><AlertTriangle className="w-5 h-5" /></div>
              <div>
                <h3 className="text-sm font-semibold text-slate-100">{t('activityLogsUndoConfirmTitle')}</h3>
                <p className="text-xs text-slate-400 mt-1">{t('activityLogsUndoConfirmMessage')}</p>
              </div>
            </div>
            <div className="rounded-lg border border-slate-800 bg-slate-950/50 p-3 text-xs space-y-1.5">
              <div><span className="text-slate-400">{t('activityLogsUndoConfirmFilename')}: </span><span className="text-slate-100 font-medium">{pendingUndo.filename}</span></div>
              <div><span className="text-slate-400">{t('activityLogsUndoConfirmCount')}: </span><span className="text-slate-100 font-medium">{Number(pendingUndo.importedRecords || 0).toLocaleString()}</span></div>
              <div><span className="text-slate-400">{t('activityLogsBatchId')}: </span><span className="text-slate-100 font-mono">#{String(pendingUndo.id)}</span></div>
            </div>
            <div className="flex items-center justify-end gap-2">
              <button type="button" onClick={() => setPendingUndo(null)} className="px-3 py-1.5 text-xs rounded-lg border border-slate-700 text-slate-300 hover:bg-slate-800">{t('cancel')}</button>
              <button type="button" onClick={handleUndo} disabled={undoingId === pendingUndo.id} className="px-3 py-1.5 text-xs rounded-lg bg-rose-600 hover:bg-rose-500 disabled:opacity-50 text-white flex items-center gap-1.5">
                {undoingId === pendingUndo.id ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                {t('activityLogsUndo')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
