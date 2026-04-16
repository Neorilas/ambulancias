/**
 * components/common/VehicleExpirationAlerts.jsx
 *
 * Alertas flotantes de caducidad de documentos de vehículos
 * (ITV, ITS, Tarjeta de transporte) — SOLO visibles para
 * administradores y superadmin.
 *
 * Posición: bottom-right en desktop, bottom full-width en móvil.
 * Cada alerta descartada persiste por umbral en localStorage
 * (ver utils/vehicleAlerts.js).
 */

import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useAuth }         from '../../context/AuthContext.jsx';
import { vehiclesService } from '../../services/vehicles.service.js';
import {
  TIPO_LABEL,
  TIPO_ICON,
  thresholdStyle,
  isDismissed,
  markDismissed,
  pruneDismissals,
  withThresholds,
} from '../../utils/vehicleAlerts.js';

const POLL_MS = 30 * 60 * 1000; // 30 minutos

function AlertCard({ alerta, onDismiss }) {
  const { matricula, alias, tipo, fecha_caducidad, dias_restantes, threshold } = alerta;
  const vencida = threshold === 'vencida';
  const style = thresholdStyle(threshold);

  const fechaStr = new Date(fecha_caducidad).toLocaleDateString('es-ES');

  return (
    <div
      className={`relative ${style.bg} border rounded-xl shadow-lg p-3 pr-8 text-sm animate-slide-up`}
      role="alert"
    >
      <button
        onClick={() => onDismiss(alerta)}
        aria-label="Descartar alerta"
        className="absolute top-2 right-2 w-6 h-6 flex items-center justify-center rounded-full text-neutral-500 hover:bg-black/5 transition-colors"
      >
        ✕
      </button>

      <div className={`font-semibold ${style.text} flex items-center gap-1.5`}>
        <span>{vencida ? '⛔' : '⚠️'}</span>
        <span>
          {vencida
            ? `${TIPO_LABEL[tipo]} VENCIDA`
            : `${TIPO_LABEL[tipo]} caduca en ${dias_restantes}d`}
        </span>
      </div>

      <div className="mt-1 text-neutral-800">
        <Link to="/alertas" className="font-medium hover:underline">
          {TIPO_ICON[tipo] || ''} {alias}
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
  const [tick,      setTick]      = useState(0); // fuerza recálculo tras dismiss

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

  const visibles = useMemo(() => {
    const conThreshold = withThresholds(alertas);
    pruneDismissals(conThreshold);
    return conThreshold.filter(a => !isDismissed(a));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [alertas, tick]);

  const handleDismiss = useCallback((alerta) => {
    markDismissed(alerta);
    setTick(t => t + 1);
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
        <div className="flex items-center justify-end gap-2">
          <Link
            to="/alertas"
            className="text-xs px-2 py-1 rounded-full bg-white/95 text-neutral-700 border border-neutral-200 shadow hover:bg-neutral-50 transition-colors"
          >
            Gestionar
          </Link>
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
