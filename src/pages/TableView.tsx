import React, { useState, useRef, useEffect } from 'react';
import { useApp } from '../context/AppContext.js';
import { DataTable } from '../components/common/DataTable.js';
import { RecordDetailModal } from '../components/common/RecordDetailModal.js';
import { RecordFormModal } from '../components/common/RecordFormModal.js';
import { ColumnMeta } from '../types/index.js';
import { requestCache } from '../utils/requestCache.js';

interface TableViewProps {
  tableId: string;
  title: string;
  description: string;
}

export const TableView: React.FC<TableViewProps> = ({ tableId, title, description }) => {
  const { t, apiFetch, refreshMissions } = useApp();

  const [selectedRecord, setSelectedRecord] = useState<any | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);

  const [formOpen, setFormOpen] = useState(false);
  const [editingRecord, setEditingRecord] = useState<any | null>(null);
  const [columns, setColumns] = useState<ColumnMeta[]>([]);
  const [columnsLoading, setColumnsLoading] = useState(false);
  const [columnsError, setColumnsError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const schemaAbortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    setColumns([]);
    setColumnsError(null);
    return () => {
      if (schemaAbortRef.current) schemaAbortRef.current.abort();
    };
  }, [tableId]);

  const loadSchema = async () => {
    if (schemaAbortRef.current) schemaAbortRef.current.abort();
    const controller = new AbortController();
    schemaAbortRef.current = controller;

    setColumnsLoading(true);
    setColumnsError(null);
    try {
      const res = await apiFetch(`/api/v1/tables/${tableId}?pageSize=1`, {
        signal: controller.signal,
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(json?.error || `Failed to load ${tableId} schema`);
      }
      if (!controller.signal.aborted && Array.isArray(json?.columns)) {
        setColumns(json.columns);
      }
    } catch (err: any) {
      if (err?.name === 'AbortError' || controller.signal.aborted) return;
      setColumnsError(err?.message || 'Failed to load table schema');
    } finally {
      if (!controller.signal.aborted) {
        setColumnsLoading(false);
      }
    }
  };

  const handleRowClick = (record: any) => {
    setSelectedRecord(record);
    setDetailOpen(true);
  };

  const handleEdit = (record: any) => {
    setEditingRecord(record);
    setFormOpen(true);
    if (columns.length === 0) {
      void loadSchema();
    }
  };

  const handleCreate = () => {
    setEditingRecord(null);
    setFormOpen(true);
    if (columns.length === 0) {
      void loadSchema();
    }
  };

  const handleDelete = async (record: any) => {
    if (!record.id) return;
    if (window.confirm(t('confirmDelete') + '\n\n' + t('deleteWarning'))) {
      try {
        const res = await apiFetch(`/api/v1/tables/${tableId}/${record.id}`, {
          method: 'DELETE',
        });
        if (res.ok) {
          requestCache.clear();
          if (tableId === 'missions') refreshMissions();
          setRefreshKey(k => k + 1);
        }
      } catch (err) {
        console.error(err);
      }
    }
  };

  return (
    <div>
      <DataTable
        tableName={tableId}
        title={title}
        description={description}
        onRowClick={handleRowClick}
        onEditRecord={handleEdit}
        onDeleteRecord={handleDelete}
        onCreateRecord={handleCreate}
        refreshTrigger={refreshKey}
      />

      {/* Record Details Slide-over Drawer */}
      <RecordDetailModal
        isOpen={detailOpen}
        onClose={() => setDetailOpen(false)}
        tableName={tableId}
        record={selectedRecord}
        onEdit={handleEdit}
      />

      {/* Record Create / Edit Form Modal */}
      <RecordFormModal
        isOpen={formOpen}
        onClose={() => setFormOpen(false)}
        tableName={tableId}
        record={editingRecord}
        columns={columns}
        columnsLoading={columnsLoading}
        columnsError={columnsError}
        onRetryColumns={loadSchema}
        onSuccess={() => {
          requestCache.clear();
          if (tableId === 'missions') refreshMissions();
          setRefreshKey(k => k + 1);
        }}
      />
    </div>
  );
};
