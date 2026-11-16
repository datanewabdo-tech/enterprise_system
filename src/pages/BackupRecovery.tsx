import React, { useState } from 'react';
import { useApp } from '../context/AppContext.js';
import { useAsyncResource } from '../hooks/useAsyncResource.js';
import {
  TopProgressBar,
  RefreshingBadge,
  TableSkeletonRows,
  EmptyStateCard,
  ErrorRetryCard,
} from '../components/common/LoadingStates.js';
import {
  HardDrive,
  ShieldCheck,
  CheckCircle2,
  Terminal,
  RefreshCw,
  AlertTriangle,
} from 'lucide-react';

interface BackupEntry {
  name: string;
  sizeBytes: number;
  createdAt: string;
  type: string;
  status: string;
}

export const BackupRecovery: React.FC = () => {
  const { t, apiFetch, authToken } = useApp();
  const [creating, setCreating] = useState(false);
  const [notice, setNotice] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const backupsRes = useAsyncResource<BackupEntry[]>(
    async signal => {
      const res = await apiFetch('/api/v1/system/backups', { signal });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(json?.error || 'Failed to load database backups');
      }
      return Array.isArray(json) ? json : [];
    },
    [authToken],
    {
      enabled: Boolean(authToken),
      keepPreviousData: true,
      isEmpty: data => !data || data.length === 0,
    }
  );

  const handleCreateBackup = async () => {
    setCreating(true);
    setNotice(null);
    try {
      const res = await apiFetch('/api/v1/system/backups/create', { method: 'POST' });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(json?.error || 'Backup creation failed');
      }
      setNotice({ type: 'success', text: `Snapshot created: ${json.backupName}` });
      backupsRes.reload({ force: true });
    } catch (e: any) {
      setNotice({ type: 'error', text: e?.message || 'Backup creation failed' });
    } finally {
      setCreating(false);
    }
  };

  const backups = backupsRes.data || [];
  const isInitialLoading = backupsRes.isLoading && !backupsRes.data;
  const isUpdating = backupsRes.isRefreshing || (backupsRes.isLoading && Boolean(backupsRes.data));

  const formatSize = (bytes: number) => {
    if (!Number.isFinite(bytes)) return '-';
    if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
    return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  };

  return (
    <div className="space-y-6">
      {/* Title */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-slate-100 flex items-center gap-2 flex-wrap">
            <HardDrive className="w-5 h-5 text-indigo-400" />
            <span>{t('backupTitle')}</span>
            {isUpdating && <RefreshingBadge />}
          </h1>
          <p className="text-xs text-slate-400 mt-0.5">
            Create automated or point-in-time database snapshots with verifiable cryptographic checksums.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={isInitialLoading || isUpdating}
            onClick={() => backupsRes.reload({ force: true })}
            className="flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition-colors disabled:opacity-60"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isInitialLoading || isUpdating ? 'animate-spin' : ''}`} />
            <span>{t('refresh')}</span>
          </button>

          <button
            type="button"
            onClick={handleCreateBackup}
            disabled={creating}
            className="flex items-center gap-2 px-4 py-2 text-xs font-semibold rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white shadow-sm shadow-indigo-600/30 disabled:opacity-50 transition-colors"
          >
            <RefreshCw className={`w-4 h-4 ${creating ? 'animate-spin' : ''}`} />
            <span>{creating ? 'Creating Snapshot...' : t('createBackup')}</span>
          </button>
        </div>
      </div>

      {notice && (
        <div
          className={`p-3 rounded-xl text-xs flex items-center gap-2 border ${
            notice.type === 'success'
              ? 'bg-emerald-950/40 border-emerald-800 text-emerald-300'
              : 'bg-rose-950/40 border-rose-800 text-rose-300'
          }`}
        >
          {notice.type === 'success' ? (
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
          ) : (
            <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
          )}
          <span>{notice.text}</span>
        </div>
      )}

      {/* Backup Snapshots Table */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-sm">
        <TopProgressBar active={isInitialLoading || isUpdating} label={t('updatingTable')} />
        <div className="p-4 border-b border-slate-800 flex items-center justify-between">
          <span className="text-xs font-bold text-slate-200 uppercase tracking-wider">
            Available Database Snapshots
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left rtl:text-right text-xs">
            <thead className="bg-slate-950/70 text-slate-400 border-b border-slate-800 text-[11px] uppercase">
              <tr>
                <th className="px-5 py-3">Snapshot Name</th>
                <th className="px-5 py-3">Creation Date</th>
                <th className="px-5 py-3">Size</th>
                <th className="px-5 py-3">Type</th>
                <th className="px-5 py-3">Integrity</th>
              </tr>
            </thead>
            <tbody
              className={`divide-y divide-slate-800/60 text-slate-300 transition-opacity ${
                isUpdating ? 'opacity-60' : 'opacity-100'
              }`}
            >
              {isInitialLoading ? (
                <TableSkeletonRows columns={5} rows={4} />
              ) : backupsRes.isError && !backupsRes.data ? (
                <tr>
                  <td colSpan={5} className="p-6">
                    <ErrorRetryCard message={backupsRes.error} onRetry={() => backupsRes.reload({ force: true })} />
                  </td>
                </tr>
              ) : backups.length === 0 ? (
                <tr>
                  <td colSpan={5} className="p-6">
                    <EmptyStateCard title={t('noBackupsFound')} description="" />
                  </td>
                </tr>
              ) : (
                backups.map(b => (
                  <tr key={b.name} className="hover:bg-slate-800/40">
                    <td className="px-5 py-3 font-mono text-[11px] text-indigo-300">{b.name}</td>
                    <td className="px-5 py-3 text-slate-400">
                      {new Date(b.createdAt).toLocaleString()}
                    </td>
                    <td className="px-5 py-3 font-mono tabular-nums">{formatSize(b.sizeBytes)}</td>
                    <td className="px-5 py-3">
                      <span className="px-1.5 py-0.5 rounded bg-slate-800 text-[10px] text-slate-300">
                        {b.type}
                      </span>
                    </td>
                    <td className="px-5 py-3">
                      <span className="flex items-center gap-1 text-emerald-400 text-xs font-semibold">
                        <ShieldCheck className="w-3.5 h-3.5" />
                        <span>{b.status}</span>
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Production PostgreSQL & Docker Recovery Instructions */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-sm space-y-4">
        <h2 className="text-xs font-bold text-slate-200 uppercase tracking-wider flex items-center gap-2">
          <Terminal className="w-4 h-4 text-indigo-400" />
          <span>Production Disaster Recovery Commands (PostgreSQL / Docker)</span>
        </h2>

        <div className="space-y-3 font-mono text-xs">
          <div className="p-3 bg-slate-950 rounded-xl border border-slate-800 space-y-1">
            <span className="text-slate-400 text-[11px] font-sans block"># 1. Create native PostgreSQL pg_dump snapshot:</span>
            <code className="text-indigo-400 block select-all">
              docker exec -t enterprise_dashboard_db pg_dump -U enterprise_user enterprise_dashboard &gt; enterprise_backup_$(date +%Y%m%d).sql
            </code>
          </div>

          <div className="p-3 bg-slate-950 rounded-xl border border-slate-800 space-y-1">
            <span className="text-slate-400 text-[11px] font-sans block"># 2. Restore PostgreSQL backup in Docker container:</span>
            <code className="text-emerald-400 block select-all">
              cat enterprise_backup.sql | docker exec -i enterprise_dashboard_db psql -U enterprise_user -d enterprise_dashboard
            </code>
          </div>
        </div>
      </div>
    </div>
  );
};
