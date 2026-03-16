import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { trabajosService } from '../services/trabajos.service.js';
import { vehiclesService } from '../services/vehicles.service.js';
import { usersService } from '../services/users.service.js';
import { EstadoBadge } from '../components/common/StatusBadge.jsx';
import { formatDate, formatDateTime } from '../utils/dateUtils.js';
import { PageLoading } from '../components/common/LoadingSpinner.jsx';
import { useNotification } from '../context/NotificationContext.jsx';

// ── Helpers ───────────────────────────────────────────────────────────────────

function diferenciaHoras(fechaInicio) {
  return (new Date(fechaInicio) - new Date()) / (1000 * 60 * 60);
}

// ── Componentes comunes ───────────────────────────────────────────────────────

function StatCard({ label, value, icon, to }) {
  const inner = (
    <div className="card flex items-center gap-4 hover:shadow-md transition-shadow">
      <div className="text-3xl">{icon}</div>
      <div>
        <p className="text-2xl font-bold text-neutral-900">{value ?? '–'}</p>
        <p className="text-sm text-neutral-500">{label}</p>
      </div>
    </div>
  );
  return to ? <Link to={to}>{inner}</Link> : inner;
}

// Tira semanal: 7 días con puntos de color por estado de trabajo
function WeekStrip({ trabajos }) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(today);
    d.setDate(today.getDate() + i);
    return d;
  });

  const labelDay = (d) => d.toLocaleDateString('es-ES', { weekday: 'short' });
  const labelNum  = (d) => d.getDate();
  const isToday   = (d) => d.toDateString() === today.toDateString();

  const inDay = (trabajo, day) => {
    const ini = new Date(trabajo.fecha_inicio);
    const fin = new Date(trabajo.fecha_fin);
    ini.setHours(0, 0, 0, 0);
    fin.setHours(23, 59, 59, 999);
    return day >= ini && day <= fin;
  };

  const dotColor = (estado) => ({
    activo:                'bg-blue-500',
    programado:            'bg-yellow-400',
    finalizado:            'bg-green-500',
    finalizado_anticipado: 'bg-green-400',
  }[estado] || 'bg-neutral-300');

  return (
    <div className="card">
      <h2 className="font-semibold text-neutral-700 text-sm mb-3">Próximos 7 días</h2>
      <div className="grid grid-cols-7 gap-1">
        {days.map((day, i) => {
          const dayTrabajos = trabajos.filter(t => inDay(t, day));
          return (
            <div
              key={i}
              className={`flex flex-col items-center gap-1 py-2 px-1 rounded-lg text-center ${
                isToday(day) ? 'bg-primary-50 ring-1 ring-primary-200' : ''
              }`}
            >
              <span className="text-[10px] text-neutral-400 uppercase">{labelDay(day)}</span>
              <span className={`text-sm font-semibold ${isToday(day) ? 'text-primary-700' : 'text-neutral-800'}`}>
                {labelNum(day)}
              </span>
              <div className="flex flex-wrap justify-center gap-0.5 min-h-[10px]">
                {dayTrabajos.map(t => (
                  <span
                    key={t.id}
                    className={`w-2 h-2 rounded-full ${dotColor(t.estado)}`}
                    title={t.nombre}
                  />
                ))}
              </div>
            </div>
          );
        })}
      </div>
      <div className="flex gap-3 mt-2 text-[10px] text-neutral-400">
        <span><span className="inline-block w-2 h-2 bg-blue-500 rounded-full mr-1"/>Activo</span>
        <span><span className="inline-block w-2 h-2 bg-yellow-400 rounded-full mr-1"/>Programado</span>
        <span><span className="inline-block w-2 h-2 bg-green-500 rounded-full mr-1"/>Finalizado</span>
      </div>
    </div>
  );
}

// Tarjeta de trabajo activo (vista técnico)
function ActiveJobCard({ trabajo, onFinalizar }) {
  const { notify }   = useNotification();
  const navigate     = useNavigate();
  const [loading, setLoading] = React.useState(false);

  const horas = diferenciaHoras(trabajo.fecha_fin);
  const enTiempo = horas > 0;

  return (
    <div className="card border-l-4 border-l-blue-500 space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-xs text-blue-600 font-medium uppercase tracking-wide">✦ Trabajo en curso</p>
          <h3 className="font-semibold text-neutral-900 mt-0.5">{trabajo.nombre}</h3>
          <p className="text-xs text-neutral-500 font-mono">{trabajo.identificador}</p>
        </div>
        <EstadoBadge estado={trabajo.estado} />
      </div>

      {trabajo.vehiculo_alias && (
        <div className="flex items-center gap-2 text-sm">
          <span>🚐</span>
          <span className="font-medium">{trabajo.vehiculo_alias}</span>
          <span className="text-neutral-400 font-mono text-xs">({trabajo.matricula})</span>
        </div>
      )}

      <div className="text-xs text-neutral-500 space-y-0.5">
        <p>Inicio: {formatDateTime(trabajo.fecha_inicio)}</p>
        <p className={enTiempo ? 'text-neutral-500' : 'text-red-600 font-medium'}>
          Fin previsto: {formatDateTime(trabajo.fecha_fin)}
          {!enTiempo && ' · Tiempo superado'}
        </p>
      </div>

      <div className="flex gap-2 pt-1 border-t border-neutral-100">
        <button
          onClick={() => navigate(`/trabajos/${trabajo.id}`)}
          className="btn-secondary text-xs flex-1"
        >
          Ver detalles
        </button>
        {trabajo.soy_responsable && (
          <button
            onClick={async () => {
              setLoading(true);
              try {
                const full = await trabajosService.get(trabajo.id);
                onFinalizar(full);
              } catch {
                notify.error('Error al cargar el trabajo');
              } finally {
                setLoading(false);
              }
            }}
            disabled={loading}
            className="btn-primary text-xs flex-1"
          >
            {loading ? '...' : 'Finalizar trabajo'}
          </button>
        )}
      </div>
    </div>
  );
}

// Próximo trabajo programado
function NextJobCard({ trabajo }) {
  const horas = diferenciaHoras(trabajo.fecha_inicio);
  const dias  = Math.ceil(horas / 24);

  return (
    <div className="card border-l-4 border-l-yellow-400 space-y-2">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-xs text-yellow-600 font-medium uppercase tracking-wide">
            {horas < 24 ? `En ${Math.round(horas)}h` : `En ${dias} día${dias !== 1 ? 's' : ''}`}
          </p>
          <h3 className="font-medium text-neutral-800 mt-0.5">{trabajo.nombre}</h3>
        </div>
        <EstadoBadge estado={trabajo.estado} />
      </div>
      {trabajo.vehiculo_alias && (
        <p className="text-xs text-neutral-500">🚐 {trabajo.vehiculo_alias} ({trabajo.matricula})</p>
      )}
      <p className="text-xs text-neutral-400">
        {formatDateTime(trabajo.fecha_inicio)} → {formatDateTime(trabajo.fecha_fin)}
      </p>
      <Link to={`/trabajos/${trabajo.id}`} className="text-xs text-primary-600 hover:underline">
        Ver trabajo →
      </Link>
    </div>
  );
}

// ── Vista Operacional ─────────────────────────────────────────────────────────
function DashboardOperacional({ user }) {
  const { notify }       = useNotification();
  const [trabajos,       setTrabajos]       = useState([]);
  const [calendarioSem,  setCalendarioSem]  = useState([]);
  const [loading,        setLoading]        = useState(true);
  const [finTrabajo,     setFinTrabajo]     = useState(null);

  useEffect(() => {
    Promise.all([
      trabajosService.misTrab({ limit: 20 }),
      trabajosService.listCalendario({
        desde: new Date().toISOString().slice(0, 10),
        hasta: (() => { const d = new Date(); d.setDate(d.getDate() + 7); return d.toISOString().slice(0, 10); })(),
      }).catch(() => []),
    ])
      .then(([mistResp, cal]) => {
        setTrabajos(mistResp.data || []);
        setCalendarioSem(Array.isArray(cal) ? cal : []);
      })
      .catch(() => notify.error('Error al cargar datos'))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <PageLoading />;

  const activos     = trabajos.filter(t => t.estado === 'activo');
  const programados = trabajos
    .filter(t => t.estado === 'programado')
    .sort((a, b) => new Date(a.fecha_inicio) - new Date(b.fecha_inicio));

  // Combinar para la tira semanal
  const semItems = [...activos, ...programados];

  const hora    = new Date().getHours();
  const saludo  = hora < 12 ? 'Buenos días' : hora < 19 ? 'Buenas tardes' : 'Buenas noches';

  // Si está en flujo de finalización
  if (finTrabajo) {
    const Finalizacion = React.lazy(() => import('./trabajos/Finalizacion.jsx'));
    return (
      <React.Suspense fallback={<PageLoading />}>
        <Finalizacion
          trabajo={finTrabajo}
          onDone={() => { setFinTrabajo(null); setLoading(true); }}
          onCancel={() => setFinTrabajo(null)}
        />
      </React.Suspense>
    );
  }

  return (
    <div className="space-y-5 animate-fade-in">
      {/* Saludo */}
      <div>
        <h1 className="text-xl font-bold text-neutral-900">
          {saludo}, {user?.nombre} 👋
        </h1>
        <p className="text-neutral-400 text-sm">
          {new Date().toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' })}
        </p>
      </div>

      {/* Trabajo activo */}
      {activos.length > 0 ? (
        <div className="space-y-3">
          {activos.map(t => (
            <ActiveJobCard key={t.id} trabajo={t} onFinalizar={setFinTrabajo} />
          ))}
        </div>
      ) : (
        <div className="card text-center py-8 text-neutral-400">
          <p className="text-3xl mb-2">😴</p>
          <p className="text-sm font-medium">Sin trabajos activos ahora mismo</p>
        </div>
      )}

      {/* Próximo trabajo */}
      {programados.length > 0 && (
        <div>
          <p className="text-xs text-neutral-400 uppercase tracking-wide font-medium mb-2">Próximo trabajo</p>
          <NextJobCard trabajo={programados[0]} />
        </div>
      )}

      {/* Tira semanal */}
      {semItems.length > 0 && <WeekStrip trabajos={semItems} />}

      {/* Acceso rápido */}
      <Link
        to="/mis-trabajos"
        className="card flex items-center gap-3 py-4 hover:shadow-md transition-shadow"
      >
        <span className="text-2xl">📋</span>
        <div>
          <p className="font-medium text-neutral-800 text-sm">Ver todos mis trabajos</p>
          <p className="text-xs text-neutral-400">{trabajos.length} trabajo{trabajos.length !== 1 ? 's' : ''} asignado{trabajos.length !== 1 ? 's' : ''}</p>
        </div>
        <span className="ml-auto text-neutral-300">›</span>
      </Link>
    </div>
  );
}

// ── Vista Admin / Gestor ───────────────────────────────────────────────────────
function DashboardAdmin({ user }) {
  const [stats,   setStats]   = useState(null);
  const [recent,  setRecent]  = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      usersService.list({ limit: 1 }),
      vehiclesService.list({ limit: 1 }),
      trabajosService.list({ limit: 1, estado: 'activo' }),
      trabajosService.list({ limit: 6 }),
    ])
      .then(([usersResp, vehResp, activosResp, recentsResp]) => {
        setStats({
          usuarios:  usersResp.pagination?.total  || 0,
          vehiculos: vehResp.pagination?.total    || 0,
          activos:   activosResp.pagination?.total || 0,
        });
        setRecent(recentsResp.data || []);
      })
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <PageLoading />;

  const hora   = new Date().getHours();
  const saludo = hora < 12 ? 'Buenos días' : hora < 19 ? 'Buenas tardes' : 'Buenas noches';

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Saludo */}
      <div>
        <h1 className="text-2xl font-bold text-neutral-900">
          {saludo}, {user?.nombre} 👋
        </h1>
        <p className="text-neutral-500 text-sm mt-1">
          {new Date().toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
        </p>
      </div>

      {/* Stats */}
      {stats && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {/* Trabajos activos — indicador pulsante si hay alguno */}
          <Link to="/trabajos?estado=activo">
            <div className="card flex items-center gap-4 hover:shadow-md transition-shadow">
              <div className="relative text-3xl">
                🚑
                {stats.activos > 0 && (
                  <span className="absolute -top-1 -right-1 flex h-3 w-3">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
                    <span className="relative inline-flex rounded-full h-3 w-3 bg-green-500" />
                  </span>
                )}
              </div>
              <div>
                <p className={`text-2xl font-bold ${stats.activos > 0 ? 'text-green-700' : 'text-neutral-900'}`}>
                  {stats.activos}
                </p>
                <p className="text-sm text-neutral-500">
                  Trabajo{stats.activos !== 1 ? 's' : ''} activo{stats.activos !== 1 ? 's' : ''}
                </p>
              </div>
            </div>
          </Link>
          <StatCard label="Vehículos"  value={stats.vehiculos} icon="🚐" to="/vehiculos" />
          <StatCard label="Usuarios"   value={stats.usuarios}  icon="👥" to="/usuarios" />
        </div>
      )}

      {/* Accesos rápidos */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { to: '/trabajos',    icon: '📅', label: 'Trabajos' },
          { to: '/vehiculos',   icon: '🚐', label: 'Vehículos' },
          { to: '/usuarios',    icon: '👥', label: 'Usuarios' },
          { to: '/mis-trabajos',icon: '📋', label: 'Mis trabajos' },
        ].map(({ to, icon, label }) => (
          <Link
            key={to}
            to={to}
            className="card flex flex-col items-center gap-2 py-5 hover:shadow-md transition-shadow text-center"
          >
            <span className="text-3xl">{icon}</span>
            <span className="text-sm font-medium text-neutral-700">{label}</span>
          </Link>
        ))}
      </div>

      {/* Últimos trabajos */}
      <div className="card">
        <div className="card-header">
          <h2 className="font-semibold text-neutral-900">Últimos trabajos</h2>
          <Link to="/trabajos" className="text-primary-600 text-sm font-medium hover:underline">Ver todos</Link>
        </div>
        {recent.length === 0 ? (
          <p className="text-neutral-400 text-sm py-4 text-center">Sin trabajos recientes</p>
        ) : (
          <div className="space-y-2">
            {recent.map(t => (
              <Link
                key={t.id}
                to={`/trabajos/${t.id}`}
                className="flex items-center justify-between p-3 rounded-lg hover:bg-neutral-50 transition-colors border border-neutral-100"
              >
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-sm truncate">{t.nombre}</p>
                  <p className="text-xs text-neutral-500 mt-0.5">
                    {t.identificador} · {formatDateTime(t.fecha_inicio)}
                  </p>
                </div>
                <EstadoBadge estado={t.estado} />
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Entrada ───────────────────────────────────────────────────────────────────
export default function Dashboard() {
  const { user, isOperacional, canManageUsers } = useAuth();

  if (!user) return <PageLoading />;

  // Si el usuario solo tiene rol operacional → vista técnico
  if (isOperacional() && !canManageUsers()) {
    return <DashboardOperacional user={user} />;
  }

  return <DashboardAdmin user={user} />;
}
