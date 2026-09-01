import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { trabajosService } from '../../services/trabajos.service.js';
import { useNotification } from '../../context/NotificationContext.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import CameraCapture from '../../components/camera/CameraCapture.jsx';
import { IMAGEN_TIPOS_FIN } from '../../utils/constants.js';

/**
 * Flujo de finalización de trabajo:
 * Paso 1: Fotos + km por vehículo (combinados)
 * Paso 2: Motivo (solo si anticipado)
 * Paso 3: Confirmar y enviar
 */
export default function Finalizacion({ trabajo, onDone, onCancel }) {
  const { notify }           = useNotification();
  const { user, canManageTrabajos } = useAuth();

  // Operacionales solo ven y documentan su propio vehículo (el que son responsables).
  // Admins/gestores ven todos los vehículos del trabajo.
  const todosVehiculos = trabajo?.vehiculos || [];
  const vehiculos = canManageTrabajos()
    ? todosVehiculos
    : todosVehiculos.filter(v => v.responsable_user_id === user?.id);
  const isAnticipado = new Date() < new Date(trabajo?.fecha_fin);

  const [step,           setStep]          = useState('fotos');
  const [currentVehIdx,  setCurrentVehIdx] = useState(0);
  const [showCamera,     setShowCamera]    = useState(false);
  const [cameraIndex,    setCameraIndex]   = useState(0);

  // Mapa: vehicle_id → { [tipo_imagen]: File }
  const [evidencias, setEvidencias] = useState(() => {
    const map = {};
    vehiculos.forEach(v => { map[v.vehicle_id] = {}; });
    return map;
  });

  // Mapa: vehicle_id → string
  const [kmFinales, setKmFinales] = useState(() => {
    const map = {};
    vehiculos.forEach(v => { map[v.vehicle_id] = ''; });
    return map;
  });

  const [motivo,         setMotivo]        = useState('');
  const [uploading,      setUploading]     = useState(false);
  const [uploadProgress, setUploadProgress] = useState({});

  const currentVeh = vehiculos[currentVehIdx];

  const openCamera = (vi, index = 0) => {
    setCurrentVehIdx(vi);
    setCameraIndex(index);
    setShowCamera(true);
  };

  // Mapa estable de ObjectURLs para previews — se revocan al cambiar o desmontar
  const previews = useMemo(() => {
    const map = {};
    for (const [vehId, tipos] of Object.entries(evidencias)) {
      map[vehId] = {};
      for (const [tipo, file] of Object.entries(tipos)) {
        if (file) map[vehId][tipo] = URL.createObjectURL(file);
      }
    }
    return map;
  }, [evidencias]);

  useEffect(() => {
    return () => {
      for (const tipos of Object.values(previews)) {
        for (const url of Object.values(tipos)) URL.revokeObjectURL(url);
      }
    };
  }, [previews]);

  /* ── Cámara guiada ─────────────────────────────────────── */
  const handleCameraComplete = (captures) => {
    setShowCamera(false);
    setEvidencias(prev => {
      const next = { ...prev };
      if (!next[currentVeh.vehicle_id]) next[currentVeh.vehicle_id] = {};
      captures.forEach(c => {
        next[currentVeh.vehicle_id][c.tipo] = c.file;
      });
      return next;
    });
  };

  /* ── Subir evidencias + finalizar ─────────────────────── */
  const handleFinalizar = async () => {
    setUploading(true);
    try {
      // 1. Subir fotos
      for (const veh of vehiculos) {
        for (const tipo of IMAGEN_TIPOS_FIN) {
          const file = evidencias[veh.vehicle_id]?.[tipo.key];
          if (!file) continue;

          const fd = new FormData();
          fd.append('image',       file);
          fd.append('vehicle_id',  veh.vehicle_id);
          fd.append('tipo_imagen', tipo.key);
          fd.append('momento',     'fin');

          try {
            await trabajosService.uploadEvidencia(trabajo.id, fd);
            setUploadProgress(p => ({
              ...p,
              [veh.vehicle_id]: { ...(p[veh.vehicle_id] || {}), [tipo.key]: 'ok' },
            }));
          } catch (uploadErr) {
            setUploadProgress(p => ({
              ...p,
              [veh.vehicle_id]: { ...(p[veh.vehicle_id] || {}), [tipo.key]: 'error' },
            }));
            const msg = uploadErr?.response?.data?.message || uploadErr?.message || '';
            throw new Error(`Error subiendo ${tipo.label} (${veh.matricula})${msg ? ': ' + msg : ''}`);
          }
        }
      }

      // 2. Finalizar
      const vehiculos_km = vehiculos.map(v => ({
        vehicle_id:     v.vehicle_id,
        kilometros_fin: parseInt(kmFinales[v.vehicle_id]),
      }));

      const result = await trabajosService.finalize(trabajo.id, {
        vehiculos_km,
        motivo_finalizacion_anticipada: isAnticipado ? motivo : undefined,
      });

      notify.success(result.message || '¡Trabajo finalizado correctamente!');
      onDone?.();
    } catch (err) {
      // Priorizar mensaje del backend sobre mensaje genérico de Axios
      notify.error(err.response?.data?.message || err.message || 'Error al finalizar');
    } finally {
      setUploading(false);
    }
  };

  /* ── Validaciones ─────────────────────────────────────── */
  const fotosPorVeh = (vid) =>
    IMAGEN_TIPOS_FIN.filter(t => evidencias[vid]?.[t.key]).length;

  const canProceedFromFotos = vehiculos.length > 0 && vehiculos.every(v =>
    IMAGEN_TIPOS_FIN.every(t => evidencias[v.vehicle_id]?.[t.key]) &&
    kmFinales[v.vehicle_id] && parseInt(kmFinales[v.vehicle_id]) >= 0
  );

  /* ── CameraCapture ────────────────────────────────────── */
  if (showCamera && currentVeh) {
    return (
      <CameraCapture
        tipos={IMAGEN_TIPOS_FIN}
        onComplete={handleCameraComplete}
        onCancel={() => setShowCamera(false)}
        initialIndex={cameraIndex}
      />
    );
  }

  /* ── Sin vehículos ────────────────────────────────────── */
  if (vehiculos.length === 0) {
    return (
      <div className="space-y-4 animate-fade-in">
        <div className="flex items-center gap-3">
          <button onClick={onCancel} className="btn-ghost btn-icon">‹</button>
          <h2 className="text-lg font-bold text-neutral-900">Finalizar trabajo</h2>
        </div>
        <div className="card bg-bad-50 border border-bad-200 space-y-2">
          <p className="text-bad-600 font-medium">Sin vehículos asignados</p>
          <p className="text-bad-600 text-sm">
            Este trabajo no tiene vehículos asignados. Contacta con el administrador.
          </p>
        </div>
        <button onClick={onCancel} className="btn-secondary w-full">Volver</button>
      </div>
    );
  }

  /* ── Bloqueo: falta inicio de algún vehículo ──────────── */
  const vehiculosSinInicio = vehiculos.filter(v => !v.progreso_fotos?.inicio?.completo);
  if (vehiculosSinInicio.length > 0) {
    return (
      <div className="space-y-4 animate-fade-in">
        <div className="flex items-center gap-3">
          <button onClick={onCancel} className="btn-ghost btn-icon">‹</button>
          <h2 className="text-lg font-bold text-neutral-900">Finalizar trabajo</h2>
        </div>
        <div className="card bg-warn-50 border border-warn-200 space-y-2">
          <p className="text-warn-700 font-medium">Faltan las fotos de inicio</p>
          <p className="text-warn-600 text-sm">
            Antes de finalizar tienes que subir las fotos de inicio de:
          </p>
          <ul className="text-warn-600 text-sm list-disc pl-5">
            {vehiculosSinInicio.map(v => (
              <li key={v.vehicle_id}>
                <strong>{v.vehiculo_alias || v.matricula}</strong> ({v.matricula})
                {' — '}
                {v.progreso_fotos?.inicio?.completado || 0}/{v.progreso_fotos?.inicio?.total || IMAGEN_TIPOS_FIN.length} subidas
              </li>
            ))}
          </ul>
          <p className="text-warn-600 text-xs">
            Vuelve al detalle del trabajo y pulsa <strong>"Fotos de inicio"</strong> para completarlas.
          </p>
        </div>
        <button onClick={onCancel} className="btn-secondary w-full">Volver</button>
      </div>
    );
  }

  /* ── Indicador de pasos ───────────────────────────────── */
  const steps = ['Fotos y km', isAnticipado ? 'Motivo' : null, 'Confirmar'].filter(Boolean);
  const stepKeys = ['fotos', isAnticipado ? 'motivo' : null, 'confirm'].filter(Boolean);
  const currentStepIdx = stepKeys.indexOf(step);

  return (
    <div className="space-y-6 animate-fade-in pb-10">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button onClick={onCancel} className="btn-ghost btn-icon">‹</button>
        <div>
          <h2 className="text-lg font-bold text-neutral-900">Finalizar trabajo</h2>
          <p className="text-sm text-neutral-500">{trabajo?.nombre}</p>
          {isAnticipado && (
            <span className="badge-yellow text-xs mt-1">Finalización anticipada</span>
          )}
        </div>
      </div>

      {/* Pasos */}
      <div className="flex items-center gap-2">
        {steps.map((s, i, arr) => {
          const isActive = stepKeys[i] === step;
          const isDone   = i < currentStepIdx;
          return (
            <React.Fragment key={s}>
              <div className={`flex items-center gap-1.5 text-xs font-medium
                ${isActive ? 'text-primary-700' : isDone ? 'text-ok-600' : 'text-neutral-400'}`}>
                <span className={`data w-5 h-5 rounded-full flex items-center justify-center text-[11px] font-semibold
                  ${isActive ? 'bg-primary-600 text-white' : isDone ? 'bg-ok-600 text-white' : 'bg-neutral-200 text-neutral-500'}`}>
                  {i + 1}
                </span>
                <span className="hidden sm:inline">{s}</span>
              </div>
              {i < arr.length - 1 && <div className="flex-1 h-px bg-neutral-200" />}
            </React.Fragment>
          );
        })}
      </div>

      {/* ── Paso 1: Fotos + km ───────────────────────────── */}
      {step === 'fotos' && (
        <div className="space-y-4">
          {vehiculos.map((veh, vi) => {
            const done = fotosPorVeh(veh.vehicle_id);
            const total = IMAGEN_TIPOS_FIN.length;
            return (
              <div key={veh.vehicle_id} className="card space-y-4">
                {/* Cabecera vehículo */}
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="font-semibold">{veh.vehiculo_alias || veh.matricula}</h3>
                    <p className="text-xs text-neutral-500">{veh.matricula}</p>
                  </div>
                  <button
                    onClick={() => openCamera(vi, 0)}
                    className="btn-secondary text-sm"
                  >
                    Cámara guiada
                  </button>
                </div>

                <p className="text-xs text-neutral-500">
                  Toca cada foto para hacerla con la <strong>cámara</strong>,
                  o usa <strong>Cámara guiada</strong> para el recorrido completo.
                </p>

                {/* Grid de fotos */}
                <div className="grid grid-cols-3 gap-2">
                  {IMAGEN_TIPOS_FIN.map((tipo, ti) => {
                    const file    = evidencias[veh.vehicle_id]?.[tipo.key];
                    const preview = previews[veh.vehicle_id]?.[tipo.key] || null;
                    const prog    = uploadProgress[veh.vehicle_id]?.[tipo.key];

                    return (
                      <div key={tipo.key}>
                        <button
                          type="button"
                          onClick={() => openCamera(vi, ti)}
                          className="w-full text-left"
                        >
                          <div className={`aspect-square rounded-lg border overflow-hidden relative
                            ${file ? 'border-ok-200' : 'border-dashed border-neutral-300 hover:border-primary-600'}`}>
                            {preview ? (
                              <img src={preview} alt={tipo.label} className="w-full h-full object-cover" />
                            ) : (
                              <div className="w-full h-full bg-neutral-50 flex flex-col items-center justify-center gap-1 p-1">
                                <span className="data text-[11px] font-semibold text-neutral-400">{ti + 1}</span>
                                <span className="text-neutral-400 text-[10px] text-center leading-tight">
                                  {tipo.label.split(' ')[0]}
                                </span>
                              </div>
                            )}
                            {prog === 'ok' && (
                              <div className="absolute inset-x-0 bottom-0 bg-ok-600 text-white text-[10px] font-semibold uppercase tracking-wide text-center py-0.5">
                                Subida
                              </div>
                            )}
                            {prog === 'error' && (
                              <div className="absolute inset-x-0 bottom-0 bg-bad-600 text-white text-[10px] font-semibold uppercase tracking-wide text-center py-0.5">
                                Error
                              </div>
                            )}
                          </div>
                          <p className="text-center text-[10px] mt-1 leading-tight">
                            <span className={file ? 'text-neutral-700 font-medium' : 'text-neutral-500'}>{tipo.label}</span>
                          </p>
                        </button>
                      </div>
                    );
                  })}
                </div>

                {/* Progreso fotos */}
                <div className="flex items-center gap-2">
                  <div className="flex-1 h-1.5 bg-neutral-100 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-primary-500 rounded-full transition-all"
                      style={{ width: `${(done / total) * 100}%` }}
                    />
                  </div>
                  <span className="text-xs text-neutral-500 shrink-0">{done}/{total} fotos</span>
                </div>

                {/* Kilómetros finales — en el mismo paso */}
                <div className="border-t border-neutral-100 pt-3">
                  <label className="label text-sm">
                    Kilómetros finales <span className="text-bad-500">*</span>
                  </label>
                  <div className="flex items-center gap-3 mt-1">
                    {veh.kilometros_inicio != null && (
                      <span className="text-xs text-neutral-500 shrink-0">
                        Inicio: {veh.kilometros_inicio.toLocaleString()} km
                      </span>
                    )}
                    <input
                      type="number"
                      className="input flex-1"
                      min={veh.kilometros_inicio || 0}
                      value={kmFinales[veh.vehicle_id]}
                      onChange={e => setKmFinales(k => ({ ...k, [veh.vehicle_id]: e.target.value }))}
                      placeholder="Introduce los km actuales"
                    />
                  </div>
                </div>
              </div>
            );
          })}

          <button
            onClick={() => setStep(isAnticipado ? 'motivo' : 'confirm')}
            disabled={!canProceedFromFotos}
            className="btn-primary btn-full"
          >
            Continuar →
          </button>
          {!canProceedFromFotos && (
            <p className="text-xs text-center text-bad-500">
              Completa las {IMAGEN_TIPOS_FIN.length} fotos y los kilómetros de cada vehículo
            </p>
          )}
        </div>
      )}

      {/* ── Paso 2: Motivo (solo si anticipado) ─────────── */}
      {step === 'motivo' && (
        <div className="space-y-4">
          <div className="p-3 bg-warn-50 border border-warn-200 rounded-lg">
            <p className="text-warn-700 text-sm">
              Estás finalizando el trabajo antes de la fecha prevista.
              Por favor, indica el motivo.
            </p>
          </div>
          <div>
            <label className="label">Motivo de finalización anticipada <span className="text-bad-500">*</span></label>
            <textarea
              className="input min-h-28 resize-none"
              value={motivo}
              onChange={e => setMotivo(e.target.value)}
              placeholder="Describe el motivo por el que se finaliza antes de lo previsto..."
            />
          </div>
          <div className="flex gap-3">
            <button onClick={() => setStep('fotos')} className="btn-secondary flex-1">‹ Volver</button>
            <button
              onClick={() => setStep('confirm')}
              disabled={!motivo.trim()}
              className="btn-primary flex-1"
            >
              Continuar
            </button>
          </div>
        </div>
      )}

      {/* ── Paso 3: Confirmación ─────────────────────────── */}
      {step === 'confirm' && (
        <div className="space-y-4">
          <div className="card space-y-3">
            <h3 className="font-semibold">Resumen de finalización</h3>
            <div className="divide-y divide-neutral-100">
              {vehiculos.map(veh => (
                <div key={veh.vehicle_id} className="py-3">
                  <p className="font-medium text-sm">{veh.vehiculo_alias || veh.matricula}</p>
                  <p className="text-xs text-neutral-500 mt-0.5">
                    {veh.kilometros_inicio != null && `${veh.kilometros_inicio.toLocaleString()} → `}
                    <strong>{parseInt(kmFinales[veh.vehicle_id]).toLocaleString()} km</strong>
                  </p>
                  <div className="flex gap-1 mt-1.5 flex-wrap">
                    {IMAGEN_TIPOS_FIN.map(t => (
                      <span key={t.key} className={`badge text-[10px] ${
                        evidencias[veh.vehicle_id]?.[t.key] ? 'badge-green' : 'badge-red'
                      }`}>
                        {t.label.split(' ')[0]}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            {isAnticipado && motivo && (
              <div className="bg-warn-50 rounded-lg p-3">
                <p className="text-xs font-medium text-warn-700">Motivo:</p>
                <p className="text-sm text-warn-600 mt-1">{motivo}</p>
              </div>
            )}
          </div>

          <div className="flex gap-3">
            <button
              onClick={() => setStep(isAnticipado ? 'motivo' : 'fotos')}
              className="btn-secondary flex-1"
              disabled={uploading}
            >
              ‹ Volver
            </button>
            <button
              onClick={handleFinalizar}
              className="btn-primary flex-1"
              disabled={uploading}
            >
              {uploading ? (
                <span className="flex items-center justify-center gap-2">
                  <span className="w-4 h-4 spinner" /> Finalizando...
                </span>
              ) : 'Finalizar trabajo'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
