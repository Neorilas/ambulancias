/**
 * AdminPanel.jsx
 * Panel exclusivo para superadmin (Findelias).
 * Muestra:
 *   - Estadísticas generales del sistema
 *   - Historial de auditoría (quién hizo qué y cuándo)
 *   - Log de errores del servidor (5xx)
 */
import React, { useState, useEffect, useCallback } from 'react';
import { adminService } from '../services/admin.service.js';
import { useNotification } from '../context/NotificationContext.jsx';
import { PageLoading } from '../components/common/LoadingSpinner.jsx';
import { formatDateTime } from '../utils/dateUtils.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

const ACTION_ICON = {
  login:               '🔐',
  logout:              '🚪',
  create_trabajo:      '➕',
  update_trabajo:      '✏️',
  delete_trabajo:      '🗑️',
  finalize_trabajo:    '✅',
  activate_trabajo:    '▶️',
  create_vehicle:      '🚐',
  update_vehicle:      '✏️',
  delete_vehicle:      '🗑️',
  create_incidencia:   '⚠️',
  update_incidencia:   '⚠️',
  create_revision:     '🔧',
  create_user:         '👤',
  update_user:         '✏️',
  delete_user:         '🗑️',
  access_denied:       '🚫',
};

function actionIcon(action) {
  return ACTION_ICON[action] || '📝';
}

// ── StatCard ──────────────────────────────────────────────────────────────────
function StatCard({ icon, label, value, sub, color = 'text-neutral-900' }) {
  return (
    <div className="card flex items-center gap-4">
      <span className="text-3xl">{icon}</span>
      <div>
        <p className={`text-2xl font-bold ${color}`}>{value ?? '–'}</p>
        <p className="text-sm text-neutral-500">{label}</p>
        {sub && <p className="text-xs text-neutral-400 mt-0.5">{sub}</p>}
      </div>
    </div>
  );
}

// ── Filtros de fecha ──────────────────────────────────────────────────────────
function DateFilter({ desde, hasta, onDesde, onHasta, onReset }) {
  return (
    <div className="flex flex-wrap gap-2 items-center">
      <label className="text-xs text-neutral-500">Desde</label>
      <input type="date" className="input text-sm py-1" value={desde} onChange={e => onDesde(e.target.value)} />
      <label className="text-xs text-neutral-500">Hasta</label>
      <input type="date" className="input text-sm py-1" value={hasta} onChange={e => onHasta(e.target.value)} />
      {(desde || hasta) && (
        <button onClick={onReset} className="btn-secondary text-xs py-1">Limpiar filtros</button>
      )}
    </div>
  );
}

// ── Tab Auditoría ─────────────────────────────────────────────────────────────
function TabAuditoria() {
  const { notify } = useNotification();
  const [logs,    setLogs]    = useState([]);
  const [total,   setTotal]   = useState(0);
  const [page,    setPage]    = useState(1);
  const [loading, setLoading] = useState(false);
  const [desde,   setDesde]   = useState('');
  const [hasta,   setHasta]   = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await adminService.listAudit({
        page, limit: 30,
        desde: desde || undefined,
        hasta: hasta || undefined,
      });
      setLogs(r.data || []);
      setTotal(r.pagination?.total || 0);
    } catch { notify.error('Error al cargar auditoría'); }
    finally { setLoading(false); }
  }, [page, desde, hasta]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { setPage(1); }, [desde, hasta]);

  const totalPages = Math.ceil(total / 30);

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <p className="text-sm text-neutral-500">{total} registro{total !== 1 ? 's' : ''}</p>
        <DateFilter
          desde={desde} hasta={hasta}
          onDesde={setDesde} onHasta={setHasta}
          onReset={() => { setDesde(''); setHasta(''); }}
        />
      </div>

      {loading ? <PageLoading /> : (
        <>
          {logs.length === 0 ? (
            <div className="card text-center py-10 text-neutral-400">
              <p className="text-3xl mb-2">📋</p>
              <p className="text-sm">Sin registros</p>
            </div>
          ) : (
            <div className="space-y-2">
              {logs.map(log => (
                <div key={log.id} className="card py-3 space-y-1">
                  <div className="flex items-start justify-between gap-2 flex-wrap">
                    <div className="flex items-center gap-2">
                      <span className="text-lg">{actionIcon(log.action)}</span>
                      <div>
                        <span className="font-medium text-sm text-neutral-800">{log.action}</span>
                        {log.entity_type && (
                          <span className="ml-2 text-xs text-neutral-400">
                            → {log.entity_type}
                            {log.entity_id ? ` #${log.entity_id}` : ''}
                          </span>
                        )}
                      </div>
                    </div>
                    <span className="text-xs text-neutral-400 flex-shrink-0">{formatDateTime(log.created_at)}</span>
                  </div>
                  <p className="text-xs text-neutral-600 pl-7">
                    👤 {log.user_info || '—'}
                    {log.ip_address && <span className="ml-2 text-neutral-400">{log.ip_address}</span>}
                  </p>
                  {log.details && (
                    <pre className="text-[10px] text-neutral-400 pl-7 bg-neutral-50 rounded p-1 overflow-x-auto">
                      {typeof log.details === 'string'
                        ? log.details
                        : JSON.stringify(log.details, null, 2)}
                    </pre>
                  )}
                </div>
              ))}
            </div>
          )}

          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-2">
              <button className="btn-secondary" onClick={() => setPage(p => p - 1)} disabled={page === 1}>‹</button>
              <span className="text-sm">{page} / {totalPages}</span>
              <button className="btn-secondary" onClick={() => setPage(p => p + 1)} disabled={page >= totalPages}>›</button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ── Tab Errores ───────────────────────────────────────────────────────────────
function TabErrores() {
  const { notify } = useNotification();
  const [logs,    setLogs]    = useState([]);
  const [total,   setTotal]   = useState(0);
  const [page,    setPage]    = useState(1);
  const [loading, setLoading] = useState(false);
  const [desde,   setDesde]   = useState('');
  const [hasta,   setHasta]   = useState('');
  const [expanded, setExpanded] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await adminService.listErrors({
        page, limit: 20,
        desde: desde || undefined,
        hasta: hasta || undefined,
      });
      setLogs(r.data || []);
      setTotal(r.pagination?.total || 0);
    } catch { notify.error('Error al cargar logs de error'); }
    finally { setLoading(false); }
  }, [page, desde, hasta]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { setPage(1); }, [desde, hasta]);

  const totalPages = Math.ceil(total / 20);

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <p className="text-sm text-neutral-500">{total} error{total !== 1 ? 'es' : ''} registrado{total !== 1 ? 's' : ''}</p>
        <DateFilter
          desde={desde} hasta={hasta}
          onDesde={setDesde} onHasta={setHasta}
          onReset={() => { setDesde(''); setHasta(''); }}
        />
      </div>

      {loading ? <PageLoading /> : (
        <>
          {logs.length === 0 ? (
            <div className="card text-center py-10 text-neutral-400">
              <p className="text-3xl mb-2">✅</p>
              <p className="text-sm">Sin errores registrados</p>
            </div>
          ) : (
            <div className="space-y-2">
              {logs.map(log => (
                <div key={log.id} className="card border-l-4 border-l-red-400 space-y-1">
                  <div className="flex items-start justify-between gap-2 flex-wrap">
                    <div className="flex items-center gap-2">
                      <span className="badge bg-red-100 text-red-700 font-mono text-xs">{log.status_code}</span>
                      <span className="text-xs font-medium text-neutral-600">
                        {log.method} <span className="font-mono text-neutral-800 break-all">{log.url}</span>
                      </span>
                    </div>
                    <span className="text-xs text-neutral-400 flex-shrink-0">{formatDateTime(log.created_at)}</span>
                  </div>

                  <p className="text-sm text-red-700 font-medium">{log.error_message}</p>

                  {log.user_info && (
                    <p className="text-xs text-neutral-500">
                      👤 {log.user_info}
                      {log.ip_address && <span className="ml-2">{log.ip_address}</span>}
                    </p>
                  )}

                  <button
                    onClick={() => setExpanded(expanded === log.id ? null : log.id)}
                    className="text-xs text-primary-600 hover:underline"
                  >
                    {expanded === log.id ? 'Ocultar stack trace' : 'Ver stack trace'}
                  </button>

                  {expanded === log.id && log.stack_trace && (
                    <pre className="text-[10px] bg-neutral-900 text-green-400 rounded p-3 overflow-x-auto max-h-48 mt-1">
                      {log.stack_trace}
                    </pre>
                  )}
                </div>
              ))}
            </div>
          )}

          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-2">
              <button className="btn-secondary" onClick={() => setPage(p => p - 1)} disabled={page === 1}>‹</button>
              <span className="text-sm">{page} / {totalPages}</span>
              <button className="btn-secondary" onClick={() => setPage(p => p + 1)} disabled={page >= totalPages}>›</button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ── Página principal ───────────────────────────────────────────────────────────
const TABS = [
  { key: 'stats',     label: '📊 Resumen' },
  { key: 'auditoria', label: '🕵️ Auditoría' },
  { key: 'errores',   label: '🔴 Errores' },
];

export default function AdminPanel() {
  const { notify } = useNotification();
  const [tab,    setTab]    = useState('stats');
  const [stats,  setStats]  = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (tab !== 'stats') return;
    setLoading(true);
    adminService.getStats()
      .then(setStats)
      .catch(() => notify.error('Error al cargar estadísticas'))
      .finally(() => setLoading(false));
  }, [tab]);

  return (
    <div className="space-y-5 max-w-4xl mx-auto animate-fade-in">
      {/* Cabecera */}
      <div>
        <h1 className="text-xl font-bold text-neutral-900">Panel Superadmin</h1>
        <p className="text-neutral-400 text-sm">Logs del sistema, auditoría y estadísticas avanzadas</p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-neutral-100 p-1 rounded-lg">
        {TABS.map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`flex-1 text-sm font-medium py-1.5 px-3 rounded-md transition ${
              tab === t.key
                ? 'bg-white shadow text-neutral-900'
                : 'text-neutral-500 hover:text-neutral-700'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* ── Stats ── */}
      {tab === 'stats' && (
        loading ? <PageLoading /> : stats ? (
          <div className="space-y-5">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <StatCard icon="📋" label="Acciones auditadas" value={stats.audit_total?.toLocaleString()} />
              <StatCard icon="🔴" label="Errores totales"    value={stats.errors_total?.toLocaleString()} color="text-red-600" />
              <StatCard icon="⚠️" label="Errores hoy"        value={stats.errors_hoy}   color={stats.errors_hoy > 0 ? 'text-orange-600' : 'text-neutral-900'} />
              <StatCard icon="🔒" label="Logins fallidos 24h" value={stats.logins_fallidos_24h} color={stats.logins_fallidos_24h > 10 ? 'text-red-600' : 'text-neutral-900'} />
            </div>

            {stats.top_actions?.length > 0 && (
              <div className="card">
                <h3 className="font-semibold text-neutral-800 mb-3">Acciones más frecuentes</h3>
                <div className="space-y-2">
                  {stats.top_actions.map(a => (
                    <div key={a.action} className="flex items-center gap-3">
                      <span className="text-lg w-6 text-center">{actionIcon(a.action)}</span>
                      <span className="text-sm text-neutral-700 flex-1">{a.action}</span>
                      <span className="font-semibold text-sm text-neutral-900">{a.total}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {stats.top_users?.length > 0 && (
              <div className="card">
                <h3 className="font-semibold text-neutral-800 mb-3">Usuarios más activos</h3>
                <div className="space-y-2">
                  {stats.top_users.map((u, i) => (
                    <div key={i} className="flex items-center gap-3">
                      <span className="text-sm font-mono text-neutral-400 w-5 text-right">{i + 1}.</span>
                      <span className="text-sm text-neutral-700 flex-1">{u.user_info}</span>
                      <span className="font-semibold text-sm text-neutral-900">{u.total} acciones</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : null
      )}

      {tab === 'auditoria' && <TabAuditoria />}
      {tab === 'errores'   && <TabErrores />}
    </div>
  );
}
