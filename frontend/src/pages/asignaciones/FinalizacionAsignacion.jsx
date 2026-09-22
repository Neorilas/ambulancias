import React, { useState, useMemo, useEffect } from 'react';
import { asignacionesService } from '../../services/asignaciones.service.js';
import { useNotification } from '../../context/NotificationContext.jsx';
import CameraCapture from '../../components/camera/CameraCapture.jsx';
import { formatDateTime } from '../../utils/dateUtils.js';
import { parseKm } from '../../utils/kmUtils.js';
import {
  IMAGEN_TIPOS_FIN,
  IMAGEN_TIPOS_FIN_EXTERIOR,
  IMAGEN_TIPO_CUENTAKILOMETROS,
} from '../../utils/constants.js';

/**
 * Wizard de CIERRE de servicio — coherente con el de inicio.
 *
 * Secciones (SECCIONES, extensible igual que en InicioAsignacion):
 *   1. material — material gastado en el servicio (obligatorio)
 *   2. exterior — 4 caras del vehículo (orden libre)
 *   3. km       — foto del cuadro + kilómetros finales
 *   4. motivo   — solo si la finalización es anticipada
 *   5. confirm  — resumen y envío
 *
 * El material va primero, antes de las fotos de fin: decisión de negocio.
 *
 * Al confirmar sube las fotos de fin (momento='fin') y llama a /finalizar.
 *
 * Props: asignacion (con progreso.inicio), onDone(), onCancel()
 */
export default function FinalizacionAsignacion({ asignacion, onDone, onCancel }) {
  const { notify } = useNotification();
  const isAnticipada = new Date() < new Date(asignacion?.fecha_fin);

  const [step,   setStep]   = useState(0);
  const [fotos,  setFotos]  = useState({});   // { tipoKey: File } (fin)
  const [kmFin,  setKmFin]  = useState('');
  const [motivo, setMotivo] = useState('');
  const [material, setMaterial] = useState('');
  const [uploading, setUploading] = useState(false);
  const [progress,  setProgress]  = useState({});
  // Fotos ya subidas, guardadas por File. Si el cierre falla a mitad (red mala,
  // 429) el reintento manda sólo las que faltan; y si el técnico repite una
  // foto, el File es otro y vuelve a subirse.
  const [subidas,   setSubidas]   = useState({});

  // Cámara
  const [showCamera, setShowCamera] = useState(false);
  const [camTipos,   setCamTipos]   = useState([]);
  const [camIndex,   setCamIndex]   = useState(0);

  // Previews
  const previews = useMemo(() => {
    const map = {};
    for (const [k, f] of Object.entries(fotos)) if (f) map[k] = URL.createObjectURL(f);
    return map;
  }, [fotos]);
  useEffect(() => () => Object.values(previews).forEach(URL.revokeObjectURL), [previews]);

  // ── Secciones (motivo condicional) ──────────────────────────
  const secciones = useMemo(() => {
    const base = [
      { id: 'material', tipo: 'material', titulo: 'Material utilizado',
        subtitulo: 'Qué se ha gastado durante el servicio' },
      { id: 'exterior', tipo: 'photos', titulo: 'Estado exterior',
        subtitulo: 'Las cuatro caras del vehículo (orden libre)', fotos: IMAGEN_TIPOS_FIN_EXTERIOR },
      { id: 'km', tipo: 'km', titulo: 'Kilometraje',
        subtitulo: 'Foto del cuadro y kilómetros finales' },
    ];
    if (isAnticipada) base.push({ id: 'motivo', tipo: 'motivo', titulo: 'Motivo de finalización anticipada' });
    base.push({ id: 'confirm', tipo: 'confirm', titulo: 'Confirmar finalización' });
    return base;
  }, [isAnticipada]);

  const seccion = secciones[step];

  // ── Cámara ──────────────────────────────────────────────────
  const openCamera = (tipos, index) => { setCamTipos(tipos); setCamIndex(index); setShowCamera(true); };
  const handleCameraComplete = (captures) => {
    setShowCamera(false);
    setFotos(prev => {
      const next = { ...prev };
      captures.forEach(c => { next[c.tipo] = c.file; });
      return next;
    });
  };

  // ── Bloqueo: inicio incompleto ──────────────────────────────
  const inicioIncompleto = asignacion?.progreso?.inicio && !asignacion.progreso.inicio.completo;
  if (inicioIncompleto) {
    return (
      <div className="space-y-4">
        <h2 className="text-lg font-semibold text-neutral-900">Finalizar servicio</h2>
        <div className="card bg-warn-50 border border-warn-200 space-y-2">
          <p className="text-warn-700 font-medium">Faltan las fotos de inicio</p>
          <p className="text-warn-600 text-sm">
            No puedes finalizar hasta completar la revisión de inicio
            ({asignacion.progreso.inicio.completado}/{asignacion.progreso.inicio.total} fotos).
          </p>
          <p className="text-warn-600 text-xs">
            Cierra esta ventana y pulsa <strong>"Inicio de servicio"</strong> en el detalle.
          </p>
        </div>
        <button onClick={onCancel} className="btn-secondary w-full">Volver</button>
      </div>
    );
  }

  // ── Envío final ─────────────────────────────────────────────
  const handleFinalizar = async () => {
    setUploading(true);
    try {
      for (const tipo of IMAGEN_TIPOS_FIN) {
        const file = fotos[tipo.key];
        if (!file) continue;
        if (subidas[tipo.key] === file) continue;   // ya está en el servidor
        setProgress(p => ({ ...p, [tipo.key]: 'Subiendo…' }));
        const fd = new FormData();
        fd.append('image', file);
        fd.append('tipo_imagen', tipo.key);
        fd.append('momento', 'fin');
        await asignacionesService.uploadEvidencia(asignacion.id, fd);
        setSubidas(s => ({ ...s, [tipo.key]: file }));
        setProgress(p => ({ ...p, [tipo.key]: 'Subida' }));
      }
      await asignacionesService.finalizar(asignacion.id, {
        km_fin:     parseKm(kmFin),
        motivo_fin: motivo || null,
        material_usado: material.trim(),
      });
      notify.success('Servicio finalizado correctamente');
      onDone?.();
    } catch (err) {
      notify.error(err.response?.data?.message || err.message);
    } finally {
      setUploading(false);
    }
  };

  // ── Cámara a pantalla completa ──────────────────────────────
  if (showCamera) {
    return (
      <CameraCapture
        tipos={camTipos}
        onComplete={handleCameraComplete}
        onCancel={() => setShowCamera(false)}
        initialIndex={camIndex}
      />
    );
  }

  // ── Cabecera con progreso ───────────────────────────────────
  const Header = () => (
    <div className="space-y-3">
      <div className="flex items-center gap-1.5">
        {secciones.map((s, i) => (
          <div key={s.id} className={`h-1.5 flex-1 rounded-full transition-colors ${
            i < step ? 'bg-ok-500' : i === step ? 'bg-primary-500' : 'bg-neutral-200'
          }`} />
        ))}
      </div>
      <div>
        <p className="text-xs text-neutral-400">
          Paso {step + 1} de {secciones.length} — {asignacion.vehiculo_alias}
          {isAnticipada && <span className="ml-2 text-warn-600 font-medium">Anticipada</span>}
        </p>
        <h2 className="text-lg font-semibold text-neutral-900">{seccion.titulo}</h2>
        {seccion.subtitulo && <p className="text-sm text-neutral-500">{seccion.subtitulo}</p>}
      </div>
    </div>
  );

  // En el primer paso «volver» es salir del asistente; en los demás, retroceder.
  const BotonVolver = () => step === 0
    ? <button onClick={onCancel} className="btn-secondary flex-1">Cancelar</button>
    : <button onClick={() => setStep(step - 1)} className="btn-secondary flex-1">← Atrás</button>;

  // ── Sección: fotos exteriores ───────────────────────────────
  if (seccion.tipo === 'photos') {
    const tipos = seccion.fotos;
    const done  = tipos.filter(t => fotos[t.key]).length;
    const completa = done === tipos.length;
    return (
      <div className="space-y-6">
        <Header />
        <div className="flex items-center justify-between">
          <button onClick={() => openCamera(tipos, 0)} className="btn-secondary text-sm">Cámara guiada</button>
          <span className="text-xs text-neutral-500">{done}/{tipos.length} fotos</span>
        </div>
        <div className="grid grid-cols-2 gap-3">
          {tipos.map((tipo, index) => {
            const file = fotos[tipo.key];
            const preview = previews[tipo.key];
            return (
              <div key={tipo.key} className="space-y-1">
                <p className="text-xs font-medium text-neutral-600">{tipo.label}</p>
                <div
                  className={`relative aspect-[4/3] rounded-xl overflow-hidden border-2 cursor-pointer transition-colors
                    ${file ? 'border-ok-500 bg-ok-50' : 'border-dashed border-neutral-300 bg-neutral-50 hover:border-primary-400'}`}
                  onClick={() => openCamera(tipos, index)}
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
                    <div className="absolute top-1 right-1 w-6 h-6 bg-ok-500 rounded-full flex items-center justify-center shadow">
                      <svg className="w-4 h-4 text-white" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                      </svg>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
        <div className="flex gap-3">
          <BotonVolver />
          <button onClick={() => setStep(step + 1)} disabled={!completa} className="btn-primary flex-1">Siguiente →</button>
        </div>
      </div>
    );
  }

  // ── Sección: kilometraje (foto cuadro + km) ─────────────────
  if (seccion.tipo === 'km') {
    const ckm = IMAGEN_TIPO_CUENTAKILOMETROS;
    const file = fotos[ckm.key];
    const preview = previews[ckm.key];
    // El mínimo real es el mayor entre el km de inicio de ESTA asignación y el
    // km actual del vehículo (puede haber avanzado por otra asignación desde
    // entonces): bajarlo de ahí lo rechaza el backend, y aquí se avisa antes.
    const kmMinimo = Math.max(asignacion.km_inicio || 0, asignacion.vehiculo_km_actual || 0);
    const kmFinParsed = parseKm(kmFin);
    const kmPorDebajoDelMinimo = kmFinParsed != null && kmFinParsed < kmMinimo;
    const puedeSeguir = !!file && kmFinParsed != null && !kmPorDebajoDelMinimo;
    return (
      <div className="space-y-6">
        <Header />
        <div>
          <p className="text-xs font-medium text-neutral-600 mb-1">{ckm.label}</p>
          <div
            className={`relative aspect-[4/3] rounded-xl overflow-hidden border-2 cursor-pointer transition-colors
              ${file ? 'border-ok-500 bg-ok-50' : 'border-dashed border-neutral-300 bg-neutral-50 hover:border-primary-400'}`}
            onClick={() => openCamera([ckm], 0)}
          >
            {preview ? (
              <img src={preview} alt={ckm.label} className="w-full h-full object-cover" />
            ) : (
              <div className="flex flex-col items-center justify-center h-full gap-2 text-neutral-300 p-2">
                <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
                <span className="text-xs text-neutral-400 text-center">{ckm.instruccion}</span>
              </div>
            )}
          </div>
        </div>
        <div>
          <label className="label">Kilómetros finales <span className="text-bad-500">*</span></label>
          <input
            type="number" min={kmMinimo || 0} className={`input ${kmPorDebajoDelMinimo ? 'input-error' : ''}`}
            placeholder={kmMinimo ? `Mín. ${kmMinimo}` : 'Introduce los km actuales'}
            value={kmFin} onChange={e => setKmFin(e.target.value)}
          />
          {kmPorDebajoDelMinimo ? (
            <p className="field-error">
              No puede ser menor que los km actuales del vehículo ({kmMinimo.toLocaleString()} km)
            </p>
          ) : asignacion.km_inicio != null && (
            <p className="text-xs text-neutral-400 mt-1">Km inicio: {asignacion.km_inicio.toLocaleString()} km</p>
          )}
        </div>
        <div className="flex gap-3">
          <button onClick={() => setStep(step - 1)} className="btn-secondary flex-1">← Atrás</button>
          <button onClick={() => setStep(step + 1)} disabled={!puedeSeguir} className="btn-primary flex-1">Siguiente →</button>
        </div>
      </div>
    );
  }

  // ── Sección: motivo (anticipada) ────────────────────────────
  if (seccion.tipo === 'motivo') {
    return (
      <div className="space-y-6">
        <Header />
        <p className="text-sm text-warn-600">
          El plazo termina el {formatDateTime(asignacion.fecha_fin)}. Estás finalizando antes de esa fecha.
        </p>
        <div>
          <label className="label">Motivo <span className="text-bad-500">*</span></label>
          <textarea
            className="input resize-none" rows={5}
            placeholder="Explica el motivo por el que finalizas antes de lo previsto"
            value={motivo} onChange={e => setMotivo(e.target.value)}
          />
        </div>
        <div className="flex gap-3">
          <button onClick={() => setStep(step - 1)} className="btn-secondary flex-1">← Atrás</button>
          <button onClick={() => setStep(step + 1)} disabled={!motivo.trim()} className="btn-primary flex-1">Siguiente →</button>
        </div>
      </div>
    );
  }

  // ── Sección: material utilizado ─────────────────────────────
  // Obligatoria siempre. El texto libre es a propósito: el material de una
  // ambulancia no cabe en una lista cerrada, y lo que se busca es que quede
  // por escrito qué se gastó en ESTE servicio. Por eso se pide también cuando
  // no se gastó nada — «Sin gasto de material» dice que se revisó; un campo en
  // blanco no dice nada.
  if (seccion.tipo === 'material') {
    return (
      <div className="space-y-6">
        <Header />
        <div className="card bg-primary-50 border border-primary-200">
          <p className="text-sm text-primary-800">
            Anota el material que has utilizado durante el servicio.
            <strong className="block mt-1">
              Si no has utilizado nada, escribe «Sin gasto de material».
            </strong>
          </p>
        </div>
        <div>
          <label className="label">Material utilizado <span className="text-bad-500">*</span></label>
          <textarea
            className="input resize-none" rows={5}
            placeholder="Ej.: 2 mascarillas, 1 vía periférica, 500 ml suero fisiológico — o «Sin gasto de material»"
            value={material} onChange={e => setMaterial(e.target.value)}
          />
        </div>
        <div className="flex gap-3">
          <BotonVolver />
          <button onClick={() => setStep(step + 1)} disabled={!material.trim()} className="btn-primary flex-1">Siguiente →</button>
        </div>
      </div>
    );
  }

  // ── Sección: confirmar ──────────────────────────────────────
  return (
    <div className="space-y-6">
      <Header />
      <div className="card bg-neutral-50 space-y-3 text-sm">
        <div className="flex justify-between">
          <span className="text-neutral-500">Vehículo</span>
          <span className="font-medium">
            {asignacion.vehiculo_alias}
            <span className="data font-normal text-neutral-500 ml-2">{asignacion.matricula}</span>
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-neutral-500">Km finales</span>
          <span className="font-medium">{parseKm(kmFin) != null ? `${parseKm(kmFin).toLocaleString()} km` : '—'}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-neutral-500">Fotos</span>
          <span className="font-medium data text-ok-600">
            {IMAGEN_TIPOS_FIN.filter(t => fotos[t.key]).length} / {IMAGEN_TIPOS_FIN.length}
          </span>
        </div>
        {motivo && (
          <div>
            <span className="text-neutral-500 block mb-1">Motivo anticipado</span>
            <p className="text-neutral-700 italic">{motivo}</p>
          </div>
        )}
        <div>
          <span className="text-neutral-500 block mb-1">Material utilizado</span>
          <p className="text-neutral-700 whitespace-pre-line">{material.trim() || '—'}</p>
        </div>
      </div>
      <div className="flex gap-3">
        <button onClick={() => setStep(step - 1)} className="btn-secondary flex-1" disabled={uploading}>← Atrás</button>
        <button onClick={handleFinalizar} className="btn-primary flex-1" disabled={uploading || !material.trim()}>
          {uploading ? 'Enviando…' : 'Finalizar servicio'}
        </button>
      </div>
    </div>
  );
}
