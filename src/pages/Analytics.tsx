import React, { useState, useEffect } from 'react';
import { useApp } from '../context/AppContext.js';
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
  Download,
  SlidersHorizontal,
  Table as TableIcon,
  RefreshCw,
  Sparkles,
} from 'lucide-react';

export const Analytics: React.FC = () => {
  const { activeMission, apiFetch, authToken } = useApp();

  const [table, setTable] = useState('registrations');
  const [dimensionCol, setDimensionCol] = useState('country');
  const [metricCol] = useState('');
  const [aggregation, setAggregation] = useState<'COUNT' | 'SUM' | 'AVG' | 'MIN' | 'MAX'>('COUNT');
  const [chartType, setChartType] = useState<'bar' | 'line' | 'pie' | 'area'>('bar');
  const [limit, setLimit] = useState(15);

  const [availableColumns, setAvailableColumns] = useState<string[]>([]);
  const [chartData, setChartData] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch columns for selected table
  useEffect(() => {
    if (!authToken) return;
    apiFetch(`/api/v1/tables/${table}?pageSize=1`)
      .then(r => (r.ok ? r.json() : null))
      .then(res => {
        if (res?.columns && Array.isArray(res.columns)) {
          const names = res.columns.map((c: any) => c.name);
          setAvailableColumns(names);
          if (!names.includes(dimensionCol)) {
            setDimensionCol(names[0] || 'id');
          }
        }
      })
      .catch(() => {});
  }, [table, authToken]);

  // Execute Dynamic Analytics Query
  const executeQuery = () => {
    if (!authToken) return;
    setLoading(true);
    setError(null);

    apiFetch('/api/v1/analytics/query', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        table,
        dimensionCol,
        metricCol: metricCol || undefined,
        aggregation,
        mission: activeMission,
        limit,
      }),
    })
      .then(async res => {
        if (!res.ok) {
          const json = await res.json();
          throw new Error(json.error || 'Query failed');
        }
        return res.json();
      })
      .then(data => {
        setChartData(data || []);
      })
      .catch(err => {
        setError(err.message);
        setChartData([]);
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    if (!authToken) return;
    executeQuery();
  }, [table, dimensionCol, aggregation, activeMission, limit, authToken]);

  const COLORS = ['#6366f1', '#3b82f6', '#10b981', '#f59e0b', '#ec4899', '#8b5cf6', '#06b6d4', '#14b8a6', '#f43f5e'];

  return (
    <div className="space-y-6">
      {/* Title */}
      <div>
        <h1 className="text-xl font-bold text-slate-100 flex items-center gap-2">
          <BarChart3 className="w-5 h-5 text-indigo-400" />
          <span>Dynamic Mission Analytics & Custom Chart Studio</span>
        </h1>
        <p className="text-xs text-slate-400 mt-0.5">
          Build multi-dimensional queries, aggregate metrics, and visualize distributions across PostgreSQL tables.
        </p>
      </div>

      {/* Query Builder Control Panel */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-sm space-y-4">
        <div className="flex items-center justify-between pb-3 border-b border-slate-800">
          <span className="text-xs font-bold text-slate-200 uppercase tracking-wider flex items-center gap-2">
            <SlidersHorizontal className="w-4 h-4 text-indigo-400" />
            <span>Aggregation & Dimension Configurator</span>
          </span>
          <button
            onClick={executeQuery}
            disabled={loading}
            className="flex items-center gap-1.5 px-4 py-1.5 text-xs font-semibold rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white shadow-sm shadow-indigo-600/30 disabled:opacity-50 transition-colors"
          >
            <Play className="w-3.5 h-3.5 fill-current" />
            <span>{loading ? 'Executing Query...' : 'Run Analysis'}</span>
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
          {/* Table */}
          <div className="space-y-1">
            <label className="text-[11px] font-semibold text-slate-400">Database Table</label>
            <select
              value={table}
              onChange={e => setTable(e.target.value)}
              className="w-full h-9 px-2.5 text-xs bg-slate-950 border border-slate-800 rounded-lg text-slate-200 focus:outline-none focus:border-indigo-500"
            >
              <option value="registrations">registrations</option>
              <option value="network_cells">network_cells</option>
              <option value="targets">targets</option>
              <option value="gps_history">gps_history</option>
              <option value="wifi_access_points">wifi_access_points</option>
              <option value="map_cells">map_cells</option>
              <option value="sms_calls">sms_calls</option>
              <option value="missions">missions</option>
              <option value="tac_numbers">tac_numbers</option>
              <option value="plmn_storage">plmn_storage</option>
            </select>
          </div>

          {/* Grouping Dimension */}
          <div className="space-y-1">
            <label className="text-[11px] font-semibold text-slate-400">Grouping Dimension</label>
            <select
              value={dimensionCol}
              onChange={e => setDimensionCol(e.target.value)}
              className="w-full h-9 px-2.5 text-xs bg-slate-950 border border-slate-800 rounded-lg text-slate-200 focus:outline-none focus:border-indigo-500 font-mono"
            >
              {availableColumns.map(col => (
                <option key={col} value={col}>
                  {col}
                </option>
              ))}
            </select>
          </div>

          {/* Aggregation Function */}
          <div className="space-y-1">
            <label className="text-[11px] font-semibold text-slate-400">Aggregation Func</label>
            <select
              value={aggregation}
              onChange={e => setAggregation(e.target.value as any)}
              className="w-full h-9 px-2.5 text-xs bg-slate-950 border border-slate-800 rounded-lg text-slate-200 focus:outline-none focus:border-indigo-500"
            >
              <option value="COUNT">COUNT (Rows)</option>
              <option value="SUM">SUM (Total)</option>
              <option value="AVG">AVG (Average)</option>
              <option value="MAX">MAX (Maximum)</option>
              <option value="MIN">MIN (Minimum)</option>
            </select>
          </div>

          {/* Chart Type */}
          <div className="space-y-1">
            <label className="text-[11px] font-semibold text-slate-400">Chart Visualization</label>
            <select
              value={chartType}
              onChange={e => setChartType(e.target.value as any)}
              className="w-full h-9 px-2.5 text-xs bg-slate-950 border border-slate-800 rounded-lg text-slate-200 focus:outline-none focus:border-indigo-500"
            >
              <option value="bar">Bar Chart</option>
              <option value="line">Line Chart</option>
              <option value="area">Area Chart</option>
              <option value="pie">Donut / Pie Chart</option>
            </select>
          </div>

          {/* Limit */}
          <div className="space-y-1">
            <label className="text-[11px] font-semibold text-slate-400">Top N Groups</label>
            <select
              value={limit}
              onChange={e => setLimit(Number(e.target.value))}
              className="w-full h-9 px-2.5 text-xs bg-slate-950 border border-slate-800 rounded-lg text-slate-200 focus:outline-none focus:border-indigo-500"
            >
              <option value="5">Top 5</option>
              <option value="10">Top 10</option>
              <option value="15">Top 15</option>
              <option value="25">Top 25</option>
              <option value="50">Top 50</option>
            </select>
          </div>
        </div>
      </div>

      {/* Error alert */}
      {error && (
        <div className="p-3 bg-rose-500/10 border border-rose-500/30 rounded-xl text-xs text-rose-300">
          {error}
        </div>
      )}

      {/* Chart Canvas */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-sm space-y-4">
        <div className="flex items-center justify-between">
          <span className="text-xs font-bold text-slate-200">
            Distribution of {aggregation}({table}) grouped by {dimensionCol}
          </span>
          <span className="text-[11px] text-slate-400">
            {chartData.length} distinct groups returned
          </span>
        </div>

        <div className="h-96 w-full">
          {loading ? (
            <div className="w-full h-full flex items-center justify-center text-xs text-slate-500 gap-2">
              <RefreshCw className="w-4 h-4 animate-spin text-indigo-400" />
              <span>Computing SQL aggregations...</span>
            </div>
          ) : chartData.length === 0 ? (
            <div className="w-full h-full flex items-center justify-center text-xs text-slate-500">
              No aggregated records returned for this combination.
            </div>
          ) : chartType === 'bar' ? (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} margin={{ top: 20, right: 30, left: 10, bottom: 40 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                <XAxis dataKey="dimension" stroke="#64748b" fontSize={11} angle={-25} textAnchor="end" />
                <YAxis stroke="#64748b" fontSize={11} />
                <Tooltip contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155', borderRadius: '8px', fontSize: '11px' }} />
                <Bar dataKey="value" name={aggregation} fill="#6366f1" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : chartType === 'line' ? (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData} margin={{ top: 20, right: 30, left: 10, bottom: 40 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                <XAxis dataKey="dimension" stroke="#64748b" fontSize={11} angle={-25} textAnchor="end" />
                <YAxis stroke="#64748b" fontSize={11} />
                <Tooltip contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155', borderRadius: '8px', fontSize: '11px' }} />
                <Line type="monotone" dataKey="value" stroke="#10b981" strokeWidth={2} dot={{ r: 4 }} />
              </LineChart>
            </ResponsiveContainer>
          ) : chartType === 'area' ? (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData} margin={{ top: 20, right: 30, left: 10, bottom: 40 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                <XAxis dataKey="dimension" stroke="#64748b" fontSize={11} angle={-25} textAnchor="end" />
                <YAxis stroke="#64748b" fontSize={11} />
                <Tooltip contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155', borderRadius: '8px', fontSize: '11px' }} />
                <Area type="monotone" dataKey="value" stroke="#3b82f6" fill="#3b82f6" fillOpacity={0.2} />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={chartData}
                  dataKey="value"
                  nameKey="dimension"
                  cx="50%"
                  cy="50%"
                  outerRadius={120}
                  innerRadius={60}
                  paddingAngle={3}
                >
                  {chartData.map((_, index) => (
                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155', borderRadius: '8px', fontSize: '11px' }} />
                <Legend wrapperStyle={{ fontSize: '11px' }} />
              </PieChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>
    </div>
  );
};
