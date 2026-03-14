import React, { useRef, useState, useEffect, useCallback } from 'react';
import { compressImage, blobToFile } from '../../utils/imageCompress.js';
import { IMAGEN_TIPOS } from '../../utils/constants.js';

// ── Siluetas SVG guía por tipo de foto ──────────────────────
const SILUETAS = {
  frontal: (
    <svg viewBox="0 0 320 210" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" opacity="0.7" className="w-full h-full">
      {/* Cuerpo */}
      <rect x="25" y="55" width="270" height="130" rx="6"/>
      {/* Techo/cabina */}
      <path d="M 55 55 L 70 18 L 250 18 L 265 55"/>
      {/* Parabrisas */}
      <path d="M 72 55 L 84 22 L 236 22 L 248 55" strokeWidth="2"/>
      {/* Retrovisores */}
      <rect x="5" y="62" width="20" height="28" rx="3"/>
      <rect x="295" y="62" width="20" height="28" rx="3"/>
      {/* Faros delanteros */}
      <rect x="30" y="130" width="55" height="22" rx="4"/>
      <rect x="235" y="130" width="55" height="22" rx="4"/>
      {/* Rejilla/frontal bajo */}
      <rect x="95" y="138" width="130" height="22" rx="4"/>
      {/* Cruz ambulancia */}
      <line x1="160" y1="32" x2="160" y2="48"/>
      <line x1="152" y1="40" x2="168" y2="40"/>
      {/* Separación capó/cabina */}
      <line x1="25" y1="100" x2="295" y2="100" strokeDasharray="8 5" strokeWidth="1.5"/>
      {/* Ruedas (parciales) */}
      <path d="M 5 195 Q 48 172 90 195"/>
      <path d="M 230 195 Q 272 172 315 195"/>
    </svg>
  ),

  lateral_izquierdo: (
    <svg viewBox="0 0 420 200" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" opacity="0.7" className="w-full h-full">
      {/* Cuerpo principal */}
      <rect x="15" y="25" width="390" height="125" rx="6"/>
      {/* Techo cabina */}
      <path d="M 20 25 L 40 5 L 165 5 L 175 25"/>
      {/* Parabrisas */}
      <path d="M 45 25 L 60 8 L 155 8 L 165 25" strokeWidth="2"/>
      {/* Ventana conductor */}
      <rect x="48" y="32" width="100" height="52" rx="4"/>
      {/* Espejo retrovisor */}
      <path d="M 45 45 L 25 50 L 25 65 L 45 65"/>
      {/* Separación cabina/caja */}
      <line x1="175" y1="25" x2="175" y2="150" strokeDasharray="8 5" strokeWidth="1.5"/>
      {/* Ventana lateral trasera */}
      <rect x="190" y="32" width="85" height="52" rx="4"/>
      {/* Cruz ambulancia */}
      <line x1="310" y1="55" x2="310" y2="75"/>
      <line x1="300" y1="65" x2="320" y2="65"/>
      {/* Puerta lateral */}
      <line x1="285" y1="25" x2="285" y2="150" strokeDasharray="8 5" strokeWidth="1.5"/>
      {/* Ruedas */}
      <circle cx="95" cy="164" r="27"/>
      <circle cx="95" cy="164" r="12"/>
      <circle cx="320" cy="164" r="27"/>
      <circle cx="320" cy="164" r="12"/>
      {/* Arcos rueda */}
      <path d="M 55 150 Q 95 128 135 150"/>
      <path d="M 280 150 Q 320 128 360 150"/>
    </svg>
  ),

  lateral_derecho: (
    <svg viewBox="0 0 420 200" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" opacity="0.7" className="w-full h-full">
      {/* Cuerpo principal (espejado) */}
      <rect x="15" y="25" width="390" height="125" rx="6"/>
      {/* Techo cabina (espejado) */}
      <path d="M 400 25 L 380 5 L 255 5 L 245 25"/>
      {/* Parabrisas (espejado) */}
      <path d="M 375 25 L 360 8 L 265 8 L 255 25" strokeWidth="2"/>
      {/* Ventana conductor (espejado) */}
      <rect x="272" y="32" width="100" height="52" rx="4"/>
      {/* Espejo retrovisor (espejado) */}
      <path d="M 375 45 L 395 50 L 395 65 L 375 65"/>
      {/* Separación cabina/caja */}
      <line x1="245" y1="25" x2="245" y2="150" strokeDasharray="8 5" strokeWidth="1.5"/>
      {/* Ventana lateral trasera */}
      <rect x="145" y="32" width="85" height="52" rx="4"/>
      {/* Cruz ambulancia */}
      <line x1="110" y1="55" x2="110" y2="75"/>
      <line x1="100" y1="65" x2="120" y2="65"/>
      {/* Puerta lateral */}
      <line x1="135" y1="25" x2="135" y2="150" strokeDasharray="8 5" strokeWidth="1.5"/>
      {/* Ruedas */}
      <circle cx="325" cy="164" r="27"/>
      <circle cx="325" cy="164" r="12"/>
      <circle cx="100" cy="164" r="27"/>
      <circle cx="100" cy="164" r="12"/>
      {/* Arcos rueda */}
      <path d="M 285 150 Q 325 128 365 150"/>
      <path d="M 60 150 Q 100 128 140 150"/>
    </svg>
  ),

  trasera: (
    <svg viewBox="0 0 320 220" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" opacity="0.7" className="w-full h-full">
      {/* Cuerpo */}
      <rect x="22" y="20" width="276" height="158" rx="6"/>
      {/* División central puertas */}
      <line x1="160" y1="20" x2="160" y2="178"/>
      {/* Manillas */}
      <rect x="132" y="92" width="18" height="28" rx="4"/>
      <rect x="170" y="92" width="18" height="28" rx="4"/>
      {/* Ventanas traseras */}
      <rect x="35" y="32" width="110" height="80" rx="4"/>
      <rect x="175" y="32" width="110" height="80" rx="4"/>
      {/* Luz de emergencia / barra superior */}
      <rect x="60" y="12" width="200" height="12" rx="3"/>
      {/* Pilotos traseros */}
      <rect x="27" y="24" width="42" height="32" rx="4"/>
      <rect x="251" y="24" width="42" height="32" rx="4"/>
      {/* Matrícula */}
      <rect x="105" y="158" width="110" height="22" rx="3"/>
      {/* Parachoques */}
      <rect x="15" y="178" width="290" height="16" rx="4"/>
      {/* Enganche remolque */}
      <rect x="145" y="192" width="30" height="10" rx="2"/>
      {/* Arcos rueda */}
      <path d="M 5 210 Q 48 188 90 210"/>
      <path d="M 230 210 Q 272 188 315 210"/>
    </svg>
  ),

  cuentakilometros: (
    <svg viewBox="0 0 280 180" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" opacity="0.7" className="w-full h-full">
      {/* Marco cuadro instrumentos */}
      <rect x="15" y="20" width="250" height="145" rx="10"/>
      {/* Velocímetro */}
      <circle cx="100" cy="95" r="65"/>
      <circle cx="100" cy="95" r="5" fill="white" opacity="0.7"/>
      {/* Arco velocímetro */}
      <path d="M 42 140 A 65 65 0 1 1 158 140" strokeWidth="3"/>
      {/* Marcas velocímetro */}
      {[0,30,60,90,120,150,180].map((deg, i) => {
        const rad = (deg - 90) * Math.PI / 180;
        const x1 = 100 + 58 * Math.cos(rad); const y1 = 95 + 58 * Math.sin(rad);
        const x2 = 100 + 50 * Math.cos(rad); const y2 = 95 + 50 * Math.sin(rad);
        return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} strokeWidth="2.5"/>;
      })}
      {/* Aguja */}
      <line x1="100" y1="95" x2="145" y2="55" strokeWidth="3"/>
      {/* Cuentakilómetros digital */}
      <rect x="62" y="118" width="76" height="22" rx="4"/>
      {/* RPM (círculo pequeño) */}
      <circle cx="195" cy="95" r="48"/>
      <circle cx="195" cy="95" r="4" fill="white" opacity="0.7"/>
      <path d="M 155 132 A 48 48 0 1 1 235 132" strokeWidth="2"/>
      <line x1="195" y1="95" x2="215" y2="60" strokeWidth="2.5"/>
    </svg>
  ),
};

/**
 * CameraCapture
 * Componente de captura fotográfica con:
 * - Acceso directo a cámara (getUserMedia)
 * - Overlay con silueta guía de encuadre por tipo de foto
 * - Captura en orden forzado (frontal → lateral D → trasera → lateral I → líquidos)
 * - Compresión antes de exponer el archivo
 * - Previsualización antes de confirmar
 *
 * Props:
 *  onComplete(files[])  - llamado cuando se completan todas las fotos
 *  onCancel()           - cancelar el flujo
 *  initialIndex         - índice de tipo de imagen para empezar (default 0)
 */
export default function CameraCapture({ onComplete, onCancel, initialIndex = 0 }) {
  const videoRef       = useRef(null);
  const canvasRef      = useRef(null);
  const streamRef      = useRef(null);

  const [currentIndex, setCurrentIndex]   = useState(initialIndex);
  const [captured,     setCaptured]       = useState([]);  // { tipo, preview, file }
  const [preview,      setPreview]        = useState(null); // previsualización actual
  const [cameraReady,  setCameraReady]    = useState(false);
  const [error,        setError]          = useState(null);
  const [facingMode,   setFacingMode]     = useState('environment'); // trasera por defecto
  const [compressing,  setCompressing]    = useState(false);
  const currentTipo = IMAGEN_TIPOS[currentIndex];

  const log = useCallback((msg) => {
    console.log(`[CAM] ${msg}`);
  }, []);

  // ── Iniciar cámara ──────────────────────────────────────────
  const startCamera = useCallback(async (facing = 'environment') => {
    log(`startCamera(${facing}) llamado`);
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      log('tracks anteriores parados');
    }
    setError(null);
    setCameraReady(false);

    try {
      log('pidiendo getUserMedia...');
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode:  facing,
          width:       { ideal: 1920 },
          height:      { ideal: 1080 },
          aspectRatio: { ideal: 4/3 },
        },
        audio: false,
      });
      streamRef.current = stream;
      const tracks = stream.getVideoTracks();
      log(`stream OK: ${tracks.length} tracks, state=${tracks[0]?.readyState}`);
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
        log(`video.play() OK, paused=${videoRef.current.paused}`);
        setCameraReady(true);
      } else {
        log('ERROR: videoRef.current es null');
      }
    } catch (err) {
      log(`ERROR: ${err.name}: ${err.message}`);
      console.error('Error cámara:', err);
      if (err.name === 'NotAllowedError') {
        setError('Permiso de cámara denegado. Por favor, permite el acceso a la cámara en la configuración del navegador.');
      } else if (err.name === 'NotFoundError') {
        setError('No se encontró ninguna cámara en este dispositivo.');
      } else {
        setError(`Error de cámara: ${err.message}`);
      }
    }
  }, [log]);

  // ── Efecto único: controla cámara según preview + facingMode ──
  useEffect(() => {
    if (preview) {
      // Preview activa → parar cámara (ahorra batería, evita bug Android)
      log('preview activa → parando cámara');
      streamRef.current?.getTracks().forEach(t => t.stop());
      streamRef.current = null;
      setCameraReady(false);
      return;
    }
    // Sin preview → arrancar cámara fresca
    log(`useEffect: preview=null → arrancando cámara (facing=${facingMode})`);
    startCamera(facingMode);
    return () => {
      streamRef.current?.getTracks().forEach(t => t.stop());
    };
  }, [preview, facingMode, startCamera, log]);


  // ── Capturar foto ──────────────────────────────────────────
  const capture = useCallback(async () => {
    if (!cameraReady || !videoRef.current) return;
    const video  = videoRef.current;
    const canvas = canvasRef.current;
    canvas.width  = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d').drawImage(video, 0, 0);

    canvas.toBlob(async (blob) => {
      const previewUrl = URL.createObjectURL(blob);
      setPreview({ blob, previewUrl });
    }, 'image/jpeg', 0.95);
  }, [cameraReady]);

  // ── Confirmar foto capturada ──────────────────────────────
  const confirmCapture = useCallback(async () => {
    if (!preview) return;
    setCompressing(true);
    try {
      const compressed = await compressImage(preview.blob, { maxWidth: 1280, quality: 0.80 });
      const file       = blobToFile(compressed, `${currentTipo.key}.jpg`);

      const entry = {
        tipo:     currentTipo.key,
        label:    currentTipo.label,
        preview:  preview.previewUrl,
        file,
      };

      const newCaptured = [...captured, entry];
      setCaptured(newCaptured);
      setPreview(null);
      // NO reiniciamos cámara — sigue grabando debajo de la preview

      if (currentIndex + 1 >= IMAGEN_TIPOS.length) {
        onComplete(newCaptured);
      } else {
        setCurrentIndex(prev => prev + 1);
      }
    } finally {
      setCompressing(false);
    }
  }, [preview, currentTipo, captured, currentIndex, onComplete]);

  // ── Repetir captura ───────────────────────────────────────
  const retake = useCallback(() => {
    if (preview?.previewUrl) URL.revokeObjectURL(preview.previewUrl);
    setPreview(null);
    // Cámara sigue activa debajo, no hace falta reiniciar
  }, [preview]);

  // ── Toggle cámara frontal/trasera ─────────────────────────
  const toggleCamera = () => {
    setFacingMode(f => f === 'environment' ? 'user' : 'environment');
  };

  // ── Keyboard: space para capturar ─────────────────────────
  useEffect(() => {
    const h = (e) => { if (e.key === ' ' && !preview) { e.preventDefault(); capture(); } };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [capture, preview]);

  return (
    <div className="fixed inset-0 bg-black z-50 flex flex-col">
      {/* Canvas oculto para captura */}
      <canvas ref={canvasRef} className="hidden" />

      {/* ── Previsualización (encima, no reemplaza el video) ── */}
      {preview && (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-black">
          <img
            src={preview.previewUrl}
            alt="Previsualización"
            className="max-h-[70dvh] object-contain"
          />
          <div className="p-6 w-full flex flex-col gap-3">
            <p className="text-white text-center font-medium">{currentTipo.label}</p>
            <div className="flex gap-3">
              <button
                onClick={retake}
                className="flex-1 btn-secondary"
                disabled={compressing}
              >
                🔄 Repetir
              </button>
              <button
                onClick={confirmCapture}
                className="flex-1 btn-primary"
                disabled={compressing}
              >
                {compressing ? 'Procesando...' : '✓ Usar foto'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Visor de cámara (SIEMPRE montado, nunca se desmonta) ── */}
      <div className="flex-1 relative overflow-hidden">
        {error ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center p-6 text-center">
            <p className="text-4xl mb-4">📷</p>
            <p className="text-white text-sm leading-relaxed">{error}</p>
            <button onClick={onCancel} className="btn-secondary mt-6">Cancelar</button>
          </div>
        ) : (
          <>
            {/* Video feed — siempre en DOM */}
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className="w-full h-full object-cover"
            />

            {/* Silueta guía de encuadre */}
            {cameraReady && !preview && (
              <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                {SILUETAS[currentTipo.key] && (
                  <div className="w-[88%] max-w-sm drop-shadow-[0_0_6px_rgba(0,0,0,0.8)]">
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
                <div className="absolute top-4 left-0 right-0 flex items-center justify-between px-4">
                  <button onClick={onCancel} className="p-2 rounded-full bg-black/40 text-white">✕</button>
                  <div className="text-white text-center">
                    <p className="font-bold">{currentTipo.label}</p>
                    <p className="text-xs opacity-75">{currentIndex + 1} / {IMAGEN_TIPOS.length}</p>
                  </div>
                  <button onClick={toggleCamera} className="p-2 rounded-full bg-black/40 text-white">🔄</button>
                </div>

                {/* Miniaturas */}
                <div className="absolute top-16 left-0 right-0 flex justify-center gap-2 px-4">
                  {IMAGEN_TIPOS.map((tipo, i) => {
                    const done = captured.find(c => c.tipo === tipo.key);
                    return (
                      <div
                        key={tipo.key}
                        className={`w-8 h-8 rounded border-2 overflow-hidden
                          ${i === currentIndex ? 'border-primary-500 ring-2 ring-primary-300' :
                            done ? 'border-green-400' : 'border-white/30'}`}
                      >
                        {done
                          ? <img src={done.preview} alt={tipo.label} className="w-full h-full object-cover" />
                          : <div className={`w-full h-full ${i === currentIndex ? 'bg-primary-500/30' : 'bg-white/10'}`} />
                        }
                      </div>
                    );
                  })}
                </div>

                {/* Botón captura */}
                <div className="absolute bottom-8 left-0 right-0 flex justify-center">
                  <button
                    onClick={capture}
                    disabled={!cameraReady}
                    className="w-20 h-20 rounded-full bg-white border-4 border-primary-500
                               flex items-center justify-center shadow-2xl
                               active:scale-95 transition-transform disabled:opacity-50"
                    aria-label="Capturar foto"
                  >
                    <div className="w-14 h-14 rounded-full bg-primary-600" />
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
