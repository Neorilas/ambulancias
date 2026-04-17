import React, { useState, useEffect } from 'react';
import { asignacionesService } from '../../services/asignaciones.service.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { useNotification } from '../../context/NotificationContext.jsx';
import { formatDateTime } from '../../utils/dateUtils.js';
import {
  ASIGNACION_ESTADO_COLORS, ASIGNACION_ESTADO_LABELS,
  IMAGEN_TIPOS_INICIO, IMAGEN_TIPOS_FIN,
} from '../../utils/constants.js';
import InicioAsignacion from './InicioAsignacion.jsx';
import FinalizacionAsignacion from './FinalizacionAsignacion.jsx';

const API_BASE = import.meta.env.VITE_API_URL?.replace('/api', '') || '';

export default function AsignacionDetalle({ id, onClose }) {
  const { notify } = useNotification();
  const { user, canManageTrabajos } = useAuth();
  const [asig,    setAsig]    = useState(null);
  const [loading, setLoading] = useState(true);
  const [lightbox, setLightbox] = useState(null);
  const [showInicio, setShowInicio] = useState(false);
  const [showFin,    setShowFin]    = useState(false);

  const load = () => {
    setLoading(true);
    asignacionesService.get(id)
      .then(setAsig)
      .catch(() => notify.error('Error al cargar la asignación'))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, [id]);

  // Evidencias indexadas por (momento, tipo)
  const evInicio = {};
  const evFin    = {};
  asig?.evidencias?.forEach(e => {
    if (e.momento === 'inicio') evInicio[e.tipo_imagen] = e;
    else if (e.momento === 'fin') evFin[e.tipo_imagen] = e;
  });

  const soyResponsable = asig?.user_id === user?.id || canManageTrabajos();
  const finalizada     = asig?.estado === 'finalizada' || asig?.estado === 'cancelada';
  const inicioIncompleto = asig?.progreso?.inicio && !asig.progreso.inicio.completo;
  const puedeInicio      = soyResponsable && !finalizada && inicioIncompleto;
  const puedeFin         = soyResponsable && !finalizada && !inicioIncompleto;

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

            {/* Aviso persistente: falta inicio */}
            {puedeInicio && (
              <div className="card bg-amber-50 border-amber-300 border-2 space-y-2">
                <div className="flex items-start gap-3">
                  <span className="text-2xl">⚠</span>
                  <div className="flex-1">
                    <p className="font-semibold text-amber-900 text-sm">Faltan fotos de inicio</p>
                    <p className="text-xs text-amber-800 mt-0.5">
                      Antes de poder finalizar, documenta el estado del vehículo al recibirlo
                      ({asig.progreso?.inicio?.completado || 0}/{asig.progreso?.inicio?.total || 6}).
                    </p>
                  </div>
                  <button
                    onClick={() => setShowInicio(true)}
                    className="btn-primary text-xs whitespace-nowrap"
                  >
                    📸 Subir ahora
                  </button>
                </div>
              </div>
            )}

            {/* Botones de acción */}
            {(puedeFin || (soyResponsable && !finalizada && !inicioIncompleto)) && (
              <div className="flex gap-2">
                <button onClick={() => setShowFin(true)} className="btn-primary flex-1">
                  ✓ Finalizar asignación
                </button>
              </div>
            )}

            {/* Evidencias de INICIO */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-medium text-neutral-900 text-sm">
                  <span className="inline-block bg-blue-100 text-blue-700 text-[10px] font-semibold px-1.5 py-0.5 rounded mr-2">INICIO</span>
                  Fotos al recibir el vehículo
                </h3>
                <span className={`text-xs font-medium ${asig.progreso?.inicio?.completo ? 'text-green-600' : 'text-amber-600'}`}>
                  {asig.progreso?.inicio?.completado || 0}/{asig.progreso?.inicio?.total || 6}
                </span>
              </div>
              <div className="grid grid-cols-3 gap-2">
                {IMAGEN_TIPOS_INICIO.map(tipo => {
                  const ev = evInicio[tipo.key];
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

            {/* Evidencias de FIN */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-medium text-neutral-900 text-sm">
                  <span className="inline-block bg-green-100 text-green-700 text-[10px] font-semibold px-1.5 py-0.5 rounded mr-2">FIN</span>
                  Fotos al finalizar
                </h3>
                <span className={`text-xs font-medium ${asig.progreso?.fin?.completo ? 'text-green-600' : 'text-amber-600'}`}>
                  {asig.progreso?.fin?.completado || 0}/{asig.progreso?.fin?.total || 5}
                </span>
              </div>
              <div className="grid grid-cols-3 gap-2">
                {IMAGEN_TIPOS_FIN.map(tipo => {
                  const ev = evFin[tipo.key];
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

            {/* Modales inicio / fin */}
            {showInicio && (
              <div className="fixed inset-0 z-[70] bg-white overflow-y-auto p-5">
                <InicioAsignacion
                  asignacion={asig}
                  onDone={() => { setShowInicio(false); load(); }}
                  onCancel={() => setShowInicio(false)}
                />
              </div>
            )}
            {showFin && (
              <div className="fixed inset-0 z-[70] bg-white overflow-y-auto p-5">
                <FinalizacionAsignacion
                  asignacion={asig}
                  onDone={() => { setShowFin(false); load(); }}
                  onCancel={() => setShowFin(false)}
                />
              </div>
            )}
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
