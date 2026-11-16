import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { translations, Language } from '../locales/translations.js';
import { User, NotificationItem, MissionItem, Role } from '../types/index.js';

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
  refreshMissions: () => void;
  globalSearch: string;
  setGlobalSearch: (q: string) => void;
  currentUser: User | null;
  setCurrentUser: (u: User | null) => void;
  authToken: string | null;
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
  const [globalSearch, setGlobalSearch] = useState<string>('');
  const [quickImportOpen, setQuickImportOpen] = useState<boolean>(false);

  const [authToken, setAuthToken] = useState<string | null>(() => localStorage.getItem('app_jwt_token'));
  const [currentUser, setCurrentUser] = useState<User | null>(() => {
    const saved = localStorage.getItem('app_user');
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch {
        return null;
      }
    }
    return {
      id: 1,
      username: 'admin',
      email: 'admin@enterprise.local',
      fullName: 'System Administrator',
      role: 'SUPER_ADMIN',
      status: 'ACTIVE',
    };
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

  // Initialize authenticated JWT session if not present
  useEffect(() => {
    if (!authToken) {
      fetch('/api/v1/auth/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: 'SUPER_ADMIN' }),
      })
        .then(r => (r.ok ? r.json() : null))
        .then(res => {
          if (res?.token && res?.user) {
            localStorage.setItem('app_jwt_token', res.token);
            localStorage.setItem('app_user', JSON.stringify(res.user));
            setAuthToken(res.token);
            setCurrentUser(res.user);
          }
        })
        .catch(() => {});
    }
  }, [authToken]);

  const switchRole = useCallback(async (role: Role) => {
    const res = await fetch('/api/v1/auth/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role }),
    });
    if (res.ok) {
      const json = await res.json();
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
    apiFetch('/api/v1/tables/missions?pageSize=200')
      .then(r => (r.ok ? r.json() : null))
      .then(res => {
        if (res?.data && Array.isArray(res.data)) {
          setMissions(res.data);
        }
      })
      .catch(() => {});
  }, [authToken, apiFetch]);

  useEffect(() => {
    if (authToken) {
      refreshMissions();
    }
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
        refreshMissions,
        globalSearch,
        setGlobalSearch,
        currentUser,
        setCurrentUser,
        authToken,
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
