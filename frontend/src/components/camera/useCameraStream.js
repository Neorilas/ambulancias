import { useRef, useState, useEffect, useCallback } from 'react';

/**
 * useCameraStream
 *
 * Gestiona el stream de cámara, la detección de orientación física
 * y el bloqueo programático de orientación por tipo de foto.
 *
 * @param {boolean} wantLandscape — el paso actual requiere orientación horizontal
 * @param {boolean} pause         — si true, para el stream (durante preview)
 * @param {boolean} granAngular   — el paso es una foto exterior: se abre con la
 *                                  lente más ancha que ofrezca el móvil
 */

// La lente ultra gran angular se reconoce por la etiqueta: iPhone (Safari 17+)
// la lista aparte como «Back Ultra Wide Camera» / «Cámara ultra gran angular
// posterior». Las «Dual Wide»/«Triple» no son ella: llevan «Wide» sin «Ultra».
const ES_ULTRA = /ultra|0[.,]5\s*x/i;
const ES_FRONTAL = /front|frontal|delanter|user/i;
// undefined = no se ha mirado aún. Vale para toda la sesión de la página:
// así la segunda vez que se abre la cámara arranca ya con la lente buena.
let ultraCache;

async function buscarUltraGranAngular() {
  try {
    const devs = await navigator.mediaDevices.enumerateDevices?.();
    const ultra = (devs || []).find(d =>
      d.kind === 'videoinput' && ES_ULTRA.test(d.label || '') && !ES_FRONTAL.test(d.label || ''));
    return ultra?.deviceId || null;
  } catch { return null; }
}

export function useCameraStream({ wantLandscape = false, pause = false, granAngular = false }) {
  const videoRef  = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);
  // Cada arranque/parada lo incrementa: un getUserMedia que responde cuando ya
  // se ha pausado, girado o cerrado la cámara se descarta (si no, la cámara —y
  // la linterna— se quedaban encendidas con la previsualización puesta).
  const arranqueRef = useRef(0);
  // Zoom puesto por el gran angular. applyConstraints sustituye el conjunto
  // entero: el flash lo tiene que volver a pedir o lo deshace.
  const zoomRef = useRef(null);

  const [cameraReady, setCameraReady] = useState(false);
  const [error,       setError]       = useState(null);
  const [facingMode,  setFacingMode]  = useState('environment');
  // Flash = la linterna de la cámara encendida (constraint `torch`). La foto
  // es un fotograma del vídeo, no una foto de la app de cámara: no hay
  // destello en el disparo, así que la luz tiene que estar puesta al encuadrar.
  // Solo se ofrece si la cámara lo anuncia en getCapabilities(); en la frontal
  // y en los navegadores sin soporte (iPhone, según versión) no sale el botón.
  const [flashDisponible, setFlashDisponible] = useState(false);
  const [flash,           setFlash]           = useState(false);

  // Gran angular (2026-10-20). Con la lente principal, una ambulancia de lado
  // pide estar a 4-5 m; la app de cámara del móvil pasa sola al 0,5× y por eso
  // la nuestra «parecía con zoom». Dos vías, según lo que ofrezca el móvil:
  // (1) una cámara ultra gran angular aparte (iPhone) → se abre esa;
  // (2) un zoom mínimo por debajo del de arranque (Android con cámara lógica)
  // → se baja al mínimo. Solo en las exteriores: en el cuadro y los niveles,
  // de cerca, el ultra gran angular enfoca peor.
  // La elección del botón vale mientras no cambie el tipo de paso (exterior o
  // no); se deriva en el render, sin efecto, para no reabrir la cámara con un
  // valor viejo.
  const [eleccion,        setEleccion]        = useState({ granAngular, ancho: granAngular });
  const ancho = eleccion.granAngular === granAngular ? eleccion.ancho : granAngular;
  const anchoRef = useRef(ancho);
  anchoRef.current = ancho;
  const [ultraId,         setUltraId]         = useState(ultraCache);
  // Zoom del track actual, si deja abrir por debajo del de arranque. El zoom
  // se cambia en caliente: no hace falta reabrir la cámara.
  const [zoomTrack,       setZoomTrack]       = useState(null); // { min, inicial }
  const usarUltra = facingMode === 'environment' && ancho && !!ultraId;

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
  const startCamera = useCallback(async (facing, { ultra = null } = {}) => {
    const id = ++arranqueRef.current;
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
    }
    setError(null);
    setCameraReady(false);
    setFlashDisponible(false);
    setZoomTrack(null);
    zoomRef.current = null;
    try {
      // 4:3, el formato nativo del sensor (el de la app de cámara del móvil).
      // Pedir 16:9 (1920×1080) recorta el sensor: en vertical se pierde una
      // cuarta parte del ancho y los técnicos tenían que alejarse metros para
      // encuadrar la ambulancia. El aspectRatio desempata: sin él, 1920×1080
      // está «más cerca» de lo pedido que un 1440×1080 de sensor completo.
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          ...(ultra ? { deviceId: { exact: ultra } } : { facingMode: facing }),
          width: { ideal: 1920 }, height: { ideal: 1440 }, aspectRatio: { ideal: 4 / 3 },
        },
        audio: false,
      });
      if (id !== arranqueRef.current) {
        stream.getTracks().forEach(t => t.stop());
        return;
      }
      streamRef.current = stream;
      const track = stream.getVideoTracks?.()[0];
      const caps = track?.getCapabilities?.() || {};
      setFlashDisponible(!!caps.torch);
      if (!ultra && facing === 'environment' && caps.zoom?.min != null) {
        const actual = track.getSettings?.()?.zoom ?? 1;
        if (caps.zoom.min < actual) {
          setZoomTrack({ min: caps.zoom.min, inicial: actual });
          if (anchoRef.current) {
            zoomRef.current = caps.zoom.min;
            track.applyConstraints({ advanced: [{ zoom: caps.zoom.min }] }).catch(() => {});
          }
        }
      }
      // Las etiquetas de las cámaras solo salen con el permiso ya dado: se
      // busca la ultra gran angular tras el primer arranque bueno.
      if (ultraCache === undefined && facing === 'environment') {
        buscarUltraGranAngular().then((u) => { ultraCache = u; setUltraId(u); });
      }
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
        if (id === arranqueRef.current) setCameraReady(true);
      }
    } catch (err) {
      if (id !== arranqueRef.current) return;
      // La ultra gran angular no abre: se vuelve a la cámara de siempre, nunca
      // a un error. Solo se olvida para la sesión si no existe o no vale el id;
      // si es pasajero (otra app la tiene), la próxima vez se reintenta.
      if (ultra) {
        if (err.name === 'OverconstrainedError' || err.name === 'NotFoundError') ultraCache = null;
        setUltraId(null);
        return;
      }
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
      arranqueRef.current++;
      streamRef.current?.getTracks().forEach(t => t.stop());
      streamRef.current = null;
      setCameraReady(false);
      return;
    }
    startCamera(facingMode, { ultra: usarUltra ? ultraId : null });
    return () => {
      arranqueRef.current++;
      streamRef.current?.getTracks().forEach(t => t.stop());
    };
  }, [pause, facingMode, usarUltra, startCamera]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Zoom del gran angular, en caliente ───────────────────────
  // Al pulsar 0,5× o cambiar de paso con el mismo track. El arranque ya deja
  // puesto el que toca; esto solo actúa si cambia. Lleva el flash para no
  // apagarlo (applyConstraints sustituye el conjunto entero).
  useEffect(() => {
    if (!zoomTrack || usarUltra) return;
    const quiere = ancho ? zoomTrack.min : null;
    if (quiere === zoomRef.current) return;
    const track = streamRef.current?.getVideoTracks?.()[0];
    if (!track) return;
    zoomRef.current = quiere;
    const torch = flashDisponible ? [{ torch: flash }] : [];
    track.applyConstraints({ advanced: [...torch, { zoom: quiere ?? zoomTrack.inicial }] }).catch(() => {});
  }, [ancho, zoomTrack, usarUltra]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Flash (linterna) ─────────────────────────────────────────
  // Se reaplica cada vez que la cámara arranca: el stream se para durante la
  // previsualización y al girar de cámara, y al parar el track la linterna se
  // apaga sola. Así el flash sigue puesto de una foto a la siguiente.
  // `advanced` es «lo que se pueda»: no rechaza si el móvil no lo aplica. Si
  // la luz no se ha encendido de verdad, el botón vuelve a «apagado» en vez de
  // mentir.
  useEffect(() => {
    if (!cameraReady || !flashDisponible) return;
    const track = streamRef.current?.getVideoTracks?.()[0];
    if (!track) return;
    const zoom = zoomRef.current != null ? [{ zoom: zoomRef.current }] : [];
    track.applyConstraints({ advanced: [{ torch: flash }, ...zoom] })
      .then(() => { if (flash && track.getSettings?.().torch === false) setFlash(false); })
      .catch(() => { if (flash) setFlash(false); });
  }, [cameraReady, flashDisponible, flash]);

  const toggleFlash = useCallback(() => setFlash(f => !f), []);
  const toggleAncho = useCallback(
    () => setEleccion({ granAngular, ancho: !ancho }),
    [granAngular, ancho]
  );

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

  // ── Cómo se ajusta la imagen al visor y qué parte se ve ───────
  // Regla: el visor nunca recorta los lados (el ancho es lo que hace falta
  // para que quepa la ambulancia). Si la pantalla es más apaisada que la
  // imagen (móvil en horizontal), se llena (`cubre`) y solo se pierde algo de
  // arriba y abajo, que la foto guardada sí lleva. Si no (vertical), se
  // enseña entera (contain) con franjas arriba y abajo.
  // `areaVideo` es la parte visible de la imagen, y la silueta se mide sobre
  // ella: medida sobre la pantalla, con franjas a los lados, la de los
  // laterales salía más ancha que la foto.
  const [areaVideo, setAreaVideo] = useState(null);
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const medir = () => {
      const { clientWidth: cw, clientHeight: ch, videoWidth: vw, videoHeight: vh } = v;
      if (!cw || !ch || !vw || !vh) return setAreaVideo(null);
      const cubre = cw / ch >= vw / vh;
      const escala = cubre ? cw / vw : Math.min(cw / vw, ch / vh);
      const width = Math.min(Math.round(vw * escala), cw);
      const height = Math.min(Math.round(vh * escala), ch);
      setAreaVideo(a => (a?.width === width && a?.height === height && a?.cubre === cubre
        ? a : { width, height, cubre }));
    };
    medir();
    v.addEventListener('loadedmetadata', medir);
    v.addEventListener('resize', medir);   // el fotograma cambia de forma al girar en iOS
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(medir) : null;
    ro?.observe(v);
    return () => {
      v.removeEventListener('loadedmetadata', medir);
      v.removeEventListener('resize', medir);
      ro?.disconnect();
    };
  }, [cameraReady]);

  const toggleCamera = useCallback(
    () => setFacingMode(f => f === 'environment' ? 'user' : 'environment'),
    []
  );

  return { videoRef, canvasRef, cameraReady, error, isLandscape, facingMode, areaVideo, toggleCamera, captureBlob,
           flash, flashDisponible: flashDisponible && cameraReady, toggleFlash,
           ancho, anchoDisponible: cameraReady && facingMode === 'environment' && (!!ultraId || !!zoomTrack),
           toggleAncho };
}
