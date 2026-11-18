import React from 'react';
import { RefreshCw, AlertTriangle, Inbox, RotateCcw, MapPin } from 'lucide-react';
import { useApp } from '../../context/AppContext.js';

/**
 * Subtle indeterminate progress bar pinned to the top of a container or viewport
 * while refreshing data or transitioning between modules.
 */
export const TopProgressBar: React.FC<{ active: boolean; label?: string; className?: string }> = ({
  active,
  label,
  className = '',
}) => {
  if (!active) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      aria-busy="true"
      className={`relative w-full h-0.5 bg-slate-800/80 overflow-hidden ${className}`}
    >
      <div className="absolute inset-y-0 w-1/2 bg-gradient-to-r from-indigo-500 via-sky-400 to-indigo-500 animate-indeterminate-bar" />
      <span className="sr-only">{label || 'Updating data'}</span>
    </div>
  );
};

/**
 * Compact non-blocking pill badge indicating background refresh while keeping
 * existing content mounted and readable.
 */
export const RefreshingBadge: React.FC<{ label?: string }> = ({ label }) => {
  const { t } = useApp();
  return (
    <span
      role="status"
      aria-live="polite"
      className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-indigo-950/70 border border-indigo-700/40 text-[11px] font-medium text-indigo-300 motion-reduce:animate-none"
    >
      <RefreshCw className="w-3 h-3 animate-spin motion-reduce:animate-none text-indigo-400" />
      <span>{label || t('refreshingData')}</span>
    </span>
  );
};

/**
 * Full-page or workspace-level skeleton layout shown while auth/bootstrap
 * or an asynchronous page initializes.
 */
export const PageLoadingScreen: React.FC<{ title?: string; message?: string }> = ({ title, message }) => {
  const { t } = useApp();
  return (
    <div
      role="status"
      aria-live="polite"
      aria-busy="true"
      className="space-y-6 animate-pulse motion-reduce:animate-none"
    >
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-slate-900/80 p-4 rounded-2xl border border-slate-800">
        <div className="space-y-2">
          <div className="h-5 w-64 bg-slate-800 rounded" />
          <div className="h-3 w-80 bg-slate-800/70 rounded" />
        </div>
        <div className="flex items-center gap-2 text-xs text-indigo-300">
          <RefreshCw className="w-4 h-4 animate-spin motion-reduce:animate-none text-indigo-400" />
          <span>{message || title || t('loadingPageData')}</span>
        </div>
      </div>

      <KpiGridSkeleton count={6} />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-4">
          <div className="h-4 w-48 bg-slate-800 rounded" />
          <ChartSkeleton heightClass="h-64" />
        </div>
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-4">
          <div className="h-4 w-48 bg-slate-800 rounded" />
          <ChartSkeleton heightClass="h-64" />
        </div>
      </div>
    </div>
  );
};

/**
 * Exact-geometry KPI card grid skeleton preventing layout shift and zero-value flash.
 */
export const KpiGridSkeleton: React.FC<{ count?: number; gridClassName?: string }> = ({
  count = 11,
  gridClassName = 'grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-3.5',
}) => {
  const { t } = useApp();
  return (
    <div
      role="status"
      aria-live="polite"
      aria-busy="true"
      className={gridClassName}
    >
      <span className="sr-only">{t('loading')}</span>
      {Array.from({ length: count }).map((_, idx) => (
        <div
          key={idx}
          className="p-3.5 bg-slate-900 border border-slate-800 rounded-xl shadow-sm animate-pulse motion-reduce:animate-none"
        >
          <div className="flex items-center justify-between gap-2">
            <div className="h-3 w-20 bg-slate-800 rounded" />
            <div className="w-6 h-6 rounded-lg bg-slate-800/80 shrink-0" />
          </div>
          <div className="mt-2.5 h-6 w-16 bg-slate-800 rounded" />
        </div>
      ))}
    </div>
  );
};

/**
 * Chart-shaped skeleton placeholder (bar, pie/donut, or area silhouette) with reserved height.
 */
export const ChartSkeleton: React.FC<{
  variant?: 'bar' | 'pie' | 'area';
  heightClass?: string;
  withTable?: boolean;
}> = ({ variant = 'bar', heightClass = 'h-64', withTable = false }) => {
  const { t } = useApp();
  const barHeights = ['42%', '74%', '58%', '88%', '46%', '66%', '35%'];

  return (
    <div role="status" aria-live="polite" aria-busy="true" className="space-y-3">
      <span className="sr-only">{t('loading')}</span>
      <div
        className={`${heightClass} w-full rounded-xl bg-slate-950/50 border border-slate-800/70 p-4 flex items-end justify-around gap-3 animate-pulse motion-reduce:animate-none`}
      >
        {variant === 'pie' ? (
          <div className="w-full h-full flex items-center justify-center">
            <div className="w-36 h-36 rounded-full border-[14px] border-slate-800 bg-slate-950" />
          </div>
        ) : variant === 'area' ? (
          <div className="w-full h-full flex flex-col justify-end gap-2">
            <div className="h-24 w-full rounded-t-xl bg-gradient-to-t from-slate-800/30 to-slate-800/70" />
            <div className="h-2 w-full bg-slate-800 rounded" />
          </div>
        ) : (
          barHeights.map((h, i) => (
            <div
              key={i}
              className="flex-1 max-w-[38px] bg-slate-800/80 rounded-t-md"
              style={{ height: h }}
            />
          ))
        )}
      </div>

      {withTable && (
        <div className="rounded-lg border border-slate-800 p-2.5 space-y-2 animate-pulse motion-reduce:animate-none">
          {Array.from({ length: 3 }).map((_, idx) => (
            <div key={idx} className="flex items-center justify-between gap-3">
              <div className="h-3 w-1/3 bg-slate-800 rounded" />
              <div className="h-3 w-1/5 bg-slate-800 rounded" />
              <div className="h-3 w-1/6 bg-slate-800 rounded" />
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

/**
 * Table skeleton rows with customizable column count & density.
 */
export const TableSkeletonRows: React.FC<{ columns: number; rows?: number }> = ({
  columns,
  rows = 6,
}) => {
  return (
    <>
      {Array.from({ length: rows }).map((_, rIdx) => (
        <tr key={rIdx} className="animate-pulse motion-reduce:animate-none">
          {Array.from({ length: columns }).map((__, cIdx) => (
            <td key={cIdx} className="px-4 py-3">
              <div
                className="h-4 bg-slate-800 rounded"
                style={{ width: `${55 + ((rIdx * 17 + cIdx * 23) % 35)}%` }}
              />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
};

/**
 * Inline filter/dropdown loading placeholder.
 */
export const FilterOptionsSkeleton: React.FC<{ items?: number; columnsClass?: string }> = ({
  items = 6,
  columnsClass = 'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2',
}) => {
  const { t } = useApp();
  return (
    <div role="status" aria-live="polite" aria-busy="true" className={columnsClass}>
      <span className="sr-only">{t('loadingOptions')}</span>
      {Array.from({ length: items }).map((_, idx) => (
        <div
          key={idx}
          className="h-10 rounded-lg bg-slate-950/70 border border-slate-800 px-3 flex items-center gap-2 animate-pulse motion-reduce:animate-none"
        >
          <div className="w-3.5 h-3.5 rounded bg-slate-800 shrink-0" />
          <div className="h-3 flex-1 bg-slate-800 rounded" />
        </div>
      ))}
    </div>
  );
};

/**
 * Modal / detail drawer skeleton for dynamic schema & record metadata loading.
 */
export const ModalContentSkeleton: React.FC<{ fields?: number; label?: string }> = ({
  fields = 6,
  label,
}) => {
  const { t } = useApp();
  return (
    <div role="status" aria-live="polite" aria-busy="true" className="p-6 space-y-4">
      <div className="flex items-center gap-2 text-xs text-indigo-300">
        <RefreshCw className="w-3.5 h-3.5 animate-spin motion-reduce:animate-none text-indigo-400" />
        <span>{label || t('loadingSchema')}</span>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 animate-pulse motion-reduce:animate-none">
        {Array.from({ length: fields }).map((_, idx) => (
          <div key={idx} className="space-y-1.5">
            <div className="h-3 w-24 bg-slate-800 rounded" />
            <div className="h-9 w-full bg-slate-950 border border-slate-800 rounded-lg" />
          </div>
        ))}
      </div>
    </div>
  );
};

/**
 * Standard Empty State panel when an async query completes cleanly with 0 records.
 */
export const EmptyStateCard: React.FC<{
  title?: string;
  description?: string;
  icon?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}> = ({ title, description, icon, action, className = '' }) => {
  const { t } = useApp();
  return (
    <div
      className={`flex flex-col items-center justify-center text-center gap-2 p-6 rounded-xl bg-slate-950/40 border border-slate-800/70 text-slate-400 ${className}`}
    >
      <div className="w-10 h-10 rounded-full bg-slate-900 border border-slate-800 flex items-center justify-center text-slate-500">
        {icon || <Inbox className="w-5 h-5" />}
      </div>
      <div className="text-xs font-semibold text-slate-300">{title || t('noRecordsTitle')}</div>
      {description !== '' && (
        <p className="text-[11px] text-slate-500 max-w-md">{description || t('noRecordsHint')}</p>
      )}
      {action && <div className="mt-1">{action}</div>}
    </div>
  );
};

/**
 * Standard Error State panel with working Retry button so users never hit an infinite spinner or blank screen.
 */
export const ErrorRetryCard: React.FC<{
  title?: string;
  message?: string | null;
  onRetry?: () => void;
  compact?: boolean;
  className?: string;
}> = ({ title, message, onRetry, compact = false, className = '' }) => {
  const { t } = useApp();
  return (
    <div
      role="alert"
      className={`flex ${
        compact ? 'flex-row items-center justify-between gap-3 p-3' : 'flex-col items-center justify-center text-center gap-2.5 p-6'
      } rounded-xl bg-rose-950/25 border border-rose-800/50 text-rose-200 ${className}`}
    >
      <div className={`flex items-center gap-2.5 ${compact ? 'min-w-0' : 'flex-col'}`}>
        <div className="w-8 h-8 rounded-full bg-rose-950/80 border border-rose-800/60 flex items-center justify-center text-rose-400 shrink-0">
          <AlertTriangle className="w-4 h-4" />
        </div>
        <div className="min-w-0">
          <div className="text-xs font-bold text-rose-200">{title || t('loadErrorTitle')}</div>
          <p className="text-[11px] text-rose-300/80 mt-0.5 break-words">
            {message || t('loadErrorGeneric')}
          </p>
        </div>
      </div>

      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-rose-600/80 hover:bg-rose-500 text-white text-xs font-semibold shrink-0 transition-colors"
        >
          <RotateCcw className="w-3.5 h-3.5" />
          <span>{t('retry')}</span>
        </button>
      )}
    </div>
  );
};

/**
 * Map overlay handling initial data skeleton, background refresh badge, tile loading badge,
 * tile failure warning with retry, data error retry, and valid empty-state overlay.
 */
export const MapStatusOverlay: React.FC<{
  dataLoading?: boolean;
  dataRefreshing?: boolean;
  dataError?: string | null;
  onRetryData?: () => void;
  isEmpty?: boolean;
  emptyLabel?: string;
  tilesLoading?: boolean;
  tileError?: boolean;
  onRetryTiles?: () => void;
}> = ({
  dataLoading = false,
  dataRefreshing = false,
  dataError = null,
  onRetryData,
  isEmpty = false,
  emptyLabel,
  tilesLoading = false,
  tileError = false,
  onRetryTiles,
}) => {
  const { t } = useApp();

  return (
    <>
      {/* Initial data loading overlay covering map viewport before first coordinate batch arrives */}
      {dataLoading && (
        <div
          role="status"
          aria-live="polite"
          aria-busy="true"
          className="absolute inset-0 z-[450] bg-slate-950/80 backdrop-blur-[2px] flex flex-col items-center justify-center gap-3 p-6 text-center"
        >
          <div className="w-11 h-11 rounded-full bg-indigo-950/80 border border-indigo-700/50 flex items-center justify-center text-indigo-300">
            <RefreshCw className="w-5 h-5 animate-spin motion-reduce:animate-none" />
          </div>
          <div className="space-y-1">
            <p className="text-xs font-semibold text-slate-200">{t('loadingMapData')}</p>
            <p className="text-[11px] text-slate-400">{t('loading')}</p>
          </div>
        </div>
      )}

      {/* Data fetch error overlay */}
      {!dataLoading && dataError && (
        <div className="absolute inset-0 z-[450] bg-slate-950/80 backdrop-blur-[2px] flex items-center justify-center p-6">
          <div className="max-w-md w-full">
            <ErrorRetryCard
              title={t('mapDataError')}
              message={dataError}
              onRetry={onRetryData}
            />
          </div>
        </div>
      )}

      {/* Valid empty state (only when not loading and no error) */}
      {!dataLoading && !dataError && isEmpty && (
        <div className="pointer-events-none absolute inset-0 z-[410] flex items-center justify-center p-4">
          <div className="px-4 py-2.5 rounded-xl bg-slate-950/85 border border-slate-800 text-xs text-slate-300 flex items-center gap-2 shadow-lg">
            <MapPin className="w-4 h-4 text-slate-400 shrink-0" />
            <span>{emptyLabel || t('noMapData')}</span>
          </div>
        </div>
      )}

      {/* Top-start status pills: refreshing coordinates / loading tiles / tile error */}
      <div className="absolute top-3 start-3 z-[460] flex flex-col gap-1.5 items-start">
        {dataRefreshing && !dataLoading && <RefreshingBadge label={t('loadingMapData')} />}

        {tilesLoading && !tileError && (
          <div
            role="status"
            aria-live="polite"
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-950/90 border border-slate-700/80 text-[11px] text-slate-300 shadow"
          >
            <RefreshCw className="w-3 h-3 animate-spin motion-reduce:animate-none text-sky-400" />
            <span>{t('loadingMapTiles')}</span>
          </div>
        )}

        {tileError && (
          <div
            role="alert"
            className="inline-flex items-center gap-2 px-2.5 py-1 rounded-lg bg-amber-950/90 border border-amber-700/70 text-[11px] text-amber-200 shadow"
          >
            <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0" />
            <span>{t('mapTilesUnavailable')}</span>
            {onRetryTiles && (
              <button
                type="button"
                onClick={onRetryTiles}
                className="px-2 py-0.5 rounded bg-amber-600 hover:bg-amber-500 text-white font-semibold text-[10px]"
              >
                {t('retry')}
              </button>
            )}
          </div>
        )}
      </div>
    </>
  );
};
