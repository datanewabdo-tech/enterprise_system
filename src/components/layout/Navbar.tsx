import React, { useState } from 'react';
import { useApp } from '../../context/AppContext.js';
import {
  Search,
  Globe,
  Sun,
  Moon,
  Bell,
  Upload,
  User as UserIcon,
  Menu,
  ShieldCheck,
  CheckCircle,
  Filter,
  RefreshCw,
  RotateCcw,
  LogOut,
} from 'lucide-react';

interface NavbarProps {
  currentPage: string;
  onOpenMobileSidebar: () => void;
}

export const Navbar: React.FC<NavbarProps> = ({ currentPage, onOpenMobileSidebar }) => {
  const {
    t,
    language,
    setLanguage,
    theme,
    toggleTheme,
    activeMission,
    setActiveMission,
    missions,
    missionsLoading,
    missionsError,
    refreshMissions,
    globalSearch,
    setGlobalSearch,
    setQuickImportOpen,
    notifications,
    markNotificationsAsRead,
    currentUser,
    switchRole,
    logout,
  } = useApp();

  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [switchingRole, setSwitchingRole] = useState(false);

  const unreadCount = notifications.filter(n => !n.read).length;

  const formatPageTitle = (id: string) => {
    return id
      .split('-')
      .map(w => w.charAt(0).toUpperCase() + w.slice(1))
      .join(' ');
  };

  return (
    <header className="sticky top-0 z-30 flex items-center justify-between h-16 px-4 md:px-6 bg-slate-900/95 backdrop-blur border-b border-slate-800 text-slate-100">
      {/* Left: Mobile hamburger & Breadcrumb */}
      <div className="flex items-center gap-3">
        <button
          onClick={onOpenMobileSidebar}
          className="p-2 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 lg:hidden"
        >
          <Menu className="w-5 h-5" />
        </button>

        <nav className="hidden sm:flex items-center gap-2 text-xs text-slate-400">
          <span className="hover:text-slate-200">{t('systemBreadcrumb')}</span>
          <span>/</span>
          <span className="font-semibold text-indigo-400">{formatPageTitle(currentPage)}</span>
        </nav>
      </div>

      {/* Center: Global Search & Mission Filter */}
      <div className="flex items-center gap-3 flex-1 max-w-xl mx-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-2.5 w-4 h-4 text-slate-400 rtl:right-3 rtl:left-auto" />
          <input
            type="text"
            value={globalSearch}
            onChange={e => setGlobalSearch(e.target.value)}
            placeholder={t('globalSearchPlaceholder')}
            className="w-full h-9 pl-9 pr-3 rtl:pr-9 rtl:pl-3 text-xs bg-slate-950/70 border border-slate-800 rounded-lg text-slate-100 placeholder-slate-500 focus:outline-none focus:border-indigo-500 transition-colors"
          />
        </div>

        {/* Mission Selector (disambiguates duplicate mission labels via ID & Location) */}
        <div className="hidden md:flex items-center gap-1.5 shrink-0">
          {missionsLoading ? (
            <RefreshCw className="w-3.5 h-3.5 text-indigo-400 animate-spin motion-reduce:animate-none" />
          ) : (
            <Filter className="w-3.5 h-3.5 text-indigo-400" />
          )}
          <select
            aria-label={t('filterByMission')}
            aria-busy={missionsLoading}
            disabled={missionsLoading && missions.length === 0}
            value={activeMission}
            onChange={e => setActiveMission(e.target.value)}
            className="h-9 px-2.5 max-w-[230px] text-xs bg-slate-950/70 border border-slate-800 rounded-lg text-slate-200 focus:outline-none focus:border-indigo-500 cursor-pointer disabled:opacity-60"
          >
            <option value="ALL">
              {missionsLoading && missions.length === 0 ? t('loadingOptions') : t('allMissions')}
            </option>
            {missions.map(m => (
              <option key={m.id} value={String(m.id)}>
                {m.mission} — {m.location} (#{m.id})
              </option>
            ))}
          </select>
          {missionsError && (
            <button
              type="button"
              onClick={refreshMissions}
              title={`${t('dropdownUnavailable')} — ${t('retry')}`}
              className="p-1.5 rounded-lg bg-rose-950/50 border border-rose-800/60 text-rose-300 hover:bg-rose-900/60"
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Right Controls */}
      <div className="flex items-center gap-1.5 md:gap-2">
        <button
          onClick={() => setQuickImportOpen(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white shadow-sm shadow-indigo-500/20 transition-colors"
          title={t('quickImport')}
        >
          <Upload className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">{t('quickImport')}</span>
        </button>

        {/* Notifications Popover */}
        <div className="relative">
          <button
            onClick={() => setNotificationsOpen(!notificationsOpen)}
            className="relative p-2 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition-colors"
            title={t('notifications')}
          >
            <Bell className="w-4 h-4" />
            {unreadCount > 0 && (
              <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-rose-500" />
            )}
          </button>

          {notificationsOpen && (
            <div className="absolute right-0 rtl:left-0 rtl:right-auto mt-2 w-80 bg-slate-900 border border-slate-800 rounded-xl shadow-xl py-2 z-50">
              <div className="flex items-center justify-between px-3 pb-2 border-b border-slate-800">
                <span className="text-xs font-semibold text-slate-200">{t('notifications')}</span>
                {unreadCount > 0 && (
                  <button
                    onClick={markNotificationsAsRead}
                    className="text-[10px] text-indigo-400 hover:underline"
                  >
                    {t('markAllRead')}
                  </button>
                )}
              </div>
              <div className="max-h-64 overflow-y-auto divide-y divide-slate-800/50">
                {notifications.length === 0 ? (
                  <div className="p-4 text-center text-xs text-slate-500">
                    {t('noNotifications')}
                  </div>
                ) : (
                  notifications.map(n => (
                    <div key={n.id} className="p-3 text-xs hover:bg-slate-800/40">
                      <div className="flex items-center justify-between text-slate-300 font-medium">
                        <span>{n.title}</span>
                        <span className="text-[10px] text-slate-500">{n.timestamp}</span>
                      </div>
                      <p className="mt-1 text-slate-400 text-[11px] leading-relaxed">{n.message}</p>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
        </div>

        {/* Language Switcher */}
        <button
          onClick={() => setLanguage(language === 'en' ? 'ar' : 'en')}
          className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-slate-300 hover:text-white rounded-lg hover:bg-slate-800 border border-slate-800 transition-colors"
          title={t('languageSwitchTitle')}
        >
          <Globe className="w-3.5 h-3.5 text-indigo-400" />
          <span>{language === 'en' ? t('languageSwitchToArabic') : t('languageSwitchToEnglish')}</span>
        </button>

        {/* Dark/Light Mode Toggle */}
        <button
          onClick={toggleTheme}
          className="p-2 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition-colors"
          title={theme === 'dark' ? t('lightMode') : t('darkMode')}
        >
          {theme === 'dark' ? <Sun className="w-4 h-4 text-amber-400" /> : <Moon className="w-4 h-4 text-indigo-400" />}
        </button>

        {/* User Profile & Role Switcher */}
        <div className="relative ml-1">
          <button
            onClick={() => setProfileOpen(!profileOpen)}
            className="flex items-center gap-2 p-1.5 rounded-lg hover:bg-slate-800 transition-colors"
          >
            <div className="flex items-center justify-center w-7 h-7 rounded-full bg-indigo-600/30 border border-indigo-500/40 text-indigo-300">
              <UserIcon className="w-4 h-4" />
            </div>
            <div className="hidden xl:block text-start">
              <span className="block text-xs font-semibold text-slate-200">
                {currentUser?.fullName || 'Administrator'}
              </span>
              <span className="block text-[10px] text-indigo-400">
                {currentUser?.role || 'SUPER_ADMIN'}
              </span>
            </div>
          </button>

          {profileOpen && (
            <div className="absolute right-0 rtl:left-0 rtl:right-auto mt-2 w-64 bg-slate-900 border border-slate-800 rounded-xl shadow-xl py-2 z-50">
              <div className="px-3 pb-2 border-b border-slate-800">
                <span className="block text-xs font-semibold text-slate-200">{currentUser?.fullName}</span>
                <span className="block text-[11px] text-slate-400">{currentUser?.email}</span>
                <span className="inline-block mt-1 px-1.5 py-0.5 text-[9px] font-bold rounded bg-indigo-950 text-indigo-400 border border-indigo-800">
                  {currentUser?.role}
                </span>
              </div>
              <div className="px-3 py-2 space-y-1.5">
                <div className="text-[10px] font-semibold uppercase text-slate-500">
                  {language === 'ar' ? 'تبديل الدور (RBAC)' : 'Active RBAC Role'}
                </div>
                <div className="grid grid-cols-2 gap-1">
                  {(['SUPER_ADMIN', 'DATA_MANAGER', 'DATA_ANALYST', 'VIEWER'] as const).map(r => (
                    <button
                      key={r}
                      disabled={switchingRole}
                      onClick={async () => {
                        setSwitchingRole(true);
                        try {
                          await switchRole(r);
                          setProfileOpen(false);
                        } finally {
                          setSwitchingRole(false);
                        }
                      }}
                      className={`px-2 py-1 rounded text-[10px] font-semibold border transition-colors disabled:opacity-50 ${
                        currentUser?.role === r
                          ? 'bg-indigo-600/30 border-indigo-500 text-indigo-200'
                          : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      {r}
                    </button>
                  ))}
                </div>
              </div>
              <div className="px-3 pt-2 mt-1 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => {
                    setProfileOpen(false);
                    logout();
                  }}
                  className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-xs font-semibold text-rose-300 hover:text-white hover:bg-rose-600/20 border border-rose-900/50 transition-colors"
                >
                  <LogOut className="w-3.5 h-3.5" />
                  <span>{t('logout')}</span>
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </header>
  );
};
