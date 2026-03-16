import React, { useState, useEffect, useCallback } from 'react';
import { asignacionesService } from '../../services/asignaciones.service.js';
import { useNotification } from '../../context/NotificationContext.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import { PageLoading } from '../../components/common/LoadingSpinner.jsx';
import { formatDateTime } from '../../utils/dateUtils.js';
import { ASIGNACION_ESTADO_COLORS, ASIGNACION_ESTADO_LABELS } from '../../utils/constants.js';
import FinalizacionAsignacion from './FinalizacionAsignacion.jsx';

export default function MisAsignaciones() {
  const { notify } = useNotification();
  const { user }   = useAuth();

  const [asignaciones, setAsignaciones] = useState([]);
  const [loading,      setLoading]      = useState(true);
  const [finalizando,  setFinalizando]  = useState(null); // asignacion object

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

  const handleFinalizarDone = () => {
    setFinalizando(null);
    load();
  };

  if (finalizando) {
    return (
      <div className="max-w-lg mx-auto animate-fade-in">
        <button onClick={() => setFinalizando(null)} className="btn-ghost text-sm mb-4 flex items-center gap-1">
          ← Volver a mis asignaciones
        </button>
        <FinalizacionAsignacion
          asignacion={finalizando}
          onDone={handleFinalizarDone}
          onCancel={() => setFinalizando(null)}
        />
      </div>
    );
  }

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
            const isAnticipada = new Date() < new Date(a.fecha_fin);

            return (
              <div key={a.id} className={`card border-l-4 ${isActiva ? 'border-l-blue-500' : 'border-l-yellow-400'}`}>
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-lg font-bold text-neutral-900">{a.matricula}</span>
                      {a.vehiculo_alias && (
                        <span className="text-sm text-neutral-500">· {a.vehiculo_alias}</span>
                      )}
                      <span className={ASIGNACION_ESTADO_COLORS[a.estado]}>
                        {ASIGNACION_ESTADO_LABELS[a.estado]}
                      </span>
                    </div>

                    <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm text-neutral-600 mt-2">
                      <div>
                        <span className="text-neutral-400 text-xs block">Inicio</span>
                        {formatDateTime(a.fecha_inicio)}
                      </div>
                      <div>
                        <span className="text-neutral-400 text-xs block">Fin previsto</span>
                        {formatDateTime(a.fecha_fin)}
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

                  {/* Acciones */}
                  <div className="flex flex-col gap-2 shrink-0">
                    {isProgramada && (
                      <button
                        onClick={() => handleActivar(a.id)}
                        className="btn-secondary text-sm"
                      >
                        Activar
                      </button>
                    )}
                    {isActiva && (
                      <button
                        onClick={async () => {
                          // Cargar detalle completo antes de finalizar
                          try {
                            const full = await asignacionesService.get(a.id);
                            setFinalizando(full);
                          } catch {
                            notify.error('Error al cargar la asignación');
                          }
                        }}
                        className="btn-primary text-sm"
                      >
                        Finalizar
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
