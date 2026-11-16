import React, { useState, useEffect, useMemo } from 'react';
import { useApp } from '../../context/AppContext.js';
import { DashboardFilterState, INITIAL_DASHBOARD_FILTERS, MissionItem } from '../../types/index.js';
import {
  Filter,
  ChevronDown,
  ChevronUp,
  X,
  Search,
  Bookmark,
  Plus,
  Trash2,
  RotateCcw,
  Radio,
  Smartphone,
  Target,
  Globe,
} from 'lucide-react';

interface FilterOptionsResponse {
  missions: MissionItem[];
  registrations: {
    countries: string[];
    countryCodes: string[];
    ueModels: string[];
    btsNames: string[];
    actions: string[];
    updates: string[];
  };
  networkCells: {
    rats: string[];
    mccs: string[];
    mncs: string[];
  };
  plmnEntries: Array<{ mcc: string; mnc: string; country: string; code: string; name: string }>;
}

interface GlobalFilterPanelProps {
  filters: DashboardFilterState;
  onChange: (next: DashboardFilterState) => void;
  options: FilterOptionsResponse | null;
}

export const GlobalFilterPanel: React.FC<GlobalFilterPanelProps> = ({
  filters,
  onChange,
  options,
}) => {
  const { t, apiFetch, authToken, currentUser, addNotification } = useApp();
  const [expanded, setExpanded] = useState(true);
  const [activeTab, setActiveTab] = useState<'missions' | 'registrations' | 'network_cells' | 'plmn'>('missions');
  const [missionSearch, setMissionSearch] = useState('');

  // PLMN Search
  const [plmnResults, setPlmnResults] = useState<Array<{ mcc: string; mnc: string; country: string; code: string; name: string }>>([]);
  const [plmnLoading, setPlmnLoading] = useState(false);

  // Saved Views
  const [savedViews, setSavedViews] = useState<Array<{ id: number; view_name: string; filters_json: string }>>([]);
  const [newViewName, setNewViewName] = useState('');
  const [savingView, setSavingView] = useState(false);

  const canUseTmsiFilter = currentUser?.role === 'SUPER_ADMIN' || currentUser?.role === 'ADMIN';

  const loadSavedViews = () => {
    if (!authToken) return;
    apiFetch('/api/v1/saved-views?tableName=dashboard')
      .then(r => (r.ok ? r.json() : []))
      .then(rows => setSavedViews(Array.isArray(rows) ? rows : []))
      .catch(() => {});
  };

  useEffect(() => {
    loadSavedViews();
  }, [authToken]);

  useEffect(() => {
    const q = filters.plmnQuery.trim();
    if (!q) {
      setPlmnResults((options?.plmnEntries || []).slice(0, 12));
      return;
    }
    const timer = setTimeout(() => {
      setPlmnLoading(true);
      apiFetch(`/api/v1/plmn/search?q=${encodeURIComponent(q)}`)
        .then(r => (r.ok ? r.json() : []))
        .then(rows => setPlmnResults(Array.isArray(rows) ? rows : []))
        .catch(() => setPlmnResults([]))
        .finally(() => setPlmnLoading(false));
    }, 220);
    return () => clearTimeout(timer);
  }, [filters.plmnQuery, options?.plmnEntries, apiFetch]);

  const missionsList = useMemo(() => {
    const base = options?.missions || [];
    const q = missionSearch.trim().toLowerCase();
    if (!q) return base;
    return base.filter(
      m =>
        m.mission.toLowerCase().includes(q) ||
        (m.location || '').toLowerCase().includes(q) ||
        String(m.id).includes(q)
    );
  }, [options?.missions, missionSearch]);

  const toggleMissionId = (id: number) => {
    const exists = filters.missionIds.includes(id);
    onChange({
      ...filters,
      missionIds: exists ? filters.missionIds.filter(x => x !== id) : [...filters.missionIds, id],
    });
  };

  const toggleArrayString = (
    key: 'country' | 'countryCode' | 'ueModel' | 'action' | 'update' | 'rat' | 'mcc' | 'mnc',
    val: string
  ) => {
    const arr = filters[key];
    onChange({
      ...filters,
      [key]: arr.includes(val) ? arr.filter(x => x !== val) : [...arr, val],
    });
  };

  const handleSaveView = async () => {
    if (!newViewName.trim()) return;
    setSavingView(true);
    try {
      const res = await apiFetch('/api/v1/saved-views', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tableName: 'dashboard',
          viewName: newViewName.trim(),
          filters,
        }),
      });
      if (res.ok) {
        setNewViewName('');
        loadSavedViews();
        addNotification({ title: 'View Saved', message: `Saved filter view "${newViewName.trim()}"`, type: 'success' });
      }
    } finally {
      setSavingView(false);
    }
  };

  const handleApplyView = (viewJson: string) => {
    try {
      const parsed = JSON.parse(viewJson);
      onChange({ ...INITIAL_DASHBOARD_FILTERS, ...parsed });
    } catch {
      // ignore malformed
    }
  };

  const handleDeleteView = async (id: number) => {
    await apiFetch(`/api/v1/saved-views/${id}`, { method: 'DELETE' });
    loadSavedViews();
  };

  // Build active filter chips for quick removal
  const activeChips = useMemo(() => {
    const chips: Array<{ id: string; label: string; remove: () => void }> = [];

    filters.missionIds.forEach(id => {
      const m = options?.missions?.find(x => x.id === id);
      chips.push({
        id: `mission_${id}`,
        label: `Mission: ${m ? `${m.mission} (#${m.id})` : `#${id}`}`,
        remove: () => onChange({ ...filters, missionIds: filters.missionIds.filter(x => x !== id) }),
      });
    });

    filters.country.forEach(c =>
      chips.push({
        id: `country_${c}`,
        label: `Reg Country: ${c}`,
        remove: () => toggleArrayString('country', c),
      })
    );
    filters.countryCode.forEach(cc =>
      chips.push({
        id: `cc_${cc}`,
        label: `Country Code: ${cc}`,
        remove: () => toggleArrayString('countryCode', cc),
      })
    );
    filters.ueModel.forEach(u =>
      chips.push({
        id: `ue_${u}`,
        label: `UE Model: ${u}`,
        remove: () => toggleArrayString('ueModel', u),
      })
    );
    filters.action.forEach(a =>
      chips.push({
        id: `action_${a}`,
        label: `Action: ${a}`,
        remove: () => toggleArrayString('action', a),
      })
    );
    filters.update.forEach(u =>
      chips.push({
        id: `update_${u}`,
        label: `Update: ${u}`,
        remove: () => toggleArrayString('update', u),
      })
    );

    const textEntries: Array<[keyof DashboardFilterState, string]> = [
      ['imsi', 'IMSI'],
      ['imei', 'IMEI'],
      ['tmsi', 'TMSI'],
      ['btsName', 'BTS Name'],
      ['bts', 'BTS Code'],
      ['lastSeenFrom', 'Last Seen ≥'],
      ['lastSeenTo', 'Last Seen ≤'],
      ['btsAltitudeMin', 'Alt ≥'],
      ['btsAltitudeMax', 'Alt ≤'],
      ['distanceMinFrom', 'DistMin ≥'],
      ['distanceMinTo', 'DistMin ≤'],
      ['distanceMaxFrom', 'DistMax ≥'],
      ['distanceMaxTo', 'DistMax ≤'],
      ['lac', 'LAC'],
      ['cellId', 'Cell ID'],
      ['channel', 'Channel'],
      ['bsic', 'BSIC'],
      ['pci', 'PCI'],
      ['psc', 'PSC'],
      ['rxLevMin', 'RxLev ≥'],
      ['rxLevMax', 'RxLev ≤'],
      ['rxLevDbmMin', 'dBm ≥'],
      ['rxLevDbmMax', 'dBm ≤'],
      ['downlinkMin', 'DL ≥'],
      ['downlinkMax', 'DL ≤'],
      ['dlBandwidthMin', 'BW ≥'],
      ['dlBandwidthMax', 'BW ≤'],
      ['directionMin', 'Dir ≥'],
      ['directionMax', 'Dir ≤'],
      ['plmnQuery', 'PLMN'],
    ];
    for (const [k, label] of textEntries) {
      const val = filters[k];
      if (typeof val === 'string' && val.trim() !== '') {
        chips.push({
          id: `txt_${String(k)}`,
          label: `${label}: ${val}`,
          remove: () => onChange({ ...filters, [k]: '' }),
        });
      }
    }

    filters.rat.forEach(r =>
      chips.push({
        id: `rat_${r}`,
        label: `RAT: ${r}`,
        remove: () => toggleArrayString('rat', r),
      })
    );
    filters.mcc.forEach(m =>
      chips.push({
        id: `mcc_${m}`,
        label: `MCC: ${m}`,
        remove: () => toggleArrayString('mcc', String(m)),
      })
    );
    filters.mnc.forEach(m =>
      chips.push({
        id: `mnc_${m}`,
        label: `MNC: ${m}`,
        remove: () => toggleArrayString('mnc', String(m)),
      })
    );

    const enumEntries: Array<[keyof DashboardFilterState, string]> = [
      ['hasBtsLocation', 'Has BTS Location'],
      ['btsLocationOutdated', 'BTS Outdated'],
      ['hasDeviceLocation', 'Has Device Loc'],
      ['isNeighbour', 'Neighbour Cell'],
      ['isPcs1900', 'PCS1900'],
      ['hasCoordinates', 'Cell Coords'],
    ];
    for (const [k, label] of enumEntries) {
      const val = filters[k];
      if (val !== 'all') {
        chips.push({
          id: `enum_${String(k)}`,
          label: `${label}: ${val}`,
          remove: () => onChange({ ...filters, [k]: 'all' }),
        });
      }
    }

    return chips;
  }, [filters, options]);

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-2xl shadow-sm overflow-hidden">
      {/* Header Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 bg-slate-950/60 border-b border-slate-800">
        <div className="flex items-center gap-2.5">
          <Filter className="w-4 h-4 text-indigo-400" />
          <h2 className="text-xs font-bold text-slate-200 uppercase tracking-wider">
            {t('globalFilters')}
          </h2>
          {activeChips.length > 0 && (
            <span className="px-2 py-0.5 rounded bg-indigo-600/20 border border-indigo-500/40 text-indigo-300 text-[10px] font-bold">
              {activeChips.length} {t('filtersActive')}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {/* Saved Views Dropdown */}
          {savedViews.length > 0 && (
            <div className="flex items-center gap-1">
              <Bookmark className="w-3.5 h-3.5 text-amber-400" />
              <select
                defaultValue=""
                onChange={e => {
                  const found = savedViews.find(v => String(v.id) === e.target.value);
                  if (found) handleApplyView(found.filters_json);
                }}
                className="h-7 px-2 text-[11px] bg-slate-900 border border-slate-700 rounded-lg text-slate-200"
              >
                <option value="">-- {t('savedViews')} --</option>
                {savedViews.map(v => (
                  <option key={v.id} value={v.id}>
                    {v.view_name}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Save Current View Input */}
          <div className="flex items-center gap-1">
            <input
              type="text"
              value={newViewName}
              onChange={e => setNewViewName(e.target.value)}
              placeholder={t('saveCurrentView')}
              className="h-7 w-32 px-2 text-[11px] bg-slate-900 border border-slate-700 rounded-lg text-slate-200 placeholder-slate-500 focus:outline-none focus:border-indigo-500"
            />
            <button
              type="button"
              onClick={handleSaveView}
              disabled={!newViewName.trim() || savingView}
              className="h-7 px-2 text-[11px] font-semibold rounded-lg bg-slate-800 hover:bg-slate-700 text-indigo-300 border border-slate-700 disabled:opacity-40 flex items-center gap-1"
            >
              <Plus className="w-3 h-3" />
              <span>Save</span>
            </button>
          </div>

          {activeChips.length > 0 && (
            <button
              type="button"
              onClick={() => onChange(INITIAL_DASHBOARD_FILTERS)}
              className="h-7 px-2.5 text-[11px] font-semibold rounded-lg bg-rose-500/10 hover:bg-rose-500/20 text-rose-300 border border-rose-500/30 flex items-center gap-1"
            >
              <RotateCcw className="w-3 h-3" />
              <span>{t('clearAllFilters')}</span>
            </button>
          )}

          <button
            type="button"
            onClick={() => setExpanded(!expanded)}
            className="h-7 px-2 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800"
          >
            {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {/* Active Filter Chips */}
      {activeChips.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 px-4 py-2 bg-slate-900/60 border-b border-slate-800/80">
          {activeChips.map(ch => (
            <span
              key={ch.id}
              className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-indigo-950/70 border border-indigo-700/40 text-[11px] text-indigo-200"
            >
              <span>{ch.label}</span>
              <button
                type="button"
                onClick={ch.remove}
                className="text-indigo-400 hover:text-white"
                aria-label="Remove filter"
              >
                <X className="w-3 h-3" />
              </button>
            </span>
          ))}
        </div>
      )}

      {/* Collapsible Filter Controls */}
      {expanded && (
        <div className="p-4 space-y-4">
          {/* Sub-section Tabs */}
          <div className="flex flex-wrap items-center gap-2 border-b border-slate-800 pb-3">
            <button
              type="button"
              onClick={() => setActiveTab('missions')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                activeTab === 'missions'
                  ? 'bg-indigo-600 text-white'
                  : 'bg-slate-950 text-slate-400 hover:text-slate-200 border border-slate-800'
              }`}
            >
              <Target className="w-3.5 h-3.5" />
              <span>{t('filterMissions')}</span>
              {filters.missionIds.length > 0 && (
                <span className="px-1.5 py-0.2 bg-white/20 rounded text-[10px]">
                  {filters.missionIds.length}
                </span>
              )}
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('registrations')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                activeTab === 'registrations'
                  ? 'bg-emerald-600 text-white'
                  : 'bg-slate-950 text-slate-400 hover:text-slate-200 border border-slate-800'
              }`}
            >
              <Smartphone className="w-3.5 h-3.5" />
              <span>{t('filterRegistrationSection')}</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('network_cells')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                activeTab === 'network_cells'
                  ? 'bg-blue-600 text-white'
                  : 'bg-slate-950 text-slate-400 hover:text-slate-200 border border-slate-800'
              }`}
            >
              <Radio className="w-3.5 h-3.5" />
              <span>{t('filterNetworkCellSection')}</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('plmn')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                activeTab === 'plmn'
                  ? 'bg-amber-600 text-white'
                  : 'bg-slate-950 text-slate-400 hover:text-slate-200 border border-slate-800'
              }`}
            >
              <Globe className="w-3.5 h-3.5" />
              <span>{t('filterPlmnLookup')}</span>
            </button>
          </div>

          {/* TAB 1: MISSION MULTI-SELECT (by authoritative Mission.id) */}
          {activeTab === 'missions' && (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="relative flex-1 min-w-[220px]">
                  <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-2.5" />
                  <input
                    type="text"
                    value={missionSearch}
                    onChange={e => setMissionSearch(e.target.value)}
                    placeholder="Search mission label, location, or #id..."
                    className="w-full h-8 pl-8 pr-3 text-xs bg-slate-950 border border-slate-800 rounded-lg text-slate-200 focus:outline-none focus:border-indigo-500"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => onChange({ ...filters, missionIds: (options?.missions || []).map(m => m.id) })}
                    className="px-2.5 py-1 text-[11px] font-medium rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200"
                  >
                    Select All ({options?.missions?.length || 0})
                  </button>
                  <button
                    type="button"
                    onClick={() => onChange({ ...filters, missionIds: [] })}
                    className="px-2.5 py-1 text-[11px] font-medium rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300"
                  >
                    Deselect All
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 max-h-48 overflow-y-auto pr-1">
                {missionsList.map(m => {
                  const selected = filters.missionIds.includes(m.id);
                  return (
                    <label
                      key={m.id}
                      className={`flex items-center gap-2 p-2 rounded-lg border text-xs cursor-pointer transition-colors ${
                        selected
                          ? 'bg-indigo-600/20 border-indigo-500 text-white'
                          : 'bg-slate-950/70 border-slate-800 text-slate-300 hover:bg-slate-800/50'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={selected}
                        onChange={() => toggleMissionId(m.id)}
                        className="rounded bg-slate-900 border-slate-700 text-indigo-600"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="font-semibold truncate">{m.mission}</div>
                        <div className="text-[10px] text-slate-400 truncate">
                          {m.location} • #{m.id}
                        </div>
                      </div>
                    </label>
                  );
                })}
              </div>

              {/* Saved Views quick manager */}
              {savedViews.length > 0 && (
                <div className="pt-2 border-t border-slate-800 flex flex-wrap items-center gap-2">
                  <span className="text-[11px] text-slate-400 font-semibold">Saved Views:</span>
                  {savedViews.map(v => (
                    <div
                      key={v.id}
                      className="inline-flex items-center gap-1 bg-slate-950 border border-slate-800 rounded-lg px-2 py-1 text-[11px]"
                    >
                      <button
                        type="button"
                        onClick={() => handleApplyView(v.filters_json)}
                        className="text-amber-300 hover:underline font-medium"
                      >
                        {v.view_name}
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeleteView(v.id)}
                        className="text-slate-500 hover:text-rose-400"
                        title="Delete saved view"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* TAB 2: REGISTRATION FILTERS (strictly isolated from NetworkCell queries) */}
          {activeTab === 'registrations' && (
            <div className="space-y-4">
              <div className="text-[11px] text-emerald-300/90 bg-emerald-950/30 border border-emerald-900/50 rounded-lg px-3 py-1.5">
                Registration filters apply exclusively to Registration metrics, country SIM distribution, and Registration BTS markers. They never affect Network-Cell charts.
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
                {/* Text Searches */}
                <div>
                  <label className="text-[10px] font-semibold text-slate-400 uppercase block mb-1">IMSI</label>
                  <input
                    type="text"
                    value={filters.imsi}
                    onChange={e => onChange({ ...filters, imsi: e.target.value })}
                    placeholder="Match IMSI..."
                    className="w-full h-8 px-2.5 text-xs bg-slate-950 border border-slate-800 rounded-lg text-slate-200"
                  />
                </div>
                <div>
                  <label className="text-[10px] font-semibold text-slate-400 uppercase block mb-1">IMEI</label>
                  <input
                    type="text"
                    value={filters.imei}
                    onChange={e => onChange({ ...filters, imei: e.target.value })}
                    placeholder="Match IMEI..."
                    className="w-full h-8 px-2.5 text-xs bg-slate-950 border border-slate-800 rounded-lg text-slate-200"
                  />
                </div>
                {canUseTmsiFilter && (
                  <div>
                    <label className="text-[10px] font-semibold text-amber-400 uppercase block mb-1">TMSI (Restricted)</label>
                    <input
                      type="text"
                      value={filters.tmsi}
                      onChange={e => onChange({ ...filters, tmsi: e.target.value })}
                      placeholder="Match TMSI..."
                      className="w-full h-8 px-2.5 text-xs bg-slate-950 border border-amber-800/60 rounded-lg text-slate-200"
                    />
                  </div>
                )}
                <div>
                  <label className="text-[10px] font-semibold text-slate-400 uppercase block mb-1">BTS Name</label>
                  <input
                    type="text"
                    value={filters.btsName}
                    onChange={e => onChange({ ...filters, btsName: e.target.value })}
                    placeholder="BTS name..."
                    className="w-full h-8 px-2.5 text-xs bg-slate-950 border border-slate-800 rounded-lg text-slate-200"
                  />
                </div>
                <div>
                  <label className="text-[10px] font-semibold text-slate-400 uppercase block mb-1">BTS Identifier</label>
                  <input
                    type="text"
                    value={filters.bts}
                    onChange={e => onChange({ ...filters, bts: e.target.value })}
                    placeholder="BTS code..."
                    className="w-full h-8 px-2.5 text-xs bg-slate-950 border border-slate-800 rounded-lg text-slate-200"
                  />
                </div>
                <div>
                  <label className="text-[10px] font-semibold text-slate-400 uppercase block mb-1">Last Seen From</label>
                  <input
                    type="date"
                    value={filters.lastSeenFrom}
                    onChange={e => onChange({ ...filters, lastSeenFrom: e.target.value })}
                    className="w-full h-8 px-2 text-xs bg-slate-950 border border-slate-800 rounded-lg text-slate-200"
                  />
                </div>
                <div>
                  <label className="text-[10px] font-semibold text-slate-400 uppercase block mb-1">Last Seen To</label>
                  <input
                    type="date"
                    value={filters.lastSeenTo}
                    onChange={e => onChange({ ...filters, lastSeenTo: e.target.value })}
                    className="w-full h-8 px-2 text-xs bg-slate-950 border border-slate-800 rounded-lg text-slate-200"
                  />
                </div>
                <div>
                  <label className="text-[10px] font-semibold text-slate-400 uppercase block mb-1">BTS Location Availability</label>
                  <select
                    value={filters.hasBtsLocation}
                    onChange={e => onChange({ ...filters, hasBtsLocation: e.target.value as any })}
                    className="w-full h-8 px-2 text-xs bg-slate-950 border border-slate-800 rounded-lg text-slate-200"
                  >
                    <option value="all">All</option>
                    <option value="available">Available</option>
                    <option value="unavailable">Unavailable</option>
                  </select>
                </div>
                <div>
                  <label className="text-[10px] font-semibold text-slate-400 uppercase block mb-1">BTS Outdated</label>
                  <select
                    value={filters.btsLocationOutdated}
                    onChange={e => onChange({ ...filters, btsLocationOutdated: e.target.value as any })}
                    className="w-full h-8 px-2 text-xs bg-slate-950 border border-slate-800 rounded-lg text-slate-200"
                  >
                    <option value="all">All</option>
                    <option value="true">True</option>
                    <option value="false">False</option>
                  </select>
                </div>
                <div>
                  <label className="text-[10px] font-semibold text-slate-400 uppercase block mb-1">Device Location</label>
                  <select
                    value={filters.hasDeviceLocation}
                    onChange={e => onChange({ ...filters, hasDeviceLocation: e.target.value as any })}
                    className="w-full h-8 px-2 text-xs bg-slate-950 border border-slate-800 rounded-lg text-slate-200"
                  >
                    <option value="all">All</option>
                    <option value="available">Available</option>
                    <option value="unavailable">Unavailable</option>
                  </select>
                </div>

                {/* Numeric Ranges */}
                <div>
                  <label className="text-[10px] font-semibold text-slate-400 uppercase block mb-1">BTS Altitude (Min / Max)</label>
                  <div className="flex gap-1.5">
                    <input
                      type="number"
                      placeholder="Min"
                      value={filters.btsAltitudeMin}
                      onChange={e => onChange({ ...filters, btsAltitudeMin: e.target.value })}
                      className="w-1/2 h-8 px-2 text-xs bg-slate-950 border border-slate-800 rounded-lg text-slate-200"
                    />
                    <input
                      type="number"
                      placeholder="Max"
                      value={filters.btsAltitudeMax}
                      onChange={e => onChange({ ...filters, btsAltitudeMax: e.target.value })}
                      className="w-1/2 h-8 px-2 text-xs bg-slate-950 border border-slate-800 rounded-lg text-slate-200"
                    />
                  </div>
                </div>
                <div>
                  <label className="text-[10px] font-semibold text-slate-400 uppercase block mb-1">Distance Min (From / To)</label>
                  <div className="flex gap-1.5">
                    <input
                      type="number"
                      placeholder="From"
                      value={filters.distanceMinFrom}
                      onChange={e => onChange({ ...filters, distanceMinFrom: e.target.value })}
                      className="w-1/2 h-8 px-2 text-xs bg-slate-950 border border-slate-800 rounded-lg text-slate-200"
                    />
                    <input
                      type="number"
                      placeholder="To"
                      value={filters.distanceMinTo}
                      onChange={e => onChange({ ...filters, distanceMinTo: e.target.value })}
                      className="w-1/2 h-8 px-2 text-xs bg-slate-950 border border-slate-800 rounded-lg text-slate-200"
                    />
                  </div>
                </div>
                <div>
                  <label className="text-[10px] font-semibold text-slate-400 uppercase block mb-1">Distance Max (From / To)</label>
                  <div className="flex gap-1.5">
                    <input
                      type="number"
                      placeholder="From"
                      value={filters.distanceMaxFrom}
                      onChange={e => onChange({ ...filters, distanceMaxFrom: e.target.value })}
                      className="w-1/2 h-8 px-2 text-xs bg-slate-950 border border-slate-800 rounded-lg text-slate-200"
                    />
                    <input
                      type="number"
                      placeholder="To"
                      value={filters.distanceMaxTo}
                      onChange={e => onChange({ ...filters, distanceMaxTo: e.target.value })}
                      className="w-1/2 h-8 px-2 text-xs bg-slate-950 border border-slate-800 rounded-lg text-slate-200"
                    />
                  </div>
                </div>
              </div>

              {/* Multi-select checkbox groups for Registration */}
              <div className="grid grid-cols-1 md:grid-cols-4 gap-3 pt-2 border-t border-slate-800">
                <div>
                  <div className="text-[10px] font-bold text-slate-400 uppercase mb-1.5">Country</div>
                  <div className="max-h-28 overflow-y-auto space-y-1 bg-slate-950/60 p-2 rounded-lg border border-slate-800">
                    {(options?.registrations.countries || []).map(c => (
                      <label key={c} className="flex items-center gap-1.5 text-[11px] text-slate-300 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={filters.country.includes(c)}
                          onChange={() => toggleArrayString('country', c)}
                          className="rounded bg-slate-900 border-slate-700 text-emerald-500"
                        />
                        <span className="truncate">{c}</span>
                      </label>
                    ))}
                  </div>
                </div>

                <div>
                  <div className="text-[10px] font-bold text-slate-400 uppercase mb-1.5">Country Code</div>
                  <div className="max-h-28 overflow-y-auto space-y-1 bg-slate-950/60 p-2 rounded-lg border border-slate-800">
                    {(options?.registrations.countryCodes || []).map(cc => (
                      <label key={cc} className="flex items-center gap-1.5 text-[11px] text-slate-300 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={filters.countryCode.includes(cc)}
                          onChange={() => toggleArrayString('countryCode', cc)}
                          className="rounded bg-slate-900 border-slate-700 text-emerald-500"
                        />
                        <span>{cc}</span>
                      </label>
                    ))}
                  </div>
                </div>

                <div>
                  <div className="text-[10px] font-bold text-slate-400 uppercase mb-1.5">UE Model</div>
                  <div className="max-h-28 overflow-y-auto space-y-1 bg-slate-950/60 p-2 rounded-lg border border-slate-800">
                    {(options?.registrations.ueModels || []).map(u => (
                      <label key={u} className="flex items-center gap-1.5 text-[11px] text-slate-300 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={filters.ueModel.includes(u)}
                          onChange={() => toggleArrayString('ueModel', u)}
                          className="rounded bg-slate-900 border-slate-700 text-emerald-500"
                        />
                        <span className="truncate">{u}</span>
                      </label>
                    ))}
                  </div>
                </div>

                <div>
                  <div className="text-[10px] font-bold text-slate-400 uppercase mb-1.5">Action / Update</div>
                  <div className="max-h-28 overflow-y-auto space-y-1 bg-slate-950/60 p-2 rounded-lg border border-slate-800">
                    {(options?.registrations.actions || []).map(a => (
                      <label key={`a_${a}`} className="flex items-center gap-1.5 text-[11px] text-slate-300 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={filters.action.includes(a)}
                          onChange={() => toggleArrayString('action', a)}
                          className="rounded bg-slate-900 border-slate-700 text-emerald-500"
                        />
                        <span>Action: {a}</span>
                      </label>
                    ))}
                    {(options?.registrations.updates || []).map(u => (
                      <label key={`u_${u}`} className="flex items-center gap-1.5 text-[11px] text-slate-300 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={filters.update.includes(u)}
                          onChange={() => toggleArrayString('update', u)}
                          className="rounded bg-slate-900 border-slate-700 text-emerald-500"
                        />
                        <span>Update: {u}</span>
                      </label>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* TAB 3: NETWORK CELL FILTERS (strictly isolated from Registration / date filters) */}
          {activeTab === 'network_cells' && (
            <div className="space-y-4">
              <div className="text-[11px] text-sky-300/90 bg-sky-950/30 border border-sky-900/50 rounded-lg px-3 py-1.5">
                Network-Cell filters apply exclusively to cell tower aggregations (MCC, Military, Civilian, RAT) and NetworkCell BTS markers. Date/time filters are intentionally excluded from NetworkCell schema queries.
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
                <div>
                  <label className="text-[10px] font-semibold text-slate-400 uppercase block mb-1">LAC</label>
                  <input
                    type="text"
                    value={filters.lac}
                    onChange={e => onChange({ ...filters, lac: e.target.value })}
                    placeholder="Exact LAC..."
                    className="w-full h-8 px-2.5 text-xs bg-slate-950 border border-slate-800 rounded-lg text-slate-200 font-mono"
                  />
                </div>
                <div>
                  <label className="text-[10px] font-semibold text-slate-400 uppercase block mb-1">Cell ID</label>
                  <input
                    type="text"
                    value={filters.cellId}
                    onChange={e => onChange({ ...filters, cellId: e.target.value })}
                    placeholder="Exact Cell ID..."
                    className="w-full h-8 px-2.5 text-xs bg-slate-950 border border-slate-800 rounded-lg text-slate-200 font-mono"
                  />
                </div>
                <div>
                  <label className="text-[10px] font-semibold text-slate-400 uppercase block mb-1">Channel / ARFCN</label>
                  <input
                    type="number"
                    value={filters.channel}
                    onChange={e => onChange({ ...filters, channel: e.target.value })}
                    placeholder="Channel..."
                    className="w-full h-8 px-2.5 text-xs bg-slate-950 border border-slate-800 rounded-lg text-slate-200"
                  />
                </div>
                <div>
                  <label className="text-[10px] font-semibold text-slate-400 uppercase block mb-1">BSIC / PCI / PSC</label>
                  <div className="flex gap-1.5">
                    <input
                      type="text"
                      placeholder="BSIC"
                      value={filters.bsic}
                      onChange={e => onChange({ ...filters, bsic: e.target.value })}
                      className="w-1/3 h-8 px-2 text-xs bg-slate-950 border border-slate-800 rounded-lg text-slate-200 font-mono"
                    />
                    <input
                      type="text"
                      placeholder="PCI"
                      value={filters.pci}
                      onChange={e => onChange({ ...filters, pci: e.target.value })}
                      className="w-1/3 h-8 px-2 text-xs bg-slate-950 border border-slate-800 rounded-lg text-slate-200 font-mono"
                    />
                    <input
                      type="text"
                      placeholder="PSC"
                      value={filters.psc || ''}
                      onChange={e => onChange({ ...filters, psc: e.target.value })}
                      className="w-1/3 h-8 px-2 text-xs bg-slate-950 border border-slate-800 rounded-lg text-slate-200 font-mono"
                    />
                  </div>
                </div>

                <div>
                  <label className="text-[10px] font-semibold text-slate-400 uppercase block mb-1">RxLev (Min / Max)</label>
                  <div className="flex gap-1.5">
                    <input
                      type="number"
                      placeholder="Min"
                      value={filters.rxLevMin}
                      onChange={e => onChange({ ...filters, rxLevMin: e.target.value })}
                      className="w-1/2 h-8 px-2 text-xs bg-slate-950 border border-slate-800 rounded-lg text-slate-200"
                    />
                    <input
                      type="number"
                      placeholder="Max"
                      value={filters.rxLevMax}
                      onChange={e => onChange({ ...filters, rxLevMax: e.target.value })}
                      className="w-1/2 h-8 px-2 text-xs bg-slate-950 border border-slate-800 rounded-lg text-slate-200"
                    />
                  </div>
                </div>

                <div>
                  <label className="text-[10px] font-semibold text-slate-400 uppercase block mb-1">RxLev dBm (Min / Max)</label>
                  <div className="flex gap-1.5">
                    <input
                      type="number"
                      placeholder="-115"
                      value={filters.rxLevDbmMin}
                      onChange={e => onChange({ ...filters, rxLevDbmMin: e.target.value })}
                      className="w-1/2 h-8 px-2 text-xs bg-slate-950 border border-slate-800 rounded-lg text-slate-200"
                    />
                    <input
                      type="number"
                      placeholder="-40"
                      value={filters.rxLevDbmMax}
                      onChange={e => onChange({ ...filters, rxLevDbmMax: e.target.value })}
                      className="w-1/2 h-8 px-2 text-xs bg-slate-950 border border-slate-800 rounded-lg text-slate-200"
                    />
                  </div>
                </div>

                <div>
                  <label className="text-[10px] font-semibold text-slate-400 uppercase block mb-1">Downlink / DL BW</label>
                  <div className="flex gap-1.5">
                    <input
                      type="number"
                      placeholder="DL ≥"
                      value={filters.downlinkMin}
                      onChange={e => onChange({ ...filters, downlinkMin: e.target.value })}
                      className="w-1/2 h-8 px-2 text-xs bg-slate-950 border border-slate-800 rounded-lg text-slate-200"
                    />
                    <input
                      type="number"
                      placeholder="BW ≥"
                      value={filters.dlBandwidthMin}
                      onChange={e => onChange({ ...filters, dlBandwidthMin: e.target.value })}
                      className="w-1/2 h-8 px-2 text-xs bg-slate-950 border border-slate-800 rounded-lg text-slate-200"
                    />
                  </div>
                </div>

                <div>
                  <label className="text-[10px] font-semibold text-slate-400 uppercase block mb-1">Direction° (Min / Max)</label>
                  <div className="flex gap-1.5">
                    <input
                      type="number"
                      placeholder="0"
                      value={filters.directionMin}
                      onChange={e => onChange({ ...filters, directionMin: e.target.value })}
                      className="w-1/2 h-8 px-2 text-xs bg-slate-950 border border-slate-800 rounded-lg text-slate-200"
                    />
                    <input
                      type="number"
                      placeholder="360"
                      value={filters.directionMax}
                      onChange={e => onChange({ ...filters, directionMax: e.target.value })}
                      className="w-1/2 h-8 px-2 text-xs bg-slate-950 border border-slate-800 rounded-lg text-slate-200"
                    />
                  </div>
                </div>

                <div>
                  <label className="text-[10px] font-semibold text-slate-400 uppercase block mb-1">Is Neighbour Cell</label>
                  <select
                    value={filters.isNeighbour}
                    onChange={e => onChange({ ...filters, isNeighbour: e.target.value as any })}
                    className="w-full h-8 px-2 text-xs bg-slate-950 border border-slate-800 rounded-lg text-slate-200"
                  >
                    <option value="all">All</option>
                    <option value="true">True</option>
                    <option value="false">False</option>
                  </select>
                </div>

                <div>
                  <label className="text-[10px] font-semibold text-slate-400 uppercase block mb-1">Is PCS1900</label>
                  <select
                    value={filters.isPcs1900}
                    onChange={e => onChange({ ...filters, isPcs1900: e.target.value as any })}
                    className="w-full h-8 px-2 text-xs bg-slate-950 border border-slate-800 rounded-lg text-slate-200"
                  >
                    <option value="all">All</option>
                    <option value="true">True</option>
                    <option value="false">False</option>
                  </select>
                </div>

                <div>
                  <label className="text-[10px] font-semibold text-slate-400 uppercase block mb-1">Valid Coordinates</label>
                  <select
                    value={filters.hasCoordinates}
                    onChange={e => onChange({ ...filters, hasCoordinates: e.target.value as any })}
                    className="w-full h-8 px-2 text-xs bg-slate-950 border border-slate-800 rounded-lg text-slate-200"
                  >
                    <option value="all">All</option>
                    <option value="available">Available</option>
                    <option value="unavailable">Unavailable</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-2 border-t border-slate-800">
                <div>
                  <div className="text-[10px] font-bold text-slate-400 uppercase mb-1.5">RAT Technology</div>
                  <div className="flex flex-wrap gap-1.5">
                    {(options?.networkCells.rats || []).map(r => (
                      <button
                        key={r}
                        type="button"
                        onClick={() => toggleArrayString('rat', r)}
                        className={`px-2.5 py-1 rounded-md text-[11px] font-semibold border ${
                          filters.rat.includes(r)
                            ? 'bg-blue-600 border-blue-500 text-white'
                            : 'bg-slate-950 border-slate-800 text-slate-300 hover:bg-slate-800'
                        }`}
                      >
                        {r}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <div className="text-[10px] font-bold text-slate-400 uppercase mb-1.5">MCC</div>
                  <div className="flex flex-wrap gap-1.5">
                    {(options?.networkCells.mccs || []).map(m => {
                      const val = String(m);
                      return (
                        <button
                          key={val}
                          type="button"
                          onClick={() => toggleArrayString('mcc', val)}
                          className={`px-2 py-1 rounded-md text-[11px] font-mono border ${
                            filters.mcc.includes(val)
                              ? 'bg-blue-600 border-blue-500 text-white'
                              : 'bg-slate-950 border-slate-800 text-slate-300 hover:bg-slate-800'
                          }`}
                        >
                          {val}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div>
                  <div className="text-[10px] font-bold text-slate-400 uppercase mb-1.5">MNC</div>
                  <div className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto">
                    {(options?.networkCells.mncs || []).map(m => {
                      const val = String(m);
                      return (
                        <button
                          key={val}
                          type="button"
                          onClick={() => toggleArrayString('mnc', val)}
                          className={`px-2 py-1 rounded-md text-[11px] font-mono border ${
                            filters.mnc.includes(val)
                              ? 'bg-blue-600 border-blue-500 text-white'
                              : 'bg-slate-950 border-slate-800 text-slate-300 hover:bg-slate-800'
                          }`}
                        >
                          {val}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* TAB 4: PLMN OPERATOR LOOKUP */}
          {activeTab === 'plmn' && (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <div className="relative flex-1">
                  <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-2.5" />
                  <input
                    type="text"
                    value={filters.plmnQuery}
                    onChange={e => onChange({ ...filters, plmnQuery: e.target.value })}
                    placeholder="Search carrier name (e.g. Partner, Jawwal, Etisalat, محمول), country, or MCC..."
                    className="w-full h-8 pl-8 pr-3 text-xs bg-slate-950 border border-slate-800 rounded-lg text-slate-200 focus:outline-none focus:border-amber-500"
                  />
                </div>
                {filters.plmnQuery && (
                  <button
                    type="button"
                    onClick={() => onChange({ ...filters, plmnQuery: '' })}
                    className="px-3 h-8 text-xs rounded-lg bg-slate-800 text-slate-300 hover:text-white"
                  >
                    Clear
                  </button>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 max-h-48 overflow-y-auto">
                {plmnLoading ? (
                  <div className="text-xs text-slate-500 p-2">Searching PLMN directory...</div>
                ) : (
                  plmnResults.map((p, idx) => (
                    <button
                      key={`${p.mcc}-${p.mnc}-${idx}`}
                      type="button"
                      onClick={() => {
                        const sMcc = String(p.mcc);
                        const sMnc = String(p.mnc);
                        onChange({
                          ...filters,
                          mcc: filters.mcc.includes(sMcc) ? filters.mcc : [...filters.mcc, sMcc],
                          mnc: filters.mnc.includes(sMnc) ? filters.mnc : [...filters.mnc, sMnc],
                        });
                      }}
                      className="flex items-center justify-between p-2.5 rounded-lg bg-slate-950/70 border border-slate-800 hover:border-amber-500/60 text-start transition-colors"
                    >
                      <div className="min-w-0">
                        <div className="text-xs font-bold text-slate-200 truncate">{p.name}</div>
                        <div className="text-[10px] text-slate-400">
                          {p.country} ({p.code})
                        </div>
                      </div>
                      <span className="px-2 py-0.5 rounded bg-slate-800 text-amber-300 font-mono text-[11px] shrink-0">
                        {p.mcc}/{p.mnc}
                      </span>
                    </button>
                  ))
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
