import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { trabajosService } from '../../services/trabajos.service.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { useNotification } from '../../context/NotificationContext.jsx';
import { EstadoBadge, TipoBadge, RolBadge } from '../../components/common/StatusBadge.jsx';
import { PageLoading } from '../../components/common/LoadingSpinner.jsx';
import { formatDateTime, duration } from '../../utils/dateUtils.js';
import { TRABAJO_ESTADOS } from '../../utils/constants.js';
import { getImageUrl } from '../../utils/imageUtils.js';
import Finalizacion from './Finalizacion.jsx';
import TrabajoForm from './TrabajoForm.jsx';

const TIPO_LABELS = {
  frontal:           'Frontal',
  lateral_izquierdo: 'Lateral Izq.',
  lateral_derecho:   'Lateral Der.',
  trasera:           'Trasera',
  niveles_liquidos:  'Niveles',
  cuentakilometros:  'Cuentakm.',
  danos:             'Daños',
};

// ── Lightbox modal ────────────────────────────────────────────────────────────
function Lightbox({ img, allImgs, onClose }) {
  const [idx, setIdx] = useState(() => allImgs.findIndex(i => i.id === img.id));

  useEffect(() => {
    const handler = (e) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowRight') setIdx(i => Math.min(i + 1, allImgs.length - 1));
      if (e.key === 'ArrowLeft')  setIdx(i => Math.max(i - 1, 0));
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [allImgs.length, onClose]);

  const current = allImgs[idx];
  const url     = getImageUrl(current.image_url);

  return (
    <div
      className="fixed inset-0 z-50 bg-black/92 flex flex-col items-center justify-center p-4"
      onClick={onClose}
    >
      {/* Imagen */}
      <div className="relative max-w-4xl w-full" onClick={e => e.stopPropagation()}>
        <img
          src={url}
          alt={TIPO_LABELS[current.tipo_imagen] || current.tipo_imagen}
          className="w-full max-h-[75dvh] object-contain rounded-lg select-none"
        />

        {/* Prev / Next */}
        {idx > 0 && (
          <button
            onClick={() => setIdx(i => i - 1)}
            className="absolute left-2 top-1/2 -translate-y-1/2 bg-black/60 hover:bg-black/90 text-white rounded-full w-10 h-10 flex items-center justify-center text-xl transition"
          >‹</button>
        )}
        {idx < allImgs.length - 1 && (
          <button
            onClick={() => setIdx(i => i + 1)}
            className="absolute right-2 top-1/2 -translate-y-1/2 bg-black/60 hover:bg-black/90 text-white rounded-full w-10 h-10 flex items-center justify-center text-xl transition"
          >›</button>
        )}

        {/* Info */}
        <div className="mt-3 flex items-center justify-between text-white text-sm px-1">
          <div className="space-y-0.5">
            <p className="font-medium">{TIPO_LABELS[current.tipo_imagen] || current.tipo_imagen}</p>
            {current.matricula && (
              <p className="text-neutral-400 text-xs font-mono">{current.matricula}</p>
            )}
          </div>
          <div className="flex items-center gap-3">
            <span className="text-neutral-400 text-xs">{idx + 1} / {allImgs.length}</span>
            {/* Descargar */}
            <a
              href={url}
              download
              onClick={e => e.stopPropagation()}
              className="text-xs bg-white/10 hover:bg-white/20 px-3 py-1.5 rounded-lg transition"
            >
              ⬇ Descargar
            </a>
          </div>
        </div>
      </div>

      {/* Tira de miniaturas */}
      {allImgs.length > 1 && (
        <div className="flex gap-2 mt-4 overflow-x-auto max-w-full pb-1">
          {allImgs.map((im, i) => (
            <button
              key={im.id}
              onClick={e => { e.stopPropagation(); setIdx(i); }}
              className={`flex-shrink-0 w-14 h-14 rounded overflow-hidden border-2 transition ${
                i === idx ? 'border-primary-400' : 'border-transparent opacity-50 hover:opacity-80'
              }`}
            >
              <img
                src={getImageUrl(im.image_url)}
                alt={im.tipo_imagen}
                className="w-full h-full object-cover"
              />
            </button>
          ))}
        </div>
      )}

      {/* Cerrar */}
      <button
        onClick={onClose}
        className="absolute top-4 right-4 text-white/70 hover:text-white text-3xl leading-none transition"
      >
        ×
      </button>
    </div>
  );
}

// ── Página principal ───────────────────────────────────────────────────────────
export default function TrabajoDetail() {
  const { id }  = useParams();
  const navigate = useNavigate();
  const { canManageTrabajos, isAdmin, user } = useAuth();
  const { notify } = useNotification();

  const [trabajo,    setTrabajo]    = useState(null);
  const [loading,    setLoading]    = useState(true);
  const [showFin,    setShowFin]    = useState(false);
  const [showEdit,   setShowEdit]   = useState(false);
  const [lightboxImg, setLightboxImg] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const t = await trabajosService.get(id);
      setTrabajo(t);
    } catch {
      notify.error('Error al cargar el trabajo');
      navigate('/trabajos');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  if (loading) return <PageLoading />;
  if (!trabajo) return null;

  const finalizado     = [TRABAJO_ESTADOS.FINALIZADO, TRABAJO_ESTADOS.FINALIZADO_ANTICIPADO].includes(trabajo.estado);
  const soyResponsable = trabajo.vehiculos?.some(v => v.responsable_user_id === user?.id);
  const allEvidencias  = trabajo.evidencias || [];

  if (showFin) {
    return (
      <Finalizacion
        trabajo={trabajo}
        onDone={() => { setShowFin(false); load(); }}
        onCancel={() => setShowFin(false)}
      />
    );
  }

  return (
    <div className="space-y-5 animate-fade-in max-w-3xl">
      {/* Header */}
      <div className="flex items-start gap-3">
        <button onClick={() => navigate('/trabajos')} className="btn-ghost btn-icon mt-1">‹</button>
        <div className="flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-xl font-bold text-neutral-900">{trabajo.nombre}</h1>
            <EstadoBadge estado={trabajo.estado} />
            <TipoBadge tipo={trabajo.tipo} />
          </div>
          <p className="text-neutral-500 text-sm mt-0.5">{trabajo.identificador}</p>
        </div>
        <div className="flex gap-2">
          {canManageTrabajos() && !finalizado && (
            <button onClick={() => setShowEdit(true)} className="btn-secondary text-sm">Editar</button>
          )}
          {!finalizado && (soyResponsable || canManageTrabajos()) && (
            <button onClick={() => setShowFin(true)} className="btn-primary text-sm">
              Finalizar
            </button>
          )}
        </div>
      </div>

      {/* Fechas */}
      <div className="card grid grid-cols-2 gap-4 text-sm">
        <div>
          <p className="text-neutral-500 text-xs">Inicio</p>
          <p className="font-medium">{formatDateTime(trabajo.fecha_inicio)}</p>
        </div>
        <div>
          <p className="text-neutral-500 text-xs">Fin previsto</p>
          <p className="font-medium">{formatDateTime(trabajo.fecha_fin)}</p>
        </div>
        <div>
          <p className="text-neutral-500 text-xs">Duración</p>
          <p className="font-medium">{duration(trabajo.fecha_inicio, trabajo.fecha_fin)}</p>
        </div>
        <div>
          <p className="text-neutral-500 text-xs">Creado por</p>
          <p className="font-medium">{trabajo.creado_por_nombre} {trabajo.creado_por_apellidos}</p>
        </div>
      </div>

      {/* Motivo finalización anticipada */}
      {trabajo.motivo_finalizacion_anticipada && (
        <div className="card bg-yellow-50 border-yellow-200">
          <p className="text-xs font-semibold text-yellow-800 mb-1">Motivo finalización anticipada:</p>
          <p className="text-sm text-yellow-700">{trabajo.motivo_finalizacion_anticipada}</p>
        </div>
      )}

      {/* Vehículos */}
      {trabajo.vehiculos?.length > 0 && (
        <div className="card space-y-3">
          <h2 className="font-semibold text-neutral-900">Vehículos asignados</h2>
          {trabajo.vehiculos.map(v => (
            <div key={v.vehicle_id} className="flex items-center justify-between p-3 bg-neutral-50 rounded-lg">
              <div>
                <p className="font-medium text-sm">{v.alias} <span className="font-mono text-neutral-500">({v.matricula})</span></p>
                <p className="text-xs text-neutral-500">Responsable: {v.responsable_nombre}</p>
                <p className="text-xs text-neutral-400">
                  Km inicio: {v.kilometros_inicio?.toLocaleString() || '—'}
                  {v.kilometros_fin ? ` → Km fin: ${v.kilometros_fin.toLocaleString()}` : ''}
                </p>
              </div>
              <span className="text-2xl">🚐</span>
            </div>
          ))}
        </div>
      )}

      {/* Personal */}
      {trabajo.usuarios?.length > 0 && (
        <div className="card space-y-2">
          <h2 className="font-semibold text-neutral-900">Personal asignado</h2>
          <div className="space-y-2">
            {trabajo.usuarios.map(u => (
              <div key={u.user_id} className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">{u.nombre} {u.apellidos}</p>
                  <p className="text-xs text-neutral-500">@{u.username}</p>
                </div>
                <div className="flex gap-1">
                  {u.roles?.map(r => <RolBadge key={r} rol={r} />)}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Evidencias fotográficas */}
      {allEvidencias.length > 0 && (
        <div className="card space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-neutral-900">Evidencias fotográficas</h2>
            <span className="text-xs text-neutral-400">{allEvidencias.length} foto{allEvidencias.length !== 1 ? 's' : ''}</span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {allEvidencias.map(img => (
              <div key={img.id} className="space-y-1">
                {/* Botón → abre lightbox, NO nueva pestaña */}
                <button
                  onClick={() => setLightboxImg(img)}
                  className="w-full group relative overflow-hidden rounded-lg border border-neutral-200 hover:border-primary-400 transition-colors"
                >
                  <img
                    src={getImageUrl(img.image_url)}
                    alt={TIPO_LABELS[img.tipo_imagen] || img.tipo_imagen}
                    className="w-full aspect-video object-cover group-hover:scale-105 transition-transform duration-200"
                    loading="lazy"
                  />
                  {/* Overlay lupa */}
                  <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors flex items-center justify-center">
                    <span className="text-white text-2xl opacity-0 group-hover:opacity-100 transition-opacity drop-shadow">🔍</span>
                  </div>
                </button>
                <p className="text-xs text-center text-neutral-500 capitalize">
                  {(TIPO_LABELS[img.tipo_imagen] || img.tipo_imagen)} · {img.matricula}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      {showEdit && (
        <TrabajoForm
          trabajo={trabajo}
          onSaved={() => { setShowEdit(false); load(); }}
          onClose={() => setShowEdit(false)}
        />
      )}

      {/* Lightbox */}
      {lightboxImg && (
        <Lightbox
          img={lightboxImg}
          allImgs={allEvidencias}
          onClose={() => setLightboxImg(null)}
        />
      )}
    </div>
  );
}
