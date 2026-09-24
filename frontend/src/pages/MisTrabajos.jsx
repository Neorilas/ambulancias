import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { trabajosService } from '../services/trabajos.service.js';
import { useNotification } from '../context/NotificationContext.jsx';
import { EstadoBadge } from '../components/common/StatusBadge.jsx';
import { PageLoading } from '../components/common/LoadingSpinner.jsx';
import { formatDate, formatDateTime, isWorkActive, isOverdue, diaEnEspana }
  from '../utils/dateUtils.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

const ESTADO_COLOR = {
  activo:                'border-l-blue-500',
  programado:            'border-l-yellow-400',
  finalizado:            'border-l-green-500',
  finalizado_anticipado: 'border-l-green-400',
  cancelado:             'border-l-neutral-300',
};

const ESTADO_DOT = {
  activo:                'bg-blue-500',
  programado:            'bg-warn-500',
  finalizado:            'bg-ok-500',
  finalizado_anticipado: 'bg-ok-500',
};

// Retorna el lunes de la semana que contiene `date`
function startOfWeek(date) {
  const d = new Date(date);
  const day = d.getDay(); // 0=dom
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

function addDays(date, n) {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}

/** Hoy segun el calendario espanol, como Date a medianoche local. */
function hoyEnEspana() {
  const [a, m, d] = diaEnEspana(new Date()).split('-').map(Number);
  return new Date(a, m - 1, d);
}

function sameDay(a, b) {
  return a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();
}

/** 'yyyy-MM-dd' de una celda del calendario (un Date construido a medianoche
 *  local, así que sus getters locales ya dan el día correcto). */
function diaDeCelda(day) {
  const dd = (n) => String(n).padStart(2, '0');
  return `${day.getFullYear()}-${dd(day.getMonth() + 1)}-${dd(day.getDate())}`;
}

// El reparto por días se hace con el calendario ESPAÑOL, no con el del
// dispositivo: si no, un trabajo que empieza a las 00:30 caería en la casilla
// del día anterior para quien tenga el móvil en otra zona.
function trabajoInDay(t, day) {
  const celda = diaDeCelda(day);
  return diaEnEspana(t.fecha_inicio) <= celda && celda <= diaEnEspana(t.fecha_fin);
}

// ── Subcomponentes ────────────────────────────────────────────────────────────

function TrabajoPill({ trabajo, onClick }) {
  const dot = ESTADO_DOT[trabajo.estado] || 'bg-neutral-300';
  return (
    <button
      onClick={() => onClick(trabajo)}
      className="flex items-center gap-1 text-[11px] bg-white border border-neutral-200 rounded px-1.5 py-0.5 hover:border-primary-400 hover:shadow-sm transition truncate w-full text-left"
      title={trabajo.nombre}
    >
      <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${dot}`} />
      <span className="truncate">{trabajo.nombre}</span>
    </button>
  );
}

// Vista de semana: lun-dom
function VistaCalendarioSemana({ trabajos, onSelectTrabajo }) {
  const [weekStart, setWeekStart] = useState(() => startOfWeek(hoyEnEspana()));
  const today = hoyEnEspana();

  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const weekEnd = days[6];

  const prev = () => setWeekStart(d => addDays(d, -7));
  const next = () => setWeekStart(d => addDays(d, 7));
  const goToday = () => setWeekStart(startOfWeek(hoyEnEspana()));

  const fmt = (d) => d.toLocaleDateString('es-ES', { day: 'numeric', month: 'short' });

  return (
    <div className="space-y-3">
      {/* Navegación */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <button onClick={prev} className="btn-ghost text-sm px-2">‹</button>
          <span className="text-sm font-medium text-neutral-700">
            {fmt(weekStart)} — {fmt(weekEnd)}
          </span>
          <button onClick={next} className="btn-ghost text-sm px-2">›</button>
        </div>
        <button onClick={goToday} className="btn-secondary text-xs">Hoy</button>
      </div>

      {/* Grid */}
      <div className="grid grid-cols-7 gap-1">
        {days.map((day, i) => {
          const isToday = sameDay(day, today);
          const dayTrabs = trabajos.filter(t => trabajoInDay(t, day));
          return (
            <div
              key={i}
              className={`rounded-lg p-1.5 min-h-[80px] ${
                isToday ? 'bg-primary-50 ring-1 ring-primary-300' : 'bg-neutral-50'
              }`}
            >
              <div className={`text-[11px] font-semibold mb-1 ${isToday ? 'text-primary-700' : 'text-neutral-500'}`}>
                <span className="hidden sm:inline">
                  {day.toLocaleDateString('es-ES', { weekday: 'short' }).replace('.', '')} </span>
                {day.getDate()}
              </div>
              <div className="space-y-0.5">
                {dayTrabs.map(t => (
                  <TrabajoPill key={t.id} trabajo={t} onClick={onSelectTrabajo} />
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {/* Leyenda */}
      <div className="flex gap-3 text-[11px] text-neutral-400 flex-wrap">
        {Object.entries({ activo: 'Activo', programado: 'Programado', finalizado: 'Finalizado' }).map(([k, v]) => (
          <span key={k} className="flex items-center gap-1">
            <span className={`w-2 h-2 rounded-full ${ESTADO_DOT[k]}`} />
            {v}
          </span>
        ))}
      </div>
    </div>
  );
}

// Vista de mes
function VistaCalendarioMes({ trabajos, onSelectTrabajo }) {
  const today = hoyEnEspana();
  const [refDate, setRefDate] = useState(() => new Date(today.getFullYear(), today.getMonth(), 1));

  const year  = refDate.getFullYear();
  const month = refDate.getMonth();

  const firstDay = new Date(year, month, 1);
  const lastDay  = new Date(year, month + 1, 0);

  // Relleno inicial (lunes=0)
  const startPad = firstDay.getDay() === 0 ? 6 : firstDay.getDay() - 1;
  const totalCells = startPad + lastDay.getDate();
  const rows = Math.ceil(totalCells / 7);

  const prevMonth = () => setRefDate(new Date(year, month - 1, 1));
  const nextMonth = () => setRefDate(new Date(year, month + 1, 1));
  const goToday   = () => setRefDate(new Date(today.getFullYear(), today.getMonth(), 1));

  const monthLabel = refDate.toLocaleDateString('es-ES', { month: 'long', year: 'numeric' });

  return (
    <div className="space-y-3">
      {/* Navegación */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <button onClick={prevMonth} className="btn-ghost text-sm px-2">‹</button>
          <span className="text-sm font-medium text-neutral-700 capitalize">{monthLabel}</span>
          <button onClick={nextMonth} className="btn-ghost text-sm px-2">›</button>
        </div>
        <button onClick={goToday} className="btn-secondary text-xs">Hoy</button>
      </div>

      {/* Cabecera días semana */}
      <div className="grid grid-cols-7 gap-1 text-center">
        {['L', 'M', 'X', 'J', 'V', 'S', 'D'].map(d => (
          <div key={d} className="text-[11px] font-medium text-neutral-400 pb-1">{d}</div>
        ))}
      </div>

      {/* Celdas */}
      <div className="grid grid-cols-7 gap-1">
        {Array.from({ length: rows * 7 }, (_, i) => {
          const dayNum = i - startPad + 1;
          if (dayNum < 1 || dayNum > lastDay.getDate()) {
            return <div key={i} />;
          }
          const day = new Date(year, month, dayNum);
          const isToday = sameDay(day, today);
          const dayTrabs = trabajos.filter(t => trabajoInDay(t, day));

          return (
            <div
              key={i}
              className={`rounded min-h-[52px] p-1 ${
                isToday ? 'bg-primary-50 ring-1 ring-primary-300' : 'bg-neutral-50'
              }`}
            >
              <p className={`text-[11px] font-semibold mb-0.5 ${isToday ? 'text-primary-700' : 'text-neutral-500'}`}>
                {dayNum}
              </p>
              <div className="space-y-0.5">
                {dayTrabs.slice(0, 2).map(t => (
                  <TrabajoPill key={t.id} trabajo={t} onClick={onSelectTrabajo} />
                ))}
                {dayTrabs.length > 2 && (
                  <p className="text-[10px] text-neutral-400 pl-1">+{dayTrabs.length - 2} más</p>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Lo que el usuario tiene pendiente en un trabajo. Con varios vehículos ya no
// hay un «Finalizar» único: cada responsable cierra el suyo desde la ficha del
// trabajo, que es quien sabe qué vehículo toca.
function Pendiente({ trabajo }) {
  const n = Number(trabajo.mis_vehiculos_pendientes) || 0;
  if (!n) return null;
  return (
    <span className="inline-block mt-1 text-xs text-primary-700 font-medium">
      {n === 1 ? 'Tienes 1 vehículo por documentar' : `Tienes ${n} vehículos por documentar`}
    </span>
  );
}

function Vehiculos({ trabajo, className = '' }) {
  if (!trabajo.vehiculos_resumen) return null;
  return <p className={`text-xs text-neutral-500 ${className}`}>{trabajo.vehiculos_resumen}</p>;
}

// Tarjeta de trabajo en lista
function TrabajoCard({ trabajo }) {
  const navigate = useNavigate();

  const activo        = isWorkActive(trabajo);
  const vencido       = isOverdue(trabajo);
  const esResponsable = !!Number(trabajo.soy_responsable);
  const borderColor   = ESTADO_COLOR[trabajo.estado] || 'border-l-neutral-200';

  return (
    <div
      className={`card border-l-4 cursor-pointer hover:shadow-md transition-shadow ${borderColor}`}
      onClick={() => navigate(`/trabajos/${trabajo.id}`)}
    >
      <div className="flex items-center gap-2 flex-wrap">
        <h3 className="font-semibold text-neutral-900">{trabajo.nombre}</h3>
        <EstadoBadge estado={trabajo.estado} />
        {esResponsable && (
          <span className="badge bg-idle-50 text-idle-600 text-xs">Responsable</span>
        )}
      </div>
      <p className="text-xs text-neutral-500 mt-1 font-mono">{trabajo.identificador}</p>
      {trabajo.ubicacion && <p className="text-xs text-neutral-600 mt-0.5">{trabajo.ubicacion}</p>}
      <Vehiculos trabajo={trabajo} className="mt-0.5" />
      <p className="text-xs text-neutral-400 mt-1">
        {formatDateTime(trabajo.fecha_inicio)} → {formatDateTime(trabajo.fecha_fin)}
      </p>
      {activo && (
        <span className="inline-block mt-1 mr-2 text-xs text-blue-600 font-medium">En curso ahora</span>
      )}
      {vencido && trabajo.estado === 'activo' && (
        <span className="inline-block mt-1 mr-2 text-xs text-bad-600 font-medium">
          Tiempo superado — pendiente de cerrar
        </span>
      )}
      <Pendiente trabajo={trabajo} />
    </div>
  );
}

// ── Modal detalle rápido (desde calendario) ───────────────────────────────────
function QuickModal({ trabajo, onClose }) {
  const navigate = useNavigate();

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center pl-[max(1rem,var(--safe-left))] pr-[max(1rem,var(--safe-right))] pt-[max(1rem,var(--safe-top))] pb-[max(1rem,var(--safe-bottom))]" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-sm space-y-4 p-5" onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-2">
          <div>
            <h3 className="font-semibold text-neutral-900">{trabajo.nombre}</h3>
            <p className="text-xs text-neutral-500 font-mono mt-0.5">{trabajo.identificador}</p>
          </div>
          <button onClick={onClose} className="text-neutral-400 hover:text-neutral-700 text-xl leading-none">×</button>
        </div>

        <EstadoBadge estado={trabajo.estado} />

        {trabajo.ubicacion && <p className="text-sm text-neutral-700">{trabajo.ubicacion}</p>}
        <Vehiculos trabajo={trabajo} />
        <div className="text-xs text-neutral-500 space-y-0.5">
          <p>Inicio: {formatDateTime(trabajo.fecha_inicio)}</p>
          <p>Fin: {formatDateTime(trabajo.fecha_fin)}</p>
        </div>
        <Pendiente trabajo={trabajo} />

        <div className="flex gap-2 pt-1 border-t border-neutral-100">
          <button
            onClick={() => navigate(`/trabajos/${trabajo.id}`)}
            className="btn-primary text-xs flex-1"
          >
            Ver detalles
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Página principal ───────────────────────────────────────────────────────────
const TABS = [
  { key: 'lista',  label: 'Lista' },
  { key: 'semana', label: 'Semana' },
  { key: 'mes',    label: 'Mes' },
];

export default function MisTrabajos() {
  const { notify } = useNotification();

  const [tab,        setTab]        = useState('lista');
  const [trabajos,   setTrabajos]   = useState([]);
  const [pagination, setPagination] = useState(null);
  const [page,       setPage]       = useState(1);
  const [loading,    setLoading]    = useState(false);
  const [quickWork,  setQuickWork]  = useState(null); // modal rápido desde calendario

  // Para el calendario, cargamos todos de una vez (sin paginar)
  const [allTrabajos, setAllTrabajos] = useState([]);

  const loadLista = useCallback(async () => {
    setLoading(true);
    try {
      const resp = await trabajosService.misTrab({ page, limit: 15 });
      setTrabajos(resp.data || []);
      setPagination(resp.pagination);
    } catch { notify.error('Error al cargar trabajos'); }
    finally { setLoading(false); }
  }, [page]);

  const loadCalendario = useCallback(async () => {
    if (allTrabajos.length > 0) return; // ya cargados
    setLoading(true);
    try {
      const resp = await trabajosService.misTrab({ limit: 200 });
      setAllTrabajos(resp.data || []);
    } catch { notify.error('Error al cargar trabajos'); }
    finally { setLoading(false); }
  }, [allTrabajos.length]);

  useEffect(() => {
    if (tab === 'lista') {
      loadLista();
    } else {
      loadCalendario();
    }
  }, [tab, page]);

  const activos    = tab !== 'lista' ? allTrabajos.filter(t => t.estado === 'activo').length : 0;
  const progCount  = tab !== 'lista' ? allTrabajos.filter(t => t.estado === 'programado').length : 0;

  return (
    <div className="space-y-4 animate-fade-in">
      {/* Header */}
      <div>
        <h1 className="text-[19px] font-semibold text-neutral-900">Mis Trabajos</h1>
        <p className="text-neutral-500 text-sm">Trabajos asignados a ti</p>
      </div>

      {/* Tabs */}
      <div className="tabs">
        {TABS.map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={tab === t.key ? 'tab-active' : 'tab'}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Resumen rápido en modo calendario */}
      {tab !== 'lista' && !loading && (
        <div className="grid grid-cols-2 gap-3">
          <div className="card py-3 text-center">
            <p className="text-lg font-bold text-blue-600">{activos}</p>
            <p className="text-xs text-neutral-500">Activos</p>
          </div>
          <div className="card py-3 text-center">
            <p className="text-lg font-bold text-warn-600">{progCount}</p>
            <p className="text-xs text-neutral-500">Programados</p>
          </div>
        </div>
      )}

      {loading ? <PageLoading /> : (
        <>
          {/* ── Lista ── */}
          {tab === 'lista' && (
            <>
              {trabajos.length === 0 ? (
                <div className="empty">
                  <p className="empty-title">No tienes trabajos asignados</p>
                  <p className="empty-hint">Aquí aparecerán los trabajos en los que participes</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {trabajos.map(t => (
                    <TrabajoCard key={t.id} trabajo={t} />
                  ))}
                </div>
              )}
              {pagination?.totalPages > 1 && (
                <div className="flex items-center justify-center gap-2">
                  <button className="btn-secondary" onClick={() => setPage(p => p - 1)} disabled={!pagination.hasPrev}>‹</button>
                  <span className="text-sm">{page} / {pagination.totalPages}</span>
                  <button className="btn-secondary" onClick={() => setPage(p => p + 1)} disabled={!pagination.hasNext}>›</button>
                </div>
              )}
            </>
          )}

          {/* ── Semana ── */}
          {tab === 'semana' && (
            <VistaCalendarioSemana
              trabajos={allTrabajos}
              onSelectTrabajo={setQuickWork}
            />
          )}

          {/* ── Mes ── */}
          {tab === 'mes' && (
            <VistaCalendarioMes
              trabajos={allTrabajos}
              onSelectTrabajo={setQuickWork}
            />
          )}
        </>
      )}

      {/* Modal rápido desde calendario */}
      {quickWork && (
        <QuickModal
          trabajo={quickWork}
          onClose={() => setQuickWork(null)}
        />
      )}
    </div>
  );
}
