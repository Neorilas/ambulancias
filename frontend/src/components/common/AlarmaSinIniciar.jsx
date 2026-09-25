/**
 * components/common/AlarmaSinIniciar.jsx
 *
 * Alarma SONORA para administradores: un servicio que lleva más de
 * `AVISO_SIN_INICIAR_MINUTOS` (15) pasado de su hora sin que nadie pulse
 * «Inicio de servicio».
 *
 * Complementa al aviso push, no lo sustituye. El push llega con la app
 * cerrada, pero suena UNA vez con el tono que el sistema tenga puesto, que no
 * se puede elegir desde una web (§2.5 del mapa). Esto otro solo funciona con
 * la app abierta —en primer plano en el móvil, o en una pestaña del
 * ordenador de la oficina— y ahí sí se controla el sonido: una sirena de dos
 * tonos generada con Web Audio que se repite hasta que alguien pulsa
 * «Enterado», sin fichero de audio que descargar ni cachear.
 *
 * El navegador no deja sonar nada hasta que el usuario ha tocado la página
 * (política de autoplay). Por eso el contexto de audio se desbloquea con el
 * primer toque o tecla, y si la alarma salta antes de eso se pinta un botón
 * para activar el sonido en vez de fingir que está sonando.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext.jsx';
import { asignacionesService } from '../../services/asignaciones.service.js';
import { PERMISSIONS } from '../../utils/constants.js';
import { formatHora } from '../../utils/dateUtils.js';
import {
  alarmasPendientes,
  marcarAtendidas,
  etiquetaVehiculo,
  etiquetaResponsables,
  minutosDeRetraso,
} from '../../utils/alarmaSinIniciar.js';

const POLL_MS = 30 * 1000;

// Sirena: dos tonos alternos, fuerte pero no al máximo para no saturar el
// altavoz del móvil. Onda cuadrada porque se oye mucho más que una senoidal
// al mismo volumen.
const TONOS_HZ   = [880, 660];
const TONO_S     = 0.35;
const PAUSA_S    = 0.6;   // silencio entre ráfagas
const RAFAGA     = 4;     // tonos por ráfaga
const VOLUMEN    = 0.35;

function crearContextoAudio() {
  const Ctx = window.AudioContext || window.webkitAudioContext;
  return Ctx ? new Ctx() : null;
}

/** Programa una ráfaga de la sirena en el contexto y devuelve cuánto dura. */
function sonarRafaga(ctx) {
  const t0 = ctx.currentTime + 0.05;
  for (let i = 0; i < RAFAGA; i++) {
    const osc  = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'square';
    osc.frequency.value = TONOS_HZ[i % TONOS_HZ.length];
    const ini = t0 + i * TONO_S;
    // Rampa corta de entrada y salida: sin ella cada tono suena con un chasquido.
    gain.gain.setValueAtTime(0, ini);
    gain.gain.linearRampToValueAtTime(VOLUMEN, ini + 0.02);
    gain.gain.setValueAtTime(VOLUMEN, ini + TONO_S - 0.03);
    gain.gain.linearRampToValueAtTime(0, ini + TONO_S);
    osc.connect(gain).connect(ctx.destination);
    osc.start(ini);
    osc.stop(ini + TONO_S);
  }
  return RAFAGA * TONO_S + PAUSA_S;
}

export default function AlarmaSinIniciar() {
  const { isAuthenticated, hasPermission } = useAuth();
  const activo = isAuthenticated && hasPermission(PERMISSIONS.MANAGE_TRABAJOS);

  const [vigentes, setVigentes]     = useState([]);   // lo que dice el servidor
  const [pendientes, setPendientes] = useState([]);   // lo que suena aquí
  const [bloqueado, setBloqueado]   = useState(false); // autoplay sin desbloquear

  const ctxRef   = useRef(null);
  const timerRef = useRef(null);

  // ── Datos ────────────────────────────────────────────────
  const cargar = useCallback(async () => {
    try {
      const alarmas = await asignacionesService.alarmas();
      setVigentes(alarmas);
      setPendientes(alarmasPendientes(alarmas));
    } catch {
      // Sin red o sin permiso: se reintenta en el siguiente ciclo. No se
      // borra lo que estaba sonando por un fallo puntual de la conexión.
    }
  }, []);

  useEffect(() => {
    if (!activo) { setVigentes([]); setPendientes([]); return undefined; }
    cargar();
    const id = setInterval(cargar, POLL_MS);
    // Al volver a la app (p. ej. tocando el aviso push) no se espera al ciclo.
    const alVolver = () => { if (document.visibilityState === 'visible') cargar(); };
    document.addEventListener('visibilitychange', alVolver);
    // El service worker avisa cuando llega un push con la app abierta.
    const alMensaje = (e) => { if (e.data?.type === 'AVISO_PUSH') cargar(); };
    navigator.serviceWorker?.addEventListener?.('message', alMensaje);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', alVolver);
      navigator.serviceWorker?.removeEventListener?.('message', alMensaje);
    };
  }, [activo, cargar]);

  // ── Desbloqueo del audio con el primer gesto ─────────────
  useEffect(() => {
    if (!activo) return undefined;
    const desbloquear = () => {
      if (!ctxRef.current) ctxRef.current = crearContextoAudio();
      ctxRef.current?.resume?.().then(() => setBloqueado(false)).catch(() => {});
    };
    document.addEventListener('pointerdown', desbloquear);
    document.addEventListener('keydown', desbloquear);
    return () => {
      document.removeEventListener('pointerdown', desbloquear);
      document.removeEventListener('keydown', desbloquear);
    };
  }, [activo]);

  // ── La sirena ────────────────────────────────────────────
  const sonando = pendientes.length > 0;

  useEffect(() => {
    if (!sonando) return undefined;
    let parado = false;

    const ciclo = () => {
      if (parado) return;
      if (!ctxRef.current) ctxRef.current = crearContextoAudio();
      const ctx = ctxRef.current;
      let espera = 2000;
      if (ctx && ctx.state === 'running') {
        setBloqueado(false);
        espera = sonarRafaga(ctx) * 1000;
      } else if (ctx) {
        ctx.resume?.().catch(() => {});
        setBloqueado(true);
      }
      // Vibración en Android; iOS no la implementa y la ignora.
      try { navigator.vibrate?.([400, 150, 400]); } catch { /* sin vibración */ }
      timerRef.current = setTimeout(ciclo, espera);
    };
    ciclo();

    return () => {
      parado = true;
      clearTimeout(timerRef.current);
      try { navigator.vibrate?.(0); } catch { /* sin vibración */ }
    };
  }, [sonando]);

  const enterado = () => {
    marcarAtendidas(pendientes, vigentes);
    setPendientes([]);
  };

  const activarSonido = () => {
    if (!ctxRef.current) ctxRef.current = crearContextoAudio();
    ctxRef.current?.resume?.().then(() => setBloqueado(false)).catch(() => {});
  };

  if (!sonando) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4 safe-x">
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="alarma-sin-iniciar-titulo"
        className="w-full max-w-md rounded-2xl bg-white shadow-2xl ring-4 ring-bad-500"
      >
        <div className="rounded-t-2xl bg-bad-600 px-4 py-3 text-white">
          <h2 id="alarma-sin-iniciar-titulo" className="text-lg font-bold">
            {pendientes.length === 1 ? 'Servicio sin iniciar' : `${pendientes.length} servicios sin iniciar`}
          </h2>
          <p className="text-sm text-bad-50">
            Ha pasado la hora prevista y nadie ha pulsado «Inicio de servicio».
          </p>
        </div>

        <ul className="max-h-[50vh] divide-y divide-neutral-200 overflow-y-auto">
          {pendientes.map(a => (
            <li key={a.id} className="flex items-center justify-between gap-3 px-4 py-3">
              <div className="min-w-0">
                <div className="font-semibold text-neutral-900 truncate">{etiquetaVehiculo(a)}</div>
                <div className="text-sm text-neutral-600 truncate">{etiquetaResponsables(a)}</div>
                <div className="text-xs text-bad-700 font-mono">
                  Prevista {formatHora(a.fecha_inicio)} · {minutosDeRetraso(a.fecha_inicio)} min de retraso
                </div>
              </div>
              <Link
                to={`/asignaciones?id=${a.id}`}
                onClick={enterado}
                className="shrink-0 rounded-lg border border-neutral-300 px-3 py-1.5 text-sm font-medium text-neutral-800 hover:bg-neutral-100"
              >
                Ver
              </Link>
            </li>
          ))}
        </ul>

        <div className="flex flex-col gap-2 border-t border-neutral-200 p-4">
          {bloqueado && (
            <button
              type="button"
              onClick={activarSonido}
              className="w-full rounded-lg border border-bad-600 px-4 py-2 font-semibold text-bad-700 hover:bg-bad-50"
            >
              Activar sonido
            </button>
          )}
          <button
            type="button"
            onClick={enterado}
            className="w-full rounded-lg bg-bad-600 px-4 py-3 text-base font-bold text-white hover:bg-bad-700"
          >
            Enterado
          </button>
        </div>
      </div>
    </div>
  );
}
