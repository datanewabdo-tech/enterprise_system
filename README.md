# Enterprise Data Management, Mapping & Analytics Dashboard

A modern, enterprise-grade web application for managing, importing, visualizing, filtering, and analyzing structured mission-related datasets with geospatial intelligence and bilingual Arabic/English support.

---

## 1. Technology Stack

- **Frontend**: React 19, TypeScript, Tailwind CSS, Lucide Icons, Recharts, Leaflet with OpenStreetMap.
- **Backend**: Node.js 22, Express.js, TypeScript, REST API with Zod validation.
- **Database**: PostgreSQL 16 (production) with Prisma ORM / Embedded high-performance persistent WAL storage.
- **Data Ingestion**: ExcelJS (Excel .xlsx, .xls), CSV Parser (streaming), SQLite parser (`node:sqlite`).
- **Security & Privacy**: JWT authentication, bcrypt password hashing, Role-Based Access Control (5 tiers), field-level IMSI/IMEI privacy masking, tamper-evident immutable audit logs.
- **Deployment**: Fully Dockerized with Docker Compose and Nginx reverse proxy.
- **Localization**: Full English (LTR) and Arabic (RTL) localization with Cairo / Tajawal typography.

---

## 2. Default Operator Accounts

| Username | Role | Default Password | Permissions |
| :--- | :--- | :--- | :--- |
| **admin** | `SUPER_ADMIN` | `admin123` | Full access, user management, backups, settings, unmasked data |
| **manager** | `DATA_MANAGER` | `admin123` | CRUD operations, batch imports, exports, unmasked data |
| **analyst** | `DATA_ANALYST` | `admin123` | Advanced analytics, chart studio, exports, masked identifiers |

---

## 3. Quick Start (Docker Deployment)

Start the entire stack (PostgreSQL, Express backend, React frontend, Nginx):

```bash
# 1. Clone repository & configure environment
cp .env.example .env

# 2. Build and start containers
docker compose up -d --build

# 3. View status and logs
docker compose ps
docker compose logs -f backend
```

Access the application in your browser at: `http://localhost:80` (or `http://localhost:3000` in dev mode).

### Docker Administration Commands

```bash
# Stop all services
docker compose down

# Stop and remove persistent data volumes
docker compose down -v

# View backend API logs
docker compose logs -f backend

# Run Prisma database migrations
docker compose exec backend npx prisma migrate deploy

# Open PostgreSQL interactive shell
docker compose exec -it postgres psql -U enterprise_user -d enterprise_dashboard
```

---

## 4. Local Development

```bash
# Install dependencies
npm install

# Start full-stack development server on port 3000
npm run dev

# Run TypeScript linter
npm run lint

# Build for production
npm run build
```

---

## 5. Database Schema & Architecture

The system provisions and manages 23 dedicated domain tables:
1. `missions`: Field missions, geographic assignments, and linked dossiers.
2. `registrations`: Device registrations, IMSI, IMEI, TMSI, distance ranges, and BTS link.
3. `targets`: Monitored targets, actions, redirect frequencies, and technical parameters.
4. `mission_extras`: Additional operational dossiers linked to missions.
5. `location_extras`: Sector site descriptions and geographic characteristics.
6. `mission_files`: Secure mission attachments and briefings.
7. `location_files`: Site blueprints and spatial sector files.
8. `network_cells`: Active cellular towers, Rx levels, PCI, BSIC, downlink frequencies.
9. `wifi_access_points`: Discovered WiFi BSSIDs, ESSIDs, encryption types, channels.
10. `wifi_access_point_clients`: Associated and probed client device MAC addresses.
11. `gps_history`: Time-series geographic coordinates, uplink/downlink power telemetry.
12. `map_cell_databases`: Base station database clusters and display colors.
13. `map_cells`: Geographic cell coordinates, sector azimuth direction, opening angles.
14. `plmn_storage`: International Mobile Country Codes (MCC) and Network Codes (MNC).
15. `sms_calls`: Intercept records, routing numbers, BTS identities, timestamps.
16. `map_user_markers`: Tactical map pins, command posts, checkpoints.
17. `map_user_polygons`: Perimeter boundaries, exclusion buffers, and GeoJSON polygons.
18. `map_user_circles`: Radial exclusion zones and RF signal range circles.
19. `target_files`: Intelligence dossiers and target attachments.
20. `whitelist_targets`: Friendly assets excluded from target tracking.
21. `tac_numbers`: Type Allocation Code lookup mapping 8-digit TAC to device models.
22. `scheduled_tasks`: Automated retention cleanup and background aggregation jobs.
23. `map_layers`: GeoJSON spatial vector and raster layer catalog.

Plus supporting system models:
- `users`: User profiles and role assignments.
- `audit_logs`: Immutable audit trail for logins, queries, imports, and exports.
- `import_history`: Batch import transaction logs with error tracking.
- `saved_views`: User-saved filter presets and column layouts.
- `app_settings`: Global retention windows and privacy configuration.

---

## 6. Data Import Center

Supports 3 primary data formats:
1. **Excel (.xlsx, .xls)**: Multi-sheet inspection, automatic column mapping, preview, upsert.
2. **CSV (.csv)**: Streaming ingestion with configurable delimiter support.
3. **SQLite (.db, .sqlite, .sqlite3)**: Read-only inspection of SQLite tables, automatic schema extraction, and direct migration into PostgreSQL.

### Geographic Coordinate Parser
Supports parsing coordinates in multiple formats:
- Separate `latitude` and `longitude` columns.
- Semicolon-delimited text: `30.0444;31.2357`
- Comma-delimited text: `30.0444,31.2357`
- WKT format: `POINT(31.2357 30.0444)`
- GeoJSON Point geometry: `{"type": "Point", "coordinates": [31.2357, 30.0444]}`
- Strict bounds validation: Latitude [-90, 90], Longitude [-180, 180].

---

## 7. Backup and Recovery

### PostgreSQL Native Backup (Production)
```bash
# Create full encrypted snapshot
docker exec -t enterprise_dashboard_db pg_dump -U enterprise_user enterprise_dashboard | gzip > backups/enterprise_backup_$(date +%Y%m%d).sql.gz

# Restore database snapshot
gunzip -c backups/enterprise_backup_20261112.sql.gz | docker exec -i enterprise_dashboard_db psql -U enterprise_user -d enterprise_dashboard
```

### Web UI Snapshot
Authorized administrators can click **Create Full Backup Snapshot** in the **Backup & Recovery** page to generate a point-in-time snapshot with SHA-256 integrity validation.
