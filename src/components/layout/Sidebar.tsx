import React, { useState } from 'react';
import { useApp } from '../../context/AppContext.js';
import {
  LayoutDashboard,
  MapPin,
  BarChart3,
  Crosshair,
  Radio,
  Wifi,
  Users,
  Navigation,
  Database,
  Layers,
  FileSpreadsheet,
  FileUp,
  FileDown,
  ShieldAlert,
  Settings,
  HardDrive,
  BookOpen,
  CheckCircle2,
  PhoneCall,
  Activity,
  CalendarClock,
  Compass,
  FileText,
  Search,
  ChevronDown,
  ChevronRight,
  Menu,
  X,
  Target,
  Circle,
  Shapes,
  FolderArchive,
  Cpu,
} from 'lucide-react';

interface SidebarProps {
  currentPage: string;
  onNavigate: (page: string) => void;
  isOpenMobile: boolean;
  onCloseMobile: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  currentPage,
  onNavigate,
  isOpenMobile,
  onCloseMobile,
}) => {
  const { t } = useApp();
  const [navSearch, setNavSearch] = useState('');
  const [collapsedSections, setCollapsedSections] = useState<Record<string, boolean>>({});

  const toggleSection = (secKey: string) => {
    setCollapsedSections(prev => ({ ...prev, [secKey]: !prev[secKey] }));
  };

  const navSections = [
    {
      key: 'overview',
      title: t('sectionOverview'),
      items: [
        { id: 'dashboard', label: t('navDashboard'), icon: LayoutDashboard },
        { id: 'interactive-map', label: t('navInteractiveMap'), icon: MapPin },
        { id: 'analytics', label: t('navAnalytics'), icon: BarChart3 },
      ],
    },
    {
      key: 'operations',
      title: t('sectionOperations'),
      items: [
        { id: 'missions', label: t('navMissions'), icon: Target },
        { id: 'registrations', label: t('navRegistrations'), icon: Users },
        { id: 'targets', label: t('navTargets'), icon: Crosshair },
        { id: 'mission-extras', label: t('navMissionExtras'), icon: FileText },
        { id: 'location-extras', label: t('navLocationExtras'), icon: MapPin },
        { id: 'mission-files', label: t('navMissionFiles'), icon: FolderArchive },
        { id: 'location-files', label: t('navLocationFiles'), icon: FileSpreadsheet },
      ],
    },
    {
      key: 'signals',
      title: t('sectionSignals'),
      items: [
        { id: 'network-cells', label: t('navNetworkCells'), icon: Radio },
        { id: 'wifi-access-points', label: t('navWifiAccessPoints'), icon: Wifi },
        { id: 'wifi-access-point-clients', label: t('navWifiClients'), icon: Cpu },
        { id: 'gps-history', label: t('navGpsHistory'), icon: Navigation },
        { id: 'sms-calls', label: t('navSmsCalls'), icon: PhoneCall },
      ],
    },
    {
      key: 'geocells',
      title: t('sectionGeoCells'),
      items: [
        { id: 'map-cell-databases', label: t('navMapCellDatabases'), icon: Database },
        { id: 'map-cells', label: t('navMapCells'), icon: Radio },
        { id: 'plmn-storage', label: t('navPlmnStorage'), icon: BookOpen },
        { id: 'map-layers', label: t('navMapLayers'), icon: Layers },
      ],
    },
    {
      key: 'mapfeatures',
      title: t('sectionMapFeatures'),
      items: [
        { id: 'map-user-markers', label: t('navMapUserMarkers'), icon: Compass },
        { id: 'map-user-polygons', label: t('navMapUserPolygons'), icon: Shapes },
        { id: 'map-user-circles', label: t('navMapUserCircles'), icon: Circle },
      ],
    },
    {
      key: 'reference',
      title: t('sectionReference'),
      items: [
        { id: 'target-files', label: t('navTargetFiles'), icon: FolderArchive },
        { id: 'whitelist-targets', label: t('navWhitelistTargets'), icon: CheckCircle2 },
        { id: 'tac-numbers', label: t('navTacNumbers'), icon: Cpu },
        { id: 'scheduled-tasks', label: t('navScheduledTasks'), icon: CalendarClock },
      ],
    },
    {
      key: 'datamgmt',
      title: t('sectionDataManagement'),
      items: [
        { id: 'import-center', label: t('navImportCenter'), icon: FileUp },
        { id: 'export-center', label: t('navExportCenter'), icon: FileDown },
        { id: 'data-quality', label: t('navDataQuality'), icon: CheckCircle2 },
        { id: 'data-dictionary', label: t('navDataDictionary'), icon: BookOpen },
      ],
    },
    {
      key: 'administration',
      title: t('sectionAdministration'),
      items: [
        { id: 'users', label: t('navUserManagement'), icon: Users },
        { id: 'audit-logs', label: t('navAuditLogs'), icon: ShieldAlert },
        { id: 'system-health', label: t('navSystemHealth'), icon: Activity },
        { id: 'backup-recovery', label: t('navBackupRecovery'), icon: HardDrive },
        { id: 'settings', label: t('navSettings'), icon: Settings },
      ],
    },
  ];

  const filteredSections = navSections.map(sec => {
    if (!navSearch.trim()) return sec;
    const items = sec.items.filter(item =>
      item.label.toLowerCase().includes(navSearch.toLowerCase()) ||
      item.id.toLowerCase().includes(navSearch.toLowerCase())
    );
    return { ...sec, items };
  }).filter(sec => sec.items.length > 0);

  return (
    <>
      {/* Mobile Backdrop */}
      {isOpenMobile && (
        <div
          onClick={onCloseMobile}
          className="fixed inset-0 bg-slate-950/70 backdrop-blur-sm z-40 lg:hidden"
        />
      )}

      {/* Sidebar Container */}
      <aside
        className={`fixed top-0 bottom-0 start-0 z-50 flex flex-col w-72 bg-slate-900 ltr:border-r rtl:border-l border-slate-800 text-slate-200 transition-transform duration-300 ease-in-out lg:translate-x-0 ${
          isOpenMobile
            ? 'translate-x-0'
            : 'ltr:-translate-x-full rtl:translate-x-full lg:translate-x-0'
        }`}
      >
        {/* Brand Header */}
        <div className="flex items-center justify-between h-16 px-4 bg-slate-950/50 border-b border-slate-800/80">
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center w-9 h-9 rounded-lg bg-gradient-to-tr from-indigo-600 to-indigo-400 text-white shadow-md shadow-indigo-500/20">
              <Radio className="w-5 h-5" />
            </div>
            <div className="overflow-hidden">
              <span className="block text-sm font-bold tracking-tight text-white truncate">
                ENTERPRISE
              </span>
              <span className="block text-xs text-indigo-400 font-medium">
                Mission Intelligence
              </span>
            </div>
          </div>
          <button
            onClick={onCloseMobile}
            className="p-1 rounded-md text-slate-400 hover:text-white hover:bg-slate-800 lg:hidden"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Search Navigation Filter */}
        <div className="p-3 border-b border-slate-800/50">
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 w-4 h-4 text-slate-500 rtl:right-2.5 rtl:left-auto" />
            <input
              type="text"
              value={navSearch}
              onChange={e => setNavSearch(e.target.value)}
              placeholder={t('search') + '...'}
              className="w-full h-9 pl-9 pr-3 rtl:pr-9 rtl:pl-3 text-xs bg-slate-950/60 border border-slate-800 rounded-md text-slate-200 placeholder-slate-500 focus:outline-none focus:border-indigo-500 transition-colors"
            />
          </div>
        </div>

        {/* Scrollable Navigation Items */}
        <div className="flex-1 overflow-y-auto px-2 py-3 space-y-4">
          {filteredSections.map(sec => {
            const isCollapsed = !!collapsedSections[sec.key];
            return (
              <div key={sec.key} className="space-y-1">
                <button
                  type="button"
                  onClick={() => toggleSection(sec.key)}
                  className="w-full flex items-center justify-between px-2.5 py-1 text-xs font-semibold uppercase tracking-wider text-slate-400 hover:text-slate-200"
                >
                  <span>{sec.title}</span>
                  {isCollapsed ? (
                    <ChevronRight className="w-3.5 h-3.5" />
                  ) : (
                    <ChevronDown className="w-3.5 h-3.5" />
                  )}
                </button>

                {!isCollapsed && (
                  <div className="space-y-0.5 mt-1">
                    {sec.items.map(item => {
                      const Icon = item.icon;
                      const isActive = currentPage === item.id;
                      return (
                        <button
                          key={item.id}
                          type="button"
                          onClick={() => {
                            onNavigate(item.id);
                            onCloseMobile();
                          }}
                          className={`w-full flex items-center gap-3 px-3 py-2 text-xs font-medium rounded-lg transition-all ${
                            isActive
                              ? 'bg-indigo-600 text-white shadow-sm shadow-indigo-600/30'
                              : 'text-slate-300 hover:bg-slate-800/60 hover:text-white'
                          }`}
                        >
                          <Icon className={`w-4 h-4 shrink-0 ${isActive ? 'text-white' : 'text-slate-400'}`} />
                          <span className="truncate text-start flex-1">{item.label}</span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Sidebar Footer */}
        <div className="p-3 border-t border-slate-800/80 bg-slate-950/40">
          <div className="flex items-center gap-2.5 text-xs text-slate-400">
            <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            <span className="truncate">PostgreSQL Engine v16.4</span>
            <span className="ml-auto text-[10px] bg-slate-800 px-1.5 py-0.5 rounded text-slate-400">
              v2.5
            </span>
          </div>
        </div>
      </aside>
    </>
  );
};
