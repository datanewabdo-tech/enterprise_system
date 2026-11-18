import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import L from 'leaflet';
// Ensure plugins attach to global L under Vite ESM
if (typeof window !== 'undefined') {
  (window as any).L = L;
}
import 'leaflet.markercluster';
import 'leaflet.heat';
import { RotateCcw, Layers, Flame, MapPin, Eye, EyeOff, Maximize2, Minimize2 } from 'lucide-react';
import { useApp } from '../../context/AppContext.js';
import { DashboardFilterState } from '../../types/index.js';
import { ChartExportMenu } from './ChartExportMenu.js';
import { captureLeafletMapPng } from '../../utils/mapSnapshot.js';
import { MapStatusOverlay } from '../common/LoadingStates.js';

export interface BtsLocationItem {
  key?: string;
  locationKey?: string;
  lat: number;
  lng: number;
  source: 'registration' | 'network_cell' | 'both';
  registrationCount: number;
  networkCellCount: number;
  totalCount: number;
  btsNames: string[];
  btsCodes: string[];
  countries: string[];
  countryCodes?: string[];
  rats: string[];
  mccs: Array<string | number>;
  mncs: Array<string | number>;
  cellIds: Array<string | number>;
  missions: string[];
  registrationIds?: number[];
}

interface BtsLocationsMapProps {
  locations: BtsLocationItem[];
  stats?: {
    totalRegistrationRecords: number;
    registrationRecordsWithLocation: number;
    totalParsedRegistrationCoords: number;
    invalidRegistrationCoords: number;
    uniqueLocations: number;
    registrationLocationsCount: number;
    networkCellLocationsCount: number;
    invalidSkippedCount: number;
  };
  filters?: Partial<DashboardFilterState>;
  onRegisterSnapshotCapture?: (fn: (() => Promise<string | null>) | null) => void;
  mapContainerId?: string;
  loading?: boolean;
  refreshing?: boolean;
  error?: string | null;
  onRetry?: () => void;
}

const escapePopupText = (value: string | number): string =>
  String(value).replace(/[&<>"']/g, character => {
    const entities: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    };
    return entities[character];
  });

export const BtsLocationsMap: React.FC<BtsLocationsMapProps> = ({
  locations,
  stats,
  filters = {},
  onRegisterSnapshotCapture,
  mapContainerId = 'bts-dashboard-map',
  loading = false,
  refreshing = false,
  error = null,
  onRetry,
}) => {
  const { language, t } = useApp();
  const isAr = language === 'ar';

  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const tileLayerRef = useRef<L.TileLayer | null>(null);
  const clusterLayerRef = useRef<any>(null);
  const heatLayerRef = useRef<L.Layer | null>(null);

  const [showRegistrations, setShowRegistrations] = useState(true);
  const [showNetworkCells, setShowNetworkCells] = useState(true);
  const [showHeatmap, setShowHeatmap] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [tilesLoading, setTilesLoading] = useState(true);
  const [tileError, setTileError] = useState(false);
  const [renderedMapPointCount, setRenderedMapPointCount] = useState(0);
  const visibleLocations = useMemo(
    () =>
      locations.filter(loc => {
        if (loc.source === 'registration') return showRegistrations;
        if (loc.source === 'network_cell') return showNetworkCells;
        return showRegistrations || showNetworkCells;
      }),
    [locations, showRegistrations, showNetworkCells]
  );

  const mapTitle = t('btsMapTitle');
  const mapSubtitle = loading
    ? t('loadingMapData')
    : `${t('uniqueLocations')}: ${stats?.uniqueLocations ?? locations.length} • ${
        t('regCoords')
      }: ${stats?.totalParsedRegistrationCoords ?? 0} • ${t('networkCellsLegend')}: ${
        stats?.networkCellLocationsCount ?? 0
      }`;

  // Initialize Leaflet map once using same-origin cached OpenStreetMap tile proxy
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = L.map(containerRef.current, {
      center: [31.2, 34.4],
      zoom: 7,
      zoomControl: false,
      preferCanvas: true,
    });

    const primaryTiles = L.tileLayer('/api/v1/map/tiles/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap contributors',
      maxZoom: 19,
      crossOrigin: 'anonymous',
    });

    let switchedToFallback = false;
    let fallbackErrorCount = 0;

    primaryTiles.on('loading', () => {
      setTilesLoading(true);
    });
    primaryTiles.on('load', () => {
      setTilesLoading(false);
      setTileError(false);
    });
    primaryTiles.on('tileload', () => {
      fallbackErrorCount = 0;
      setTileError(false);
    });
    primaryTiles.on('tileerror', () => {
      if (!switchedToFallback) {
        switchedToFallback = true;
        fallbackErrorCount = 0;
        primaryTiles.setUrl('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png');
        return;
      }
      fallbackErrorCount++;
      if (fallbackErrorCount >= 3) {
        setTilesLoading(false);
        setTileError(true);
      }
    });

    primaryTiles.addTo(map);
    tileLayerRef.current = primaryTiles;
    L.control.zoom({ position: isAr ? 'topleft' : 'topright' }).addTo(map);

    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
      tileLayerRef.current = null;
      clusterLayerRef.current = null;
      heatLayerRef.current = null;
    };
  }, []);

  const handleRetryTiles = useCallback(() => {
    setTileError(false);
    setTilesLoading(true);
    tileLayerRef.current?.redraw();
  }, []);

  const fitMapBounds = (pts: BtsLocationItem[]) => {
    const map = mapRef.current;
    if (!map) return;
    if (pts.length === 0) {
      map.setView([31.2, 34.4], 6);
      return;
    }
    const bounds = L.latLngBounds(pts.map(p => [p.lat, p.lng] as [number, number]));
    map.fitBounds(bounds, { padding: [36, 36], maxZoom: 14 });
  };

  // Update markers & heatmap whenever locations or layer toggles change
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (clusterLayerRef.current) {
      map.removeLayer(clusterLayerRef.current);
      clusterLayerRef.current = null;
    }
    if (heatLayerRef.current) {
      map.removeLayer(heatLayerRef.current);
      heatLayerRef.current = null;
    }

    const mcg = (L as any).markerClusterGroup({
      chunkedLoading: true,
      maxClusterRadius: 48,
      spiderfyOnMaxZoom: true,
      showCoverageOnHover: false,
    });

    const heatPoints: Array<[number, number, number]> = [];

    for (const loc of visibleLocations) {
      const color =
        loc.source === 'both'
          ? '#f59e0b'
          : loc.source === 'registration'
          ? '#10b981'
          : '#3b82f6';

      const marker = L.circleMarker([loc.lat, loc.lng], {
        radius: Math.min(13, 6 + Math.log2(loc.totalCount + 1) * 1.6),
        fillColor: color,
        color: '#ffffff',
        weight: 1.5,
        opacity: 1,
        fillOpacity: 0.9,
      });

      const sourceBadge =
        loc.source === 'both'
          ? t('registrationPlusNetworkCell')
          : loc.source === 'registration'
          ? t('registrationBts')
          : t('networkCellTower');
      const countryCodes = loc.countryCodes ?? [];
      const registrationLinks = (loc.registrationIds ?? [])
        .filter(id => Number.isSafeInteger(id) && id > 0)
        .map(
          id =>
            `<a href="/api/v1/tables/registrations/${id}" target="_blank" rel="noopener noreferrer">${id}</a>`
        )
        .join(', ');

      // Aggregate metadata only - strictly NO IMSI, IMEI, or TMSI exposed in map popups
      marker.bindPopup(`
        <div style="font-family: system-ui, sans-serif; font-size: 12px; min-width: 210px;">
          <div style="font-weight: 700; color: ${color}; margin-bottom: 4px;">${sourceBadge}</div>
          <div><b>${t('mapCoordinates')}:</b> ${loc.lat}, ${loc.lng}</div>
          <div><b>${t('totalObservations')}:</b> ${loc.totalCount} (Reg: ${loc.registrationCount}, Cells: ${loc.networkCellCount})</div>
          ${loc.btsNames.length ? `<div><b>${t('btsNamesLabel')}:</b> ${loc.btsNames.slice(0, 4).map(escapePopupText).join(', ')}</div>` : ''}
          ${loc.countries.length ? `<div><b>${t('countriesLabel')}:</b> ${loc.countries.map(escapePopupText).join(', ')}</div>` : ''}
          ${countryCodes.length ? `<div><b>${t('countryCodeLabel')}:</b> ${countryCodes.map(escapePopupText).join(', ')}</div>` : ''}
          ${loc.rats.length ? `<div><b>${t('ratsLabel')}:</b> ${loc.rats.map(escapePopupText).join(', ')}</div>` : ''}
          ${loc.mccs.length ? `<div><b>${t('mccMncLabel')}:</b> ${loc.mccs.map(escapePopupText).join(',')} / ${loc.mncs.map(escapePopupText).join(',')}</div>` : ''}
          ${loc.cellIds.length ? `<div><b>${t('cellIdsLabel')}:</b> ${loc.cellIds.slice(0, 6).map(escapePopupText).join(', ')}</div>` : ''}
          ${loc.missions.length ? `<div><b>${t('missionsLabel')}:</b> ${loc.missions.slice(0, 3).map(escapePopupText).join(', ')}</div>` : ''}
          ${registrationLinks ? `<div><b>${t('registrationRecordIds')}:</b> ${registrationLinks}</div>` : ''}
        </div>
      `);

      mcg.addLayer(marker);
      heatPoints.push([loc.lat, loc.lng, Math.min(1, 0.35 + loc.totalCount * 0.15)]);
    }

    map.addLayer(mcg);
    clusterLayerRef.current = mcg;
    setRenderedMapPointCount(mcg.getLayers().length);

    if (showHeatmap && heatPoints.length > 0 && typeof (L as any).heatLayer === 'function') {
      const heat = (L as any).heatLayer(heatPoints, {
        radius: 26,
        blur: 18,
        maxZoom: 14,
      });
      heat.addTo(map);
      heatLayerRef.current = heat;
    }

    if (visibleLocations.length > 0) {
      fitMapBounds(visibleLocations);
    }
  }, [locations, visibleLocations, showRegistrations, showNetworkCells, showHeatmap]);

  const captureMapPng = useCallback(() => {
    return captureLeafletMapPng(containerRef.current, mapRef.current, {
      title: mapTitle,
      subtitle: mapSubtitle,
      locations,
      showRegistrations,
      showNetworkCells,
      isRtl: isAr,
    });
  }, [mapTitle, mapSubtitle, locations, showRegistrations, showNetworkCells, isAr]);

  useEffect(() => {
    if (!onRegisterSnapshotCapture) return;
    onRegisterSnapshotCapture(captureMapPng);
    return () => onRegisterSnapshotCapture(null);
  }, [onRegisterSnapshotCapture, captureMapPng]);

  const toggleFullscreen = () => {
    setIsFullscreen(v => !v);
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        mapRef.current?.invalidateSize();
      });
    });
  };

  return (
    <div
      className={`bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-sm space-y-3 ${
        isFullscreen ? 'fixed inset-0 z-[900] rounded-none flex flex-col' : ''
      }`}
    >
      {/* Header & Controls */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-bold text-slate-100 flex items-center gap-2">
            <MapPin className="w-4 h-4 text-emerald-400" />
            <span>{mapTitle}</span>
          </h2>
          {loading ? (
            <div className="mt-1 h-3.5 w-72 bg-slate-800 rounded animate-pulse motion-reduce:animate-none" />
          ) : (
            <div className="text-[11px] text-slate-400 mt-0.5 tabular-nums flex flex-wrap gap-x-3 gap-y-1">
              <span>{t('totalRegistrations')}: <strong className="text-slate-200">{stats?.totalRegistrationRecords ?? 0}</strong></span>
              <span>{t('registrationsWithCoordinates')}: <strong className="text-slate-200">{stats?.registrationRecordsWithLocation ?? 0}</strong></span>
              <span>{t('validCoordinates')}: <strong className="text-emerald-400">{stats?.totalParsedRegistrationCoords ?? 0}</strong></span>
              <span>{t('invalidCoordinates')}: <strong className="text-amber-400">{stats?.invalidRegistrationCoords ?? 0}</strong></span>
              <span>{t('uniqueLocations')}: <strong className="text-slate-200">{stats?.uniqueLocations ?? locations.length}</strong></span>
              <span>{t('renderedMapPoints')}: <strong className="text-emerald-400">{renderedMapPointCount}</strong></span>
              <span>{t('networkCellsLegend')}: <strong className="text-blue-400">{stats?.networkCellLocationsCount ?? 0}</strong></span>
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setShowRegistrations(v => !v)}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-semibold border transition-colors ${
              showRegistrations
                ? 'bg-emerald-500/15 border-emerald-500/50 text-emerald-300'
                : 'bg-slate-950 border-slate-800 text-slate-500'
            }`}
          >
            {showRegistrations ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
            <span>{t('registrationBts')}</span>
          </button>

          <button
            type="button"
            onClick={() => setShowNetworkCells(v => !v)}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-semibold border transition-colors ${
              showNetworkCells
                ? 'bg-blue-500/15 border-blue-500/50 text-blue-300'
                : 'bg-slate-950 border-slate-800 text-slate-500'
            }`}
          >
            {showNetworkCells ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
            <span>{t('networkCellsLegend')}</span>
          </button>

          <button
            type="button"
            onClick={() => setShowHeatmap(v => !v)}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-semibold border transition-colors ${
              showHeatmap
                ? 'bg-amber-500/20 border-amber-500/50 text-amber-300'
                : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200'
            }`}
          >
            <Flame className="w-3.5 h-3.5" />
            <span>{t('heatmap')}</span>
          </button>

          <button
            type="button"
            onClick={() => fitMapBounds(locations)}
            className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>{t('resetView')}</span>
          </button>

          <button
            type="button"
            onClick={toggleFullscreen}
            className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700"
          >
            {isFullscreen ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
            <span>{isFullscreen ? t('exitFullscreen') : t('fullscreen')}</span>
          </button>

          <ChartExportMenu
            chartId="btsMap"
            title={mapTitle}
            subtitle={mapSubtitle}
            filters={filters}
            getPngSnapshot={captureMapPng}
          />
        </div>
      </div>

      {/* Map Canvas */}
      <div
        className={`relative rounded-xl overflow-hidden border border-slate-800 bg-slate-950 ${
          isFullscreen ? 'flex-1 min-h-[420px]' : 'h-[420px]'
        }`}
      >
        <div id={mapContainerId} ref={containerRef} className="w-full h-full" />

        <MapStatusOverlay
          dataLoading={loading}
          dataRefreshing={refreshing}
          dataError={error}
          onRetryData={onRetry}
          isEmpty={!loading && !error && locations.length === 0}
          emptyLabel={t('noMapData')}
          tilesLoading={tilesLoading}
          tileError={tileError}
          onRetryTiles={handleRetryTiles}
        />

        {/* Legend Overlay */}
        <div className="absolute bottom-3 start-3 z-[400] flex flex-wrap items-center gap-3 px-3 py-1.5 rounded-lg bg-slate-950/90 border border-slate-800 text-[11px] text-slate-300 shadow-lg">
          <span className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 border border-white" />{' '}
            {t('registrationBts')}
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-blue-500 border border-white" />{' '}
            {t('networkCellsLegend')}
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-amber-500 border border-white" />{' '}
            {t('sharedOverlapping')}
          </span>
          <span className="flex items-center gap-1 text-slate-400">
            <Layers className="w-3 h-3" /> {t('clustered')}
          </span>
        </div>
      </div>
    </div>
  );
};
