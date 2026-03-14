import React, { useRef, useState, useEffect, useCallback } from 'react';
import { compressImage, blobToFile } from '../../utils/imageCompress.js';
import { IMAGEN_TIPOS } from '../../utils/constants.js';

/**
 * CameraCapture
 * Componente de captura fotográfica con:
 * - Acceso directo a cámara (getUserMedia)
 * - Overlay con marco guía para encuadre
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
  const [debugLog,     setDebugLog]      = useState([]);
  const currentTipo = IMAGEN_TIPOS[currentIndex];

  const log = useCallback((msg) => {
    const ts = new Date().toLocaleTimeString('es', { hour12: false, fractionalSecondDigits: 1 });
    setDebugLog(prev => [...prev.slice(-8), `${ts} ${msg}`]);
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

      {/* Debug log (temporal — quitar en producción) */}
      {debugLog.length > 0 && (
        <div className="absolute top-28 left-2 right-2 z-50 bg-black/80 rounded p-2 max-h-40 overflow-y-auto">
          {debugLog.map((l, i) => (
            <p key={i} className="text-green-400 text-[10px] font-mono leading-tight">{l}</p>
          ))}
        </div>
      )}

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

            {/* Marco guía */}
            {cameraReady && !preview && (
              <div className="camera-guide">
                <div className="camera-frame" />
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
