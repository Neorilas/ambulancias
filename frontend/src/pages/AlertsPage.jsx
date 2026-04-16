/**
 * pages/AlertsPage.jsx
 *
 * Panel dedicado para administradores: visualiza y gestiona
 * todas las alertas de caducidad de documentos de vehículos
 * (ITV, ITS, Tarjeta de transporte).
 *
 * Funciones:
 *   - KPIs por umbral (vencidas / 15d / 30d / 45d / 60d)
 *   - Filtros por tipo de documento, umbral y estado (activas/descartadas)
 *   - Descartar y restaurar alertas (persistido en localStorage)
 *   - Acción masiva: restaurar todas las descartadas
 *   - Selector del horizonte consultado (60/90/180/365 días)
 *   - Refresco manual + timestamp de última actualización
 */

import React, { useEffect, useState, useMemo, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { vehiclesService }   from '../services/vehicles.service.js';
import { useNotification }   from '../context/NotificationContext.jsx';
import { PageLoading }       from '../components/common/LoadingSpinner.jsx';
import ConfirmDialog         from '../components/common/ConfirmDialog.jsx';
import {
  TIPO_LABEL,
  TIPO_ICON,
  thresholdStyle,
  isDismissed,
  markDismissed,
  unmarkDismissed,
  listDismissals,
  clearAllDismissals,
  withThresholds,
} from '../utils/vehicleAlerts.js';

const HORIZONTES = [
  { label: '60 días', value: 60  },
  { label: '90 días', value: 90  },
  { label: '6 meses', value: 180 },
  { label: '1 año',   value: 365 },
];

function KpiCard({ color, label, count, active, onClick }) {
  return (
    <button
      onClick={onClick}
      className={`text-left rounded-xl border p-3 transition-all
        ${active ? 'ring-2 ring-primary-600 border-primary-200' : 'border-neutral-200 hover:border-neutral-300'}
        ${color}`}
    >
      <div className="text-2xl font-bold leading-tight">{count}</div>
      <div className="text-xs font-medium mt-0.5">{label}</div>
    </button>
  );
}

function DiasBadge({ dias, threshold }) {
  const style = thresholdStyle(threshold);
  const text = threshold === 'vencida'
    ? `Vencida hace ${Math.abs(dias)}d`
    : `${dias}d`;
  return (
    <span className={`inline-flex items-center gap-1 text-xs border rounded-full px-2 py-0.5 font-medium ${style.pill}`}>
      {threshold === 'vencida' ? '⛔' : '⚠'} {text}
    </span>
  );
}

export default function AlertsPage() {
  const { notify } = useNotification();

  const [alertas,   setAlertas]   = useState([]);
  const [loading,   setLoading]   = useState(true);
  const [lastFetch, setLastFetch] = useState(null);
  const [horizonte, setHorizonte] = useState(60);

  // Filtros
  const [filtroTipo,      setFiltroTipo]      = useState('todos');    // todos|itv|its|tarjeta_transporte
  const [filtroUmbral,    setFiltroUmbral]    = useState('todos');    // todos|vencida|15|30|45|60
  const [filtroEstado,    setFiltroEstado]    = useState('activas');  // activas|descartadas|todas

  const [confirmRestore, setConfirmRestore] = useState(false);
  const [tick, setTick] = useState(0); // fuerza recálculo tras dismiss/restore

  const cargar = useCallback(async () => {
    setLoading(true);
    try {
      const data = await vehiclesService.listAlertas(horizonte);
      setAlertas(Array.isArray(data) ? data : []);
      setLastFetch(new Date());
    } catch {
      notify.error('Error al cargar alertas');
    } finally {
      setLoading(false);
    }
  }, [horizonte, notify]);

  useEffect(() => { cargar(); }, [cargar]);

  // Todas las alertas con umbral calculado
  const conThreshold = useMemo(() => withThresholds(alertas), [alertas]);

  // KPIs (sobre TODAS, sin filtrar por estado)
  const kpis = useMemo(() => ({
    vencida: conThreshold.filter(a => a.threshold === 'vencida').length,
    15:      conThreshold.filter(a => a.threshold === 15).length,
    30:      conThreshold.filter(a => a.threshold === 30).length,
    45:      conThreshold.filter(a => a.threshold === 45).length,
    60:      conThreshold.filter(a => a.threshold === 60).length,
    total:   conThreshold.length,
  }), [conThreshold]);

  // Aplicar filtros
  const visibles = useMemo(() => {
    let out = conThreshold;

    if (filtroTipo !== 'todos') {
      out = out.filter(a => a.tipo === filtroTipo);
    }
    if (filtroUmbral !== 'todos') {
      const t = filtroUmbral === 'vencida' ? 'vencida' : parseInt(filtroUmbral);
      out = out.filter(a => a.threshold === t);
    }
    if (filtroEstado === 'activas') {
      out = out.filter(a => !isDismissed(a));
    } else if (filtroEstado === 'descartadas') {
      out = out.filter(a => isDismissed(a));
    }

    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conThreshold, filtroTipo, filtroUmbral, filtroEstado, tick]);

  const totalDescartadas = useMemo(
    () => conThreshold.filter(a => isDismissed(a)).length,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [conThreshold, tick]
  );

  const handleDismiss = (a) => {
    markDismissed(a);
    setTick(t => t + 1);
  };
  const handleRestore = (a) => {
    unmarkDismissed(a);
    setTick(t => t + 1);
  };
  const handleRestoreAll = () => {
    clearAllDismissals();
    setConfirmRestore(false);
    setTick(t => t + 1);
    notify.success('Todas las alertas descartadas han sido restauradas');
  };

  return (
    <div className="space-y-5 animate-fade-in">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        <div className="flex-1">
          <h1 className="text-xl font-bold text-neutral-900">Alertas de caducidad</h1>
          <p className="text-neutral-500 text-sm">
            ITV, ITS y tarjeta de transporte · {kpis.total} alertas en los próximos {horizonte} días
            {lastFetch && (
              <span className="text-neutral-400"> · actualizado {lastFetch.toLocaleTimeString('es-ES')}</span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select
            className="input py-1.5 text-sm max-w-[140px]"
            value={horizonte}
            onChange={e => setHorizonte(parseInt(e.target.value))}
          >
            {HORIZONTES.map(h => <option key={h.value} value={h.value}>{h.label}</option>)}
          </select>
          <button onClick={cargar} className="btn-secondary text-sm">⟳ Actualizar</button>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 sm:gap-3">
        <KpiCard
          color="bg-red-50 text-red-700"
          label="Vencidas"
          count={kpis.vencida}
          active={filtroUmbral === 'vencida'}
          onClick={() => setFiltroUmbral(filtroUmbral === 'vencida' ? 'todos' : 'vencida')}
        />
        <KpiCard
          color="bg-orange-50 text-orange-700"
          label="≤ 15 días"
          count={kpis[15]}
          active={filtroUmbral === '15'}
          onClick={() => setFiltroUmbral(filtroUmbral === '15' ? 'todos' : '15')}
        />
        <KpiCard
          color="bg-yellow-50 text-yellow-800"
          label="≤ 30 días"
          count={kpis[30]}
          active={filtroUmbral === '30'}
          onClick={() => setFiltroUmbral(filtroUmbral === '30' ? 'todos' : '30')}
        />
        <KpiCard
          color="bg-blue-50 text-blue-800"
          label="≤ 45 días"
          count={kpis[45]}
          active={filtroUmbral === '45'}
          onClick={() => setFiltroUmbral(filtroUmbral === '45' ? 'todos' : '45')}
        />
        <KpiCard
          color="bg-blue-50 text-blue-700"
          label="≤ 60 días"
          count={kpis[60]}
          active={filtroUmbral === '60'}
          onClick={() => setFiltroUmbral(filtroUmbral === '60' ? 'todos' : '60')}
        />
      </div>

      {/* Filtros */}
      <div className="card flex flex-col sm:flex-row sm:items-center gap-3 py-3">
        <div className="flex items-center gap-2 flex-1">
          <label className="text-sm text-neutral-600">Tipo:</label>
          <select
            className="input py-1.5 text-sm max-w-[180px]"
            value={filtroTipo}
            onChange={e => setFiltroTipo(e.target.value)}
          >
            <option value="todos">Todos</option>
            <option value="itv">ITV</option>
            <option value="its">ITS</option>
            <option value="tarjeta_transporte">Tarjeta transporte</option>
          </select>

          <label className="text-sm text-neutral-600 ml-2">Estado:</label>
          <select
            className="input py-1.5 text-sm max-w-[160px]"
            value={filtroEstado}
            onChange={e => setFiltroEstado(e.target.value)}
          >
            <option value="activas">Activas</option>
            <option value="descartadas">Descartadas</option>
            <option value="todas">Todas</option>
          </select>
        </div>

        {totalDescartadas > 0 && (
          <button
            onClick={() => setConfirmRestore(true)}
            className="btn-ghost text-sm text-primary-600 hover:bg-primary-50"
          >
            ↺ Restaurar {totalDescartadas} descartada{totalDescartadas === 1 ? '' : 's'}
          </button>
        )}
      </div>

      {/* Lista */}
      {loading ? <PageLoading /> : (
        visibles.length === 0 ? (
          <div className="card text-center py-12 text-neutral-400">
            <p className="text-4xl mb-3">✨</p>
            <p>Sin alertas que mostrar con los filtros actuales</p>
          </div>
        ) : (
          <>
            {/* Móvil: cards */}
            <div className="grid grid-cols-1 sm:hidden gap-2">
              {visibles.map(a => {
                const descartada = isDismissed(a);
                const fechaStr = new Date(a.fecha_caducidad).toLocaleDateString('es-ES');
                return (
                  <div key={`${a.vehicle_id}:${a.tipo}:${a.threshold}`}
                    className={`card space-y-2 ${descartada ? 'opacity-60' : ''}`}>
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="font-semibold text-neutral-900">
                          {TIPO_ICON[a.tipo]} {TIPO_LABEL[a.tipo]}
                        </p>
                        <p className="text-sm text-neutral-700">
                          {a.alias} <span className="text-neutral-400 font-mono">{a.matricula}</span>
                        </p>
                      </div>
                      <DiasBadge dias={a.dias_restantes} threshold={a.threshold} />
                    </div>
                    <div className="text-xs text-neutral-500">Caducidad: {fechaStr}</div>
                    <div className="flex gap-2 pt-1 border-t border-neutral-100">
                      <Link to="/vehiculos" className="btn-ghost text-xs flex-1 text-center">Ver vehículo</Link>
                      {descartada
                        ? <button onClick={() => handleRestore(a)} className="btn-ghost text-xs flex-1 text-primary-600">↺ Restaurar</button>
                        : <button onClick={() => handleDismiss(a)} className="btn-ghost text-xs flex-1 text-neutral-600">✕ Descartar</button>
                      }
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Desktop: tabla */}
            <div className="hidden sm:block card p-0 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-neutral-50 text-neutral-600 text-xs uppercase">
                    <tr>
                      <th className="text-left px-4 py-3">Vehículo</th>
                      <th className="text-left px-4 py-3">Documento</th>
                      <th className="text-left px-4 py-3">Caducidad</th>
                      <th className="text-left px-4 py-3">Días</th>
                      <th className="text-left px-4 py-3">Estado</th>
                      <th className="text-right px-4 py-3">Acciones</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-neutral-100">
                    {visibles.map(a => {
                      const descartada = isDismissed(a);
                      const fechaStr = new Date(a.fecha_caducidad).toLocaleDateString('es-ES');
                      return (
                        <tr
                          key={`${a.vehicle_id}:${a.tipo}:${a.threshold}`}
                          className={descartada ? 'opacity-50' : ''}
                        >
                          <td className="px-4 py-3">
                            <div className="font-medium text-neutral-900">{a.alias}</div>
                            <div className="text-xs text-neutral-500 font-mono">{a.matricula}</div>
                          </td>
                          <td className="px-4 py-3">
                            <span className="inline-flex items-center gap-1.5">
                              <span>{TIPO_ICON[a.tipo]}</span>
                              <span>{TIPO_LABEL[a.tipo]}</span>
                            </span>
                          </td>
                          <td className="px-4 py-3 text-neutral-700">{fechaStr}</td>
                          <td className="px-4 py-3">
                            <DiasBadge dias={a.dias_restantes} threshold={a.threshold} />
                          </td>
                          <td className="px-4 py-3">
                            {descartada
                              ? <span className="text-xs text-neutral-500">Descartada</span>
                              : <span className="text-xs text-primary-700 font-medium">Activa</span>
                            }
                          </td>
                          <td className="px-4 py-3 text-right whitespace-nowrap">
                            <Link to="/vehiculos" className="btn-ghost text-xs">Ver vehículo</Link>
                            {descartada
                              ? <button onClick={() => handleRestore(a)} className="btn-ghost text-xs text-primary-600 ml-1">↺ Restaurar</button>
                              : <button onClick={() => handleDismiss(a)} className="btn-ghost text-xs text-neutral-600 ml-1">✕ Descartar</button>
                            }
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )
      )}

      <ConfirmDialog
        isOpen={confirmRestore}
        onClose={() => setConfirmRestore(false)}
        onConfirm={handleRestoreAll}
        title="Restaurar todas las alertas descartadas"
        message={`Se restaurarán ${totalDescartadas} alertas descartadas. Volverán a aparecer como activas.`}
        confirmText="Restaurar todas"
      />
    </div>
  );
}
