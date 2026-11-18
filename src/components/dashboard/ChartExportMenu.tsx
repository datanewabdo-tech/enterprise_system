import React, { useState, useRef, useEffect } from 'react';
import { useApp } from '../../context/AppContext.js';
import { DashboardFilterState } from '../../types/index.js';
import { exportRechartsSvg, renderChartPngDataUrl, downloadBlob, downloadDataUrl } from '../../utils/chartExporter.js';
import {
  Download,
  Image as ImageIcon,
  FileCode2,
  FileText,
  FileSpreadsheet,
  Table2,
  Globe,
  RefreshCw,
  ChevronDown,
  Lock,
} from 'lucide-react';

export type ChartExportTargetId =
  | 'registrationsByCountry'
  | 'networkCellsByMcc'
  | 'militaryNetworks'
  | 'civilianNetworks'
  | 'mobileNetworksMccMnc'
  | 'btsMap';

interface ChartExportMenuProps {
  chartId: ChartExportTargetId;
  title: string;
  subtitle?: string;
  filters: Partial<DashboardFilterState>;
  svgContainerRef?: React.RefObject<HTMLDivElement | null>;
  getPngSnapshot?: () => Promise<string | null>;
}

export const ChartExportMenu: React.FC<ChartExportMenuProps> = ({
  chartId,
  title,
  subtitle,
  filters,
  svgContainerRef,
  getPngSnapshot,
}) => {
  const { apiFetch, currentUser, language, t, addNotification } = useApp();
  const [open, setOpen] = useState(false);
  const [exportingFormat, setExportingFormat] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const canExport = currentUser?.role !== 'VIEWER';
  const isMap = chartId === 'btsMap';

  useEffect(() => {
    const handleOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    if (open) document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, [open]);

  const cleanFilterPayload = () => ({
    ...filters,
    imsi: filters.imsi || undefined,
    imei: filters.imei || undefined,
    tmsi: filters.tmsi || undefined,
    btsName: filters.btsName || undefined,
    bts: filters.bts || undefined,
    lastSeenFrom: filters.lastSeenFrom || undefined,
    lastSeenTo: filters.lastSeenTo || undefined,
    lac: filters.lac || undefined,
    cellId: filters.cellId || undefined,
    channel: filters.channel || undefined,
    bsic: filters.bsic || undefined,
    pci: filters.pci || undefined,
    plmnQuery: filters.plmnQuery || undefined,
    operator: filters.operator || undefined,
    networkCategory: filters.networkCategory || undefined,
  });

  const capturePng = async (): Promise<string | null> => {
    if (getPngSnapshot) {
      return getPngSnapshot();
    }
    if (svgContainerRef?.current) {
      return renderChartPngDataUrl(svgContainerRef.current, {
        title,
        subtitle,
        isRtl: language === 'ar',
      });
    }
    return null;
  };

  const handleExport = async (fmt: 'png' | 'svg' | 'pdf' | 'csv' | 'xlsx' | 'geojson') => {
    if (!canExport) {
      addNotification({
        title: t('exportDeniedTitle'),
        message: t('exportDeniedMsg'),
        type: 'warning',
      });
      return;
    }

    setOpen(false);
    setExportingFormat(fmt);

    try {
      const baseFilename = `${chartId}_${language}_${new Date().toISOString().slice(0, 10)}`;

      if (fmt === 'svg') {
        const ok = exportRechartsSvg(svgContainerRef?.current || null, `${baseFilename}.svg`, title);
        if (!ok) {
          throw new Error(language === 'ar' ? 'لا يوجد مخطط متاح للتصدير بصيغة SVG' : 'No rendered chart SVG available to export');
        }
        addNotification({
          title: t('exportReady'),
          message: `${baseFilename}.svg`,
          type: 'success',
        });
        return;
      }

      let chartImage: string | undefined;
      if (fmt === 'png' || fmt === 'pdf') {
        const snap = await capturePng();
        if (snap) chartImage = snap;
        if (fmt === 'png' && !snap) {
          throw new Error(language === 'ar' ? 'تعذر التقاط صورة المخطط' : 'Could not render visualization snapshot for PNG export');
        }
      }

      if (fmt === 'png' && chartImage) {
        downloadDataUrl(chartImage, `${baseFilename}.png`);
      }

      // Send PNG snapshot for server audit/history or PDF/CSV/XLSX/GeoJSON generation
      const res = await apiFetch('/api/v1/exports/chart', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chartId,
          format: fmt,
          language,
          filters: cleanFilterPayload(),
          chartImage,
        }),
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({ error: 'Export request failed' }));
        throw new Error(errJson.error || 'Export request failed');
      }

      if (fmt !== 'png') {
        const blob = await res.blob();
        const serverName = res.headers.get('X-Export-Filename') || `${baseFilename}.${fmt}`;
        downloadBlob(blob, serverName);
      }

      addNotification({
        title: t('exportReady'),
        message: `${title} (${fmt.toUpperCase()})`,
        type: 'success',
      });
    } catch (err: any) {
      addNotification({
        title: t('exportFailed'),
        message: err.message || 'Export error',
        type: 'error',
      });
    } finally {
      setExportingFormat(null);
    }
  };

  const options = isMap
    ? [
        { id: 'png', label: t('exportPng'), icon: ImageIcon, color: 'text-sky-400' },
        { id: 'pdf', label: t('exportPdf'), icon: FileText, color: 'text-rose-400' },
        { id: 'csv', label: t('exportCsv'), icon: Table2, color: 'text-emerald-400' },
        { id: 'geojson', label: t('exportGeoJson'), icon: Globe, color: 'text-amber-400' },
      ]
    : [
        { id: 'png', label: t('exportPng'), icon: ImageIcon, color: 'text-sky-400' },
        { id: 'svg', label: t('exportSvg'), icon: FileCode2, color: 'text-indigo-400' },
        { id: 'pdf', label: t('exportPdf'), icon: FileText, color: 'text-rose-400' },
        { id: 'csv', label: t('exportCsv'), icon: Table2, color: 'text-emerald-400' },
        { id: 'xlsx', label: t('exportExcel'), icon: FileSpreadsheet, color: 'text-teal-400' },
      ];

  return (
    <div ref={menuRef} className="relative inline-block shrink-0">
      <button
        type="button"
        onClick={() => canExport && setOpen(v => !v)}
        disabled={!canExport || Boolean(exportingFormat)}
        title={!canExport ? t('exportDeniedMsg') : t('export')}
        className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-semibold border transition-colors ${
          canExport
            ? 'bg-slate-800 hover:bg-slate-700 text-slate-200 border-slate-700'
            : 'bg-slate-900 text-slate-500 border-slate-800 cursor-not-allowed'
        }`}
      >
        {exportingFormat ? (
          <RefreshCw className="w-3.5 h-3.5 animate-spin text-indigo-400" />
        ) : !canExport ? (
          <Lock className="w-3 h-3 text-slate-500" />
        ) : (
          <Download className="w-3.5 h-3.5 text-indigo-400" />
        )}
        <span>{exportingFormat ? `${exportingFormat.toUpperCase()}...` : t('export')}</span>
        {canExport && <ChevronDown className="w-3 h-3 text-slate-400" />}
      </button>

      {open && (
        <div
          className={`absolute top-full mt-1.5 w-48 z-[500] rounded-xl bg-slate-950 border border-slate-700 shadow-2xl py-1 ${
            language === 'ar' ? 'left-0' : 'right-0'
          }`}
        >
          {options.map(opt => {
            const Icon = opt.icon;
            return (
              <button
                key={opt.id}
                type="button"
                onClick={() => handleExport(opt.id as any)}
                className="w-full flex items-center gap-2.5 px-3 py-2 text-[11px] font-medium text-slate-200 hover:bg-slate-800 text-start transition-colors"
              >
                <Icon className={`w-3.5 h-3.5 shrink-0 ${opt.color}`} />
                <span className="truncate">{opt.label}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};
