import { useState, useEffect, useRef, useCallback } from 'react';
import { requestCache } from '../utils/requestCache.js';

export type AsyncResourceStatus =
  | 'idle'
  | 'loading'
  | 'refreshing'
  | 'success'
  | 'empty'
  | 'error';

export interface UseAsyncResourceOptions<T> {
  /** Whether fetching is permitted (e.g. wait for auth token or modal open) */
  enabled?: boolean;
  /** Optional cache key for instant stale-while-revalidate across navigations */
  cacheKey?: string;
  /** Cache lifetime in ms (default 30s) */
  cacheTtlMs?: number;
  /** Predicate returning true when a successful response represents zero records */
  isEmpty?: (data: T) => boolean;
  /** Keep previous data visible while dependencies change (triggers 'refreshing' instead of 'loading') */
  keepPreviousData?: boolean;
}

export interface UseAsyncResourceResult<T> {
  status: AsyncResourceStatus;
  data: T | null;
  error: string | null;
  isLoading: boolean;
  isRefreshing: boolean;
  isSuccess: boolean;
  isEmpty: boolean;
  isError: boolean;
  reload: (options?: { force?: boolean }) => void;
  setData: React.Dispatch<React.SetStateAction<T | null>>;
}

/**
 * Core async resource manager handling:
 * - Automatic AbortController cancellation on unmount or dependency change
 * - Monotonic request sequence guard (stale responses never overwrite newer requests)
 * - Clean separation between initial loading, refreshing, success, empty, and error states
 * - Optional stale-while-revalidate caching
 */
export function useAsyncResource<T>(
  fetcher: (signal: AbortSignal) => Promise<T>,
  deps: React.DependencyList,
  options: UseAsyncResourceOptions<T> = {}
): UseAsyncResourceResult<T> {
  const {
    enabled = true,
    cacheKey,
    cacheTtlMs = 30_000,
    isEmpty: isEmptyPredicate,
    keepPreviousData = true,
  } = options;

  const initialCached = cacheKey ? requestCache.get<T>(cacheKey, cacheTtlMs) : undefined;

  const [data, setData] = useState<T | null>(initialCached ?? null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<AsyncResourceStatus>(() => {
    if (!enabled) return 'loading';
    if (initialCached !== undefined) {
      return isEmptyPredicate && isEmptyPredicate(initialCached) ? 'empty' : 'success';
    }
    return 'loading';
  });

  const seqRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const dataRef = useRef<T | null>(data);
  dataRef.current = data;

  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  const isEmptyRef = useRef(isEmptyPredicate);
  isEmptyRef.current = isEmptyPredicate;

  const prevCacheKeyRef = useRef(cacheKey);

  const runFetch = useCallback(
    async (force = false) => {
      if (!enabled) {
        setStatus('loading');
        return;
      }

      // Abort any previous in-flight request
      if (abortRef.current) {
        abortRef.current.abort();
      }
      const controller = new AbortController();
      abortRef.current = controller;
      const mySeq = ++seqRef.current;

      const cached = !force && cacheKey ? requestCache.get<T>(cacheKey, cacheTtlMs) : undefined;
      if (cached !== undefined) {
        dataRef.current = cached;
        setData(cached);
        setError(null);
        setStatus('refreshing');
      } else if (keepPreviousData && dataRef.current !== null && prevCacheKeyRef.current === cacheKey) {
        setError(null);
        setStatus('refreshing');
      } else {
        if (!keepPreviousData || prevCacheKeyRef.current !== cacheKey) {
          dataRef.current = null;
          setData(null);
        }
        setError(null);
        setStatus('loading');
      }
      prevCacheKeyRef.current = cacheKey;

      try {
        const result = await fetcherRef.current(controller.signal);

        // Ignore stale or aborted responses
        if (controller.signal.aborted || mySeq !== seqRef.current) {
          return;
        }

        if (cacheKey) {
          requestCache.set(cacheKey, result);
        }

        dataRef.current = result;
        setData(result);
        setError(null);

        const empty = isEmptyRef.current ? isEmptyRef.current(result) : false;
        setStatus(empty ? 'empty' : 'success');
      } catch (err: any) {
        if (controller.signal.aborted || err?.name === 'AbortError' || mySeq !== seqRef.current) {
          return;
        }
        const message = err?.message || 'Failed to load data';
        setError(message);
        setStatus('error');
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [enabled, cacheKey, cacheTtlMs, keepPreviousData, ...deps]
  );

  useEffect(() => {
    void runFetch(false);
    return () => {
      if (abortRef.current) {
        abortRef.current.abort();
      }
    };
  }, [runFetch]);

  const reload = useCallback(
    (opts?: { force?: boolean }) => {
      void runFetch(opts?.force ?? true);
    },
    [runFetch]
  );

  return {
    status,
    data,
    error,
    isLoading: status === 'loading' || status === 'idle',
    isRefreshing: status === 'refreshing',
    isSuccess: status === 'success',
    isEmpty: status === 'empty',
    isError: status === 'error',
    reload,
    setData,
  };
}
