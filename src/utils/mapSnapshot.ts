import type L from 'leaflet';

export interface MapSnapshotLocation {
  lat: number;
  lng: number;
  source: 'registration' | 'network_cell' | 'both';
  totalCount: number;
}

export async function captureLeafletMapPng(
  mapContainerEl: HTMLElement | null,
  mapInstance: L.Map | null,
  options: {
    title: string;
    subtitle?: string;
    locations: MapSnapshotLocation[];
    showRegistrations: boolean;
    showNetworkCells: boolean;
    isRtl?: boolean;
  }
): Promise<string | null> {
  if (!mapContainerEl || !mapInstance) return null;

  const rect = mapContainerEl.getBoundingClientRect();
  const width = Math.max(640, Math.round(rect.width || 900));
  const height = Math.max(360, Math.round(rect.height || 420));
  const headerH = 54;
  const footerH = 32;
  const totalH = headerH + height + footerH;

  const scale = 2;
  const canvas = document.createElement('canvas');
  canvas.width = width * scale;
  canvas.height = totalH * scale;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  ctx.scale(scale, scale);

  // Background
  ctx.fillStyle = '#020617';
  ctx.fillRect(0, 0, width, totalH);

  // Header bar
  ctx.fillStyle = '#0f172a';
  ctx.fillRect(0, 0, width, headerH);
  ctx.fillStyle = '#f8fafc';
  ctx.font = 'bold 14px system-ui, "Noto Sans Arabic", sans-serif';
  ctx.textAlign = options.isRtl ? 'right' : 'left';
  const tx = options.isRtl ? width - 16 : 16;
  ctx.fillText(options.title, tx, 22);

  if (options.subtitle) {
    ctx.fillStyle = '#94a3b8';
    ctx.font = '11px system-ui, "Noto Sans Arabic", sans-serif';
    ctx.fillText(options.subtitle, tx, 40);
  }

  // Clip map viewport area
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, headerH, width, height);
  ctx.clip();

  // Draw base map tiles from same-origin tile proxy (untainted)
  ctx.fillStyle = '#0f172a';
  ctx.fillRect(0, headerH, width, height);

  const tileImgs = Array.from(mapContainerEl.querySelectorAll('.leaflet-tile-pane img')) as HTMLImageElement[];
  let tilesDrawn = 0;
  for (const img of tileImgs) {
    if (!img.complete || img.naturalWidth === 0) continue;
    const tileRect = img.getBoundingClientRect();
    const dx = tileRect.left - rect.left;
    const dy = tileRect.top - rect.top + headerH;
    const dw = tileRect.width || 256;
    const dh = tileRect.height || 256;
    try {
      ctx.drawImage(img, dx, dy, dw, dh);
      tilesDrawn++;
    } catch {
      // Skip any external cross-origin tile safely without aborting snapshot
    }
  }

  // If no tiles loaded yet, draw subtle coordinate graticule background
  if (tilesDrawn === 0) {
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.14)';
    ctx.lineWidth = 1;
    for (let gx = 0; gx < width; gx += 64) {
      ctx.beginPath();
      ctx.moveTo(gx, headerH);
      ctx.lineTo(gx, headerH + height);
      ctx.stroke();
    }
    for (let gy = headerH; gy < headerH + height; gy += 64) {
      ctx.beginPath();
      ctx.moveTo(0, gy);
      ctx.lineTo(width, gy);
      ctx.stroke();
    }
  }

  // Draw any Leaflet overlay canvas (e.g. heatmap layer)
  const overlayCanvases = Array.from(mapContainerEl.querySelectorAll('.leaflet-overlay-pane canvas')) as HTMLCanvasElement[];
  for (const ov of overlayCanvases) {
    if (ov.width === 0 || ov.height === 0) continue;
    const ovRect = ov.getBoundingClientRect();
    const dx = ovRect.left - rect.left;
    const dy = ovRect.top - rect.top + headerH;
    try {
      ctx.drawImage(ov, dx, dy, ovRect.width || width, ovRect.height || height);
    } catch {
      // ignore
    }
  }

  // Plot markers accurately using Leaflet projection
  const visibleLocs = options.locations.filter(loc => {
    if (loc.source === 'registration') return options.showRegistrations;
    if (loc.source === 'network_cell') return options.showNetworkCells;
    return options.showRegistrations || options.showNetworkCells;
  });

  for (const loc of visibleLocs) {
    const pt = mapInstance.latLngToContainerPoint([loc.lat, loc.lng]);
    if (pt.x < -20 || pt.x > width + 20 || pt.y < -20 || pt.y > height + 20) continue;

    const color =
      loc.source === 'both' ? '#f59e0b' : loc.source === 'registration' ? '#10b981' : '#3b82f6';
    const radius = Math.min(13, 6 + Math.log2(loc.totalCount + 1) * 1.6);

    ctx.beginPath();
    ctx.arc(pt.x, headerH + pt.y, radius, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.globalAlpha = 0.92;
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = '#ffffff';
    ctx.stroke();

    if (loc.totalCount > 1) {
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 9px monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(loc.totalCount), pt.x, headerH + pt.y);
    }
  }
  ctx.restore();

  // Footer Legend + CRS + Attribution bar
  const footerY = headerH + height;
  ctx.fillStyle = '#0f172a';
  ctx.fillRect(0, footerY, width, footerH);

  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  const items = [
    { color: '#10b981', label: options.isRtl ? 'أبراج التسجيلات' : 'Registration BTS' },
    { color: '#3b82f6', label: options.isRtl ? 'خلايا الشبكة' : 'NetworkCell' },
    { color: '#f59e0b', label: options.isRtl ? 'مشترك' : 'Shared' },
  ];
  let lx = 14;
  for (const it of items) {
    ctx.beginPath();
    ctx.arc(lx + 4, footerY + footerH / 2, 4.5, 0, Math.PI * 2);
    ctx.fillStyle = it.color;
    ctx.fill();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = '#cbd5e1';
    ctx.font = '10px system-ui, "Noto Sans Arabic", sans-serif';
    ctx.fillText(it.label, lx + 13, footerY + footerH / 2);
    lx += ctx.measureText(it.label).width + 28;
  }

  // CRS + Attribution on right side of footer
  ctx.fillStyle = '#94a3b8';
  ctx.font = '10px system-ui, sans-serif';
  ctx.textAlign = 'right';
  ctx.fillText('WGS84 / EPSG:4326  |  © OpenStreetMap contributors', width - 14, footerY + footerH / 2);

  try {
    return canvas.toDataURL('image/png');
  } catch {
    return null;
  }
}
