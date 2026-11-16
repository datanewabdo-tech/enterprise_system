export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function downloadDataUrl(dataUrl: string, filename: string) {
  const a = document.createElement('a');
  a.href = dataUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

function findChartSvg(containerEl: HTMLElement | null): SVGSVGElement | null {
  if (!containerEl) return null;
  const svgs = Array.from(containerEl.querySelectorAll('svg'));
  // Pick the primary Recharts surface SVG (largest area)
  let best: SVGSVGElement | null = null;
  let bestArea = 0;
  for (const svg of svgs) {
    const rect = svg.getBoundingClientRect();
    const area = rect.width * rect.height;
    if (area > bestArea) {
      bestArea = area;
      best = svg;
    }
  }
  return best || svgs[0] || null;
}

export function exportRechartsSvg(
  containerEl: HTMLElement | null,
  filename: string,
  title?: string
): boolean {
  const svg = findChartSvg(containerEl);
  if (!svg) return false;

  const rect = svg.getBoundingClientRect();
  const width = Math.max(520, Math.round(rect.width || 640));
  const height = Math.max(260, Math.round(rect.height || 300));
  const titleOffset = title ? 36 : 0;

  const wrapper = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  wrapper.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  wrapper.setAttribute('width', String(width));
  wrapper.setAttribute('height', String(height + titleOffset));
  wrapper.setAttribute('viewBox', `0 0 ${width} ${height + titleOffset}`);

  const bg = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
  bg.setAttribute('x', '0');
  bg.setAttribute('y', '0');
  bg.setAttribute('width', String(width));
  bg.setAttribute('height', String(height + titleOffset));
  bg.setAttribute('fill', '#0f172a');
  wrapper.appendChild(bg);

  if (title) {
    const textEl = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    textEl.setAttribute('x', '16');
    textEl.setAttribute('y', '24');
    textEl.setAttribute('fill', '#f8fafc');
    textEl.setAttribute('font-family', 'system-ui, sans-serif');
    textEl.setAttribute('font-size', '14');
    textEl.setAttribute('font-weight', 'bold');
    textEl.textContent = title;
    wrapper.appendChild(textEl);
  }

  const clone = svg.cloneNode(true) as SVGSVGElement;
  clone.setAttribute('x', '0');
  clone.setAttribute('y', String(titleOffset));
  clone.setAttribute('width', String(width));
  clone.setAttribute('height', String(height));
  clone.querySelectorAll('.recharts-tooltip-wrapper').forEach(el => el.remove());
  wrapper.appendChild(clone);

  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n${new XMLSerializer().serializeToString(wrapper)}`;
  const blob = new Blob([xml], { type: 'image/svg+xml;charset=utf-8' });
  downloadBlob(blob, filename);
  return true;
}

export async function renderChartPngDataUrl(
  containerEl: HTMLElement | null,
  options: { title?: string; subtitle?: string; isRtl?: boolean } = {}
): Promise<string | null> {
  const svg = findChartSvg(containerEl);
  if (!svg) return null;

  try {
    const rect = svg.getBoundingClientRect();
    const chartW = Math.max(540, Math.round(rect.width || 640));
    const chartH = Math.max(240, Math.round(rect.height || 280));
    const headerH = options.title ? (options.subtitle ? 58 : 40) : 0;
    const totalH = chartH + headerH + 12;

    const clone = svg.cloneNode(true) as SVGSVGElement;
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    clone.setAttribute('width', String(chartW));
    clone.setAttribute('height', String(chartH));
    clone.querySelectorAll('.recharts-tooltip-wrapper').forEach(el => el.remove());

    const xml = new XMLSerializer().serializeToString(clone);
    const svgBlob = new Blob([xml], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(svgBlob);

    const dataUrl = await new Promise<string | null>(resolve => {
      const img = new Image();
      img.onload = () => {
        const scale = 2;
        const canvas = document.createElement('canvas');
        canvas.width = chartW * scale;
        canvas.height = totalH * scale;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          URL.revokeObjectURL(url);
          resolve(null);
          return;
        }
        ctx.fillStyle = '#0f172a';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.scale(scale, scale);

        if (options.title) {
          ctx.fillStyle = '#1e293b';
          ctx.fillRect(0, 0, chartW, headerH);
          ctx.fillStyle = '#f8fafc';
          ctx.font = 'bold 14px system-ui, "Noto Sans Arabic", sans-serif';
          ctx.textAlign = options.isRtl ? 'right' : 'left';
          const tx = options.isRtl ? chartW - 16 : 16;
          ctx.fillText(options.title, tx, 22);

          if (options.subtitle) {
            ctx.fillStyle = '#94a3b8';
            ctx.font = '11px system-ui, "Noto Sans Arabic", sans-serif';
            ctx.fillText(options.subtitle, tx, 42);
          }
        }

        ctx.drawImage(img, 0, headerH + 4, chartW, chartH);
        URL.revokeObjectURL(url);
        resolve(canvas.toDataURL('image/png'));
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        resolve(null);
      };
      img.src = url;
    });

    return dataUrl;
  } catch {
    return null;
  }
}
