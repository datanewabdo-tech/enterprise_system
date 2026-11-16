import React, { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
// Ensure plugins attach to global L under Vite ESM
if (typeof window !== 'undefined') {
  (window as any).L = L;
}
import 'leaflet.markercluster';
import 'leaflet.heat';
import { RotateCcw, Layers, Flame, MapPin, Eye, EyeOff } from 'lucide-react';

export interface BtsLocationItem {
  key: string;
  lat: number;
  lng: number;
  source: 'registration' | 'network_cell' | 'both';
  registrationCount: number;
  networkCellCount: number;
  totalCount: number;
  btsNames: string[];
  btsCodes: string[];
  countries: string[];
  rats: string[];
  mccs: number[];
  mncs: number[];
  cellIds: number[];
  missions: string[];
}

interface BtsLocationsMapProps {
  locations: BtsLocationItem[];
  stats?: {
    totalParsedRegistrationCoords: number;
    uniqueLocations: number;
    registrationLocationsCount: number;
    networkCellLocationsCount: number;
    invalidSkippedCount: number;
  };
  mapContainerId?: string;
}

export const BtsLocationsMap: React.FC<BtsLocationsMapProps> = ({
  locations,
  stats,
  mapContainerId = 'bts-dashboard-map',
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const clusterLayerRef = useRef<any>(null);
  const heatLayerRef = useRef<L.Layer | null>(null);

  const [showRegistrations, setShowRegistrations] = useState(true);
  const [showNetworkCells, setShowNetworkCells] = useState(true);
  const [showHeatmap, setShowHeatmap] = useState(false);

  // Initialize Leaflet map once
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = L.map(containerRef.current, {
      center: [31.2, 34.4],
      zoom: 7,
      zoomControl: false,
      preferCanvas: true,
    });

    L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
      attribution: '&copy; OpenStreetMap &copy; CARTO',
      maxZoom: 19,
      crossOrigin: 'anonymous',
    }).addTo(map);

    L.control.zoom({ position: 'topright' }).addTo(map);

    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
      clusterLayerRef.current = null;
      heatLayerRef.current = null;
    };
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

    const visibleLocations = locations.filter(loc => {
      if (loc.source === 'registration') return showRegistrations;
      if (loc.source === 'network_cell') return showNetworkCells;
      return showRegistrations || showNetworkCells;
    });

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
          ? 'Registration + NetworkCell'
          : loc.source === 'registration'
          ? 'Registration BTS'
          : 'NetworkCell Tower';

      // Aggregate metadata only - strictly NO IMSI, IMEI, or TMSI exposed in map popups
      marker.bindPopup(`
        <div style="font-family: system-ui, sans-serif; font-size: 12px; min-width: 210px;">
          <div style="font-weight: 700; color: ${color}; margin-bottom: 4px;">${sourceBadge}</div>
          <div><b>Coordinates:</b> ${loc.lat.toFixed(5)}, ${loc.lng.toFixed(5)}</div>
          <div><b>Total Observations:</b> ${loc.totalCount} (Reg: ${loc.registrationCount}, Cells: ${loc.networkCellCount})</div>
          ${loc.btsNames.length ? `<div><b>BTS Names:</b> ${loc.btsNames.slice(0, 4).join(', ')}</div>` : ''}
          ${loc.countries.length ? `<div><b>Countries:</b> ${loc.countries.join(', ')}</div>` : ''}
          ${loc.rats.length ? `<div><b>RATs:</b> ${loc.rats.join(', ')}</div>` : ''}
          ${loc.mccs.length ? `<div><b>MCC/MNC:</b> ${loc.mccs.join(',')} / ${loc.mncs.join(',')}</div>` : ''}
          ${loc.cellIds.length ? `<div><b>Cell IDs:</b> ${loc.cellIds.slice(0, 6).join(', ')}</div>` : ''}
          ${loc.missions.length ? `<div><b>Missions:</b> ${loc.missions.slice(0, 3).join(', ')}</div>` : ''}
        </div>
      `);

      mcg.addLayer(marker);
      heatPoints.push([loc.lat, loc.lng, Math.min(1, 0.35 + loc.totalCount * 0.15)]);
    }

    map.addLayer(mcg);
    clusterLayerRef.current = mcg;

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
  }, [locations, showRegistrations, showNetworkCells, showHeatmap]);

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-sm space-y-3">
      {/* Header & Controls */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-bold text-slate-100 flex items-center gap-2">
            <MapPin className="w-4 h-4 text-emerald-400" />
            <span>BTS & Network Cell Locations Map</span>
          </h2>
          <p className="text-[11px] text-slate-400 mt-0.5">
            Unique Locations: <strong className="text-slate-200">{stats?.uniqueLocations ?? locations.length}</strong> • Parsed Reg Coords:{' '}
            <strong className="text-emerald-400">{stats?.totalParsedRegistrationCoords ?? 0}</strong> • Network Cells:{' '}
            <strong className="text-blue-400">{stats?.networkCellLocationsCount ?? 0}</strong> • Invalid Skipped:{' '}
            <strong className="text-amber-400">{stats?.invalidSkippedCount ?? 0}</strong>
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setShowRegistrations(v => !v)}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold border transition-colors ${
              showRegistrations
                ? 'bg-emerald-500/15 border-emerald-500/50 text-emerald-300'
                : 'bg-slate-950 border-slate-800 text-slate-500'
            }`}
          >
            {showRegistrations ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
            <span>Registration BTS</span>
          </button>

          <button
            type="button"
            onClick={() => setShowNetworkCells(v => !v)}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold border transition-colors ${
              showNetworkCells
                ? 'bg-blue-500/15 border-blue-500/50 text-blue-300'
                : 'bg-slate-950 border-slate-800 text-slate-500'
            }`}
          >
            {showNetworkCells ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
            <span>Network Cells</span>
          </button>

          <button
            type="button"
            onClick={() => setShowHeatmap(v => !v)}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold border transition-colors ${
              showHeatmap
                ? 'bg-amber-500/20 border-amber-500/50 text-amber-300'
                : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200'
            }`}
          >
            <Flame className="w-3.5 h-3.5" />
            <span>Heatmap</span>
          </button>

          <button
            type="button"
            onClick={() => fitMapBounds(locations)}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>Reset View</span>
          </button>
        </div>
      </div>

      {/* Map Canvas */}
      <div className="relative h-[420px] rounded-xl overflow-hidden border border-slate-800 bg-slate-950">
        <div id={mapContainerId} ref={containerRef} className="w-full h-full" />

        {/* Legend Overlay */}
        <div className="absolute bottom-3 left-3 z-[400] flex flex-wrap items-center gap-3 px-3 py-1.5 rounded-lg bg-slate-950/90 border border-slate-800 text-[11px] text-slate-300 shadow-lg">
          <span className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 border border-white" /> Registration BTS
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-blue-500 border border-white" /> NetworkCell
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-amber-500 border border-white" /> Shared / Overlapping
          </span>
          <span className="flex items-center gap-1 text-slate-400">
            <Layers className="w-3 h-3" /> Clustered
          </span>
        </div>
      </div>
    </div>
  );
};
