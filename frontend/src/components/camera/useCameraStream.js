import { useRef, useState, useEffect, useCallback } from 'react';

/**
 * useCameraStream
 *
 * Gestiona el stream de cámara, la detección de orientación física
 * y el bloqueo programático de orientación por tipo de foto.
 *
 * @param {boolean} wantLandscape — el paso actual requiere orientación horizontal
 * @param {boolean} pause         — si true, para el stream (durante preview)
 */
export function useCameraStream({ wantLandscape = false, pause = false }) {
  const videoRef  = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);

  const [cameraReady, setCameraReady] = useState(false);
  const [error,       setError]       = useState(null);
  const [facingMode,  setFacingMode]  = useState('environment');

  // Orientación física: screen.orientation.type es el método más fiable;
  // refleja el ángulo real del dispositivo aunque el viewport esté bloqueado.
  const [isLandscape, setIsLandscape] = useState(() => {
    if (screen.orientation?.type) return screen.orientation.type.startsWith('landscape');
    if (typeof window.orientation !== 'undefined') return Math.abs(window.orientation) === 90;
    return window.matchMedia('(orientation: landscape)').matches;
  });

  // ── Escuchar cambios de orientación física ────────────────────
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
    }
    window.addEventListener('orientationchange', update);
    return () => window.removeEventListener('orientationchange', update);
  }, []);

  // ── Bloqueo programático de orientación ──────────────────────
  // En Android PWA fuerza la orientación correcta para el paso actual.
  // En iOS / navegadores sin soporte falla silenciosamente — la detección
  // por screen.orientation garantiza que la silueta se actualice igualmente.
  useEffect(() => {
    if (!screen.orientation?.lock) return;
    const target = wantLandscape ? 'landscape' : 'portrait';
    screen.orientation.lock(target).catch(() => {});
    return () => { screen.orientation.unlock?.(); };
  }, [wantLandscape]);

  // ── Arrancar cámara ──────────────────────────────────────────
  const startCamera = useCallback(async (facing) => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
    }
    setError(null);
    setCameraReady(false);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: facing, width: { ideal: 1920 }, height: { ideal: 1080 } },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
        setCameraReady(true);
      }
    } catch (err) {
      if (err.name === 'NotAllowedError')
        setError('Permiso de cámara denegado. Permite el acceso en la configuración del navegador.');
      else if (err.name === 'NotFoundError')
        setError('No se encontró ninguna cámara en este dispositivo.');
      else
        setError(`Error de cámara: ${err.message}`);
    }
  }, []);

  // ── Controlar cámara según pause y facingMode ─────────────────
  useEffect(() => {
    if (pause) {
      streamRef.current?.getTracks().forEach(t => t.stop());
      streamRef.current = null;
      setCameraReady(false);
      return;
    }
    startCamera(facingMode);
    return () => { streamRef.current?.getTracks().forEach(t => t.stop()); };
  }, [pause, facingMode, startCamera]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Captura: devuelve una Promise<Blob> ──────────────────────
  const captureBlob = useCallback(() => new Promise((resolve, reject) => {
    if (!cameraReady || !videoRef.current || !canvasRef.current) {
      return reject(new Error('Cámara no lista'));
    }
    const video  = videoRef.current;
    const canvas = canvasRef.current;
    canvas.width  = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d').drawImage(video, 0, 0);
    canvas.toBlob(
      blob => blob ? resolve(blob) : reject(new Error('Error al capturar')),
      'image/jpeg',
      0.95
    );
  }), [cameraReady]);

  const toggleCamera = useCallback(
    () => setFacingMode(f => f === 'environment' ? 'user' : 'environment'),
    []
  );

  return { videoRef, canvasRef, cameraReady, error, isLandscape, facingMode, toggleCamera, captureBlob };
}
