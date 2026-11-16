import React, { useState, useEffect, useMemo } from 'react';
import { useApp } from '../../context/AppContext.js';
import { TableResponse, ColumnMeta, FilterCondition, FilterOperator } from '../../types/index.js';
import { useAsyncResource } from '../../hooks/useAsyncResource.js';
import {
  TopProgressBar,
  RefreshingBadge,
  TableSkeletonRows,
  EmptyStateCard,
  ErrorRetryCard,
} from './LoadingStates.js';
import {
  Search,
  Filter,
  SlidersHorizontal,
  Download,
  Plus,
  RefreshCw,
  Eye,
  EyeOff,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Trash2,
  Edit2,
  FileSpreadsheet,
  X,
  AlertCircle,
} from 'lucide-react';

interface DataTableProps {
  tableName: string;
  title: string;
  description?: string;
  onRowClick?: (record: any) => void;
  onEditRecord?: (record: any) => void;
  onDeleteRecord?: (record: any) => void;
  onCreateRecord?: () => void;
  refreshTrigger?: number;
}

export const DataTable: React.FC<DataTableProps> = ({
  tableName,
  title,
  description,
  onRowClick,
  onEditRecord,
  onDeleteRecord,
  onCreateRecord,
  refreshTrigger = 0,
}) => {
  const { t, activeMission, globalSearch, apiFetch, authToken } = useApp();

  const [columns, setColumns] = useState<ColumnMeta[]>([]);
  const [visibleColumns, setVisibleColumns] = useState<string[]>([]);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState<string>('id');
  const [sortOrder, setSortOrder] = useState<'ASC' | 'DESC'>('DESC');
  const [unmask, setUnmask] = useState(false);

  // Filter Builder State
  const [filterBuilderOpen, setFilterBuilderOpen] = useState(false);
  const [filters, setFilters] = useState<FilterCondition[]>([]);
  const [appliedFilters, setAppliedFilters] = useState<FilterCondition[]>([]);
  const [columnMenuOpen, setColumnMenuOpen] = useState(false);

  // Export state
  const [exportingFormat, setExportingFormat] = useState<'xlsx' | 'csv' | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);

  // Sync with globalSearch if set
  useEffect(() => {
    if (globalSearch) {
      setSearch(globalSearch);
      setPage(1);
    }
  }, [globalSearch]);

  // Reset pagination/schema when switching tables
  useEffect(() => {
    setColumns([]);
    setVisibleColumns([]);
    setPage(1);
    setFilters([]);
    setAppliedFilters([]);
    setExportError(null);
  }, [tableName]);

  const filtersJson = useMemo(
    () => (appliedFilters.length > 0 ? JSON.stringify(appliedFilters) : ''),
    [appliedFilters]
  );

  const tableRes = useAsyncResource<TableResponse>(
    async signal => {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: String(pageSize),
        sortBy,
        sortOrder,
        unmask: String(unmask),
      });

      if (activeMission && activeMission !== 'ALL') {
        params.append('mission', activeMission);
      }
      if (search.trim()) {
        params.append('search', search.trim());
      }
      if (filtersJson) {
        params.append('filters', filtersJson);
      }

      const res = await apiFetch(`/api/v1/tables/${tableName}?${params.toString()}`, { signal });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(json?.error || `Failed to fetch ${tableName} data`);
      }
      return json as TableResponse;
    },
    [tableName, page, pageSize, sortBy, sortOrder, search, activeMission, filtersJson, unmask, refreshTrigger, authToken],
    {
      enabled: Boolean(authToken),
      keepPreviousData: true,
      isEmpty: json => !json.data || json.data.length === 0,
    }
  );

  useEffect(() => {
    const cols = tableRes.data?.columns;
    if (cols && cols.length > 0 && columns.length === 0) {
      setColumns(cols);
      setVisibleColumns(cols.slice(0, 8).map(c => c.name));
    }
  }, [tableRes.data?.columns, columns.length]);

  const data = tableRes.data?.data || [];
  const totalPages = tableRes.data?.pagination?.totalPages || 1;
  const totalRecords = tableRes.data?.pagination?.total;
  const hasLoadedOnce = tableRes.data !== null;
  const isInitialLoading = tableRes.isLoading && !hasLoadedOnce;
  const isUpdating = tableRes.isRefreshing || (tableRes.isLoading && hasLoadedOnce);
  const showActionsCol = Boolean(onEditRecord || onDeleteRecord || onRowClick);
  const skeletonColumnCount = visibleColumns.length > 0 ? visibleColumns.length + (showActionsCol ? 1 : 0) : 6;

  const handleSort = (colName: string) => {
    if (sortBy === colName) {
      setSortOrder(prev => (prev === 'ASC' ? 'DESC' : 'ASC'));
    } else {
      setSortBy(colName);
      setSortOrder('ASC');
    }
    setPage(1);
  };

  const toggleColumnVisibility = (colName: string) => {
    setVisibleColumns(prev =>
      prev.includes(colName) ? prev.filter(c => c !== colName) : [...prev, colName]
    );
  };

  const addFilterRow = () => {
    const defaultCol = columns[0]?.name || 'id';
    setFilters(prev => [
      ...prev,
      { column: defaultCol, operator: 'contains', value: '' },
    ]);
  };

  const updateFilter = (index: number, patch: Partial<FilterCondition>) => {
    setFilters(prev => prev.map((f, i) => (i === index ? { ...f, ...patch } : f)));
  };

  const removeFilter = (index: number) => {
    const next = filters.filter((_, i) => i !== index);
    setFilters(next);
    setAppliedFilters(next);
    setPage(1);
  };

  const handleExport = async (format: 'xlsx' | 'csv') => {
    setExportingFormat(format);
    setExportError(null);
    try {
      const params = new URLSearchParams({
        table: tableName,
        format,
      });
      if (activeMission && activeMission !== 'ALL') params.append('mission', activeMission);
      if (search.trim()) params.append('search', search.trim());
      if (appliedFilters.length > 0) params.append('filters', JSON.stringify(appliedFilters));

      const res = await apiFetch(`/api/v1/exports/download?${params.toString()}`);
      if (!res.ok) {
        const json = await res.json().catch(() => null);
        throw new Error(json?.error || `Export failed (${res.status})`);
      }

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${tableName}.${format}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err: any) {
      setExportError(err?.message || 'Export failed');
    } finally {
      setExportingFormat(null);
    }
  };

  return (
    <div className="space-y-4">
      {/* Header bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-100 flex items-center gap-2 flex-wrap">
            <span>{title}</span>
            {hasLoadedOnce && totalRecords !== undefined ? (
              <span className="text-xs px-2 py-0.5 rounded-full bg-slate-800 text-indigo-400 font-medium tabular-nums">
                {totalRecords.toLocaleString()} {t('recordsCount')}
              </span>
            ) : isInitialLoading ? (
              <span className="inline-block h-5 w-24 rounded-full bg-slate-800 animate-pulse motion-reduce:animate-none" />
            ) : null}
            {isUpdating && <RefreshingBadge label={t('updatingTable')} />}
          </h1>
          {description && (
            <p className="text-xs text-slate-400 mt-0.5">{description}</p>
          )}
        </div>

        {/* Right action buttons */}
        <div className="flex items-center gap-2 flex-wrap">
          {/* Privacy masking toggle */}
          <button
            type="button"
            onClick={() => setUnmask(!unmask)}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors ${
              unmask
                ? 'bg-amber-500/10 border-amber-500/30 text-amber-300 hover:bg-amber-500/20'
                : 'bg-slate-800/80 border-slate-700 text-slate-300 hover:bg-slate-800'
            }`}
            title={unmask ? t('maskSensitive') : t('unmaskSensitive')}
          >
            {unmask ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
            <span>{unmask ? t('unmaskSensitive') : t('maskSensitive')}</span>
          </button>

          {/* Export dropdown */}
          <div className="relative inline-flex rounded-lg border border-slate-700 bg-slate-800/80 p-0.5">
            <button
              type="button"
              disabled={exportingFormat !== null}
              onClick={() => handleExport('xlsx')}
              className="flex items-center gap-1 px-2.5 py-1 text-xs text-slate-300 hover:text-white hover:bg-slate-700 rounded-md transition-colors disabled:opacity-50"
              title={t('exportExcel')}
            >
              {exportingFormat === 'xlsx' ? (
                <RefreshCw className="w-3.5 h-3.5 animate-spin text-emerald-400" />
              ) : (
                <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-400" />
              )}
              <span>Excel</span>
            </button>
            <button
              type="button"
              disabled={exportingFormat !== null}
              onClick={() => handleExport('csv')}
              className="flex items-center gap-1 px-2.5 py-1 text-xs text-slate-300 hover:text-white hover:bg-slate-700 rounded-md transition-colors disabled:opacity-50"
              title={t('exportCsv')}
            >
              {exportingFormat === 'csv' ? (
                <RefreshCw className="w-3.5 h-3.5 animate-spin text-sky-400" />
              ) : (
                <Download className="w-3.5 h-3.5 text-sky-400" />
              )}
              <span>CSV</span>
            </button>
          </div>

          {/* Create record button if handler provided */}
          {onCreateRecord && (
            <button
              type="button"
              onClick={onCreateRecord}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white shadow-sm shadow-indigo-600/30 transition-colors"
            >
              <Plus className="w-4 h-4" />
              <span>{t('addNewRecord')}</span>
            </button>
          )}

          {/* Refresh button */}
          <button
            type="button"
            onClick={() => tableRes.reload({ force: true })}
            disabled={isInitialLoading || isUpdating}
            className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition-colors border border-slate-700/60 disabled:opacity-60"
            title={t('refresh')}
          >
            <RefreshCw className={`w-4 h-4 ${isInitialLoading || isUpdating ? 'animate-spin motion-reduce:animate-none text-indigo-400' : ''}`} />
          </button>
        </div>
      </div>

      {/* Sensitive notice bar if masked */}
      {!unmask && (
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-indigo-950/40 border border-indigo-900/60 text-[11px] text-indigo-300">
          <AlertCircle className="w-3.5 h-3.5 shrink-0 text-indigo-400" />
          <span>{t('maskedNotice')}</span>
        </div>
      )}

      {exportError && (
        <ErrorRetryCard compact message={exportError} onRetry={() => setExportError(null)} />
      )}

      {/* Search, Filter Builder Toggle, Columns Toggle bar */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2.5 bg-slate-900/80 p-2.5 rounded-xl border border-slate-800">
        {/* Search input */}
        <div className="relative flex-1">
          <Search className="absolute left-3 top-2.5 w-4 h-4 text-slate-500 rtl:right-3 rtl:left-auto" />
          <input
            type="text"
            value={search}
            onChange={e => {
              setSearch(e.target.value);
              setPage(1);
            }}
            placeholder={`${t('search')} ${title}...`}
            className="w-full h-9 pl-9 pr-8 rtl:pr-9 rtl:pl-8 text-xs bg-slate-950/70 border border-slate-800 rounded-lg text-slate-200 placeholder-slate-500 focus:outline-none focus:border-indigo-500"
          />
          {search && (
            <button
              type="button"
              onClick={() => {
                setSearch('');
                setPage(1);
              }}
              className="absolute right-2.5 top-2.5 rtl:left-2.5 rtl:right-auto text-slate-400 hover:text-white"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {/* Filter Builder & Columns Controls */}
        <div className="flex items-center gap-2">
          {/* Filter button */}
          <button
            type="button"
            onClick={() => setFilterBuilderOpen(!filterBuilderOpen)}
            className={`flex items-center gap-1.5 h-9 px-3 text-xs font-medium rounded-lg border transition-colors ${
              appliedFilters.length > 0 || filterBuilderOpen
                ? 'bg-indigo-600/20 border-indigo-500 text-indigo-300'
                : 'bg-slate-950/70 border-slate-800 text-slate-300 hover:bg-slate-800'
            }`}
          >
            <Filter className="w-3.5 h-3.5" />
            <span>{t('filter')}</span>
            {appliedFilters.length > 0 && (
              <span className="w-4 h-4 rounded-full bg-indigo-600 text-white text-[10px] flex items-center justify-center">
                {appliedFilters.length}
              </span>
            )}
          </button>

          {/* Columns menu button */}
          <div className="relative">
            <button
              type="button"
              disabled={columns.length === 0}
              onClick={() => setColumnMenuOpen(!columnMenuOpen)}
              className="flex items-center gap-1.5 h-9 px-3 text-xs font-medium rounded-lg bg-slate-950/70 border border-slate-800 text-slate-300 hover:bg-slate-800 transition-colors disabled:opacity-50"
            >
              <SlidersHorizontal className="w-3.5 h-3.5" />
              <span>{t('columns')}</span>
            </button>

            {columnMenuOpen && (
              <div className="absolute right-0 rtl:left-0 rtl:right-auto mt-2 w-56 max-h-72 overflow-y-auto bg-slate-900 border border-slate-800 rounded-xl shadow-xl p-2 z-40">
                <div className="text-[11px] font-semibold text-slate-400 px-2 pb-1 border-b border-slate-800 mb-1">
                  {t('columns')}
                </div>
                {columns.length === 0 ? (
                  <div className="text-xs text-slate-500 px-2 py-2">{t('loadingOptions')}</div>
                ) : (
                  columns.map(col => (
                    <label
                      key={col.name}
                      className="flex items-center gap-2 px-2 py-1.5 text-xs text-slate-300 hover:bg-slate-800/60 rounded cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        checked={visibleColumns.includes(col.name)}
                        onChange={() => toggleColumnVisibility(col.name)}
                        className="rounded bg-slate-950 border-slate-700 text-indigo-600 focus:ring-0"
                      />
                      <span className="truncate">{col.name}</span>
                    </label>
                  ))
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Dynamic Multi-Column Filter Builder Drawer */}
      {filterBuilderOpen && (
        <div className="p-3 bg-slate-900/90 border border-indigo-900/40 rounded-xl space-y-2.5">
          <div className="flex items-center justify-between pb-1.5 border-b border-slate-800">
            <span className="text-xs font-semibold text-slate-200 flex items-center gap-1.5">
              <Filter className="w-3.5 h-3.5 text-indigo-400" />
              <span>Advanced Multi-Column Filter Builder</span>
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={columns.length === 0}
                onClick={addFilterRow}
                className="flex items-center gap-1 text-xs text-indigo-400 hover:text-indigo-300 font-medium disabled:opacity-50"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>{t('addFilter')}</span>
              </button>
              {(filters.length > 0 || appliedFilters.length > 0) && (
                <button
                  type="button"
                  onClick={() => {
                    setFilters([]);
                    setAppliedFilters([]);
                    setPage(1);
                  }}
                  className="text-xs text-rose-400 hover:text-rose-300 ml-2"
                >
                  {t('clearFilters')}
                </button>
              )}
            </div>
          </div>

          {filters.length === 0 ? (
            <p className="text-xs text-slate-500 py-1">
              No filter conditions added. Click &quot;Add Filter&quot; to filter across columns with custom operators.
            </p>
          ) : (
            <div className="space-y-2">
              {filters.map((f, idx) => (
                <div key={idx} className="flex flex-wrap items-center gap-2 bg-slate-950/60 p-2 rounded-lg border border-slate-800">
                  {/* Column selection */}
                  <select
                    value={f.column}
                    onChange={e => updateFilter(idx, { column: e.target.value })}
                    className="h-8 px-2 text-xs bg-slate-900 border border-slate-700 rounded text-slate-200 focus:outline-none focus:border-indigo-500"
                  >
                    {columns.map(c => (
                      <option key={c.name} value={c.name}>
                        {c.name}
                      </option>
                    ))}
                  </select>

                  {/* Operator selection */}
                  <select
                    value={f.operator}
                    onChange={e => updateFilter(idx, { operator: e.target.value as FilterOperator })}
                    className="h-8 px-2 text-xs bg-slate-900 border border-slate-700 rounded text-slate-200 focus:outline-none focus:border-indigo-500"
                  >
                    <option value="contains">{t('opContains')}</option>
                    <option value="equals">{t('opEquals')}</option>
                    <option value="not_equals">{t('opNotEquals')}</option>
                    <option value="starts_with">{t('opStartsWith')}</option>
                    <option value="ends_with">{t('opEndsWith')}</option>
                    <option value="greater_than">{t('opGreaterThan')}</option>
                    <option value="less_than">{t('opLessThan')}</option>
                    <option value="between">{t('opBetween')}</option>
                    <option value="is_empty">{t('opIsEmpty')}</option>
                    <option value="is_not_empty">{t('opIsNotEmpty')}</option>
                    <option value="before_date">{t('opBeforeDate')}</option>
                    <option value="after_date">{t('opAfterDate')}</option>
                  </select>

                  {/* Value Input */}
                  {!['is_empty', 'is_not_empty'].includes(f.operator) && (
                    <input
                      type="text"
                      value={f.value || ''}
                      onChange={e => updateFilter(idx, { value: e.target.value })}
                      placeholder="Value..."
                      className="h-8 px-2.5 text-xs bg-slate-900 border border-slate-700 rounded text-slate-200 placeholder-slate-500 focus:outline-none focus:border-indigo-500 flex-1 min-w-[120px]"
                    />
                  )}

                  {/* Second Value for 'between' */}
                  {f.operator === 'between' && (
                    <input
                      type="text"
                      value={f.value2 || ''}
                      onChange={e => updateFilter(idx, { value2: e.target.value })}
                      placeholder="Second value..."
                      className="h-8 px-2.5 text-xs bg-slate-900 border border-slate-700 rounded text-slate-200 placeholder-slate-500 focus:outline-none focus:border-indigo-500 flex-1 min-w-[120px]"
                    />
                  )}

                  {/* Remove button */}
                  <button
                    type="button"
                    onClick={() => removeFilter(idx)}
                    className="p-1 text-slate-400 hover:text-rose-400"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              ))}

              <div className="flex justify-end pt-1">
                <button
                  type="button"
                  onClick={() => {
                    setAppliedFilters([...filters]);
                    setPage(1);
                  }}
                  className="px-3 py-1.5 text-xs font-semibold rounded bg-indigo-600 hover:bg-indigo-500 text-white transition-colors"
                >
                  {t('applyFilters')}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Non-blocking error banner when previous rows remain visible */}
      {tableRes.isError && data.length > 0 && (
        <ErrorRetryCard compact message={tableRes.error} onRetry={() => tableRes.reload({ force: true })} />
      )}

      {/* Main Table Container */}
      <div className="overflow-x-auto rounded-xl border border-slate-800 bg-slate-900/50 shadow-sm">
        <TopProgressBar active={isInitialLoading || isUpdating} label={t('updatingTable')} />
        <table className="w-full text-left rtl:text-right border-collapse">
          <thead>
            {isInitialLoading && visibleColumns.length === 0 ? (
              <tr className="border-b border-slate-800 bg-slate-950/60">
                {Array.from({ length: 6 }).map((_, idx) => (
                  <th key={idx} className="px-4 py-3">
                    <div className="h-3 w-20 bg-slate-800 rounded animate-pulse motion-reduce:animate-none" />
                  </th>
                ))}
              </tr>
            ) : (
              <tr className="border-b border-slate-800 bg-slate-950/60 text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
                {visibleColumns.map(col => (
                  <th
                    key={col}
                    onClick={() => handleSort(col)}
                    className="px-4 py-3 cursor-pointer hover:bg-slate-800/40 select-none transition-colors"
                  >
                    <div className="flex items-center gap-1.5">
                      <span>{col}</span>
                      {sortBy === col ? (
                        sortOrder === 'ASC' ? (
                          <ArrowUp className="w-3.5 h-3.5 text-indigo-400" />
                        ) : (
                          <ArrowDown className="w-3.5 h-3.5 text-indigo-400" />
                        )
                      ) : (
                        <ArrowUpDown className="w-3 h-3 text-slate-600" />
                      )}
                    </div>
                  </th>
                ))}
                {showActionsCol && visibleColumns.length > 0 && (
                  <th className="px-4 py-3 text-center w-24">Actions</th>
                )}
              </tr>
            )}
          </thead>
          <tbody
            className={`divide-y divide-slate-800/60 text-xs text-slate-300 transition-opacity ${
              isUpdating && data.length > 0 ? 'opacity-60' : 'opacity-100'
            }`}
          >
            {isInitialLoading ? (
              <TableSkeletonRows columns={skeletonColumnCount} rows={8} />
            ) : tableRes.isError && data.length === 0 ? (
              <tr>
                <td colSpan={skeletonColumnCount} className="p-6">
                  <ErrorRetryCard message={tableRes.error} onRetry={() => tableRes.reload({ force: true })} />
                </td>
              </tr>
            ) : data.length === 0 ? (
              <tr>
                <td colSpan={skeletonColumnCount} className="p-6">
                  <EmptyStateCard
                    title={t('noDataFound')}
                    description={t('noRecordsHint')}
                    action={
                      (search || appliedFilters.length > 0) && (
                        <button
                          type="button"
                          onClick={() => {
                            setSearch('');
                            setFilters([]);
                            setAppliedFilters([]);
                            setPage(1);
                          }}
                          className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700"
                        >
                          {t('clearFilters')}
                        </button>
                      )
                    }
                  />
                </td>
              </tr>
            ) : (
              data.map((row, rIdx) => (
                <tr
                  key={row.id || rIdx}
                  onClick={() => onRowClick && onRowClick(row)}
                  className="hover:bg-slate-800/40 transition-colors cursor-pointer group"
                >
                  {visibleColumns.map(col => {
                    const val = row[col];
                    const isMasked = typeof val === 'string' && val.includes('***');
                    return (
                      <td key={col} className="px-4 py-3 font-mono text-[11px] truncate max-w-xs">
                        {isMasked ? (
                          <span className="px-1.5 py-0.5 rounded bg-slate-800/80 text-amber-300/80 text-[10px] font-mono">
                            {val}
                          </span>
                        ) : val !== null && val !== undefined ? (
                          String(val)
                        ) : (
                          <span className="text-slate-600 italic">null</span>
                        )}
                      </td>
                    );
                  })}
                  {showActionsCol && (
                    <td
                      className="px-4 py-2 text-center"
                      onClick={e => e.stopPropagation()}
                    >
                      <div className="flex items-center justify-center gap-1.5 opacity-80 group-hover:opacity-100">
                        {onRowClick && (
                          <button
                            type="button"
                            onClick={() => onRowClick(row)}
                            className="p-1 text-slate-400 hover:text-indigo-400 rounded hover:bg-slate-800"
                            title={t('viewDetails')}
                          >
                            <Eye className="w-3.5 h-3.5" />
                          </button>
                        )}
                        {onEditRecord && (
                          <button
                            type="button"
                            onClick={() => onEditRecord(row)}
                            className="p-1 text-slate-400 hover:text-emerald-400 rounded hover:bg-slate-800"
                            title={t('editRecord')}
                          >
                            <Edit2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                        {onDeleteRecord && (
                          <button
                            type="button"
                            onClick={() => onDeleteRecord(row)}
                            className="p-1 text-slate-400 hover:text-rose-400 rounded hover:bg-slate-800"
                            title={t('deleteRecord')}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </td>
                  )}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination Bar */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-slate-400 px-1">
        {/* Record counts */}
        <div className="tabular-nums">
          {isInitialLoading ? (
            <div className="h-4 w-44 bg-slate-800 rounded animate-pulse motion-reduce:animate-none" />
          ) : (
            <>
              {t('showing')} <strong className="text-slate-200">{data.length}</strong> {t('of')}{' '}
              <strong className="text-slate-200">{(totalRecords ?? 0).toLocaleString()}</strong> {t('recordsCount')}
            </>
          )}
        </div>

        {/* Page navigation controls */}
        <div className="flex items-center gap-2">
          {/* Rows per page selector */}
          <div className="flex items-center gap-1.5 mr-2">
            <span>{t('rowsPerPage')}:</span>
            <select
              value={pageSize}
              onChange={e => {
                setPageSize(Number(e.target.value));
                setPage(1);
              }}
              className="h-8 px-2 text-xs bg-slate-900 border border-slate-800 rounded-lg text-slate-200 focus:outline-none focus:border-indigo-500"
            >
              <option value="10">10</option>
              <option value="25">25</option>
              <option value="50">50</option>
              <option value="100">100</option>
            </select>
          </div>

          <button
            type="button"
            onClick={() => setPage(1)}
            disabled={page <= 1 || isInitialLoading}
            className="p-1.5 rounded-lg border border-slate-800 hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed text-slate-300"
          >
            <ChevronsLeft className="w-4 h-4 rtl:rotate-180" />
          </button>
          <button
            type="button"
            onClick={() => setPage(p => Math.max(1, p - 1))}
            disabled={page <= 1 || isInitialLoading}
            className="p-1.5 rounded-lg border border-slate-800 hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed text-slate-300"
          >
            <ChevronLeft className="w-4 h-4 rtl:rotate-180" />
          </button>

          <span className="px-2 text-xs tabular-nums">
            {t('page')} <strong className="text-slate-200">{page}</strong> / {totalPages}
          </span>

          <button
            type="button"
            onClick={() => setPage(p => Math.min(totalPages, p + 1))}
            disabled={page >= totalPages || isInitialLoading}
            className="p-1.5 rounded-lg border border-slate-800 hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed text-slate-300"
          >
            <ChevronRight className="w-4 h-4 rtl:rotate-180" />
          </button>
          <button
            type="button"
            onClick={() => setPage(totalPages)}
            disabled={page >= totalPages || isInitialLoading}
            className="p-1.5 rounded-lg border border-slate-800 hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed text-slate-300"
          >
            <ChevronsRight className="w-4 h-4 rtl:rotate-180" />
          </button>
        </div>
      </div>
    </div>
  );
};
