import React, { useState, useEffect } from 'react';
import { useApp } from '../../context/AppContext.js';
import { DashboardFilterState } from '../../types/index.js';
import {
  X,
  FileText,
  FileSpreadsheet,
  Download,
  RefreshCw,
  CheckCircle2,
  AlertTriangle,
  ShieldAlert,
  Clock,
} from 'lucide-react';

interface ExportDashboardModalProps {
  isOpen: boolean;
  onClose: () => void;
  filters: DashboardFilterState;
  captureChartImages: () => Promise<Record<string, string>>;
}

export const ExportDashboardModal: React.FC<ExportDashboardModalProps> = ({
  isOpen,
  onClose,
  filters,
  captureChartImages,
}) => {
  const { apiFetch, authToken, currentUser, addNotification, language } = useApp();

  const [format, setFormat] = useState<'pdf' | 'xlsx' | 'docx'>('pdf');
  const [reportLang, setReportLang] = useState<'en' | 'ar'>(language);
  const [exporting, setExporting] = useState(false);
  const [progressStage, setProgressStage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastExport, setLastExport] = useState<{ exportId: number; fileName: string; downloadUrl: string } | null>(null);
  const [history, setHistory] = useState<any[]>([]);

  const [scope, setScope] = useState({
    kpis: true,
    appliedFilters: true,
    registrationsByCountry: true,
    btsMap: true,
    networkCellsByMcc: true,
    militaryNetworks: true,
    civilianNetworks: true,
    includeDetailedRecords: false,
    includeSensitiveIdentifiers: false,
  });

  const canUnmask = currentUser?.role === 'SUPER_ADMIN' || currentUser?.role === 'ADMIN';
  const canExport = currentUser?.role !== 'VIEWER';

  const fetchHistory = () => {
    apiFetch('/api/v1/exports/history')
      .then(r => (r.ok ? r.json() : []))
      .then(rows => setHistory(Array.isArray(rows) ? rows : []))
      .catch(() => {});
  };

  useEffect(() => {
    if (isOpen) {
      setReportLang(language);
      setError(null);
      fetchHistory();
    }
  }, [isOpen, language]);

  if (!isOpen) return null;

  const setSelectAll = (checked: boolean) => {
    setScope(prev => ({
      ...prev,
      kpis: checked,
      appliedFilters: checked,
      registrationsByCountry: checked,
      btsMap: checked,
      networkCellsByMcc: checked,
      militaryNetworks: checked,
      civilianNetworks: checked,
    }));
  };

  const triggerDownload = (url: string, fileName: string) => {
    const sep = url.includes('?') ? '&' : '?';
    const fullUrl = authToken ? `${url}${sep}token=${encodeURIComponent(authToken)}` : url;
    const a = document.createElement('a');
    a.href = fullUrl;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const handleGenerateExport = async () => {
    setExporting(true);
    setProgressStage('Capturing charts & geographic map snapshots...');
    setError(null);
    setLastExport(null);

    try {
      const chartImages = format !== 'xlsx' ? await captureChartImages() : {};
      setProgressStage(`Generating ${format.toUpperCase()} report on server...`);

      const res = await apiFetch('/api/v1/exports/dashboard', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          format,
          language: reportLang,
          filters: {
            missionIds: filters.missionIds,
            country: filters.country,
            countryCode: filters.countryCode,
            imsi: filters.imsi || undefined,
            imei: filters.imei || undefined,
            tmsi: filters.tmsi || undefined,
            btsName: filters.btsName || undefined,
            bts: filters.bts || undefined,
            ueModel: filters.ueModel,
            lastSeenFrom: filters.lastSeenFrom || undefined,
            lastSeenTo: filters.lastSeenTo || undefined,
            btsAltitudeMin: filters.btsAltitudeMin || undefined,
            btsAltitudeMax: filters.btsAltitudeMax || undefined,
            distanceMinFrom: filters.distanceMinFrom || undefined,
            distanceMinTo: filters.distanceMinTo || undefined,
            distanceMaxFrom: filters.distanceMaxFrom || undefined,
            distanceMaxTo: filters.distanceMaxTo || undefined,
            hasBtsLocation: filters.hasBtsLocation,
            btsLocationOutdated: filters.btsLocationOutdated,
            hasDeviceLocation: filters.hasDeviceLocation,
            action: filters.action,
            update: filters.update,
            rat: filters.rat,
            mcc: filters.mcc,
            mnc: filters.mnc,
            lac: filters.lac || undefined,
            cellId: filters.cellId || undefined,
            channel: filters.channel || undefined,
            bsic: filters.bsic || undefined,
            pci: filters.pci || undefined,
            psc: filters.psc || undefined,
            rxLevMin: filters.rxLevMin || undefined,
            rxLevMax: filters.rxLevMax || undefined,
            rxLevDbmMin: filters.rxLevDbmMin || undefined,
            rxLevDbmMax: filters.rxLevDbmMax || undefined,
            downlinkMin: filters.downlinkMin || undefined,
            downlinkMax: filters.downlinkMax || undefined,
            dlBandwidthMin: filters.dlBandwidthMin || undefined,
            dlBandwidthMax: filters.dlBandwidthMax || undefined,
            directionMin: filters.directionMin || undefined,
            directionMax: filters.directionMax || undefined,
            isNeighbour: filters.isNeighbour,
            isPcs1900: filters.isPcs1900,
            hasCoordinates: filters.hasCoordinates,
            plmnQuery: filters.plmnQuery || undefined,
          },
          scope,
          chartImages,
        }),
      });

      const json = await res.json();
      if (!res.ok) {
        throw new Error(json.error || 'Export generation failed');
      }

      setProgressStage('Starting file download...');
      setLastExport(json);
      fetchHistory();
      triggerDownload(json.downloadUrl, json.fileName);

      addNotification({
        title: 'Dashboard Export Ready',
        message: `Generated ${json.fileName} (${format.toUpperCase()})`,
        type: 'success',
      });
    } catch (err: any) {
      setError(err.message);
    } finally {
      setExporting(false);
      setProgressStage(null);
    }
  };

  return (
    <div className="fixed inset-0 z-[1000] flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm">
      <div className="relative w-full max-w-3xl max-h-[90vh] overflow-y-auto bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl p-6 space-y-5">
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-slate-800">
          <div>
            <h2 className="text-base font-bold text-slate-100 flex items-center gap-2">
              <Download className="w-5 h-5 text-indigo-400" />
              <span>Export Dashboard Report</span>
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Generate filtered, formatted PDF, Excel (.xlsx), or Word (.docx) intelligence reports with RTL Arabic & LTR English support.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {!canExport && (
          <div className="p-3 bg-amber-500/10 border border-amber-500/30 rounded-xl text-xs text-amber-300 flex items-center gap-2">
            <ShieldAlert className="w-4 h-4 shrink-0" />
            <span>Current role (VIEWER) is read-only and does not have export permission. Switch role in navbar to export.</span>
          </div>
        )}

        {error && (
          <div className="p-3 bg-rose-500/10 border border-rose-500/30 rounded-xl text-xs text-rose-300 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* Format & Language */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <label className="text-xs font-bold text-slate-300 uppercase">Report Format</label>
            <div className="grid grid-cols-3 gap-2">
              {[
                { id: 'pdf', label: 'PDF Report', icon: FileText, color: 'text-rose-400' },
                { id: 'xlsx', label: 'Excel (.xlsx)', icon: FileSpreadsheet, color: 'text-emerald-400' },
                { id: 'docx', label: 'Word (.docx)', icon: FileText, color: 'text-sky-400' },
              ].map(fmt => {
                const Icon = fmt.icon;
                return (
                  <button
                    key={fmt.id}
                    type="button"
                    onClick={() => setFormat(fmt.id as any)}
                    className={`flex flex-col items-center gap-1 p-3 rounded-xl border text-xs font-semibold transition-colors ${
                      format === fmt.id
                        ? 'bg-indigo-600/20 border-indigo-500 text-white'
                        : 'bg-slate-950 border-slate-800 text-slate-400 hover:bg-slate-800'
                    }`}
                  >
                    <Icon className={`w-5 h-5 ${fmt.color}`} />
                    <span>{fmt.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-xs font-bold text-slate-300 uppercase">Document Language & Direction</label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setReportLang('en')}
                className={`p-3 rounded-xl border text-xs font-semibold ${
                  reportLang === 'en'
                    ? 'bg-indigo-600/20 border-indigo-500 text-white'
                    : 'bg-slate-950 border-slate-800 text-slate-400'
                }`}
              >
                English (LTR)
              </button>
              <button
                type="button"
                onClick={() => setReportLang('ar')}
                className={`p-3 rounded-xl border text-xs font-semibold ${
                  reportLang === 'ar'
                    ? 'bg-indigo-600/20 border-indigo-500 text-white'
                    : 'bg-slate-950 border-slate-800 text-slate-400'
                }`}
              >
                العربية (RTL)
              </button>
            </div>
          </div>
        </div>

        {/* Scope Selection */}
        <div className="p-4 rounded-xl bg-slate-950/70 border border-slate-800 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-200 uppercase">Included Sections (Export Scope)</span>
            <div className="flex gap-2">
              <button type="button" onClick={() => setSelectAll(true)} className="text-[11px] text-indigo-400 hover:underline">
                Select All
              </button>
              <button type="button" onClick={() => setSelectAll(false)} className="text-[11px] text-slate-400 hover:underline">
                Deselect All
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs text-slate-300">
            {[
              { key: 'kpis', label: '11 Filter-Responsive KPI Cards' },
              { key: 'appliedFilters', label: 'Applied Global Filters Summary' },
              { key: 'registrationsByCountry', label: 'Registrations by Country (Distinct IMSI)' },
              { key: 'btsMap', label: 'BTS & NetworkCell Locations Summary / Snapshot' },
              { key: 'networkCellsByMcc', label: 'Network Cells by Country (MCC)' },
              { key: 'militaryNetworks', label: 'Military Mobile Networks' },
              { key: 'civilianNetworks', label: 'Civilian Mobile Networks' },
              { key: 'includeDetailedRecords', label: 'Include Detailed Filtered Registration Rows' },
            ].map(item => (
              <label key={item.key} className="flex items-center gap-2 p-2 rounded-lg bg-slate-900/70 border border-slate-800 cursor-pointer">
                <input
                  type="checkbox"
                  checked={(scope as any)[item.key]}
                  onChange={e => setScope({ ...scope, [item.key]: e.target.checked })}
                  className="rounded bg-slate-950 border-slate-700 text-indigo-600"
                />
                <span>{item.label}</span>
              </label>
            ))}
          </div>

          {scope.includeDetailedRecords && (
            <label
              className={`flex items-center gap-2 p-2.5 rounded-lg border text-xs ${
                canUnmask
                  ? 'bg-amber-950/30 border-amber-800/60 text-amber-200 cursor-pointer'
                  : 'bg-slate-900 border-slate-800 text-slate-500 cursor-not-allowed'
              }`}
            >
              <input
                type="checkbox"
                disabled={!canUnmask}
                checked={scope.includeSensitiveIdentifiers && canUnmask}
                onChange={e => setScope({ ...scope, includeSensitiveIdentifiers: e.target.checked })}
                className="rounded bg-slate-950 border-slate-700 text-amber-500"
              />
              <span>
                Include unmasked IMSI / IMEI / TMSI columns ({canUnmask ? 'Authorized for your role' : 'Admin privilege required — masked by default'})
              </span>
            </label>
          )}
        </div>

        {/* Success Download Banner */}
        {lastExport && (
          <div className="p-3 rounded-xl bg-emerald-950/40 border border-emerald-800 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-xs text-emerald-300">
              <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
              <span>
                Generated <strong>{lastExport.fileName}</strong>
              </span>
            </div>
            <button
              type="button"
              onClick={() => triggerDownload(lastExport.downloadUrl, lastExport.fileName)}
              className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold flex items-center gap-1"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Download</span>
            </button>
          </div>
        )}

        {/* Staged Progress Banner */}
        {exporting && progressStage && (
          <div className="p-3 rounded-xl bg-indigo-950/40 border border-indigo-700/50 flex items-center gap-2.5 text-xs text-indigo-200">
            <RefreshCw className="w-4 h-4 animate-spin text-indigo-400 shrink-0" />
            <span>{progressStage}</span>
          </div>
        )}

        {/* Footer Actions */}
        <div className="flex justify-end gap-2 pt-2 border-t border-slate-800">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-xs font-medium rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300"
          >
            Close
          </button>
          <button
            type="button"
            onClick={handleGenerateExport}
            disabled={exporting || !canExport}
            className="flex items-center gap-2 px-5 py-2 text-xs font-bold rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white disabled:opacity-50"
          >
            {exporting ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
            <span>{exporting ? (progressStage || 'Generating Report...') : `Generate ${format.toUpperCase()} Report`}</span>
          </button>
        </div>

        {/* Recent Dashboard Export History */}
        <div className="pt-3 border-t border-slate-800 space-y-2">
          <h3 className="text-xs font-bold text-slate-300 uppercase flex items-center gap-1.5">
            <Clock className="w-3.5 h-3.5 text-indigo-400" />
            <span>Recent Dashboard Exports</span>
          </h3>
          <div className="max-h-40 overflow-y-auto rounded-xl border border-slate-800">
            <table className="w-full text-left rtl:text-right text-[11px]">
              <thead className="bg-slate-950 text-slate-400 border-b border-slate-800">
                <tr>
                  <th className="px-3 py-2">Date</th>
                  <th className="px-3 py-2">User</th>
                  <th className="px-3 py-2">Format</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">File</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/70 text-slate-300">
                {history.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-3 py-4 text-center text-slate-500">
                      No dashboard exports yet
                    </td>
                  </tr>
                ) : (
                  history.slice(0, 10).map(h => (
                    <tr key={h.id} className="hover:bg-slate-800/30">
                      <td className="px-3 py-1.5 font-mono">{new Date(h.created_at).toLocaleString()}</td>
                      <td className="px-3 py-1.5">{h.username}</td>
                      <td className="px-3 py-1.5 font-bold text-indigo-300">{h.format}</td>
                      <td className="px-3 py-1.5">
                        <span className={h.status === 'COMPLETED' ? 'text-emerald-400' : 'text-rose-400'}>
                          {h.status}
                        </span>
                      </td>
                      <td className="px-3 py-1.5">
                        {h.status === 'COMPLETED' && h.file_name ? (
                          <button
                            type="button"
                            onClick={() => triggerDownload(`/api/v1/exports/dashboard/${h.id}/download`, h.file_name)}
                            className="text-sky-400 hover:underline flex items-center gap-1"
                          >
                            <Download className="w-3 h-3" />
                            <span className="truncate max-w-[160px]">{h.file_name}</span>
                          </button>
                        ) : (
                          <span className="text-slate-500">-</span>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
};
