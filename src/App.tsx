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
import { PageLoadingScreen, ErrorRetryCard } from './components/common/LoadingStates.js';

// Table Configuration Metadata for all 23 Tables
const TABLE_CONFIGS: Record<string, { title: string; description: string }> = {
  'missions': {
    title: 'Missions (المهام)',
    description: 'Operational missions, locations, regional assignments, and cross-dataset linkages.',
  },
  'registrations': {
    title: 'Registrations (سجلات التسجيل)',
    description: 'Device attachment, IMSI/IMEI registrations, distance estimates, and telemetry.',
  },
  'targets': {
    title: 'Targets (الأهداف المرصودة)',
    description: 'Monitored target profiles, IMSI/IMEI identifiers, redirect frequencies, and actions.',
  },
  'mission-extras': {
    title: 'Mission Extras (معلومات المهام الإضافية)',
    description: 'Descriptive operational dossiers and narrative logs linked to missions.',
  },
  'location-extras': {
    title: 'Location Extras (معلومات المواقع الإضافية)',
    description: 'Geographic and structural characteristics of operation locations.',
  },
  'mission-files': {
    title: 'Mission Files (ملفات المهام)',
    description: 'Secure attachments, operational briefings, spreadsheets, and mission documents.',
  },
  'location-files': {
    title: 'Location Files (ملفات المواقع)',
    description: 'Geospatial floor plans, imagery, and sector site documents.',
  },
  'network-cells': {
    title: 'Network Cells (خلايا الشبكة)',
    description: 'Active cellular base stations, frequencies, signal levels (Rx Lev), LAC, and PCI.',
  },
  'wifi-access-points': {
    title: 'WiFi Access Points (نقاط وصول الواي فاي)',
    description: 'Discovered WiFi BSSIDs, ESSIDs, encryption protocols, channels, and manufacturers.',
  },
  'wifi-access-point-clients': {
    title: 'WiFi AP Clients (عملاء نقاط الوصول)',
    description: 'Client device MAC addresses probed or associated with access point nodes.',
  },
  'gps-history': {
    title: 'GPS History (تاريخ وسجل الـ GPS)',
    description: 'Historical geographic coordinates, power levels, and distance telemetry over time.',
  },
  'map-cell-databases': {
    title: 'Map Cell Databases (قواعد خلايا الخريطة)',
    description: 'Cellular network cluster databases, display headers, and tactical color schemes.',
  },
  'map-cells': {
    title: 'Map Cells (خلايا الخريطة)',
    description: 'Geographic base stations with sector directions, beam opening angles, and radii.',
  },
  'plmn-storage': {
    title: 'PLMN Storage (سجل مشغلي الاتصالات)',
    description: 'Mobile Country Codes (MCC) and Network Codes (MNC) carrier identity index.',
  },
  'sms-calls': {
    title: 'SMS & Calls Records (سجلات المكالمات والرسائل)',
    description: 'Authorized interception records, routing numbers, BTS identity, and timestamps.',
  },
  'map-user-markers': {
    title: 'Map User Markers (علامات المستخدم)',
    description: 'Tactical points of interest, command posts, checkpoints, and customized pins.',
  },
  'map-user-polygons': {
    title: 'Map User Polygons (مضلعات ونطاقات المستخدم)',
    description: 'Perimeter boundaries, exclusion zones, and geospatial polygon shapes.',
  },
  'map-user-circles': {
    title: 'Map User Circles (دوائر المستخدم)',
    description: 'Radial exclusion boundaries, signal reach buffers, and circular zones.',
  },
  'target-files': {
    title: 'Target Files (ملفات الأهداف)',
    description: 'Dossiers, imagery, and tactical intelligence attachments linked to targets.',
  },
  'whitelist-targets': {
    title: 'Whitelist Targets (القائمة البيضاء)',
    description: 'Friendly assets and authorized reference identifiers excluded from alerting.',
  },
  'tac-numbers': {
    title: 'TAC Numbers (أرقام تعريف الأجهزة)',
    description: 'Type Allocation Code database mapping 8-digit TACs to mobile phone models.',
  },
  'scheduled-tasks': {
    title: 'Scheduled Tasks (المهام المجدولة)',
    description: 'Automated data retention jobs, scheduled analytics aggregations, and snapshots.',
  },
  'map-layers': {
    title: 'Map Layers (طبقات الخريطة)',
    description: 'GeoJSON vector layers, base map layers, and tactical overlays.',
  },
};

const MainLayout: React.FC = () => {
  const { authToken, authLoading, authError, retryAuth, t } = useApp();
  const [currentPage, setCurrentPage] = useState<string>('dashboard');
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);

  const renderCurrentPage = () => {
    if (!authToken) {
      if (authError) {
        return (
          <div className="py-12 max-w-lg mx-auto">
            <ErrorRetryCard message={authError} onRetry={retryAuth} />
          </div>
        );
      }
      if (authLoading) {
        return <PageLoadingScreen message={t('initializingSession')} />;
      }
    }

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
          return (
            <TableView
              key={currentPage}
              tableId={currentPage}
              title={TABLE_CONFIGS[currentPage].title}
              description={TABLE_CONFIGS[currentPage].description}
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
