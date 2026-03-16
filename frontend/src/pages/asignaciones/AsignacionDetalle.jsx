import React, { useState, useEffect } from 'react';
import { asignacionesService } from '../../services/asignaciones.service.js';
import { useNotification } from '../../context/NotificationContext.jsx';
import { formatDateTime } from '../../utils/dateUtils.js';
import { ASIGNACION_ESTADO_COLORS, ASIGNACION_ESTADO_LABELS, IMAGEN_TIPOS } from '../../utils/constants.js';

const API_BASE = import.meta.env.VITE_API_URL?.replace('/api', '') || '';

export default function AsignacionDetalle({ id, onClose }) {
  const { notify } = useNotification();
  const [asig,    setAsig]    = useState(null);
  const [loading, setLoading] = useState(true);
  const [lightbox, setLightbox] = useState(null);

  useEffect(() => {
    asignacionesService.get(id)
      .then(setAsig)
      .catch(() => notify.error('Error al cargar la asignación'))
      .finally(() => setLoading(false));
  }, [id]);

  const evidenciaMap = {};
  asig?.evidencias?.forEach(e => { evidenciaMap[e.tipo_imagen] = e; });

  return (
    <div className="fixed inset-0 z-50 flex">
      {/* Overlay */}
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />

      {/* Panel derecho */}
      <div className="relative ml-auto w-full max-w-xl bg-white h-full shadow-2xl flex flex-col overflow-y-auto animate-slide-up">
        {/* Header */}
        <div className="sticky top-0 bg-white border-b border-neutral-100 px-5 py-4 flex items-center justify-between z-10">
          <div>
            <h2 className="font-semibold text-neutral-900">Detalle de asignación #{id}</h2>
            {asig && (
              <span className={`text-xs ${ASIGNACION_ESTADO_COLORS[asig.estado]}`}>
                {ASIGNACION_ESTADO_LABELS[asig.estado]}
              </span>
            )}
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg text-neutral-400 hover:text-neutral-600 hover:bg-neutral-100">
            <svg className="w-5 h-5" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
            </svg>
          </button>
        </div>

        {loading ? (
          <div className="flex-1 flex items-center justify-center text-neutral-400">Cargando…</div>
        ) : !asig ? (
          <div className="flex-1 flex items-center justify-center text-neutral-400">No encontrado</div>
        ) : (
          <div className="flex-1 p-5 space-y-6">
            {/* Info general */}
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <p className="text-neutral-400 text-xs mb-0.5">Vehículo</p>
                <p className="font-medium text-neutral-900">{asig.matricula}</p>
                {asig.vehiculo_alias && <p className="text-neutral-500 text-xs">{asig.vehiculo_alias}</p>}
              </div>
              <div>
                <p className="text-neutral-400 text-xs mb-0.5">Responsable</p>
                <p className="font-medium text-neutral-900">{asig.responsable_nombre}</p>
                <p className="text-neutral-500 text-xs">@{asig.responsable_username}</p>
              </div>
              <div>
                <p className="text-neutral-400 text-xs mb-0.5">Inicio</p>
                <p className="text-neutral-900">{formatDateTime(asig.fecha_inicio)}</p>
              </div>
              <div>
                <p className="text-neutral-400 text-xs mb-0.5">Fin</p>
                <p className="text-neutral-900">{formatDateTime(asig.fecha_fin)}</p>
              </div>
              <div>
                <p className="text-neutral-400 text-xs mb-0.5">Km inicio</p>
                <p className="text-neutral-900">{asig.km_inicio != null ? `${asig.km_inicio.toLocaleString()} km` : '—'}</p>
              </div>
              <div>
                <p className="text-neutral-400 text-xs mb-0.5">Km fin</p>
                <p className="text-neutral-900">{asig.km_fin != null ? `${asig.km_fin.toLocaleString()} km` : '—'}</p>
              </div>
              {asig.motivo_fin && (
                <div className="col-span-2">
                  <p className="text-neutral-400 text-xs mb-0.5">Motivo finalización</p>
                  <p className="text-neutral-700 italic">{asig.motivo_fin}</p>
                </div>
              )}
              {asig.notas && (
                <div className="col-span-2">
                  <p className="text-neutral-400 text-xs mb-0.5">Notas</p>
                  <p className="text-neutral-700">{asig.notas}</p>
                </div>
              )}
            </div>

            {/* Progreso evidencias */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-medium text-neutral-900 text-sm">Evidencias fotográficas</h3>
                <span className={`text-xs font-medium ${asig.progreso?.completo ? 'text-green-600' : 'text-amber-600'}`}>
                  {asig.progreso?.completado}/{asig.progreso?.total} subidas
                </span>
              </div>
              <div className="grid grid-cols-3 gap-2">
                {IMAGEN_TIPOS.map(tipo => {
                  const ev = evidenciaMap[tipo.key];
                  return (
                    <div key={tipo.key} className="relative aspect-[4/3] rounded-lg overflow-hidden border border-neutral-200 bg-neutral-50">
                      {ev ? (
                        <>
                          <img
                            src={`${API_BASE}${ev.image_url}`}
                            alt={tipo.label}
                            className="w-full h-full object-cover cursor-pointer"
                            onClick={() => setLightbox(`${API_BASE}${ev.image_url}`)}
                          />
                          <div className="absolute bottom-0 left-0 right-0 bg-black/50 text-white text-xs py-0.5 px-1 truncate">
                            {tipo.label}
                          </div>
                        </>
                      ) : (
                        <div className="flex flex-col items-center justify-center h-full gap-1 text-neutral-300">
                          <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                          </svg>
                          <p className="text-xs text-center px-1 text-neutral-400">{tipo.label}</p>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Lightbox */}
      {lightbox && (
        <div
          className="fixed inset-0 z-[60] bg-black/90 flex items-center justify-center"
          onClick={() => setLightbox(null)}
        >
          <img src={lightbox} alt="Evidencia" className="max-h-[90dvh] max-w-[90vw] object-contain rounded-lg" />
        </div>
      )}
    </div>
  );
}
