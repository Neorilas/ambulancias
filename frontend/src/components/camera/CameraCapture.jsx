import React, { useState, useEffect, useCallback, useRef } from 'react';
import { compressImage, blobToFile } from '../../utils/imageCompress.js';
import { IMAGEN_TIPOS_FIN } from '../../utils/constants.js';
import { useCameraStream } from './useCameraStream.js';
import PhotoSilhouette from './PhotoSilhouette.jsx';

/**
 * CameraCapture
 *
 * Orquesta el flujo de captura de fotos por pasos.
 * La lógica de stream, orientación y captura está en useCameraStream.
 * El encuadre visual está en PhotoSilhouette.
 *
 * Props:
 *   tipos                  → lista de tipos a capturar (default IMAGEN_TIPOS_FIN)
 *   onComplete(entries[])  → { tipo, label, preview, file } por cada foto
 *   onCancel()
 *   initialIndex           → índice por el que empezar (default 0)
 */

/**
 * Icono interior del botón de captura.
 * Cambia entre retrato y apaisado según la orientación actual del dispositivo,
 * pero el botón en sí siempre permanece en la misma posición.
 */
function OrientationIcon({ isLandscape }) {
  return isLandscape ? (
    /* Móvil apaisado */
    <svg width="42" height="30" viewBox="0 0 42 30" fill="none" className="text-primary-600">
      <rect x="1.5" y="4.5" width="39" height="21" rx="4" stroke="currentColor" strokeWidth="2.5"/>
      <circle cx="21" cy="15" r="5.5" stroke="currentColor" strokeWidth="2"/>
      <circle cx="21" cy="15" r="2.5" fill="currentColor"/>
      <rect x="35.5" y="11" width="3" height="5" rx="1.5" fill="currentColor"/>
    </svg>
  ) : (
    /* Móvil en vertical */
    <svg width="28" height="42" viewBox="0 0 28 42" fill="none" className="text-primary-600">
      <rect x="4.5" y="1.5" width="19" height="39" rx="4" stroke="currentColor" strokeWidth="2.5"/>
      <circle cx="14" cy="21" r="5.5" stroke="currentColor" strokeWidth="2"/>
      <circle cx="14" cy="21" r="2.5" fill="currentColor"/>
      <rect x="11" y="35.5" width="6" height="3" rx="1.5" fill="currentColor"/>
    </svg>
  );
}

export default function CameraCapture({ tipos = IMAGEN_TIPOS_FIN, onComplete, onCancel, initialIndex = 0 }) {
  const [currentIndex, setCurrentIndex] = useState(initialIndex);
  const [captured,     setCaptured]     = useState([]);   // { tipo, label, preview, file }[]
  const [preview,      setPreview]      = useState(null); // { blob, previewUrl }
  const [compressing,  setCompressing]  = useState(false);

  const currentTipo = tipos[currentIndex];
  const addedCount  = captured.filter(c => c.tipo === currentTipo.key).length;

  const capturedRef = useRef(captured);
  capturedRef.current = captured;

  const { videoRef, canvasRef, cameraReady, error, isLandscape, toggleCamera, captureBlob } =
    useCameraStream({ wantLandscape: currentTipo.landscape, pause: !!preview });

  // ── Capturar ─────────────────────────────────────────────────
  const capture = useCallback(async () => {
    if (!cameraReady) return;
    try {
      const blob = await captureBlob();
      setPreview({ blob, previewUrl: URL.createObjectURL(blob) });
    } catch { /* cámara no lista */ }
  }, [cameraReady, captureBlob]);

  // ── Guardar foto y opcionalmente avanzar ─────────────────────
  const savePhoto = useCallback(async (andAdvance) => {
    if (!preview) return;
    setCompressing(true);
    try {
      const compressed = await compressImage(preview.blob, { maxWidth: 1280, quality: 0.80 });
      const suffix     = addedCount > 0 ? `_${addedCount + 1}` : '';
      const file       = blobToFile(compressed, `${currentTipo.key}${suffix}.jpg`);
      const entry      = { tipo: currentTipo.key, label: currentTipo.label, preview: preview.previewUrl, file };
      const newCaptured = [...captured, entry];
      setCaptured(newCaptured);
      setPreview(null);

      if (andAdvance) {
        if (currentIndex + 1 >= tipos.length) {
          onComplete(newCaptured);
        } else {
          setCurrentIndex(prev => prev + 1);
        }
      }
    } finally {
      setCompressing(false);
    }
  }, [preview, currentTipo, captured, addedCount, currentIndex, onComplete, tipos]);

  // ── Repetir ──────────────────────────────────────────────────
  const retake = useCallback(() => {
    if (preview?.previewUrl) URL.revokeObjectURL(preview.previewUrl);
    setPreview(null);
  }, [preview]);

  // ── Cleanup ObjectURLs al desmontar ──────────────────────────
  useEffect(() => {
    return () => {
      capturedRef.current.forEach(c => { if (c.preview) URL.revokeObjectURL(c.preview); });
    };
  }, []);

  // ── Teclado: espacio → capturar ──────────────────────────────
  useEffect(() => {
    const h = (e) => { if (e.key === ' ' && !preview) { e.preventDefault(); capture(); } };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [capture, preview]);

  return (
    <div className="fixed inset-0 bg-black z-50 flex flex-col">
      <canvas ref={canvasRef} className="hidden"/>

      {/* ── Previsualización ─────────────────────────────────── */}
      {preview && (
        <div
          className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-black"
          style={{
            paddingTop:    'env(safe-area-inset-top)',
            paddingBottom: 'env(safe-area-inset-bottom)',
          }}
        >
          <img
            src={preview.previewUrl}
            alt="Previsualización"
            className="max-h-[68dvh] object-contain"
          />
          <div className="p-5 w-full flex flex-col gap-3">
            <p className="text-white text-center font-medium">
              {currentTipo.label}
              {currentTipo.multiple && addedCount > 0 && (
                <span className="ml-2 text-green-400 text-sm">
                  ({addedCount} foto{addedCount !== 1 ? 's' : ''} añadida{addedCount !== 1 ? 's' : ''})
                </span>
              )}
            </p>

            {currentTipo.multiple ? (
              <div className="flex gap-2">
                <button onClick={retake} className="flex-1 btn-secondary text-sm py-2" disabled={compressing}>
                  🔄 Repetir
                </button>
                <button onClick={() => savePhoto(false)} className="flex-1 btn-secondary text-sm py-2" disabled={compressing}>
                  {compressing ? '…' : '📷 + Añadir'}
                </button>
                <button onClick={() => savePhoto(true)} className="flex-1 btn-primary text-sm py-2" disabled={compressing}>
                  {compressing ? 'Procesando…' : '✓ Continuar'}
                </button>
              </div>
            ) : (
              <div className="flex gap-3">
                <button onClick={retake} className="flex-1 btn-secondary" disabled={compressing}>
                  🔄 Repetir
                </button>
                <button onClick={() => savePhoto(true)} className="flex-1 btn-primary" disabled={compressing}>
                  {compressing ? 'Procesando…' : '✓ Usar foto'}
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Visor de cámara ──────────────────────────────────── */}
      <div className="flex-1 relative overflow-hidden">
        {error ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center p-6 text-center">
            <p className="text-4xl mb-4">📷</p>
            <p className="text-white text-sm leading-relaxed">{error}</p>
            <button onClick={onCancel} className="btn-secondary mt-6">Cancelar</button>
          </div>
        ) : (
          <>
            {/* Video — siempre montado */}
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className="w-full h-full object-cover"
            />

            {/* Silueta guía de encuadre */}
            {cameraReady && !preview && (
              <PhotoSilhouette
                tipoKey={currentTipo.key}
                wantLandscape={currentTipo.landscape}
                isLandscape={isLandscape}
                instruccion={currentTipo.instruccion}
              />
            )}

            {/* Controles superpuestos */}
            {!preview && (
              <>
                {/*
                  ── Cabecera: barra superior + miniaturas ──────────────
                  paddingTop respeta el notch / Dynamic Island de iPhone.
                  Todo el contenido se coloca bajo el hardware de cámara.
                */}
                <div
                  className="absolute top-0 left-0 right-0 z-10"
                  style={{ paddingTop: 'env(safe-area-inset-top)' }}
                >
                  {/* Barra superior */}
                  <div className="flex items-center justify-between px-4 pt-3 pb-2">
                    <button onClick={onCancel} className="p-2 rounded-full bg-black/40 text-white">✕</button>

                    <div className="text-white text-center">
                      <p className="font-bold">{currentTipo.label}</p>
                      <p className="text-xs opacity-75">{currentIndex + 1} / {tipos.length}</p>
                      {currentTipo.multiple && addedCount > 0 && (
                        <p className="text-xs text-green-400 mt-0.5">
                          {addedCount} foto{addedCount !== 1 ? 's' : ''} guardada{addedCount !== 1 ? 's' : ''}
                        </p>
                      )}
                    </div>

                    <button onClick={toggleCamera} className="p-2 rounded-full bg-black/40 text-white">🔄</button>
                  </div>

                  {/* Miniaturas de progreso */}
                  <div className="flex justify-center gap-2 px-4 pb-2">
                    {tipos.map((tipo, i) => {
                      const done = captured.find(c => c.tipo === tipo.key);
                      return (
                        <div
                          key={tipo.key}
                          className={`w-8 h-8 rounded border-2 overflow-hidden
                            ${i === currentIndex
                              ? 'border-primary-500 ring-2 ring-primary-300'
                              : done ? 'border-green-400' : 'border-white/30'}`}
                        >
                          {done
                            ? <img src={done.preview} alt={tipo.label} className="w-full h-full object-cover"/>
                            : <div className={`w-full h-full ${i === currentIndex ? 'bg-primary-500/30' : 'bg-white/10'}`}/>
                          }
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Aviso: girar el móvil para laterales (debajo del header) */}
                {cameraReady && !preview && currentTipo.landscape && !isLandscape && (
                  <div
                    className="absolute left-0 right-0 flex justify-center z-10 px-4"
                    style={{ top: 'calc(env(safe-area-inset-top) + 7rem)' }}
                  >
                    <div className="flex items-center gap-2 bg-amber-500/90 text-black
                                    text-sm font-semibold px-4 py-2 rounded-full shadow-lg">
                      <span style={{ display: 'inline-block', transform: 'rotate(90deg)', fontSize: '1.1rem' }}>
                        📱
                      </span>
                      Gira el móvil para esta foto
                    </div>
                  </div>
                )}

                {/*
                  ── Botón de captura ───────────────────────────────────
                  Vertical   → centrado en la parte inferior (safe-area-inset-bottom).
                  Apaisado   → pegado a la derecha, donde está la "botonera"
                               física del teléfono (safe-area-inset-right).
                  El icono interior indica la orientación actual pero el
                  botón siempre está en la misma zona táctil del dispositivo.
                */}
                <div
                  className={
                    isLandscape
                      ? 'absolute right-0 top-0 bottom-0 flex flex-col justify-center'
                      : 'absolute bottom-0 left-0 right-0 flex justify-center'
                  }
                  style={
                    isLandscape
                      ? { paddingRight: 'max(1.5rem, calc(env(safe-area-inset-right) + 1rem))' }
                      : { paddingBottom: 'max(1.75rem, calc(env(safe-area-inset-bottom) + 1rem))' }
                  }
                >
                  <button
                    onClick={capture}
                    disabled={!cameraReady}
                    className="w-20 h-20 rounded-full bg-white border-4 border-primary-500
                               flex items-center justify-center shadow-2xl
                               active:scale-95 transition-transform disabled:opacity-50"
                    aria-label="Capturar foto"
                  >
                    <OrientationIcon isLandscape={isLandscape} />
                  </button>
                </div>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
