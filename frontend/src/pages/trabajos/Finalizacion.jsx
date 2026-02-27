import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { trabajosService } from '../../services/trabajos.service.js';
import { useNotification } from '../../context/NotificationContext.jsx';
import CameraCapture from '../../components/camera/CameraCapture.jsx';
import { IMAGEN_TIPOS } from '../../utils/constants.js';
import { compressImage, blobToFile } from '../../utils/imageCompress.js';

/**
 * Flujo de finalización de trabajo:
 * 1. Seleccionar vehículo (si hay varios)
 * 2. Capturar 5 fotos en orden forzado
 * 3. Introducir km finales
 * 4. Si fecha_fin futura: introducir motivo
 * 5. Confirmar y enviar
 */
export default function Finalizacion({ trabajo, onDone, onCancel }) {
  const { notify }  = useNotification();
  const navigate    = useNavigate();

  const vehiculos   = trabajo?.vehiculos || [];
  const isAnticipado = new Date() < new Date(trabajo?.fecha_fin);

  const [step,            setStep]            = useState('fotos');  // 'fotos' | 'km' | 'motivo' | 'confirm'
  const [currentVehIdx,   setCurrentVehIdx]   = useState(0);
  const [currentImgIdx,   setCurrentImgIdx]   = useState(0);
  const [showCamera,      setShowCamera]      = useState(false);

  // Mapa: vehicle_id → { [tipo_imagen]: File }
  const [evidencias,      setEvidencias]      = useState(() => {
    const map = {};
    vehiculos.forEach(v => { map[v.vehicle_id] = {}; });
    return map;
  });

  const [kmFinales,       setKmFinales]       = useState(() => {
    const map = {};
    vehiculos.forEach(v => { map[v.vehicle_id] = ''; });
    return map;
  });

  const [motivo,          setMotivo]          = useState('');
  const [uploading,       setUploading]       = useState(false);
  const [uploadProgress,  setUploadProgress]  = useState({}); // { vehicle_id: { tipo: 'ok'|'error' } }

  const currentVeh = vehiculos[currentVehIdx];

  // ── Fotos de un vehículo ──────────────────────────────────
  const vehEvidencias = currentVeh ? (evidencias[currentVeh.vehicle_id] || {}) : {};
  const tiposFaltantes = IMAGEN_TIPOS.filter(t => !vehEvidencias[t.key]);
  const todosCompletos = vehiculos.every(v =>
    IMAGEN_TIPOS.every(t => evidencias[v.vehicle_id]?.[t.key])
  );

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

  // ── Subir todas las evidencias + finalizar ────────────────
  const handleFinalizar = async () => {
    setUploading(true);
    try {
      // 1. Subir fotos
      for (const veh of vehiculos) {
        for (const tipo of IMAGEN_TIPOS) {
          const file = evidencias[veh.vehicle_id]?.[tipo.key];
          if (!file) continue;

          const fd = new FormData();
          fd.append('image',      file);
          fd.append('vehicle_id', veh.vehicle_id);
          fd.append('tipo_imagen', tipo.key);

          try {
            await trabajosService.uploadEvidencia(trabajo.id, fd);
            setUploadProgress(p => ({
              ...p,
              [veh.vehicle_id]: { ...(p[veh.vehicle_id] || {}), [tipo.key]: 'ok' },
            }));
          } catch {
            setUploadProgress(p => ({
              ...p,
              [veh.vehicle_id]: { ...(p[veh.vehicle_id] || {}), [tipo.key]: 'error' },
            }));
            throw new Error(`Error subiendo ${tipo.label} del vehículo ${veh.matricula}`);
          }
        }
      }

      // 2. Llamar a finalize
      const vehiculos_km = vehiculos.map(v => ({
        vehicle_id:     v.vehicle_id,
        kilometros_fin: parseInt(kmFinales[v.vehicle_id]),
      }));

      await trabajosService.finalize(trabajo.id, {
        vehiculos_km,
        motivo_finalizacion_anticipada: isAnticipado ? motivo : undefined,
      });

      notify.success('¡Trabajo finalizado correctamente!');
      onDone?.();
    } catch (err) {
      notify.error(err.message || err.response?.data?.message || 'Error al finalizar');
    } finally {
      setUploading(false);
    }
  };

  // ── Validaciones por paso ────────────────────────────────
  const canProceedFromFotos = vehiculos.every(v =>
    IMAGEN_TIPOS.every(t => evidencias[v.vehicle_id]?.[t.key])
  );

  const canProceedFromKm = vehiculos.every(v =>
    kmFinales[v.vehicle_id] && parseInt(kmFinales[v.vehicle_id]) >= 0
  );

  if (showCamera && currentVeh) {
    return (
      <CameraCapture
        onComplete={handleCameraComplete}
        onCancel={() => setShowCamera(false)}
        initialIndex={currentImgIdx}
      />
    );
  }

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

      {/* Indicador de pasos */}
      <div className="flex items-center gap-2">
        {['Fotos', 'Kilómetros', isAnticipado ? 'Motivo' : null, 'Confirmar']
          .filter(Boolean)
          .map((s, i, arr) => {
            const stepKey = ['fotos', 'km', isAnticipado ? 'motivo' : 'confirm', 'confirm'];
            const idx = ['fotos', 'km', isAnticipado ? 'motivo' : 'confirm', 'confirm'].indexOf(step);
            const isActive = stepKey[i] === step;
            const isDone   = i < idx;
            return (
              <React.Fragment key={s}>
                <div className={`flex items-center gap-1.5 text-xs font-medium
                  ${isActive ? 'text-primary-600' : isDone ? 'text-green-600' : 'text-neutral-400'}`}>
                  <span className={`w-5 h-5 rounded-full flex items-center justify-center text-xs
                    ${isActive ? 'bg-primary-600 text-white' : isDone ? 'bg-green-500 text-white' : 'bg-neutral-200'}`}>
                    {isDone ? '✓' : i + 1}
                  </span>
                  <span className="hidden sm:inline">{s}</span>
                </div>
                {i < arr.length - 1 && <div className="flex-1 h-px bg-neutral-200" />}
              </React.Fragment>
            );
          })}
      </div>

      {/* ── Paso 1: Fotos ── */}
      {step === 'fotos' && (
        <div className="space-y-4">
          {vehiculos.map((veh, vi) => (
            <div key={veh.vehicle_id} className="card space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-semibold">{veh.vehiculo_alias || veh.matricula}</h3>
                  <p className="text-xs text-neutral-500">{veh.matricula}</p>
                </div>
                <button
                  onClick={() => { setCurrentVehIdx(vi); setCurrentImgIdx(0); setShowCamera(true); }}
                  className="btn-primary text-sm"
                >
                  📷 Fotografiar
                </button>
              </div>

              {/* Estado de las fotos */}
              <div className="grid grid-cols-5 gap-2">
                {IMAGEN_TIPOS.map(tipo => {
                  const file    = evidencias[veh.vehicle_id]?.[tipo.key];
                  const preview = file ? URL.createObjectURL(file) : null;
                  const prog    = uploadProgress[veh.vehicle_id]?.[tipo.key];

                  return (
                    <div key={tipo.key} className="relative">
                      <div className={`aspect-square rounded-lg border-2 overflow-hidden
                        ${file ? 'border-green-400' : 'border-dashed border-neutral-300'}`}>
                        {preview ? (
                          <img src={preview} alt={tipo.label} className="w-full h-full object-cover" />
                        ) : (
                          <div className="w-full h-full bg-neutral-50 flex items-center justify-center">
                            <span className="text-neutral-300 text-2xl">📷</span>
                          </div>
                        )}
                        {prog === 'ok' && (
                          <div className="absolute inset-0 bg-green-500/20 flex items-center justify-center">
                            <span className="text-green-600 text-xl">✓</span>
                          </div>
                        )}
                        {prog === 'error' && (
                          <div className="absolute inset-0 bg-red-500/20 flex items-center justify-center">
                            <span className="text-red-600 text-xl">✕</span>
                          </div>
                        )}
                      </div>
                      <p className="text-center text-xs text-neutral-500 mt-1 leading-tight">
                        {tipo.label}
                      </p>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}

          <button
            onClick={() => setStep('km')}
            disabled={!canProceedFromFotos}
            className="btn-primary w-full py-3"
          >
            Continuar → Kilómetros
          </button>
          {!canProceedFromFotos && (
            <p className="text-xs text-center text-red-500">
              Faltan fotografías por capturar
            </p>
          )}
        </div>
      )}

      {/* ── Paso 2: Kilómetros ── */}
      {step === 'km' && (
        <div className="space-y-4">
          <p className="text-sm text-neutral-600">
            Introduce los kilómetros finales del vehículo al terminar el servicio.
          </p>
          {vehiculos.map(veh => (
            <div key={veh.vehicle_id} className="card">
              <h3 className="font-semibold mb-3">{veh.vehiculo_alias || veh.matricula}</h3>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label text-sm">Km inicio</label>
                  <p className="text-neutral-700 font-medium">
                    {veh.kilometros_inicio?.toLocaleString() || '—'} km
                  </p>
                </div>
                <div>
                  <label className="label text-sm">Km finales <span className="text-red-500">*</span></label>
                  <input
                    type="number"
                    className="input"
                    min={veh.kilometros_inicio || 0}
                    value={kmFinales[veh.vehicle_id]}
                    onChange={e => setKmFinales(k => ({ ...k, [veh.vehicle_id]: e.target.value }))}
                    placeholder={`Mín: ${veh.kilometros_inicio || 0}`}
                  />
                </div>
              </div>
            </div>
          ))}
          <div className="flex gap-3">
            <button onClick={() => setStep('fotos')} className="btn-secondary flex-1">‹ Volver</button>
            <button
              onClick={() => setStep(isAnticipado ? 'motivo' : 'confirm')}
              disabled={!canProceedFromKm}
              className="btn-primary flex-1"
            >
              Continuar
            </button>
          </div>
        </div>
      )}

      {/* ── Paso 3: Motivo (solo si anticipado) ── */}
      {step === 'motivo' && (
        <div className="space-y-4">
          <div className="p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
            <p className="text-yellow-800 text-sm">
              ⚠ Estás finalizando el trabajo antes de la fecha prevista.
              Por favor, indica el motivo.
            </p>
          </div>
          <div>
            <label className="label">Motivo de finalización anticipada <span className="text-red-500">*</span></label>
            <textarea
              className="input min-h-28 resize-none"
              value={motivo}
              onChange={e => setMotivo(e.target.value)}
              placeholder="Describe el motivo por el que se finaliza el trabajo antes de lo previsto..."
            />
          </div>
          <div className="flex gap-3">
            <button onClick={() => setStep('km')} className="btn-secondary flex-1">‹ Volver</button>
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

      {/* ── Paso 4: Confirmación ── */}
      {step === 'confirm' && (
        <div className="space-y-4">
          <div className="card space-y-3">
            <h3 className="font-semibold">Resumen de finalización</h3>
            <div className="divide-y divide-neutral-100">
              {vehiculos.map(veh => (
                <div key={veh.vehicle_id} className="py-3">
                  <p className="font-medium text-sm">{veh.vehiculo_alias} ({veh.matricula})</p>
                  <p className="text-xs text-neutral-500">
                    Km inicio: {veh.kilometros_inicio || '—'} →
                    Km fin: {kmFinales[veh.vehicle_id]}
                  </p>
                  <div className="flex gap-1 mt-1 flex-wrap">
                    {IMAGEN_TIPOS.map(t => (
                      <span key={t.key} className={`badge text-xs ${evidencias[veh.vehicle_id]?.[t.key] ? 'badge-green' : 'badge-red'}`}>
                        {t.label.split(' ')[0]}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            {isAnticipado && motivo && (
              <div className="bg-yellow-50 rounded-lg p-3">
                <p className="text-xs font-medium text-yellow-800">Motivo:</p>
                <p className="text-sm text-yellow-700 mt-1">{motivo}</p>
              </div>
            )}
          </div>

          <div className="flex gap-3">
            <button onClick={() => setStep(isAnticipado ? 'motivo' : 'km')} className="btn-secondary flex-1" disabled={uploading}>
              ‹ Volver
            </button>
            <button onClick={handleFinalizar} className="btn-primary flex-1" disabled={uploading}>
              {uploading ? (
                <span className="flex items-center gap-2">
                  <span className="w-4 h-4 spinner" /> Finalizando...
                </span>
              ) : '✓ Finalizar trabajo'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
