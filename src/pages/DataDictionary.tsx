import React, { useState, useEffect } from 'react';
import { useApp } from '../context/AppContext.js';
import { BookOpen, Search, Database, Key, Check, Layers } from 'lucide-react';

export const DataDictionary: React.FC = () => {
  const { t, apiFetch, authToken } = useApp();
  const [dictionary, setDictionary] = useState<any[]>([]);
  const [, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  useEffect(() => {
    if (!authToken) return;
    apiFetch('/api/v1/system/data-dictionary')
      .then(r => (r.ok ? r.json() : []))
      .then(data => setDictionary(Array.isArray(data) ? data : []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [authToken]);

  const filtered = dictionary.filter(
    item =>
      item.table.toLowerCase().includes(search.toLowerCase()) ||
      item.columns.some((c: any) => c.name.toLowerCase().includes(search.toLowerCase()))
  );

  return (
    <div className="space-y-6">
      {/* Title */}
      <div>
        <h1 className="text-xl font-bold text-slate-100 flex items-center gap-2">
          <BookOpen className="w-5 h-5 text-indigo-400" />
          <span>{t('dictionaryTitle')}</span>
        </h1>
        <p className="text-xs text-slate-400 mt-0.5">{t('dictionarySubtitle')}</p>
      </div>

      {/* Search Input */}
      <div className="relative max-w-md">
        <Search className="absolute left-3 top-2.5 w-4 h-4 text-slate-500 rtl:right-3 rtl:left-auto" />
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Filter tables or column names..."
          className="w-full h-9 pl-9 pr-3 rtl:pr-9 rtl:pl-3 text-xs bg-slate-900 border border-slate-800 rounded-lg text-slate-200 placeholder-slate-500 focus:outline-none focus:border-indigo-500"
        />
      </div>

      {/* Dictionary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {filtered.map(table => (
          <div
            key={table.table}
            className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-sm space-y-3"
          >
            <div className="flex items-center justify-between border-b border-slate-800 pb-2.5">
              <div className="flex items-center gap-2">
                <Database className="w-4 h-4 text-indigo-400" />
                <span className="font-mono text-sm font-bold text-slate-100">{table.table}</span>
              </div>
              <span className="text-[11px] px-2 py-0.5 rounded-full bg-slate-800 text-slate-300 font-mono">
                {table.rowCount.toLocaleString()} rows
              </span>
            </div>

            <div className="max-h-60 overflow-y-auto space-y-1 pr-1">
              {table.columns.map((col: any) => (
                <div
                  key={col.name}
                  className="flex items-center justify-between p-1.5 rounded bg-slate-950/60 text-xs font-mono"
                >
                  <div className="flex items-center gap-1.5">
                    {col.primaryKey && <Key className="w-3 h-3 text-amber-400" />}
                    <span className="text-slate-200">{col.name}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] text-indigo-400 font-semibold">{col.type}</span>
                    <span className="text-[10px] text-slate-500">
                      {col.nullable ? 'NULL' : 'NOT NULL'}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
