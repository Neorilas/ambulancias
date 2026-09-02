import React, { useState } from 'react';
import { vehiclesService } from '../../services/vehicles.service.js';
import { useNotification } from '../../context/NotificationContext.jsx';
import { formatDateTime } from '../../utils/dateUtils.js';

/**
 * Hilo de comentarios de una incidencia.
 *
 * Existe para que el administrador pueda añadir su versión sobre lo que ya
 * reportó el técnico. Antes, la única vía era registrar otra incidencia y el
 * mismo daño quedaba duplicado.
 *
 * @param {object}   props.inc        Incidencia (usa `id` y `comentarios`)
 * @param {number}   props.vehicleId  Vehículo al que pertenece
 * @param {boolean}  props.puedeComentar  Si se muestra el formulario
 * @param {Function} props.onSaved    Se llama tras guardar, para recargar
 */
export default function ComentariosIncidencia({ inc, vehicleId, puedeComentar, onSaved }) {
  const { notify } = useNotification();
  const [texto,   setTexto]   = useState('');
  const [abierto, setAbierto] = useState(false);
  const [saving,  setSaving]  = useState(false);

  const comentarios = inc.comentarios || [];

  const guardar = async (e) => {
    e.preventDefault();
    if (!texto.trim()) return;
    setSaving(true);
    try {
      await vehiclesService.addIncidenciaComentario(vehicleId, inc.id, texto.trim());
      notify.success('Comentario añadido');
      setTexto('');
      setAbierto(false);
      onSaved?.();
    } catch (err) {
      notify.error(err.response?.data?.message || 'Error al añadir el comentario');
    } finally {
      setSaving(false);
    }
  };

  if (!comentarios.length && !puedeComentar) return null;

  return (
    <div className="pt-2 border-t border-neutral-100 space-y-2">
      {comentarios.length > 0 && (
        <div className="space-y-2">
          <p className="text-[11px] font-semibold text-neutral-400 uppercase tracking-wide">
            Comentarios ({comentarios.length})
          </p>
          {comentarios.map(c => (
            <div key={c.id} className="rounded-lg bg-neutral-50 border border-neutral-100 px-2.5 py-2">
              <p className="text-sm text-neutral-700 whitespace-pre-line">{c.comentario}</p>
              <p className="text-[11px] text-neutral-400 mt-1">
                {c.autor ? `${c.autor.nombre} ${c.autor.apellidos || ''}`.trim() : 'Usuario eliminado'}
                {' · '}{formatDateTime(c.created_at)}
              </p>
            </div>
          ))}
        </div>
      )}

      {puedeComentar && !abierto && (
        <button onClick={() => setAbierto(true)} className="btn-secondary text-xs">
          Añadir comentario
        </button>
      )}

      {puedeComentar && abierto && (
        <form onSubmit={guardar} className="space-y-2">
          <textarea
            className="input text-sm" rows={3} autoFocus required
            placeholder="Añade información sobre esta incidencia…"
            value={texto}
            onChange={e => setTexto(e.target.value)}
          />
          <div className="flex gap-2">
            <button type="button" className="btn-secondary text-sm flex-1"
              onClick={() => { setAbierto(false); setTexto(''); }}>
              Cancelar
            </button>
            <button type="submit" disabled={saving || !texto.trim()} className="btn-primary text-sm flex-1">
              {saving ? 'Guardando…' : 'Guardar comentario'}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
