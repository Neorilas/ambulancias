import React, { useRef, useState, useEffect, useCallback } from 'react';
import { compressImage, blobToFile } from '../../utils/imageCompress.js';
import { IMAGEN_TIPOS } from '../../utils/constants.js';

// ── Siluetas SVG — furgoneta sanitaria (perfil limpio minimalista) ───────────
const SILUETAS = {

  // Vista frontal — boxy, alta, parabrisas grande
  frontal: (
    <svg viewBox="0 0 200 210" fill="none" stroke="white" strokeWidth="2.5"
         strokeLinecap="round" strokeLinejoin="round" opacity="0.8" className="w-full h-full">
      {/* Carrocería */}
      <rect x="14" y="16" width="172" height="162" rx="14"/>
      {/* Parabrisas (zona superior, casi ancho total) */}
      <rect x="26" y="24" width="148" height="92" rx="8"/>
      {/* Retrovisores */}
      <rect x="0"   y="54" width="12" height="24" rx="3"/>
      <rect x="188" y="54" width="12" height="24" rx="3"/>
      {/* Faros (rectángulos bajos en esquinas) */}
      <rect x="16"  y="124" width="44" height="22" rx="6"/>
      <rect x="140" y="124" width="44" height="22" rx="6"/>
      {/* Rejilla central */}
      <rect x="70"  y="128" width="60" height="14" rx="4"/>
      {/* Parachoques */}
      <rect x="10"  y="156" width="180" height="16" rx="7"/>
      {/* Balizas / barra techo */}
      <rect x="52"  y="5"   width="96"  height="13" rx="5"/>
      {/* Arcos rueda */}
      <path d="M 0 192 Q 28 175 56 192"/>
      <path d="M 144 192 Q 172 175 200 192"/>
    </svg>
  ),

  // Vista lateral izquierda — pendiente del parabrisas a la izquierda
  lateral_izquierdo: (
    <svg viewBox="0 0 220 110" fill="none" stroke="white" strokeWidth="2.5"
         strokeLinecap="round" strokeLinejoin="round" opacity="0.8" className="w-full h-full">
      {/* Carrocería: pendiente del parabrisas en esquina delantera-superior */}
      <path d="
        M 16 84
        L 16 54
        Q 18 24 50 16
        L 206 16
        Q 216 16 216 26
        L 216 84
        Q 216 90 210 90
        L 22  90
        Q 16 90 16 84
        Z
      "/>
      {/* Parabrisas interior */}
      <path d="M 20 54 Q 22 24 52 18 L 106 18 L 106 54 Z" strokeWidth="2"/>
      {/* Espejo retrovisor */}
      <rect x="2" y="34" width="12" height="20" rx="3"/>
      {/* Faro delantero */}
      <rect x="14" y="62" width="6" height="16" rx="2"/>
      {/* Piloto trasero */}
      <rect x="212" y="50" width="6" height="20" rx="2"/>
      {/* Ruedas */}
      <circle cx="62"  cy="95" r="18"/>
      <circle cx="62"  cy="95" r="8"/>
      <circle cx="168" cy="95" r="18"/>
      <circle cx="168" cy="95" r="8"/>
    </svg>
  ),

  // Vista trasera — dos hojas de puerta, sin ventanas (furgoneta carga/sanitaria)
  trasera: (
    <svg viewBox="0 0 200 210" fill="none" stroke="white" strokeWidth="2.5"
         strokeLinecap="round" strokeLinejoin="round" opacity="0.8" className="w-full h-full">
      {/* Carrocería */}
      <rect x="14" y="16" width="172" height="162" rx="14"/>
      {/* Balizas */}
      <rect x="48"  y="5"   width="104" height="13" rx="5"/>
      {/* División central de puertas */}
      <line x1="100" y1="16" x2="100" y2="178" strokeWidth="2.8"/>
      {/* Pilotos traseros (tiras verticales en esquinas) */}
      <rect x="16"  y="20" width="32" height="68" rx="6"/>
      <rect x="152" y="20" width="32" height="68" rx="6"/>
      {/* Manillas centrales */}
      <rect x="76"  y="92" width="12" height="32" rx="3"/>
      <rect x="112" y="92" width="12" height="32" rx="3"/>
      {/* Matrícula */}
      <rect x="66"  y="152" width="68" height="20" rx="3"/>
      {/* Parachoques */}
      <rect x="10"  y="158" width="180" height="16" rx="7"/>
      {/* Arcos rueda */}
      <path d="M 0 194 Q 28 177 56 194"/>
      <path d="M 144 194 Q 172 177 200 194"/>
    </svg>
  ),

  // Vista lateral derecha — pendiente del parabrisas a la derecha (espejado)
  lateral_derecho: (
    <svg viewBox="0 0 220 110" fill="none" stroke="white" strokeWidth="2.5"
         strokeLinecap="round" strokeLinejoin="round" opacity="0.8" className="w-full h-full">
      {/* Carrocería espejada: pendiente en esquina delantera-superior derecha */}
      <path d="
        M 204 84
        L 204 54
        Q 202 24 170 16
        L 14  16
        Q 4  16 4  26
        L 4  84
        Q 4  90 10 90
        L 198 90
        Q 204 90 204 84
        Z
      "/>
      {/* Parabrisas interior (derecha) */}
      <path d="M 200 54 Q 198 24 168 18 L 114 18 L 114 54 Z" strokeWidth="2"/>
      {/* Espejo retrovisor (derecho) */}
      <rect x="206" y="34" width="12" height="20" rx="3"/>
      {/* Faro delantero */}
      <rect x="200" y="62" width="6" height="16" rx="2"/>
      {/* Piloto trasero */}
      <rect x="2" y="50" width="6" height="20" rx="2"/>
      {/* Ruedas */}
      <circle cx="158" cy="95" r="18"/>
      <circle cx="158" cy="95" r="8"/>
      <circle cx="52"  cy="95" r="18"/>
      <circle cx="52"  cy="95" r="8"/>
    </svg>
  ),

  // Cuentakilómetros — cuadro de instrumentos
  cuentakilometros: (
    <svg viewBox="0 0 280 180" fill="none" stroke="white" strokeWidth="2.5"
         strokeLinecap="round" strokeLinejoin="round" opacity="0.8" className="w-full h-full">
      {/* Marco */}
      <rect x="12" y="18" width="256" height="148" rx="10"/>
      {/* Velocímetro */}
      <circle cx="98" cy="92" r="62"/>
      <circle cx="98" cy="92" r="5" fill="white" opacity="0.7"/>
      <path d="M 42 136 A 62 62 0 1 1 154 136" strokeWidth="2.5"/>
      {[0, 36, 72, 108, 144, 180].map((deg, i) => {
        const a = (deg - 90) * Math.PI / 180;
        return <line key={i}
          x1={98 + 55 * Math.cos(a)} y1={92 + 55 * Math.sin(a)}
          x2={98 + 47 * Math.cos(a)} y2={92 + 47 * Math.sin(a)}
          strokeWidth="2"/>;
      })}
      <line x1="98" y1="92" x2="142" y2="54" strokeWidth="2.5"/>
      <rect x="60" y="115" width="76" height="20" rx="4"/>
      {/* RPM */}
      <circle cx="196" cy="92" r="46"/>
      <circle cx="196" cy="92" r="4" fill="white" opacity="0.7"/>
      <path d="M 157 130 A 46 46 0 1 1 235 130" strokeWidth="1.8"/>
      <line x1="196" y1="92" x2="218" y2="58" strokeWidth="2"/>
    </svg>
  ),
};

/**
 * CameraCapture
 *
 * Props:
 *  onComplete(entries[])  → { tipo, label, preview, file } por cada foto
 *  onCancel()
 *  initialIndex           → índice de IMAGEN_TIPOS por el que empezar (default 0)
 */
export default function CameraCapture({ onComplete, onCancel, initialIndex = 0 }) {
  const videoRef  = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);

  const [currentIndex, setCurrentIndex] = useState(initialIndex);
  const [captured,     setCaptured]     = useState([]);       // { tipo, label, preview, file }[]
  const [preview,      setPreview]      = useState(null);     // { blob, previewUrl }
  const [cameraReady,  setCameraReady]  = useState(false);
  const [error,        setError]        = useState(null);
  const [facingMode,   setFacingMode]   = useState('environment');
  const [compressing,  setCompressing]  = useState(false);
  const [isLandscape,  setIsLandscape]  = useState(() => {
    // screen.orientation.type es el método más fiable — refleja la orientación
    // FÍSICA del dispositivo incluso cuando el viewport está bloqueado por el manifest.
    if (screen.orientation?.type) return screen.orientation.type.startsWith('landscape');
    if (typeof window.orientation !== 'undefined') return Math.abs(window.orientation) === 90;
    return window.matchMedia('(orientation: landscape)').matches;
  });

  const currentTipo = IMAGEN_TIPOS[currentIndex];
  // Cuántas fotos de este tipo ya están guardadas (solo relevante para multiple=true)
  const addedCount = captured.filter(c => c.tipo === currentTipo.key).length;

  const log = useCallback((msg) => console.log(`[CAM] ${msg}`), []);

  // ── Detección orientación física ──────────────────────────────
  // Usa screen.orientation (más fiable) con fallback a window.orientation y matchMedia.
  useEffect(() => {
    const update = () => {
      if (screen.orientation?.type) {
        setIsLandscape(screen.orientation.type.startsWith('landscape'));
      } else if (typeof window.orientation !== 'undefined') {
        setIsLandscape(Math.abs(window.orientation) === 90);
      }
    };
    if (screen.orientation) {
      screen.orientation.addEventListener('change', update);
      return () => screen.orientation.removeEventListener('change', update);
    } else {
      window.addEventListener('orientationchange', update);
      return () => window.removeEventListener('orientationchange', update);
    }
  }, []);

  // ── Bloqueo programático de orientación por tipo de foto ─────
  // En dispositivos con soporte (Android PWA): fuerza la orientación correcta.
  // En iOS / navegadores sin soporte: falla silenciosamente; la detección
  // por screen.orientation garantiza que la silueta se actualice de todos modos.
  useEffect(() => {
    if (!screen.orientation?.lock) return;
    const target = currentTipo.landscape ? 'landscape' : 'portrait';
    screen.orientation.lock(target).catch(() => {}); // falla silenciosamente en iOS
    return () => { screen.orientation.unlock?.(); };
  }, [currentIndex]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Iniciar cámara ───────────────────────────────────────────
  const startCamera = useCallback(async (facing = 'environment') => {
    log(`startCamera(${facing})`);
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      log('tracks anteriores parados');
    }
    setError(null);
    setCameraReady(false);
    try {
      log('pidiendo getUserMedia…');
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: facing, width: { ideal: 1920 }, height: { ideal: 1080 } },
        audio: false,
      });
      streamRef.current = stream;
      const tracks = stream.getVideoTracks();
      log(`stream OK: ${tracks.length} tracks, state=${tracks[0]?.readyState}`);
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
        log(`video.play() OK`);
        setCameraReady(true);
      } else {
        log('ERROR: videoRef.current es null');
      }
    } catch (err) {
      log(`ERROR: ${err.name}: ${err.message}`);
      if (err.name === 'NotAllowedError')
        setError('Permiso de cámara denegado. Permite el acceso en la configuración del navegador.');
      else if (err.name === 'NotFoundError')
        setError('No se encontró ninguna cámara en este dispositivo.');
      else
        setError(`Error de cámara: ${err.message}`);
    }
  }, [log]);

  // ── Efecto: controla cámara según preview + facingMode ───────
  useEffect(() => {
    if (preview) {
      log('preview activa → parando cámara');
      streamRef.current?.getTracks().forEach(t => t.stop());
      streamRef.current = null;
      setCameraReady(false);
      return;
    }
    log(`useEffect → arrancando cámara (facing=${facingMode})`);
    startCamera(facingMode);
    return () => { streamRef.current?.getTracks().forEach(t => t.stop()); };
  }, [preview, facingMode, startCamera]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Capturar ─────────────────────────────────────────────────
  const capture = useCallback(async () => {
    if (!cameraReady || !videoRef.current) return;
    const video  = videoRef.current;
    const canvas = canvasRef.current;
    canvas.width  = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d').drawImage(video, 0, 0);
    canvas.toBlob((blob) => {
      setPreview({ blob, previewUrl: URL.createObjectURL(blob) });
    }, 'image/jpeg', 0.95);
  }, [cameraReady]);

  // ── Guardar foto y opcionalmente avanzar ─────────────────────
  const savePhoto = useCallback(async (andAdvance) => {
    if (!preview) return;
    setCompressing(true);
    try {
      const compressed = await compressImage(preview.blob, { maxWidth: 1280, quality: 0.80 });
      // Sufijo numérico para fotos adicionales del mismo tipo
      const suffix = addedCount > 0 ? `_${addedCount + 1}` : '';
      const file   = blobToFile(compressed, `${currentTipo.key}${suffix}.jpg`);
      const entry  = { tipo: currentTipo.key, label: currentTipo.label, preview: preview.previewUrl, file };
      const newCaptured = [...captured, entry];
      setCaptured(newCaptured);
      setPreview(null); // el effect arrancará la cámara de nuevo si !andAdvance

      if (andAdvance) {
        if (currentIndex + 1 >= IMAGEN_TIPOS.length) {
          onComplete(newCaptured);
        } else {
          setCurrentIndex(prev => prev + 1);
        }
      }
    } finally {
      setCompressing(false);
    }
  }, [preview, currentTipo, captured, addedCount, currentIndex, onComplete]);

  // ── Repetir ──────────────────────────────────────────────────
  const retake = useCallback(() => {
    if (preview?.previewUrl) URL.revokeObjectURL(preview.previewUrl);
    setPreview(null);
  }, [preview]);

  // ── Toggle cámara frontal/trasera ────────────────────────────
  const toggleCamera = () => setFacingMode(f => f === 'environment' ? 'user' : 'environment');

  // ── Teclado: espacio → capturar ──────────────────────────────
  useEffect(() => {
    const h = (e) => { if (e.key === ' ' && !preview) { e.preventDefault(); capture(); } };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [capture, preview]);

  // ── Estilo del contenedor de silueta (ancho/alto según tipo y orientación) ──
  // Para evitar que SVGs de proporción retrato desborden en modo landscape,
  // limitamos por altura cuando el móvil está apaisado y el tipo es retrato.
  const SILUETA_RATIO = {
    frontal:           '200/210',
    lateral_izquierdo: '220/110',
    trasera:           '200/210',
    lateral_derecho:   '220/110',
    niveles_liquidos:  '4/3',
    cuentakilometros:  '280/180',
  };
  const siluetaStyle = (() => {
    if (currentTipo.landscape) {
      // Silueta lateral — siempre por anchura
      return { width: '94%' };
    }
    if (isLandscape) {
      // Silueta retrato en móvil apaisado — limitar por altura + ratio exacto
      return {
        height: '55dvh',
        width: 'auto',
        aspectRatio: SILUETA_RATIO[currentTipo.key] ?? '4/3',
      };
    }
    // Caso normal: móvil en vertical, silueta retrato
    return { width: 'min(68%, 240px)' };
  })();
  const siluetaClass = 'drop-shadow-[0_0_8px_rgba(0,0,0,0.9)]';

  return (
    <div className="fixed inset-0 bg-black z-50 flex flex-col">
      <canvas ref={canvasRef} className="hidden"/>

      {/* ── Previsualización ────────────────────────────────── */}
      {preview && (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-black">
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

            {/* Tres botones para tipo múltiple, dos para el resto */}
            {currentTipo.multiple ? (
              <div className="flex gap-2">
                <button
                  onClick={retake}
                  className="flex-1 btn-secondary text-sm py-2"
                  disabled={compressing}
                >
                  🔄 Repetir
                </button>
                <button
                  onClick={() => savePhoto(false)}
                  className="flex-1 btn-secondary text-sm py-2"
                  disabled={compressing}
                >
                  {compressing ? '…' : '📷 + Añadir'}
                </button>
                <button
                  onClick={() => savePhoto(true)}
                  className="flex-1 btn-primary text-sm py-2"
                  disabled={compressing}
                >
                  {compressing ? 'Procesando…' : '✓ Continuar'}
                </button>
              </div>
            ) : (
              <div className="flex gap-3">
                <button
                  onClick={retake}
                  className="flex-1 btn-secondary"
                  disabled={compressing}
                >
                  🔄 Repetir
                </button>
                <button
                  onClick={() => savePhoto(true)}
                  className="flex-1 btn-primary"
                  disabled={compressing}
                >
                  {compressing ? 'Procesando…' : '✓ Usar foto'}
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Visor de cámara ─────────────────────────────────── */}
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

            {/* Aviso: girar el móvil para laterales */}
            {cameraReady && !preview && currentTipo.landscape && !isLandscape && (
              <div className="absolute top-20 left-0 right-0 flex justify-center z-10 px-4">
                <div className="flex items-center gap-2 bg-amber-500/90 text-black
                                text-sm font-semibold px-4 py-2 rounded-full shadow-lg">
                  <span style={{ display: 'inline-block', transform: 'rotate(90deg)', fontSize: '1.1rem' }}>
                    📱
                  </span>
                  Gira el móvil para esta foto
                </div>
              </div>
            )}

            {/* Silueta guía de encuadre */}
            {cameraReady && !preview && (
              <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                {SILUETAS[currentTipo.key] && (
                  <div className={siluetaClass} style={siluetaStyle}>
                    {SILUETAS[currentTipo.key]}
                  </div>
                )}
                <div className="absolute bottom-32 left-0 right-0 text-center px-6">
                  <p className="text-white text-sm bg-black/50 rounded-lg px-3 py-2 inline-block">
                    {currentTipo.instruccion}
                  </p>
                </div>
              </div>
            )}

            {/* Controles superpuestos */}
            {!preview && (
              <>
                {/* Barra superior */}
                <div className="absolute top-4 left-0 right-0 flex items-center justify-between px-4">
                  <button
                    onClick={onCancel}
                    className="p-2 rounded-full bg-black/40 text-white"
                  >✕</button>

                  <div className="text-white text-center">
                    <p className="font-bold">{currentTipo.label}</p>
                    <p className="text-xs opacity-75">{currentIndex + 1} / {IMAGEN_TIPOS.length}</p>
                    {currentTipo.multiple && addedCount > 0 && (
                      <p className="text-xs text-green-400 mt-0.5">
                        {addedCount} foto{addedCount !== 1 ? 's' : ''} guardada{addedCount !== 1 ? 's' : ''}
                      </p>
                    )}
                  </div>

                  <button
                    onClick={toggleCamera}
                    className="p-2 rounded-full bg-black/40 text-white"
                  >🔄</button>
                </div>

                {/* Miniaturas de progreso */}
                <div className="absolute top-16 left-0 right-0 flex justify-center gap-2 px-4">
                  {IMAGEN_TIPOS.map((tipo, i) => {
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

                {/* Botón de captura */}
                <div className="absolute bottom-8 left-0 right-0 flex justify-center">
                  <button
                    onClick={capture}
                    disabled={!cameraReady}
                    className="w-20 h-20 rounded-full bg-white border-4 border-primary-500
                               flex items-center justify-center shadow-2xl
                               active:scale-95 transition-transform disabled:opacity-50"
                    aria-label="Capturar foto"
                  >
                    <div className="w-14 h-14 rounded-full bg-primary-600"/>
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
