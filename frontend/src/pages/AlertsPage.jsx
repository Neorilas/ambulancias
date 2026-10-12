/**
 * pages/AlertsPage.jsx
 *
 * Panel dedicado para administradores: visualiza y gestiona
 * todas las alertas de caducidad de documentos de vehículos
 * (ITV, ITS, Tarjeta de transporte) y del mantenimiento por km.
 *
 * Funciones:
 *   - KPIs por umbral (vencidas / 15d / 30d / 45d / 60d / mantenimiento por km)
 *   - Filtros por tipo de documento, umbral y estado (activas/descartadas)
 *   - Descartar y restaurar alertas (persistido en localStorage)
 *   - Acción masiva: restaurar todas las descartadas
 *   - Selector del horizonte consultado (60/90/180/365 días). El mantenimiento
 *     no lo mira: sale siempre que falten 2.000 km o menos
 *   - Refresco manual + timestamp de última actualización
 */

import React, { useEffect, useState, useMemo, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { vehiclesService }   from '../services/vehicles.service.js';
import { useNotification }   from '../context/NotificationContext.jsx';
import { PageLoading }       from '../components/common/LoadingSpinner.jsx';
import ConfirmDialog         from '../components/common/ConfirmDialog.jsx';
import { useEstadoEnUrl }    from '../hooks/useNavegacion.js';
import { formatFechaSola, formatDate } from '../utils/dateUtils.js';
import {
  TIPO_LABEL,
  UMBRALES_KM,
  margenAlerta,
  venceAlerta,
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

function MargenBadge({ alerta }) {
  return <span className={thresholdStyle(alerta.threshold).badge}>{margenAlerta(alerta)}</span>;
}

export default function AlertsPage() {
  const { notify } = useNotification();

  const [alertas,   setAlertas]   = useState([]);
  const [loading,   setLoading]   = useState(true);
  const [lastFetch, setLastFetch] = useState(null);
  const [horizonte, setHorizonte] = useState(60);

  // Filtros
  // Filtros en la URL: «Ver vehículo» lleva a su ficha y al volver siguen
  // puestos (en `useState` se perdían)
  const [filtros, cambiarFiltros] = useEstadoEnUrl({
    tipo:   'todos',    // todos|itv|its|tarjeta_transporte|mantenimiento
    umbral: 'todos',    // todos|vencida|15|30|45|60|lejana (>60 días)|km (mantenimiento sin vencer)
    estado: 'activas',  // activas|descartadas|todas
  });
  const { tipo: filtroTipo, umbral: filtroUmbral, estado: filtroEstado } = filtros;
  const setFiltroTipo   = (v) => cambiarFiltros({ tipo: v });
  const setFiltroUmbral = (v) => cambiarFiltros({ umbral: v });
  const setFiltroEstado = (v) => cambiarFiltros({ estado: v });

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

  // «> 60 días» solo existe con un horizonte mayor (que no va en la URL). Con
  // `?umbral=lejana` y el horizonte en 60 —al volver a 60, o al recargar o
  // abrir un enlace con el filtro—, su casilla no se pinta y la lista salía
  // vacía sin forma visible de quitar el filtro.
  useEffect(() => {
    if (horizonte <= 60 && filtroUmbral === 'lejana') setFiltroUmbral('todos');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [horizonte, filtroUmbral]);

  // Todas las alertas con umbral calculado
  const conThreshold = useMemo(() => withThresholds(alertas, horizonte), [alertas, horizonte]);

  // KPIs (sobre TODAS, sin filtrar por estado)
  const kpis = useMemo(() => ({
    vencida: conThreshold.filter(a => a.threshold === 'vencida').length,
    15:      conThreshold.filter(a => a.threshold === 15).length,
    30:      conThreshold.filter(a => a.threshold === 30).length,
    45:      conThreshold.filter(a => a.threshold === 45).length,
    60:      conThreshold.filter(a => a.threshold === 60).length,
    lejana:  conThreshold.filter(a => a.threshold === 'lejana').length,
    km:      conThreshold.filter(a => UMBRALES_KM.includes(a.threshold)).length,
    total:   conThreshold.length,
  }), [conThreshold]);

  // Aplicar filtros
  const visibles = useMemo(() => {
    let out = conThreshold;

    if (filtroTipo !== 'todos') {
      out = out.filter(a => a.tipo === filtroTipo);
    }
    if (filtroUmbral === 'km') {
      out = out.filter(a => UMBRALES_KM.includes(a.threshold));
    } else if (filtroUmbral !== 'todos') {
      const t = ['vencida', 'lejana'].includes(filtroUmbral) ? filtroUmbral : parseInt(filtroUmbral);
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
          <h1 className="text-[19px] font-semibold text-neutral-900">Alertas de caducidad</h1>
          <p className="text-neutral-500 text-sm">
            ITV, ITS y tarjeta de transporte en los próximos {horizonte} días, y mantenimiento
            a 2.000 km o menos · {kpis.total} alertas
            {lastFetch && (
              <span className="text-neutral-400"> · actualizado {formatDate(lastFetch, 'HH:mm:ss')}</span>
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
      <div className={`grid grid-cols-2 sm:grid-cols-3 gap-2 sm:gap-3 ${horizonte > 60 ? 'lg:grid-cols-7' : 'lg:grid-cols-6'}`}>
        <KpiCard
          color="bg-bad-50 text-bad-600"
          label="Vencidas"
          count={kpis.vencida}
          active={filtroUmbral === 'vencida'}
          onClick={() => setFiltroUmbral(filtroUmbral === 'vencida' ? 'todos' : 'vencida')}
        />
        <KpiCard
          color="bg-warn-50 text-warn-600"
          label="≤ 15 días"
          count={kpis[15]}
          active={filtroUmbral === '15'}
          onClick={() => setFiltroUmbral(filtroUmbral === '15' ? 'todos' : '15')}
        />
        <KpiCard
          color="bg-warn-50 text-warn-700"
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
        {/* Solo con un horizonte mayor: lo de más allá de 60 días */}
        {horizonte > 60 && (
          <KpiCard
            color="bg-idle-50 text-idle-600"
            label="> 60 días"
            count={kpis.lejana}
            active={filtroUmbral === 'lejana'}
            onClick={() => setFiltroUmbral(filtroUmbral === 'lejana' ? 'todos' : 'lejana')}
          />
        )}

        <KpiCard
          color="bg-warn-50 text-warn-700"
          label="Mantenimiento ≤ 2.000 km"
          count={kpis.km}
          active={filtroUmbral === 'km'}
          onClick={() => setFiltroUmbral(filtroUmbral === 'km' ? 'todos' : 'km')}
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
            <option value="mantenimiento">Mantenimiento (km)</option>
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
          <div className="empty">
            <p className="empty-title">Sin alertas</p>
            <p className="empty-hint">Ninguna coincide con los filtros actuales</p>
          </div>
        ) : (
          <>
            {/* Móvil: cards */}
            <div className="grid grid-cols-1 sm:hidden gap-2">
              {visibles.map(a => {
                const descartada = isDismissed(a);
                return (
                  <div key={`${a.vehicle_id}:${a.tipo}:${a.threshold}`}
                    className={`card space-y-2 ${descartada ? 'opacity-60' : ''}`}>
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="font-semibold text-neutral-900">
                          {TIPO_LABEL[a.tipo]}
                        </p>
                        <p className="text-sm text-neutral-700">
                          {a.alias} <span className="text-neutral-400 font-mono">{a.matricula}</span>
                        </p>
                      </div>
                      <MargenBadge alerta={a} />
                    </div>
                    <div className="text-xs text-neutral-500">Vence: {venceAlerta(a, formatFechaSola)}</div>
                    <div className="flex gap-2 pt-1 border-t border-neutral-100">
                      <Link to={`/vehiculos/${a.vehicle_id}`} className="btn-ghost text-xs flex-1 text-center">Ver vehículo</Link>
                      {descartada
                        ? <button onClick={() => handleRestore(a)} className="btn-ghost text-xs flex-1 text-primary-600">↺ Restaurar</button>
                        : <button onClick={() => handleDismiss(a)} className="btn-ghost text-xs flex-1 text-neutral-600">Descartar</button>
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
                      <th className="text-left px-4 py-3">Vence</th>
                      <th className="text-left px-4 py-3">Queda</th>
                      <th className="text-left px-4 py-3">Estado</th>
                      <th className="text-right px-4 py-3">Acciones</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-neutral-100">
                    {visibles.map(a => {
                      const descartada = isDismissed(a);
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
                            <span>{TIPO_LABEL[a.tipo]}</span>
                          </td>
                          <td className="px-4 py-3 text-neutral-700">{venceAlerta(a, formatFechaSola)}</td>
                          <td className="px-4 py-3">
                            <MargenBadge alerta={a} />
                          </td>
                          <td className="px-4 py-3">
                            {descartada
                              ? <span className="text-xs text-neutral-500">Descartada</span>
                              : <span className="text-xs text-primary-700 font-medium">Activa</span>
                            }
                          </td>
                          <td className="px-4 py-3 text-right whitespace-nowrap">
                            <Link to={`/vehiculos/${a.vehicle_id}`} className="btn-ghost text-xs">Ver vehículo</Link>
                            {descartada
                              ? <button onClick={() => handleRestore(a)} className="btn-ghost text-xs text-primary-600 ml-1">↺ Restaurar</button>
                              : <button onClick={() => handleDismiss(a)} className="btn-ghost text-xs text-neutral-600 ml-1">Descartar</button>
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
