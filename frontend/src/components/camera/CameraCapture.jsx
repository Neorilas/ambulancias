import React, { useRef, useState, useEffect, useCallback } from 'react';
import { compressImage, blobToFile } from '../../utils/imageCompress.js';
import { IMAGEN_TIPOS } from '../../utils/constants.js';

// ── Siluetas SVG — Mercedes Sprinter / furgoneta sanitaria ──────────────────
const SILUETAS = {

  frontal: (
    <svg viewBox="0 0 300 240" fill="none" stroke="white" strokeWidth="2.2"
         strokeLinecap="round" strokeLinejoin="round" opacity="0.75" className="w-full h-full">
      {/* Carrocería principal — boxy, alta */}
      <rect x="22" y="18" width="256" height="192" rx="5"/>
      {/* Parabrisas grande — casi ancho total */}
      <rect x="35" y="25" width="230" height="102" rx="3"/>
      {/* Retrovisores */}
      <rect x="2"   y="62" width="20" height="35" rx="3"/>
      <rect x="278" y="62" width="20" height="35" rx="3"/>
      {/* Faros delanteros (tiras rectangulares) */}
      <rect x="24"  y="133" width="72" height="28" rx="4"/>
      <rect x="204" y="133" width="72" height="28" rx="4"/>
      {/* Zona central — rejilla / logo */}
      <rect x="105" y="137" width="90" height="20" rx="3"/>
      {/* Parachoques inferior */}
      <rect x="18"  y="200" width="264" height="14" rx="4"/>
      {/* Barra de balizas — techo */}
      <rect x="70"  y="7"   width="160" height="13" rx="4"/>
      {/* Arcos rueda (parciales, parte inferior) */}
      <path d="M 2 234 Q 48 212 94 234"/>
      <path d="M 206 234 Q 252 212 298 234"/>
    </svg>
  ),

  lateral_izquierdo: (
    <svg viewBox="0 0 520 200" fill="none" stroke="white" strokeWidth="2.2"
         strokeLinecap="round" strokeLinejoin="round" opacity="0.75" className="w-full h-full">
      {/* Perfil general Sprinter — morro corto, caja larga y alta */}
      <path d="M 10 170 L 10 84 Q 14 38 50 22 L 170 16 L 512 16 L 516 20 L 516 170 Z"/>
      {/* Parabrisas — casi vertical, característico de furgoneta */}
      <path d="M 48 22 L 30 80 L 30 114 L 166 114 L 166 16" strokeWidth="1.8"/>
      {/* Ventana del conductor */}
      <rect x="36" y="27" width="124" height="74" rx="4"/>
      {/* Espejo retrovisor izquierdo */}
      <path d="M 31 44 L 6 50 L 6 74 L 31 74"/>
      {/* Pilar B — separación cabina / módulo sanitario */}
      <line x1="170" y1="16" x2="170" y2="170" strokeWidth="2.8"/>
      {/* Puerta lateral corredera */}
      <line x1="294" y1="16" x2="294" y2="170" strokeDasharray="7 4" strokeWidth="1.5"/>
      {/* Contorno puertas traseras — desde lateral */}
      <line x1="444" y1="16" x2="444" y2="170" strokeDasharray="7 4" strokeWidth="1.5"/>
      {/* Ventana lateral (detrás del pilar B) */}
      <rect x="180" y="26" width="74" height="60" rx="3"/>
      {/* Faro delantero */}
      <rect x="10"  y="92" width="18" height="40" rx="3"/>
      {/* Piloto trasero */}
      <rect x="506" y="72" width="10" height="52" rx="2"/>
      {/* Cruz ambulancia — en caja sanitaria */}
      <line x1="378" y1="55" x2="378" y2="94"/>
      <line x1="359" y1="74" x2="397" y2="74"/>
      {/* Ruedas */}
      <circle cx="108" cy="177" r="25"/>
      <circle cx="108" cy="177" r="11"/>
      <circle cx="392" cy="177" r="25"/>
      <circle cx="392" cy="177" r="11"/>
      {/* Arcos de rueda */}
      <path d="M 72 163 Q 108 143 144 163"/>
      <path d="M 356 163 Q 392 143 428 163"/>
    </svg>
  ),

  trasera: (
    <svg viewBox="0 0 300 240" fill="none" stroke="white" strokeWidth="2.2"
         strokeLinecap="round" strokeLinejoin="round" opacity="0.75" className="w-full h-full">
      {/* Carrocería trasera */}
      <rect x="20" y="18" width="260" height="186" rx="5"/>
      {/* Barra de balizas */}
      <rect x="65" y="7" width="170" height="13" rx="4"/>
      {/* División central de las dos hojas de la puerta */}
      <line x1="150" y1="18" x2="150" y2="204" strokeWidth="2.8"/>
      {/* Pilotos traseros (tiras verticales) */}
      <rect x="20"  y="22" width="38" height="74" rx="4"/>
      <rect x="242" y="22" width="38" height="74" rx="4"/>
      {/* Manillas centrales */}
      <rect x="118" y="100" width="14" height="38" rx="3"/>
      <rect x="168" y="100" width="14" height="38" rx="3"/>
      {/* Matrícula */}
      <rect x="103" y="178" width="94" height="22" rx="3"/>
      {/* Parachoques */}
      <rect x="14"  y="200" width="272" height="16" rx="4"/>
      {/* Arcos rueda */}
      <path d="M 2 235 Q 46 214 90 235"/>
      <path d="M 210 235 Q 254 214 298 235"/>
    </svg>
  ),

  lateral_derecho: (
    <svg viewBox="0 0 520 200" fill="none" stroke="white" strokeWidth="2.2"
         strokeLinecap="round" strokeLinejoin="round" opacity="0.75" className="w-full h-full">
      {/* Perfil espejado — lado derecho (pasajero en España) */}
      <path d="M 510 170 L 510 84 Q 506 38 470 22 L 350 16 L 4 16 L 0 20 L 0 170 Z"/>
      {/* Parabrisas espejado */}
      <path d="M 472 22 L 490 80 L 490 114 L 354 114 L 354 16" strokeWidth="1.8"/>
      {/* Ventana del conductor (lado derecho, espejado) */}
      <rect x="360" y="27" width="124" height="74" rx="4"/>
      {/* Espejo retrovisor derecho */}
      <path d="M 489 44 L 514 50 L 514 74 L 489 74"/>
      {/* Pilar B */}
      <line x1="350" y1="16" x2="350" y2="170" strokeWidth="2.8"/>
      {/* Puerta lateral corredera (espejada) */}
      <line x1="226" y1="16" x2="226" y2="170" strokeDasharray="7 4" strokeWidth="1.5"/>
      {/* Contorno puertas traseras */}
      <line x1="76"  y1="16" x2="76"  y2="170" strokeDasharray="7 4" strokeWidth="1.5"/>
      {/* Ventana lateral */}
      <rect x="266" y="26" width="74" height="60" rx="3"/>
      {/* Faro delantero (derecha, espejado) */}
      <rect x="492" y="92" width="18" height="40" rx="3"/>
      {/* Piloto trasero */}
      <rect x="4"   y="72" width="10" height="52" rx="2"/>
      {/* Cruz ambulancia */}
      <line x1="142" y1="55" x2="142" y2="94"/>
      <line x1="123" y1="74" x2="161" y2="74"/>
      {/* Ruedas */}
      <circle cx="412" cy="177" r="25"/>
      <circle cx="412" cy="177" r="11"/>
      <circle cx="128" cy="177" r="25"/>
      <circle cx="128" cy="177" r="11"/>
      {/* Arcos de rueda */}
      <path d="M 376 163 Q 412 143 448 163"/>
      <path d="M 92  163 Q 128 143 164 163"/>
    </svg>
  ),

  cuentakilometros: (
    <svg viewBox="0 0 280 180" fill="none" stroke="white" strokeWidth="2.2"
         strokeLinecap="round" strokeLinejoin="round" opacity="0.75" className="w-full h-full">
      {/* Marco cuadro de instrumentos */}
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
      {/* Aguja */}
      <line x1="98" y1="92" x2="142" y2="54" strokeWidth="2.5"/>
      {/* Display digital km */}
      <rect x="60" y="115" width="76" height="20" rx="4"/>
      {/* Cuentarrevoluciones */}
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
  const [isLandscape,  setIsLandscape]  = useState(
    () => window.matchMedia('(orientation: landscape)').matches
  );

  const currentTipo = IMAGEN_TIPOS[currentIndex];
  // Cuántas fotos de este tipo ya están guardadas (solo relevante para multiple=true)
  const addedCount = captured.filter(c => c.tipo === currentTipo.key).length;

  const log = useCallback((msg) => console.log(`[CAM] ${msg}`), []);

  // ── Detección orientación ────────────────────────────────────
  useEffect(() => {
    const mq = window.matchMedia('(orientation: landscape)');
    const handler = (e) => setIsLandscape(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

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

  // ── Clase del contenedor de silueta según orientación ────────
  const siluetaContainerClass = currentTipo.landscape
    ? 'w-[94%] drop-shadow-[0_0_8px_rgba(0,0,0,0.9)]'
    : 'w-[68%] max-w-xs drop-shadow-[0_0_8px_rgba(0,0,0,0.9)]';

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
                  <div className={siluetaContainerClass}>
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
