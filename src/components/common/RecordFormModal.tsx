import React, { useState, useEffect } from 'react';
import { useApp } from '../../context/AppContext.js';
import { ColumnMeta } from '../../types/index.js';
import { ModalContentSkeleton, ErrorRetryCard } from './LoadingStates.js';
import { X, Save, AlertCircle, RefreshCw } from 'lucide-react';

interface RecordFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  tableName: string;
  record: Record<string, any> | null; // If null, mode is CREATE, else EDIT
  columns: ColumnMeta[];
  columnsLoading?: boolean;
  columnsError?: string | null;
  onRetryColumns?: () => void;
  onSuccess: () => void;
}

export const RecordFormModal: React.FC<RecordFormModalProps> = ({
  isOpen,
  onClose,
  tableName,
  record,
  columns,
  columnsLoading = false,
  columnsError = null,
  onRetryColumns,
  onSuccess,
}) => {
  const { t, activeMission, missions, missionsLoading, apiFetch } = useApp();
  const [formData, setFormData] = useState<Record<string, any>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (record) {
      setFormData({ ...record });
    } else {
      const initial: Record<string, any> = {};
      columns.forEach(col => {
        if (col.name === 'id') return;
        if (col.name === 'mission_id' && activeMission !== 'ALL') {
          initial.mission_id = Number(activeMission);
        } else if (col.name === 'mission' && activeMission !== 'ALL') {
          const found = missions.find(m => String(m.id) === activeMission);
          initial.mission = found ? found.mission : '';
        } else {
          initial[col.name] = '';
        }
      });
      setFormData(initial);
    }
    setError(null);
  }, [record, columns, activeMission, missions, isOpen]);

  if (!isOpen) return null;

  const isEdit = Boolean(record && record.id);
  const editableColumns = columns.filter(c => c.name !== 'id');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const url = isEdit
        ? `/api/v1/tables/${tableName}/${record!.id}`
        : `/api/v1/tables/${tableName}`;
      const method = isEdit ? 'PUT' : 'POST';

      const res = await apiFetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      });

      if (!res.ok) {
        const json = await res.json().catch(() => null);
        throw new Error(json?.error || 'Failed to save record');
      }

      onSuccess();
      onClose();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-sm">
      <div className="relative w-full max-w-xl max-h-[90vh] bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-slate-950/40">
          <h2 className="text-base font-bold text-slate-100">
            {isEdit ? t('editRecord') : t('addNewRecord')}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Error message */}
        {error && (
          <div className="mx-6 mt-4 p-3 rounded-lg bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* Body */}
        {columnsLoading && editableColumns.length === 0 ? (
          <ModalContentSkeleton fields={6} label={t('loadingSchema')} />
        ) : columnsError && editableColumns.length === 0 ? (
          <div className="p-6">
            <ErrorRetryCard message={columnsError} onRetry={onRetryColumns} />
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-6 space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {editableColumns.map(col => {
                if (col.name === 'mission_id') {
                  return (
                    <div key={col.name} className="space-y-1">
                      <label className="block text-xs font-semibold text-slate-300">
                        mission_id {col.notnull === 1 && <span className="text-rose-400">*</span>}
                      </label>
                      <select
                        disabled={missionsLoading}
                        value={formData.mission_id ?? ''}
                        onChange={e => {
                          const val = e.target.value ? Number(e.target.value) : '';
                          const matched = missions.find(m => m.id === Number(val));
                          setFormData({
                            ...formData,
                            mission_id: val,
                            ...(matched && columns.some(c => c.name === 'mission') ? { mission: matched.mission } : {}),
                          });
                        }}
                        className="w-full h-9 px-3 text-xs bg-slate-950 border border-slate-800 rounded-lg text-slate-200 focus:outline-none focus:border-indigo-500 disabled:opacity-60"
                      >
                        <option value="">
                          {missionsLoading ? t('loadingOptions') : t('selectMissionPlaceholder')}
                        </option>
                        {missions.map(m => (
                          <option key={m.id} value={m.id}>
                            {m.mission} — {m.location} (#{m.id})
                          </option>
                        ))}
                      </select>
                    </div>
                  );
                }
                const isNumeric = ['INTEGER', 'REAL', 'FLOAT', 'NUMERIC'].some(type =>
                  col.type.toUpperCase().includes(type)
                );
                return (
                  <div key={col.name} className="space-y-1">
                    <label className="block text-xs font-semibold text-slate-300">
                      {col.name} {col.notnull === 1 && <span className="text-rose-400">*</span>}
                    </label>
                    <input
                      type={isNumeric ? 'number' : 'text'}
                      step="any"
                      value={formData[col.name] ?? ''}
                      onChange={e =>
                        setFormData({
                          ...formData,
                          [col.name]: isNumeric && e.target.value !== '' ? Number(e.target.value) : e.target.value,
                        })
                      }
                      placeholder={`Enter ${col.name}...`}
                      className="w-full h-9 px-3 text-xs bg-slate-950 border border-slate-800 rounded-lg text-slate-200 placeholder-slate-600 focus:outline-none focus:border-indigo-500 transition-colors"
                    />
                  </div>
                );
              })}
            </div>

            <div className="flex items-center justify-end gap-2 pt-4 border-t border-slate-800">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-xs font-medium rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors"
              >
                {t('cancel')}
              </button>
              <button
                type="submit"
                disabled={loading}
                className="flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white disabled:opacity-50 transition-colors"
              >
                {loading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                <span>{loading ? t('loading') : isEdit ? t('save') : t('create')}</span>
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
};
