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
        <h1 className="text-xl font-bold text-neutral-900">Mis asignaciones</h1>
        <p className="text-neutral-500 text-sm">Vehículos asignados a tu responsabilidad</p>
      </div>

      {loading ? <PageLoading /> : asignaciones.length === 0 ? (
        <div className="card text-center py-16 text-neutral-400">
          <p className="text-4xl mb-3">🚐</p>
          <p className="font-medium">No tienes asignaciones activas</p>
          <p className="text-sm mt-1">Aquí aparecerán los vehículos que te asignen</p>
        </div>
      ) : (
        <div className="space-y-3">
          {asignaciones.map(a => {
            const isActiva     = a.estado === 'activa';
            const isProgramada = a.estado === 'programada';

            return (
              <div key={a.id} className={`card border-l-4 ${isActiva ? 'border-l-blue-500' : 'border-l-yellow-400'}`}>
                <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 sm:gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 mb-1">
                      <span className="text-lg font-bold text-neutral-900 break-all">{a.matricula}</span>
                      {a.vehiculo_alias && (
                        <span className="text-sm text-neutral-500 truncate">· {a.vehiculo_alias}</span>
                      )}
                      <span className={ASIGNACION_ESTADO_COLORS[a.estado]}>
                        {ASIGNACION_ESTADO_LABELS[a.estado]}
                      </span>
                    </div>

                    <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm text-neutral-600 mt-2">
                      <div>
                        <span className="text-neutral-400 text-xs block">Inicio</span>
                        <span className="whitespace-nowrap">{formatDateTime(a.fecha_inicio)}</span>
                      </div>
                      <div>
                        <span className="text-neutral-400 text-xs block">Fin previsto</span>
                        <span className="whitespace-nowrap">{formatDateTime(a.fecha_fin)}</span>
                      </div>
                      {a.km_inicio != null && (
                        <div>
                          <span className="text-neutral-400 text-xs block">Km inicio</span>
                          {a.km_inicio.toLocaleString()} km
                        </div>
                      )}
                    </div>

                    {a.notas && (
                      <p className="text-xs text-neutral-500 mt-2 italic border-t border-neutral-100 pt-2">
                        {a.notas}
                      </p>
                    )}
                  </div>

                  {/* Acciones: fila full-width en móvil, columna lateral en sm+ */}
                  <div className="flex flex-row sm:flex-col gap-2 sm:shrink-0">
                    {isProgramada && (
                      <button
                        onClick={() => handleActivar(a.id)}
                        className="btn-secondary text-sm flex-1 sm:flex-none"
                      >
                        Activar
                      </button>
                    )}
                    <button
                      onClick={() => setDetalleId(a.id)}
                      className="btn-primary text-sm flex-1 sm:flex-none"
                    >
                      {isActiva ? 'Subir fotos / Finalizar' : 'Abrir'}
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
