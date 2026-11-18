import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useApp } from '../context/AppContext.js';
import { useAsyncResource } from '../hooks/useAsyncResource.js';
import {
  TopProgressBar,
  RefreshingBadge,
  ChartSkeleton,
  EmptyStateCard,
  ErrorRetryCard,
} from '../components/common/LoadingStates.js';
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
  AreaChart,
  Area,
} from 'recharts';
import {
  BarChart3,
  Play,
  SlidersHorizontal,
  RefreshCw,
  Plus,
  Trash2,
  Copy,
  ChevronDown,
  ChevronUp,
  Download,
  Filter,
  X,
  Save,
  FolderOpen,
} from 'lucide-react';
import { ColumnMeta, FilterCondition, FilterOperator } from '../types/index.js';
import { renderChartPngDataUrl } from '../utils/chartExporter.js';

interface MetricSpec {
  id: string;
  aggregation: string;
  column?: string;
  label?: string;
}

interface AnalysisConfig {
  id: string;
  title: string;
  table: string;
  dimensions: string[];
  metrics: MetricSpec[];
  filters: FilterCondition[];
  chartType: 'bar' | 'line' | 'area' | 'pie';
  limit: number;
  offset: number;
  sortBy?: string;
  sortOrder: 'ASC' | 'DESC';
  viewMode: 'table' | 'chart' | 'both';
  collapsed: boolean;
  filterBuilderOpen: boolean;
}

const TABLE_OPTIONS = [
  { value: 'registrations', label: 'Registrations' },
  { value: 'network_cells', label: 'Network Cells' },
  { value: 'targets', label: 'Targets' },
  { value: 'gps_history', label: 'GPS History' },
  { value: 'wifi_access_points', label: 'WiFi Access Points' },
  { value: 'map_cells', label: 'Map Cells' },
  { value: 'sms_calls', label: 'SMS & Calls' },
  { value: 'missions', label: 'Missions' },
  { value: 'tac_numbers', label: 'TAC Numbers' },
  { value: 'plmn_storage', label: 'PLMN Storage' },
];

const AGG_OPTIONS = ['COUNT', 'SUM', 'AVG', 'MIN', 'MAX', 'DISTINCT_COUNT', 'MEDIAN'];
const CHART_OPTIONS = [
  { value: 'bar', label: 'Bar Chart' },
  { value: 'line', label: 'Line Chart' },
  { value: 'area', label: 'Area Chart' },
  { value: 'pie', label: 'Donut / Pie Chart' },
];

const COLORS = ['#6366f1', '#3b82f6', '#10b981', '#f59e0b', '#ec4899', '#8b5cf6', '#06b6d4', '#14b8a6', '#f43f5e'];

function newAnalysis(n: number): AnalysisConfig {
  return {
    id: (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : `a_${Date.now()}_${n}`,
    title: `Analysis ${n}`,
    table: 'registrations',
    dimensions: ['country'],
    metrics: [{ id: 'm1', aggregation: 'COUNT', label: 'Count' }],
    filters: [],
    chartType: 'bar',
    limit: 15,
    offset: 0,
    sortBy: undefined,
    sortOrder: 'DESC',
    viewMode: 'both',
    collapsed: false,
    filterBuilderOpen: false,
  };
}

async function downloadAnalyticsFile(
  apiFetch: (input: string, init?: RequestInit) => Promise<Response>,
  format: 'xlsx' | 'pdf' | 'docx',
  analysis: Record<string, unknown>,
  fallbackName: string,
  language: string
) {
  const res = await apiFetch('/api/v1/exports/analytics', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ format, analyses: [analysis], language }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.error || `Export failed (${res.status})`);
  }

  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = res.headers.get('X-Export-Filename') || fallbackName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function AnalysisPanel({
  config,
  onChange,
  onDuplicate,
  onDelete,
  onChartElement,
  mission,
}: {
  config: AnalysisConfig;
  onChange: (patch: Partial<AnalysisConfig>) => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onChartElement: (analysisId: string, element: HTMLDivElement | null) => void;
  mission: string;
}) {
  const { t, apiFetch, authToken, language } = useApp();
  const [exportingFormat, setExportingFormat] = useState<'xlsx' | 'pdf' | 'docx' | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const chartContainerRefElement = useRef<HTMLDivElement | null>(null);
  const chartContainerRef = useCallback((element: HTMLDivElement | null) => {
    chartContainerRefElement.current = element;
    onChartElement(config.id, element);
  }, [config.id, onChartElement]);

  // Columns for selected table
  const columnsRes = useAsyncResource<string[]>(
    async signal => {
      const res = await apiFetch(`/api/v1/tables/${config.table}?pageSize=1`, { signal });
      const json = await res.json().catch(() => null);
      if (!res.ok) throw new Error(json?.error || 'Failed to load columns');
      const cols = (json?.columns || []).map((c: any) => c.name);
      return cols;
    },
    [config.table, authToken],
    { enabled: Boolean(authToken), keepPreviousData: true }
  );
  const availableColumns = columnsRes.data || [];

  // Auto-fix dimensions if none valid
  useEffect(() => {
    if (availableColumns.length === 0) return;
    const valid = config.dimensions.filter(d => availableColumns.includes(d));
    if (valid.length === 0) {
      onChange({ dimensions: [availableColumns[0]] });
    } else if (valid.length !== config.dimensions.length) {
      onChange({ dimensions: valid });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [availableColumns.join(',')]);

  // Auto-fix metrics columns
  useEffect(() => {
    if (availableColumns.length === 0) return;
    const fixed = config.metrics.map(m => {
      if (m.aggregation !== 'COUNT' && (!m.column || !availableColumns.includes(m.column))) {
        return { ...m, column: availableColumns[0] };
      }
      return m;
    });
    if (JSON.stringify(fixed) !== JSON.stringify(config.metrics)) {
      onChange({ metrics: fixed });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [availableColumns.join(',')]);

  const runKey = useMemo(() => JSON.stringify({
    table: config.table,
    dimensions: config.dimensions,
    metrics: config.metrics,
    filters: config.filters,
    mission,
    limit: config.limit,
    offset: config.offset,
    sortBy: config.sortBy,
    sortOrder: config.sortOrder,
  }), [config.table, config.dimensions, config.metrics, config.filters, mission, config.limit, config.offset, config.sortBy, config.sortOrder]);

  const resultRes = useAsyncResource<any>(
    async signal => {
      if (config.dimensions.length === 0) throw new Error('No grouping dimensions selected');
      const res = await apiFetch('/api/v1/analytics/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          table: config.table,
          dimensions: config.dimensions,
          metrics: config.metrics.map(m => ({
            id: m.id,
            label: m.label || `${m.aggregation}${m.column ? ' ' + m.column : ''}`,
            aggregation: m.aggregation,
            column: m.column || undefined,
          })),
          filters: config.filters.length > 0 ? config.filters : undefined,
          mission,
          limit: config.limit,
          offset: config.offset,
          sortBy: config.sortBy,
          sortOrder: config.sortOrder,
        }),
        signal,
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) throw new Error(json?.error || 'Analytics query failed');
      return json;
    },
    [runKey, authToken],
    { enabled: Boolean(authToken) && config.dimensions.length > 0, keepPreviousData: true }
  );

  const result = resultRes.data;
  const rows = result?.rows || [];
  const metricDefs = result?.metrics || config.metrics.map(m => ({ id: m.id, label: m.label || m.aggregation, aggregation: m.aggregation, column: m.column }));
  const dimCols = result?.dimensions || config.dimensions;

  // Table columns
  const tableColumns = [...dimCols, ...metricDefs.map((m: any) => m.label || m.id)];

  const handleSort = (key: string) => {
    if (config.sortBy === key) {
      onChange({ sortOrder: config.sortOrder === 'ASC' ? 'DESC' : 'ASC', offset: 0 });
    } else {
      onChange({ sortBy: key, sortOrder: 'DESC', offset: 0 });
    }
  };

  // Chart data
  const chartData = useMemo(() => {
    return rows.map((r: any) => {
      const name = dimCols.map((d: string) => (r[d] ?? r[`dim_${dimCols.indexOf(d)}`] ?? '')).join(' | ');
      const obj: any = { name: name || '(empty)' };
      metricDefs.forEach((m: any) => {
        const key = m.label || m.id;
        obj[key] = r[m.id] ?? r[key] ?? r[m.label];
      });
      return obj;
    });
  }, [rows, dimCols, metricDefs]);

  const metricKeys = metricDefs.map((m: any) => m.label || m.id);

  const addDimension = (col: string) => {
    if (!col || config.dimensions.includes(col)) return;
    onChange({ dimensions: [...config.dimensions, col], offset: 0 });
  };
  const removeDimension = (idx: number) => {
    const next = config.dimensions.filter((_, i) => i !== idx);
    onChange({ dimensions: next, offset: 0 });
  };
  const moveDimension = (idx: number, dir: -1 | 1) => {
    const next = [...config.dimensions];
    const ni = idx + dir;
    if (ni < 0 || ni >= next.length) return;
    [next[idx], next[ni]] = [next[ni], next[idx]];
    onChange({ dimensions: next });
  };

  const addMetric = () => {
    const m: MetricSpec = { id: `m${Date.now()}`, aggregation: 'COUNT', label: 'Count' };
    onChange({ metrics: [...config.metrics, m], offset: 0 });
  };
  const removeMetric = (idx: number) => {
    if (config.metrics.length <= 1) return;
    onChange({ metrics: config.metrics.filter((_, i) => i !== idx), offset: 0 });
  };
  const updateMetric = (idx: number, patch: Partial<MetricSpec>) => {
    const next = config.metrics.map((m, i) => i === idx ? { ...m, ...patch } : m);
    // auto label
    if (patch.aggregation || patch.column) {
      next[idx].label = `${next[idx].aggregation}${next[idx].column ? ' ' + next[idx].column : ''}`;
    }
    onChange({ metrics: next });
  };

  const addFilterRow = () => {
    const col = availableColumns[0] || '';
    onChange({ filters: [...config.filters, { column: col, operator: 'contains', value: '' } as FilterCondition] });
  };
  const updateFilter = (idx: number, patch: Partial<FilterCondition>) => {
    const next = config.filters.map((f, i) => i === idx ? { ...f, ...patch } : f);
    onChange({ filters: next });
  };
  const removeFilter = (idx: number) => {
    onChange({ filters: config.filters.filter((_, i) => i !== idx) });
  };

  const collectOne = () => ({
    title: config.title,
    table: config.table,
    dimensions: config.dimensions,
    metrics: config.metrics.map(m => ({ id: m.id, label: m.label, aggregation: m.aggregation, column: m.column })),
    filters: config.filters,
    limit: config.limit,
    offset: config.offset,
    sortBy: config.sortBy,
    sortOrder: config.sortOrder,
  });

  const exportCsv = () => {
    if (rows.length === 0) return;
    const header = tableColumns.join(',');
    const body = rows.map((r: any) => tableColumns.map(c => {
      const v = r[c] ?? r[c];
      const s = v === null || v === undefined ? '' : String(v);
      return `"${s.replace(/"/g, '""')}"`;
    }).join(',')).join('\n');
    const blob = new Blob([header + '\n' + body], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${config.title.replace(/\s+/g, '_')}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const exportOne = async (format: 'xlsx' | 'pdf' | 'docx') => {
    setExportingFormat(format);
    setExportError(null);
    try {
      const analysis: Record<string, unknown> = collectOne();
      if (config.viewMode !== 'table') {
        const chartImage = await renderChartPngDataUrl(chartContainerRefElement.current, {
          title: config.title,
          subtitle: config.table,
          isRtl: language === 'ar',
        });
        if (!chartImage) throw new Error('The chart is not ready to export yet. Wait for it to finish rendering and try again.');
        analysis.chartImage = chartImage;
      }
      await downloadAnalyticsFile(apiFetch, format, analysis, `${config.title}.${format}`, language);
    } catch (error: any) {
      setExportError(error?.message || 'Export failed');
    } finally {
      setExportingFormat(null);
    }
  };

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-2xl shadow-sm overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 px-5 py-3 border-b border-slate-800 bg-slate-900/80">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <button
            type="button"
            onClick={() => onChange({ collapsed: !config.collapsed })}
            className="p-1 text-slate-400 hover:text-white rounded"
            title={config.collapsed ? 'Expand' : 'Collapse'}
          >
            {config.collapsed ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4" />}
          </button>
          <input
            type="text"
            value={config.title}
            onChange={e => onChange({ title: e.target.value })}
            className="bg-transparent border-b border-transparent focus:border-indigo-500 text-sm font-semibold text-slate-100 outline-none px-1 py-0.5 flex-1 min-w-0"
          />
          {resultRes.isRefreshing && <RefreshingBadge label={t('refreshingData')} />}
        </div>
        <div className="flex items-center gap-1.5">
          <select
            value={config.viewMode}
            onChange={e => onChange({ viewMode: e.target.value as any })}
            className="h-8 px-2 text-xs bg-slate-950 border border-slate-800 rounded-lg text-slate-200 focus:outline-none focus:border-indigo-500"
            title="View mode"
          >
            <option value="both">Table + Chart</option>
            <option value="table">Table only</option>
            <option value="chart">Chart only</option>
          </select>
          <button type="button" onClick={onDuplicate} className="p-1.5 text-slate-400 hover:text-indigo-400 rounded" title="Duplicate">
            <Copy className="w-4 h-4" />
          </button>
          <button type="button" onClick={onDelete} className="p-1.5 text-slate-400 hover:text-rose-400 rounded" title="Delete">
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>

      {!config.collapsed && (
        <div className="p-5 space-y-4">
          {/* Configurator */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Source table */}
            <div className="space-y-1">
              <label className="text-[11px] font-semibold text-slate-400">Source Table</label>
              <select
                value={config.table}
                onChange={e => onChange({ table: e.target.value, dimensions: [], offset: 0 })}
                className="w-full h-9 px-2.5 text-xs bg-slate-950 border border-slate-800 rounded-lg text-slate-200 focus:outline-none focus:border-indigo-500"
              >
                {TABLE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
            {/* Chart type */}
            <div className="space-y-1">
              <label className="text-[11px] font-semibold text-slate-400">Chart Type</label>
              <select
                value={config.chartType}
                onChange={e => onChange({ chartType: e.target.value as any })}
                className="w-full h-9 px-2.5 text-xs bg-slate-950 border border-slate-800 rounded-lg text-slate-200 focus:outline-none focus:border-indigo-500"
              >
                {CHART_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
          </div>

          {/* Dimensions */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-[11px] font-semibold text-slate-400">Group By (Dimensions)</label>
              <select
                value=""
                onChange={e => { if (e.target.value) addDimension(e.target.value); }}
                className="h-8 px-2 text-xs bg-slate-950 border border-slate-800 rounded-lg text-slate-200 focus:outline-none focus:border-indigo-500"
              >
                <option value="">+ Add dimension</option>
                {availableColumns.filter(c => !config.dimensions.includes(c)).map(c => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>
            <div className="flex flex-wrap gap-2">
              {config.dimensions.map((d, idx) => (
                <div key={idx} className="flex items-center gap-1 px-2 py-1 rounded-lg bg-indigo-500/10 border border-indigo-500/30 text-xs text-indigo-200">
                  <span className="font-mono">{d}</span>
                  <button type="button" onClick={() => moveDimension(idx, -1)} className="text-indigo-300 hover:text-white" title="Move up">↑</button>
                  <button type="button" onClick={() => moveDimension(idx, 1)} className="text-indigo-300 hover:text-white" title="Move down">↓</button>
                  <button type="button" onClick={() => removeDimension(idx)} className="text-rose-400 hover:text-rose-300" title="Remove">
                    <X className="w-3 h-3" />
                  </button>
                </div>
              ))}
              {config.dimensions.length === 0 && (
                <span className="text-xs text-slate-500">No grouping dimensions. Add at least one.</span>
              )}
            </div>
          </div>

          {/* Metrics */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-[11px] font-semibold text-slate-400">Metrics</label>
              <button
                type="button"
                onClick={addMetric}
                className="flex items-center gap-1 text-xs text-indigo-400 hover:text-indigo-300 font-medium"
              >
                <Plus className="w-3.5 h-3.5" /> Add metric
              </button>
            </div>
            <div className="space-y-2">
              {config.metrics.map((m, idx) => (
                <div key={m.id} className="flex flex-wrap items-center gap-2 bg-slate-950/60 p-2 rounded-lg border border-slate-800">
                  <select
                    value={m.aggregation}
                    onChange={e => updateMetric(idx, { aggregation: e.target.value })}
                    className="h-8 px-2 text-xs bg-slate-900 border border-slate-700 rounded text-slate-200 focus:outline-none focus:border-indigo-500"
                  >
                    {AGG_OPTIONS.map(a => <option key={a} value={a}>{a}</option>)}
                  </select>
                  {m.aggregation !== 'COUNT' && (
                    <select
                      value={m.column || ''}
                      onChange={e => updateMetric(idx, { column: e.target.value })}
                      className="h-8 px-2 text-xs bg-slate-900 border border-slate-700 rounded text-slate-200 focus:outline-none focus:border-indigo-500 font-mono"
                    >
                      {availableColumns.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                  )}
                  <input
                    type="text"
                    value={m.label || ''}
                    onChange={e => updateMetric(idx, { label: e.target.value })}
                    placeholder="Label"
                    className="h-8 px-2 text-xs bg-slate-900 border border-slate-700 rounded text-slate-200 focus:outline-none focus:border-indigo-500 flex-1 min-w-[100px]"
                  />
                  {config.metrics.length > 1 && (
                    <button type="button" onClick={() => removeMetric(idx)} className="p-1 text-rose-400 hover:text-rose-300">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Filters */}
          <div className="space-y-2">
            <button
              type="button"
              onClick={() => onChange({ filterBuilderOpen: !config.filterBuilderOpen })}
              className="flex items-center gap-1.5 text-xs font-semibold text-slate-300 hover:text-white"
            >
              <Filter className="w-3.5 h-3.5 text-indigo-400" />
              Advanced Filters {config.filters.length > 0 && `(${config.filters.length})`}
              <ChevronDown className={`w-3.5 h-3.5 transition-transform ${config.filterBuilderOpen ? 'rotate-180' : ''}`} />
            </button>
            {config.filterBuilderOpen && (
              <div className="p-3 bg-slate-950/60 border border-slate-800 rounded-xl space-y-2">
                <div className="flex items-center justify-between">
                  <button
                    type="button"
                    disabled={availableColumns.length === 0}
                    onClick={addFilterRow}
                    className="flex items-center gap-1 text-xs text-indigo-400 hover:text-indigo-300 font-medium disabled:opacity-50"
                  >
                    <Plus className="w-3.5 h-3.5" /> Add filter
                  </button>
                  {config.filters.length > 0 && (
                    <button
                      type="button"
                      onClick={() => onChange({ filters: [] })}
                      className="text-xs text-rose-400 hover:text-rose-300"
                    >
                      Clear
                    </button>
                  )}
                </div>
                {config.filters.length === 0 ? (
                  <p className="text-xs text-slate-500">No filter conditions.</p>
                ) : (
                  <div className="space-y-2">
                    {config.filters.map((f, idx) => (
                      <div key={idx} className="flex flex-wrap items-center gap-2">
                        <select
                          value={f.column}
                          onChange={e => updateFilter(idx, { column: e.target.value })}
                          className="h-8 px-2 text-xs bg-slate-900 border border-slate-700 rounded text-slate-200 focus:outline-none focus:border-indigo-500"
                        >
                          {availableColumns.map(c => <option key={c} value={c}>{c}</option>)}
                        </select>
                        <select
                          value={f.operator}
                          onChange={e => updateFilter(idx, { operator: e.target.value as FilterOperator })}
                          className="h-8 px-2 text-xs bg-slate-900 border border-slate-700 rounded text-slate-200 focus:outline-none focus:border-indigo-500"
                        >
                          <option value="contains">contains</option>
                          <option value="equals">equals</option>
                          <option value="not_equals">not equals</option>
                          <option value="starts_with">starts with</option>
                          <option value="ends_with">ends with</option>
                          <option value="greater_than">greater than</option>
                          <option value="less_than">less than</option>
                          <option value="between">between</option>
                          <option value="is_empty">is empty</option>
                          <option value="is_not_empty">is not empty</option>
                          <option value="before_date">before date</option>
                          <option value="after_date">after date</option>
                        </select>
                        {!['is_empty', 'is_not_empty'].includes(f.operator) && (
                          <input
                            type="text"
                            value={f.value ?? ''}
                            onChange={e => updateFilter(idx, { value: e.target.value })}
                            placeholder="Value..."
                            className="h-8 px-2.5 text-xs bg-slate-900 border border-slate-700 rounded text-slate-200 placeholder-slate-500 focus:outline-none focus:border-indigo-500 flex-1 min-w-[120px]"
                          />
                        )}
                        {f.operator === 'between' && (
                          <input
                            type="text"
                            value={f.value2 || ''}
                            onChange={e => updateFilter(idx, { value2: e.target.value })}
                            placeholder="Second value..."
                            className="h-8 px-2.5 text-xs bg-slate-900 border border-slate-700 rounded text-slate-200 placeholder-slate-500 focus:outline-none focus:border-indigo-500 flex-1 min-w-[120px]"
                          />
                        )}
                        <button type="button" onClick={() => removeFilter(idx)} className="p-1 text-slate-400 hover:text-rose-400">
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Limit + sort */}
          <div className="flex flex-wrap items-center gap-3">
            <div className="space-y-1">
              <label className="text-[11px] font-semibold text-slate-400">Top N</label>
              <select
                value={config.limit}
                onChange={e => onChange({ limit: Number(e.target.value), offset: 0 })}
                className="h-8 px-2 text-xs bg-slate-950 border border-slate-800 rounded-lg text-slate-200 focus:outline-none focus:border-indigo-500"
              >
                {[5, 10, 15, 25, 50, 100].map(n => <option key={n} value={n}>Top {n}</option>)}
              </select>
            </div>
          </div>
        </div>
      )}

      {/* Results */}
      {!config.collapsed && (
        <div className="px-5 pb-5 space-y-4">
          {resultRes.isLoading && !resultRes.data && (
            <ChartSkeleton />
          )}
          {resultRes.isError && (
            <ErrorRetryCard message={resultRes.error} onRetry={() => resultRes.reload({ force: true })} />
          )}
          {!resultRes.isLoading && !resultRes.isError && (!rows || rows.length === 0) && config.dimensions.length > 0 && (
            <EmptyStateCard title="No results" description="No aggregated records returned for this combination." />
          )}
          {rows && rows.length > 0 && (
            <>
              {/* Chart */}
              {(config.viewMode === 'chart' || config.viewMode === 'both') && (
                <div ref={chartContainerRef} className="h-[320px] w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    {config.chartType === 'bar' ? (
                      <BarChart data={chartData} margin={{ top: 20, right: 30, left: 10, bottom: 40 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                        <XAxis dataKey="name" stroke="#64748b" fontSize={11} angle={-25} textAnchor="end" />
                        <YAxis stroke="#64748b" fontSize={11} />
                        <Tooltip contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155', borderRadius: '8px', fontSize: '11px' }} />
                        <Legend wrapperStyle={{ fontSize: '11px' }} />
                        {metricKeys.map((k: string, i: number) => (
                          <Bar key={k} dataKey={k} fill={COLORS[i % COLORS.length]} radius={[4, 4, 0, 0]} />
                        ))}
                      </BarChart>
                    ) : config.chartType === 'line' ? (
                      <LineChart data={chartData} margin={{ top: 20, right: 30, left: 10, bottom: 40 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                        <XAxis dataKey="name" stroke="#64748b" fontSize={11} angle={-25} textAnchor="end" />
                        <YAxis stroke="#64748b" fontSize={11} />
                        <Tooltip contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155', borderRadius: '8px', fontSize: '11px' }} />
                        <Legend wrapperStyle={{ fontSize: '11px' }} />
                        {metricKeys.map((k: string, i: number) => (
                          <Line key={k} type="monotone" dataKey={k} stroke={COLORS[i % COLORS.length]} strokeWidth={2} dot={{ r: 3 }} />
                        ))}
                      </LineChart>
                    ) : config.chartType === 'area' ? (
                      <AreaChart data={chartData} margin={{ top: 20, right: 30, left: 10, bottom: 40 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                        <XAxis dataKey="name" stroke="#64748b" fontSize={11} angle={-25} textAnchor="end" />
                        <YAxis stroke="#64748b" fontSize={11} />
                        <Tooltip contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155', borderRadius: '8px', fontSize: '11px' }} />
                        <Legend wrapperStyle={{ fontSize: '11px' }} />
                        {metricKeys.map((k: string, i: number) => (
                          <Area key={k} type="monotone" dataKey={k} stroke={COLORS[i % COLORS.length]} fill={COLORS[i % COLORS.length]} fillOpacity={0.2} />
                        ))}
                      </AreaChart>
                    ) : (
                      <PieChart>
                        <Pie
                          data={chartData}
                          dataKey={metricKeys[0]}
                          nameKey="name"
                          cx="50%"
                          cy="50%"
                          outerRadius={120}
                          innerRadius={60}
                          paddingAngle={3}
                        >
                          {chartData.map((_: any, index: number) => (
                            <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                          ))}
                        </Pie>
                        <Tooltip contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155', borderRadius: '8px', fontSize: '11px' }} />
                        <Legend wrapperStyle={{ fontSize: '11px' }} />
                      </PieChart>
                    )}
                  </ResponsiveContainer>
                </div>
              )}

              {/* Table */}
              {(config.viewMode === 'table' || config.viewMode === 'both') && (
                <div className="overflow-x-auto rounded-xl border border-slate-800">
                  <table className="w-full text-xs">
                    <thead className="bg-slate-950/60 text-slate-300">
                      <tr>
                        {tableColumns.map(col => (
                          <th
                            key={col}
                            onClick={() => handleSort(col)}
                            className="px-3 py-2 text-left font-semibold cursor-pointer hover:text-white whitespace-nowrap"
                          >
                            {col}
                            {config.sortBy === col && (
                              <span className="ml-1">{config.sortOrder === 'ASC' ? '▲' : '▼'}</span>
                            )}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((r: any, i: number) => (
                        <tr key={i} className="border-t border-slate-800/60 hover:bg-slate-800/40">
                          {tableColumns.map(col => (
                            <td key={col} className="px-3 py-2 tabular-nums whitespace-nowrap">
                              {r[col] === null || r[col] === undefined ? '—' : String(r[col])}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <div className="flex items-center justify-between px-3 py-2 text-xs text-slate-400 border-t border-slate-800">
                    <span>{rows.length} rows (offset {config.offset})</span>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        disabled={config.offset === 0}
                        onClick={() => onChange({ offset: Math.max(0, config.offset - config.limit) })}
                        className="px-2 py-1 rounded border border-slate-700 hover:bg-slate-800 disabled:opacity-40"
                      >
                        Prev
                      </button>
                      <button
                        type="button"
                        disabled={rows.length < config.limit}
                        onClick={() => onChange({ offset: config.offset + config.limit })}
                        className="px-2 py-1 rounded border border-slate-700 hover:bg-slate-800 disabled:opacity-40"
                      >
                        Next
                      </button>
                      <button
                        type="button"
                        onClick={exportCsv}
                        className="px-2 py-1 rounded border border-slate-700 hover:bg-slate-800 flex items-center gap-1"
                      >
                        <Download className="w-3.5 h-3.5" /> CSV
                      </button>
                      <button
                        type="button"
                        onClick={() => exportOne('xlsx')}
                        disabled={exportingFormat !== null}
                        className="px-2 py-1 rounded border border-slate-700 hover:bg-slate-800 disabled:opacity-50 flex items-center gap-1"
                      >
                        <Download className="w-3.5 h-3.5" /> XLSX
                      </button>
                      <button
                        type="button"
                        onClick={() => exportOne('pdf')}
                        disabled={exportingFormat !== null}
                        className="px-2 py-1 rounded border border-slate-700 hover:bg-slate-800 disabled:opacity-50 flex items-center gap-1"
                      >
                        <Download className="w-3.5 h-3.5" /> PDF
                      </button>
                      <button
                        type="button"
                        onClick={() => exportOne('docx')}
                        disabled={exportingFormat !== null}
                        className="px-2 py-1 rounded border border-slate-700 hover:bg-slate-800 disabled:opacity-50 flex items-center gap-1"
                      >
                        <Download className="w-3.5 h-3.5" /> Word
                      </button>
                    </div>
                  </div>
                  {exportError && <p role="alert" className="px-3 py-2 text-xs text-rose-300">{exportError}</p>}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

export const Analytics: React.FC = () => {
  const { t, activeMission, apiFetch, authToken, language } = useApp();

  const [analyses, setAnalyses] = useState<AnalysisConfig[]>(() => [newAnalysis(1)]);
  const [savedViews, setSavedViews] = useState<any[]>([]);
  const [selectedSaved, setSelectedSaved] = useState('');
  const [saveName, setSaveName] = useState('');
  const [saving, setSaving] = useState(false);
  const [managing, setManaging] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportStage, setExportStage] = useState('');
  const [exportError, setExportError] = useState<string | null>(null);
  const chartElements = useRef(new Map<string, HTMLDivElement>());

  const registerChartElement = useCallback((analysisId: string, element: HTMLDivElement | null) => {
    if (element) chartElements.current.set(analysisId, element);
    else chartElements.current.delete(analysisId);
  }, []);

  const loadSavedViews = useCallback(async () => {
    try {
      const res = await apiFetch('/api/v1/saved-views?tableName=analytics_workspace');
      const json = await res.json().catch(() => null);
      if (res.ok && Array.isArray(json)) setSavedViews(json);
    } catch { /* ignore */ }
  }, [apiFetch]);

  useEffect(() => { loadSavedViews(); }, [loadSavedViews]);

  const addAnalysis = () => {
    setAnalyses(prev => [...prev, newAnalysis(prev.length + 1)]);
  };

  const updateAnalysis = (id: string, patch: Partial<AnalysisConfig>) => {
    setAnalyses(prev => prev.map(a => a.id === id ? { ...a, ...patch } : a));
  };

  const duplicateAnalysis = (id: string) => {
    setAnalyses(prev => {
      const src = prev.find(a => a.id === id);
      if (!src) return prev;
      const copy: AnalysisConfig = { ...src, id: (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : `a_${Date.now()}`, title: src.title + ' (copy)', collapsed: false };
      const idx = prev.findIndex(a => a.id === id);
      const next = [...prev];
      next.splice(idx + 1, 0, copy);
      return next;
    });
  };

  const deleteAnalysis = (id: string) => {
    setAnalyses(prev => (prev.length <= 1 ? prev : prev.filter(a => a.id !== id)));
  };

  const collectAnalyses = async (includeCharts: boolean) => Promise.all(analyses.map(async a => {
    const analysis: Record<string, unknown> = {
      title: a.title,
      table: a.table,
      dimensions: a.dimensions,
      metrics: a.metrics.map(m => ({ id: m.id, label: m.label, aggregation: m.aggregation, column: m.column })),
      filters: a.filters,
      limit: a.limit,
      offset: a.offset,
      sortBy: a.sortBy,
      sortOrder: a.sortOrder,
    };
    if (includeCharts && a.viewMode !== 'table') {
      const chartImage = await renderChartPngDataUrl(chartElements.current.get(a.id) || null, {
        title: a.title,
        subtitle: a.table,
        isRtl: language === 'ar',
      });
      if (!chartImage) {
        throw new Error(`Chart "${a.title}" is not ready to export. Wait for it to finish rendering and try again.`);
      }
      analysis.chartImage = chartImage;
    }
    return analysis;
  }));

  const exportAll = async (format: string) => {
    setExporting(true);
    setExportError(null);
    setExportStage('Preparing export...');
    try {
      setExportStage('Generating tables...');
      const includeCharts = ['pdf', 'xlsx', 'docx'].includes(format);
      const exportAnalyses = await collectAnalyses(includeCharts);
      const res = await apiFetch('/api/v1/exports/analytics', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ format, analyses: exportAnalyses, language }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => null);
        throw new Error(json?.error || `Export failed (${res.status})`);
      }
      setExportStage('Creating file...');
      const blob = await res.blob();
      const filename = res.headers.get('X-Export-Filename') || `analytics_export.${format}`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      setExportStage('Download ready');
    } catch (err: any) {
      setExportError(err?.message || 'Export failed');
    } finally {
      setTimeout(() => { setExporting(false); setExportStage(''); }, 1500);
    }
  };

  const saveWorkspace = async () => {
    if (!saveName.trim()) return;
    setSaving(true);
    try {
      const payload = {
        tableName: 'analytics_workspace',
        viewName: saveName.trim(),
        filters: { analyses: analyses.map(({ collapsed, filterBuilderOpen, ...rest }) => rest) },
      };
      const res = await apiFetch('/api/v1/saved-views', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        setSaveName('');
        loadSavedViews();
      }
    } catch { /* ignore */ } finally {
      setSaving(false);
    }
  };

  const loadWorkspace = async (viewId: string) => {
    const v = savedViews.find(x => String(x.id) === String(viewId));
    if (!v) return;
    try {
      const parsed = JSON.parse(v.filters_json || '{}');
      if (Array.isArray(parsed.analyses)) {
        setAnalyses(parsed.analyses.map((a: any) => ({ ...newAnalysis(1), ...a, collapsed: false, filterBuilderOpen: false })));
      }
    } catch { /* ignore */ }
  };

  const updateWorkspace = async () => {
    if (!selectedSaved) return;
    setSaving(true);
    try {
      await apiFetch(`/api/v1/saved-views/${selectedSaved}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filters: { analyses: analyses.map(({ collapsed, filterBuilderOpen, ...rest }) => rest) } }),
      });
      loadSavedViews();
    } catch { /* ignore */ } finally {
      setSaving(false);
    }
  };

  const duplicateWorkspace = async () => {
    if (!selectedSaved) return;
    const v = savedViews.find(x => String(x.id) === String(selectedSaved));
    if (!v) return;
    setSaving(true);
    try {
      await apiFetch('/api/v1/saved-views', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tableName: 'analytics_workspace',
          viewName: `${v.view_name} (copy)`,
          filters: JSON.parse(v.filters_json || '{}'),
        }),
      });
      loadSavedViews();
    } catch { /* ignore */ } finally {
      setSaving(false);
    }
  };

  const deleteWorkspace = async () => {
    if (!selectedSaved) return;
    if (!window.confirm('Delete this saved workspace?')) return;
    try {
      await apiFetch(`/api/v1/saved-views/${selectedSaved}`, { method: 'DELETE' });
      setSelectedSaved('');
      loadSavedViews();
    } catch { /* ignore */ }
  };

  const renameWorkspace = async (newName: string) => {
    if (!selectedSaved || !newName.trim()) return;
    try {
      await apiFetch(`/api/v1/saved-views/${selectedSaved}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ viewName: newName.trim() }),
      });
      loadSavedViews();
    } catch { /* ignore */ }
  };

  return (
    <div className="space-y-6">
      {/* Title */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-100 flex items-center gap-2 flex-wrap">
            <BarChart3 className="w-5 h-5 text-indigo-400" />
            <span>Analytics Workspace</span>
          </h1>
          <p className="text-xs text-slate-400 mt-0.5">
            Build multiple independent analyses with multi-column grouping, multiple metrics, and charts.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-1.5">
            <span className="text-[11px] text-slate-400">Export All:</span>
            {['xlsx', 'csv', 'pdf', 'docx', 'zip'].map(fmt => (
              <button
                key={fmt}
                type="button"
                onClick={() => exportAll(fmt)}
                disabled={exporting || analyses.length === 0}
                className="px-2.5 py-1.5 text-xs font-medium rounded-lg bg-slate-800 border border-slate-700 text-slate-200 hover:bg-slate-700 disabled:opacity-50 transition-colors uppercase"
              >
                {fmt}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={addAnalysis}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white shadow-sm shadow-indigo-600/30 transition-colors"
          >
            <Plus className="w-3.5 h-3.5" /> Add Analysis
          </button>
        </div>
      </div>

      {/* Workspace save/load/manage */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-3 space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <FolderOpen className="w-4 h-4 text-slate-400" />
          <select
            value={selectedSaved}
            onChange={e => { setSelectedSaved(e.target.value); if (e.target.value) loadWorkspace(e.target.value); }}
            className="h-8 px-2 text-xs bg-slate-950 border border-slate-800 rounded-lg text-slate-200 focus:outline-none focus:border-indigo-500"
          >
            <option value="">Load saved workspace...</option>
            {savedViews.map((v: any) => <option key={v.id} value={v.id}>{v.view_name}</option>)}
          </select>
          {selectedSaved && (
            <>
              <button
                type="button"
                onClick={updateWorkspace}
                disabled={saving}
                className="px-2.5 py-1.5 text-xs font-medium rounded-lg bg-slate-800 border border-slate-700 text-slate-200 hover:bg-slate-700 disabled:opacity-50 transition-colors"
                title="Overwrite selected workspace with current config"
              >
                Update
              </button>
              <button
                type="button"
                onClick={duplicateWorkspace}
                disabled={saving}
                className="px-2.5 py-1.5 text-xs font-medium rounded-lg bg-slate-800 border border-slate-700 text-slate-200 hover:bg-slate-700 disabled:opacity-50 transition-colors"
                title="Duplicate selected workspace"
              >
                Duplicate
              </button>
              <button
                type="button"
                onClick={deleteWorkspace}
                className="px-2.5 py-1.5 text-xs font-medium rounded-lg bg-rose-900/40 border border-rose-800 text-rose-300 hover:bg-rose-900/60 transition-colors"
                title="Delete selected workspace"
              >
                Delete
              </button>
              <input
                type="text"
                placeholder="Rename..."
                className="h-8 px-2.5 text-xs bg-slate-950 border border-slate-800 rounded-lg text-slate-200 placeholder-slate-500 focus:outline-none focus:border-indigo-500 w-32"
                onKeyDown={e => {
                  if (e.key === 'Enter') {
                    renameWorkspace((e.target as HTMLInputElement).value);
                    (e.target as HTMLInputElement).value = '';
                  }
                }}
              />
            </>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="text"
            value={saveName}
            onChange={e => setSaveName(e.target.value)}
            placeholder="New workspace name..."
            className="h-8 px-2.5 text-xs bg-slate-950 border border-slate-800 rounded-lg text-slate-200 placeholder-slate-500 focus:outline-none focus:border-indigo-500 flex-1 min-w-[160px]"
          />
          <button
            type="button"
            onClick={saveWorkspace}
            disabled={saving || !saveName.trim()}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-slate-800 border border-slate-700 text-slate-200 hover:bg-slate-700 disabled:opacity-50 transition-colors"
          >
            <Save className="w-3.5 h-3.5" /> {saving ? 'Saving...' : 'Save as New'}
          </button>
        </div>
      </div>

      {/* Export progress */}
      {(exporting || exportError) && (
        <div className={`rounded-xl border p-3 text-xs ${exportError ? 'border-rose-800 bg-rose-950/40 text-rose-300' : 'border-indigo-800 bg-indigo-950/40 text-indigo-300'}`}>
          {exportError ? `Export failed: ${exportError}` : (exportStage || 'Working...')}
        </div>
      )}

      {/* Analyses */}
      <div className="space-y-4">
        {analyses.map((a, idx) => (
          <AnalysisPanel
            key={a.id}
            config={a}
            onChange={patch => updateAnalysis(a.id, patch)}
            onDuplicate={() => duplicateAnalysis(a.id)}
            onDelete={() => deleteAnalysis(a.id)}
            onChartElement={registerChartElement}
            mission={activeMission}
          />
        ))}
      </div>

      {analyses.length === 0 && (
        <EmptyStateCard title="No analyses" description="Click 'Add Analysis' to create your first analysis." />
      )}
    </div>
  );
};
