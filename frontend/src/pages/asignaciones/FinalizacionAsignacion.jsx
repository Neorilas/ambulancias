import React, { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { asignacionesService } from '../../services/asignaciones.service.js';
import { useNotification } from '../../context/NotificationContext.jsx';
import { IMAGEN_TIPOS } from '../../utils/constants.js';
import { formatDateTime } from '../../utils/dateUtils.js';

/**
 * Flujo de finalización de asignación libre:
 * Paso 1: 6 fotos + km fin
 * Paso 2: Motivo (solo si anticipada)
 * Paso 3: Confirmar y enviar
 */
export default function FinalizacionAsignacion({ asignacion, onDone, onCancel }) {
  const { notify }  = useNotification();
  const navigate    = useNavigate();
  const isAnticipada = new Date() < new Date(asignacion?.fecha_fin);

  const [step,     setStep]    = useState('fotos');
  const [fotos,    setFotos]   = useState({});         // { [tipo.key]: File }
  const [kmFin,    setKmFin]   = useState('');
  const [motivo,   setMotivo]  = useState('');
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState({});

  const fileInputRefs = useRef({});

  const handleFileChange = (tipoKey, e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFotos(prev => ({ ...prev, [tipoKey]: file }));
  };

  const canProceedFotos = () =>
    IMAGEN_TIPOS.every(t => fotos[t.key]) && kmFin !== '';

  // ── Paso fotos ──────────────────────────────────────────────
  if (step === 'fotos') {
    return (
      <div className="space-y-6">
        <div>
          <h2 className="text-lg font-semibold text-neutral-900 mb-1">
            Finalizar asignación — {asignacion.matricula}
          </h2>
          <p className="text-sm text-neutral-500">
            {asignacion.vehiculo_alias && `${asignacion.vehiculo_alias} · `}
            Hasta {formatDateTime(asignacion.fecha_fin)}
            {isAnticipada && (
              <span className="ml-2 text-amber-600 font-medium">⚠ Finalización anticipada</span>
            )}
          </p>
        </div>

        {/* Grid de fotos */}
        <div className="grid grid-cols-2 gap-3">
          {IMAGEN_TIPOS.map(tipo => {
            const file = fotos[tipo.key];
            const preview = file ? URL.createObjectURL(file) : null;
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
                    <div className="flex flex-col items-center justify-center h-full gap-2 text-neutral-300">
                      <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
                      </svg>
                      <span className="text-xs text-neutral-400 text-center px-2">{tipo.instruccion}</span>
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

        {/* Km fin */}
        <div>
          <label className="label">Kilómetros finales <span className="text-red-500">*</span></label>
          <input
            type="number"
            min={asignacion.km_inicio || 0}
            className="input"
            placeholder={asignacion.km_inicio ? `Mín. ${asignacion.km_inicio}` : 'Introduce los km actuales'}
            value={kmFin}
            onChange={e => setKmFin(e.target.value)}
          />
          {asignacion.km_inicio != null && (
            <p className="text-xs text-neutral-400 mt-1">Km inicio: {asignacion.km_inicio.toLocaleString()} km</p>
          )}
        </div>

        {/* Botones */}
        <div className="flex gap-3">
          <button onClick={onCancel} className="btn-secondary flex-1">Cancelar</button>
          <button
            onClick={() => setStep(isAnticipada ? 'motivo' : 'confirm')}
            disabled={!canProceedFotos()}
            className="btn-primary flex-1"
          >
            Siguiente →
          </button>
        </div>
      </div>
    );
  }

  // ── Paso motivo ─────────────────────────────────────────────
  if (step === 'motivo') {
    return (
      <div className="space-y-6">
        <div>
          <h2 className="text-lg font-semibold text-neutral-900 mb-1">Motivo de finalización anticipada</h2>
          <p className="text-sm text-amber-600">
            El plazo asignado termina el {formatDateTime(asignacion.fecha_fin)}.
            Estás finalizando antes de esa fecha.
          </p>
        </div>
        <div>
          <label className="label">Motivo <span className="text-red-500">*</span></label>
          <textarea
            className="input resize-none"
            rows={5}
            placeholder="Explica el motivo por el que finalizas la asignación antes de lo previsto"
            value={motivo}
            onChange={e => setMotivo(e.target.value)}
          />
        </div>
        <div className="flex gap-3">
          <button onClick={() => setStep('fotos')} className="btn-secondary flex-1">← Atrás</button>
          <button
            onClick={() => setStep('confirm')}
            disabled={!motivo.trim()}
            className="btn-primary flex-1"
          >
            Siguiente →
          </button>
        </div>
      </div>
    );
  }

  // ── Paso confirmar ──────────────────────────────────────────
  const handleFinalizar = async () => {
    setUploading(true);
    try {
      // 1. Subir todas las fotos
      for (const tipo of IMAGEN_TIPOS) {
        const file = fotos[tipo.key];
        if (!file) continue;
        setUploadProgress(p => ({ ...p, [tipo.key]: 'Subiendo…' }));
        const fd = new FormData();
        fd.append('image', file);
        fd.append('tipo_imagen', tipo.key);
        await asignacionesService.uploadEvidencia(asignacion.id, fd);
        setUploadProgress(p => ({ ...p, [tipo.key]: '✓' }));
      }

      // 2. Finalizar
      await asignacionesService.finalizar(asignacion.id, {
        km_fin:     kmFin !== '' ? parseInt(kmFin) : null,
        motivo_fin: motivo || null,
      });

      notify.success('Asignación finalizada correctamente');
      onDone?.();
    } catch (err) {
      notify.error(err.response?.data?.message || err.message);
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="space-y-6">
      <h2 className="text-lg font-semibold text-neutral-900">Confirmar finalización</h2>

      <div className="card bg-neutral-50 space-y-3 text-sm">
        <div className="flex justify-between">
          <span className="text-neutral-500">Vehículo</span>
          <span className="font-medium">{asignacion.matricula}{asignacion.vehiculo_alias ? ` · ${asignacion.vehiculo_alias}` : ''}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-neutral-500">Km finales</span>
          <span className="font-medium">{kmFin ? `${parseInt(kmFin).toLocaleString()} km` : '—'}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-neutral-500">Fotos</span>
          <span className="font-medium text-green-600">{IMAGEN_TIPOS.length}/{IMAGEN_TIPOS.length} ✓</span>
        </div>
        {motivo && (
          <div>
            <span className="text-neutral-500 block mb-1">Motivo anticipado</span>
            <p className="text-neutral-700 italic">{motivo}</p>
          </div>
        )}
      </div>

      <div className="flex gap-3">
        <button onClick={() => setStep(isAnticipada ? 'motivo' : 'fotos')} className="btn-secondary flex-1" disabled={uploading}>
          ← Atrás
        </button>
        <button onClick={handleFinalizar} className="btn-primary flex-1" disabled={uploading}>
          {uploading ? 'Enviando…' : '✓ Confirmar finalización'}
        </button>
      </div>
    </div>
  );
}
