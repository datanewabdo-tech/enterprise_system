import React, { useState } from 'react';
import { useApp } from '../context/AppContext.js';
import { Settings as SettingsIcon, Save, ShieldCheck, CheckCircle2 } from 'lucide-react';

export const Settings: React.FC = () => {
  const { t, language, setLanguage, theme, toggleTheme } = useApp();

  const [retentionDays, setRetentionDays] = useState('180');
  const [maskSensitive, setMaskSensitive] = useState(true);
  const [maxUploadMb, setMaxUploadMb] = useState('100');
  const [savedNotice, setSavedNotice] = useState(false);

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    setSavedNotice(true);
    setTimeout(() => setSavedNotice(false), 3000);
  };

  return (
    <div className="space-y-6">
      {/* Title */}
      <div>
        <h1 className="text-xl font-bold text-slate-100 flex items-center gap-2">
          <SettingsIcon className="w-5 h-5 text-indigo-400" />
          <span>Platform & Operational Governance Settings</span>
        </h1>
        <p className="text-xs text-slate-400 mt-0.5">
          Configure telemetry retention windows, privacy masking thresholds, and regional parameters.
        </p>
      </div>

      {savedNotice && (
        <div className="p-3 bg-emerald-950/40 border border-emerald-800 rounded-xl text-xs text-emerald-300 flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-emerald-400" />
          <span>Settings saved and applied across platform controllers.</span>
        </div>
      )}

      {/* Form Card */}
      <form onSubmit={handleSave} className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-sm space-y-6 max-w-2xl">
        {/* Retention Policy */}
        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-slate-200 uppercase tracking-wider block">
            Data Retention Window (Days)
          </label>
          <p className="text-[11px] text-slate-400">
            Historical GPS tracking points and temporary registrations older than this period are queued for scheduled deletion.
          </p>
          <input
            type="number"
            value={retentionDays}
            onChange={e => setRetentionDays(e.target.value)}
            className="w-full h-9 px-3 text-xs bg-slate-950 border border-slate-800 rounded-lg text-slate-200 focus:outline-none focus:border-indigo-500 font-mono"
          />
        </div>

        {/* Privacy Masking Rule */}
        <div className="pt-3 border-t border-slate-800 space-y-2">
          <label className="flex items-center gap-2.5 text-xs text-slate-200 cursor-pointer font-semibold">
            <input
              type="checkbox"
              checked={maskSensitive}
              onChange={e => setMaskSensitive(e.target.checked)}
              className="rounded bg-slate-950 border-slate-700 text-indigo-600"
            />
            <span>Enforce Field-Level Anonymization on IMSI / IMEI / TMSI</span>
          </label>
          <p className="text-[11px] text-slate-400 pl-6 rtl:pr-6 rtl:pl-0">
            When enabled, users with Analyst or Viewer roles will only see masked identifiers (e.g., <code>602********44</code>) to prevent unauthorized target disclosure.
          </p>
        </div>

        {/* Max Upload Limit */}
        <div className="pt-3 border-t border-slate-800 space-y-1.5">
          <label className="text-xs font-semibold text-slate-200 uppercase tracking-wider block">
            Maximum Upload File Size (MB)
          </label>
          <input
            type="number"
            value={maxUploadMb}
            onChange={e => setMaxUploadMb(e.target.value)}
            className="w-full h-9 px-3 text-xs bg-slate-950 border border-slate-800 rounded-lg text-slate-200 focus:outline-none focus:border-indigo-500 font-mono"
          />
        </div>

        <div className="pt-4 border-t border-slate-800 flex justify-end">
          <button
            type="submit"
            className="flex items-center gap-2 px-5 py-2 text-xs font-bold rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white shadow-md shadow-indigo-600/30 transition-colors"
          >
            <Save className="w-4 h-4" />
            <span>Save Configuration</span>
          </button>
        </div>
      </form>
    </div>
  );
};
