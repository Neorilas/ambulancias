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
import { featuresService } from '../services/features.service.js';
import { useNotification } from '../context/NotificationContext.jsx';
import { useFeatures } from '../context/FeaturesContext.jsx';
import { PageLoading } from '../components/common/LoadingSpinner.jsx';
import { formatDateTime } from '../utils/dateUtils.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

const ACTION_ICON = {
  login:               '🔐',
  logout:              '🚪',
  access_denied:       '🚫',
  toggle_feature:      '⚙️',
  create_trabajo:      '➕',
  update_trabajo:      '✏️',
  delete_trabajo:      '🗑️',
  finalize_trabajo:    '✅',
  activate_trabajo:    '▶️',
  create_asignacion:   '🔑',
  activate_asignacion: '▶️',
  finalize_asignacion: '🏁',
  delete_asignacion:   '🗑️',
  create_vehicle:      '🚐',
  update_vehicle:      '✏️',
  delete_vehicle:      '🗑️',
  create_incidencia:   '⚠️',
  update_incidencia:   '⚠️',
  create_revision:     '🔧',
  create_user:         '👤',
  update_user:         '✏️',
  delete_user:         '🗑️',
  reset_password:      '🔒',
};

// Texto legible en español para cada acción registrada
const ACTION_LABEL = {
  login:               'Inició sesión',
  logout:              'Cerró sesión',
  access_denied:       'Acceso denegado',
  toggle_feature:      'Cambió una funcionalidad',
  create_trabajo:      'Creó un trabajo',
  update_trabajo:      'Editó un trabajo',
  delete_trabajo:      'Eliminó un trabajo',
  finalize_trabajo:    'Finalizó un trabajo',
  activate_trabajo:    'Activó un trabajo',
  create_asignacion:   'Creó una asignación',
  activate_asignacion: 'Activó una asignación',
  finalize_asignacion: 'Finalizó una asignación',
  delete_asignacion:   'Eliminó una asignación',
  create_vehicle:      'Creó un vehículo',
  update_vehicle:      'Editó un vehículo',
  delete_vehicle:      'Eliminó un vehículo',
  create_incidencia:   'Registró una incidencia',
  update_incidencia:   'Actualizó una incidencia',
  create_revision:     'Registró una revisión',
  create_user:         'Creó un usuario',
  update_user:         'Editó un usuario',
  delete_user:         'Eliminó un usuario',
  reset_password:      'Reseteó una contraseña',
};

function actionIcon(action) {
  return ACTION_ICON[action] || '📝';
}

function actionLabel(action) {
  return ACTION_LABEL[action] || action;
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
function TabAuditoria({ initialUserId = '' }) {
  const { notify } = useNotification();
  const [logs,    setLogs]    = useState([]);
  const [total,   setTotal]   = useState(0);
  const [page,    setPage]    = useState(1);
  const [loading, setLoading] = useState(false);
  const [desde,   setDesde]   = useState('');
  const [hasta,   setHasta]   = useState('');
  const [userId,  setUserId]  = useState(initialUserId ? String(initialUserId) : '');
  const [action,  setAction]  = useState('');
  const [users,   setUsers]   = useState([]);

  // Lista de usuarios con actividad (para el desplegable de filtro)
  useEffect(() => {
    adminService.listAuditUsers().then(setUsers).catch(() => {});
  }, []);

  // Si llegamos con un usuario preseleccionado (clic desde "Resumen")
  useEffect(() => { setUserId(initialUserId ? String(initialUserId) : ''); }, [initialUserId]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await adminService.listAudit({
        page, limit: 30,
        user_id: userId || undefined,
        action:  action || undefined,
        desde: desde || undefined,
        hasta: hasta || undefined,
      });
      setLogs(r.data || []);
      setTotal(r.pagination?.total || 0);
    } catch { notify.error('Error al cargar auditoría'); }
    finally { setLoading(false); }
  }, [page, userId, action, desde, hasta]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { setPage(1); }, [userId, action, desde, hasta]);

  const totalPages = Math.ceil(total / 30);
  const selectedUser = users.find(u => String(u.user_id) === userId);
  const hasFilters = userId || action || desde || hasta;

  return (
    <div className="space-y-4">
      {/* Filtros */}
      <div className="card py-3 space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-neutral-500 block mb-1">Usuario</label>
            <select className="input text-sm py-1.5" value={userId} onChange={e => setUserId(e.target.value)}>
              <option value="">Todos los usuarios</option>
              {users.map(u => (
                <option key={u.user_id} value={u.user_id}>
                  {u.user_info} ({u.total})
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs text-neutral-500 block mb-1">Acción</label>
            <select className="input text-sm py-1.5" value={action} onChange={e => setAction(e.target.value)}>
              <option value="">Todas las acciones</option>
              {Object.entries(ACTION_LABEL).map(([key, label]) => (
                <option key={key} value={key}>{label}</option>
              ))}
            </select>
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <DateFilter
            desde={desde} hasta={hasta}
            onDesde={setDesde} onHasta={setHasta}
            onReset={() => { setDesde(''); setHasta(''); }}
          />
          {hasFilters && (
            <button
              onClick={() => { setUserId(''); setAction(''); setDesde(''); setHasta(''); }}
              className="btn-secondary text-xs py-1"
            >
              Quitar todos los filtros
            </button>
          )}
        </div>
      </div>

      {/* Cabecera de resultados */}
      <p className="text-sm text-neutral-500">
        {total} registro{total !== 1 ? 's' : ''}
        {selectedUser && <span className="text-neutral-700 font-medium"> · {selectedUser.user_info}</span>}
      </p>

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
                        <span className="font-medium text-sm text-neutral-800">{actionLabel(log.action)}</span>
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

// ── Tab Funcionalidades ──────────────────────────────────────────────────────
function TabFuncionalidades() {
  const { notify } = useNotification();
  const { reload: reloadFeatures } = useFeatures();
  const [features, setFeatures] = useState([]);
  const [loading, setLoading] = useState(true);
  const [toggling, setToggling] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await featuresService.listAll();
      setFeatures(data);
    } catch { notify.error('Error al cargar funcionalidades'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleToggle = async (key, currentEnabled) => {
    setToggling(key);
    try {
      await featuresService.toggle(key, !currentEnabled);
      setFeatures(prev => prev.map(f =>
        f.feature_key === key ? { ...f, enabled: f.enabled ? 0 : 1 } : f
      ));
      reloadFeatures();
      notify.success(`${key} ${!currentEnabled ? 'activado' : 'desactivado'}`);
    } catch { notify.error('Error al cambiar funcionalidad'); }
    finally { setToggling(null); }
  };

  if (loading) return <PageLoading />;

  const categories = [...new Set(features.map(f => f.category))];

  return (
    <div className="space-y-4">
      <div className="card bg-amber-50 border-amber-200 py-3 px-4">
        <p className="text-sm text-amber-800">
          Activa o desactiva secciones de la app. Los cambios son inmediatos para todos los usuarios.
          El panel Superadmin siempre es visible para ti.
        </p>
      </div>

      {categories.map(cat => (
        <div key={cat}>
          <h3 className="text-xs font-semibold text-neutral-400 uppercase tracking-wider mb-2 px-1">
            {cat === 'menu' ? 'Opciones de menú' : cat}
          </h3>
          <div className="space-y-1">
            {features.filter(f => f.category === cat).map(f => (
              <div
                key={f.feature_key}
                className="card py-3 flex items-center justify-between gap-3"
              >
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-neutral-800">{f.label}</p>
                  {f.description && (
                    <p className="text-xs text-neutral-400 truncate">{f.description}</p>
                  )}
                </div>
                <button
                  onClick={() => handleToggle(f.feature_key, f.enabled)}
                  disabled={toggling === f.feature_key}
                  className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                    f.enabled ? 'bg-primary-600' : 'bg-neutral-300'
                  } ${toggling === f.feature_key ? 'opacity-50' : ''}`}
                >
                  <span
                    className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                      f.enabled ? 'translate-x-5' : 'translate-x-0'
                    }`}
                  />
                </button>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Página principal ───────────────────────────────────────────────────────────
const TABS = [
  { key: 'features',  label: '⚙️ Funcionalidades' },
  { key: 'stats',     label: '📊 Resumen' },
  { key: 'auditoria', label: '🕵️ Auditoría' },
  { key: 'errores',   label: '🔴 Errores' },
];

export default function AdminPanel() {
  const { notify } = useNotification();
  const [tab,    setTab]    = useState('features');
  const [stats,  setStats]  = useState(null);
  const [loading, setLoading] = useState(false);
  const [auditUserId, setAuditUserId] = useState('');

  // Saltar al historial filtrado por un usuario concreto
  const verUsuario = (userId) => { setAuditUserId(userId); setTab('auditoria'); };

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
                <h3 className="font-semibold text-neutral-800 mb-1">Usuarios más activos</h3>
                <p className="text-xs text-neutral-400 mb-3">Toca un usuario para ver su historial detallado</p>
                <div className="space-y-1">
                  {stats.top_users.map((u, i) => (
                    <button
                      key={i}
                      onClick={() => verUsuario(u.user_id)}
                      className="w-full flex items-center gap-3 text-left px-2 py-1.5 -mx-2 rounded-lg hover:bg-neutral-50 transition-colors"
                    >
                      <span className="text-sm font-mono text-neutral-400 w-5 text-right">{i + 1}.</span>
                      <span className="text-sm text-neutral-700 flex-1">{u.user_info}</span>
                      <span className="font-semibold text-sm text-neutral-900">{u.total} acciones</span>
                      <span className="text-xs text-primary-600 flex-shrink-0">Ver →</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : null
      )}

      {tab === 'features'  && <TabFuncionalidades />}
      {tab === 'auditoria' && <TabAuditoria initialUserId={auditUserId} />}
      {tab === 'errores'   && <TabErrores />}
    </div>
  );
}
