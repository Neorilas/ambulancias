import React, { useState, useRef, useEffect, useMemo } from 'react';
import { asignacionesService } from '../../services/asignaciones.service.js';
import { useNotification } from '../../context/NotificationContext.jsx';
import CameraCapture from '../../components/camera/CameraCapture.jsx';
import { IMAGEN_TIPOS_INICIO } from '../../utils/constants.js';

/**
 * Flujo de INICIO de asignación libre — fotos al recibir el vehículo.
 * · 6 fotos obligatorias (4 walk-around + aceite + líquidos).
 * · NO pide km ni motivo.
 *
 * Props:
 *   asignacion  — asignación con progreso.inicio
 *   onDone()
 *   onCancel()
 */
export default function InicioAsignacion({ asignacion, onDone, onCancel }) {
  const { notify } = useNotification();

  const [showCamera,     setShowCamera]     = useState(false);
  const [fotos,          setFotos]          = useState({});
  const [uploading,      setUploading]      = useState(false);
  const [uploadProgress, setUploadProgress] = useState({});

  const fileInputRefs = useRef({});

  const previews = useMemo(() => {
    const map = {};
    for (const [tipo, file] of Object.entries(fotos)) {
      if (file) map[tipo] = URL.createObjectURL(file);
    }
    return map;
  }, [fotos]);

  useEffect(() => {
    return () => {
      for (const url of Object.values(previews)) URL.revokeObjectURL(url);
    };
  }, [previews]);

  const handleCameraComplete = (captures) => {
    setShowCamera(false);
    const next = { ...fotos };
    captures.forEach(c => { next[c.tipo] = c.file; });
    setFotos(next);
  };

  const handleFileChange = (tipoKey, e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFotos(prev => ({ ...prev, [tipoKey]: file }));
    e.target.value = '';
  };

  const done     = IMAGEN_TIPOS_INICIO.filter(t => fotos[t.key]).length;
  const total    = IMAGEN_TIPOS_INICIO.length;
  const canSubmit = done === total;

  const handleSubmit = async () => {
    setUploading(true);
    try {
      for (const tipo of IMAGEN_TIPOS_INICIO) {
        const file = fotos[tipo.key];
        if (!file) continue;
        setUploadProgress(p => ({ ...p, [tipo.key]: 'Subiendo…' }));
        const fd = new FormData();
        fd.append('image',       file);
        fd.append('tipo_imagen', tipo.key);
        fd.append('momento',     'inicio');
        await asignacionesService.uploadEvidencia(asignacion.id, fd);
        setUploadProgress(p => ({ ...p, [tipo.key]: '✓' }));
      }
      notify.success('Fotos de inicio guardadas');
      onDone?.();
    } catch (err) {
      notify.error(err.response?.data?.message || err.message || 'Error al subir fotos');
    } finally {
      setUploading(false);
    }
  };

  if (showCamera) {
    return (
      <CameraCapture
        tipos={IMAGEN_TIPOS_INICIO}
        onComplete={handleCameraComplete}
        onCancel={() => setShowCamera(false)}
        initialIndex={0}
      />
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-neutral-900 mb-1">
          Fotos de inicio — {asignacion.matricula}
        </h2>
        <p className="text-sm text-neutral-500">
          {asignacion.vehiculo_alias && `${asignacion.vehiculo_alias} · `}
          Antes de usar el vehículo, documenta su estado.
        </p>
      </div>

      <div className="card bg-primary-50 border border-primary-200">
        <p className="text-primary-800 font-medium text-sm">📸 Antes de empezar</p>
        <p className="text-primary-700 text-xs mt-1">
          Sube las {total} fotos obligatorias: 4 del contorno del vehículo,
          nivel de aceite y resto de líquidos. Sin esto no podrás finalizar la asignación.
        </p>
      </div>

      <div className="flex items-center justify-between">
        <button onClick={() => setShowCamera(true)} className="btn-secondary text-sm">
          📷 Cámara guiada
        </button>
        <span className="text-xs text-neutral-500">{done}/{total} fotos</span>
      </div>

      <div className="grid grid-cols-2 gap-3">
        {IMAGEN_TIPOS_INICIO.map(tipo => {
          const file    = fotos[tipo.key];
          const preview = previews[tipo.key];
          return (
            <div key={tipo.key} className="space-y-1">
              <p className="text-xs font-medium text-neutral-600">{tipo.label}</p>
              <div
                className={`relative aspect-[4/3] rounded-xl overflow-hidden border-2 cursor-pointer transition-colors
                  ${file ? 'border-green-400 bg-green-50' : 'border-dashed border-neutral-300 bg-neutral-50 hover:border-primary-400'}`}
                onClick={() => fileInputRefs.current[tipo.key]?.click()}
              >
                {preview ? (
                  <img src={preview} alt={tipo.label} className="w-full h-full object-cover" />
                ) : (
                  <div className="flex flex-col items-center justify-center h-full gap-2 text-neutral-300 p-2">
                    <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
                    </svg>
                    <span className="text-xs text-neutral-400 text-center">{tipo.instruccion}</span>
                  </div>
                )}
                {file && (
                  <div className="absolute top-1 right-1 w-6 h-6 bg-green-500 rounded-full flex items-center justify-center shadow">
                    <svg className="w-4 h-4 text-white" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                    </svg>
                  </div>
                )}
                <input
                  ref={el => { fileInputRefs.current[tipo.key] = el; }}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={e => handleFileChange(tipo.key, e)}
                />
              </div>
              {uploadProgress[tipo.key] && (
                <p className="text-xs text-primary-600">{uploadProgress[tipo.key]}</p>
              )}
            </div>
          );
        })}
      </div>

      <div className="flex gap-3">
        <button onClick={onCancel} className="btn-secondary flex-1" disabled={uploading}>
          Cancelar
        </button>
        <button onClick={handleSubmit} disabled={!canSubmit || uploading} className="btn-primary flex-1">
          {uploading ? 'Subiendo…' : '✓ Guardar fotos de inicio'}
        </button>
      </div>
    </div>
  );
}
