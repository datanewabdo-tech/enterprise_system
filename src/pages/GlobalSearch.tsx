import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  CheckCircle2,
  ChevronDown,
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
  Globe,
  Layers,
  RefreshCw,
  Search,
  SlidersHorizontal,
  Target,
  X,
} from 'lucide-react';
import { useApp } from '../context/AppContext.js';
import { EmptyStateCard, ErrorRetryCard, TopProgressBar } from '../components/common/LoadingStates.js';

type SearchType =
  | 'IMSI' | 'IMEI' | 'TMSI' | 'PSTN' | 'UNIQUE_CALL_ID' | 'SYSTEM_ID'
  | 'MAC_ADDRESS' | 'BSSID' | 'GENERAL_TEXT' | 'MISSION' | 'MCC' | 'MNC' | 'LAC' | 'CELL_ID';

type MatchMode = 'exact' | 'partial';
type MissionSearchField = 'id' | 'label' | 'name' | 'location';

interface UnifiedResult {
  tableName: string;
  recordId: string;
  matchingColumns: string[];
  matchingValues: Array<string | null>;
  matchTypes: string[];
  recordData: Record<string, any>;
  missionId?: number | string | null;
  mission?: string | null;
  missionName?: string | null;
  missionLocation?: string | null;
  eventDate?: string | null;
  sourceFile?: string | null;
  importBatchId?: string | number | null;
}

interface SearchResponse {
  query: any;
  groupedResults: Record<string, UnifiedResult[]>;
  results: UnifiedResult[];
  missionSearch: { missions: any[]; selectedMissionIds: Array<string | number> } | null;
  statistics: { summaryCards: Record<string, number>; groupedBy: Record<string, Record<string, number>> };
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
  availableFilters: { sourceTables: string[]; matchingColumns: string[]; matchTypes: string[]; missionIds: string[] };
}

const SEARCH_TYPES: { value: SearchType; labelKey: string }[] = [
  { value: 'IMSI', labelKey: 'globalSearchTypeImsi' },
  { value: 'IMEI', labelKey: 'globalSearchTypeImei' },
  { value: 'TMSI', labelKey: 'globalSearchTypeTmsi' },
  { value: 'PSTN', labelKey: 'globalSearchTypePstn' },
  { value: 'UNIQUE_CALL_ID', labelKey: 'globalSearchTypeUniqueCallId' },
  { value: 'SYSTEM_ID', labelKey: 'globalSearchTypeSystemId' },
  { value: 'MAC_ADDRESS', labelKey: 'globalSearchTypeMac' },
  { value: 'BSSID', labelKey: 'globalSearchTypeBssid' },
  { value: 'GENERAL_TEXT', labelKey: 'globalSearchTypeGeneralText' },
  { value: 'MISSION', labelKey: 'globalSearchTypeMission' },
  { value: 'MCC', labelKey: 'globalSearchTypeMcc' },
  { value: 'MNC', labelKey: 'globalSearchTypeMnc' },
  { value: 'LAC', labelKey: 'globalSearchTypeLac' },
  { value: 'CELL_ID', labelKey: 'globalSearchTypeCellId' },
];

function isNullish(v: any): boolean { return v === null || v === undefined || v === ''; }
function toText(v: any): string {
  if (isNullish(v)) return 'NULL';
  if (typeof v === 'object') {
    try { return JSON.stringify(v); } catch { return String(v); }
  }
  return String(v);
}
function formatDate(v: any): string {
  if (isNullish(v)) return 'NULL';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return String(v);
  return d.toLocaleString();
}

export const GlobalSearch: React.FC = () => {
  const { apiFetch, authToken, t, addNotification } = useApp();

  // Search form
  const [searchType, setSearchType] = useState<SearchType>('IMSI');
  const [searchValue, setSearchValue] = useState('');
  const [matchMode, setMatchMode] = useState<MatchMode>('exact');
  const [missionSearchField, setMissionSearchField] = useState<MissionSearchField>('label');
  const [submittedQuery, setSubmittedQuery] = useState<{ searchType: SearchType; searchValue: string; matchMode: MatchMode; missionSearchField: MissionSearchField } | null>(null);

  // Filters
  const [showFilters, setShowFilters] = useState(false);
  const [filters, setFilters] = useState<Record<string, any>>({});
  const [activeFilters, setActiveFilters] = useState<Record<string, any>>({});
  const [selectedMissionIds, setSelectedMissionIds] = useState<string[]>([]);

  // Results
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<SearchResponse | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [sortBy, setSortBy] = useState('tableName');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');

  // UI
  const [selectedRecord, setSelectedRecord] = useState<UnifiedResult | null>(null);
  const [copiedKey, setCopiedKey] = useState('');
  const [exporting, setExporting] = useState(false);
  const [groupBy, setGroupBy] = useState<'table' | 'flat'>('table');

  const missionSearch = data?.missionSearch?.missions || [];

  const copyText = useCallback(async (value: string, key: string) => {
    if (isNullish(value)) return;
    try {
      await navigator.clipboard.writeText(value);
      setCopiedKey(key);
      window.setTimeout(() => setCopiedKey((curr) => (curr === key ? '' : curr)), 1200);
    } catch {
      try {
        const ta = document.createElement('textarea');
        ta.value = value;
        ta.style.position = 'fixed';
        ta.style.left = '-9999px';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
        setCopiedKey(key);
        window.setTimeout(() => setCopiedKey((curr) => (curr === key ? '' : curr)), 1200);
      } catch {
        addNotification({ title: 'Copy failed', message: '', type: 'error' });
      }
    }
  }, [addNotification]);

  const runSearch = useCallback(async (q?: { searchType: SearchType; searchValue: string; matchMode: MatchMode; missionSearchField: MissionSearchField }, opts?: { page?: number; pageSize?: number; sortBy?: string; sortOrder?: 'asc' | 'desc'; filters?: Record<string, any>; selectedMissionIds?: string[] }) => {
    const query = q || submittedQuery;
    if (!query || !query.searchValue.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const payload = {
        searchType: query.searchType,
        searchValue: query.searchValue.trim(),
        matchMode: query.matchMode,
        missionSearchField: query.searchType === 'MISSION' ? query.missionSearchField : undefined,
        page: opts?.page ?? page,
        pageSize: opts?.pageSize ?? pageSize,
        sortBy: opts?.sortBy ?? sortBy,
        sortOrder: opts?.sortOrder ?? sortOrder,
        filters: opts?.filters ?? activeFilters,
        selectedMissionIds: opts?.selectedMissionIds ?? selectedMissionIds,
      };
      const res = await apiFetch('/api/v1/global-search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) throw new Error(json?.error || t('globalSearchFailed'));
      setData(json);
      if (json?.pagination) {
        setPage(json.pagination.page || 1);
        setPageSize(json.pagination.pageSize || payload.pageSize);
      }
      // initialize selected missions when mission search returns results and none selected yet
      if (query.searchType === 'MISSION' && Array.isArray(json?.missionSearch?.missions) && (opts?.selectedMissionIds ?? selectedMissionIds).length === 0) {
        // keep empty to mean "all matched" by default? better select none = all for backend behavior in our impl; leave as-is
      }
    } catch (e: any) {
      setError(e?.message || t('globalSearchFailed'));
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [submittedQuery, page, pageSize, sortBy, sortOrder, activeFilters, selectedMissionIds, apiFetch, t]);

  const handleSubmit = (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!searchValue.trim()) return;
    const q = { searchType, searchValue: searchValue.trim(), matchMode, missionSearchField };
    setSubmittedQuery(q);
    setPage(1);
    setSelectedMissionIds([]);
    setActiveFilters({});
    setFilters({});
    runSearch(q, { page: 1, filters: {}, selectedMissionIds: [] });
  };

  useEffect(() => {
    if (!submittedQuery) return;
    runSearch(submittedQuery, { page, pageSize, sortBy, sortOrder, filters: activeFilters, selectedMissionIds });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, pageSize, sortBy, sortOrder, activeFilters, selectedMissionIds]);

  const applyFilters = () => {
    const cleaned: Record<string, any> = {};
    for (const [k, v] of Object.entries(filters)) {
      if (v === '' || v === null || v === undefined) continue;
      cleaned[k] = v;
    }
    setPage(1);
    setActiveFilters(cleaned);
  };

  const clearFilters = () => {
    setFilters({});
    setActiveFilters({});
    setPage(1);
  };

  const toggleMissionSelection = (id: string) => {
    setSelectedMissionIds((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);
    setPage(1);
  };

  const selectAllMissions = () => {
    const ids = missionSearch.map((m: any) => String(m.id));
    setSelectedMissionIds(ids);
    setPage(1);
  };
  const clearMissionSelection = () => { setSelectedMissionIds([]); setPage(1); };

  const handleSort = (field: string) => {
    if (sortBy === field) setSortOrder((o) => (o === 'asc' ? 'desc' : 'asc'));
    else { setSortBy(field); setSortOrder('asc'); }
    setPage(1);
  };

  const exportResults = async (format: 'csv' | 'xlsx' | 'pdf') => {
    if (!submittedQuery) return;
    setExporting(true);
    try {
      const body = {
        ...submittedQuery,
        format,
        filters: activeFilters,
        selectedMissionIds,
        sortBy,
        sortOrder,
        scope: 'all',
        includeMissionSummary: submittedQuery.searchType === 'MISSION',
      };
      const res = await apiFetch('/api/v1/global-search/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => null);
        throw new Error(json?.error || t('globalSearchExportFailed'));
      }
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = res.headers.get('X-Export-Filename') || `global_search.${format}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      addNotification({ title: t('globalSearchExportSuccess'), message: '', type: 'success' });
    } catch (e: any) {
      addNotification({ title: t('globalSearchExportFailed'), message: e?.message || t('globalSearchExportFailed'), type: 'error' });
    } finally {
      setExporting(false);
    }
  };

  const SortIcon = ({ field }: { field: string }) => {
    if (sortBy !== field) return <ArrowUpDown className="w-3 h-3 text-slate-600" />;
    return sortOrder === 'asc' ? <ArrowUp className="w-3 h-3 text-indigo-400" /> : <ArrowDown className="w-3 h-3 text-indigo-400" />;
  };

  const summaryCards = data?.statistics?.summaryCards || {};
  const groupedByTable = data?.groupedResults || {};
  const tableGroups = useMemo(() => Object.entries(groupedByTable).sort(([a], [b]) => a.localeCompare(b)), [groupedByTable]);
  const pagination = data?.pagination;

  const renderMatchBadge = (matchType: string) => {
    const cls = matchType === 'exact' ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
      : matchType === 'generic' ? 'bg-amber-500/15 text-amber-300 border-amber-500/30'
      : matchType === 'legacy_text' ? 'bg-fuchsia-500/15 text-fuchsia-300 border-fuchsia-500/30'
      : 'bg-sky-500/15 text-sky-300 border-sky-500/30';
    const label = matchType === 'exact' ? t('globalSearchMatchExact')
      : matchType === 'generic' ? t('globalSearchMatchGeneric')
      : matchType === 'legacy_text' ? t('globalSearchMatchLegacy')
      : t('globalSearchMatchPartial');
    return <span className={`inline-flex items-center px-1.5 py-0.5 rounded border text-[10px] font-medium ${cls}`}>{label}</span>;
  };

  const renderValueCell = (v: any, copyKey: string) => {
    if (isNullish(v)) return <span className="text-slate-500 italic">NULL</span>;
    const text = String(v);
    const short = text.length > 120 ? text.slice(0, 120) + '…' : text;
    return (
      <div className="flex items-start gap-1.5 min-w-0">
        <span className="font-mono text-[11px] text-slate-200 break-all" title={text}>{short}</span>
        <button type="button" onClick={() => copyText(text, copyKey)} className="p-0.5 text-slate-500 hover:text-indigo-400 shrink-0" title={t('activityLogsCopy')}>
          {copiedKey === copyKey ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
        </button>
      </div>
    );
  };

  const renderResultRow = (r: UnifiedResult, idx: number) => {
    const key = `${r.tableName}:${r.recordId}:${idx}`;
    return (
      <tr key={key} className="hover:bg-slate-800/30 align-top">
        <td className="px-3 py-2 text-xs font-mono text-slate-300 whitespace-nowrap">{r.tableName}</td>
        <td className="px-3 py-2 text-xs font-mono text-slate-200 whitespace-nowrap">{r.recordId}</td>
        <td className="px-3 py-2 text-xs text-slate-300 min-w-[180px]">
          <div className="space-y-1">
            {r.matchingColumns.map((c, i) => (
              <div key={i} className="flex flex-wrap items-center gap-1.5">
                <span className="font-mono text-[11px] text-indigo-300">{c}</span>
                {renderMatchBadge(r.matchTypes[i] || 'partial')}
              </div>
            ))}
          </div>
        </td>
        <td className="px-3 py-2 text-xs text-slate-300 min-w-[220px] max-w-[360px]">
          <div className="space-y-1.5">
            {r.matchingValues.map((v, i) => (
              <div key={i}>{renderValueCell(v, `${key}:val:${i}`)}</div>
            ))}
          </div>
        </td>
        <td className="px-3 py-2 text-xs text-slate-300 min-w-[180px]">
          {isNullish(r.missionId) ? <span className="text-slate-500">—</span> : (
            <div className="space-y-0.5">
              <div className="font-mono font-semibold text-amber-300">ID: {String(r.missionId)}</div>
              {r.mission && <div className="text-slate-300 truncate" title={String(r.mission)}>{String(r.mission)}</div>}
              {r.missionName && <div className="text-slate-400 truncate" title={String(r.missionName)}>{String(r.missionName)}</div>}
            </div>
          )}
        </td>
        <td className="px-3 py-2 text-xs text-slate-400 whitespace-nowrap">{isNullish(r.eventDate) ? '—' : formatDate(r.eventDate)}</td>
        <td className="px-3 py-2 text-center whitespace-nowrap">
          <button type="button" onClick={() => setSelectedRecord(r)} className="p-1.5 text-slate-400 hover:text-indigo-400 rounded hover:bg-slate-800" title={t('globalSearchViewRecord')}>
            <Eye className="w-4 h-4" />
          </button>
        </td>
      </tr>
    );
  };

  const searchTypeLabel = (val: SearchType) => t((SEARCH_TYPES.find(x => x.value === val)?.labelKey || 'globalSearchTypeGeneralText') as any);

  return (
    <div className="space-y-5 animate-fade-in">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-100 flex items-center gap-2">
            <Globe className="w-5 h-5 text-indigo-400" />
            {t('globalSearchTitle')}
          </h1>
          <p className="text-xs text-slate-400 mt-0.5">{t('globalSearchDescription')}</p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="bg-slate-900/70 border border-slate-800 rounded-xl p-4 space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-12 gap-3 items-end">
          <div className="xl:col-span-3">
            <label className="block text-xs font-semibold text-slate-400 mb-1">{t('globalSearchSearchType')}</label>
            <select
              value={searchType}
              onChange={(e) => {
                const v = e.target.value as SearchType;
                setSearchType(v);
                if (v === 'MISSION') setMatchMode('partial');
              }}
              className="w-full h-10 px-3 text-sm bg-slate-950 border border-slate-800 rounded-lg text-slate-200 focus:outline-none focus:border-indigo-500"
            >
              {SEARCH_TYPES.map((opt) => (
                <option key={opt.value} value={opt.value}>{t(opt.labelKey as any)}</option>
              ))}
            </select>
          </div>

          {searchType === 'MISSION' && (
            <div className="xl:col-span-2">
              <label className="block text-xs font-semibold text-slate-400 mb-1">{t('globalSearchMissionField')}</label>
              <select
                value={missionSearchField}
                onChange={(e) => setMissionSearchField(e.target.value as MissionSearchField)}
                className="w-full h-10 px-3 text-sm bg-slate-950 border border-slate-800 rounded-lg text-slate-200 focus:outline-none focus:border-indigo-500"
              >
                <option value="id">{t('globalSearchMissionById')}</option>
                <option value="label">{t('globalSearchMissionByLabel')}</option>
                <option value="name">{t('globalSearchMissionByName')}</option>
                <option value="location">{t('globalSearchMissionByLocation')}</option>
              </select>
            </div>
          )}

          <div className={searchType === 'MISSION' ? 'xl:col-span-4' : 'xl:col-span-6'}>
            <label className="block text-xs font-semibold text-slate-400 mb-1">{t('globalSearchValue')}</label>
            <div className="relative">
              <Search className="absolute left-3 top-3 w-4 h-4 text-slate-500 rtl:right-3 rtl:left-auto" />
              <input
                value={searchValue}
                onChange={(e) => setSearchValue(e.target.value)}
                placeholder={t('globalSearchValuePlaceholder')}
                className="w-full h-10 pl-9 pr-3 rtl:pr-9 rtl:pl-3 text-sm bg-slate-950 border border-slate-800 rounded-lg text-slate-200 placeholder-slate-500 focus:outline-none focus:border-indigo-500"
              />
            </div>
          </div>

          <div className="xl:col-span-2">
            <label className="block text-xs font-semibold text-slate-400 mb-1">{t('globalSearchMatchMode')}</label>
            <select
              value={matchMode}
              onChange={(e) => setMatchMode(e.target.value as MatchMode)}
              className="w-full h-10 px-3 text-sm bg-slate-950 border border-slate-800 rounded-lg text-slate-200 focus:outline-none focus:border-indigo-500"
            >
              <option value="exact">{t('globalSearchMatchModeExact')}</option>
              <option value="partial">{t('globalSearchMatchModePartial')}</option>
            </select>
          </div>

          <div className="xl:col-span-1 flex gap-2">
            <button type="submit" disabled={loading || !searchValue.trim()} className="h-10 flex-1 px-4 text-sm font-semibold rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white flex items-center justify-center gap-2">
              {loading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
              <span className="hidden sm:inline">{t('search')}</span>
            </button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-slate-800/60">
          <button type="button" onClick={() => setShowFilters(v => !v)} className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border border-slate-700 text-slate-300 hover:bg-slate-800">
            <SlidersHorizontal className="w-3.5 h-3.5" /> {t('globalSearchAdvancedFilters')}
            <ChevronDown className={`w-3.5 h-3.5 transition-transform ${showFilters ? 'rotate-180' : ''}`} />
          </button>
          {submittedQuery && (
            <>
              <button type="button" onClick={() => runSearch()} disabled={loading} className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border border-slate-700 text-slate-300 hover:bg-slate-800 disabled:opacity-50">
                <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} /> {t('refresh')}
              </button>
              <div className="ml-auto flex items-center gap-2 flex-wrap">
                <span className="text-xs text-slate-400">{t('export')}:</span>
                <button type="button" onClick={() => exportResults('csv')} disabled={exporting || !data || (pagination?.total || 0) === 0} className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs rounded-lg border border-slate-700 text-slate-300 hover:bg-slate-800 disabled:opacity-50"><Download className="w-3.5 h-3.5" /> CSV</button>
                <button type="button" onClick={() => exportResults('xlsx')} disabled={exporting || !data || (pagination?.total || 0) === 0} className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs rounded-lg border border-slate-700 text-slate-300 hover:bg-slate-800 disabled:opacity-50"><FileSpreadsheet className="w-3.5 h-3.5" /> XLSX</button>
                <button type="button" onClick={() => exportResults('pdf')} disabled={exporting || !data || (pagination?.total || 0) === 0} className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs rounded-lg border border-slate-700 text-slate-300 hover:bg-slate-800 disabled:opacity-50"><FileText className="w-3.5 h-3.5" /> PDF</button>
              </div>
            </>
          )}
        </div>

        {showFilters && (
          <div className="rounded-lg border border-slate-800 bg-slate-950/50 p-3 space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
              <div>
                <label className="block text-slate-400 mb-1">{t('globalSearchFilterSourceTable')}</label>
                <input value={filters.sourceTable || ''} onChange={e => setFilters(f => ({ ...f, sourceTable: e.target.value }))} placeholder="e.g. registrations" className="w-full h-8 px-2.5 bg-slate-900 border border-slate-700 rounded text-slate-200 placeholder-slate-500" />
              </div>
              <div>
                <label className="block text-slate-400 mb-1">{t('globalSearchFilterMatchingColumn')}</label>
                <input value={filters.matchingColumn || ''} onChange={e => setFilters(f => ({ ...f, matchingColumn: e.target.value }))} placeholder="e.g. imsi" className="w-full h-8 px-2.5 bg-slate-900 border border-slate-700 rounded text-slate-200 placeholder-slate-500" />
              </div>
              <div>
                <label className="block text-slate-400 mb-1">{t('globalSearchFilterMissionId')}</label>
                <input value={filters.missionId || ''} onChange={e => setFilters(f => ({ ...f, missionId: e.target.value }))} className="w-full h-8 px-2.5 bg-slate-900 border border-slate-700 rounded text-slate-200" />
              </div>
              <div>
                <label className="block text-slate-400 mb-1">{t('globalSearchFilterMissionLabel')}</label>
                <input value={filters.missionLabel || ''} onChange={e => setFilters(f => ({ ...f, missionLabel: e.target.value }))} className="w-full h-8 px-2.5 bg-slate-900 border border-slate-700 rounded text-slate-200" />
              </div>
              <div>
                <label className="block text-slate-400 mb-1">{t('globalSearchFilterMissionName')}</label>
                <input value={filters.missionName || ''} onChange={e => setFilters(f => ({ ...f, missionName: e.target.value }))} className="w-full h-8 px-2.5 bg-slate-900 border border-slate-700 rounded text-slate-200" />
              </div>
              <div>
                <label className="block text-slate-400 mb-1">{t('globalSearchFilterMissionLocation')}</label>
                <input value={filters.missionLocation || ''} onChange={e => setFilters(f => ({ ...f, missionLocation: e.target.value }))} className="w-full h-8 px-2.5 bg-slate-900 border border-slate-700 rounded text-slate-200" />
              </div>
              <div>
                <label className="block text-slate-400 mb-1">{t('globalSearchFilterCountry')}</label>
                <input value={filters.country || ''} onChange={e => setFilters(f => ({ ...f, country: e.target.value }))} className="w-full h-8 px-2.5 bg-slate-900 border border-slate-700 rounded text-slate-200" />
              </div>
              <div>
                <label className="block text-slate-400 mb-1">MCC / MNC</label>
                <div className="flex gap-2"><input value={filters.mcc || ''} onChange={e => setFilters(f => ({ ...f, mcc: e.target.value }))} placeholder="MCC" className="w-1/2 h-8 px-2.5 bg-slate-900 border border-slate-700 rounded text-slate-200" /><input value={filters.mnc || ''} onChange={e => setFilters(f => ({ ...f, mnc: e.target.value }))} placeholder="MNC" className="w-1/2 h-8 px-2.5 bg-slate-900 border border-slate-700 rounded text-slate-200" /></div>
              </div>
              <div>
                <label className="block text-slate-400 mb-1">BTS / RAT</label>
                <div className="flex gap-2"><input value={filters.btsName || ''} onChange={e => setFilters(f => ({ ...f, btsName: e.target.value }))} placeholder="BTS" className="w-1/2 h-8 px-2.5 bg-slate-900 border border-slate-700 rounded text-slate-200" /><input value={filters.rat || ''} onChange={e => setFilters(f => ({ ...f, rat: e.target.value }))} placeholder="RAT" className="w-1/2 h-8 px-2.5 bg-slate-900 border border-slate-700 rounded text-slate-200" /></div>
              </div>
              <div>
                <label className="block text-slate-400 mb-1">{t('globalSearchFilterRecordType')} / {t('globalSearchFilterSourceFile')}</label>
                <div className="flex gap-2"><input value={filters.recordType || ''} onChange={e => setFilters(f => ({ ...f, recordType: e.target.value }))} placeholder="record_type" className="w-1/2 h-8 px-2.5 bg-slate-900 border border-slate-700 rounded text-slate-200" /><input value={filters.sourceFile || ''} onChange={e => setFilters(f => ({ ...f, sourceFile: e.target.value }))} placeholder="source_file" className="w-1/2 h-8 px-2.5 bg-slate-900 border border-slate-700 rounded text-slate-200" /></div>
              </div>
              <div>
                <label className="block text-slate-400 mb-1">{t('globalSearchFilterImportBatch')}</label>
                <input value={filters.importBatchId || ''} onChange={e => setFilters(f => ({ ...f, importBatchId: e.target.value }))} className="w-full h-8 px-2.5 bg-slate-900 border border-slate-700 rounded text-slate-200" />
              </div>
              <div>
                <label className="block text-slate-400 mb-1">{t('globalSearchFilterDateRange')}</label>
                <div className="flex gap-2"><input type="date" value={filters.dateFrom || ''} onChange={e => setFilters(f => ({ ...f, dateFrom: e.target.value }))} className="w-1/2 h-8 px-2 bg-slate-900 border border-slate-700 rounded text-slate-200" /><input type="date" value={filters.dateTo || ''} onChange={e => setFilters(f => ({ ...f, dateTo: e.target.value }))} className="w-1/2 h-8 px-2 bg-slate-900 border border-slate-700 rounded text-slate-200" /></div>
              </div>
              {searchType === 'MISSION' && (
                <div className="sm:col-span-2 lg:col-span-2 flex items-end gap-4">
                  <label className="inline-flex items-center gap-2 text-slate-300 cursor-pointer">
                    <input type="checkbox" checked={filters.includeLegacyTextMatches !== false} onChange={e => setFilters(f => ({ ...f, includeLegacyTextMatches: e.target.checked }))} className="rounded bg-slate-900 border-slate-700 text-indigo-600 focus:ring-0" />
                    <span>{t('globalSearchIncludeLegacy')}</span>
                  </label>
                  <label className="inline-flex items-center gap-2 text-slate-300 cursor-pointer">
                    <input type="checkbox" checked={filters.excludeLegacyTextMatches === true} onChange={e => setFilters(f => ({ ...f, excludeLegacyTextMatches: e.target.checked, includeLegacyTextMatches: e.target.checked ? false : (f.includeLegacyTextMatches !== false) }))} className="rounded bg-slate-900 border-slate-700 text-indigo-600 focus:ring-0" />
                    <span>{t('globalSearchExcludeLegacy')}</span>
                  </label>
                </div>
              )}
            </div>
            <div className="flex items-center gap-2">
              <button type="button" onClick={applyFilters} className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white">{t('applyFilters')}</button>
              <button type="button" onClick={clearFilters} className="px-3 py-1.5 text-xs rounded-lg border border-slate-700 text-slate-300 hover:bg-slate-800">{t('clearFilters')}</button>
            </div>
          </div>
        )}
      </form>

      {error && <ErrorRetryCard compact message={error} onRetry={() => runSearch()} />}
      <TopProgressBar active={loading} />

      {!submittedQuery && !loading && !error && (
        <EmptyStateCard title={t('globalSearchEmptyTitle')} description={t('globalSearchEmptyHint')} icon={<Search className="w-10 h-10 text-slate-500" />} />
      )}

      {submittedQuery && data && (
        <>
          {/* Mission summary & selection */}
          {submittedQuery.searchType === 'MISSION' && (
            <div className="bg-slate-900/70 border border-slate-800 rounded-xl p-4 space-y-3">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <h2 className="text-sm font-semibold text-slate-100 flex items-center gap-2"><Target className="w-4 h-4 text-indigo-400" />{t('globalSearchMissionSummary')}</h2>
                <div className="flex items-center gap-2 text-xs">
                  <button type="button" onClick={selectAllMissions} className="px-2.5 py-1 rounded border border-slate-700 text-slate-300 hover:bg-slate-800">{t('globalSearchSelectAllMissions')}</button>
                  <button type="button" onClick={clearMissionSelection} className="px-2.5 py-1 rounded border border-slate-700 text-slate-300 hover:bg-slate-800">{t('globalSearchClearMissionSelection')}</button>
                </div>
              </div>
              {missionSearch.length === 0 ? (
                <div className="text-sm text-slate-400 flex items-center gap-2"><AlertTriangle className="w-4 h-4 text-amber-400" />{t('globalSearchNoMissionsFound')}</div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                  {missionSearch.map((m: any) => {
                    const idStr = String(m.id);
                    const selected = selectedMissionIds.length === 0 ? true : selectedMissionIds.includes(idStr);
                    return (
                      <div key={idStr} className={`rounded-lg border p-3 space-y-2 ${selected ? 'border-indigo-500/60 bg-indigo-500/5' : 'border-slate-800 bg-slate-950/40'}`}>
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="inline-flex items-center px-2 py-0.5 rounded bg-amber-500/15 border border-amber-500/30 text-amber-200 font-mono font-bold text-sm">Mission ID: {idStr}</span>
                              {missionSearch.filter((x: any) => String(x.mission || '') === String(m.mission || '') && x.mission).length > 1 && (
                                <span className="text-[10px] px-1.5 py-0.5 rounded bg-fuchsia-500/15 border border-fuchsia-500/30 text-fuchsia-300">{t('globalSearchDuplicateLabel')}</span>
                              )}
                            </div>
                            <div className="text-sm font-medium text-slate-100 mt-1 truncate" title={String(m.mission || '')}>{m.mission || <span className="text-slate-500 italic">NULL</span>}</div>
                            <div className="text-xs text-slate-400 truncate" title={String(m.missionName || '')}>{m.missionName || '—'}</div>
                            <div className="text-xs text-slate-500 truncate" title={String(m.location || '')}>{m.location || '—'}</div>
                          </div>
                          <label className="inline-flex items-center gap-1.5 text-xs text-slate-300 cursor-pointer shrink-0">
                            <input type="checkbox" checked={selectedMissionIds.length === 0 ? true : selectedMissionIds.includes(idStr)} onChange={() => {
                              // if "all selected by default" (empty array), initialize to all then toggle
                              if (selectedMissionIds.length === 0) {
                                const all = missionSearch.map((x: any) => String(x.id));
                                setSelectedMissionIds(all.filter((x: string) => x !== idStr));
                              } else {
                                toggleMissionSelection(idStr);
                              }
                              setPage(1);
                            }} className="rounded bg-slate-900 border-slate-700 text-indigo-600 focus:ring-0" />
                            <span>{t('globalSearchIncludeMission')}</span>
                          </label>
                        </div>
                        <div className="text-[11px] text-slate-400 flex flex-wrap gap-x-3 gap-y-1">
                          <span>{t('globalSearchAssociatedTotal')}: <strong className="text-slate-200">{Number(m.associatedRecordsTotal || 0).toLocaleString()}</strong></span>
                          {m.associatedRecordCounts && Object.entries(m.associatedRecordCounts).filter(([,v]) => Number(v) > 0).slice(0, 4).map(([k,v]) => (
                            <span key={k}>{k}: <strong className="text-slate-300">{Number(v).toLocaleString()}</strong></span>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
              <p className="text-[11px] text-slate-500">{t('globalSearchMissionIdDisambiguationHint')}</p>
            </div>
          )}

          {/* Statistics */}
          <div className="bg-slate-900/70 border border-slate-800 rounded-xl p-4 space-y-3">
            <h2 className="text-sm font-semibold text-slate-100 flex items-center gap-2"><Layers className="w-4 h-4 text-indigo-400" />{t('globalSearchStatistics')}</h2>
            <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-2">
              {[
                ['totalUniqueMatchingRecords', t('globalSearchStatTotalMatches')],
                ['tablesContainingMatches', t('globalSearchStatTables')],
                ['matchingRegistrations', t('globalSearchStatRegistrations')],
                ['matchingTargets', t('globalSearchStatTargets')],
                ['matchingCronologs', t('globalSearchStatCronologs')],
                ['matchingActivityLogs', t('globalSearchStatActivityLogs')],
                ['matchingSmsCalls', t('globalSearchStatSmsCalls')],
                ['matchingWifiAccessPoints', t('globalSearchStatWifiAps')],
                ['matchingWifiClients', t('globalSearchStatWifiClients')],
                ['distinctMissionIds', t('globalSearchStatDistinctMissions')],
                ['associatedRecordsForSelectedMissions', t('globalSearchStatAssociatedMissionRecords')],
                ['uniqueImportBatches', t('globalSearchStatImportBatches')],
              ].map(([key, label]) => (
                <div key={key} className="rounded-lg border border-slate-800 bg-slate-950/50 p-2.5">
                  <div className="text-[11px] text-slate-400 leading-tight">{label}</div>
                  <div className="text-lg font-semibold text-slate-100 tabular-nums">{Number((summaryCards as any)[key] || 0).toLocaleString()}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Results */}
          <div className="bg-slate-900/70 border border-slate-800 rounded-xl overflow-hidden">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-4 py-3 border-b border-slate-800">
              <div className="text-sm font-semibold text-slate-100 flex items-center gap-2">
                <Database className="w-4 h-4 text-indigo-400" />
                {t('globalSearchResults')}
                {pagination && <span className="text-xs font-normal text-slate-400">({pagination.total.toLocaleString()})</span>}
              </div>
              <div className="flex items-center gap-2 flex-wrap text-xs">
                <label className="text-slate-400">{t('globalSearchGroupBy')}:</label>
                <select value={groupBy} onChange={e => setGroupBy(e.target.value as any)} className="h-8 px-2 bg-slate-950 border border-slate-700 rounded text-slate-200">
                  <option value="table">{t('globalSearchGroupByTable')}</option>
                  <option value="flat">{t('globalSearchGroupByFlat')}</option>
                </select>
                <label className="text-slate-400 ml-2">{t('activityLogsPageSize')}:</label>
                <select value={pageSize} onChange={e => { setPageSize(Number(e.target.value)); setPage(1); }} className="h-8 px-2 bg-slate-950 border border-slate-700 rounded text-slate-200">
                  {[10,25,50,100,200].map(n => <option key={n} value={n}>{n}</option>)}
                </select>
              </div>
            </div>

            {!loading && (!data.results || data.results.length === 0) ? (
              <div className="p-6"><EmptyStateCard title={t('globalSearchNoResults')} description={t('globalSearchNoResultsHint')} /></div>
            ) : groupBy === 'flat' ? (
              <div className="overflow-x-auto">
                <table className="w-full text-left rtl:text-right min-w-[1100px]">
                  <thead className="bg-slate-950/60 text-[11px] font-semibold text-slate-400 uppercase tracking-wider border-b border-slate-800">
                    <tr>
                      <th className="px-3 py-2 cursor-pointer select-none" onClick={() => handleSort('tableName')}><div className="flex items-center gap-1">{t('globalSearchColTable')} <SortIcon field="tableName" /></div></th>
                      <th className="px-3 py-2 cursor-pointer select-none" onClick={() => handleSort('recordId')}><div className="flex items-center gap-1">{t('globalSearchColRecordId')} <SortIcon field="recordId" /></div></th>
                      <th className="px-3 py-2">{t('globalSearchColMatchingColumns')}</th>
                      <th className="px-3 py-2">{t('globalSearchColMatchingValues')}</th>
                      <th className="px-3 py-2 cursor-pointer select-none" onClick={() => handleSort('missionId')}><div className="flex items-center gap-1">{t('globalSearchColMission')} <SortIcon field="missionId" /></div></th>
                      <th className="px-3 py-2 cursor-pointer select-none" onClick={() => handleSort('eventDate')}><div className="flex items-center gap-1">{t('globalSearchColDate')} <SortIcon field="eventDate" /></div></th>
                      <th className="px-3 py-2 text-center">{t('globalSearchColActions')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60">{data.results.map((r, i) => renderResultRow(r, i))}</tbody>
                </table>
              </div>
            ) : (
              <div className="divide-y divide-slate-800">
                {tableGroups.map(([tableName, rows]) => (
                  <div key={tableName}>
                    <div className="px-4 py-2.5 bg-slate-950/40 flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 text-sm font-semibold text-slate-200">
                        <Database className="w-4 h-4 text-indigo-400" />
                        <span>{tableName}</span>
                        <span className="text-xs font-normal text-slate-400">({rows.length} {t('globalSearchOnPage')})</span>
                      </div>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-left rtl:text-right min-w-[1100px]">
                        <thead className="bg-slate-950/30 text-[11px] font-semibold text-slate-400 uppercase tracking-wider border-b border-slate-800/60">
                          <tr>
                            <th className="px-3 py-2">{t('globalSearchColTable')}</th>
                            <th className="px-3 py-2">{t('globalSearchColRecordId')}</th>
                            <th className="px-3 py-2">{t('globalSearchColMatchingColumns')}</th>
                            <th className="px-3 py-2">{t('globalSearchColMatchingValues')}</th>
                            <th className="px-3 py-2">{t('globalSearchColMission')}</th>
                            <th className="px-3 py-2">{t('globalSearchColDate')}</th>
                            <th className="px-3 py-2 text-center">{t('globalSearchColActions')}</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-800/60">{rows.map((r, i) => renderResultRow(r, i))}</tbody>
                      </table>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {pagination && pagination.total > 0 && (
              <div className="flex flex-col sm:flex-row items-center justify-between gap-3 px-4 py-3 border-t border-slate-800 text-xs text-slate-400">
                <div className="tabular-nums">{t('showing')} <strong className="text-slate-200">{data.results.length}</strong> {t('of')} <strong className="text-slate-200">{pagination.total.toLocaleString()}</strong> {t('recordsCount')}</div>
                <div className="flex items-center gap-2">
                  <button type="button" onClick={() => setPage(1)} disabled={page <= 1} className="p-1.5 rounded border border-slate-800 hover:bg-slate-800 disabled:opacity-40"><ChevronsLeft className="w-4 h-4 rtl:rotate-180" /></button>
                  <button type="button" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1} className="p-1.5 rounded border border-slate-800 hover:bg-slate-800 disabled:opacity-40"><ChevronLeft className="w-4 h-4 rtl:rotate-180" /></button>
                  <span className="tabular-nums">{pagination.page} / {pagination.totalPages}</span>
                  <button type="button" onClick={() => setPage(p => Math.min(pagination.totalPages, p + 1))} disabled={page >= pagination.totalPages} className="p-1.5 rounded border border-slate-800 hover:bg-slate-800 disabled:opacity-40"><ChevronRight className="w-4 h-4 rtl:rotate-180" /></button>
                  <button type="button" onClick={() => setPage(pagination.totalPages)} disabled={page >= pagination.totalPages} className="p-1.5 rounded border border-slate-800 hover:bg-slate-800 disabled:opacity-40"><ChevronsRight className="w-4 h-4 rtl:rotate-180" /></button>
                </div>
              </div>
            )}
          </div>
        </>
      )}

      {selectedRecord && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <div className="absolute inset-0 bg-black/50" onClick={() => setSelectedRecord(null)} />
          <div className="relative w-full max-w-3xl h-full bg-slate-900 border-l border-slate-800 shadow-2xl overflow-y-auto">
            <div className="sticky top-0 z-10 flex items-center justify-between px-4 py-3 border-b border-slate-800 bg-slate-900/95">
              <div className="min-w-0">
                <h3 className="text-sm font-semibold text-slate-100">{t('globalSearchRecordDetails')}</h3>
                <p className="text-[11px] text-slate-400 font-mono truncate">{selectedRecord.tableName} #{selectedRecord.recordId}</p>
              </div>
              <button type="button" onClick={() => setSelectedRecord(null)} className="p-1.5 text-slate-400 hover:text-white rounded hover:bg-slate-800"><X className="w-4 h-4" /></button>
            </div>
            <div className="p-4 space-y-4">
              <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-3 space-y-2">
                <div className="text-xs font-semibold uppercase tracking-wide text-indigo-300">{t('globalSearchMatchSummary')}</div>
                <div className="space-y-1.5">
                  {selectedRecord.matchingColumns.map((c, i) => (
                    <div key={i} className="flex flex-wrap items-start gap-2 text-xs">
                      <span className="font-mono text-indigo-300 min-w-[140px]">{c}</span>
                      {renderMatchBadge(selectedRecord.matchTypes[i] || 'partial')}
                      <span className="font-mono text-slate-200 break-all flex-1">{isNullish(selectedRecord.matchingValues[i]) ? 'NULL' : String(selectedRecord.matchingValues[i])}</span>
                      {!isNullish(selectedRecord.matchingValues[i]) && (
                        <button type="button" onClick={() => copyText(String(selectedRecord.matchingValues[i]), `detail-match-${i}`)} className="p-0.5 text-slate-500 hover:text-indigo-400" title={t('activityLogsCopy')}>
                          {copiedKey === `detail-match-${i}` ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {(selectedRecord.missionId != null || selectedRecord.mission || selectedRecord.missionName) && (
                <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-3">
                  <div className="text-xs font-semibold uppercase tracking-wide text-indigo-300 mb-2">{t('globalSearchMissionContext')}</div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                    <div><span className="text-slate-400">Mission ID: </span><span className="font-mono font-semibold text-amber-300">{selectedRecord.missionId ?? '—'}</span></div>
                    <div><span className="text-slate-400">{t('globalSearchMissionByLabel')}: </span><span className="text-slate-200">{selectedRecord.mission ?? '—'}</span></div>
                    <div><span className="text-slate-400">{t('globalSearchMissionByName')}: </span><span className="text-slate-200">{selectedRecord.missionName ?? '—'}</span></div>
                    <div><span className="text-slate-400">{t('globalSearchMissionByLocation')}: </span><span className="text-slate-200">{selectedRecord.missionLocation ?? '—'}</span></div>
                  </div>
                </div>
              )}

              <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-3">
                <div className="text-xs font-semibold uppercase tracking-wide text-indigo-300 mb-2">{t('globalSearchFullRecord')}</div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2">
                  {Object.entries(selectedRecord.recordData || {}).map(([k, v]) => (
                    <div key={k} className="min-w-0">
                      <div className="text-[10px] uppercase tracking-wide text-slate-500 truncate" title={k}>{k}</div>
                      <div className="text-xs text-slate-200 font-mono break-all flex items-start gap-1.5">
                        <span className="flex-1">{isNullish(v) ? <span className="text-slate-500 italic">NULL</span> : (typeof v === 'object' ? JSON.stringify(v) : String(v))}</span>
                        {!isNullish(v) && (
                          <button type="button" onClick={() => copyText(typeof v === 'object' ? JSON.stringify(v) : String(v), `detail-${k}-${selectedRecord.tableName}-${selectedRecord.recordId}`)} className="p-0.5 text-slate-500 hover:text-indigo-400 shrink-0" title={t('activityLogsCopy')}>
                            {copiedKey === `detail-${k}-${selectedRecord.tableName}-${selectedRecord.recordId}` ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
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
    </div>
  );
};
