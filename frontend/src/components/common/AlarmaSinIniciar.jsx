/**
 * components/common/AlarmaSinIniciar.jsx
 *
 * Alarma SONORA para administradores: un servicio que lleva más de
 * `AVISO_SIN_INICIAR_MINUTOS` (30) pasado de su hora sin que nadie pulse
 * «Inicio de servicio».
 *
 * Complementa al aviso push, no lo sustituye. El push llega con la app
 * cerrada, pero suena UNA vez con el tono que el sistema tenga puesto, que no
 * se puede elegir desde una web (§2.5 del mapa). Esto otro solo funciona con
 * la app abierta —en primer plano en el móvil, o en una pestaña del
 * ordenador de la oficina— y ahí sí se controla el sonido: un «ding-dong»
 * suave generado con Web Audio (sin fichero que descargar ni cachear).
 *
 * Suena POCO y se calla solo: una campanada cada `CADA_MS` durante
 * `SONAR_MAX_MS`, y después el diálogo sigue en pantalla pero en silencio.
 * Solo vuelve a sonar si aparece una alarma nueva. Así una ventana olvidada
 * en segundo plano —o un panel oculto— no puede sonar sin fin sin que nadie
 * vea el botón para pararla (pasó probándolo).
 *
 * «Enterado» se propaga al resto de ventanas de la app en el mismo
 * dispositivo (evento `storage`) y quita la notificación del sistema de esas
 * asignaciones: con el acceso de la pantalla de inicio y una pestaña abiertos
 * a la vez, la otra seguía sonando hasta su siguiente consulta.
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
  CLAVE_ATENDIDAS,
  claveAlarma,
  tagAviso,
  alarmasPendientes,
  marcarAtendidas,
  etiquetaVehiculo,
  etiquetaResponsables,
  minutosDeRetraso,
} from '../../utils/alarmaSinIniciar.js';

const POLL_MS = 30 * 1000;

// Campanada: dos notas senoidales (sol → mi) con caída de campana. Suave a
// propósito: la pidieron menos agresiva que la sirena cuadrada del principio.
const NOTAS_HZ      = [784, 659];
const NOTA_S        = 0.9;    // lo que tarda en apagarse cada nota
const ENTRE_NOTAS_S = 0.35;
const VOLUMEN       = 0.25;
const CADA_MS       = 2000;   // una campanada cada 2 s…
const SONAR_MAX_MS  = 6000;   // …durante 6 s (3 campanadas), y silencio

function crearContextoAudio() {
  const Ctx = window.AudioContext || window.webkitAudioContext;
  return Ctx ? new Ctx() : null;
}

/** Programa una campanada «ding-dong» en el contexto. */
function sonarCampanada(ctx) {
  const t0 = ctx.currentTime + 0.05;
  NOTAS_HZ.forEach((hz, i) => {
    const osc  = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = hz;
    const ini = t0 + i * ENTRE_NOTAS_S;
    // Ataque corto y caída exponencial: suena a timbre, no a pitido.
    gain.gain.setValueAtTime(0.0001, ini);
    gain.gain.exponentialRampToValueAtTime(VOLUMEN, ini + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, ini + NOTA_S);
    osc.connect(gain).connect(ctx.destination);
    osc.start(ini);
    osc.stop(ini + NOTA_S);
  });
}

/** Quita de la bandeja la notificación push de esas alarmas, si sigue ahí. */
function cerrarNotificaciones(alarmas) {
  const tags = new Set(alarmas.map(tagAviso));
  Promise.resolve(navigator.serviceWorker?.getRegistration?.())
    .then(reg => reg?.getNotifications?.())
    .then(avisos => (avisos || []).forEach(n => { if (tags.has(n.tag)) n.close(); }))
    .catch(() => { /* sin SW o sin permiso: no hay nada que cerrar */ });
}

export default function AlarmaSinIniciar() {
  const { isAuthenticated, hasPermission } = useAuth();
  const activo = isAuthenticated && hasPermission(PERMISSIONS.MANAGE_TRABAJOS);

  const [vigentes, setVigentes]     = useState([]);   // lo que dice el servidor
  const [pendientes, setPendientes] = useState([]);   // lo que suena aquí
  const [bloqueado, setBloqueado]   = useState(false); // autoplay sin desbloquear

  const [sonido, setSonido]         = useState(false); // dentro de la ventana de sonido

  const ctxRef     = useRef(null);
  const sonadasRef = useRef(new Set());  // alarmas que ya han sonado aquí

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
    // «Enterado» pulsado en OTRA ventana de la app en este dispositivo.
    const alGuardar = (e) => {
      if (e.key && e.key.endsWith(CLAVE_ATENDIDAS)) setPendientes(p => alarmasPendientes(p));
    };
    window.addEventListener('storage', alGuardar);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', alVolver);
      navigator.serviceWorker?.removeEventListener?.('message', alMensaje);
      window.removeEventListener('storage', alGuardar);
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

  // Al desmontar (cerrar sesión) se libera el contexto: Chrome admite muy
  // pocos a la vez y cada login dejaría uno abierto.
  useEffect(() => () => {
    ctxRef.current?.close?.().catch(() => {});
    ctxRef.current = null;
  }, []);

  // ── El sonido ────────────────────────────────────────────
  const hayAlarma = pendientes.length > 0;

  // Solo se abre una ventana de sonido cuando aparece una alarma que aún no
  // ha sonado aquí; las consultas cada 30 s de la misma alarma no la reabren.
  useEffect(() => {
    if (!hayAlarma) { setSonido(false); return; }
    const nuevas = pendientes.filter(a => !sonadasRef.current.has(claveAlarma(a)));
    if (!nuevas.length) return;
    nuevas.forEach(a => sonadasRef.current.add(claveAlarma(a)));
    setSonido(true);
  }, [pendientes, hayAlarma]);

  useEffect(() => {
    if (!sonido) return undefined;

    const campanada = () => {
      if (!ctxRef.current) ctxRef.current = crearContextoAudio();
      const ctx = ctxRef.current;
      if (ctx && ctx.state === 'running') {
        setBloqueado(false);
        sonarCampanada(ctx);
      } else if (ctx) {
        ctx.resume?.().catch(() => {});
        setBloqueado(true);
      }
      // Vibración corta en Android; iOS no la implementa y la ignora.
      try { navigator.vibrate?.(200); } catch { /* sin vibración */ }
    };
    // Se cuentan las campanadas en vez de cortar con un setTimeout aparte:
    // el intervalo y el corte caerían en el mismo instante (a los 6 s) y cuál
    // gana es cosa del navegador — a veces sonaría una cuarta.
    const total = Math.ceil(SONAR_MAX_MS / CADA_MS);
    let dadas = 0;
    const tocar = () => {
      campanada();
      if (++dadas >= total) { clearInterval(repetir); setSonido(false); }
    };
    const repetir = setInterval(tocar, CADA_MS);
    tocar();

    return () => {
      clearInterval(repetir);
      try { navigator.vibrate?.(0); } catch { /* sin vibración */ }
    };
  }, [sonido]);

  const enterado = () => {
    marcarAtendidas(pendientes, vigentes);
    cerrarNotificaciones(pendientes);
    setPendientes([]);
  };

  const activarSonido = () => {
    if (!ctxRef.current) ctxRef.current = crearContextoAudio();
    ctxRef.current?.resume?.()
      .then(() => { setBloqueado(false); setSonido(true); })
      .catch(() => {});
  };

  if (!hayAlarma) return null;

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
