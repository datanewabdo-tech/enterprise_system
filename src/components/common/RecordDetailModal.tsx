import React from 'react';
import { useApp } from '../../context/AppContext.js';
import { ModalContentSkeleton, ErrorRetryCard } from './LoadingStates.js';
import { X, Copy, Check, ShieldCheck, Database } from 'lucide-react';

interface RecordDetailModalProps {
  isOpen: boolean;
  onClose: () => void;
  tableName: string;
  record: Record<string, any> | null;
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
  onEdit?: (record: any) => void;
}

export const RecordDetailModal: React.FC<RecordDetailModalProps> = ({
  isOpen,
  onClose,
  tableName,
  record,
  loading = false,
  error = null,
  onRetry,
  onEdit,
}) => {
  const { t } = useApp();
  const [copiedKey, setCopiedKey] = React.useState<string | null>(null);

  React.useEffect(() => {
    setCopiedKey(null);
  }, [record, isOpen]);

  if (!isOpen || (!record && !loading && !error)) return null;

  const handleCopy = (key: string, val: any) => {
    navigator.clipboard.writeText(String(val));
    setCopiedKey(key);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-sm">
      <div className="relative w-full max-w-2xl max-h-[90vh] bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-slate-950/40">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-indigo-600/20 text-indigo-400">
              <Database className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-100 flex items-center gap-2">
                <span>Record Details</span>
                {record?.id !== undefined && (
                  <span className="text-xs px-2 py-0.5 rounded-full bg-slate-800 text-slate-300 font-mono">
                    #{record.id}
                  </span>
                )}
              </h2>
              <p className="text-xs text-slate-400 font-mono">Table: {tableName}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        {loading && !record ? (
          <ModalContentSkeleton fields={8} label={t('loading')} />
        ) : error && !record ? (
          <div className="p-6">
            <ErrorRetryCard message={error} onRetry={onRetry} />
          </div>
        ) : record ? (
          <div className="flex-1 overflow-y-auto p-6 space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {Object.entries(record).map(([k, v]) => {
                const isMasked = typeof v === 'string' && v.includes('***');
                const isJson = typeof v === 'string' && (v.startsWith('{') || v.startsWith('['));
                return (
                  <div
                    key={k}
                    className={`p-3 rounded-xl border border-slate-800/80 bg-slate-950/50 flex flex-col justify-between ${
                      isJson || (typeof v === 'string' && v.length > 50) ? 'md:col-span-2' : ''
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
                        {k}
                      </span>
                      <button
                        type="button"
                        onClick={() => handleCopy(k, v)}
                        className="text-slate-500 hover:text-indigo-400 p-0.5 rounded"
                        title="Copy"
                      >
                        {copiedKey === k ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                      </button>
                    </div>
                    <div className="font-mono text-xs text-slate-200 break-words">
                      {isMasked ? (
                        <span className="px-2 py-0.5 rounded bg-amber-950/50 text-amber-300 border border-amber-800/50">
                          {v}
                        </span>
                      ) : v === null || v === undefined ? (
                        <span className="text-slate-600 italic">null</span>
                      ) : isJson ? (
                        <pre className="p-2 bg-slate-900 rounded text-[11px] overflow-x-auto text-indigo-300">
                          {v}
                        </pre>
                      ) : (
                        String(v)
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ) : null}

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-3 border-t border-slate-800 bg-slate-950/40">
          <div className="flex items-center gap-1.5 text-xs text-slate-500">
            <ShieldCheck className="w-4 h-4 text-emerald-400" />
            <span>Audited access record</span>
          </div>
          <div className="flex items-center gap-2">
            {onEdit && record && (
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onEdit(record);
                }}
                className="px-4 py-2 text-xs font-semibold rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white transition-colors"
              >
                {t('editRecord')}
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-medium rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 transition-colors"
            >
              {t('close')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
