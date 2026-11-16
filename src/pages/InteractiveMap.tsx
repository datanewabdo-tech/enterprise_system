import React, { useEffect, useRef, useState, useCallback } from 'react';
import { useApp } from '../context/AppContext.js';
import { useAsyncResource } from '../hooks/useAsyncResource.js';
import { MapStatusOverlay, RefreshingBadge, ErrorRetryCard } from '../components/common/LoadingStates.js';
import L from 'leaflet';
import {
  Layers,
  Maximize2,
  Minimize2,
  Compass,
  MapPin,
  Radio,
  Navigation,
  Download,
  AlertTriangle,
  CheckCircle2,
  Shapes,
  Circle as CircleIcon,
  RefreshCw,
} from 'lucide-react';

interface SpatialLayersPayload {
  mapCells: any[];
  netCells: any[];
  gpsPoints: any[];
  markers: any[];
  polygons: any[];
  circles: any[];
}

export const InteractiveMap: React.FC = () => {
  const { t, language, activeMission, apiFetch, authToken } = useApp();
  const isAr = language === 'ar';
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const layersGroupRef = useRef<L.LayerGroup | null>(null);
  const tileLayerRef = useRef<L.TileLayer | null>(null);
  const fallbackSwitchedRef = useRef(false);
  const fallbackErrCountRef = useRef(0);

  const [mouseCoords, setMouseCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);

  // Tile loading / failure state
  const [tilesLoading, setTilesLoading] = useState(true);
  const [tileError, setTileError] = useState(false);

  // GeoJSON export loading/error
  const [exportingGeo, setExportingGeo] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  // Layer Visibility State
  const [showMapCells, setShowMapCells] = useState(true);
  const [showNetCells, setShowNetCells] = useState(true);
  const [showGpsTrack, setShowGpsTrack] = useState(true);
  const [showMarkers, setShowMarkers] = useState(true);
  const [showPolygons, setShowPolygons] = useState(true);
  const [showCircles, setShowCircles] = useState(true);

  // Coordinate Parser Tool State
  const [coordInput, setCoordInput] = useState('');
  const [coordOrder, setCoordOrder] = useState<'LAT_LNG' | 'LNG_LAT'>('LAT_LNG');
  const [parsedCoord, setParsedCoord] = useState<{
    lat: number | null;
    lng: number | null;
    isValid: boolean;
    error?: string;
  } | null>(null);

  const spatialRes = useAsyncResource<SpatialLayersPayload>(
    async signal => {
      const params = activeMission && activeMission !== 'ALL' ? `?mission=${encodeURIComponent(activeMission)}` : '';
      const res = await apiFetch(`/api/v1/map/all-layers${params}`, { signal });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(data?.error || 'Failed to load spatial layers');
      }
      return {
        mapCells: data?.mapCells || [],
        netCells: data?.netCells || [],
        gpsPoints: data?.gpsPoints || [],
        markers: data?.markers || [],
        polygons: data?.polygons || [],
        circles: data?.circles || [],
      };
    },
    [activeMission, authToken],
    {
      enabled: Boolean(authToken),
      keepPreviousData: true,
      isEmpty: d =>
        d.mapCells.length === 0 &&
        d.netCells.length === 0 &&
        d.gpsPoints.length === 0 &&
        d.markers.length === 0 &&
        d.polygons.length === 0 &&
        d.circles.length === 0,
    }
  );

  const spatialData: SpatialLayersPayload = spatialRes.data || {
    mapCells: [],
    netCells: [],
    gpsPoints: [],
    markers: [],
    polygons: [],
    circles: [],
  };

  // Initialize Leaflet Map
  useEffect(() => {
    if (!mapContainerRef.current || mapInstanceRef.current) return;

    const map = L.map(mapContainerRef.current, {
      center: [30.0444, 31.2357],
      zoom: 12,
      zoomControl: false,
      preferCanvas: true,
    });

    const primaryTiles = L.tileLayer('/api/v1/map/tiles/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap contributors',
      maxZoom: 19,
      crossOrigin: 'anonymous',
    });

    fallbackSwitchedRef.current = false;
    fallbackErrCountRef.current = 0;

    primaryTiles.on('loading', () => {
      setTilesLoading(true);
    });
    primaryTiles.on('load', () => {
      setTilesLoading(false);
    });
    primaryTiles.on('tileload', () => {
      setTileError(false);
      fallbackErrCountRef.current = 0;
    });
    primaryTiles.on('tileerror', () => {
      if (!fallbackSwitchedRef.current) {
        fallbackSwitchedRef.current = true;
        primaryTiles.setUrl('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png');
        return;
      }
      fallbackErrCountRef.current += 1;
      if (fallbackErrCountRef.current >= 3) {
        setTilesLoading(false);
        setTileError(true);
      }
    });

    primaryTiles.addTo(map);
    tileLayerRef.current = primaryTiles;

    L.control.zoom({ position: 'topright' }).addTo(map);

    map.on('mousemove', (e: L.LeafletMouseEvent) => {
      setMouseCoords({ lat: Number(e.latlng.lat.toFixed(5)), lng: Number(e.latlng.lng.toFixed(5)) });
    });

    const layerGroup = L.layerGroup().addTo(map);
    layersGroupRef.current = layerGroup;
    mapInstanceRef.current = map;

    return () => {
      map.remove();
      mapInstanceRef.current = null;
      tileLayerRef.current = null;
      layersGroupRef.current = null;
    };
  }, []);

  const handleRetryTiles = useCallback(() => {
    const tiles = tileLayerRef.current;
    if (!tiles) return;
    fallbackSwitchedRef.current = false;
    fallbackErrCountRef.current = 0;
    setTileError(false);
    setTilesLoading(true);
    tiles.setUrl('/api/v1/map/tiles/{z}/{x}/{y}.png');
    tiles.redraw();
  }, []);

  // Render layers onto the map whenever data or toggles change
  useEffect(() => {
    const map = mapInstanceRef.current;
    const group = layersGroupRef.current;
    if (!map || !group) return;

    group.clearLayers();

    // 1. Render Map Cells (Towers and Sectors)
    if (showMapCells && spatialData.mapCells) {
      spatialData.mapCells.forEach(cell => {
        if (!cell.lat || !cell.lng) return;

        const marker = L.circleMarker([cell.lat, cell.lng], {
          radius: 7,
          fillColor: '#3b82f6',
          color: '#ffffff',
          weight: 1.5,
          opacity: 1,
          fillOpacity: 0.85,
        });

        marker.bindPopup(`
          <div style="font-family: sans-serif; font-size: 12px;">
            <strong style="color: #1e293b; font-size: 13px;">${cell.contents || 'Map Cell'}</strong><br/>
            <b>MCC/MNC:</b> ${cell.mcc || '-'}/${cell.mnc || '-'}<br/>
            <b>LAC/CID:</b> ${cell.lac || '-'}/${cell.cid || '-'}<br/>
            <b>Direction:</b> ${cell.direction ? cell.direction + '°' : 'Omni'}<br/>
            <b>Radius:</b> ${cell.radius ? cell.radius + 'm' : 'Auto'}<br/>
            <b>Address:</b> ${cell.address || '-'}<br/>
            <small style="color: #64748b;">${cell.lat.toFixed(5)}, ${cell.lng.toFixed(5)}</small>
          </div>
        `);
        group.addLayer(marker);

        if (cell.radius && cell.direction !== null && cell.direction !== undefined) {
          const dir = cell.direction;
          const open = cell.openingAngle || 65;
          const startAngle = (dir - open / 2) * (Math.PI / 180);
          const endAngle = (dir + open / 2) * (Math.PI / 180);
          const r = cell.radius / 111300;

          const p1: [number, number] = [cell.lat, cell.lng];
          const p2: [number, number] = [cell.lat + r * Math.cos(startAngle), cell.lng + r * Math.sin(startAngle)];
          const p3: [number, number] = [cell.lat + r * Math.cos(endAngle), cell.lng + r * Math.sin(endAngle)];

          const polygon = L.polygon([p1, p2, p3], {
            color: '#3b82f6',
            fillColor: '#3b82f6',
            fillOpacity: 0.15,
            weight: 1,
          });
          group.addLayer(polygon);
        }
      });
    }

    // 2. Render Active Network Cells
    if (showNetCells && spatialData.netCells) {
      spatialData.netCells.forEach(nc => {
        if (!nc.latitude || !nc.longitude) return;

        const ratColor = nc.rat === 'LTE' ? '#6366f1' : nc.rat === 'UMTS' ? '#f59e0b' : '#10b981';

        const marker = L.circleMarker([nc.latitude, nc.longitude], {
          radius: 8,
          fillColor: ratColor,
          color: '#ffffff',
          weight: 2,
          opacity: 1,
          fillOpacity: 0.9,
        });

        marker.bindPopup(`
          <div style="font-family: sans-serif; font-size: 12px;">
            <strong style="color: ${ratColor}; font-size: 13px;">${nc.rat || 'Cell'} [ID: ${nc.cell_id}]</strong><br/>
            <b>Mission:</b> ${nc.mission}<br/>
            <b>Rx Level:</b> ${nc.rx_lev_dbm ? nc.rx_lev_dbm + ' dBm' : nc.rx_lev}<br/>
            <b>Bandwidth:</b> ${nc.dl_bandwidth || '-'} MHz<br/>
            <b>PCI/BSIC:</b> ${nc.pci ?? '-'}/${nc.bsic ?? '-'}<br/>
            <small style="color: #64748b;">${nc.latitude.toFixed(5)}, ${nc.longitude.toFixed(5)}</small>
          </div>
        `);
        group.addLayer(marker);
      });
    }

    // 3. Render GPS Trajectory Tracks
    if (showGpsTrack && spatialData.gpsPoints && spatialData.gpsPoints.length > 0) {
      const latlngs: [number, number][] = spatialData.gpsPoints.map(p => [p.latitude, p.longitude]);

      const polyline = L.polyline(latlngs, {
        color: '#ef4444',
        weight: 3,
        opacity: 0.85,
        dashArray: '6, 6',
      });
      group.addLayer(polyline);

      if (latlngs.length > 0) {
        const start = latlngs[0];
        const end = latlngs[latlngs.length - 1];

        const startMarker = L.circleMarker(start, {
          radius: 6,
          fillColor: '#10b981',
          color: '#ffffff',
          weight: 2,
          fillOpacity: 1,
        }).bindPopup('<b>Track Start Point</b>');
        group.addLayer(startMarker);

        const endMarker = L.circleMarker(end, {
          radius: 6,
          fillColor: '#ef4444',
          color: '#ffffff',
          weight: 2,
          fillOpacity: 1,
        }).bindPopup('<b>Latest GPS Position</b>');
        group.addLayer(endMarker);
      }
    }

    // 4. Render User Tactical Markers
    if (showMarkers && spatialData.markers) {
      spatialData.markers.forEach(m => {
        if (!m.latitude || !m.longitude) return;
        const marker = L.circleMarker([m.latitude, m.longitude], {
          radius: 9,
          fillColor: m.color || '#ec4899',
          color: '#ffffff',
          weight: 2,
          fillOpacity: 0.95,
        });
        marker.bindPopup(`
          <div style="font-family: sans-serif; font-size: 12px;">
            <strong style="color: ${m.color || '#ec4899'}; font-size: 13px;">${m.type || 'Marker'}</strong><br/>
            <p style="margin: 4px 0;">${m.description || 'No description'}</p>
            <b>Mission:</b> ${m.mission}<br/>
            <small style="color: #64748b;">${m.latitude.toFixed(5)}, ${m.longitude.toFixed(5)}</small>
          </div>
        `);
        group.addLayer(marker);
      });
    }

    // 5. Render User Polygons
    if (showPolygons && spatialData.polygons) {
      spatialData.polygons.forEach(poly => {
        try {
          const points = typeof poly.points === 'string' ? JSON.parse(poly.points) : poly.points;
          if (Array.isArray(points) && points.length >= 3) {
            const polygon = L.polygon(points, {
              color: poly.color || '#8b5cf6',
              fillColor: poly.color || '#8b5cf6',
              fillOpacity: 0.25,
              weight: 2,
            });
            polygon.bindPopup(`
              <div style="font-family: sans-serif; font-size: 12px;">
                <strong style="color: ${poly.color || '#8b5cf6'}; font-size: 13px;">${poly.label}</strong><br/>
                <p style="margin: 4px 0;">${poly.description || ''}</p>
                <b>Mission:</b> ${poly.mission}
              </div>
            `);
            group.addLayer(polygon);
          }
        } catch {
          console.error('Invalid polygon points JSON:', poly.points);
        }
      });
    }

    // 6. Render User Circles
    if (showCircles && spatialData.circles) {
      spatialData.circles.forEach(c => {
        if (!c.lat || !c.lng || !c.radius) return;
        const circle = L.circle([c.lat, c.lng], {
          radius: c.radius,
          color: c.color || '#10b981',
          fillColor: c.color || '#10b981',
          fillOpacity: 0.18,
          weight: 2,
        });
        circle.bindPopup(`
          <div style="font-family: sans-serif; font-size: 12px;">
            <strong style="color: ${c.color || '#10b981'}; font-size: 13px;">${c.label}</strong><br/>
            <b>Radius:</b> ${c.radius} meters<br/>
            <p style="margin: 4px 0;">${c.description || ''}</p>
            <b>Mission:</b> ${c.mission}
          </div>
        `);
        group.addLayer(circle);
      });
    }
  }, [
    showMapCells,
    showNetCells,
    showGpsTrack,
    showMarkers,
    showPolygons,
    showCircles,
    spatialData,
  ]);

  // Coordinate Parser Test Execution
  const handleTestParse = () => {
    if (!coordInput.trim()) {
      setParsedCoord(null);
      return;
    }

    const str = coordInput.trim();
    let lat: number | null = null;
    let lng: number | null = null;

    const wktMatch = str.match(/POINT\s*\(\s*([-\d.]+)\s+([-\d.]+)\s*\)/i);
    if (wktMatch) {
      lng = parseFloat(wktMatch[1]);
      lat = parseFloat(wktMatch[2]);
    } else {
      let parts: string[] = [];
      if (str.includes(';')) parts = str.split(';');
      else if (str.includes(',')) parts = str.split(',');
      else parts = str.split(/\s+/);

      if (parts.length >= 2) {
        const n1 = parseFloat(parts[0].trim());
        const n2 = parseFloat(parts[1].trim());
        if (!isNaN(n1) && !isNaN(n2)) {
          if (coordOrder === 'LAT_LNG') {
            lat = n1;
            lng = n2;
          } else {
            lng = n1;
            lat = n2;
          }
        }
      }
    }

    if (lat === null || lng === null || isNaN(lat) || isNaN(lng)) {
      setParsedCoord({ lat: null, lng: null, isValid: false, error: 'Could not parse numbers from input' });
      return;
    }

    if (lat < -90 || lat > 90) {
      setParsedCoord({ lat, lng, isValid: false, error: `Latitude ${lat} out of range [-90, 90]` });
      return;
    }
    if (lng < -180 || lng > 180) {
      setParsedCoord({ lat, lng, isValid: false, error: `Longitude ${lng} out of range [-180, 180]` });
      return;
    }

    setParsedCoord({ lat, lng, isValid: true });

    if (mapInstanceRef.current) {
      mapInstanceRef.current.flyTo([lat, lng], 15);
      L.marker([lat, lng])
        .addTo(mapInstanceRef.current)
        .bindPopup(`<b>Parsed Test Target</b><br/>Lat: ${lat}<br/>Lng: ${lng}`)
        .openPopup();
    }
  };

  const toggleFullscreen = () => {
    setIsFullscreen(prev => !prev);
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        mapInstanceRef.current?.invalidateSize();
      });
    });
  };

  const handleExportGeoJson = async () => {
    setExportingGeo(true);
    setExportError(null);
    try {
      const qs = activeMission !== 'ALL' ? `&mission=${encodeURIComponent(activeMission)}` : '';
      const res = await apiFetch(`/api/v1/exports/download?table=network_cells&format=geojson${qs}`);
      if (!res.ok) {
        const json = await res.json().catch(() => null);
        throw new Error(json?.error || `Export failed (${res.status})`);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'network_cells.geojson';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err: any) {
      setExportError(err?.message || 'Failed to export GeoJSON');
    } finally {
      setExportingGeo(false);
    }
  };

  return (
    <div className={`space-y-4 ${isFullscreen ? 'fixed inset-0 z-50 p-4 bg-slate-950 overflow-hidden' : ''}`}>
      {/* Top Header Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-slate-900/90 p-3 rounded-xl border border-slate-800">
        <div>
          <h1 className="text-lg font-bold text-slate-100 flex items-center gap-2 flex-wrap">
            <MapPin className="w-5 h-5 text-indigo-400" />
            <span>{t('mapTitle')}</span>
            {spatialRes.isRefreshing && <RefreshingBadge label={t('loadingMapData')} />}
          </h1>
          <p className="text-xs text-slate-400 mt-0.5">{t('mapSubtitle')}</p>
        </div>

        {/* Right buttons: Refresh, GeoJSON Export, Fullscreen */}
        <div className="flex items-center gap-2 flex-wrap">
          <button
            type="button"
            disabled={spatialRes.isLoading || spatialRes.isRefreshing}
            onClick={() => spatialRes.reload({ force: true })}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${spatialRes.isLoading || spatialRes.isRefreshing ? 'animate-spin' : ''}`} />
            <span>{t('refresh')}</span>
          </button>

          <button
            type="button"
            disabled={exportingGeo}
            onClick={handleExportGeoJson}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition-colors disabled:opacity-50"
          >
            {exportingGeo ? (
              <RefreshCw className="w-3.5 h-3.5 animate-spin text-indigo-400" />
            ) : (
              <Download className="w-3.5 h-3.5 text-indigo-400" />
            )}
            <span>{exportingGeo ? t('loading') : 'Export GeoJSON'}</span>
          </button>

          <button
            type="button"
            onClick={toggleFullscreen}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white shadow-sm shadow-indigo-600/30 transition-colors"
          >
            {isFullscreen ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
            <span>{isFullscreen ? (isAr ? 'إنهاء ملء الشاشة' : 'Exit Fullscreen') : (isAr ? 'ملء الشاشة' : 'Fullscreen')}</span>
          </button>
        </div>
      </div>

      {exportError && (
        <ErrorRetryCard compact message={exportError} onRetry={handleExportGeoJson} />
      )}

      {/* Main Map + Side Panel Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
        {/* Map View Canvas (col-span-3) */}
        <div className="lg:col-span-3 relative h-[580px] rounded-2xl overflow-hidden border border-slate-800 shadow-xl bg-slate-950">
          <div ref={mapContainerRef} className="w-full h-full" />

          <MapStatusOverlay
            dataLoading={spatialRes.isLoading}
            dataRefreshing={spatialRes.isRefreshing}
            dataError={spatialRes.isError && !spatialRes.data ? spatialRes.error : null}
            onRetryData={() => spatialRes.reload({ force: true })}
            isEmpty={spatialRes.isEmpty}
            tilesLoading={tilesLoading}
            tileError={tileError}
            onRetryTiles={handleRetryTiles}
          />

          {/* Floating Coordinate Bar (Bottom Left) */}
          <div className="absolute bottom-3 left-3 rtl:right-3 rtl:left-auto z-[420] px-3 py-1.5 rounded-lg bg-slate-950/85 backdrop-blur border border-slate-800 text-[11px] font-mono text-slate-300 flex items-center gap-3 shadow-lg">
            <div className="flex items-center gap-1 text-indigo-400">
              <Compass className="w-3.5 h-3.5" />
              <span>CURSOR:</span>
            </div>
            {mouseCoords ? (
              <span className="tabular-nums">
                Lat: <strong>{mouseCoords.lat}</strong>, Lng: <strong>{mouseCoords.lng}</strong>
              </span>
            ) : (
              <span className="text-slate-500">Hover over map</span>
            )}
          </div>

          {/* Floating Legend (Bottom Right) */}
          <div className="absolute bottom-3 right-3 rtl:left-3 rtl:right-auto z-[420] hidden sm:flex items-center gap-3 px-3 py-1.5 rounded-lg bg-slate-950/85 backdrop-blur border border-slate-800 text-[10px] text-slate-400 shadow-lg">
            <span className="flex items-center gap-1">
              <span className="w-2.5 h-2.5 rounded-full bg-blue-500" /> Map Cells
            </span>
            <span className="flex items-center gap-1">
              <span className="w-2.5 h-2.5 rounded-full bg-indigo-500" /> LTE
            </span>
            <span className="flex items-center gap-1">
              <span className="w-2.5 h-2.5 rounded-full bg-amber-500" /> UMTS
            </span>
            <span className="flex items-center gap-1">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-500" /> GSM
            </span>
            <span className="flex items-center gap-1">
              <span className="w-2 h-0.5 bg-rose-500" /> GPS Track
            </span>
          </div>
        </div>

        {/* Right Sidebar: Layer Controls & Coordinate Parser */}
        <div className="space-y-4">
          {/* Layer Visibility Box */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 shadow-sm space-y-3">
            <h2 className="text-xs font-bold text-slate-200 uppercase tracking-wider flex items-center gap-2">
              <Layers className="w-4 h-4 text-indigo-400" />
              <span>{t('layers')}</span>
            </h2>

            <div className="space-y-2 text-xs text-slate-300">
              <label className="flex items-center justify-between p-2 rounded-lg bg-slate-950/60 border border-slate-800 hover:bg-slate-800/40 cursor-pointer">
                <span className="flex items-center gap-2">
                  <Radio className="w-3.5 h-3.5 text-blue-400" />
                  <span>{t('layerMapCells')}</span>
                </span>
                <input
                  type="checkbox"
                  checked={showMapCells}
                  onChange={e => setShowMapCells(e.target.checked)}
                  className="rounded bg-slate-900 border-slate-700 text-indigo-600"
                />
              </label>

              <label className="flex items-center justify-between p-2 rounded-lg bg-slate-950/60 border border-slate-800 hover:bg-slate-800/40 cursor-pointer">
                <span className="flex items-center gap-2">
                  <Radio className="w-3.5 h-3.5 text-indigo-400" />
                  <span>{t('layerNetworkCells')}</span>
                </span>
                <input
                  type="checkbox"
                  checked={showNetCells}
                  onChange={e => setShowNetCells(e.target.checked)}
                  className="rounded bg-slate-900 border-slate-700 text-indigo-600"
                />
              </label>

              <label className="flex items-center justify-between p-2 rounded-lg bg-slate-950/60 border border-slate-800 hover:bg-slate-800/40 cursor-pointer">
                <span className="flex items-center gap-2">
                  <Navigation className="w-3.5 h-3.5 text-rose-400" />
                  <span>{t('layerGpsTrack')}</span>
                </span>
                <input
                  type="checkbox"
                  checked={showGpsTrack}
                  onChange={e => setShowGpsTrack(e.target.checked)}
                  className="rounded bg-slate-900 border-slate-700 text-indigo-600"
                />
              </label>

              <label className="flex items-center justify-between p-2 rounded-lg bg-slate-950/60 border border-slate-800 hover:bg-slate-800/40 cursor-pointer">
                <span className="flex items-center gap-2">
                  <MapPin className="w-3.5 h-3.5 text-pink-400" />
                  <span>{t('layerMarkers')}</span>
                </span>
                <input
                  type="checkbox"
                  checked={showMarkers}
                  onChange={e => setShowMarkers(e.target.checked)}
                  className="rounded bg-slate-900 border-slate-700 text-indigo-600"
                />
              </label>

              <label className="flex items-center justify-between p-2 rounded-lg bg-slate-950/60 border border-slate-800 hover:bg-slate-800/40 cursor-pointer">
                <span className="flex items-center gap-2">
                  <Shapes className="w-3.5 h-3.5 text-purple-400" />
                  <span>{t('layerPolygons')}</span>
                </span>
                <input
                  type="checkbox"
                  checked={showPolygons}
                  onChange={e => setShowPolygons(e.target.checked)}
                  className="rounded bg-slate-900 border-slate-700 text-indigo-600"
                />
              </label>

              <label className="flex items-center justify-between p-2 rounded-lg bg-slate-950/60 border border-slate-800 hover:bg-slate-800/40 cursor-pointer">
                <span className="flex items-center gap-2">
                  <CircleIcon className="w-3.5 h-3.5 text-emerald-400" />
                  <span>{t('layerCircles')}</span>
                </span>
                <input
                  type="checkbox"
                  checked={showCircles}
                  onChange={e => setShowCircles(e.target.checked)}
                  className="rounded bg-slate-900 border-slate-700 text-indigo-600"
                />
              </label>
            </div>
          </div>

          {/* Coordinate Parser & Inspector Box */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 shadow-sm space-y-3">
            <h2 className="text-xs font-bold text-slate-200 uppercase tracking-wider flex items-center gap-2">
              <Compass className="w-4 h-4 text-indigo-400" />
              <span>{t('coordinateParserTitle')}</span>
            </h2>

            <p className="text-[11px] text-slate-400 leading-relaxed">
              Parse semicolon <code>;</code>, comma <code>,</code>, WKT Point, or GeoJSON coordinates with strict validation.
            </p>

            <div className="space-y-2">
              <input
                type="text"
                value={coordInput}
                onChange={e => setCoordInput(e.target.value)}
                placeholder="e.g. 30.0444;31.2357 or POINT(31.23 30.04)"
                className="w-full h-8 px-2.5 text-xs bg-slate-950 border border-slate-800 rounded-lg text-slate-200 placeholder-slate-600 focus:outline-none focus:border-indigo-500 font-mono"
              />

              <div className="space-y-1">
                <label className="text-[10px] text-slate-400 font-semibold uppercase">Coordinate Order</label>
                <select
                  value={coordOrder}
                  onChange={e => setCoordOrder(e.target.value as any)}
                  className="w-full h-8 px-2 text-xs bg-slate-950 border border-slate-800 rounded-lg text-slate-200 focus:outline-none focus:border-indigo-500"
                >
                  <option value="LAT_LNG">{t('orderLatLng')}</option>
                  <option value="LNG_LAT">{t('orderLngLat')}</option>
                </select>
              </div>

              <button
                type="button"
                onClick={handleTestParse}
                className="w-full py-2 text-xs font-semibold rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white transition-colors"
              >
                Validate &amp; Locate on Map
              </button>

              {parsedCoord && (
                <div
                  className={`p-2.5 rounded-lg border text-xs space-y-1 ${
                    parsedCoord.isValid
                      ? 'bg-emerald-950/40 border-emerald-800 text-emerald-300'
                      : 'bg-rose-950/40 border-rose-800 text-rose-300'
                  }`}
                >
                  <div className="flex items-center gap-1.5 font-bold">
                    {parsedCoord.isValid ? (
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                    ) : (
                      <AlertTriangle className="w-3.5 h-3.5 text-rose-400" />
                    )}
                    <span>{parsedCoord.isValid ? 'Valid Coordinates' : 'Invalid Coordinates'}</span>
                  </div>
                  {parsedCoord.isValid ? (
                    <div className="font-mono text-[11px]">
                      <div>Lat: {parsedCoord.lat}</div>
                      <div>Lng: {parsedCoord.lng}</div>
                    </div>
                  ) : (
                    <div className="text-[11px] text-rose-400">{parsedCoord.error}</div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
