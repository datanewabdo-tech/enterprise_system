import React, { useState } from 'react';
import { useApp } from '../context/AppContext.js';
import { DataTable } from '../components/common/DataTable.js';
import { RecordDetailModal } from '../components/common/RecordDetailModal.js';
import { RecordFormModal } from '../components/common/RecordFormModal.js';
import { ColumnMeta } from '../types/index.js';

interface TableViewProps {
  tableId: string;
  title: string;
  description: string;
}

export const TableView: React.FC<TableViewProps> = ({ tableId, title, description }) => {
  const { t, apiFetch } = useApp();

  const [selectedRecord, setSelectedRecord] = useState<any | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);

  const [formOpen, setFormOpen] = useState(false);
  const [editingRecord, setEditingRecord] = useState<any | null>(null);
  const [columns, setColumns] = useState<ColumnMeta[]>([]);
  const [refreshKey, setRefreshKey] = useState(0);

  const handleRowClick = (record: any) => {
    setSelectedRecord(record);
    setDetailOpen(true);
  };

  const handleEdit = (record: any) => {
    setEditingRecord(record);
    // Fetch columns for form if needed
    apiFetch(`/api/v1/tables/${tableId}?pageSize=1`)
      .then(r => r.json())
      .then(res => {
        if (res.columns) setColumns(res.columns);
        setFormOpen(true);
      });
  };

  const handleCreate = () => {
    setEditingRecord(null);
    apiFetch(`/api/v1/tables/${tableId}?pageSize=1`)
      .then(r => r.json())
      .then(res => {
        if (res.columns) setColumns(res.columns);
        setFormOpen(true);
      });
  };

  const handleDelete = async (record: any) => {
    if (!record.id) return;
    if (window.confirm(t('confirmDelete') + '\n\n' + t('deleteWarning'))) {
      try {
        const res = await apiFetch(`/api/v1/tables/${tableId}/${record.id}`, {
          method: 'DELETE',
        });
        if (res.ok) {
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
        onSuccess={() => {
          setRefreshKey(k => k + 1);
        }}
      />
    </div>
  );
};
