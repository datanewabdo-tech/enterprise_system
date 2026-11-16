import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useApp } from '../context/AppContext.js';
import { DashboardFilterState, INITIAL_DASHBOARD_FILTERS } from '../types/index.js';
import { GlobalFilterPanel } from '../components/dashboard/GlobalFilterPanel.js';
import { BtsLocationsMap } from '../components/dashboard/BtsLocationsMap.js';
import { ExportDashboardModal } from '../components/dashboard/ExportDashboardModal.js';
import { ChartExportMenu } from '../components/dashboard/ChartExportMenu.js';
import { renderChartPngDataUrl } from '../utils/chartExporter.js';
import {
  BarChart,
  Bar,
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
  Target,
  Users,
  Radio,
  Crosshair,
  Activity,
  RefreshCw,
  AlertTriangle,
  CheckCircle2,
  ShieldAlert,
  Download,
  Globe,
  MapPin,
  Smartphone,
  Shield,
  Building2,
  Compass,
  FileUp,
  Navigation,
  FolderArchive,
  X,
} from 'lucide-react';

export const Dashboard: React.FC<{ onNavigate: (page: string) => void }> = ({ onNavigate }) => {
  const { t, language, activeMission, apiFetch, authToken, missions, currentUser, addNotification, refreshMissions } = useApp();
  const isAr = language === 'ar';

  const [filters, setFilters] = useState<DashboardFilterState>(INITIAL_DASHBOARD_FILTERS);
  const [filterOptions, setFilterOptions] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<any | null>(null);
  const [exportModalOpen, setExportModalOpen] = useState(false);

  // Ambiguity resolution modal state
  const [ambiguityModalOpen, setAmbiguityModalOpen] = useState(false);
  const [ambiguities, setAmbiguities] = useState<any[]>([]);
  const [resolvingId, setResolvingId] = useState<number | null>(null);

  // Chart Refs & Map Snapshot callback for PNG/SVG/PDF embedding
  const regCountryChartRef = useRef<HTMLDivElement>(null);
  const mccChartRef = useRef<HTMLDivElement>(null);
  const militaryChartRef = useRef<HTMLDivElement>(null);
  const civilianChartRef = useRef<HTMLDivElement>(null);
  const mapSnapshotCaptureRef = useRef<(() => Promise<string | null>) | null>(null);

  // Sync top Navbar activeMission dropdown into filter missionIds
  useEffect(() => {
    if (activeMission === 'ALL') {
      setFilters(prev => (prev.missionIds.length === 0 ? prev : { ...prev, missionIds: [] }));
    } else {
      const id = Number(activeMission);
      if (Number.isInteger(id) && id > 0) {
        setFilters(prev => ({ ...prev, missionIds: [id] }));
      }
    }
  }, [activeMission]);

  // Fetch filter dropdown options once authenticated
  useEffect(() => {
    if (!authToken) return;
    apiFetch('/api/v1/analytics/filter-options')
      .then(r => (r.ok ? r.json() : null))
      .then(opts => {
        if (opts) setFilterOptions(opts);
      })
      .catch(() => {});
  }, [authToken, apiFetch]);

  const buildFilterPayload = useCallback((f: DashboardFilterState) => {
    return {
      missionIds: f.missionIds,
      country: f.country,
      countryCode: f.countryCode,
      imsi: f.imsi || undefined,
      imei: f.imei || undefined,
      tmsi: f.tmsi || undefined,
      btsName: f.btsName || undefined,
      bts: f.bts || undefined,
      ueModel: f.ueModel,
      lastSeenFrom: f.lastSeenFrom || undefined,
      lastSeenTo: f.lastSeenTo || undefined,
      btsAltitudeMin: f.btsAltitudeMin || undefined,
      btsAltitudeMax: f.btsAltitudeMax || undefined,
      distanceMinFrom: f.distanceMinFrom || undefined,
      distanceMinTo: f.distanceMinTo || undefined,
      distanceMaxFrom: f.distanceMaxFrom || undefined,
      distanceMaxTo: f.distanceMaxTo || undefined,
      hasBtsLocation: f.hasBtsLocation,
      btsLocationOutdated: f.btsLocationOutdated,
      hasDeviceLocation: f.hasDeviceLocation,
      action: f.action,
      update: f.update,
      rat: f.rat,
      mcc: f.mcc,
      mnc: f.mnc,
      lac: f.lac || undefined,
      cellId: f.cellId || undefined,
      channel: f.channel || undefined,
      bsic: f.bsic || undefined,
      pci: f.pci || undefined,
      psc: f.psc || undefined,
      rxLevMin: f.rxLevMin || undefined,
      rxLevMax: f.rxLevMax || undefined,
      rxLevDbmMin: f.rxLevDbmMin || undefined,
      rxLevDbmMax: f.rxLevDbmMax || undefined,
      downlinkMin: f.downlinkMin || undefined,
      downlinkMax: f.downlinkMax || undefined,
      dlBandwidthMin: f.dlBandwidthMin || undefined,
      dlBandwidthMax: f.dlBandwidthMax || undefined,
      directionMin: f.directionMin || undefined,
      directionMax: f.directionMax || undefined,
      isNeighbour: f.isNeighbour,
      isPcs1900: f.isPcs1900,
      hasCoordinates: f.hasCoordinates,
      plmnQuery: f.plmnQuery || undefined,
    };
  }, []);

  const fetchDashboardData = useCallback(() => {
    if (!authToken) return () => {};
    setLoading(true);
    const timer = setTimeout(() => {
      apiFetch('/api/v1/analytics/dashboard', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildFilterPayload(filters)),
      })
        .then(res => res.json())
        .then(json => {
          if (!json.error) setData(json);
        })
        .catch(err => console.error(err))
        .finally(() => setLoading(false));
    }, 120);
    return () => clearTimeout(timer);
  }, [filters, authToken, apiFetch, buildFilterPayload]);

  useEffect(() => {
    const cleanup = fetchDashboardData();
    return cleanup;
  }, [fetchDashboardData]);

  const loadAmbiguities = async () => {
    const res = await apiFetch('/api/v1/missions/ambiguities');
    if (res.ok) {
      setAmbiguities(await res.json());
      setAmbiguityModalOpen(true);
    }
  };

  const resolveAmbiguity = async (ambId: number, missionId: number) => {
    setResolvingId(ambId);
    try {
      const res = await apiFetch(`/api/v1/missions/ambiguities/${ambId}/resolve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ missionId }),
      });
      if (res.ok) {
        setAmbiguities(prev => prev.filter(a => a.id !== ambId));
        addNotification({ title: 'Ambiguity Resolved', message: `Linked record to Mission #${missionId}`, type: 'success' });
        refreshMissions();
        fetchDashboardData();
      }
    } finally {
      setResolvingId(null);
    }
  };

  const regTitle = isAr
    ? data?.registrationsByCountry?.titleAr || 'أعداد شرائح الاتصال المرصودة لكل دولة'
    : data?.registrationsByCountry?.titleEn || 'Detected SIM Registrations by Country';
  const mccTitle = isAr
    ? data?.networkCellsByMcc?.titleAr || 'إجمالي الخلايا المرصودة لكل دولة'
    : data?.networkCellsByMcc?.titleEn || 'Total Detected Network Cells by Country (MCC)';
  const milTitle = isAr
    ? data?.militaryNetworks?.titleAr || 'شبكات الاتصال بالهواتف المحمولة العسكرية (الإسرائيلية والمصرية)'
    : data?.militaryNetworks?.titleEn || 'Military Mobile Networks (Egypt & Israel)';
  const civTitle = isAr
    ? data?.civilianNetworks?.titleAr || 'شبكات اتصالات الهواتف المحمولة المدنية (الإسرائيلية والفلسطينية والإماراتية)'
    : data?.civilianNetworks?.titleEn || 'Civilian Mobile Networks (Israel, Palestine & UAE)';

  const captureChartImages = async (): Promise<Record<string, string>> => {
    const images: Record<string, string> = {};
    const [imgReg, imgMcc, imgMil, imgCiv, imgMap] = await Promise.all([
      renderChartPngDataUrl(regCountryChartRef.current, { title: regTitle, isRtl: isAr }),
      renderChartPngDataUrl(mccChartRef.current, { title: mccTitle, isRtl: isAr }),
      renderChartPngDataUrl(militaryChartRef.current, { title: milTitle, isRtl: isAr }),
      renderChartPngDataUrl(civilianChartRef.current, { title: civTitle, isRtl: isAr }),
      mapSnapshotCaptureRef.current ? mapSnapshotCaptureRef.current() : Promise.resolve(null),
    ]);
    if (imgReg) images.registrationsByCountry = imgReg;
    if (imgMcc) images.networkCellsByMcc = imgMcc;
    if (imgMil) images.militaryNetworks = imgMil;
    if (imgCiv) images.civilianNetworks = imgCiv;
    if (imgMap) images.btsMap = imgMap;
    return images;
  };

  const COLORS = ['#6366f1', '#3b82f6', '#10b981', '#f59e0b', '#ec4899', '#8b5cf6', '#06b6d4'];

  const kpis = data?.kpis || {
    totalRegistrations: 0,
    distinctImsis: 0,
    distinctImeis: 0,
    totalNetworkCells: 0,
    distinctNetworkCells: 0,
    totalMissions: 0,
    countriesRepresented: 0,
    totalBtsLocations: 0,
    networkCellsWithValidCoords: 0,
    militaryNetworkCells: 0,
    civilianNetworkCells: 0,
  };

  const regCountryItems = data?.registrationsByCountry?.items || [];
  const mccItems = data?.networkCellsByMcc?.items || [];
  const militaryItems = data?.militaryNetworks?.items || [];
  const civilianItems = data?.civilianNetworks?.items || [];

  return (
    <div className="space-y-6">
      {/* Top Header Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-slate-900/80 p-4 rounded-2xl border border-slate-800">
        <div>
          <h1 className="text-xl font-bold text-slate-100 flex items-center gap-2">
            <Activity className="w-5 h-5 text-indigo-400" />
            <span>Mission Telemetry & Signal Intelligence Dashboard</span>
          </h1>
          <p className="text-xs text-slate-400 mt-0.5">
            Real-time Mission-ID relational analytics, spatial BTS mapping, and multi-format report engine.
          </p>
        </div>

        <div className="flex items-center gap-2.5 flex-wrap">
          <button
            type="button"
            onClick={() => setExportModalOpen(true)}
            className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-bold rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white shadow-sm shadow-indigo-600/30 transition-colors"
          >
            <Download className="w-4 h-4" />
            <span>{t('exportDashboard')}</span>
          </button>

          <button
            type="button"
            onClick={() => fetchDashboardData()}
            className="p-2 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 border border-slate-800 transition-colors"
            title={t('refresh')}
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin text-indigo-400' : ''}`} />
          </button>
        </div>
      </div>

      {/* Ambiguity Resolution Alert Banner if pending ambiguities exist */}
      {(data?.qualityStats?.pendingAmbiguities || 0) > 0 && (
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3.5 rounded-xl bg-amber-950/40 border border-amber-700/60 text-amber-200">
          <div className="flex items-center gap-2.5 text-xs">
            <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0" />
            <div>
              <strong>{data.qualityStats.pendingAmbiguities} ambiguous mission link(s)</strong> flagged during migration/import (duplicate mission labels detected — not auto-merged).
            </div>
          </div>
          {(currentUser?.role === 'SUPER_ADMIN' || currentUser?.role === 'DATA_MANAGER' || currentUser?.role === 'ADMIN') && (
            <button
              type="button"
              onClick={loadAmbiguities}
              className="px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-500 text-white text-xs font-bold shrink-0"
            >
              Review & Resolve
            </button>
          )}
        </div>
      )}

      {/* Global Filter Panel */}
      <GlobalFilterPanel filters={filters} onChange={setFilters} options={filterOptions} />

      {/* 11 Filter-Responsive KPI Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-3.5">
        {[
          { label: t('kpiTotalRegistrations'), value: kpis.totalRegistrations, icon: Users, color: 'text-blue-400', bg: 'bg-blue-600/10', page: 'registrations' },
          { label: t('kpiDistinctImsis'), value: kpis.distinctImsis, icon: Smartphone, color: 'text-emerald-400', bg: 'bg-emerald-600/10', page: 'registrations' },
          { label: t('kpiDistinctImeis'), value: kpis.distinctImeis, icon: Crosshair, color: 'text-teal-400', bg: 'bg-teal-600/10', page: 'registrations' },
          { label: t('kpiTotalNetworkCellRecords'), value: kpis.totalNetworkCells, icon: Radio, color: 'text-sky-400', bg: 'bg-sky-600/10', page: 'network-cells' },
          { label: t('kpiDistinctNetworkCells'), value: kpis.distinctNetworkCells, icon: Activity, color: 'text-indigo-400', bg: 'bg-indigo-600/10', page: 'network-cells' },
          { label: t('kpiTotalMissions'), value: kpis.totalMissions, icon: Target, color: 'text-purple-400', bg: 'bg-purple-600/10', page: 'missions' },
          { label: t('kpiCountriesRepresented'), value: kpis.countriesRepresented, icon: Globe, color: 'text-cyan-400', bg: 'bg-cyan-600/10', page: 'registrations' },
          { label: t('kpiTotalBtsLocations'), value: kpis.totalBtsLocations, icon: MapPin, color: 'text-amber-400', bg: 'bg-amber-600/10', page: 'registrations' },
          { label: t('kpiCellsValidCoords'), value: kpis.networkCellsWithValidCoords, icon: Compass, color: 'text-lime-400', bg: 'bg-lime-600/10', page: 'network-cells' },
          { label: t('kpiMilitaryNetworkCells'), value: kpis.militaryNetworkCells, icon: Shield, color: 'text-rose-400', bg: 'bg-rose-600/10', page: 'network-cells' },
          { label: t('kpiCivilianNetworkCells'), value: kpis.civilianNetworkCells, icon: Building2, color: 'text-orange-400', bg: 'bg-orange-600/10', page: 'network-cells' },
        ].map((kpi, idx) => {
          const Icon = kpi.icon;
          return (
            <div
              key={idx}
              onClick={() => onNavigate(kpi.page)}
              className="group p-3.5 bg-slate-900 border border-slate-800 hover:border-slate-700 rounded-xl shadow-sm cursor-pointer transition-all hover:bg-slate-800/40"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider leading-tight">
                  {kpi.label}
                </span>
                <div className={`p-1.5 rounded-lg ${kpi.bg} ${kpi.color} shrink-0`}>
                  <Icon className="w-3.5 h-3.5" />
                </div>
              </div>
              <div className="mt-2 text-xl font-bold font-mono text-slate-100">
                {loading ? '...' : Number(kpi.value || 0).toLocaleString()}
              </div>
            </div>
          );
        })}
      </div>

      {/* SECTION 2.1 & 2.3: Registrations by Country & Network Cells by MCC */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* 2.1 Registrations by Country */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-sm space-y-4">
          <div className="flex items-start justify-between gap-2">
            <div>
              <h2 className="text-sm font-bold text-slate-100">
                {regTitle}
              </h2>
              <p className="text-[11px] text-slate-400">
                {isAr
                  ? 'شرائح IMSI الفريدة لكل دولة (مع استبعاد الدول الفارغة ومصر افتراضياً)'
                  : 'Distinct IMSIs per country (excluding null/empty country, zero IMSI, and Egypt)'}
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <span className="px-2 py-0.5 rounded bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 text-[11px] font-mono font-bold">
                Total: {data?.registrationsByCountry?.totalDistinctImsis ?? 0}
              </span>
              <ChartExportMenu
                chartId="registrationsByCountry"
                title={regTitle}
                subtitle={`Total Distinct IMSIs: ${data?.registrationsByCountry?.totalDistinctImsis ?? 0}`}
                filters={filters}
                svgContainerRef={regCountryChartRef}
              />
            </div>
          </div>

          <div ref={regCountryChartRef} className="h-64">
            {regCountryItems.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={regCountryItems} margin={{ top: 10, right: 10, left: -15, bottom: 24 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                  <XAxis dataKey="country" stroke="#94a3b8" fontSize={11} angle={-18} textAnchor="end" interval={0} />
                  <YAxis stroke="#94a3b8" fontSize={11} allowDecimals={false} />
                  <Tooltip
                    contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155', borderRadius: '8px', fontSize: '12px' }}
                    formatter={(value: any, _name: any, props: any) => [
                      `${value} distinct IMSIs (${props.payload.percentageShare}% • Rank #${props.payload.rank})`,
                      props.payload.country,
                    ]}
                  />
                  <Bar dataKey="distinctImsiCount" name="Distinct IMSIs" radius={[6, 6, 0, 0]}>
                    {regCountryItems.map((entry: any, idx: number) => (
                      <Cell key={`rc-${idx}`} fill={entry.color || (idx < 3 ? '#00B894' : '#3977C3')} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-full flex items-center justify-center text-xs text-slate-500">
                No non-Egypt country registrations match current filters
              </div>
            )}
          </div>

          {/* Ranked Share Breakdown */}
          {regCountryItems.length > 0 && (
            <div className="max-h-36 overflow-y-auto rounded-lg border border-slate-800">
              <table className="w-full text-[11px] text-left">
                <thead className="bg-slate-950 text-slate-400">
                  <tr>
                    <th className="px-3 py-1.5">Rank</th>
                    <th className="px-3 py-1.5">Country</th>
                    <th className="px-3 py-1.5">Distinct IMSI</th>
                    <th className="px-3 py-1.5">Share %</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60 text-slate-300">
                  {regCountryItems.map((item: any) => (
                    <tr key={item.country}>
                      <td className="px-3 py-1.5 font-mono">#{item.rank}</td>
                      <td className="px-3 py-1.5 flex items-center gap-1.5">
                        <span className="w-2 h-2 rounded-full" style={{ backgroundColor: item.color }} />
                        <span>{item.country}</span>
                      </td>
                      <td className="px-3 py-1.5 font-mono font-bold">{item.distinctImsiCount}</td>
                      <td className="px-3 py-1.5 font-mono">{item.percentageShare}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* 2.3 Network Cells by MCC */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-sm space-y-4">
          <div className="flex items-start justify-between gap-2">
            <div>
              <h2 className="text-sm font-bold text-slate-100">
                {mccTitle}
              </h2>
              <p className="text-[11px] text-slate-400">
                {isAr
                  ? 'معرفات الخلايا الفريدة لكل رمز دولة MCC عبر جدول المشغلين'
                  : 'Distinct Cell IDs per MCC resolved via PlmnStorage'}
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <span className="px-2 py-0.5 rounded bg-blue-500/15 border border-blue-500/30 text-blue-300 text-[11px] font-mono font-bold">
                Total Cells: {data?.networkCellsByMcc?.totalDistinctCells ?? 0}
              </span>
              <ChartExportMenu
                chartId="networkCellsByMcc"
                title={mccTitle}
                subtitle={`Total Distinct Cells: ${data?.networkCellsByMcc?.totalDistinctCells ?? 0}`}
                filters={filters}
                svgContainerRef={mccChartRef}
              />
            </div>
          </div>

          <div ref={mccChartRef} className="h-64">
            {mccItems.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={mccItems} margin={{ top: 10, right: 10, left: -15, bottom: 24 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                  <XAxis dataKey="label" stroke="#94a3b8" fontSize={10} angle={-18} textAnchor="end" interval={0} />
                  <YAxis stroke="#94a3b8" fontSize={11} allowDecimals={false} />
                  <Tooltip
                    contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155', borderRadius: '8px', fontSize: '12px' }}
                    formatter={(value: any, _name: any, props: any) => [
                      `${value} distinct cells (${props.payload.percentageShare}% • ${props.payload.totalRecords} records)`,
                      props.payload.country,
                    ]}
                  />
                  <Bar dataKey="distinctCellCount" name="Distinct Cells" radius={[6, 6, 0, 0]}>
                    {mccItems.map((entry: any, idx: number) => (
                      <Cell key={`mcc-${idx}`} fill={entry.color || '#2563EB'} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-full flex items-center justify-center text-xs text-slate-500">
                No network cells match current filters
              </div>
            )}
          </div>

          {mccItems.length > 0 && (
            <div className="max-h-36 overflow-y-auto rounded-lg border border-slate-800">
              <table className="w-full text-[11px] text-left">
                <thead className="bg-slate-950 text-slate-400">
                  <tr>
                    <th className="px-3 py-1.5">MCC</th>
                    <th className="px-3 py-1.5">Country</th>
                    <th className="px-3 py-1.5">Distinct Cells</th>
                    <th className="px-3 py-1.5">Records</th>
                    <th className="px-3 py-1.5">Share %</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60 text-slate-300">
                  {mccItems.map((item: any) => (
                    <tr key={item.mcc}>
                      <td className="px-3 py-1.5 font-mono text-sky-300">{item.mcc}</td>
                      <td className="px-3 py-1.5">{item.country}</td>
                      <td className="px-3 py-1.5 font-mono font-bold">{item.distinctCellCount}</td>
                      <td className="px-3 py-1.5 font-mono text-slate-400">{item.totalRecords}</td>
                      <td className="px-3 py-1.5 font-mono">{item.percentageShare}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* SECTION 2.2: BTS Locations Interactive Map */}
      <BtsLocationsMap
        locations={data?.btsMap?.locations || []}
        stats={data?.btsMap?.stats}
        filters={filters}
        onRegisterSnapshotCapture={fn => {
          mapSnapshotCaptureRef.current = fn;
        }}
      />

      {/* SECTION 2.4 & 2.5: Military & Civilian Mobile Networks */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* 2.4 Military Mobile Networks */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-sm space-y-4">
          <div className="flex items-start justify-between gap-2">
            <div>
              <h2 className="text-sm font-bold text-slate-100">
                {milTitle}
              </h2>
              <p className="text-[11px] text-slate-400">
                Restricted exclusively to MCC/MNC (602/10, 602/11) Egypt (#3498DB) &amp; (425/25) Israel (#27AE60)
              </p>
            </div>
            <ChartExportMenu
              chartId="militaryNetworks"
              title={milTitle}
              subtitle={`Distinct Cells: ${data?.militaryNetworks?.totalDistinctCells ?? 0}`}
              filters={filters}
              svgContainerRef={militaryChartRef}
            />
          </div>

          <div ref={militaryChartRef} className="h-56">
            {militaryItems.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={militaryItems} margin={{ top: 10, right: 10, left: -15, bottom: 20 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                  <XAxis dataKey="label" stroke="#94a3b8" fontSize={10} interval={0} />
                  <YAxis stroke="#94a3b8" fontSize={11} allowDecimals={false} />
                  <Tooltip
                    contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155', borderRadius: '8px', fontSize: '12px' }}
                  />
                  <Bar dataKey="distinctCellCount" name="Distinct Cell IDs" radius={[6, 6, 0, 0]}>
                    {militaryItems.map((entry: any, idx: number) => (
                      <Cell key={`mil-${idx}`} fill={entry.color} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-full flex items-center justify-center text-xs text-slate-500">
                No military network cell observations for active filters
              </div>
            )}
          </div>

          <div className="overflow-x-auto rounded-lg border border-slate-800">
            <table className="w-full text-[11px] text-left">
              <thead className="bg-slate-950 text-slate-400">
                <tr>
                  <th className="px-3 py-1.5">MCC/MNC</th>
                  <th className="px-3 py-1.5">Operator</th>
                  <th className="px-3 py-1.5">Distinct Cells</th>
                  <th className="px-3 py-1.5">Total Records</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 text-slate-300">
                {militaryItems.map((m: any) => (
                  <tr key={m.plmn}>
                    <td className="px-3 py-1.5 font-mono">{m.mcc}/{m.mnc}</td>
                    <td className="px-3 py-1.5 flex items-center gap-1.5">
                      <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: m.color }} />
                      <span>{m.operator}</span>
                    </td>
                    <td className="px-3 py-1.5 font-mono font-bold">{m.distinctCellCount}</td>
                    <td className="px-3 py-1.5 font-mono text-slate-400">{m.totalRecords}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* 2.5 Civilian Mobile Networks */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-sm space-y-4">
          <div className="flex items-start justify-between gap-2">
            <div>
              <h2 className="text-sm font-bold text-slate-100">
                {civTitle}
              </h2>
              <p className="text-[11px] text-slate-400">
                Israel (#2980B9), Palestine (#27AE60), UAE (#E67E22) — Excluding 602/1,2,3,4,10,11 &amp; 425/24
              </p>
            </div>
            <ChartExportMenu
              chartId="civilianNetworks"
              title={civTitle}
              subtitle={`Distinct Cells: ${data?.civilianNetworks?.totalDistinctCells ?? 0}`}
              filters={filters}
              svgContainerRef={civilianChartRef}
            />
          </div>

          <div ref={civilianChartRef} className="h-56">
            {civilianItems.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={civilianItems} margin={{ top: 10, right: 10, left: -15, bottom: 26 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                  <XAxis dataKey="label" stroke="#94a3b8" fontSize={9.5} angle={-20} textAnchor="end" interval={0} />
                  <YAxis stroke="#94a3b8" fontSize={11} allowDecimals={false} />
                  <Tooltip
                    contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155', borderRadius: '8px', fontSize: '12px' }}
                    formatter={(val: any, _n: any, props: any) => [
                      `${val} distinct cells (Group Rank #${props.payload.rank} in ${props.payload.country})`,
                      props.payload.operator,
                    ]}
                  />
                  <Bar dataKey="distinctCellCount" name="Distinct Cell IDs" radius={[6, 6, 0, 0]}>
                    {civilianItems.map((entry: any, idx: number) => (
                      <Cell key={`civ-${idx}`} fill={entry.color} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-full flex items-center justify-center text-xs text-slate-500">
                No civilian network cell observations for active filters
              </div>
            )}
          </div>

          <div className="max-h-40 overflow-y-auto rounded-lg border border-slate-800">
            <table className="w-full text-[11px] text-left">
              <thead className="bg-slate-950 text-slate-400">
                <tr>
                  <th className="px-3 py-1.5">Country</th>
                  <th className="px-3 py-1.5">Group Rank</th>
                  <th className="px-3 py-1.5">Operator (PLMN)</th>
                  <th className="px-3 py-1.5">Distinct Cells</th>
                  <th className="px-3 py-1.5">Records</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 text-slate-300">
                {civilianItems.map((c: any) => (
                  <tr key={c.plmn}>
                    <td className="px-3 py-1.5 flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full" style={{ backgroundColor: c.color }} />
                      <span>{c.country}</span>
                    </td>
                    <td className="px-3 py-1.5 font-mono">#{c.rank}</td>
                    <td className="px-3 py-1.5">{c.operator} ({c.plmn})</td>
                    <td className="px-3 py-1.5 font-mono font-bold">{c.distinctCellCount}</td>
                    <td className="px-3 py-1.5 font-mono text-slate-400">{c.totalRecords}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Preserved Row: Operational Records by Mission, Cells by RAT, Timeline & Quality */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-sm space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-xs font-bold text-slate-200 uppercase tracking-wider">
              {t('chartRecordsByMission')}
            </h2>
            <span className="text-[11px] text-slate-400">Mission ID Relational Join</span>
          </div>

          <div className="h-60">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data?.recordsByMission || []} margin={{ top: 10, right: 10, left: -20, bottom: 20 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                <XAxis dataKey="mission" stroke="#64748b" fontSize={10} angle={-15} textAnchor="end" />
                <YAxis stroke="#64748b" fontSize={11} />
                <Tooltip contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155', borderRadius: '8px', fontSize: '11px' }} />
                <Legend wrapperStyle={{ fontSize: '11px', paddingTop: '8px' }} />
                <Bar dataKey="registrations" name="Registrations" fill="#6366f1" radius={[4, 4, 0, 0]} />
                <Bar dataKey="networkCells" name="Network Cells" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                <Bar dataKey="targets" name="Targets" fill="#f43f5e" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-sm space-y-4">
          <h2 className="text-xs font-bold text-slate-200 uppercase tracking-wider">
            {t('chartNetworkByRat')}
          </h2>

          <div className="h-60 flex items-center justify-center">
            {data?.cellsByRat && data.cellsByRat.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={data.cellsByRat}
                    dataKey="count"
                    nameKey="rat"
                    cx="50%"
                    cy="50%"
                    innerRadius={52}
                    outerRadius={76}
                    paddingAngle={4}
                  >
                    {data.cellsByRat.map((_: any, index: number) => (
                      <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155', borderRadius: '8px', fontSize: '11px' }} />
                  <Legend wrapperStyle={{ fontSize: '11px' }} />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <div className="text-xs text-slate-500">No cell technology records</div>
            )}
          </div>
        </div>
      </div>

      {/* Activity Timeline + Data Quality & Quick Launchpad */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-sm space-y-4">
          <h2 className="text-xs font-bold text-slate-200 uppercase tracking-wider">
            {t('chartTimelineActivity')}
          </h2>
          <div className="h-52">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={data?.activityTimeline || []} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <defs>
                  <linearGradient id="colorRegs" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#6366f1" stopOpacity={0.8} />
                    <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                <XAxis dataKey="hour_slot" stroke="#64748b" fontSize={9} />
                <YAxis stroke="#64748b" fontSize={11} />
                <Tooltip contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155', borderRadius: '8px', fontSize: '11px' }} />
                <Area type="monotone" dataKey="registrations" stroke="#6366f1" fillOpacity={1} fill="url(#colorRegs)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-sm space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-xs font-bold text-slate-200 uppercase tracking-wider flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-400" />
              <span>{t('dataQualitySummary')}</span>
            </h2>
            <button
              type="button"
              onClick={() => onNavigate('data-quality')}
              className="text-xs text-indigo-400 hover:underline"
            >
              Inspect &rarr;
            </button>
          </div>

          <div className="grid grid-cols-3 gap-2">
            <div className="p-2.5 bg-slate-950/70 border border-slate-800 rounded-xl">
              <span className="text-[10px] text-slate-400 uppercase font-semibold">Checked</span>
              <span className="block text-lg font-bold font-mono text-slate-200 mt-0.5">
                {(data?.qualityStats?.totalChecked || 0).toLocaleString()}
              </span>
            </div>
            <div className="p-2.5 bg-slate-950/70 border border-slate-800 rounded-xl">
              <span className="text-[10px] text-slate-400 uppercase font-semibold">{t('validRecords')}</span>
              <span className="block text-lg font-bold font-mono text-emerald-400 mt-0.5">
                {(data?.qualityStats?.validRecords || 0).toLocaleString()}
              </span>
            </div>
            <div className="p-2.5 bg-slate-950/70 border border-slate-800 rounded-xl">
              <span className="text-[10px] text-slate-400 uppercase font-semibold">Issues</span>
              <span className="block text-lg font-bold font-mono text-amber-400 mt-0.5">
                {(data?.qualityStats?.issuesFound || 0).toLocaleString()}
              </span>
            </div>
          </div>

          <div className="space-y-1.5 pt-2 border-t border-slate-800/80">
            {data?.qualityStats?.breakdown?.map((b: any, i: number) => (
              <div key={i} className="flex items-center justify-between text-xs text-slate-400">
                <span className="flex items-center gap-1.5 truncate">
                  <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                  <span className="truncate">{b.issue}</span>
                </span>
                <span className="font-mono font-bold text-slate-300">{b.count}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-sm space-y-3">
          <h2 className="text-xs font-bold text-slate-200 uppercase tracking-wider">Operations Launchpad</h2>
          <div className="space-y-2">
            <button
              type="button"
              onClick={() => onNavigate('import-center')}
              className="w-full flex items-center justify-between p-2.5 rounded-xl bg-slate-950/70 border border-slate-800 hover:bg-slate-800/60 text-xs font-semibold text-slate-200"
            >
              <span className="flex items-center gap-2">
                <FileUp className="w-4 h-4 text-indigo-400" />
                <span>Multi-Table SQLite &amp; File Import</span>
              </span>
              <span>&rarr;</span>
            </button>
            <button
              type="button"
              onClick={() => onNavigate('interactive-map')}
              className="w-full flex items-center justify-between p-2.5 rounded-xl bg-slate-950/70 border border-slate-800 hover:bg-slate-800/60 text-xs font-semibold text-slate-200"
            >
              <span className="flex items-center gap-2">
                <Navigation className="w-4 h-4 text-emerald-400" />
                <span>Fullscreen Spatial Map</span>
              </span>
              <span>&rarr;</span>
            </button>
            <button
              type="button"
              onClick={() => onNavigate('export-center')}
              className="w-full flex items-center justify-between p-2.5 rounded-xl bg-slate-950/70 border border-slate-800 hover:bg-slate-800/60 text-xs font-semibold text-slate-200"
            >
              <span className="flex items-center gap-2">
                <FolderArchive className="w-4 h-4 text-sky-400" />
                <span>Table Export Center</span>
              </span>
              <span>&rarr;</span>
            </button>
            <button
              type="button"
              onClick={() => onNavigate('audit-logs')}
              className="w-full flex items-center justify-between p-2.5 rounded-xl bg-slate-950/70 border border-slate-800 hover:bg-slate-800/60 text-xs font-semibold text-slate-200"
            >
              <span className="flex items-center gap-2">
                <ShieldAlert className="w-4 h-4 text-rose-400" />
                <span>Audit &amp; Compliance Trail</span>
              </span>
              <span>&rarr;</span>
            </button>
          </div>
        </div>
      </div>

      {/* Export Dashboard Modal */}
      <ExportDashboardModal
        isOpen={exportModalOpen}
        onClose={() => setExportModalOpen(false)}
        filters={filters}
        captureChartImages={captureChartImages}
      />

      {/* Migration Ambiguity Resolution Modal */}
      {ambiguityModalOpen && (
        <div className="fixed inset-0 z-[1000] flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm">
          <div className="w-full max-w-2xl max-h-[85vh] overflow-y-auto bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <h3 className="text-sm font-bold text-slate-100">Resolve Ambiguous Mission Links</h3>
              <button type="button" onClick={() => setAmbiguityModalOpen(false)} className="text-slate-400 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>
            {ambiguities.length === 0 ? (
              <div className="text-xs text-emerald-400 py-4 text-center">All ambiguous links have been resolved.</div>
            ) : (
              <div className="space-y-3">
                {ambiguities.map(amb => {
                  const candidateIds: number[] = (() => {
                    const raw = amb.candidate_mission_ids || '';
                    try {
                      const parsed = JSON.parse(raw);
                      if (Array.isArray(parsed)) return parsed.map(Number).filter(Number.isInteger);
                    } catch {
                      // fall back to comma-separated list
                    }
                    return String(raw)
                      .split(',')
                      .map(s => Number(s.trim()))
                      .filter(n => Number.isInteger(n) && n > 0);
                  })();
                  const candidateMissions = missions.filter(m => candidateIds.includes(m.id));
                  return (
                    <div key={amb.id} className="p-3 rounded-xl bg-slate-950 border border-slate-800 space-y-2 text-xs">
                      <div className="flex items-center justify-between">
                        <span className="font-mono text-indigo-300">
                          {amb.table_name} #{amb.record_id}
                        </span>
                        <span className="text-amber-300">Label: &quot;{amb.mission_label || amb.raw_mission_value}&quot;</span>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {candidateMissions.map(cm => (
                          <button
                            key={cm.id}
                            type="button"
                            disabled={resolvingId === amb.id}
                            onClick={() => resolveAmbiguity(amb.id, cm.id)}
                            className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-indigo-600 text-slate-200 hover:text-white border border-slate-700 text-[11px] font-semibold"
                          >
                            Link to #{cm.id}: {cm.mission} ({cm.location})
                          </button>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
