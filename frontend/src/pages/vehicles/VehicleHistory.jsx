/**
 * VehicleHistory.jsx
 * Historial fotográfico de un vehículo, agrupado por trabajo.
 * Solo accesible para administradores y gestores.
 */
import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { vehiclesService } from '../../services/vehicles.service.js';
import { PageLoading } from '../../components/common/LoadingSpinner.jsx';
import { formatDate, formatDateTime } from '../../utils/dateUtils.js';
import { getImageUrl } from '../../utils/imageUtils.js';
import { ESTADO_LABELS, ESTADO_COLORS } from '../../utils/constants.js';

const TIPO_LABELS = {
  frontal:           'Frontal',
  lateral_izquierdo: 'Lateral Izq.',
  lateral_derecho:   'Lateral Der.',
  trasera:           'Trasera',
  niveles_liquidos:  'Niveles',
  cuentakilometros:  'Cuentakm.',
  danos:             'Daños',
};

// ── Lightbox ──────────────────────────────────────────────────────────────────
function Lightbox({ foto, fotos, onClose }) {
  const idx = fotos.findIndex(f => f.id === foto.id);

  const prev = useCallback(() => {
    // handled via parent
  }, []);

  const [current, setCurrent] = useState(idx);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowRight') setCurrent(c => Math.min(c + 1, fotos.length - 1));
      if (e.key === 'ArrowLeft')  setCurrent(c => Math.max(c - 1, 0));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [fotos.length, onClose]);

  const f = fotos[current];

  return (
    <div
      className="fixed inset-0 z-50 bg-black/90 flex flex-col items-center justify-center p-4"
      onClick={onClose}
    >
      {/* Imagen */}
      <div
        className="relative max-w-3xl w-full"
        onClick={e => e.stopPropagation()}
      >
        <img
          src={getImageUrl(f.image_url)}
          alt={TIPO_LABELS[f.tipo_imagen] || f.tipo_imagen}
          className="w-full max-h-[70vh] object-contain rounded-lg"
        />

        {/* Navegación */}
        {current > 0 && (
          <button
            onClick={() => setCurrent(c => c - 1)}
            className="absolute left-2 top-1/2 -translate-y-1/2 bg-black/50 text-white rounded-full w-10 h-10 flex items-center justify-center text-xl hover:bg-black/80"
          >‹</button>
        )}
        {current < fotos.length - 1 && (
          <button
            onClick={() => setCurrent(c => c + 1)}
            className="absolute right-2 top-1/2 -translate-y-1/2 bg-black/50 text-white rounded-full w-10 h-10 flex items-center justify-center text-xl hover:bg-black/80"
          >›</button>
        )}

        {/* Info foto */}
        <div className="mt-3 text-center text-white space-y-1">
          <p className="font-medium">{TIPO_LABELS[f.tipo_imagen] || f.tipo_imagen}</p>
          <p className="text-sm text-neutral-300">
            {f.subido_por?.nombre} {f.subido_por?.apellidos}
            {' · '}{formatDateTime(f.fecha)}
          </p>
          <p className="text-xs text-neutral-400">{current + 1} / {fotos.length}</p>
        </div>
      </div>

      {/* Tira de miniaturas */}
      <div className="flex gap-2 mt-4 overflow-x-auto max-w-full pb-2">
        {fotos.map((fi, i) => (
          <button
            key={fi.id}
            onClick={e => { e.stopPropagation(); setCurrent(i); }}
            className={`flex-shrink-0 w-14 h-14 rounded overflow-hidden border-2 transition ${
              i === current ? 'border-primary-500' : 'border-transparent opacity-60 hover:opacity-100'
            }`}
          >
            <img
              src={getImageUrl(fi.image_url)}
              alt={fi.tipo_imagen}
              className="w-full h-full object-cover"
            />
          </button>
        ))}
      </div>

      {/* Cerrar */}
      <button
        onClick={onClose}
        className="absolute top-4 right-4 text-white text-3xl leading-none hover:text-neutral-300"
      >×</button>
    </div>
  );
}

// ── Tarjeta de trabajo ────────────────────────────────────────────────────────
function TrabajoCard({ trabajo }) {
  const [open, setOpen] = useState(true);
  const [lightboxFoto, setLightboxFoto] = useState(null);

  const kmDiff = trabajo.km_fin && trabajo.km_inicio
    ? trabajo.km_fin - trabajo.km_inicio
    : null;

  // Todas las fotos del trabajo para navegar en lightbox
  const todasFotos = trabajo.fotos;

  // Responsables únicos (subieron fotos)
  const responsables = [...new Map(
    trabajo.fotos
      .filter(f => f.subido_por?.id)
      .map(f => [f.subido_por.id, f.subido_por])
  ).values()];

  return (
    <div className="card overflow-hidden">
      {/* Cabecera colapsable */}
      <button
        className="w-full flex items-center justify-between gap-2 text-left"
        onClick={() => setOpen(o => !o)}
      >
        <div className="flex items-start gap-3 min-w-0">
          <span className="text-2xl mt-0.5">🚑</span>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-semibold text-neutral-900 text-sm">
                {trabajo.referencia || `Trabajo #${trabajo.trabajo_id}`}
              </span>
              {trabajo.estado && (
                <span className={`badge text-xs ${ESTADO_COLORS[trabajo.estado] || 'badge-yellow'}`}>
                  {ESTADO_LABELS[trabajo.estado] || trabajo.estado}
                </span>
              )}
            </div>
            <p className="text-xs text-neutral-500 mt-0.5">
              {trabajo.fecha_inicio ? formatDate(trabajo.fecha_inicio) : '—'}
              {trabajo.fecha_fin ? ` → ${formatDate(trabajo.fecha_fin)}` : ''}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-4 flex-shrink-0 text-right">
          {kmDiff !== null && (
            <div>
              <p className="text-xs text-neutral-400">Km recorridos</p>
              <p className="font-semibold text-sm">{kmDiff.toLocaleString()} km</p>
            </div>
          )}
          {trabajo.km_fin && (
            <div>
              <p className="text-xs text-neutral-400">Km fin</p>
              <p className="font-semibold text-sm">{trabajo.km_fin.toLocaleString()}</p>
            </div>
          )}
          <span className="text-neutral-400 text-lg">{open ? '▲' : '▼'}</span>
        </div>
      </button>

      {open && (
        <div className="mt-4 space-y-4 border-t pt-4">
          {/* Responsables */}
          {responsables.length > 0 && (
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs text-neutral-400 uppercase tracking-wide">Responsables:</span>
              {responsables.map(r => (
                <span key={r.id} className="text-xs bg-neutral-100 rounded-full px-2 py-0.5 font-medium text-neutral-700">
                  👤 {r.nombre} {r.apellidos}
                </span>
              ))}
              {trabajo.trabajo_id && (
                <Link
                  to={`/trabajos/${trabajo.trabajo_id}`}
                  className="text-xs text-primary-600 hover:underline ml-auto"
                  onClick={e => e.stopPropagation()}
                >
                  Ver trabajo →
                </Link>
              )}
            </div>
          )}

          {/* Grid de fotos */}
          {trabajo.fotos.length === 0 ? (
            <p className="text-sm text-neutral-400 text-center py-4">Sin fotografías</p>
          ) : (
            <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
              {trabajo.fotos.map(foto => (
                <button
                  key={foto.id}
                  className="relative group aspect-square overflow-hidden rounded-lg border hover:border-primary-400 transition"
                  onClick={() => setLightboxFoto(foto)}
                >
                  <img
                    src={getImageUrl(foto.image_url)}
                    alt={TIPO_LABELS[foto.tipo_imagen] || foto.tipo_imagen}
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200"
                    loading="lazy"
                  />
                  <div className="absolute bottom-0 left-0 right-0 bg-black/50 text-white text-[10px] text-center py-0.5 leading-tight">
                    {TIPO_LABELS[foto.tipo_imagen] || foto.tipo_imagen}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Lightbox */}
      {lightboxFoto && (
        <Lightbox
          foto={lightboxFoto}
          fotos={todasFotos}
          onClose={() => setLightboxFoto(null)}
        />
      )}
    </div>
  );
}

// ── Página principal ───────────────────────────────────────────────────────────
export default function VehicleHistory() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [data,    setData]    = useState(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState(null);

  useEffect(() => {
    vehiclesService.getHistory(id)
      .then(setData)
      .catch(err => setError(err.response?.data?.message || err.message))
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) return <PageLoading />;

  if (error) return (
    <div className="p-6 text-center">
      <p className="text-red-500 mb-4">{error}</p>
      <button onClick={() => navigate('/vehiculos')} className="btn-secondary">← Volver</button>
    </div>
  );

  const { vehicle, trabajos } = data;
  const totalFotos = trabajos.reduce((s, t) => s + t.fotos.length, 0);

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      {/* Cabecera */}
      <div className="flex items-center gap-3">
        <button onClick={() => navigate('/vehiculos')} className="btn-ghost text-neutral-500">
          ← Volver
        </button>
        <div>
          <h1 className="text-xl font-bold text-neutral-900">
            Historial — {vehicle.alias}
          </h1>
          <p className="text-sm text-neutral-500 font-mono">{vehicle.matricula}</p>
        </div>
      </div>

      {/* Resumen */}
      <div className="grid grid-cols-3 gap-3">
        <div className="card text-center py-3">
          <p className="text-2xl font-bold text-neutral-900">{trabajos.length}</p>
          <p className="text-xs text-neutral-500 mt-1">Trabajos con fotos</p>
        </div>
        <div className="card text-center py-3">
          <p className="text-2xl font-bold text-neutral-900">{totalFotos}</p>
          <p className="text-xs text-neutral-500 mt-1">Fotos totales</p>
        </div>
        <div className="card text-center py-3">
          <p className="text-2xl font-bold text-neutral-900">
            {trabajos.filter(t => t.km_fin).length}
          </p>
          <p className="text-xs text-neutral-500 mt-1">Con km registrados</p>
        </div>
      </div>

      {/* Lista de trabajos */}
      {trabajos.length === 0 ? (
        <div className="card text-center py-12 text-neutral-400">
          <p className="text-4xl mb-3">📷</p>
          <p>Aún no hay fotografías registradas para este vehículo.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {trabajos.map(t => (
            <TrabajoCard key={t.trabajo_id ?? 'sin_trabajo'} trabajo={t} />
          ))}
        </div>
      )}
    </div>
  );
}
