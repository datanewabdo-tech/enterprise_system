import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  RefreshCw,
  Upload,
  FileSpreadsheet,
  Download,
  Search,
  Filter,
  Eye,
  ChevronDown,
  ChevronRight,
  Trash2,
  History,
  Database,
  CheckCircle2,
  AlertTriangle,
  X,
  FileText,
  SlidersHorizontal,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  ChevronsLeft,
  ChevronsRight,
  ChevronLeft,
  Clock,
} from 'lucide-react';
import { useApp } from '../context/AppContext.js';
import { TopProgressBar, EmptyStateCard, ErrorRetryCard, RefreshingBadge } from '../components/common/LoadingStates.js';

type CronologGroup = 'call' | 'calledParty' | 'callingParty' | 'thuraya' | 'networkSystem' | 'target' | 'message';
type CronologFieldType = 'string' | 'float' | 'int';

interface CronologFieldDef {
  position: number;
  sourceName: string;
  field: string;
  type: CronologFieldType;
  group: CronologGroup;
}

const CRONOLOG_FIELDS: CronologFieldDef[] = [
  { position: 1, sourceName: 'Date Up', field: 'dateUp', type: 'string', group: 'call' },
  { position: 2, sourceName: 'Time Up', field: 'timeUp', type: 'string', group: 'call' },
  { position: 3, sourceName: 'Date Down', field: 'dateDown', type: 'string', group: 'call' },
  { position: 4, sourceName: 'Time Down', field: 'timeDown', type: 'string', group: 'call' },
  { position: 5, sourceName: 'Unique Call ID', field: 'uniqueCallId', type: 'string', group: 'call' },
  { position: 6, sourceName: 'Unit Latitude', field: 'unitLatitude', type: 'float', group: 'networkSystem' },
  { position: 7, sourceName: 'Unit Longitude', field: 'unitLongitude', type: 'float', group: 'networkSystem' },
  { position: 8, sourceName: 'Called TMSI', field: 'calledTmsi', type: 'string', group: 'calledParty' },
  { position: 9, sourceName: 'Called Contention Resolution ID', field: 'calledContentionResolutionId', type: 'string', group: 'calledParty' },
  { position: 10, sourceName: 'Called IMSI', field: 'calledImsi', type: 'string', group: 'calledParty' },
  { position: 11, sourceName: 'Called IMEI', field: 'calledImei', type: 'string', group: 'calledParty' },
  { position: 12, sourceName: 'Called PSTN', field: 'calledPstn', type: 'string', group: 'calledParty' },
  { position: 13, sourceName: 'Calling TMSI', field: 'callingTmsi', type: 'string', group: 'callingParty' },
  { position: 14, sourceName: 'Calling Contention Resolution ID', field: 'callingContentionResolutionId', type: 'string', group: 'callingParty' },
  { position: 15, sourceName: 'Calling IMSI', field: 'callingImsi', type: 'string', group: 'callingParty' },
  { position: 16, sourceName: 'Calling IMEI', field: 'callingImei', type: 'string', group: 'callingParty' },
  { position: 17, sourceName: 'Calling PSTN', field: 'callingPstn', type: 'string', group: 'callingParty' },
  { position: 18, sourceName: 'Mobile Origination', field: 'mobileOrigination', type: 'string', group: 'call' },
  { position: 19, sourceName: 'Reverse Received', field: 'reverseReceived', type: 'string', group: 'call' },
  { position: 20, sourceName: 'Thuraya IMSI', field: 'thurayaImsi', type: 'string', group: 'thuraya' },
  { position: 21, sourceName: 'Thuraya IMEI', field: 'thurayaImei', type: 'string', group: 'thuraya' },
  { position: 22, sourceName: 'Original TMSI', field: 'originalTmsi', type: 'string', group: 'thuraya' },
  { position: 23, sourceName: 'Reallocated TMSI', field: 'reallocatedTmsi', type: 'string', group: 'thuraya' },
  { position: 24, sourceName: 'Contention Resolution ID', field: 'contentionResolutionId', type: 'string', group: 'thuraya' },
  { position: 25, sourceName: 'DTMF Digits', field: 'dtmfDigits', type: 'string', group: 'call' },
  { position: 26, sourceName: 'Mobile Latitude', field: 'mobileLatitude', type: 'float', group: 'networkSystem' },
  { position: 27, sourceName: 'Mobile Longitude', field: 'mobileLongitude', type: 'float', group: 'networkSystem' },
  { position: 28, sourceName: 'System ID', field: 'systemId', type: 'string', group: 'networkSystem' },
  { position: 29, sourceName: 'thuraya vocoder algorithm', field: 'thurayaVocoderAlgorithm', type: 'string', group: 'thuraya' },
  { position: 30, sourceName: 'Mode of Call', field: 'modeOfCall', type: 'string', group: 'call' },
  { position: 31, sourceName: 'Sub Mode of Call', field: 'subModeOfCall', type: 'string', group: 'call' },
  { position: 32, sourceName: 'reason for EOC', field: 'reasonForEoc', type: 'string', group: 'call' },
  { position: 33, sourceName: 'Thuraya SRAND', field: 'thurayaSrand', type: 'string', group: 'thuraya' },
  { position: 34, sourceName: 'Thuraya SRES', field: 'thurayaSres', type: 'string', group: 'thuraya' },
  { position: 35, sourceName: 'ciphering key squence number', field: 'cipheringKeySequenceNumber', type: 'string', group: 'thuraya' },
  { position: 36, sourceName: 'Kc', field: 'kc', type: 'string', group: 'thuraya' },
  { position: 37, sourceName: 'Ki', field: 'ki', type: 'string', group: 'thuraya' },
  { position: 38, sourceName: 'Target Identifiers', field: 'targetIdentifiers', type: 'string', group: 'target' },
  { position: 39, sourceName: 'Case Notation', field: 'caseNotation', type: 'string', group: 'target' },
  { position: 40, sourceName: 'Audio Routed', field: 'audioRouted', type: 'string', group: 'call' },
  { position: 41, sourceName: 'Encryption mode', field: 'encryptionMode', type: 'string', group: 'networkSystem' },
  { position: 42, sourceName: 'Initial Control Channel', field: 'initialControlChannel', type: 'string', group: 'call' },
  { position: 43, sourceName: 'Voice Channel History', field: 'voiceChannelHistory', type: 'string', group: 'call' },
  { position: 44, sourceName: 'Voice Channel History Timestamp', field: 'voiceChannelHistoryTimestamp', type: 'string', group: 'call' },
  { position: 45, sourceName: 'Message Type', field: 'messageType', type: 'string', group: 'message' },
  { position: 46, sourceName: 'Message Length', field: 'messageLength', type: 'int', group: 'message' },
  { position: 47, sourceName: 'Message', field: 'message', type: 'string', group: 'message' },
  { position: 48, sourceName: 'Called Normalized PSTN', field: 'calledNormalizedPstn', type: 'string', group: 'calledParty' },
  { position: 49, sourceName: 'Calling Normalized PSTN', field: 'callingNormalizedPstn', type: 'string', group: 'callingParty' },
  { position: 50, sourceName: 'Target Selection Result', field: 'targetSelectionResult', type: 'string', group: 'target' },
  { position: 51, sourceName: 'Target Rule', field: 'targetRule', type: 'string', group: 'target' },
  { position: 52, sourceName: 'Called Party Target Rule', field: 'calledPartyTargetRule', type: 'string', group: 'calledParty' },
  { position: 53, sourceName: 'Calling Party Target Rule', field: 'callingPartyTargetRule', type: 'string', group: 'callingParty' },
  { position: 54, sourceName: 'Hit List', field: 'hitList', type: 'string', group: 'target' },
];

const GROUP_ORDER: CronologGroup[] = ['call', 'calledParty', 'callingParty', 'thuraya', 'networkSystem', 'target', 'message'];

function groupLabelKey(group: CronologGroup): keyof typeof import('../locales/translations.js')['translations']['en'] {
  switch (group) {
    case 'call': return 'cronologsGroupCall';
    case 'calledParty': return 'cronologsGroupCalledParty';
    case 'callingParty': return 'cronologsGroupCallingParty';
    case 'thuraya': return 'cronologsGroupThuraya';
    case 'networkSystem': return 'cronologsGroupNetworkSystem';
    case 'target': return 'cronologsGroupTarget';
    case 'message': return 'cronologsGroupMessage';
  }
}

function isNullish(v: unknown) {
  return v === null || v === undefined || (typeof v === 'string' && v.trim() === '');
}

function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes)) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export const Cronologs: React.FC = () => {
  const { t, apiFetch, addNotification, language } = useApp();
  const [activeTab, setActiveTab] = useState<'records' | 'import' | 'history'>('records');

  // Stats
  const [stats, setStats] = useState<any>(null);
  const [statsLoading, setStatsLoading] = useState(false);
  const [statsError, setStatsError] = useState<string | null>(null);

  // Records table state
  const [rows, setRows] = useState<any[]>([]);
  const [rowsLoading, setRowsLoading] = useState(false);
  const [rowsError, setRowsError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState('id');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  const [dateUpFilter, setDateUpFilter] = useState('');
  const [dateDownFilter, setDateDownFilter] = useState('');
  const [columnFilters, setColumnFilters] = useState<Record<string, string>>({});
  const [appliedColumnFilters, setAppliedColumnFilters] = useState<Record<string, string>>({});
  const [visibleFields, setVisibleFields] = useState<string[]>(CRONOLOG_FIELDS.slice(0, 10).map(f => f.field));
  const [showColumnMenu, setShowColumnMenu] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [expandedRowIds, setExpandedRowIds] = useState<Record<number, boolean>>({});
  const [selectedRecord, setSelectedRecord] = useState<any | null>(null);

  // Import state
  const [file, setFile] = useState<File | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [preview, setPreview] = useState<any | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [confirmLoading, setConfirmLoading] = useState(false);
  const [forceDuplicate, setForceDuplicate] = useState(false);
  const [activeBatchId, setActiveBatchId] = useState<number | null>(null);
  const [activeBatch, setActiveBatch] = useState<any | null>(null);
  const pollRef = useRef<number | null>(null);

  // History
  const [batches, setBatches] = useState<any[]>([]);
  const [batchesLoading, setBatchesLoading] = useState(false);
  const [batchesError, setBatchesError] = useState<string | null>(null);
  const [undoingId, setUndoingId] = useState<number | null>(null);

  const fetchStats = useCallback(async () => {
    setStatsLoading(true);
    setStatsError(null);
    try {
      const res = await apiFetch('/api/v1/cronologs/statistics');
      const json = await res.json().catch(() => null);
      if (!res.ok) throw new Error(json?.error || t('cronologsStatsFailed'));
      setStats(json);
    } catch (err: any) {
      setStatsError(err?.message || t('cronologsStatsFailed'));
    } finally {
      setStatsLoading(false);
    }
  }, [apiFetch, t]);

  const fetchRows = useCallback(async () => {
    setRowsLoading(true);
    setRowsError(null);
    try {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: String(pageSize),
        sortBy,
        sortOrder,
      });
      if (search.trim()) params.set('search', search.trim());
      if (dateUpFilter.trim()) params.set('dateUp', dateUpFilter.trim());
      if (dateDownFilter.trim()) params.set('dateDown', dateDownFilter.trim());
      const cleanFilters: Record<string, string> = {};
      for (const [k, v] of Object.entries(appliedColumnFilters)) {
        if (v && v.trim()) cleanFilters[k] = v.trim();
      }
      if (Object.keys(cleanFilters).length) params.set('filters', JSON.stringify(cleanFilters));

      const res = await apiFetch(`/api/v1/cronologs?${params.toString()}`);
      const json = await res.json().catch(() => null);
      if (!res.ok) throw new Error(json?.error || t('cronologsLoadFailed'));
      setRows(Array.isArray(json?.data) ? json.data : []);
      setTotal(json?.pagination?.total || 0);
      setTotalPages(json?.pagination?.totalPages || 1);
    } catch (err: any) {
      setRowsError(err?.message || t('cronologsLoadFailed'));
    } finally {
      setRowsLoading(false);
    }
  }, [apiFetch, page, pageSize, sortBy, sortOrder, search, dateUpFilter, dateDownFilter, appliedColumnFilters, t]);

  const fetchBatches = useCallback(async () => {
    setBatchesLoading(true);
    setBatchesError(null);
    try {
      const res = await apiFetch('/api/v1/cronologs/imports');
      const json = await res.json().catch(() => null);
      if (!res.ok) throw new Error(json?.error || 'Failed to load import history');
      setBatches(Array.isArray(json) ? json : []);
    } catch (err: any) {
      setBatchesError(err?.message || 'Failed to load import history');
    } finally {
      setBatchesLoading(false);
    }
  }, [apiFetch]);

  useEffect(() => { fetchStats(); }, [fetchStats]);
  useEffect(() => { if (activeTab === 'records') fetchRows(); }, [activeTab, fetchRows]);
  useEffect(() => { if (activeTab === 'history') fetchBatches(); }, [activeTab, fetchBatches]);

  // poll active import batch
  useEffect(() => {
    if (!activeBatchId) return;
    const poll = async () => {
      try {
        const res = await apiFetch(`/api/v1/cronologs/imports/${activeBatchId}`);
        const json = await res.json().catch(() => null);
        if (res.ok && json) {
          setActiveBatch(json);
          const status = json.status;
          if (status === 'COMPLETED' || status === 'COMPLETED_WITH_ERRORS' || status === 'FAILED' || status === 'UNDONE') {
            if (pollRef.current) window.clearInterval(pollRef.current);
            pollRef.current = null;
            fetchStats();
            fetchRows();
            fetchBatches();
            if (status === 'COMPLETED') addNotification({ title: t('cronologsImportCompleted'), message: `${json.importedRecords}/${json.totalRecords}`, type: 'success' });
            else if (status === 'COMPLETED_WITH_ERRORS') addNotification({ title: t('cronologsImportCompletedWithErrors'), message: `${json.importedRecords}/${json.totalRecords}, ${json.failedRecords} failed`, type: 'warning' });
            else if (status === 'FAILED') addNotification({ title: t('cronologsImportFailed'), message: json.filename, type: 'error' });
          }
        }
      } catch {
        // ignore polling errors
      }
    };
    poll();
    pollRef.current = window.setInterval(poll, 1500);
    return () => {
      if (pollRef.current) window.clearInterval(pollRef.current);
      pollRef.current = null;
    };
  }, [activeBatchId, apiFetch, fetchStats, fetchRows, fetchBatches, addNotification, t]);

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
    setPreviewLoading(true);
    setPreviewError(null);
    try {
      const form = new FormData();
      form.append('file', file);
      const res = await apiFetch('/api/v1/cronologs/import/preview', { method: 'POST', body: form });
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
      const res = await apiFetch('/api/v1/cronologs/import/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filePath: preview.filePath, originalName: preview.originalName || preview.filename, forceDuplicate }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) throw new Error(json?.error || t('cronologsImportFailed'));
      setActiveBatchId(json.batchId);
      setActiveBatch({ id: json.batchId, status: 'PROCESSING', importedRecords: 0, failedRecords: 0, totalRecords: preview.totalRecords || 0, filename: preview.filename });
      addNotification({ title: t('cronologsImportStarted'), message: `#${json.batchId}`, type: 'info' });
    } catch (err: any) {
      addNotification({ title: t('cronologsImportFailed'), message: err?.message || 'Import failed', type: 'error' });
    } finally {
      setConfirmLoading(false);
    }
  };

  const handleUndo = async (batchId: number) => {
    if (!window.confirm(t('cronologsUndoConfirmMessage'))) return;
    setUndoingId(batchId);
    try {
      const res = await apiFetch(`/api/v1/cronologs/imports/${batchId}`, { method: 'DELETE' });
      const json = await res.json().catch(() => null);
      if (!res.ok) throw new Error(json?.error || t('cronologsUndoFailed'));
      addNotification({ title: t('cronologsUndoSuccess'), message: `#${batchId} (${json.deletedRecords || 0})`, type: 'success' });
      fetchBatches();
      fetchStats();
      fetchRows();
    } catch (err: any) {
      addNotification({ title: t('cronologsUndoFailed'), message: err?.message || 'Undo failed', type: 'error' });
    } finally {
      setUndoingId(null);
    }
  };

  const buildCurrentQueryParams = useCallback(() => {
    const params = new URLSearchParams({ sortBy, sortOrder });
    if (search.trim()) params.set('search', search.trim());
    if (dateUpFilter.trim()) params.set('dateUp', dateUpFilter.trim());
    if (dateDownFilter.trim()) params.set('dateDown', dateDownFilter.trim());
    const cleanFilters: Record<string, string> = {};
    for (const [k, v] of Object.entries(appliedColumnFilters)) {
      if (v && v.trim()) cleanFilters[k] = v.trim();
    }
    if (Object.keys(cleanFilters).length) params.set('filters', JSON.stringify(cleanFilters));
    return params;
  }, [sortBy, sortOrder, search, dateUpFilter, dateDownFilter, appliedColumnFilters]);

  const handleExport = async (format: 'csv' | 'xlsx' | 'pdf' | 'docx') => {
    try {
      const params = buildCurrentQueryParams();
      params.set('format', format);
      params.set('lang', language);
      params.set('columns', visibleFields.join(','));
      const res = await apiFetch(`/api/v1/cronologs/export?${params.toString()}`);
      if (!res.ok) {
        const json = await res.json().catch(() => null);
        throw new Error(json?.error || t('cronologsExportFailed'));
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = res.headers.get('X-Export-Filename') || `cronologs_export.${format}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err: any) {
      addNotification({ title: t('cronologsExportFailed'), message: err?.message || 'Export failed', type: 'error' });
    }
  };

  const toggleSort = (field: string) => {
    if (sortBy === field) setSortOrder((o) => (o === 'asc' ? 'desc' : 'asc'));
    else { setSortBy(field); setSortOrder('asc'); }
    setPage(1);
  };

  const visibleFieldDefs = useMemo(() => CRONOLOG_FIELDS.filter(f => visibleFields.includes(f.field)), [visibleFields]);
  const groupedFields = useMemo(() => GROUP_ORDER.map(g => ({ group: g, labelKey: groupLabelKey(g), fields: CRONOLOG_FIELDS.filter(f => f.group === g) })), []);

  const StatCard = ({ label, value }: { label: string; value: any }) => (
    <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
      <div className="text-[11px] uppercase tracking-wide text-slate-400">{label}</div>
      <div className="mt-1 text-xl font-bold text-slate-100 tabular-nums">{Number(value || 0).toLocaleString()}</div>
    </div>
  );

  const NullCell = () => <span className="italic text-slate-500 text-[10px]">NULL</span>;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-100 flex items-center gap-2">
            <Database className="w-5 h-5 text-indigo-400" />
            <span>{t('cronologsTitle')}</span>
          </h1>
          <p className="text-xs text-slate-400 mt-0.5">{t('cronologsDescription')}</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button type="button" onClick={() => { fetchStats(); fetchRows(); fetchBatches(); }} className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border border-slate-700 text-slate-300 hover:bg-slate-800">
            <RefreshCw className={`w-3.5 h-3.5 ${rowsLoading || statsLoading ? 'animate-spin' : ''}`} />
            {t('cronologsRefresh')}
          </button>
        </div>
      </div>

      {/* Stats */}
      <div>
        {statsError && <ErrorRetryCard compact message={statsError} onRetry={fetchStats} />}
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
          <StatCard label={t('cronologsStatsTotal')} value={stats?.totalCronologsRecords} />
          <StatCard label={t('cronologsStatsUniqueCallIds')} value={stats?.uniqueCallIds} />
          <StatCard label={t('cronologsStatsUniqueCalledImsis')} value={stats?.uniqueCalledImsis} />
          <StatCard label={t('cronologsStatsUniqueCallingImsis')} value={stats?.uniqueCallingImsis} />
          <StatCard label={t('cronologsStatsWithUnitCoordinates')} value={stats?.recordsWithUnitCoordinates} />
          <StatCard label={t('cronologsStatsImportBatches')} value={stats?.importBatches} />
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-2 border-b border-slate-800">
        {([
          { id: 'records', label: t('cronologsRecords'), icon: FileSpreadsheet },
          { id: 'import', label: t('cronologsImport'), icon: Upload },
          { id: 'history', label: t('cronologsHistory'), icon: History },
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
          {/* Toolbar */}
          <div className="flex flex-col lg:flex-row gap-3 lg:items-end lg:justify-between bg-slate-900/70 border border-slate-800 rounded-xl p-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2 flex-1">
              <div className="relative sm:col-span-2 lg:col-span-2">
                <Search className="absolute left-2.5 top-2.5 w-4 h-4 text-slate-500 rtl:right-2.5 rtl:left-auto" />
                <input value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} placeholder={t('cronologsGlobalSearch')} className="w-full h-9 pl-9 pr-3 rtl:pr-9 rtl:pl-3 text-xs bg-slate-950 border border-slate-800 rounded-lg text-slate-200" />
              </div>
              <div>
                <label className="block text-[10px] text-slate-400 mb-1">{t('cronologsDateUpFilter')}</label>
                <input value={dateUpFilter} onChange={e => { setDateUpFilter(e.target.value); setPage(1); }} placeholder="Date Up" className="w-full h-9 px-2.5 text-xs bg-slate-950 border border-slate-800 rounded-lg text-slate-200" />
              </div>
              <div>
                <label className="block text-[10px] text-slate-400 mb-1">{t('cronologsDateDownFilter')}</label>
                <input value={dateDownFilter} onChange={e => { setDateDownFilter(e.target.value); setPage(1); }} placeholder="Date Down" className="w-full h-9 px-2.5 text-xs bg-slate-950 border border-slate-800 rounded-lg text-slate-200" />
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" onClick={() => setShowFilters(v => !v)} className={`h-9 px-3 text-xs rounded-lg border flex items-center gap-1.5 ${showFilters ? 'bg-indigo-600/20 border-indigo-500 text-indigo-300' : 'border-slate-700 text-slate-300 hover:bg-slate-800'}`}><Filter className="w-3.5 h-3.5" />{t('cronologsColumnFilters')}</button>
              <div className="relative">
                <button type="button" onClick={() => setShowColumnMenu(v => !v)} className="h-9 px-3 text-xs rounded-lg border border-slate-700 text-slate-300 hover:bg-slate-800 flex items-center gap-1.5"><SlidersHorizontal className="w-3.5 h-3.5" />{t('cronologsColumnVisibility')}</button>
                {showColumnMenu && (
                  <div className="absolute right-0 rtl:left-0 rtl:right-auto mt-2 w-72 max-h-80 overflow-y-auto bg-slate-900 border border-slate-800 rounded-xl shadow-xl p-2 z-30">
                    <div className="flex items-center justify-between mb-2">
                      <button type="button" onClick={() => setVisibleFields(CRONOLOG_FIELDS.map(f => f.field))} className="text-[11px] text-indigo-400 hover:text-indigo-300">{t('cronologsShowAllColumns')}</button>
                      <button type="button" onClick={() => setVisibleFields(['dateUp','timeUp','uniqueCallId'])} className="text-[11px] text-slate-400 hover:text-slate-200">{t('cronologsHideAllColumns')}</button>
                    </div>
                    {CRONOLOG_FIELDS.map(f => (
                      <label key={f.field} className="flex items-center gap-2 px-1.5 py-1 text-xs text-slate-300 hover:bg-slate-800 rounded cursor-pointer">
                        <input type="checkbox" checked={visibleFields.includes(f.field)} onChange={() => setVisibleFields(prev => prev.includes(f.field) ? prev.filter(x => x !== f.field) : [...prev, f.field])} className="rounded bg-slate-950 border-slate-700 text-indigo-600 focus:ring-0" />
                        <span className="truncate" title={f.sourceName}>{f.sourceName}</span>
                      </label>
                    ))}
                  </div>
                )}
              </div>
              <div className="flex items-center gap-1">
                <button type="button" onClick={() => handleExport('csv')} className="h-9 px-2.5 text-xs rounded-lg border border-slate-700 text-slate-300 hover:bg-slate-800" title={t('cronologsExportCsv')}>CSV</button>
                <button type="button" onClick={() => handleExport('xlsx')} className="h-9 px-2.5 text-xs rounded-lg border border-slate-700 text-slate-300 hover:bg-slate-800" title={t('cronologsExportExcel')}>XLSX</button>
                <button type="button" onClick={() => handleExport('pdf')} className="h-9 px-2.5 text-xs rounded-lg border border-slate-700 text-slate-300 hover:bg-slate-800" title={t('cronologsExportPdf')}>PDF</button>
                <button type="button" onClick={() => handleExport('docx')} className="h-9 px-2.5 text-xs rounded-lg border border-slate-700 text-slate-300 hover:bg-slate-800" title={t('cronologsExportWord')}>DOCX</button>
              </div>
            </div>
          </div>

          {showFilters && (
            <div className="bg-slate-900/70 border border-slate-800 rounded-xl p-3 space-y-3">
              <div className="text-xs font-semibold text-slate-200 flex items-center gap-1.5"><Filter className="w-3.5 h-3.5 text-indigo-400" />{t('cronologsColumnFilters')}</div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2 max-h-64 overflow-auto pr-1">
                {CRONOLOG_FIELDS.map(f => (
                  <div key={f.field}>
                    <label className="block text-[10px] text-slate-400 mb-1 truncate" title={f.sourceName}>{f.sourceName}</label>
                    <input value={columnFilters[f.field] || ''} onChange={e => setColumnFilters(prev => ({ ...prev, [f.field]: e.target.value }))} className="w-full h-8 px-2 text-xs bg-slate-950 border border-slate-800 rounded text-slate-200" />
                  </div>
                ))}
              </div>
              <div className="flex items-center justify-end gap-2">
                <button type="button" onClick={() => { setColumnFilters({}); setAppliedColumnFilters({}); setPage(1); }} className="px-3 py-1.5 text-xs rounded border border-slate-700 text-slate-300 hover:bg-slate-800">{t('cronologsClearFilters')}</button>
                <button type="button" onClick={() => { setAppliedColumnFilters({ ...columnFilters }); setPage(1); }} className="px-3 py-1.5 text-xs rounded bg-indigo-600 hover:bg-indigo-500 text-white font-medium">{t('cronologsApplyFilters')}</button>
              </div>
            </div>
          )}

          {rowsError && <ErrorRetryCard compact message={rowsError} onRetry={fetchRows} />}

          <div className="rounded-xl border border-slate-800 bg-slate-900/50 overflow-hidden">
            <TopProgressBar active={rowsLoading} />
            <div className="overflow-x-auto">
              <table className="w-full text-left rtl:text-right border-collapse min-w-[900px]">
                <thead>
                  <tr className="border-b border-slate-800 bg-slate-950/60 text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
                    <th className="px-3 py-2 w-10"></th>
                    {visibleFieldDefs.map(f => (
                      <th key={f.field} onClick={() => toggleSort(f.field)} className="px-3 py-2 cursor-pointer hover:bg-slate-800/40 select-none whitespace-nowrap" title={f.sourceName}>
                        <div className="flex items-center gap-1.5">
                          <span>{f.sourceName}</span>
                          {sortBy === f.field ? (sortOrder === 'asc' ? <ArrowUp className="w-3 h-3 text-indigo-400" /> : <ArrowDown className="w-3 h-3 text-indigo-400" />) : <ArrowUpDown className="w-3 h-3 text-slate-600" />}
                        </div>
                      </th>
                    ))}
                    <th className="px-3 py-2 w-20 text-center">{t('cronologsActions')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60 text-xs text-slate-300">
                  {rowsLoading && rows.length === 0 ? (
                    Array.from({ length: 8 }).map((_, i) => (
                      <tr key={i}><td colSpan={visibleFieldDefs.length + 2} className="px-4 py-3"><div className="h-4 bg-slate-800 rounded animate-pulse" /></td></tr>
                    ))
                  ) : rows.length === 0 ? (
                    <tr>
                      <td colSpan={visibleFieldDefs.length + 2} className="p-6">
                        <EmptyStateCard title={t('cronologsNoRecords')} description={t('cronologsNoRecordsHint')} />
                      </td>
                    </tr>
                  ) : rows.map(row => {
                    const expanded = !!expandedRowIds[row.id];
                    return (
                      <React.Fragment key={row.id}>
                        <tr className="hover:bg-slate-800/30">
                          <td className="px-2 py-2 align-top">
                            <button type="button" onClick={() => setExpandedRowIds(prev => ({ ...prev, [row.id]: !prev[row.id] }))} className="p-1 text-slate-400 hover:text-white">
                              {expanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4 rtl:rotate-180" />}
                            </button>
                          </td>
                          {visibleFieldDefs.map(f => {
                            const v = row[f.field];
                            return (
                              <td key={f.field} className="px-3 py-2 font-mono text-[11px] whitespace-nowrap max-w-[240px] truncate" title={isNullish(v) ? 'NULL' : String(v)}>
                                {isNullish(v) ? <NullCell /> : String(v)}
                              </td>
                            );
                          })}
                          <td className="px-3 py-2 text-center">
                            <button type="button" onClick={() => setSelectedRecord(row)} className="p-1 text-slate-400 hover:text-indigo-400" title={t('cronologsDetails')}><Eye className="w-4 h-4" /></button>
                          </td>
                        </tr>
                        {expanded && (
                          <tr className="bg-slate-950/50">
                            <td colSpan={visibleFieldDefs.length + 2} className="px-4 py-3">
                              <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                                {groupedFields.map(g => (
                                  <div key={g.group} className="rounded-lg border border-slate-800 bg-slate-900/40 p-3">
                                    <div className="text-[11px] font-semibold uppercase tracking-wide text-indigo-300 mb-2">{t(g.labelKey)}</div>
                                    <div className="space-y-1">
                                      {g.fields.map(f => (
                                        <div key={f.field} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-2 text-[11px]">
                                          <div className="text-slate-400 break-words">{f.sourceName}</div>
                                          <div className="text-slate-200 font-mono break-all">{isNullish(row[f.field]) ? <NullCell /> : String(row[f.field])}</div>
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Pagination */}
          <div className="flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-slate-400">
            <div className="tabular-nums">{t('showing')} <strong className="text-slate-200">{rows.length}</strong> {t('of')} <strong className="text-slate-200">{total.toLocaleString()}</strong> {t('cronologsRecordCount')}</div>
            <div className="flex items-center gap-2">
              <span>{t('cronologsPageSize')}:</span>
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
              <div className="text-sm text-slate-200 font-medium">{t('cronologsSelectFile')}</div>
              <div className="text-xs text-slate-400 mt-1">{t('cronologsFileHint')}</div>
              <div className="mt-3 flex items-center justify-center gap-2">
                <label className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 cursor-pointer">
                  <FileText className="w-3.5 h-3.5" />
                  <span>Browse</span>
                  <input type="file" className="hidden" onChange={e => onFileSelected(e.target.files?.[0] || null)} />
                </label>
                {file && <span className="text-xs text-slate-300 truncate max-w-xs" title={file.name}>{file.name} ({formatBytes(file.size)})</span>}
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button type="button" onClick={handlePreview} disabled={!file || previewLoading} className="px-4 py-2 text-xs font-semibold rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white flex items-center gap-1.5">
                {previewLoading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Eye className="w-4 h-4" />}
                {previewLoading ? t('cronologsPreviewing') : t('cronologsPreviewAction')}
              </button>
              {preview && (
                <button type="button" onClick={() => { setPreview(null); setPreviewError(null); setForceDuplicate(false); }} className="px-3 py-2 text-xs rounded-lg border border-slate-700 text-slate-300 hover:bg-slate-800">{t('cronologsCancelPreview')}</button>
              )}
            </div>

            {previewError && <ErrorRetryCard compact message={previewError} onRetry={handlePreview} />}

            {preview && (
              <div className="space-y-4 border-t border-slate-800 pt-4">
                <h3 className="text-sm font-semibold text-slate-100 flex items-center gap-2"><FileSpreadsheet className="w-4 h-4 text-indigo-400" />{t('cronologsPreviewTitle')}</h3>

                {preview.isDuplicate && (
                  <div className="rounded-lg border border-amber-700/60 bg-amber-950/20 p-3 text-xs text-amber-200 space-y-2">
                    <div className="flex items-center gap-2 font-semibold"><AlertTriangle className="w-4 h-4" />{t('cronologsDuplicateWarning')}</div>
                    <div>{t('cronologsDuplicateMessage')}</div>
                    {preview.duplicateBatch && <div className="text-amber-300/90">#{preview.duplicateBatch.id} — {preview.duplicateBatch.filename} ({String(preview.duplicateBatch.status)})</div>}
                    <label className="inline-flex items-center gap-2 cursor-pointer">
                      <input type="checkbox" checked={forceDuplicate} onChange={e => setForceDuplicate(e.target.checked)} className="rounded bg-slate-950 border-slate-700 text-indigo-600 focus:ring-0" />
                      <span>{t('cronologsForceDuplicate')}</span>
                    </label>
                  </div>
                )}

                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2 text-xs">
                  <div className="rounded-lg border border-slate-800 bg-slate-950/50 p-2.5"><div className="text-slate-400">{t('cronologsFilename')}</div><div className="text-slate-100 font-medium truncate" title={preview.filename}>{preview.filename}</div></div>
                  <div className="rounded-lg border border-slate-800 bg-slate-950/50 p-2.5"><div className="text-slate-400">{t('cronologsFileSize')}</div><div className="text-slate-100 font-medium">{formatBytes(preview.size || 0)}</div></div>
                  <div className="rounded-lg border border-slate-800 bg-slate-950/50 p-2.5"><div className="text-slate-400">{t('cronologsTotalRecords')}</div><div className="text-slate-100 font-medium">{Number(preview.totalRecords || 0).toLocaleString()}</div></div>
                  <div className="rounded-lg border border-slate-800 bg-slate-950/50 p-2.5"><div className="text-slate-400">{t('cronologsValidRecords')}</div><div className="text-emerald-300 font-medium">{Number(preview.validRecords || 0).toLocaleString()}</div></div>
                  <div className="rounded-lg border border-slate-800 bg-slate-950/50 p-2.5"><div className="text-slate-400">{t('cronologsInvalidRecords')}</div><div className="text-rose-300 font-medium">{Number(preview.invalidRecords || 0).toLocaleString()}</div></div>
                  <div className="rounded-lg border border-slate-800 bg-slate-950/50 p-2.5"><div className="text-slate-400">{t('cronologsExpectedColumns')}</div><div className="text-slate-100 font-medium">{preview.expectedColumns || 54}</div></div>
                </div>

                {Array.isArray(preview.actualColumnIssues) && preview.actualColumnIssues.length > 0 && (
                  <div className="text-xs text-amber-300">
                    {t('cronologsActualColumns')}: {preview.actualColumnIssues.slice(0, 5).map((i: any) => `#${i.line}=${i.actual}`).join(', ')}{preview.actualColumnIssues.length > 5 ? '…' : ''}
                  </div>
                )}

                <div className="space-y-2">
                  <div className="text-xs font-semibold text-slate-200">{t('cronologsFirstRecords')}</div>
                  <div className="overflow-x-auto rounded-lg border border-slate-800">
                    <table className="w-full text-[10px] min-w-[1200px]">
                      <thead className="bg-slate-950/70 text-slate-400">
                        <tr>{CRONOLOG_FIELDS.map(f => <th key={f.field} className="px-2 py-1.5 text-left whitespace-nowrap border-b border-slate-800">{f.sourceName}</th>)}</tr>
                      </thead>
                      <tbody>
                        {(preview.firstRecords || preview.sampleRecords || []).slice(0, 5).map((r: any, idx: number) => (
                          <tr key={idx} className="border-b border-slate-800/50">
                            {CRONOLOG_FIELDS.map(f => {
                              const v = r?.[f.sourceName];
                              return <td key={f.field} className="px-2 py-1 whitespace-nowrap max-w-[180px] truncate font-mono text-slate-300" title={v == null || v === '' ? 'NULL' : String(v)}>{v == null || v === '' ? <NullCell /> : String(v)}</td>;
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                <div className="space-y-2">
                  <div className="text-xs font-semibold text-slate-200">{t('cronologsParsingErrors')}</div>
                  {Array.isArray(preview.parsingErrors) && preview.parsingErrors.length > 0 ? (
                    <div className="max-h-48 overflow-auto rounded-lg border border-slate-800 bg-slate-950/50 p-2 space-y-1">
                      {preview.parsingErrors.slice(0, 50).map((e: any, i: number) => (
                        <div key={i} className="text-[11px] text-rose-300 font-mono break-all">[{t('cronologsLine')} {e.line}{e.field ? `, ${t('cronologsField')} ${e.field}` : ''}] {e.message}</div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-xs text-emerald-300 flex items-center gap-1.5"><CheckCircle2 className="w-3.5 h-3.5" />{t('cronologsNoParsingErrors')}</div>
                  )}
                </div>

                <div className="flex items-center gap-2 pt-1">
                  <button type="button" onClick={handleConfirmImport} disabled={confirmLoading || (preview.isDuplicate && !forceDuplicate) || (preview.validRecords === 0 && preview.invalidRecords > 0)} className="px-4 py-2 text-xs font-semibold rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white flex items-center gap-1.5">
                    {confirmLoading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                    {t('cronologsConfirmImport')}
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Progress */}
          {activeBatch && (
            <div className="bg-slate-900/70 border border-slate-800 rounded-xl p-4 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-slate-100 flex items-center gap-2"><Clock className="w-4 h-4 text-indigo-400" />{t('cronologsProgress')} — {t('cronologsBatch')} #{activeBatch.id}</h3>
                <span className={`text-[11px] px-2 py-0.5 rounded-full border ${['COMPLETED'].includes(activeBatch.status) ? 'text-emerald-300 border-emerald-700/60 bg-emerald-950/30' : ['FAILED','UNDONE'].includes(activeBatch.status) ? 'text-rose-300 border-rose-700/60 bg-rose-950/30' : activeBatch.status === 'COMPLETED_WITH_ERRORS' ? 'text-amber-300 border-amber-700/60 bg-amber-950/30' : 'text-indigo-300 border-indigo-700/60 bg-indigo-950/30'}`}>{activeBatch.status}</span>
              </div>
              <div className="text-xs text-slate-300 tabular-nums">
                {t('cronologsImported')}: {Number(activeBatch.importedRecords || 0).toLocaleString()} / {Number(activeBatch.totalRecords || 0).toLocaleString()} • {t('cronologsFailed')}: {Number(activeBatch.failedRecords || 0).toLocaleString()}
              </div>
              <div className="w-full h-2 bg-slate-800 rounded overflow-hidden">
                {(() => {
                  const totalN = Number(activeBatch.totalRecords || 0) || 1;
                  const doneN = Number(activeBatch.importedRecords || 0) + Number(activeBatch.failedRecords || 0);
                  const pct = Math.min(100, Math.round((doneN / totalN) * 100));
                  return <div className="h-full bg-indigo-500 transition-all" style={{ width: `${pct}%` }} />;
                })()}
              </div>
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
              <table className="w-full text-left rtl:text-right text-xs">
                <thead className="bg-slate-950/60 text-[11px] uppercase tracking-wider text-slate-400 border-b border-slate-800">
                  <tr>
                    <th className="px-3 py-2">ID</th>
                    <th className="px-3 py-2">{t('cronologsFilename')}</th>
                    <th className="px-3 py-2">{t('cronologsUploadedAt')}</th>
                    <th className="px-3 py-2">{t('cronologsUploadedBy')}</th>
                    <th className="px-3 py-2">{t('cronologsTotalRecords')}</th>
                    <th className="px-3 py-2">{t('cronologsImported')}</th>
                    <th className="px-3 py-2">{t('cronologsFailed')}</th>
                    <th className="px-3 py-2">{t('cronologsStatus')}</th>
                    <th className="px-3 py-2 text-center">{t('cronologsActions')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60 text-slate-300">
                  {batchesLoading && batches.length === 0 ? (
                    <tr><td colSpan={9} className="px-4 py-6 text-center text-slate-400">{t('loading')}</td></tr>
                  ) : batches.length === 0 ? (
                    <tr><td colSpan={9} className="px-4 py-6"><EmptyStateCard title={t('cronologsNoImportHistory')} /></td></tr>
                  ) : batches.map(b => (
                    <tr key={b.id} className="hover:bg-slate-800/30">
                      <td className="px-3 py-2 font-mono">#{b.id}</td>
                      <td className="px-3 py-2 max-w-xs truncate" title={b.filename}>{b.filename}</td>
                      <td className="px-3 py-2 whitespace-nowrap">{b.uploadedAt ? new Date(b.uploadedAt).toLocaleString() : '-'}</td>
                      <td className="px-3 py-2">{b.uploadedBy || '-'}</td>
                      <td className="px-3 py-2 tabular-nums">{Number(b.totalRecords || 0).toLocaleString()}</td>
                      <td className="px-3 py-2 tabular-nums text-emerald-300">{Number(b.importedRecords || 0).toLocaleString()}</td>
                      <td className="px-3 py-2 tabular-nums text-rose-300">{Number(b.failedRecords || 0).toLocaleString()}</td>
                      <td className="px-3 py-2"><span className="px-2 py-0.5 rounded-full border border-slate-700 text-[10px]">{b.status}</span></td>
                      <td className="px-3 py-2 text-center">
                        {b.status !== 'UNDONE' && (
                          <button type="button" onClick={() => handleUndo(b.id)} disabled={undoingId === b.id} className="inline-flex items-center gap-1 px-2 py-1 text-[11px] rounded border border-rose-800/60 text-rose-300 hover:bg-rose-950/30 disabled:opacity-50">
                            {undoingId === b.id ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Trash2 className="w-3 h-3" />}
                            {t('cronologsUndo')}
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Details Drawer/Modal */}
      {selectedRecord && (
        <div className="fixed inset-0 z-50 flex justify-end bg-slate-950/60 backdrop-blur-sm" onClick={() => setSelectedRecord(null)}>
          <div className="w-full max-w-3xl h-full bg-slate-900 border-l border-slate-800 shadow-2xl overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="sticky top-0 z-10 flex items-center justify-between px-4 py-3 border-b border-slate-800 bg-slate-900/95">
              <div>
                <h3 className="text-sm font-semibold text-slate-100">{t('cronologsRecordDetails')}</h3>
                <p className="text-[11px] text-slate-400">ID: {selectedRecord.id}</p>
              </div>
              <button type="button" onClick={() => setSelectedRecord(null)} className="p-1.5 text-slate-400 hover:text-white rounded hover:bg-slate-800"><X className="w-4 h-4" /></button>
            </div>
            <div className="p-4 space-y-4">
              {groupedFields.map(g => (
                <div key={g.group} className="rounded-xl border border-slate-800 bg-slate-950/40 p-3">
                  <div className="text-xs font-semibold uppercase tracking-wide text-indigo-300 mb-2">{t(g.labelKey)}</div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2">
                    {g.fields.map(f => (
                      <div key={f.field} className="min-w-0">
                        <div className="text-[10px] uppercase tracking-wide text-slate-500 break-words">{f.sourceName}</div>
                        <div className="text-xs text-slate-200 font-mono break-all mt-0.5">{isNullish(selectedRecord[f.field]) ? <span className="italic text-slate-500">NULL</span> : String(selectedRecord[f.field])}</div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Cronologs;
