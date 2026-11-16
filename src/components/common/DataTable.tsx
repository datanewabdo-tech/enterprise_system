import React, { useState, useEffect, useCallback } from 'react';
import { useApp } from '../../context/AppContext.js';
import { TableResponse, ColumnMeta, FilterCondition, FilterOperator } from '../../types/index.js';
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

  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<any[]>([]);
  const [columns, setColumns] = useState<ColumnMeta[]>([]);
  const [visibleColumns, setVisibleColumns] = useState<string[]>([]);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [totalPages, setTotalPages] = useState(1);
  const [totalRecords, setTotalRecords] = useState(0);

  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState<string>('id');
  const [sortOrder, setSortOrder] = useState<'ASC' | 'DESC'>('DESC');
  const [unmask, setUnmask] = useState(false);

  // Filter Builder State
  const [filterBuilderOpen, setFilterBuilderOpen] = useState(false);
  const [filters, setFilters] = useState<FilterCondition[]>([]);
  const [columnMenuOpen, setColumnMenuOpen] = useState(false);

  // Sync with globalSearch if set
  useEffect(() => {
    if (globalSearch) {
      setSearch(globalSearch);
    }
  }, [globalSearch]);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
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

      if (filters.length > 0) {
        params.append('filters', JSON.stringify(filters));
      }

      const res = await apiFetch(`/api/v1/tables/${tableName}?${params.toString()}`);
      if (!res.ok) throw new Error('Failed to fetch data');
      const json: TableResponse = await res.json();

      setData(json.data || []);
      setTotalPages(json.pagination?.totalPages || 1);
      setTotalRecords(json.pagination?.total || 0);

      if (columns.length === 0 && json.columns) {
        setColumns(json.columns);
        // Default visible columns: first 8 columns
        setVisibleColumns(json.columns.slice(0, 8).map(c => c.name));
      }
    } catch (err) {
      console.error(err);
      setData([]);
    } finally {
      setLoading(false);
    }
  }, [tableName, page, pageSize, sortBy, sortOrder, search, activeMission, filters, unmask, columns.length]);

  useEffect(() => {
    fetchData();
  }, [fetchData, refreshTrigger]);

  const handleSort = (colName: string) => {
    if (sortBy === colName) {
      setSortOrder(prev => (prev === 'ASC' ? 'DESC' : 'ASC'));
    } else {
      setSortBy(colName);
      setSortOrder('ASC');
    }
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
    setFilters(prev => prev.filter((_, i) => i !== index));
  };

  const handleExport = (format: 'xlsx' | 'csv') => {
    const params = new URLSearchParams({
      table: tableName,
      format,
    });
    if (activeMission && activeMission !== 'ALL') params.append('mission', activeMission);
    if (search.trim()) params.append('search', search.trim());
    if (filters.length > 0) params.append('filters', JSON.stringify(filters));
    if (authToken) params.append('token', authToken);

    const a = document.createElement('a');
    a.href = `/api/v1/exports/download?${params.toString()}`;
    a.download = `${tableName}.${format}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  return (
    <div className="space-y-4">
      {/* Header bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-100 flex items-center gap-2">
            <span>{title}</span>
            <span className="text-xs px-2 py-0.5 rounded-full bg-slate-800 text-indigo-400 font-medium">
              {totalRecords.toLocaleString()} {t('recordsCount')}
            </span>
          </h1>
          {description && (
            <p className="text-xs text-slate-400 mt-0.5">{description}</p>
          )}
        </div>

        {/* Right action buttons */}
        <div className="flex items-center gap-2 flex-wrap">
          {/* Privacy masking toggle */}
          <button
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
              onClick={() => handleExport('xlsx')}
              className="flex items-center gap-1 px-2.5 py-1 text-xs text-slate-300 hover:text-white hover:bg-slate-700 rounded-md transition-colors"
              title={t('exportExcel')}
            >
              <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-400" />
              <span>Excel</span>
            </button>
            <button
              onClick={() => handleExport('csv')}
              className="flex items-center gap-1 px-2.5 py-1 text-xs text-slate-300 hover:text-white hover:bg-slate-700 rounded-md transition-colors"
              title={t('exportCsv')}
            >
              <Download className="w-3.5 h-3.5 text-sky-400" />
              <span>CSV</span>
            </button>
          </div>

          {/* Create record button if handler provided */}
          {onCreateRecord && (
            <button
              onClick={onCreateRecord}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white shadow-sm shadow-indigo-600/30 transition-colors"
            >
              <Plus className="w-4 h-4" />
              <span>{t('addNewRecord')}</span>
            </button>
          )}

          {/* Refresh button */}
          <button
            onClick={() => fetchData()}
            className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition-colors border border-slate-700/60"
            title={t('refresh')}
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin text-indigo-400' : ''}`} />
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
            className="w-full h-9 pl-9 pr-3 rtl:pr-9 rtl:pl-3 text-xs bg-slate-950/70 border border-slate-800 rounded-lg text-slate-200 placeholder-slate-500 focus:outline-none focus:border-indigo-500"
          />
          {search && (
            <button
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
            onClick={() => setFilterBuilderOpen(!filterBuilderOpen)}
            className={`flex items-center gap-1.5 h-9 px-3 text-xs font-medium rounded-lg border transition-colors ${
              filters.length > 0 || filterBuilderOpen
                ? 'bg-indigo-600/20 border-indigo-500 text-indigo-300'
                : 'bg-slate-950/70 border-slate-800 text-slate-300 hover:bg-slate-800'
            }`}
          >
            <Filter className="w-3.5 h-3.5" />
            <span>{t('filter')}</span>
            {filters.length > 0 && (
              <span className="w-4 h-4 rounded-full bg-indigo-600 text-white text-[10px] flex items-center justify-center">
                {filters.length}
              </span>
            )}
          </button>

          {/* Columns menu button */}
          <div className="relative">
            <button
              onClick={() => setColumnMenuOpen(!columnMenuOpen)}
              className="flex items-center gap-1.5 h-9 px-3 text-xs font-medium rounded-lg bg-slate-950/70 border border-slate-800 text-slate-300 hover:bg-slate-800 transition-colors"
            >
              <SlidersHorizontal className="w-3.5 h-3.5" />
              <span>{t('columns')}</span>
            </button>

            {columnMenuOpen && (
              <div className="absolute right-0 rtl:left-0 rtl:right-auto mt-2 w-56 max-h-72 overflow-y-auto bg-slate-900 border border-slate-800 rounded-xl shadow-xl p-2 z-40">
                <div className="text-[11px] font-semibold text-slate-400 px-2 pb-1 border-b border-slate-800 mb-1">
                  {t('columns')}
                </div>
                {columns.map(col => (
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
                ))}
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
                onClick={addFilterRow}
                className="flex items-center gap-1 text-xs text-indigo-400 hover:text-indigo-300 font-medium"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>{t('addFilter')}</span>
              </button>
              {filters.length > 0 && (
                <button
                  onClick={() => {
                    setFilters([]);
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
                    onClick={() => removeFilter(idx)}
                    className="p-1 text-slate-400 hover:text-rose-400"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              ))}

              <div className="flex justify-end pt-1">
                <button
                  onClick={() => {
                    setPage(1);
                    fetchData();
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

      {/* Main Table Container */}
      <div className="overflow-x-auto rounded-xl border border-slate-800 bg-slate-900/50 shadow-sm">
        <table className="w-full text-left rtl:text-right border-collapse">
          <thead>
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
              {(onEditRecord || onDeleteRecord || onRowClick) && (
                <th className="px-4 py-3 text-center w-24">Actions</th>
              )}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/60 text-xs text-slate-300">
            {loading ? (
              // Loading Skeleton Rows
              Array.from({ length: 6 }).map((_, i) => (
                <tr key={i} className="animate-pulse">
                  {visibleColumns.map(c => (
                    <td key={c} className="px-4 py-3">
                      <div className="h-4 bg-slate-800 rounded w-3/4" />
                    </td>
                  ))}
                  <td className="px-4 py-3">
                    <div className="h-4 bg-slate-800 rounded w-12 mx-auto" />
                  </td>
                </tr>
              ))
            ) : data.length === 0 ? (
              // Empty State
              <tr>
                <td
                  colSpan={visibleColumns.length + 1}
                  className="px-4 py-12 text-center text-slate-500"
                >
                  <div className="flex flex-col items-center justify-center gap-2">
                    <AlertCircle className="w-8 h-8 text-slate-600" />
                    <span className="text-sm font-medium">{t('noDataFound')}</span>
                    <span className="text-xs text-slate-600">Try clearing your filters or changing search keywords.</span>
                  </div>
                </td>
              </tr>
            ) : (
              // Data Rows
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
                  {(onEditRecord || onDeleteRecord || onRowClick) && (
                    <td
                      className="px-4 py-2 text-center"
                      onClick={e => e.stopPropagation()}
                    >
                      <div className="flex items-center justify-center gap-1.5 opacity-80 group-hover:opacity-100">
                        {onRowClick && (
                          <button
                            onClick={() => onRowClick(row)}
                            className="p-1 text-slate-400 hover:text-indigo-400 rounded hover:bg-slate-800"
                            title={t('viewDetails')}
                          >
                            <Eye className="w-3.5 h-3.5" />
                          </button>
                        )}
                        {onEditRecord && (
                          <button
                            onClick={() => onEditRecord(row)}
                            className="p-1 text-slate-400 hover:text-emerald-400 rounded hover:bg-slate-800"
                            title={t('editRecord')}
                          >
                            <Edit2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                        {onDeleteRecord && (
                          <button
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
        <div>
          {t('showing')} <strong className="text-slate-200">{data.length}</strong> {t('of')}{' '}
          <strong className="text-slate-200">{totalRecords.toLocaleString()}</strong> {t('recordsCount')}
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
            onClick={() => setPage(1)}
            disabled={page <= 1}
            className="p-1.5 rounded-lg border border-slate-800 hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed text-slate-300"
          >
            <ChevronsLeft className="w-4 h-4 rtl:rotate-180" />
          </button>
          <button
            onClick={() => setPage(p => Math.max(1, p - 1))}
            disabled={page <= 1}
            className="p-1.5 rounded-lg border border-slate-800 hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed text-slate-300"
          >
            <ChevronLeft className="w-4 h-4 rtl:rotate-180" />
          </button>

          <span className="px-2 text-xs">
            {t('page')} <strong className="text-slate-200">{page}</strong> / {totalPages}
          </span>

          <button
            onClick={() => setPage(p => Math.min(totalPages, p + 1))}
            disabled={page >= totalPages}
            className="p-1.5 rounded-lg border border-slate-800 hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed text-slate-300"
          >
            <ChevronRight className="w-4 h-4 rtl:rotate-180" />
          </button>
          <button
            onClick={() => setPage(totalPages)}
            disabled={page >= totalPages}
            className="p-1.5 rounded-lg border border-slate-800 hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed text-slate-300"
          >
            <ChevronsRight className="w-4 h-4 rtl:rotate-180" />
          </button>
        </div>
      </div>
    </div>
  );
};
