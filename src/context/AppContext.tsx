import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { translations, Language } from '../locales/translations.js';
import { User, NotificationItem, MissionItem, Role } from '../types/index.js';
import { requestCache } from '../utils/requestCache.js';

interface AppContextType {
  language: Language;
  setLanguage: (lang: Language) => void;
  t: (key: keyof typeof translations['en']) => string;
  theme: 'dark' | 'light';
  toggleTheme: () => void;
  activeMission: string;
  setActiveMission: (m: string) => void;
  missions: MissionItem[];
  missionsList: string[];
  missionsLoading: boolean;
  missionsError: string | null;
  refreshMissions: () => void;
  globalSearch: string;
  setGlobalSearch: (q: string) => void;
  currentUser: User | null;
  setCurrentUser: (u: User | null) => void;
  authToken: string | null;
  authLoading: boolean;
  authError: string | null;
  retryAuth: () => void;
  login: (username: string, password: string) => Promise<void>;
  logout: () => void;
  switchRole: (role: Role) => Promise<void>;
  apiFetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
  quickImportOpen: boolean;
  setQuickImportOpen: (open: boolean) => void;
  notifications: NotificationItem[];
  addNotification: (n: Omit<NotificationItem, 'id' | 'timestamp' | 'read'>) => void;
  markNotificationsAsRead: () => void;
}

const AppContext = createContext<AppContextType | undefined>(undefined);

export const AppProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [language, setLanguageState] = useState<Language>(() => {
    return (localStorage.getItem('app_lang') as Language) || 'en';
  });

  const [theme, setThemeState] = useState<'dark' | 'light'>(() => {
    return (localStorage.getItem('app_theme') as 'dark' | 'light') || 'dark';
  });

  const [activeMission, setActiveMission] = useState<string>('ALL');
  const [missions, setMissions] = useState<MissionItem[]>([]);
  const [missionsLoading, setMissionsLoading] = useState<boolean>(false);
  const [missionsError, setMissionsError] = useState<string | null>(null);
  const [globalSearch, setGlobalSearch] = useState<string>('');
  const [quickImportOpen, setQuickImportOpen] = useState<boolean>(false);

  const [authToken, setAuthToken] = useState<string | null>(() => localStorage.getItem('app_jwt_token'));
  const [authLoading, setAuthLoading] = useState<boolean>(() => Boolean(localStorage.getItem('app_jwt_token')));
  const [authError, setAuthError] = useState<string | null>(null);

  const [currentUser, setCurrentUser] = useState<User | null>(() => {
    const saved = localStorage.getItem('app_user');
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch {
        return null;
      }
    }
    return null;
  });

  const [notifications, setNotifications] = useState<NotificationItem[]>([
    {
      id: '1',
      title: 'Database Synchronized',
      message: 'Phase 2 Mission-ID schema, analytics aggregations, and reporting engine ready.',
      type: 'success',
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      read: false,
    },
  ]);

  const missionsAbortRef = useRef<AbortController | null>(null);
  const missionsSeqRef = useRef(0);

  // Sync Language and Direction
  useEffect(() => {
    localStorage.setItem('app_lang', language);
    document.documentElement.lang = language;
    document.documentElement.dir = language === 'ar' ? 'rtl' : 'ltr';
  }, [language]);

  // Sync Theme
  useEffect(() => {
    localStorage.setItem('app_theme', theme);
    if (theme === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [theme]);

  const clearSessionState = useCallback(() => {
    if (missionsAbortRef.current) {
      missionsAbortRef.current.abort();
    }
    requestCache.clear();
    localStorage.removeItem('app_jwt_token');
    localStorage.removeItem('app_user');
    setAuthToken(null);
    setCurrentUser(null);
    setMissions([]);
    setMissionsError(null);
    setMissionsLoading(false);
    setActiveMission('ALL');
    setQuickImportOpen(false);
  }, []);

  // Restore/validate existing session token on load
  useEffect(() => {
    if (!authToken) {
      setAuthLoading(false);
      return;
    }
    const controller = new AbortController();
    setAuthLoading(true);
    setAuthError(null);
    fetch('/api/v1/auth/me', {
      headers: { Authorization: `Bearer ${authToken}` },
      signal: controller.signal,
    })
      .then(async res => {
        const json = await res.json().catch(() => null);
        if (!res.ok) throw new Error(json?.error || 'Session expired');
        return json as User;
      })
      .then(user => {
        if (controller.signal.aborted) return;
        setCurrentUser(user);
        localStorage.setItem('app_user', JSON.stringify(user));
      })
      .catch(err => {
        if (controller.signal.aborted || err?.name === 'AbortError') return;
        clearSessionState();
        setAuthError(null);
      })
      .finally(() => {
        if (!controller.signal.aborted) setAuthLoading(false);
      });
    return () => controller.abort();
  }, [authToken, clearSessionState]);

  const login = useCallback(async (username: string, password: string) => {
    setAuthLoading(true);
    setAuthError(null);
    try {
      const res = await fetch('/api/v1/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(json?.error || 'Invalid credentials');
      }
      if (!json?.token || !json?.user) {
        throw new Error('Invalid login response');
      }
      requestCache.clear();
      localStorage.setItem('app_jwt_token', json.token);
      localStorage.setItem('app_user', JSON.stringify(json.user));
      setCurrentUser(json.user);
      setAuthToken(json.token);
    } finally {
      setAuthLoading(false);
    }
  }, []);

  const retryAuth = useCallback(() => {
    setAuthError(null);
  }, []);

  const logout = useCallback(() => {
    const tok = authToken || localStorage.getItem('app_jwt_token');
    if (tok) {
      fetch('/api/v1/auth/logout', {
        method: 'POST',
        headers: { Authorization: `Bearer ${tok}` },
      }).catch(() => {});
    }
    clearSessionState();
    setAuthError(null);
    setAuthLoading(false);
  }, [authToken, clearSessionState]);

  const switchRole = useCallback(async (role: Role) => {
    const res = await fetch('/api/v1/auth/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role }),
    });
    if (res.ok) {
      const json = await res.json();
      requestCache.clear();
      localStorage.setItem('app_jwt_token', json.token);
      localStorage.setItem('app_user', JSON.stringify(json.user));
      setAuthToken(json.token);
      setCurrentUser(json.user);
    }
  }, []);

  const apiFetch = useCallback(
    async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const headers = new Headers(init.headers || {});
      const tok = authToken || localStorage.getItem('app_jwt_token');
      if (tok && !headers.has('Authorization')) {
        headers.set('Authorization', `Bearer ${tok}`);
      }
      return fetch(input, { ...init, headers });
    },
    [authToken]
  );

  const refreshMissions = useCallback(() => {
    const tok = authToken || localStorage.getItem('app_jwt_token');
    if (!tok) return;

    if (missionsAbortRef.current) {
      missionsAbortRef.current.abort();
    }
    const controller = new AbortController();
    missionsAbortRef.current = controller;
    const seq = ++missionsSeqRef.current;

    setMissionsLoading(true);
    setMissionsError(null);
    requestCache.invalidate('dashboard:');

    apiFetch('/api/v1/tables/missions?pageSize=200', { signal: controller.signal })
      .then(async r => {
        const json = await r.json().catch(() => null);
        if (!r.ok) {
          throw new Error(json?.error || 'Failed to load missions');
        }
        return json;
      })
      .then(res => {
        if (controller.signal.aborted || seq !== missionsSeqRef.current) return;
        if (res?.data && Array.isArray(res.data)) {
          setMissions(res.data);
        } else {
          setMissions([]);
        }
      })
      .catch(err => {
        if (controller.signal.aborted || err?.name === 'AbortError' || seq !== missionsSeqRef.current) return;
        setMissionsError(err?.message || 'Failed to load missions');
      })
      .finally(() => {
        if (!controller.signal.aborted && seq === missionsSeqRef.current) {
          setMissionsLoading(false);
        }
      });
  }, [authToken, apiFetch]);

  useEffect(() => {
    if (authToken) {
      refreshMissions();
    }
    return () => {
      if (missionsAbortRef.current) {
        missionsAbortRef.current.abort();
      }
    };
  }, [authToken, refreshMissions]);

  const missionsList = missions.map(m => String(m.id));

  const setLanguage = (lang: Language) => setLanguageState(lang);
  const toggleTheme = () => setThemeState(prev => (prev === 'dark' ? 'light' : 'dark'));

  const t = (key: keyof typeof translations['en']): string => {
    const dict = translations[language] || translations.en;
    return dict[key] || translations.en[key] || String(key);
  };

  const addNotification = (n: Omit<NotificationItem, 'id' | 'timestamp' | 'read'>) => {
    const item: NotificationItem = {
      ...n,
      id: String(Date.now()),
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      read: false,
    };
    setNotifications(prev => [item, ...prev]);
  };

  const markNotificationsAsRead = () => {
    setNotifications(prev => prev.map(n => ({ ...n, read: true })));
  };

  return (
    <AppContext.Provider
      value={{
        language,
        setLanguage,
        t,
        theme,
        toggleTheme,
        activeMission,
        setActiveMission,
        missions,
        missionsList,
        missionsLoading,
        missionsError,
        refreshMissions,
        globalSearch,
        setGlobalSearch,
        currentUser,
        setCurrentUser,
        authToken,
        authLoading,
        authError,
        retryAuth,
        login,
        logout,
        switchRole,
        apiFetch,
        quickImportOpen,
        setQuickImportOpen,
        notifications,
        addNotification,
        markNotificationsAsRead,
      }}
    >
      {children}
    </AppContext.Provider>
  );
};

export const useApp = () => {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used within AppProvider');
  return ctx;
};
