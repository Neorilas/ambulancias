import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { trabajosService } from '../services/trabajos.service.js';
import { useNotification } from '../context/NotificationContext.jsx';
import { EstadoBadge, TipoBadge } from '../components/common/StatusBadge.jsx';
import { PageLoading } from '../components/common/LoadingSpinner.jsx';
import { formatDateTime, isWorkActive, isOverdue } from '../utils/dateUtils.js';
import { TRABAJO_ESTADOS } from '../utils/constants.js';
import Finalizacion from './trabajos/Finalizacion.jsx';

export default function MisTrabajos() {
  const { notify }  = useNotification();
  const navigate    = useNavigate();

  const [trabajos,   setTrabajos]   = useState([]);
  const [pagination, setPagination] = useState(null);
  const [page,       setPage]       = useState(1);
  const [loading,    setLoading]    = useState(false);
  const [finTrabajo, setFinTrabajo] = useState(null); // Trabajo a finalizar

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const resp = await trabajosService.misTrab({ page });
      setTrabajos(resp.data || []);
      setPagination(resp.pagination);
    } catch { notify.error('Error al cargar trabajos'); }
    finally { setLoading(false); }
  }, [page]);

  useEffect(() => { load(); }, [load]);

  const handleFinalizado = () => {
    setFinTrabajo(null);
    load();
    notify.success('Trabajo finalizado correctamente');
  };

  // Si estamos en flujo de finalización, mostrar componente
  if (finTrabajo) {
    return (
      <Finalizacion
        trabajo={finTrabajo}
        onDone={handleFinalizado}
        onCancel={() => setFinTrabajo(null)}
      />
    );
  }

  return (
    <div className="space-y-4 animate-fade-in">
      <div>
        <h1 className="text-xl font-bold text-neutral-900">Mis Trabajos</h1>
        <p className="text-neutral-500 text-sm">Trabajos asignados a ti</p>
      </div>

      {loading ? <PageLoading /> : (
        <>
          {trabajos.length === 0 ? (
            <div className="card text-center py-16">
              <p className="text-4xl mb-3">📋</p>
              <p className="text-neutral-500">No tienes trabajos asignados</p>
            </div>
          ) : (
            <div className="space-y-3">
              {trabajos.map(t => {
                const activo    = isWorkActive(t);
                const vencido   = isOverdue(t);
                const puedeFinz = t.soy_responsable &&
                  ![TRABAJO_ESTADOS.FINALIZADO, TRABAJO_ESTADOS.FINALIZADO_ANTICIPADO].includes(t.estado) &&
                  (activo || vencido);

                return (
                  <div key={t.id} className={`card border-l-4 ${
                    activo    ? 'border-l-blue-500' :
                    vencido   ? 'border-l-red-500' :
                    t.estado === 'finalizado' ? 'border-l-green-500' :
                    'border-l-neutral-200'
                  }`}>
                    <div className="flex items-start gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <h3 className="font-semibold text-neutral-900">{t.nombre}</h3>
                          <EstadoBadge estado={t.estado} />
                          {t.soy_responsable && (
                            <span className="badge bg-purple-100 text-purple-700 text-xs">Responsable</span>
                          )}
                        </div>
                        <p className="text-xs text-neutral-500 mt-1">
                          {t.identificador}
                        </p>
                        {t.vehiculo_alias && (
                          <p className="text-xs text-neutral-500 mt-0.5">
                            🚐 {t.vehiculo_alias} ({t.matricula})
                          </p>
                        )}
                        <p className="text-xs text-neutral-400 mt-1">
                          {formatDateTime(t.fecha_inicio)} → {formatDateTime(t.fecha_fin)}
                        </p>
                        {activo && (
                          <span className="inline-block mt-1 text-xs text-blue-600 font-medium">
                            ● En curso ahora
                          </span>
                        )}
                        {vencido && t.estado === 'activo' && (
                          <span className="inline-block mt-1 text-xs text-red-600 font-medium">
                            ⚠ Tiempo superado - pendiente de finalizar
                          </span>
                        )}
                      </div>

                      {puedeFinz && (
                        <button
                          onClick={async () => {
                            try {
                              const full = await trabajosService.get(t.id);
                              setFinTrabajo(full);
                            } catch { notify.error('Error al cargar el trabajo'); }
                          }}
                          className="btn-primary text-xs flex-shrink-0"
                        >
                          Finalizar
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
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
    </div>
  );
}
