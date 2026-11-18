import React, { useState } from 'react';
import { useApp } from '../context/AppContext.js';
import { User, Role } from '../types/index.js';
import { useAsyncResource } from '../hooks/useAsyncResource.js';
import {
  TopProgressBar,
  RefreshingBadge,
  TableSkeletonRows,
  EmptyStateCard,
  ErrorRetryCard,
} from '../components/common/LoadingStates.js';
import {
  Users,
  Shield,
  Plus,
  UserCheck,
  RefreshCw,
} from 'lucide-react';

export const UserManagement: React.FC = () => {
  const { t, apiFetch, authToken } = useApp();
  const [modalOpen, setModalOpen] = useState(false);
  const [creating, setCreating] = useState(false);

  // New User Form State
  const [username, setUsername] = useState('');
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<Role>('DATA_ANALYST');
  const [formError, setFormError] = useState<string | null>(null);

  const usersRes = useAsyncResource<User[]>(
    async signal => {
      const res = await apiFetch('/api/v1/users', { signal });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(json?.error || 'Failed to load users');
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

  const users = usersRes.data || [];
  const isInitialLoading = usersRes.isLoading && !usersRes.data;
  const isUpdating = usersRes.isRefreshing || (usersRes.isLoading && Boolean(usersRes.data));

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setCreating(true);
    try {
      const res = await apiFetch('/api/v1/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username,
          full_name: fullName,
          email,
          password,
          role,
        }),
      });

      if (!res.ok) {
        const json = await res.json().catch(() => null);
        throw new Error(json?.error || 'Failed to create user');
      }

      setModalOpen(false);
      setUsername('');
      setFullName('');
      setEmail('');
      setPassword('');
      usersRes.reload({ force: true });
    } catch (err: any) {
      setFormError(err.message);
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Title */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-slate-100 flex items-center gap-2 flex-wrap">
            <Users className="w-5 h-5 text-indigo-400" />
            <span>Enterprise User &amp; Role-Based Access Control (RBAC)</span>
            {isUpdating && <RefreshingBadge />}
          </h1>
          <p className="text-xs text-slate-400 mt-0.5">
            Manage authenticated platform operators, module permissions, and field-level privacy masking.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={isInitialLoading || isUpdating}
            onClick={() => usersRes.reload({ force: true })}
            className="flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition-colors disabled:opacity-60"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isInitialLoading || isUpdating ? 'animate-spin' : ''}`} />
            <span>{t('refresh')}</span>
          </button>
          <button
            type="button"
            onClick={() => setModalOpen(true)}
            className="flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white shadow-sm shadow-indigo-600/30 transition-colors"
          >
            <Plus className="w-4 h-4" />
            <span>Provision New User</span>
          </button>
        </div>
      </div>

      {/* Users Table */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-sm">
        <TopProgressBar active={isInitialLoading || isUpdating} label={t('updatingTable')} />
        <div className="p-4 border-b border-slate-800 flex items-center justify-between">
          <span className="text-xs font-bold text-slate-200 uppercase tracking-wider flex items-center gap-2">
            <span>Active Accounts</span>
            {usersRes.data ? (
              <span className="tabular-nums text-indigo-400">({users.length})</span>
            ) : isInitialLoading ? (
              <span className="inline-block h-3.5 w-8 rounded bg-slate-800 animate-pulse motion-reduce:animate-none" />
            ) : null}
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left rtl:text-right text-xs">
            <thead className="bg-slate-950/70 text-slate-400 border-b border-slate-800 text-[11px] uppercase tracking-wider">
              <tr>
                <th className="px-5 py-3">Operator</th>
                <th className="px-5 py-3">Role</th>
                <th className="px-5 py-3">Email Address</th>
                <th className="px-5 py-3">Status</th>
                <th className="px-5 py-3">Last Active</th>
              </tr>
            </thead>
            <tbody
              className={`divide-y divide-slate-800/60 text-slate-300 transition-opacity ${
                isUpdating ? 'opacity-60' : 'opacity-100'
              }`}
            >
              {isInitialLoading ? (
                <TableSkeletonRows columns={5} rows={5} />
              ) : usersRes.isError && !usersRes.data ? (
                <tr>
                  <td colSpan={5} className="p-6">
                    <ErrorRetryCard message={usersRes.error} onRetry={() => usersRes.reload({ force: true })} />
                  </td>
                </tr>
              ) : users.length === 0 ? (
                <tr>
                  <td colSpan={5} className="p-6">
                    <EmptyStateCard title={t('noRecordsTitle')} description={t('noRecordsHint')} />
                  </td>
                </tr>
              ) : (
                users.map(u => (
                  <tr key={u.id} className="hover:bg-slate-800/40 transition-colors">
                    <td className="px-5 py-3 font-medium text-slate-200">
                      <div className="flex items-center gap-2.5">
                        <div className="w-7 h-7 rounded-full bg-slate-800 flex items-center justify-center text-indigo-400 font-bold text-xs">
                          {u.username.charAt(0).toUpperCase()}
                        </div>
                        <div>
                          <div>{u.fullName || u.username}</div>
                          <div className="text-[10px] text-slate-500 font-mono">@{u.username}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-5 py-3">
                      <span
                        className={`inline-block px-2 py-0.5 text-[10px] font-bold rounded-md border ${
                          u.role === 'SUPER_ADMIN'
                            ? 'bg-purple-950/60 border-purple-800 text-purple-300'
                            : u.role === 'ADMIN'
                            ? 'bg-indigo-950/60 border-indigo-800 text-indigo-300'
                            : u.role === 'DATA_MANAGER'
                            ? 'bg-sky-950/60 border-sky-800 text-sky-300'
                            : u.role === 'DATA_ANALYST'
                            ? 'bg-amber-950/60 border-amber-800 text-amber-300'
                            : 'bg-slate-800 border-slate-700 text-slate-400'
                        }`}
                      >
                        {u.role}
                      </span>
                    </td>
                    <td className="px-5 py-3 font-mono text-[11px] text-slate-400">{u.email}</td>
                    <td className="px-5 py-3">
                      <span className="flex items-center gap-1.5 text-emerald-400 text-xs">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                        <span>{u.status}</span>
                      </span>
                    </td>
                    <td className="px-5 py-3 font-mono text-[11px] text-slate-500">
                      {u.lastLogin ? new Date(u.lastLogin).toLocaleString() : 'Never'}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Permissions Matrix Overview */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-sm space-y-4">
        <h2 className="text-xs font-bold text-slate-200 uppercase tracking-wider flex items-center gap-2">
          <Shield className="w-4 h-4 text-indigo-400" />
          <span>Role Permissions Matrix</span>
        </h2>

        <div className="overflow-x-auto rounded-xl border border-slate-800">
          <table className="w-full text-left rtl:text-right text-xs">
            <thead className="bg-slate-950/70 text-slate-400 border-b border-slate-800 text-[11px] uppercase">
              <tr>
                <th className="px-4 py-2.5">Role</th>
                <th className="px-4 py-2.5">View Tables</th>
                <th className="px-4 py-2.5">Edit Data</th>
                <th className="px-4 py-2.5">Import Files</th>
                <th className="px-4 py-2.5">Export Data</th>
                <th className="px-4 py-2.5">View Unmasked IMSI</th>
                <th className="px-4 py-2.5">Admin Settings</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 text-slate-300">
              {[
                { role: 'SUPER_ADMIN', view: true, edit: true, imp: true, exp: true, unmask: true, settings: true },
                { role: 'ADMIN', view: true, edit: true, imp: true, exp: true, unmask: true, settings: false },
                { role: 'DATA_MANAGER', view: true, edit: true, imp: true, exp: true, unmask: true, settings: false },
                { role: 'DATA_ANALYST', view: true, edit: false, imp: false, exp: true, unmask: false, settings: false },
                { role: 'VIEWER', view: true, edit: false, imp: false, exp: false, unmask: false, settings: false },
              ].map(r => (
                <tr key={r.role} className="hover:bg-slate-800/40">
                  <td className="px-4 py-2.5 font-bold text-slate-200">{r.role}</td>
                  <td className="px-4 py-2.5 text-emerald-400">&#10003;</td>
                  <td className="px-4 py-2.5">{r.edit ? <span className="text-emerald-400">&#10003;</span> : <span className="text-slate-600">-</span>}</td>
                  <td className="px-4 py-2.5">{r.imp ? <span className="text-emerald-400">&#10003;</span> : <span className="text-slate-600">-</span>}</td>
                  <td className="px-4 py-2.5">{r.exp ? <span className="text-emerald-400">&#10003;</span> : <span className="text-slate-600">-</span>}</td>
                  <td className="px-4 py-2.5">{r.unmask ? <span className="text-emerald-400">&#10003;</span> : <span className="text-rose-400">Masked</span>}</td>
                  <td className="px-4 py-2.5">{r.settings ? <span className="text-emerald-400">&#10003;</span> : <span className="text-slate-600">-</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* New User Modal */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-sm">
          <div className="relative w-full max-w-md bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl p-6 space-y-4">
            <h2 className="text-base font-bold text-slate-100 flex items-center gap-2">
              <UserCheck className="w-5 h-5 text-indigo-400" />
              <span>Provision Operator Account</span>
            </h2>

            {formError && (
              <div className="p-3 rounded-lg bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs">
                {formError}
              </div>
            )}

            <form onSubmit={handleCreateUser} className="space-y-3">
              <div className="space-y-1">
                <label className="text-xs font-semibold text-slate-300">Username</label>
                <input
                  type="text"
                  required
                  value={username}
                  onChange={e => setUsername(e.target.value)}
                  className="w-full h-9 px-3 text-xs bg-slate-950 border border-slate-800 rounded-lg text-slate-200"
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-semibold text-slate-300">Full Name</label>
                <input
                  type="text"
                  required
                  value={fullName}
                  onChange={e => setFullName(e.target.value)}
                  className="w-full h-9 px-3 text-xs bg-slate-950 border border-slate-800 rounded-lg text-slate-200"
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-semibold text-slate-300">Email Address</label>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  className="w-full h-9 px-3 text-xs bg-slate-950 border border-slate-800 rounded-lg text-slate-200"
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-semibold text-slate-300">Password</label>
                <input
                  type="password"
                  required
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  className="w-full h-9 px-3 text-xs bg-slate-950 border border-slate-800 rounded-lg text-slate-200"
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-semibold text-slate-300">Role</label>
                <select
                  value={role}
                  onChange={e => setRole(e.target.value as any)}
                  className="w-full h-9 px-3 text-xs bg-slate-950 border border-slate-800 rounded-lg text-slate-200"
                >
                  <option value="VIEWER">Viewer (Read-only)</option>
                  <option value="DATA_ANALYST">Data Analyst (Read &amp; Export)</option>
                  <option value="DATA_MANAGER">Data Manager (CRUD &amp; Import)</option>
                  <option value="ADMIN">Administrator (Full Data Operations)</option>
                  <option value="SUPER_ADMIN">Super Administrator (System Config)</option>
                </select>
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  className="px-4 py-2 text-xs font-medium rounded-lg bg-slate-800 text-slate-300"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={creating}
                  className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-lg bg-indigo-600 text-white disabled:opacity-50"
                >
                  {creating && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
                  <span>{creating ? t('loading') : 'Create Account'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
