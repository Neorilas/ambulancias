import React, { useState, useEffect, useCallback } from 'react';
import { asignacionesService } from '../../services/asignaciones.service.js';
import { useNotification } from '../../context/NotificationContext.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import { PageLoading } from '../../components/common/LoadingSpinner.jsx';
import { formatDateTime } from '../../utils/dateUtils.js';
import { ASIGNACION_ESTADO_COLORS, ASIGNACION_ESTADO_LABELS } from '../../utils/constants.js';
import AsignacionDetalle from './AsignacionDetalle.jsx';

export default function MisAsignaciones() {
  const { notify } = useNotification();
  const { user }   = useAuth();

  const [asignaciones, setAsignaciones] = useState([]);
  const [loading,      setLoading]      = useState(true);
  const [detalleId,    setDetalleId]    = useState(null); // asignación abierta en el panel de detalle

  const load = useCallback(async () => {
    setLoading(true);
    try {
      // El backend filtra por user_id automáticamente para operacionales
      const resp = await asignacionesService.list({ limit: 50 });
      const activas = (resp.data || []).filter(a => a.estado !== 'finalizada' && a.estado !== 'cancelada');
      setAsignaciones(activas);
    } catch {
      notify.error('Error al cargar las asignaciones');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleActivar = async (id) => {
    try {
      await asignacionesService.activar(id);
      notify.success('Asignación activada');
      load();
    } catch (err) {
      notify.error(err.response?.data?.message || 'Error al activar');
    }
  };

  // Al cerrar el detalle, recargar: si se finalizó, desaparece de la lista
  const handleCloseDetalle = () => {
    setDetalleId(null);
    load();
  };

  return (
    <div className="space-y-4 animate-fade-in">
      <div>
        <h1 className="text-[19px] font-semibold text-neutral-900">Mis asignaciones</h1>
        <p className="text-neutral-500 text-[13px] mt-0.5">Vehículos bajo tu responsabilidad</p>
      </div>

      {loading ? <PageLoading /> : asignaciones.length === 0 ? (
        <div className="empty">
          <p className="empty-title">No tienes asignaciones activas</p>
          <p className="empty-hint">Aquí aparecerán los vehículos que te asignen</p>
        </div>
      ) : (
        <div className="space-y-3">
          {asignaciones.map(a => {
            const isActiva     = a.estado === 'activa';
            const isProgramada = a.estado === 'programada';

            return (
              <div key={a.id} className="card pl-5">
                <span className={isActiva ? 'stripe-activa' : 'stripe-programada'} />
                <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 sm:gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
                      <span className="plate break-all">{a.matricula}</span>
                      {a.vehiculo_alias && (
                        <span className="text-[13.5px] font-medium text-neutral-500 truncate">
                          {a.vehiculo_alias}
                        </span>
                      )}
                      <span className={ASIGNACION_ESTADO_COLORS[a.estado]}>
                        {ASIGNACION_ESTADO_LABELS[a.estado]}
                      </span>
                    </div>

                    <div className="kv-row">
                      <span>
                        <span className="kv-k">{a.inicio_real_at ? 'Inicio real' : 'Inicio'}</span>
                        <span className="kv-v data whitespace-nowrap">
                          {formatDateTime(a.inicio_real_at || a.fecha_inicio)}
                        </span>
                      </span>
                      <span>
                        <span className="kv-k">Fin previsto</span>
                        <span className="kv-v data whitespace-nowrap">{formatDateTime(a.fecha_fin)}</span>
                      </span>
                      {a.km_inicio != null && (
                        <span>
                          <span className="kv-k">Km inicio</span>
                          <span className="kv-v data">{a.km_inicio.toLocaleString()}</span>
                        </span>
                      )}
                    </div>

                    {a.notas && (
                      <p className="text-[12.5px] text-neutral-500 mt-3.5 border-t border-neutral-100 pt-2.5">
                        {a.notas}
                      </p>
                    )}
                  </div>

                  {/* Acciones: fila full-width en móvil, columna lateral en sm+ */}
                  <div className="flex flex-row sm:flex-col gap-2 sm:shrink-0">
                    {isProgramada && (
                      <button
                        onClick={() => handleActivar(a.id)}
                        className="btn-secondary flex-1 sm:flex-none"
                      >
                        Activar
                      </button>
                    )}
                    <button
                      onClick={() => setDetalleId(a.id)}
                      className="btn-primary flex-1 sm:flex-none"
                    >
                      {isActiva ? 'Abrir jornada' : 'Abrir'}
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Panel de detalle: gestiona fotos de inicio + finalización */}
      {detalleId && (
        <AsignacionDetalle id={detalleId} onClose={handleCloseDetalle} />
      )}
    </div>
  );
}
