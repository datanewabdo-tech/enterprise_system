import { Prisma } from '@prisma/client';
import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';
import { db } from './db.js';

export type GlobalSearchType =
  | 'IMSI'
  | 'IMEI'
  | 'TMSI'
  | 'PSTN'
  | 'UNIQUE_CALL_ID'
  | 'SYSTEM_ID'
  | 'MAC_ADDRESS'
  | 'BSSID'
  | 'GENERAL_TEXT'
  | 'MISSION'
  | 'MCC'
  | 'MNC'
  | 'LAC'
  | 'CELL_ID';

export type MatchMode = 'exact' | 'partial';
export type MatchType = 'exact' | 'partial' | 'generic' | 'legacy_text';

export interface UnifiedSearchResult {
  tableName: string;
  recordId: string;
  matchingColumns: string[];
  matchingValues: Array<string | null>;
  matchTypes: MatchType[];
  recordData: Record<string, any>;
  missionId?: number | string | null;
  mission?: string | null;
  missionName?: string | null;
  missionLocation?: string | null;
  eventDate?: string | null;
  sourceFile?: string | null;
  importBatchId?: string | number | null;
}

interface FieldMatchDef {
  dbField: string; // Prisma/client field name used in select/where
  dbColumn?: string; // physical column name for display/debug if needed
  confirmedIdentifier: boolean;
  label?: string; // e.g. "Called IMSI"
  generic?: boolean;
  identifierKind?: GlobalSearchType;
  textSearch?: boolean; // include in GENERAL_TEXT
}

interface TableSearchDef {
  key: string; // internal source key
  tableName: string; // physical table
  prismaModel: string;
  labelEn: string;
  labelAr: string;
  displayFields: string[];
  missionIdField?: string; // prisma field
  legacyMissionTextField?: string; // prisma field for legacy text-only mission value
  missionNameField?: string;
  missionLocationField?: string;
  dateField?: string;
  sourceFileField?: string;
  importBatchIdField?: string;
  searchableByType: Partial<Record<GlobalSearchType, FieldMatchDef[]>>;
  generalTextFields: string[]; // prisma field names
  filterable: string[]; // prisma field names allowed in advanced filters
  sortable: string[]; // prisma field names allowed for sorting (plus defaults)
  permissionTable?: string; // defaults to tableName
}

const ACTIVITY_LOG_FIELDS = Array.from({ length: 50 }, (_, i) => `field${i + 1}`);

function activityGenericMatches(): FieldMatchDef[] {
  return ACTIVITY_LOG_FIELDS.map((f) => ({ dbField: f, confirmedIdentifier: false, generic: true, textSearch: true }));
}

export const GLOBAL_SEARCH_REGISTRY: TableSearchDef[] = [
  {
    key: 'registrations',
    tableName: 'registrations',
    prismaModel: 'Registration',
    labelEn: 'Registrations',
    labelAr: 'التسجيلات',
    displayFields: ['id', 'missionId', 'mission', 'imsi', 'imei', 'tmsi', 'regId', 'targetName', 'bts', 'btsName', 'country', 'countryCode', 'mcc', 'mnc', 'lac', 'rat', 'lastEvent', 'time', 'uplinkPower', 'btsLocation', 'deviceLocation', 'lastSeen', 'ueModel'],
    missionIdField: 'missionId',
    legacyMissionTextField: 'mission',
    missionNameField: 'missionName',
    dateField: 'lastSeen',
    searchableByType: {
      IMSI: [{ dbField: 'imsi', confirmedIdentifier: true, label: 'IMSI', identifierKind: 'IMSI' }],
      IMEI: [{ dbField: 'imei', confirmedIdentifier: true, label: 'IMEI', identifierKind: 'IMEI' }],
      TMSI: [{ dbField: 'tmsi', confirmedIdentifier: true, label: 'TMSI', identifierKind: 'TMSI' }],
      GENERAL_TEXT: [
        { dbField: 'imsi', confirmedIdentifier: true, textSearch: true },
        { dbField: 'imei', confirmedIdentifier: true, textSearch: true },
        { dbField: 'tmsi', confirmedIdentifier: true, textSearch: true },
        { dbField: 'regId', confirmedIdentifier: true, textSearch: true },
        { dbField: 'targetName', confirmedIdentifier: false, textSearch: true },
        { dbField: 'mission', confirmedIdentifier: false, textSearch: true },
        { dbField: 'bts', confirmedIdentifier: false, textSearch: true },
        { dbField: 'btsName', confirmedIdentifier: false, textSearch: true },
        { dbField: 'country', confirmedIdentifier: false, textSearch: true },
        { dbField: 'mcc', confirmedIdentifier: false, textSearch: true },
        { dbField: 'mnc', confirmedIdentifier: false, textSearch: true },
        { dbField: 'lac', confirmedIdentifier: false, textSearch: true },
        { dbField: 'rat', confirmedIdentifier: false, textSearch: true },
        { dbField: 'ueModel', confirmedIdentifier: false, textSearch: true },
      ],
      MCC: [{ dbField: 'mcc', confirmedIdentifier: true, identifierKind: 'MCC' }],
      MNC: [{ dbField: 'mnc', confirmedIdentifier: true, identifierKind: 'MNC' }],
      LAC: [{ dbField: 'lac', confirmedIdentifier: true, identifierKind: 'LAC' }],
    },
    generalTextFields: ['imsi', 'imei', 'tmsi', 'regId', 'targetName', 'mission', 'bts', 'btsName', 'country', 'countryCode', 'mcc', 'mnc', 'lac', 'rat', 'ueModel'],
    filterable: ['id', 'missionId', 'mission', 'country', 'countryCode', 'mcc', 'mnc', 'btsName', 'rat', 'lastSeen', 'bts', 'lac'],
    sortable: ['id', 'missionId', 'imsi', 'imei', 'tmsi', 'country', 'mcc', 'mnc', 'btsName', 'rat', 'lastSeen', 'createdAt'],
  },
  {
    key: 'targets',
    tableName: 'targets',
    prismaModel: 'Target',
    labelEn: 'Targets',
    labelAr: 'الأهداف',
    displayFields: ['id', 'missionId', 'mission', 'missionName', 'name', 'imsi', 'imei', 'action', 'redirectTech', 'description'],
    missionIdField: 'missionId',
    legacyMissionTextField: 'mission',
    missionNameField: 'missionName',
    searchableByType: {
      IMSI: [{ dbField: 'imsi', confirmedIdentifier: true, label: 'IMSI', identifierKind: 'IMSI' }],
      IMEI: [{ dbField: 'imei', confirmedIdentifier: true, label: 'IMEI', identifierKind: 'IMEI' }],
      GENERAL_TEXT: [
        { dbField: 'imsi', confirmedIdentifier: true, textSearch: true },
        { dbField: 'imei', confirmedIdentifier: true, textSearch: true },
        { dbField: 'mission', confirmedIdentifier: false, textSearch: true },
        { dbField: 'missionName', confirmedIdentifier: false, textSearch: true },
        { dbField: 'name', confirmedIdentifier: false, textSearch: true },
        { dbField: 'action', confirmedIdentifier: false, textSearch: true },
        { dbField: 'redirectTech', confirmedIdentifier: false, textSearch: true },
        { dbField: 'description', confirmedIdentifier: false, textSearch: true },
      ],
    },
    generalTextFields: ['imsi', 'imei', 'mission', 'missionName', 'name', 'action', 'redirectTech', 'description'],
    filterable: ['id', 'missionId', 'mission', 'missionName', 'name', 'action'],
    sortable: ['id', 'missionId', 'imsi', 'imei', 'name'],
  },
  {
    key: 'whitelist_targets',
    tableName: 'whitelist_targets',
    prismaModel: 'WhitelistTarget',
    labelEn: 'Whitelist Targets',
    labelAr: 'أهداف القائمة البيضاء',
    displayFields: ['id', 'name', 'imsi', 'imei'],
    searchableByType: {
      IMSI: [{ dbField: 'imsi', confirmedIdentifier: true, label: 'IMSI', identifierKind: 'IMSI' }],
      IMEI: [{ dbField: 'imei', confirmedIdentifier: true, label: 'IMEI', identifierKind: 'IMEI' }],
      GENERAL_TEXT: [
        { dbField: 'imsi', confirmedIdentifier: true, textSearch: true },
        { dbField: 'imei', confirmedIdentifier: true, textSearch: true },
        { dbField: 'name', confirmedIdentifier: false, textSearch: true },
      ],
    },
    generalTextFields: ['imsi', 'imei', 'name'],
    filterable: ['id', 'name'],
    sortable: ['id', 'imsi', 'imei', 'name'],
  },
  {
    key: 'cronologs',
    tableName: 'cronologs',
    prismaModel: 'Cronolog',
    labelEn: 'Cronologs',
    labelAr: 'سجلات المكالمات (Cronologs)',
    displayFields: ['id', 'dateUp', 'timeUp', 'dateDown', 'timeDown', 'unitLatitude', 'unitLongitude', 'mobileLatitude', 'mobileLongitude', 'modeOfCall', 'subModeOfCall', 'reasonForEoc', 'messageType', 'message', 'hitList', 'importBatchId', 'uniqueCallId', 'systemId', 'calledImsi', 'callingImsi', 'thurayaImsi', 'calledImei', 'callingImei', 'thurayaImei', 'calledTmsi', 'callingTmsi', 'originalTmsi', 'reallocatedTmsi', 'calledPstn', 'callingPstn', 'calledNormalizedPstn', 'callingNormalizedPstn'],
    dateField: 'dateUp',
    importBatchIdField: 'importBatchId',
    searchableByType: {
      IMSI: [
        { dbField: 'calledImsi', confirmedIdentifier: true, label: 'Called IMSI', identifierKind: 'IMSI' },
        { dbField: 'callingImsi', confirmedIdentifier: true, label: 'Calling IMSI', identifierKind: 'IMSI' },
        { dbField: 'thurayaImsi', confirmedIdentifier: true, label: 'Thuraya IMSI', identifierKind: 'IMSI' },
      ],
      IMEI: [
        { dbField: 'calledImei', confirmedIdentifier: true, label: 'Called IMEI', identifierKind: 'IMEI' },
        { dbField: 'callingImei', confirmedIdentifier: true, label: 'Calling IMEI', identifierKind: 'IMEI' },
        { dbField: 'thurayaImei', confirmedIdentifier: true, label: 'Thuraya IMEI', identifierKind: 'IMEI' },
      ],
      TMSI: [
        { dbField: 'calledTmsi', confirmedIdentifier: true, label: 'Called TMSI', identifierKind: 'TMSI' },
        { dbField: 'callingTmsi', confirmedIdentifier: true, label: 'Calling TMSI', identifierKind: 'TMSI' },
        { dbField: 'originalTmsi', confirmedIdentifier: true, label: 'Original TMSI', identifierKind: 'TMSI' },
        { dbField: 'reallocatedTmsi', confirmedIdentifier: true, label: 'Reallocated TMSI', identifierKind: 'TMSI' },
      ],
      PSTN: [
        { dbField: 'calledPstn', confirmedIdentifier: true, label: 'Called PSTN', identifierKind: 'PSTN' },
        { dbField: 'callingPstn', confirmedIdentifier: true, label: 'Calling PSTN', identifierKind: 'PSTN' },
        { dbField: 'calledNormalizedPstn', confirmedIdentifier: true, label: 'Called Normalized PSTN', identifierKind: 'PSTN' },
        { dbField: 'callingNormalizedPstn', confirmedIdentifier: true, label: 'Calling Normalized PSTN', identifierKind: 'PSTN' },
      ],
      UNIQUE_CALL_ID: [{ dbField: 'uniqueCallId', confirmedIdentifier: true, label: 'Unique Call ID', identifierKind: 'UNIQUE_CALL_ID' }],
      SYSTEM_ID: [{ dbField: 'systemId', confirmedIdentifier: true, label: 'System ID', identifierKind: 'SYSTEM_ID' }],
      GENERAL_TEXT: [
        { dbField: 'uniqueCallId', confirmedIdentifier: true, textSearch: true },
        { dbField: 'systemId', confirmedIdentifier: true, textSearch: true },
        { dbField: 'calledImsi', confirmedIdentifier: true, textSearch: true },
        { dbField: 'callingImsi', confirmedIdentifier: true, textSearch: true },
        { dbField: 'thurayaImsi', confirmedIdentifier: true, textSearch: true },
        { dbField: 'calledImei', confirmedIdentifier: true, textSearch: true },
        { dbField: 'callingImei', confirmedIdentifier: true, textSearch: true },
        { dbField: 'thurayaImei', confirmedIdentifier: true, textSearch: true },
        { dbField: 'calledTmsi', confirmedIdentifier: true, textSearch: true },
        { dbField: 'callingTmsi', confirmedIdentifier: true, textSearch: true },
        { dbField: 'calledPstn', confirmedIdentifier: true, textSearch: true },
        { dbField: 'callingPstn', confirmedIdentifier: true, textSearch: true },
        { dbField: 'modeOfCall', confirmedIdentifier: false, textSearch: true },
        { dbField: 'subModeOfCall', confirmedIdentifier: false, textSearch: true },
        { dbField: 'reasonForEoc', confirmedIdentifier: false, textSearch: true },
        { dbField: 'messageType', confirmedIdentifier: false, textSearch: true },
        { dbField: 'message', confirmedIdentifier: false, textSearch: true },
        { dbField: 'hitList', confirmedIdentifier: false, textSearch: true },
        { dbField: 'targetIdentifiers', confirmedIdentifier: false, textSearch: true },
      ],
    },
    generalTextFields: ['uniqueCallId', 'systemId', 'calledImsi', 'callingImsi', 'thurayaImsi', 'calledImei', 'callingImei', 'thurayaImei', 'calledTmsi', 'callingTmsi', 'originalTmsi', 'reallocatedTmsi', 'calledPstn', 'callingPstn', 'modeOfCall', 'subModeOfCall', 'reasonForEoc', 'messageType', 'message', 'hitList', 'targetIdentifiers'],
    filterable: ['id', 'dateUp', 'dateDown', 'modeOfCall', 'subModeOfCall', 'messageType', 'targetIdentifiers', 'importBatchId', 'timeUp', 'timeDown'],
    sortable: ['id', 'dateUp', 'dateDown', 'timeUp', 'timeDown', 'uniqueCallId', 'systemId', 'modeOfCall', 'messageType', 'importBatchId'],
  },
  {
    key: 'activity_logs',
    tableName: 'activity_logs',
    prismaModel: 'ActivityLog',
    labelEn: 'Activity Logs',
    labelAr: 'سجلات النشاط',
    displayFields: ['id', 'recordType', 'lineNumber', 'sourceFile', 'originalRecord', 'importBatchId', 'createdAt', ...ACTIVITY_LOG_FIELDS],
    dateField: 'createdAt',
    sourceFileField: 'sourceFile',
    importBatchIdField: 'importBatchId',
    searchableByType: {
      IMSI: activityGenericMatches(),
      IMEI: activityGenericMatches(),
      TMSI: activityGenericMatches(),
      PSTN: activityGenericMatches(),
      UNIQUE_CALL_ID: activityGenericMatches(),
      SYSTEM_ID: activityGenericMatches(),
      MAC_ADDRESS: activityGenericMatches(),
      BSSID: activityGenericMatches(),
      MCC: activityGenericMatches(),
      MNC: activityGenericMatches(),
      LAC: activityGenericMatches(),
      CELL_ID: activityGenericMatches(),
      GENERAL_TEXT: [
        ...activityGenericMatches(),
        { dbField: 'recordType', confirmedIdentifier: false, textSearch: true },
        { dbField: 'originalRecord', confirmedIdentifier: false, textSearch: true },
      ],
    },
    generalTextFields: [...ACTIVITY_LOG_FIELDS, 'recordType', 'originalRecord'],
    filterable: ['id', 'recordType', 'sourceFile', 'lineNumber', 'importBatchId', 'createdAt'],
    sortable: ['id', 'recordType', 'lineNumber', 'sourceFile', 'importBatchId', 'createdAt'],
  },
  {
    key: 'sms_calls',
    tableName: 'sms_calls',
    prismaModel: 'SmsCall',
    labelEn: 'SMS & Calls',
    labelAr: 'الرسائل والمكالمات',
    displayFields: ['id', 'missionId', 'mission', 'incoming', 'isSms', 'btsName', 'status', 'smsContent', 'timestamp', 'smsId', 'callId', 'source', 'destination', 'btsId'],
    missionIdField: 'missionId',
    legacyMissionTextField: 'mission',
    dateField: 'timestamp',
    searchableByType: {
      PSTN: [
        { dbField: 'source', confirmedIdentifier: true, label: 'Source (PSTN/Number)', identifierKind: 'PSTN' },
        { dbField: 'destination', confirmedIdentifier: true, label: 'Destination (PSTN/Number)', identifierKind: 'PSTN' },
      ],
      UNIQUE_CALL_ID: [{ dbField: 'callId', confirmedIdentifier: true, label: 'Call ID', identifierKind: 'UNIQUE_CALL_ID' }],
      SYSTEM_ID: [{ dbField: 'smsId', confirmedIdentifier: true, label: 'SMS ID', identifierKind: 'SYSTEM_ID' }],
      GENERAL_TEXT: [
        { dbField: 'smsId', confirmedIdentifier: true, textSearch: true },
        { dbField: 'callId', confirmedIdentifier: true, textSearch: true },
        { dbField: 'source', confirmedIdentifier: true, textSearch: true },
        { dbField: 'destination', confirmedIdentifier: true, textSearch: true },
        { dbField: 'btsId', confirmedIdentifier: false, textSearch: true },
        { dbField: 'mission', confirmedIdentifier: false, textSearch: true },
        { dbField: 'smsContent', confirmedIdentifier: false, textSearch: true },
        { dbField: 'status', confirmedIdentifier: false, textSearch: true },
      ],
    },
    generalTextFields: ['smsId', 'callId', 'source', 'destination', 'btsId', 'mission', 'smsContent', 'status', 'btsName'],
    filterable: ['id', 'missionId', 'mission', 'incoming', 'isSms', 'status', 'timestamp', 'btsId', 'source', 'destination'],
    sortable: ['id', 'missionId', 'timestamp', 'status', 'source', 'destination', 'smsId', 'callId'],
  },
  {
    key: 'wifi_access_points',
    tableName: 'wifi_access_points',
    prismaModel: 'WifiAccessPoint',
    labelEn: 'Wi-Fi Access Points',
    labelAr: 'نقاط الوصول اللاسلكية',
    displayFields: ['id', 'missionId', 'mission', 'bssid', 'essid', 'essidBssidId', 'enc', 'channel', 'firstSeen', 'lastSeen', 'manufacturer'],
    missionIdField: 'missionId',
    legacyMissionTextField: 'mission',
    dateField: 'lastSeen',
    searchableByType: {
      BSSID: [{ dbField: 'bssid', confirmedIdentifier: true, label: 'BSSID', identifierKind: 'BSSID' }],
      GENERAL_TEXT: [
        { dbField: 'bssid', confirmedIdentifier: true, textSearch: true },
        { dbField: 'essid', confirmedIdentifier: false, textSearch: true },
        { dbField: 'essidBssidId', confirmedIdentifier: true, textSearch: true },
        { dbField: 'mission', confirmedIdentifier: false, textSearch: true },
        { dbField: 'manufacturer', confirmedIdentifier: false, textSearch: true },
      ],
    },
    generalTextFields: ['bssid', 'essid', 'essidBssidId', 'mission', 'manufacturer', 'enc', 'channel'],
    filterable: ['id', 'missionId', 'mission', 'essid', 'manufacturer', 'firstSeen', 'lastSeen'],
    sortable: ['id', 'missionId', 'bssid', 'essid', 'manufacturer', 'firstSeen', 'lastSeen'],
  },
  {
    key: 'wifi_access_point_clients',
    tableName: 'wifi_access_point_clients',
    prismaModel: 'WifiAccessPointClient',
    labelEn: 'Wi-Fi Access Point Clients',
    labelAr: 'عملاء نقاط الوصول اللاسلكية',
    displayFields: ['id', 'mac', 'wifiAccessPointEssidBssid', 'firstSeen', 'lastSeen', 'wants', 'manufacturer'],
    dateField: 'lastSeen',
    searchableByType: {
      MAC_ADDRESS: [{ dbField: 'mac', confirmedIdentifier: true, label: 'MAC Address', identifierKind: 'MAC_ADDRESS' }],
      BSSID: [{ dbField: 'wifiAccessPointEssidBssid', confirmedIdentifier: false, label: 'Associated ESSID/BSSID', identifierKind: 'BSSID' }],
      GENERAL_TEXT: [
        { dbField: 'mac', confirmedIdentifier: true, textSearch: true },
        { dbField: 'wifiAccessPointEssidBssid', confirmedIdentifier: false, textSearch: true },
        { dbField: 'wants', confirmedIdentifier: false, textSearch: true },
        { dbField: 'manufacturer', confirmedIdentifier: false, textSearch: true },
      ],
    },
    generalTextFields: ['mac', 'wifiAccessPointEssidBssid', 'wants', 'manufacturer'],
    filterable: ['id', 'manufacturer', 'firstSeen', 'lastSeen', 'wifiAccessPointEssidBssid'],
    sortable: ['id', 'mac', 'manufacturer', 'firstSeen', 'lastSeen'],
  },
  {
    key: 'network_cells',
    tableName: 'network_cells',
    prismaModel: 'NetworkCell',
    labelEn: 'Network Cells',
    labelAr: 'خلايا الشبكة',
    displayFields: ['id', 'missionId', 'mission', 'mcc', 'mnc', 'lac', 'cellId', 'cidLacMnc', 'bsic', 'psc', 'pci', 'rat', 'rxLev', 'rxLevDbm', 'latitude', 'longitude'],
    missionIdField: 'missionId',
    legacyMissionTextField: 'mission',
    searchableByType: {
      MCC: [{ dbField: 'mcc', confirmedIdentifier: true, label: 'MCC', identifierKind: 'MCC' }],
      MNC: [{ dbField: 'mnc', confirmedIdentifier: true, label: 'MNC', identifierKind: 'MNC' }],
      LAC: [{ dbField: 'lac', confirmedIdentifier: true, label: 'LAC', identifierKind: 'LAC' }],
      CELL_ID: [{ dbField: 'cellId', confirmedIdentifier: true, label: 'Cell ID', identifierKind: 'CELL_ID' }],
      GENERAL_TEXT: [
        { dbField: 'mcc', confirmedIdentifier: false, textSearch: true },
        { dbField: 'mnc', confirmedIdentifier: false, textSearch: true },
        { dbField: 'lac', confirmedIdentifier: false, textSearch: true },
        { dbField: 'cellId', confirmedIdentifier: false, textSearch: true },
        { dbField: 'cidLacMnc', confirmedIdentifier: false, textSearch: true },
        { dbField: 'mission', confirmedIdentifier: false, textSearch: true },
        { dbField: 'rat', confirmedIdentifier: false, textSearch: true },
      ],
    },
    generalTextFields: ['mcc', 'mnc', 'lac', 'cellId', 'cidLacMnc', 'mission', 'rat', 'bsic', 'psc', 'pci'],
    filterable: ['id', 'missionId', 'mission', 'mcc', 'mnc', 'lac', 'cellId', 'rat'],
    sortable: ['id', 'missionId', 'mcc', 'mnc', 'lac', 'cellId', 'rat'],
  },
  {
    key: 'map_cells',
    tableName: 'map_cells',
    prismaModel: 'MapCell',
    labelEn: 'Map Cells',
    labelAr: 'خلايا الخريطة',
    displayFields: ['id', 'dbId', 'mcc', 'mnc', 'lac', 'cid', 'mccMncJunction', 'formatHex', 'address', 'lat', 'lon'],
    searchableByType: {
      MCC: [{ dbField: 'mcc', confirmedIdentifier: true, label: 'MCC', identifierKind: 'MCC' }],
      MNC: [{ dbField: 'mnc', confirmedIdentifier: true, label: 'MNC', identifierKind: 'MNC' }],
      LAC: [{ dbField: 'lac', confirmedIdentifier: true, label: 'LAC', identifierKind: 'LAC' }],
      CELL_ID: [{ dbField: 'cid', confirmedIdentifier: true, label: 'Cell ID (CID)', identifierKind: 'CELL_ID' }],
      GENERAL_TEXT: [
        { dbField: 'mcc', confirmedIdentifier: false, textSearch: true },
        { dbField: 'mnc', confirmedIdentifier: false, textSearch: true },
        { dbField: 'lac', confirmedIdentifier: false, textSearch: true },
        { dbField: 'cid', confirmedIdentifier: false, textSearch: true },
        { dbField: 'mccMncJunction', confirmedIdentifier: false, textSearch: true },
        { dbField: 'formatHex', confirmedIdentifier: false, textSearch: true },
        { dbField: 'address', confirmedIdentifier: false, textSearch: true },
      ],
    },
    generalTextFields: ['mcc', 'mnc', 'lac', 'cid', 'mccMncJunction', 'formatHex', 'address'],
    filterable: ['id', 'dbId', 'mcc', 'mnc', 'lac', 'cid'],
    sortable: ['id', 'dbId', 'mcc', 'mnc', 'lac', 'cid'],
  },
];

// Additional mission-associated models (verified missionId FK) for mission-associated record retrieval
export const MISSION_ASSOCIATED_TABLE_KEYS = [
  'registrations',
  'targets',
  'sms_calls',
  'wifi_access_points',
  'network_cells',
  // extras / other tables with missionId will be handled specially if present
];

export function getRegistry() {
  return GLOBAL_SEARCH_REGISTRY.map((t) => ({
    key: t.key,
    tableName: t.tableName,
    prismaModel: t.prismaModel,
    labelEn: t.labelEn,
    labelAr: t.labelAr,
    searchableByType: Object.fromEntries(Object.entries(t.searchableByType).map(([k, defs]) => [k, (defs || []).map((d) => ({ field: d.dbField, label: d.label || d.dbField, confirmedIdentifier: d.confirmedIdentifier, generic: !!d.generic }))])),
    generalTextFields: t.generalTextFields,
    displayFields: t.displayFields,
    filterable: t.filterable,
    sortable: t.sortable,
    mission: {
      hasMissionId: !!t.missionIdField,
      missionIdField: t.missionIdField || null,
      legacyMissionTextField: t.legacyMissionTextField || null,
    },
    dateField: t.dateField || null,
    sourceFileField: t.sourceFileField || null,
    importBatchIdField: t.importBatchIdField || null,
  }));
}

function normalizeSearchValue(v: unknown): string {
  if (v === null || v === undefined) return '';
  return String(v); // preserve as-is; no numeric coercion, no trimming away meaningful chars except caller choice
}

function valuesEqual(a: string, b: string, caseInsensitive: boolean): boolean {
  if (caseInsensitive) return a.toLocaleLowerCase() === b.toLocaleLowerCase();
  return a === b;
}

function valueContains(hay: string, needle: string, caseInsensitive: boolean): boolean {
  if (needle === '') return false;
  if (caseInsensitive) return hay.toLocaleLowerCase().includes(needle.toLocaleLowerCase());
  return hay.includes(needle);
}

function isCaseInsensitiveType(type: GlobalSearchType): boolean {
  return type === 'GENERAL_TEXT' || type === 'MISSION';
}

function isIdentifierType(type: GlobalSearchType): boolean {
  return ['IMSI', 'IMEI', 'TMSI', 'PSTN', 'UNIQUE_CALL_ID', 'SYSTEM_ID', 'MAC_ADDRESS', 'BSSID', 'MCC', 'MNC', 'LAC', 'CELL_ID'].includes(type);
}

export interface SearchRequest {
  searchType: GlobalSearchType;
  searchValue: string;
  matchMode: MatchMode;
  missionSearchField?: 'id' | 'label' | 'name' | 'location';
  page?: number;
  pageSize?: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
  filters?: Record<string, any>;
  selectedMissionIds?: Array<number | string>;
  requestedTables?: string[];
}

function tableKeyByName(name: string): TableSearchDef | undefined {
  return GLOBAL_SEARCH_REGISTRY.find((t) => t.key === name || t.tableName === name);
}

function canAccessTable(tableName: string, _perms: any): boolean {
  // Existing app gates table access broadly by canViewTables; record-level/field restrictions
  // are enforced by existing middleware/masking patterns. We conservatively require view permission.
  return !!_perms?.canViewTables;
}

function applyMask(record: Record<string, any>, canUnmask: boolean): Record<string, any> {
  // reuse existing behavior: maskSensitiveRecord currently returns as-is in this workspace
  // but we keep hook point and do not expose fields beyond what is selected.
  void canUnmask;
  return record;
}

function serializeValue(v: any): any {
  if (typeof v === 'bigint') return v.toString();
  if (v instanceof Date) return v.toISOString();
  return v;
}

function serializeRecord(rec: Record<string, any> | null | undefined): Record<string, any> {
  if (!rec) return {};
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(rec)) {
    if (Array.isArray(v)) out[k] = v.map(serializeValue);
    else if (v && typeof v === 'object' && !(v instanceof Date)) out[k] = serializeRecord(v as any);
    else out[k] = serializeValue(v);
  }
  return out;
}

function toIdString(v: any): string {
  if (v === null || v === undefined) return '';
  return String(v);
}

function parsePositiveIntLike(v: any): number | null {
  const n = typeof v === 'number' ? v : Number(String(v));
  if (!Number.isInteger(n) || n <= 0) return null;
  return n;
}

async function fetchMissionSummariesByIds(ids: number[]): Promise<Map<number, any>> {
  if (!ids.length) return new Map();
  const missions = await db.mission.findMany({ where: { id: { in: ids } }, select: { id: true, mission: true, missionName: true, location: true, createdAt: true } });
  const map = new Map<number, any>();
  for (const m of missions) map.set(m.id, serializeRecord(m));
  return map;
}

function buildStringFilter(field: string, value: string, mode: MatchMode, caseInsensitive: boolean): any {
  if (mode === 'exact') {
    if (caseInsensitive) return { [field]: { equals: value, mode: 'insensitive' } };
    return { [field]: { equals: value } };
  }
  // partial
  if (caseInsensitive) return { [field]: { contains: value, mode: 'insensitive' } };
  return { [field]: { contains: value } };
}

function getDefsForSearch(def: TableSearchDef, type: GlobalSearchType): FieldMatchDef[] {
  if (type === 'GENERAL_TEXT') return def.searchableByType.GENERAL_TEXT || def.generalTextFields.map((f) => ({ dbField: f, confirmedIdentifier: false, textSearch: true }));
  return def.searchableByType[type] || [];
}

function determineMatchType(defMatch: FieldMatchDef, mode: MatchMode, _tableKey: string): MatchType {
  if (defMatch.generic) return 'generic';
  return mode === 'exact' ? 'exact' : 'partial';
}

function extractEventDate(record: any, def: TableSearchDef): string | null {
  if (!def.dateField) return null;
  const v = record[def.dateField];
  if (v == null) return null;
  if (v instanceof Date) return v.toISOString();
  return String(v);
}

function buildUnifiedResult(def: TableSearchDef, record: any, matched: Array<{ field: string; value: any; matchType: MatchType }>, missionInfo?: { id?: any; mission?: any; missionName?: any; missionLocation?: any }, legacyMissionMatch = false): UnifiedSearchResult {
  const rec = serializeRecord(record);
  const matchingColumns = matched.map((m) => m.field);
  const matchingValues = matched.map((m) => (m.value == null ? null : String(m.value)));
  const matchTypes = matched.map((m) => (legacyMissionMatch && m.matchType !== 'generic' ? 'legacy_text' as MatchType : m.matchType));
  const missionId = missionInfo?.id ?? (def.missionIdField ? rec[def.missionIdField] : null);
  const mission = missionInfo?.mission ?? (def.legacyMissionTextField ? rec[def.legacyMissionTextField] : null);
  const missionName = missionInfo?.missionName ?? (def.missionNameField ? rec[def.missionNameField] : null);
  const missionLocation = missionInfo?.missionLocation ?? null;
  return {
    tableName: def.tableName,
    recordId: toIdString(rec.id),
    matchingColumns,
    matchingValues,
    matchTypes,
    recordData: rec,
    missionId: missionId ?? null,
    mission: mission ?? null,
    missionName: missionName ?? null,
    missionLocation: missionLocation ?? null,
    eventDate: extractEventDate(rec, def),
    sourceFile: def.sourceFileField ? (rec[def.sourceFileField] ?? null) : null,
    importBatchId: def.importBatchIdField ? (rec[def.importBatchIdField] ?? null) : null,
  };
}

function applyAdvancedFiltersToWhere(where: any, def: TableSearchDef, filters: Record<string, any> | undefined): any {
  if (!filters || typeof filters !== 'object') return where;
  const and: any[] = [where];
  const addEq = (field: string, value: any) => {
    if (value === undefined || value === null || value === '') return;
    if (!def.filterable.includes(field) && field !== 'missionId' && field !== 'mission' && field !== 'missionName' && field !== 'missionLocation' && field !== 'importBatchId') return;
    if (field === 'missionLocation') return; // handled via mission joins/lookups
    and.push({ [field]: value });
  };

  // Generic/common
  if (filters.sourceTable && filters.sourceTable !== def.tableName && filters.sourceTable !== def.key) {
    // caller should filter tables earlier, but keep safe
  }
  if (filters.matchingColumn && def.filterable.includes(filters.matchingColumn) || filters.matchingColumn) {
    // matchingColumn filter applied post-query on results (can match dynamic generic fields)
  }
  if (filters.importBatchId != null && filters.importBatchId !== '') {
    if (def.importBatchIdField) {
      const raw = String(filters.importBatchId);
      try {
        if (def.tableName === 'activity_logs' || def.tableName === 'cronologs') {
          and.push({ [def.importBatchIdField]: BigInt(raw) as any });
        } else {
          const n = Number(raw);
          and.push({ [def.importBatchIdField]: Number.isFinite(n) ? n : raw });
        }
      } catch {
        and.push({ [def.importBatchIdField]: raw as any });
      }
    }
  }
  if (filters.recordType && def.tableName === 'activity_logs') addEq('recordType', filters.recordType);
  if (filters.sourceFile && def.tableName === 'activity_logs') addEq('sourceFile', filters.sourceFile);
  if (filters.lineNumber != null && filters.lineNumber !== '' && def.tableName === 'activity_logs') {
    const n = Number(filters.lineNumber);
    if (Number.isFinite(n)) and.push({ lineNumber: Math.trunc(n) });
  }
  if (filters.missionId != null && filters.missionId !== '' && def.missionIdField) {
    const n = parsePositiveIntLike(filters.missionId);
    if (n != null) and.push({ [def.missionIdField]: n });
  }
  if (filters.mission && def.legacyMissionTextField) addEq(def.legacyMissionTextField, filters.mission);
  if (filters.missionName && def.missionNameField) addEq(def.missionNameField, filters.missionName);

  // Registration filters
  for (const f of ['country', 'countryCode', 'mcc', 'mnc', 'btsName', 'rat']) {
    if (filters[f] != null && filters[f] !== '' && def.filterable.includes(f)) and.push({ [f]: filters[f] });
  }

  // Cronolog filters
  if (def.tableName === 'cronologs') {
    for (const f of ['modeOfCall', 'subModeOfCall', 'messageType', 'targetIdentifiers']) {
      if (filters[f] != null && filters[f] !== '' && def.filterable.includes(f)) and.push({ [f]: filters[f] });
    }
    if (filters.dateUpFrom || filters.dateUpTo) {
      const cond: any = {};
      if (filters.dateUpFrom) cond.gte = String(filters.dateUpFrom);
      if (filters.dateUpTo) cond.lte = String(filters.dateUpTo);
      and.push({ dateUp: cond });
    }
    if (filters.dateDownFrom || filters.dateDownTo) {
      const cond: any = {};
      if (filters.dateDownFrom) cond.gte = String(filters.dateDownFrom);
      if (filters.dateDownTo) cond.lte = String(filters.dateDownTo);
      and.push({ dateDown: cond });
    }
  }

  // SMS/Calls filters
  if (def.tableName === 'sms_calls') {
    if (filters.incoming === 'incoming' || filters.incoming === true) and.push({ incoming: true });
    if (filters.incoming === 'outgoing' || filters.incoming === false) and.push({ incoming: false });
    if (filters.isSms === 'sms' || filters.isSms === true) and.push({ isSms: true });
    if (filters.isSms === 'call' || filters.isSms === false) and.push({ isSms: false });
    if (filters.status != null && filters.status !== '') and.push({ status: String(filters.status) });
    if (filters.timestampFrom || filters.timestampTo) {
      const cond: any = {};
      if (filters.timestampFrom) cond.gte = new Date(String(filters.timestampFrom));
      if (filters.timestampTo) cond.lte = new Date(String(filters.timestampTo));
      and.push({ timestamp: cond });
    }
  }

  // Wi-Fi filters
  if (def.tableName === 'wifi_access_points' || def.tableName === 'wifi_access_point_clients') {
    if (filters.essid != null && filters.essid !== '' && def.tableName === 'wifi_access_points') and.push({ essid: { contains: String(filters.essid), mode: 'insensitive' } });
    if (filters.manufacturer != null && filters.manufacturer !== '') and.push({ manufacturer: { contains: String(filters.manufacturer), mode: 'insensitive' } });
    if (filters.firstSeenFrom || filters.firstSeenTo) {
      const cond: any = {};
      if (filters.firstSeenFrom) cond.gte = new Date(String(filters.firstSeenFrom));
      if (filters.firstSeenTo) cond.lte = new Date(String(filters.firstSeenTo));
      and.push({ firstSeen: cond });
    }
    if (filters.lastSeenFrom || filters.lastSeenTo) {
      const cond: any = {};
      if (filters.lastSeenFrom) cond.gte = new Date(String(filters.lastSeenFrom));
      if (filters.lastSeenTo) cond.lte = new Date(String(filters.lastSeenTo));
      and.push({ lastSeen: cond });
    }
  }

  // Mission label/name/location filters are better applied post-resolution in general, but try direct where when possible
  if (filters.missionLocation) {
    // applied later via mission context filtering for mission-linked records
  }

  return and.length === 1 ? and[0] : { AND: and };
}

function resultMatchesPostFilters(result: UnifiedSearchResult, filters: Record<string, any> | undefined): boolean {
  if (!filters) return true;
  if (filters.sourceTable && filters.sourceTable !== result.tableName) return false;
  if (filters.matchingColumn) {
    const wanted = String(filters.matchingColumn);
    if (!result.matchingColumns.includes(wanted)) return false;
  }
  if (filters.matchType) {
    const wanted = String(filters.matchType);
    if (!result.matchTypes.includes(wanted as MatchType)) return false;
  }
  if (filters.missionId != null && filters.missionId !== '') {
    if (String(result.missionId ?? '') !== String(filters.missionId)) return false;
  }
  if (filters.missionLabel || filters.mission) {
    const wanted = String(filters.missionLabel ?? filters.mission);
    if (String(result.mission ?? '') !== wanted) return false;
  }
  if (filters.missionName) {
    if (String(result.missionName ?? '') !== String(filters.missionName)) return false;
  }
  if (filters.missionLocation) {
    const wanted = String(filters.missionLocation).toLowerCase();
    if (!String(result.missionLocation ?? '').toLowerCase().includes(wanted)) return false;
  }
  if (filters.dateFrom || filters.dateTo) {
    const d = result.eventDate ? new Date(result.eventDate).getTime() : NaN;
    if (!Number.isFinite(d)) return false;
    if (filters.dateFrom) {
      const from = new Date(String(filters.dateFrom)).getTime();
      if (Number.isFinite(from) && d < from) return false;
    }
    if (filters.dateTo) {
      const to = new Date(String(filters.dateTo)).getTime();
      if (Number.isFinite(to) && d > to) return false;
    }
  }
  if (filters.importBatchId != null && filters.importBatchId !== '') {
    if (String(result.importBatchId ?? '') !== String(filters.importBatchId)) return false;
  }
  return true;
}

async function searchTable(def: TableSearchDef, req: SearchRequest, perms: any, missionContext?: { missionById: Map<number, any>; allowedMissionIds?: Set<number> | null; legacyMissionLabels?: Set<string> | null; legacyTextMatchMode?: boolean; includeLegacy?: boolean; excludeLegacy?: boolean }): Promise<UnifiedSearchResult[]> {
  if (!canAccessTable(def.tableName, perms)) return [];
  if (req.requestedTables && req.requestedTables.length > 0 && !req.requestedTables.includes(def.key) && !req.requestedTables.includes(def.tableName)) return [];

  const searchType = req.searchType;
  const value = normalizeSearchValue(req.searchValue);
  if (!value && searchType !== 'MISSION') return [];

  const mode: MatchMode = req.matchMode === 'partial' ? 'partial' : 'exact';
  const caseInsensitive = isCaseInsensitiveType(searchType) ? true : false;

  // Mission-associated retrieval path
  if (searchType === 'MISSION') {
    if (!missionContext) return [];
    const missionById = missionContext.missionById;
    const allowed = missionContext.allowedMissionIds;
    const includeLegacy = missionContext.includeLegacy !== false;
    const excludeLegacy = missionContext.excludeLegacy === true;
    const results: UnifiedSearchResult[] = [];
    if (excludeLegacy && !def.missionIdField) return [];

    // Records via verified missionId
    if (def.missionIdField) {
      const ids = Array.from(missionById.keys()).filter((id) => !allowed || allowed.has(id));
      if (ids.length) {
        const where = applyAdvancedFiltersToWhere({ [def.missionIdField]: { in: ids } }, def, req.filters);
        const records = await (db as any)[lcFirst(def.prismaModel)].findMany({ where, take: 5000 });
        for (const rec of records) {
          const mid = rec[def.missionIdField] as number | null | undefined;
          const m = mid != null ? missionById.get(Number(mid)) : undefined;
          const matched = [{ field: def.missionIdField, value: mid, matchType: 'exact' as MatchType }];
          results.push(buildUnifiedResult(def, rec, matched, m ? { id: m.id, mission: m.mission, missionName: m.missionName, missionLocation: m.location } : undefined, false));
        }
      }
    }

    // Legacy mission text matches (separately, only if no real relationship can be proven)
    if (includeLegacy && def.legacyMissionTextField && !excludeLegacy) {
      const labels = missionContext.legacyMissionLabels ? Array.from(missionContext.legacyMissionLabels) : [];
      if (labels.length) {
        // For mission label/name searches we get labels set; match legacy text field by exact/partial case-insensitively depending on mode
        const ors = labels.map((lbl) => buildStringFilter(def.legacyMissionTextField!, lbl, mode, true));
        let where: any = ors.length === 1 ? ors[0] : { OR: ors };
        // If record also has missionId that belongs to one of matched missions, we already returned it via verified relation above; avoid duplicating by excluding those missionIds when possible
        if (def.missionIdField) {
          const ids = Array.from(missionById.keys());
          if (ids.length) where = { AND: [where, { OR: [{ [def.missionIdField]: null }, { [def.missionIdField]: { notIn: ids } }] }] };
        }
        where = applyAdvancedFiltersToWhere(where, def, req.filters);
        const records = await (db as any)[lcFirst(def.prismaModel)].findMany({ where, take: 5000 });
        for (const rec of records) {
          const val = rec[def.legacyMissionTextField];
          const matched = [{ field: def.legacyMissionTextField, value: val, matchType: 'legacy_text' as MatchType }];
          results.push(buildUnifiedResult(def, rec, matched, undefined, true));
        }
      }
    }

    return results;
  }

  const defs = getDefsForSearch(def, searchType);
  if (!defs.length) return [];

  // Build OR conditions over searchable fields
  const orConds: any[] = [];
  for (const fd of defs) {
    if (searchType === 'GENERAL_TEXT') {
      orConds.push(buildStringFilter(fd.dbField, value, 'partial', true));
    } else {
      // identifier-specific: default exact where appropriate, but allow explicit partial
      const m = mode;
      const ci = false; // preserve exact identifier semantics by default; case-insensitive for ordinary text handled above
      orConds.push(buildStringFilter(fd.dbField, value, m, ci));
    }
  }
  if (!orConds.length) return [];

  let where: any = orConds.length === 1 ? orConds[0] : { OR: orConds };
  where = applyAdvancedFiltersToWhere(where, def, req.filters);

  // Limit per table to keep multi-table search responsive; global pagination applied after merge/dedupe
  const take = 2000;
  const records = await (db as any)[lcFirst(def.prismaModel)].findMany({ where, take });

  const out: UnifiedSearchResult[] = [];
  for (const rec of records) {
    const matched: Array<{ field: string; value: any; matchType: MatchType }> = [];
    for (const fd of defs) {
      const raw = rec[fd.dbField];
      if (raw == null) continue;
      const hay = String(raw);
      let isMatch = false;
      if (searchType === 'GENERAL_TEXT') {
        isMatch = valueContains(hay, value, true);
      } else {
        isMatch = mode === 'exact' ? valuesEqual(hay, value, false) : valueContains(hay, value, false);
      }
      if (isMatch) {
        matched.push({ field: fd.dbField, value: hay, matchType: determineMatchType(fd, searchType === 'GENERAL_TEXT' ? 'partial' : mode, def.key) });
      }
    }
    if (!matched.length) continue;

    let missionInfo: any = undefined;
    if (def.missionIdField && rec[def.missionIdField] != null) {
      // mission info resolved later in batch for efficiency if needed; include id now
      missionInfo = { id: rec[def.missionIdField], mission: def.legacyMissionTextField ? rec[def.legacyMissionTextField] : null, missionName: def.missionNameField ? rec[def.missionNameField] : null, missionLocation: null };
    }
    out.push(buildUnifiedResult(def, rec, matched, missionInfo, false));
  }
  return out;
}

function lcFirst(s: string): string {
  return s.charAt(0).toLowerCase() + s.slice(1);
}

async function resolveMissionSearch(req: SearchRequest): Promise<{ missions: any[]; missionById: Map<number, any>; legacyLabels: Set<string>; countsByMissionId: Map<number, Record<string, number>>; associatedPreview?: any }> {
  const value = normalizeSearchValue(req.searchValue);
  const mode: MatchMode = req.matchMode === 'partial' ? 'partial' : 'exact';
  const field = req.missionSearchField || ( /^\d+$/.test(value.trim()) ? 'id' : 'label');
  let missions: any[] = [];

  if (field === 'id' || (field as any) === 'missionId') {
    const id = parsePositiveIntLike(value.trim());
    if (id == null) throw new Error('Invalid Mission ID');
    const m = await db.mission.findUnique({ where: { id } });
    missions = m ? [m] : [];
  } else if (field === 'label' || (field as string) === 'mission') {
    missions = await db.mission.findMany({ where: buildStringFilter('mission', value, mode, true), orderBy: { id: 'asc' } });
  } else if (field === 'name' || (field as string) === 'missionName') {
    missions = await db.mission.findMany({ where: buildStringFilter('missionName', value, mode, true), orderBy: { id: 'asc' } });
  } else if (field === 'location') {
    missions = await db.mission.findMany({ where: buildStringFilter('location', value, mode, true), orderBy: { id: 'asc' } });
  } else {
    // fallback: try label
    missions = await db.mission.findMany({ where: buildStringFilter('mission', value, mode, true), orderBy: { id: 'asc' } });
  }

  const serializedMissions = missions.map((m) => serializeRecord(m));
  const missionById = new Map<number, any>();
  const legacyLabels = new Set<string>();
  for (const m of serializedMissions) {
    missionById.set(Number(m.id), m);
    if (m.mission != null && String(m.mission).trim() !== '') legacyLabels.add(String(m.mission));
  }

  // associated counts per mission from verified missionId relationships
  const countsByMissionId = new Map<number, Record<string, number>>();
  const ids = serializedMissions.map((m) => Number(m.id));
  for (const id of ids) countsByMissionId.set(id, {});

  if (ids.length) {
    const countTasks: Array<Promise<void>> = [];
    const addCounts = (mid: number, table: string, count: number) => {
      const obj = countsByMissionId.get(mid) || {};
      obj[table] = (obj[table] || 0) + count;
      countsByMissionId.set(mid, obj);
    };

    // Registrations
    countTasks.push((async () => {
      const rows = await db.registration.groupBy({ by: ['missionId'], where: { missionId: { in: ids } }, _count: { _all: true } });
      for (const r of rows) if (r.missionId != null) addCounts(r.missionId, 'registrations', r._count._all);
    })());
    // Targets
    countTasks.push((async () => {
      const rows = await db.target.groupBy({ by: ['missionId'], where: { missionId: { in: ids } }, _count: { _all: true } });
      for (const r of rows) if (r.missionId != null) addCounts(r.missionId, 'targets', r._count._all);
    })());
    // SmsCall
    countTasks.push((async () => {
      const rows = await db.smsCall.groupBy({ by: ['missionId'], where: { missionId: { in: ids } }, _count: { _all: true } });
      for (const r of rows) if (r.missionId != null) addCounts(r.missionId, 'sms_calls', r._count._all);
    })());
    // WifiAccessPoint
    countTasks.push((async () => {
      const rows = await db.wifiAccessPoint.groupBy({ by: ['missionId'], where: { missionId: { in: ids } }, _count: { _all: true } });
      for (const r of rows) if (r.missionId != null) addCounts(r.missionId, 'wifi_access_points', r._count._all);
    })());
    // NetworkCell
    countTasks.push((async () => {
      const rows = await db.networkCell.groupBy({ by: ['missionId'], where: { missionId: { in: ids } }, _count: { _all: true } });
      for (const r of rows) if (r.missionId != null) addCounts(r.missionId, 'network_cells', r._count._all);
    })());
    // MissionExtra
    countTasks.push((async () => {
      const rows = await db.missionExtra.groupBy({ by: ['missionId'], where: { missionId: { in: ids } }, _count: { _all: true } });
      for (const r of rows) if (r.missionId != null) addCounts(r.missionId, 'mission_extras', r._count._all);
    })());
    // LocationExtra
    countTasks.push((async () => {
      const rows = await db.locationExtra.groupBy({ by: ['missionId'], where: { missionId: { in: ids } }, _count: { _all: true } });
      for (const r of rows) if (r.missionId != null) addCounts(r.missionId, 'location_extras', r._count._all);
    })());
    // GpsHistory
    countTasks.push((async () => {
      const rows = await db.gpsHistory.groupBy({ by: ['missionId'], where: { missionId: { in: ids } }, _count: { _all: true } });
      for (const r of rows) if (r.missionId != null) addCounts(r.missionId, 'gps_history', r._count._all);
    })());
    // MapCellDatabase
    countTasks.push((async () => {
      const rows = await db.mapCellDatabase.groupBy({ by: ['missionId'], where: { missionId: { in: ids } }, _count: { _all: true } });
      for (const r of rows) if (r.missionId != null) addCounts(r.missionId, 'map_cell_databases', r._count._all);
    })());
    // Map user layers
    countTasks.push((async () => {
      const rows = await db.mapUserMarker.groupBy({ by: ['missionId'], where: { missionId: { in: ids } }, _count: { _all: true } });
      for (const r of rows) if (r.missionId != null) addCounts(r.missionId, 'map_user_markers', r._count._all);
    })());
    countTasks.push((async () => {
      const rows = await db.mapUserPolygon.groupBy({ by: ['missionId'], where: { missionId: { in: ids } }, _count: { _all: true } });
      for (const r of rows) if (r.missionId != null) addCounts(r.missionId, 'map_user_polygons', r._count._all);
    })());
    countTasks.push((async () => {
      const rows = await db.mapUserCircle.groupBy({ by: ['missionId'], where: { missionId: { in: ids } }, _count: { _all: true } });
      for (const r of rows) if (r.missionId != null) addCounts(r.missionId, 'map_user_circles', r._count._all);
    })());

    await Promise.all(countTasks);
  }

  const enrichedMissions = serializedMissions.map((m) => {
    const byTable = countsByMissionId.get(Number(m.id)) || {};
    const total = Object.values(byTable).reduce((a, b) => a + b, 0);
    return {
      ...m,
      associatedRecordCounts: byTable,
      associatedRecordsTotal: total,
    };
  });

  return { missions: enrichedMissions, missionById, legacyLabels, countsByMissionId };
}

function dedupeResults(results: UnifiedSearchResult[]): UnifiedSearchResult[] {
  const map = new Map<string, UnifiedSearchResult>();
  for (const r of results) {
    const key = `${r.tableName}::${r.recordId}`;
    const existing = map.get(key);
    if (!existing) {
      map.set(key, { ...r, matchingColumns: [...r.matchingColumns], matchingValues: [...r.matchingValues], matchTypes: [...r.matchTypes] });
      continue;
    }
    for (let i = 0; i < r.matchingColumns.length; i++) {
      const col = r.matchingColumns[i];
      if (!existing.matchingColumns.includes(col)) {
        existing.matchingColumns.push(col);
        existing.matchingValues.push(r.matchingValues[i] ?? null);
        existing.matchTypes.push(r.matchTypes[i] ?? 'partial');
      }
    }
  }
  return Array.from(map.values());
}

async function enrichMissionInfo(results: UnifiedSearchResult[]): Promise<void> {
  const ids = Array.from(new Set(
    results
      .map((r) => (r.missionId != null ? Number(r.missionId) : null))
      .filter((v): v is number => v !== null && Number.isInteger(v) && v > 0)
  ));
  if (!ids.length) return;
  const m = await fetchMissionSummariesByIds(ids);
  for (const r of results) {
    if (r.missionId == null) continue;
    const info = m.get(Number(r.missionId));
    if (!info) continue;
    r.mission = r.mission ?? info.mission ?? null;
    r.missionName = r.missionName ?? info.missionName ?? null;
    r.missionLocation = r.missionLocation ?? info.location ?? null;
  }
}

function computeStatistics(results: UnifiedSearchResult[], missionSearchMeta?: { missions: any[] }) {
  const uniqueRecords = results.length;
  const tableSet = new Set(results.map((r) => r.tableName));
  const byTable: Record<string, number> = {};
  const byColumn: Record<string, number> = {};
  const byMissionId: Record<string, number> = {};
  const byMissionLabel: Record<string, number> = {};
  const byCountry: Record<string, number> = {};
  const byMcc: Record<string, number> = {};
  const byMnc: Record<string, number> = {};
  const byRecordType: Record<string, number> = {};
  const bySourceFile: Record<string, number> = {};
  const byDate: Record<string, number> = {};
  const missionIdSet = new Set<string>();
  const batchSet = new Set<string>();

  const inc = (obj: Record<string, number>, key: any) => {
    if (key == null || String(key).trim() === '') return;
    const k = String(key);
    obj[k] = (obj[k] || 0) + 1;
  };

  for (const r of results) {
    inc(byTable, r.tableName);
    for (const c of r.matchingColumns) inc(byColumn, `${r.tableName}.${c}`);
    if (r.missionId != null) {
      missionIdSet.add(String(r.missionId));
      inc(byMissionId, r.missionId);
    }
    if (r.mission != null) inc(byMissionLabel, r.mission);
    const rec = r.recordData || {};
    inc(byCountry, rec.country);
    inc(byMcc, rec.mcc);
    inc(byMnc, rec.mnc);
    inc(byRecordType, rec.recordType);
    inc(bySourceFile, r.sourceFile ?? rec.sourceFile);
    if (r.eventDate) inc(byDate, String(r.eventDate).slice(0, 10));
    if (r.importBatchId != null) batchSet.add(String(r.importBatchId));
  }

  const countTable = (name: string) => results.filter((r) => r.tableName === name).length;

  const summaryCards = {
    totalUniqueMatchingRecords: uniqueRecords,
    tablesContainingMatches: tableSet.size,
    matchingRegistrations: countTable('registrations'),
    matchingTargets: countTable('targets'),
    matchingWhitelistTargets: countTable('whitelist_targets'),
    matchingCronologs: countTable('cronologs'),
    matchingActivityLogs: countTable('activity_logs'),
    matchingSmsCalls: countTable('sms_calls'),
    matchingWifiAccessPoints: countTable('wifi_access_points'),
    matchingWifiClients: countTable('wifi_access_point_clients'),
    matchingMissionRecords: missionSearchMeta?.missions?.length ?? missionIdSet.size,
    distinctMissionIds: missionSearchMeta ? new Set((missionSearchMeta.missions || []).map((m: any) => String(m.id))).size : missionIdSet.size,
    associatedRecordsForSelectedMissions: missionSearchMeta ? (missionSearchMeta.missions || []).reduce((a: number, m: any) => a + Number(m.associatedRecordsTotal || 0), 0) : 0,
    uniqueImportBatches: batchSet.size,
  };

  return {
    summaryCards,
    groupedBy: {
      sourceTable: byTable,
      matchingColumn: byColumn,
      missionId: byMissionId,
      missionLabel: byMissionLabel,
      country: byCountry,
      mcc: byMcc,
      mnc: byMnc,
      recordType: byRecordType,
      sourceFile: bySourceFile,
      date: byDate,
    },
  };
}

function applySorting(results: UnifiedSearchResult[], sortBy?: string, sortOrder?: 'asc' | 'desc'): UnifiedSearchResult[] {
  const dir = sortOrder === 'desc' ? -1 : 1;
  const key = sortBy || 'tableName';
  const getVal = (r: UnifiedSearchResult): any => {
    switch (key) {
      case 'tableName': return r.tableName;
      case 'recordId': return Number(r.recordId) || r.recordId;
      case 'matchingColumn': return r.matchingColumns[0] || '';
      case 'missionId': return r.missionId == null ? '' : Number(r.missionId);
      case 'mission': return r.mission || '';
      case 'missionName': return r.missionName || '';
      case 'eventDate': return r.eventDate || '';
      case 'sourceFile': return r.sourceFile || '';
      case 'importBatchId': return r.importBatchId == null ? '' : String(r.importBatchId);
      default: return (r.recordData && r.recordData[key]) ?? (r as any)[key] ?? '';
    }
  };
  return [...results].sort((a, b) => {
    const av = getVal(a); const bv = getVal(b);
    if (av == null && bv == null) return 0;
    if (av == null) return 1;
    if (bv == null) return -1;
    if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * dir;
    return String(av).localeCompare(String(bv), undefined, { numeric: true, sensitivity: 'base' }) * dir;
  });
}

export async function executeGlobalSearch(req: SearchRequest, perms: any) {
  const page = Math.max(1, Number(req.page) || 1);
  const pageSize = Math.min(200, Math.max(1, Number(req.pageSize) || 25));
  const searchType = req.searchType;
  if (!searchType) throw new Error('searchType is required');

  let missionMeta: { missions: any[]; missionById: Map<number, any>; legacyLabels: Set<string> } | undefined;
  let allResults: UnifiedSearchResult[] = [];

  if (searchType === 'MISSION') {
    missionMeta = await resolveMissionSearch(req);
    const selectedIdsRaw = Array.isArray(req.selectedMissionIds) ? req.selectedMissionIds : [];
    const selectedIds = selectedIdsRaw.map((v) => parsePositiveIntLike(v)).filter((v): v is number => v != null);
    const allowedMissionIds = selectedIds.length ? new Set(selectedIds) : null;
    const includeLegacy = req.filters?.includeLegacyTextMatches !== false;
    const excludeLegacy = req.filters?.excludeLegacyTextMatches === true;

    const missionById = allowedMissionIds ? new Map(Array.from(missionMeta.missionById.entries()).filter(([id]) => allowedMissionIds.has(id))) : missionMeta.missionById;
    const legacyLabels = missionMeta.legacyLabels;

    const searchableTables = GLOBAL_SEARCH_REGISTRY.filter((t) => t.missionIdField || t.legacyMissionTextField);
    for (const def of searchableTables) {
      const part = await searchTable(def, req, perms, { missionById, allowedMissionIds, legacyMissionLabels: legacyLabels, includeLegacy, excludeLegacy });
      allResults.push(...part);
    }

    // include mission records themselves as results context? not required as table rows except mission summary; keep associated records unified
  } else {
    const defs = GLOBAL_SEARCH_REGISTRY.filter((d) => getDefsForSearch(d, searchType).length > 0);
    for (const def of defs) {
      const part = await searchTable(def, req, perms);
      allResults.push(...part);
    }
  }

  // Deduplicate same DB record across multiple matching columns while preserving match metadata
  allResults = dedupeResults(allResults);
  await enrichMissionInfo(allResults);

  // Post filters (matchingColumn/matchType/missionLocation/date ranges etc.)
  allResults = allResults.filter((r) => resultMatchesPostFilters(r, req.filters));

  const statistics = computeStatistics(allResults, missionMeta ? { missions: missionMeta.missions.filter((m) => !req.selectedMissionIds?.length || req.selectedMissionIds.map(String).includes(String(m.id))) } : undefined);
  const sorted = applySorting(allResults, req.sortBy, req.sortOrder);
  const total = sorted.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const start = (page - 1) * pageSize;
  const paged = sorted.slice(start, start + pageSize);

  // Grouped results for UI convenience
  const groupedByTable: Record<string, UnifiedSearchResult[]> = {};
  for (const r of paged) {
    if (!groupedByTable[r.tableName]) groupedByTable[r.tableName] = [];
    groupedByTable[r.tableName].push(r);
  }

  // Available filters (basic metadata)
  const availableFilters = {
    sourceTables: Array.from(new Set(sorted.map((r) => r.tableName))).sort(),
    matchingColumns: Array.from(new Set(sorted.flatMap((r) => r.matchingColumns))).sort(),
    matchTypes: Array.from(new Set(sorted.flatMap((r) => r.matchTypes))).sort(),
    missionIds: Array.from(new Set(sorted.map((r) => r.missionId).filter((v) => v != null))).map(String),
  };

  return {
    query: { searchType, searchValue: req.searchValue, matchMode: req.matchMode, missionSearchField: req.missionSearchField || null },
    groupedResults: groupedByTable,
    results: paged,
    missionSearch: missionMeta ? {
      missions: missionMeta.missions,
      selectedMissionIds: req.selectedMissionIds || [],
    } : null,
    statistics,
    pagination: { page, pageSize, total, totalPages },
    availableFilters,
  };
}

export async function searchMissions(req: { searchType?: string; missionSearchField?: 'id' | 'label' | 'name' | 'location'; searchValue: string; matchMode?: MatchMode }) {
  const meta = await resolveMissionSearch({
    searchType: 'MISSION',
    searchValue: req.searchValue,
    matchMode: req.matchMode === 'partial' ? 'partial' : 'exact',
    missionSearchField: req.missionSearchField,
  });
  return { missions: meta.missions };
}

export async function getMissionAssociatedRecords(missionId: number, opts: { page?: number; pageSize?: number; sortBy?: string; sortOrder?: 'asc' | 'desc'; sourceTable?: string; dateFrom?: string; dateTo?: string }, perms: any) {
  if (!Number.isInteger(missionId) || missionId <= 0) throw new Error('Invalid mission id');
  const mission = await db.mission.findUnique({ where: { id: missionId } });
  if (!mission) throw new Error('Mission not found');

  const page = Math.max(1, Number(opts.page) || 1);
  const pageSize = Math.min(200, Math.max(1, Number(opts.pageSize) || 25));

  const defs = GLOBAL_SEARCH_REGISTRY.filter((d) => d.missionIdField && (!opts.sourceTable || opts.sourceTable === d.tableName || opts.sourceTable === d.key));
  const groups: Record<string, { total: number; records: any[] }> = {};
  let totalAll = 0;

  for (const def of defs) {
    if (!canAccessTable(def.tableName, perms)) continue;
    let where: any = { [def.missionIdField!]: missionId };
    // date filters best-effort
    if (def.dateField && (opts.dateFrom || opts.dateTo)) {
      const cond: any = {};
      if (opts.dateFrom) cond.gte = opts.dateFrom;
      if (opts.dateTo) cond.lte = opts.dateTo;
      where = { AND: [where, { [def.dateField]: cond }] };
    }
    const model = (db as any)[lcFirst(def.prismaModel)];
    const total = await model.count({ where });
    totalAll += total;
    const orderBy = opts.sortBy && (def.sortable.includes(opts.sortBy) || opts.sortBy === 'id') ? { [opts.sortBy]: opts.sortOrder === 'desc' ? 'desc' : 'asc' } : { id: 'desc' };
    const records = await model.findMany({ where, orderBy, skip: (page - 1) * pageSize, take: pageSize });
    groups[def.tableName] = { total, records: records.map(serializeRecord) };
  }

  // also include extras/gps/map db/user layers with missionId not in main registry list above? They have missionId; add lightweight
  const extraTables: Array<{ table: string; model: string }> = [
    { table: 'mission_extras', model: 'missionExtra' },
    { table: 'location_extras', model: 'locationExtra' },
    { table: 'gps_history', model: 'gpsHistory' },
    { table: 'map_cell_databases', model: 'mapCellDatabase' },
    { table: 'map_user_markers', model: 'mapUserMarker' },
    { table: 'map_user_polygons', model: 'mapUserPolygon' },
    { table: 'map_user_circles', model: 'mapUserCircle' },
  ];
  for (const et of extraTables) {
    if (opts.sourceTable && opts.sourceTable !== et.table) continue;
    const model = (db as any)[et.model];
    if (!model) continue;
    const where = { missionId };
    const total = await model.count({ where });
    totalAll += total;
    const records = await model.findMany({ where, orderBy: { id: 'desc' }, skip: (page - 1) * pageSize, take: pageSize });
    groups[et.table] = { total, records: records.map(serializeRecord) };
  }

  return {
    mission: serializeRecord(mission),
    groups,
    pagination: { page, pageSize, total: totalAll, totalPages: Math.max(1, Math.ceil(totalAll / pageSize)) },
  };
}

export async function getGlobalSearchRecord(tableName: string, recordId: string, perms: any) {
  const def = tableKeyByName(tableName);
  if (!def) throw new Error('Table not allowed');
  if (!canAccessTable(def.tableName, perms)) throw new Error('Access denied');

  const model = (db as any)[lcFirst(def.prismaModel)];
  let id: any = recordId;
  // numeric/bigint handling
  if (def.tableName === 'activity_logs') {
    try { id = BigInt(String(recordId)); } catch { throw new Error('Invalid record id'); }
  } else {
    const n = Number(recordId);
    if (Number.isInteger(n)) id = n; else id = recordId;
  }
  const rec = await model.findUnique({ where: { id } });
  if (!rec) return null;
  const result = buildUnifiedResult(def, rec, [], undefined, false);
  await enrichMissionInfo([result]);
  return result;
}

export async function getGlobalSearchStatistics(req: SearchRequest, perms: any) {
  // reuse full search logic but compute over all matches (without pagination slicing issue we recompute from full set)
  const full = await executeGlobalSearch({ ...req, page: 1, pageSize: 1000000 }, perms);
  return { statistics: full.statistics, missionSearch: full.missionSearch, total: full.pagination.total };
}

function csvEscape(value: any): string {
  if (value === null || value === undefined) return '';
  const str = String(value);
  const escaped = str.replace(/"/g, '""');
  if (/[",\n\r]/.test(escaped) || /^\s|\s$/.test(escaped) || /^[=+\-@]/.test(escaped)) return `"${escaped}"`;
  return escaped;
}

function flattenForExport(r: UnifiedSearchResult) {
  return {
    tableName: r.tableName,
    recordId: r.recordId,
    matchingColumns: r.matchingColumns.join('; '),
    matchingValues: r.matchingValues.map((v) => (v == null ? 'NULL' : String(v))).join('; '),
    matchTypes: r.matchTypes.join('; '),
    missionId: r.missionId ?? '',
    mission: r.mission ?? '',
    missionName: r.missionName ?? '',
    missionLocation: r.missionLocation ?? '',
    eventDate: r.eventDate ?? '',
    sourceFile: r.sourceFile ?? '',
    importBatchId: r.importBatchId ?? '',
    ...r.recordData,
  };
}

export async function exportGlobalSearch(req: SearchRequest & { format: 'csv' | 'xlsx' | 'pdf'; scope?: 'all' | 'table' | 'selected'; selectedTable?: string; selectedRecordKeys?: string[]; selectedMissionIds?: Array<string | number>; includeMissionSummary?: boolean }, perms: any) {
  if (!perms?.canExport) throw new Error('Insufficient permissions to export');
  const full = await executeGlobalSearch({ ...req, page: 1, pageSize: 1000000 }, perms);
  let results = full.results as UnifiedSearchResult[];
  // executeGlobalSearch paged results only; but we need all matching records. adjust: call internal by reusing logic differently.
  // easier: re-run by collecting all before slice - refactor quick approach: executeGlobalSearchAll
  results = await executeGlobalSearchAll(req, perms);

  if (req.selectedMissionIds && req.selectedMissionIds.length) {
    const ids = new Set(req.selectedMissionIds.map(String));
    results = results.filter((r) => r.missionId != null && ids.has(String(r.missionId)));
  }
  if (req.scope === 'table' && req.selectedTable) {
    results = results.filter((r) => r.tableName === req.selectedTable || tableKeyByName(req.selectedTable!)?.tableName === r.tableName);
  }
  if (req.scope === 'selected' && req.selectedRecordKeys && req.selectedRecordKeys.length) {
    const set = new Set(req.selectedRecordKeys);
    results = results.filter((r) => set.has(`${r.tableName}::${r.recordId}`));
  }

  const format = req.format || 'csv';
  const filenameBase = `global_search_export_${Date.now()}`;

  if (format === 'csv') {
    const rows = results.map(flattenForExport);
    const headers = Array.from(new Set(rows.flatMap((r) => Object.keys(r))));
    // Ensure key columns first
    const priority = ['tableName', 'recordId', 'matchingColumns', 'matchingValues', 'matchTypes', 'missionId', 'mission', 'missionName', 'missionLocation', 'eventDate', 'sourceFile', 'importBatchId'];
    const ordered = [...priority.filter((h) => headers.includes(h)), ...headers.filter((h) => !priority.includes(h)).sort()];
    const lines = [ordered.map(csvEscape).join(',')];
    for (const row of rows) {
      lines.push(ordered.map((h) => csvEscape((row as any)[h] == null ? 'NULL' : (row as any)[h])).join(','));
    }
    // mission summary section if requested
    if (req.includeMissionSummary && full.missionSearch?.missions) {
      lines.push('');
      lines.push(csvEscape('Mission Summary'));
      const mHeaders = ['id', 'mission', 'missionName', 'location', 'createdAt', 'associatedRecordsTotal'];
      lines.push(mHeaders.join(','));
      for (const m of full.missionSearch.missions) {
        lines.push(mHeaders.map((h) => csvEscape((m as any)[h] == null ? 'NULL' : (m as any)[h])).join(','));
      }
    }
    return { content: Buffer.from('\ufeff' + lines.join('\n'), 'utf8'), contentType: 'text/csv; charset=utf-8', filename: `${filenameBase}.csv` };
  }

  if (format === 'xlsx') {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Global Search Results');
    const rows = results.map(flattenForExport);
    const headers = Array.from(new Set(rows.flatMap((r) => Object.keys(r))));
    const priority = ['tableName', 'recordId', 'matchingColumns', 'matchingValues', 'matchTypes', 'missionId', 'mission', 'missionName', 'missionLocation', 'eventDate', 'sourceFile', 'importBatchId'];
    const ordered = [...priority.filter((h) => headers.includes(h)), ...headers.filter((h) => !priority.includes(h)).sort()];
    ws.columns = ordered.map((h) => ({ header: h, key: h, width: Math.min(40, Math.max(12, h.length + 2)) }));
    for (const row of rows) {
      const obj: any = {};
      for (const h of ordered) {
        const v = (row as any)[h];
        obj[h] = v == null ? 'NULL' : (typeof v === 'object' ? JSON.stringify(v) : String(v));
      }
      const added = ws.addRow(obj);
      ordered.forEach((h, idx) => { const cell = added.getCell(idx + 1); cell.numFmt = '@'; });
    }
    if (req.includeMissionSummary && full.missionSearch?.missions) {
      const ms = wb.addWorksheet('Mission Summary');
      ms.columns = [
        { header: 'Mission ID', key: 'id' }, { header: 'Mission Label', key: 'mission' }, { header: 'Mission Name', key: 'missionName' }, { header: 'Location', key: 'location' }, { header: 'Created At', key: 'createdAt' }, { header: 'Associated Records', key: 'associatedRecordsTotal' },
      ];
      for (const m of full.missionSearch.missions) ms.addRow({ ...m, id: String(m.id) });
    }
    const buf = await wb.xlsx.writeBuffer();
    return { content: Buffer.from(buf), contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', filename: `${filenameBase}.xlsx` };
  }

  if (format === 'pdf') {
    const doc = new PDFDocument({ margin: 36, size: 'A4', layout: 'landscape' });
    const chunks: Buffer[] = [];
    doc.on('data', (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
    const done = new Promise<Buffer>((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))));
    doc.fontSize(14).text('Global Search Export', { align: 'left' });
    doc.moveDown(0.5);
    doc.fontSize(9).text(`Search Type: ${req.searchType} | Value: ${String(req.searchValue)} | Results: ${results.length}`);
    doc.text(`Generated: ${new Date().toISOString()}`);
    doc.moveDown(0.5);
    for (const r of results.slice(0, 2000)) {
      doc.fontSize(9).text(`[${r.tableName}] #${r.recordId} | Match: ${r.matchingColumns.join(', ')} = ${r.matchingValues.map((v) => v ?? 'NULL').join(', ')} | Mission: ${r.missionId ?? ''} ${r.mission ?? ''}`);
      if (r.tableName === 'activity_logs' && r.recordData?.originalRecord) {
        doc.fontSize(8).text(`Original: ${String(r.recordData.originalRecord).slice(0, 300)}`);
      }
      doc.moveDown(0.2);
      if (doc.y > doc.page.height - 60) doc.addPage();
    }
    if (results.length > 2000) doc.text(`... truncated in PDF preview (${results.length - 2000} more). Use CSV/XLSX for full export.`);
    doc.end();
    const buf = await done;
    return { content: buf, contentType: 'application/pdf', filename: `${filenameBase}.pdf` };
  }

  throw new Error('Unsupported format');
}

export async function executeGlobalSearchAll(req: SearchRequest, perms: any): Promise<UnifiedSearchResult[]> {
  const searchType = req.searchType;
  let missionMeta: { missions: any[]; missionById: Map<number, any>; legacyLabels: Set<string> } | undefined;
  let allResults: UnifiedSearchResult[] = [];
  if (searchType === 'MISSION') {
    missionMeta = await resolveMissionSearch(req);
    const selectedIdsRaw = Array.isArray(req.selectedMissionIds) ? req.selectedMissionIds : [];
    const selectedIds = selectedIdsRaw.map((v) => parsePositiveIntLike(v)).filter((v): v is number => v != null);
    const allowedMissionIds = selectedIds.length ? new Set(selectedIds) : null;
    const includeLegacy = req.filters?.includeLegacyTextMatches !== false;
    const excludeLegacy = req.filters?.excludeLegacyTextMatches === true;
    const missionById = allowedMissionIds ? new Map(Array.from(missionMeta.missionById.entries()).filter(([id]) => allowedMissionIds.has(id))) : missionMeta.missionById;
    const searchableTables = GLOBAL_SEARCH_REGISTRY.filter((t) => t.missionIdField || t.legacyMissionTextField);
    for (const def of searchableTables) {
      const part = await searchTable(def, req, perms, { missionById, allowedMissionIds, legacyMissionLabels: missionMeta.legacyLabels, includeLegacy, excludeLegacy });
      allResults.push(...part);
    }
  } else {
    const defs = GLOBAL_SEARCH_REGISTRY.filter((d) => getDefsForSearch(d, searchType).length > 0);
    for (const def of defs) {
      const part = await searchTable(def, req, perms);
      allResults.push(...part);
    }
  }
  allResults = dedupeResults(allResults);
  await enrichMissionInfo(allResults);
  allResults = allResults.filter((r) => resultMatchesPostFilters(r, req.filters));
  return applySorting(allResults, req.sortBy, req.sortOrder);
}

export const GLOBAL_SEARCH_TYPES: GlobalSearchType[] = ['IMSI', 'IMEI', 'TMSI', 'PSTN', 'UNIQUE_CALL_ID', 'SYSTEM_ID', 'MAC_ADDRESS', 'BSSID', 'GENERAL_TEXT', 'MISSION', 'MCC', 'MNC', 'LAC', 'CELL_ID'];
