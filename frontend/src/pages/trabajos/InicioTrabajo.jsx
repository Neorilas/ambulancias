import React, { useState, useRef, useEffect, useMemo } from 'react';
import { trabajosService } from '../../services/trabajos.service.js';
import { useNotification } from '../../context/NotificationContext.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import CameraCapture from '../../components/camera/CameraCapture.jsx';
import { IMAGEN_TIPOS_INICIO } from '../../utils/constants.js';

/**
 * Flujo de INICIO de trabajo — fotos al empezar / al recibir el vehículo.
 * · 6 fotos obligatorias por vehículo (4 walk-around + aceite + líquidos).
 * · NO pide km ni motivo.
 * · Sólo muestra los vehículos sobre los que el usuario es responsable
 *   (los admin/gestor ven todos).
 *
 * Props:
 *   trabajo                            — trabajo completo (con vehiculos[])
 *   vehicleIdFilter (opcional)         — sólo procesar este vehicle_id
 *   onDone()
 *   onCancel()
 */
export default function InicioTrabajo({ trabajo, vehicleIdFilter, onDone, onCancel }) {
  const { notify }                  = useNotification();
  const { user, canManageTrabajos } = useAuth();

  const todosVehiculos = trabajo?.vehiculos || [];
  let vehiculos = canManageTrabajos()
    ? todosVehiculos
    : todosVehiculos.filter(v => v.responsable_user_id === user?.id);

  if (vehicleIdFilter) {
    vehiculos = vehiculos.filter(v => v.vehicle_id === vehicleIdFilter);
  }

  // Solo procesar vehículos que NO tengan aún inicio completo
  vehiculos = vehiculos.filter(v => !v.progreso_fotos?.inicio?.completo);

  const [currentVehIdx, setCurrentVehIdx] = useState(0);
  const [showCamera,    setShowCamera]    = useState(false);
  const [uploading,     setUploading]     = useState(false);
  const [uploadProgress, setUploadProgress] = useState({});

  // Mapa: vehicle_id → { [tipo]: File }
  const [evidencias, setEvidencias] = useState(() => {
    const map = {};
    vehiculos.forEach(v => { map[v.vehicle_id] = {}; });
    return map;
  });

  const fileInputRefs = useRef({});
  const currentVeh    = vehiculos[currentVehIdx];

  // Previews con cleanup
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

  const handleFileChange = (vehicleId, tipoKey, e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setEvidencias(prev => {
      const next = { ...prev };
      if (!next[vehicleId]) next[vehicleId] = {};
      next[vehicleId][tipoKey] = file;
      return next;
    });
    e.target.value = '';
  };

  const fotosPorVeh = (vid) =>
    IMAGEN_TIPOS_INICIO.filter(t => evidencias[vid]?.[t.key]).length;

  const canSubmit = vehiculos.length > 0 && vehiculos.every(v =>
    IMAGEN_TIPOS_INICIO.every(t => evidencias[v.vehicle_id]?.[t.key])
  );

  const handleSubmit = async () => {
    setUploading(true);
    try {
      for (const veh of vehiculos) {
        for (const tipo of IMAGEN_TIPOS_INICIO) {
          const file = evidencias[veh.vehicle_id]?.[tipo.key];
          if (!file) continue;

          const fd = new FormData();
          fd.append('image',       file);
          fd.append('vehicle_id',  veh.vehicle_id);
          fd.append('tipo_imagen', tipo.key);
          fd.append('momento',     'inicio');

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
      notify.success('Fotos de inicio guardadas correctamente');
      onDone?.();
    } catch (err) {
      notify.error(err.response?.data?.message || err.message || 'Error al subir fotos de inicio');
    } finally {
      setUploading(false);
    }
  };

  if (showCamera && currentVeh) {
    return (
      <CameraCapture
        tipos={IMAGEN_TIPOS_INICIO}
        onComplete={handleCameraComplete}
        onCancel={() => setShowCamera(false)}
        initialIndex={0}
      />
    );
  }

  if (vehiculos.length === 0) {
    return (
      <div className="space-y-4 animate-fade-in">
        <div className="flex items-center gap-3">
          <button onClick={onCancel} className="btn-ghost btn-icon">‹</button>
          <h2 className="text-lg font-bold text-neutral-900">Fotos de inicio</h2>
        </div>
        <div className="card bg-green-50 border border-green-200">
          <p className="text-green-700 font-medium">✓ Inicio ya registrado</p>
          <p className="text-green-600 text-sm mt-1">
            Todas las fotos de inicio están subidas para tus vehículos en este trabajo.
          </p>
        </div>
        <button onClick={onCancel} className="btn-secondary w-full">Volver</button>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fade-in pb-10">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button onClick={onCancel} className="btn-ghost btn-icon">‹</button>
        <div>
          <h2 className="text-lg font-bold text-neutral-900">Fotos de inicio</h2>
          <p className="text-sm text-neutral-500">{trabajo?.nombre}</p>
        </div>
      </div>

      <div className="card bg-primary-50 border border-primary-200">
        <p className="text-primary-800 font-medium text-sm">📸 Antes de empezar</p>
        <p className="text-primary-700 text-xs mt-1">
          Sube las {IMAGEN_TIPOS_INICIO.length} fotos obligatorias de cada vehículo:
          4 del contorno del vehículo, nivel de aceite y resto de líquidos.
          Sin esto no podrás finalizar el trabajo.
        </p>
      </div>

      {vehiculos.map((veh, vi) => {
        const done  = fotosPorVeh(veh.vehicle_id);
        const total = IMAGEN_TIPOS_INICIO.length;
        return (
          <div key={veh.vehicle_id} className="card space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-semibold">{veh.vehiculo_alias || veh.matricula}</h3>
                <p className="text-xs text-neutral-500">{veh.matricula}</p>
              </div>
              <button
                onClick={() => { setCurrentVehIdx(vi); setShowCamera(true); }}
                className="btn-secondary text-sm"
              >
                📷 Cámara guiada
              </button>
            </div>

            <p className="text-xs text-neutral-500">
              Toca cada foto para seleccionar desde <strong>galería o cámara</strong>,
              o usa <strong>Cámara guiada</strong> para el recorrido completo.
            </p>

            <div className="grid grid-cols-3 gap-2">
              {IMAGEN_TIPOS_INICIO.map(tipo => {
                const file    = evidencias[veh.vehicle_id]?.[tipo.key];
                const preview = previews[veh.vehicle_id]?.[tipo.key] || null;
                const prog    = uploadProgress[veh.vehicle_id]?.[tipo.key];
                const refKey  = `${veh.vehicle_id}_${tipo.key}`;

                return (
                  <div key={tipo.key}>
                    <input
                      ref={el => { fileInputRefs.current[refKey] = el; }}
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={e => handleFileChange(veh.vehicle_id, tipo.key, e)}
                    />
                    <button
                      type="button"
                      onClick={() => fileInputRefs.current[refKey]?.click()}
                      className="w-full text-left"
                    >
                      <div className={`aspect-square rounded-lg border-2 overflow-hidden relative
                        ${file ? 'border-green-400' : 'border-dashed border-neutral-300 hover:border-primary-400'}`}>
                        {preview ? (
                          <img src={preview} alt={tipo.label} className="w-full h-full object-cover" />
                        ) : (
                          <div className="w-full h-full bg-neutral-50 flex flex-col items-center justify-center gap-1">
                            <span className="text-neutral-300 text-xl">📷</span>
                            <span className="text-neutral-400 text-[10px] text-center px-1 leading-tight">
                              {tipo.label.split(' ')[0]}
                            </span>
                          </div>
                        )}
                        {prog === 'ok' && (
                          <div className="absolute inset-0 bg-green-500/20 flex items-center justify-center">
                            <span className="text-green-600 text-2xl">✓</span>
                          </div>
                        )}
                        {prog === 'error' && (
                          <div className="absolute inset-0 bg-red-500/20 flex items-center justify-center">
                            <span className="text-red-600 text-2xl">✕</span>
                          </div>
                        )}
                      </div>
                      <p className="text-center text-[10px] text-neutral-500 mt-0.5 leading-tight">
                        {tipo.label}{file && <span className="text-green-600"> ✓</span>}
                      </p>
                    </button>
                  </div>
                );
              })}
            </div>

            <div className="flex items-center gap-2">
              <div className="flex-1 h-1.5 bg-neutral-100 rounded-full overflow-hidden">
                <div
                  className="h-full bg-primary-500 rounded-full transition-all"
                  style={{ width: `${(done / total) * 100}%` }}
                />
              </div>
              <span className="text-xs text-neutral-500 shrink-0">{done}/{total} fotos</span>
            </div>
          </div>
        );
      })}

      <button
        onClick={handleSubmit}
        disabled={!canSubmit || uploading}
        className="btn-primary w-full py-3"
      >
        {uploading ? (
          <span className="flex items-center justify-center gap-2">
            <span className="w-4 h-4 spinner" /> Subiendo fotos...
          </span>
        ) : '✓ Guardar fotos de inicio'}
      </button>
      {!canSubmit && (
        <p className="text-xs text-center text-red-500">
          Completa las {IMAGEN_TIPOS_INICIO.length} fotos de cada vehículo
        </p>
      )}
    </div>
  );
}
