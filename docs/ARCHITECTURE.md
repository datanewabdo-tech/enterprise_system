# Enterprise Data Management, Mapping & Analytics Dashboard
## Complete Architecture & Engineering Specification

### 1. System Architecture Diagram

```
+-----------------------------------------------------------------------------------+
|                                 CLIENT TIER                                       |
|  React 19 + TypeScript + Tailwind CSS (Bilingual LTR / RTL: Cairo / Tajawal / Inter) |
|  [Dashboard] [23 Table Views] [Interactive Map] [Analytics] [Import/Export Center]|
+----------------------------------------+------------------------------------------+
                                         | REST APIs (JSON / Multipart-Form / Streams)
                                         v
+-----------------------------------------------------------------------------------+
|                               REVERSE PROXY TIER                                  |
|                             Nginx (SSL, Gzip, Caching)                            |
+----------------------------------------+------------------------------------------+
                                         | Forwarding /api/v1/ and SPA Routing
                                         v
+-----------------------------------------------------------------------------------+
|                                APPLICATION TIER                                   |
|               Node.js 22 + Express + TypeScript Modular Architecture               |
|  - Auth & Security: JWT, bcrypt, Role-based Access Control (5 Roles), Rate Limit  |
|  - Data Engines: ExcelJS Parser, Streaming CSV Parser, SQLite Parser (node:sqlite)|
|  - Coordinate Engine: Parser for Lat/Lng, Semicolon, Comma, WKT, GeoJSON Order    |
|  - Analytics Engine: Dynamic multi-dimensional aggregation, time-series, metrics   |
|  - Audit System: Immutable tamper-evident audit logging for all mutations/access   |
|  - Export Engine: Excel, CSV, JSON, GeoJSON streaming exports                     |
+----------------------------------------+------------------------------------------+
                                         | ORM & Parameterized Queries
                                         v
+-----------------------------------------------------------------------------------+
|                                  DATA TIER                                        |
|  Primary: PostgreSQL 16 (Prisma ORM with 23 domain models + 5 system models)      |
|  Persistence: Volumes for database files, uploaded documents, backups             |
+-----------------------------------------------------------------------------------+
```

---

### 2. Complete Database Relationship Diagram (ERD)

```
missions (1) <------- (N) registrations (reg_id, mission, bts, imsi, imei, device_location, ...)
missions (1) <------- (N) targets (imsi, imei, name, redirect_tech, ...)
missions (1) <------- (N) mission_extras (mission_name, description)
missions (1) <------- (N) location_extras (mission_id, description)
missions (1) <------- (N) network_cells (channel, lac, mcc, mnc, cell_id, rat, lat, lng, ...)
missions (1) <------- (N) wifi_access_points (bssid, essid, enc, channel, ...)
missions (1) <------- (N) gps_history (bts_id, silent_target_reg_id, timestamp, lat, lng, ...)
missions (1) <------- (N) map_cell_databases (name, header, color)
missions (1) <------- (N) sms_calls (sms_id, call_id, incoming, is_sms, source, destination, ...)
missions (1) <------- (N) map_user_markers (type, description, image, color, lat, lng, ...)
missions (1) <------- (N) map_user_polygons (points, label, color, description, ...)
missions (1) <------- (N) map_user_circles (lat, lng, radius, label, color, ...)

mission_extras (1) <-- (N) mission_files (file_path, file_type, original_file_name, added_at)
location_extras (1) <- (N) location_files (file_path, file_type, original_file_name, added_at)
targets (1) <-------- (N) target_files (file_path, file_type, original_file_name, added_at)
wifi_access_points (1) < (N) wifi_access_point_clients (mac, wants, manufacturer, ...)
map_cell_databases (1) < (N) map_cells (lat, lng, mcc, mnc, lac, cid, address, direction, ...)

Global Reference & Operational Tables:
- plmn_storage (mcc, mnc, country, code, name)
- whitelist_targets (id, name, imsi, imei)
- tac_numbers (id, tac_id, name, tac)
- scheduled_tasks (id, task_type, execution_time, json_params, status)
- map_layers (id, name, type, path)
- users (id, username, email, password_hash, role, status)
- audit_logs (id, user_id, username, action, module, record_id, timestamp)
- import_history (id, filename, file_type, destination_table, inserted, updated, errors)
- saved_views (id, user_id, table_name, view_name, filters_json, sort_json)
- app_settings (key, value, description)
```

---

### 3. Implementation Roadmap

- **Phase 1: Foundation & Infrastructure**:
  - Full-stack Express + Vite integration in `server.ts`.
  - Prisma Schema definition (`prisma/schema.prisma`) for PostgreSQL with all 23 domain models + 5 system models.
  - Complete Docker environment: `Dockerfile.frontend`, `Dockerfile.backend`, `docker-compose.yml`, `nginx.conf`, `.env.example`.
  - Bilingual i18n localization store (English & Arabic) with full LTR/RTL support.
  - Authentication engine: JWT, role-based access control, session validation.

- **Phase 2: Database & Seed Engine**:
  - Unified repository layer connecting to PostgreSQL (via DATABASE_URL) or persistent storage (`data/database.sqlite`).
  - Auto-migrations and schema seeding with realistic mission records across all 23 tables.

- **Phase 3: Reusable Enterprise UI & Table Pages**:
  - Generic enterprise data table component with server-side pagination, search, multi-column sorting, column visibility toggle.
  - Advanced dynamic filter builder supporting: equals, not equals, contains, starts with, ends with, greater than, less than, between, is empty, is not empty, date ranges, and AND/OR logic.
  - Sensitive data masking controls (IMSI, IMEI, TMSI, phone numbers) with role-level reveal toggle.
  - Dedicated pages for all 23 tables with CRUD operations, detail drawer, and Excel/CSV export.

- **Phase 4: Data Import Center**:
  - Multi-step wizard supporting:
    - Excel (.xlsx, .xls) with sheet selector, auto-column matching, mapping table, 100-record preview, validation, and batch insert.
    - CSV (.csv) streaming parser.
    - SQLite (.db, .sqlite, .sqlite3) schema inspection, table selector, type-compatible column mapper, and batch import.
  - Configurable duplicate handling (Insert-Only, Update-Existing, Insert-or-Update).
  - Import history, audit log creation, and error reporting.

- **Phase 5: Interactive Map & Geographic Engine**:
  - Full-screen Leaflet interactive map with dark/satellite/street layers.
  - Multi-format coordinate parser (lat/lng, semicolon `lat;lng`, comma `lat,lng`, WKT Point, GeoJSON Point).
  - Visual layers: Map Cells, Network Cells, GPS History tracks, User Markers, User Polygons, User Circles.
  - Coordinate order selector (Lat-Long vs Long-Lat) with validation warnings (-90 to 90, -180 to 180).
  - GeoJSON export and layer controls.

- **Phase 6: Dashboard, Analytics & Charts**:
  - Executive KPI summary cards derived from real database records.
  - Interactive charts (records by mission, country, date, RAT distribution, import activity).
  - Dynamic Custom Analytics Builder: table selection, metric selection, group-by dimension, aggregation function (count, sum, avg, min, max), and chart type.

- **Phase 7: Administration & Security**:
  - User management with 5 roles: Super Admin, Admin, Data Manager, Data Analyst, Viewer.
  - Audit logs viewer with filtering and tamper-evident records.
  - System health monitor: server status, memory/disk usage, DB connection, uptime.
  - Database backup & recovery interface.
