import React, { useState } from 'react';
import { AppProvider, useApp } from './context/AppContext.js';
import { Sidebar } from './components/layout/Sidebar.js';
import { Navbar } from './components/layout/Navbar.js';
import { QuickImportModal } from './components/common/QuickImportModal.js';
import { Dashboard } from './pages/Dashboard.js';
import { InteractiveMap } from './pages/InteractiveMap.js';
import { Analytics } from './pages/Analytics.js';
import { ImportCenter } from './pages/ImportCenter.js';
import { ExportCenter } from './pages/ExportCenter.js';
import { DataQuality } from './pages/DataQuality.js';
import { DataDictionary } from './pages/DataDictionary.js';
import { UserManagement } from './pages/UserManagement.js';
import { AuditLogs } from './pages/AuditLogs.js';
import { BackupRecovery } from './pages/BackupRecovery.js';
import { SystemHealth } from './pages/SystemHealth.js';
import { Settings } from './pages/Settings.js';
import { TableView } from './pages/TableView.js';
import { Cronologs } from './pages/Cronologs.js';
import { ActivityLogs } from './pages/ActivityLogs.js';
import { GlobalSearch } from './pages/GlobalSearch.js';
import { LoginPage } from './pages/LoginPage.js';
import { PageLoadingScreen, ErrorRetryCard } from './components/common/LoadingStates.js';

// Table Configuration Metadata for all 23 Tables (localized via translations)
const TABLE_CONFIGS: Record<string, { titleKey: keyof typeof import('./locales/translations.js')['translations']['en']; descKey: keyof typeof import('./locales/translations.js')['translations']['en'] }> = {
  missions: { titleKey: 'table_missions_title', descKey: 'table_missions_desc' },
  registrations: { titleKey: 'table_registrations_title', descKey: 'table_registrations_desc' },
  targets: { titleKey: 'table_targets_title', descKey: 'table_targets_desc' },
  'mission-extras': { titleKey: 'table_mission_extras_title', descKey: 'table_mission_extras_desc' },
  'location-extras': { titleKey: 'table_location_extras_title', descKey: 'table_location_extras_desc' },
  'mission-files': { titleKey: 'table_mission_files_title', descKey: 'table_mission_files_desc' },
  'location-files': { titleKey: 'table_location_files_title', descKey: 'table_location_files_desc' },
  'network-cells': { titleKey: 'table_network_cells_title', descKey: 'table_network_cells_desc' },
  'wifi-access-points': { titleKey: 'table_wifi_access_points_title', descKey: 'table_wifi_access_points_desc' },
  'wifi-access-point-clients': { titleKey: 'table_wifi_access_point_clients_title', descKey: 'table_wifi_access_point_clients_desc' },
  'gps-history': { titleKey: 'table_gps_history_title', descKey: 'table_gps_history_desc' },
  'map-cell-databases': { titleKey: 'table_map_cell_databases_title', descKey: 'table_map_cell_databases_desc' },
  'map-cells': { titleKey: 'table_map_cells_title', descKey: 'table_map_cells_desc' },
  'plmn-storage': { titleKey: 'table_plmn_storage_title', descKey: 'table_plmn_storage_desc' },
  'sms-calls': { titleKey: 'table_sms_calls_title', descKey: 'table_sms_calls_desc' },
  'map-user-markers': { titleKey: 'table_map_user_markers_title', descKey: 'table_map_user_markers_desc' },
  'map-user-polygons': { titleKey: 'table_map_user_polygons_title', descKey: 'table_map_user_polygons_desc' },
  'map-user-circles': { titleKey: 'table_map_user_circles_title', descKey: 'table_map_user_circles_desc' },
  'target-files': { titleKey: 'table_target_files_title', descKey: 'table_target_files_desc' },
  'whitelist-targets': { titleKey: 'table_whitelist_targets_title', descKey: 'table_whitelist_targets_desc' },
  'tac-numbers': { titleKey: 'table_tac_numbers_title', descKey: 'table_tac_numbers_desc' },
  'scheduled-tasks': { titleKey: 'table_scheduled_tasks_title', descKey: 'table_scheduled_tasks_desc' },
  'map-layers': { titleKey: 'table_map_layers_title', descKey: 'table_map_layers_desc' },
};

const MainLayout: React.FC = () => {
  const { authToken, authLoading, authError, retryAuth, t } = useApp();
  const [currentPage, setCurrentPage] = useState<string>('dashboard');
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);

  if (!authToken) {
    if (authLoading) {
      return (
        <div className="min-h-screen bg-slate-950 text-slate-100">
          <PageLoadingScreen message={t('initializingSession')} />
        </div>
      );
    }
    if (authError) {
      return (
        <div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center p-4">
          <div className="w-full max-w-lg">
            <ErrorRetryCard message={authError} onRetry={retryAuth} />
          </div>
        </div>
      );
    }
    return <LoginPage />;
  }

  const renderCurrentPage = () => {

    switch (currentPage) {
      case 'dashboard':
        return <Dashboard onNavigate={setCurrentPage} />;
      case 'interactive-map':
        return <InteractiveMap />;
      case 'analytics':
        return <Analytics />;
      case 'import-center':
        return <ImportCenter />;
      case 'export-center':
        return <ExportCenter />;
      case 'cronologs':
        return <Cronologs />;
      case 'activity-logs':
        return <ActivityLogs />;
      case 'global-search':
        return <GlobalSearch />;
      case 'data-quality':
        return <DataQuality />;
      case 'data-dictionary':
        return <DataDictionary />;
      case 'users':
        return <UserManagement />;
      case 'audit-logs':
        return <AuditLogs />;
      case 'backup-recovery':
        return <BackupRecovery />;
      case 'system-health':
        return <SystemHealth />;
      case 'settings':
        return <Settings />;
      default:
        // Render Dedicated Table View for any of the 23 tables (keyed by tableId to avoid stale flash)
        if (TABLE_CONFIGS[currentPage]) {
          const cfg = TABLE_CONFIGS[currentPage];
          return (
            <TableView
              key={currentPage}
              tableId={currentPage}
              title={t(cfg.titleKey)}
              description={t(cfg.descKey)}
            />
          );
        }
        return <Dashboard onNavigate={setCurrentPage} />;
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans selection:bg-indigo-500/30 selection:text-indigo-200">
      {/* Sidebar Navigation */}
      <Sidebar
        currentPage={currentPage}
        onNavigate={setCurrentPage}
        isOpenMobile={mobileSidebarOpen}
        onCloseMobile={() => setMobileSidebarOpen(false)}
      />

      {/* Main Content Area (Offset by Sidebar on desktop) */}
      <div className="flex-1 flex flex-col lg:pl-72 rtl:lg:pl-0 rtl:lg:pr-72 transition-all">
        {/* Top Navbar */}
        <Navbar
          currentPage={currentPage}
          onOpenMobileSidebar={() => setMobileSidebarOpen(true)}
        />

        {/* Dynamic Page Container */}
        <main className="flex-1 p-4 md:p-6 max-w-7xl w-full mx-auto">
          {renderCurrentPage()}
        </main>
      </div>

      {/* Global Quick Import Modal */}
      <QuickImportModal />
    </div>
  );
};

export function App() {
  return (
    <AppProvider>
      <MainLayout />
    </AppProvider>
  );
}

export default App;
