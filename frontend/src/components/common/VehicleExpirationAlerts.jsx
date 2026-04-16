/**
 * components/common/VehicleExpirationAlerts.jsx
 *
 * Alertas flotantes de caducidad de documentos de vehículos
 * (ITV, ITS, Tarjeta de transporte) — SOLO visibles para
 * administradores y superadmin.
 *
 * Funcionamiento:
 *   - Consulta GET /vehicles/alertas al montar y cada 30 min.
 *   - Agrupa cada alerta en el mayor umbral alcanzado:
 *       60 → 45 → 30 → 15 → VENCIDA
 *   - Cada alerta puede cerrarse (X). La descarte se persiste
 *     en localStorage con la clave `alert_dismissed:<vid>:<tipo>:<threshold>`.
 *   - Cuando el vehículo cruza el siguiente umbral (p.ej. pasa de
 *     45 → 30 días) la alerta VUELVE a aparecer aunque se hubiera
 *     cerrado antes para el umbral anterior.
 *
 * Posición: bottom-right en desktop, top full-width en móvil.
 */

import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useAuth }           from '../../context/AuthContext.jsx';
import { vehiclesService }   from '../../services/vehicles.service.js';

const UMBRALES = [60, 45, 30, 15];
const POLL_MS  = 30 * 60 * 1000; // 30 minutos

const TIPO_LABEL = {
  itv:                'ITV',
  its:                'ITS',
  tarjeta_transporte: 'Tarjeta de transporte',
};

/**
 * Dado `dias_restantes`, devuelve el umbral "activo":
 *   - Si ya caducada (dias<0): 'vencida'
 *   - Si <=15: 15
 *   - Si <=30: 30
 *   - Si <=45: 45
 *   - Si <=60: 60
 *   - Si >60:  null (no se muestra)
 */
function thresholdFor(dias) {
  if (dias < 0)   return 'vencida';
  if (dias <= 15) return 15;
  if (dias <= 30) return 30;
  if (dias <= 45) return 45;
  if (dias <= 60) return 60;
  return null;
}

function dismissKey(a) {
  return `alert_dismissed:${a.vehicle_id}:${a.tipo}:${a.threshold}`;
}

function isDismissed(a) {
  try { return localStorage.getItem(dismissKey(a)) === '1'; }
  catch { return false; }
}

function markDismissed(a) {
  try { localStorage.setItem(dismissKey(a), '1'); }
  catch { /* storage bloqueado → ignoramos */ }
}

/**
 * Limpia del localStorage descartes obsoletos (umbral ya no activo
 * o vehículo que ya no está en la lista). Se ejecuta cada vez que
 * recibimos la lista del backend.
 */
function pruneDismissals(alertasActivas) {
  try {
    const vivas = new Set(alertasActivas.map(dismissKey));
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith('alert_dismissed:') && !vivas.has(k)) {
        localStorage.removeItem(k);
        i--; // el índice se desplaza tras remove
      }
    }
  } catch { /* ignore */ }
}

function AlertCard({ alerta, onDismiss }) {
  const { matricula, alias, tipo, fecha_caducidad, dias_restantes, threshold } = alerta;
  const vencida = threshold === 'vencida';

  const bg = vencida
    ? 'bg-red-50 border-red-300'
    : threshold === 15
      ? 'bg-orange-50 border-orange-300'
      : threshold === 30
        ? 'bg-yellow-50 border-yellow-300'
        : 'bg-blue-50 border-blue-300';

  const txtAcento = vencida
    ? 'text-red-700'
    : threshold === 15
      ? 'text-orange-700'
      : threshold === 30
        ? 'text-yellow-800'
        : 'text-blue-800';

  const fechaStr = new Date(fecha_caducidad).toLocaleDateString('es-ES');

  return (
    <div
      className={`relative ${bg} border rounded-xl shadow-lg p-3 pr-8 text-sm animate-slide-up`}
      role="alert"
    >
      <button
        onClick={() => onDismiss(alerta)}
        aria-label="Descartar alerta"
        className="absolute top-2 right-2 w-6 h-6 flex items-center justify-center rounded-full text-neutral-500 hover:bg-black/5 transition-colors"
      >
        ✕
      </button>

      <div className={`font-semibold ${txtAcento} flex items-center gap-1.5`}>
        <span>{vencida ? '⛔' : '⚠️'}</span>
        <span>
          {vencida
            ? `${TIPO_LABEL[tipo]} VENCIDA`
            : `${TIPO_LABEL[tipo]} caduca en ${dias_restantes}d`}
        </span>
      </div>

      <div className="mt-1 text-neutral-800">
        <Link
          to="/vehiculos"
          className="font-medium hover:underline"
        >
          {alias}
        </Link>
        <span className="text-neutral-500 font-mono ml-2">{matricula}</span>
      </div>

      <div className="text-xs text-neutral-500 mt-0.5">
        Caducidad: {fechaStr}
      </div>
    </div>
  );
}

export default function VehicleExpirationAlerts() {
  const { isAdmin, isSuperAdmin, isAuthenticated } = useAuth();
  const puedeVer = isAuthenticated && (isAdmin() || isSuperAdmin());

  const [alertas,   setAlertas]   = useState([]);
  const [collapsed, setCollapsed] = useState(false);

  const cargar = useCallback(async () => {
    if (!puedeVer) return;
    try {
      const data = await vehiclesService.listAlertas(60);
      setAlertas(Array.isArray(data) ? data : []);
    } catch {
      // Silencioso: no spamear al usuario con errores de polling
    }
  }, [puedeVer]);

  useEffect(() => {
    if (!puedeVer) return;
    cargar();
    const id = setInterval(cargar, POLL_MS);
    return () => clearInterval(id);
  }, [puedeVer, cargar]);

  // Aplicar threshold + filtrar descartadas
  const visibles = useMemo(() => {
    const conThreshold = alertas
      .map(a => ({ ...a, threshold: thresholdFor(a.dias_restantes) }))
      .filter(a => a.threshold !== null);

    pruneDismissals(conThreshold);

    return conThreshold.filter(a => !isDismissed(a));
  }, [alertas]);

  const handleDismiss = useCallback((alerta) => {
    markDismissed(alerta);
    setAlertas(prev => prev.map(x =>
      (x.vehicle_id === alerta.vehicle_id && x.tipo === alerta.tipo)
        ? { ...x, _dismissedAt: Date.now() }
        : x
    ));
  }, []);

  if (!puedeVer || visibles.length === 0) return null;

  return (
    <div
      className="
        fixed z-40 pointer-events-none
        bottom-4 right-4 left-4 sm:left-auto sm:w-80
      "
    >
      <div className="pointer-events-auto space-y-2">
        {/* Toggle plegado */}
        <div className="flex items-center justify-end">
          <button
            onClick={() => setCollapsed(v => !v)}
            className="text-xs px-2 py-1 rounded-full bg-neutral-800/90 text-white shadow hover:bg-neutral-900 transition-colors"
          >
            {collapsed ? `Ver ${visibles.length} alerta${visibles.length > 1 ? 's' : ''}` : 'Ocultar'}
          </button>
        </div>

        {!collapsed && (
          <div className="space-y-2 max-h-[70vh] overflow-y-auto pr-1">
            {visibles.map(a => (
              <AlertCard
                key={`${a.vehicle_id}:${a.tipo}:${a.threshold}`}
                alerta={a}
                onDismiss={handleDismiss}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
