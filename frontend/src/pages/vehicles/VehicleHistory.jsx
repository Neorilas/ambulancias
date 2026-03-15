/**
 * VehicleHistory.jsx
 * Historial de un vehículo con tres pestañas:
 *   📷 Fotos      — historial fotográfico agrupado por trabajo
 *   ⚠️ Incidencias — daños/averías registradas con responsable
 *   🔧 Revisiones  — ITV, ITS, mantenimiento, etc.
 *
 * Solo accesible para administradores y gestores.
 */
import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { vehiclesService } from '../../services/vehicles.service.js';
import { useNotification } from '../../context/NotificationContext.jsx';
import { PageLoading } from '../../components/common/LoadingSpinner.jsx';
import { formatDate, formatDateTime } from '../../utils/dateUtils.js';
import { getImageUrl } from '../../utils/imageUtils.js';
import { ESTADO_LABELS, ESTADO_COLORS } from '../../utils/constants.js';

// ── Labels ────────────────────────────────────────────────────────────────────

const TIPO_FOTO_LABELS = {
  frontal:           'Frontal',
  lateral_izquierdo: 'Lateral Izq.',
  lateral_derecho:   'Lateral Der.',
  trasera:           'Trasera',
  niveles_liquidos:  'Niveles',
  cuentakilometros:  'Cuentakm.',
  danos:             'Daños',
};

const GRAVEDAD_BADGE = {
  leve:     'bg-yellow-100 text-yellow-700',
  moderado: 'bg-orange-100 text-orange-700',
  grave:    'bg-red-100 text-red-700',
};

const ESTADO_INC_BADGE = {
  pendiente:    'bg-red-100 text-red-700',
  en_revision:  'bg-yellow-100 text-yellow-700',
  resuelto:     'bg-green-100 text-green-700',
};

const TIPO_INC_LABELS = {
  dano_exterior: 'Daño exterior',
  dano_interior: 'Daño interior',
  mecanico:      'Mecánico',
  fluido:        'Fluido',
  electrico:     'Eléctrico',
  otro:          'Otro',
};

const TIPO_REV_LABELS = {
  itv:               'ITV',
  its:               'ITS',
  mantenimiento:     'Mantenimiento',
  revision_preventiva: 'Revisión preventiva',
  reparacion:        'Reparación',
  otro:              'Otro',
};

const RESULTADO_BADGE = {
  aprobado:    'bg-green-100 text-green-700',
  rechazado:   'bg-red-100 text-red-700',
  condicionado:'bg-orange-100 text-orange-700',
  realizado:   'bg-blue-100 text-blue-700',
};

// ── Lightbox ──────────────────────────────────────────────────────────────────
function Lightbox({ foto, fotos, onClose }) {
  const [current, setCurrent] = useState(fotos.findIndex(f => f.id === foto.id));

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
    <div className="fixed inset-0 z-50 bg-black/90 flex flex-col items-center justify-center p-4" onClick={onClose}>
      <div className="relative max-w-3xl w-full" onClick={e => e.stopPropagation()}>
        <img src={getImageUrl(f.image_url)} alt={TIPO_FOTO_LABELS[f.tipo_imagen] || f.tipo_imagen}
          className="w-full max-h-[70vh] object-contain rounded-lg" />
        {current > 0 && (
          <button onClick={() => setCurrent(c => c - 1)}
            className="absolute left-2 top-1/2 -translate-y-1/2 bg-black/50 text-white rounded-full w-10 h-10 flex items-center justify-center text-xl hover:bg-black/80">‹</button>
        )}
        {current < fotos.length - 1 && (
          <button onClick={() => setCurrent(c => c + 1)}
            className="absolute right-2 top-1/2 -translate-y-1/2 bg-black/50 text-white rounded-full w-10 h-10 flex items-center justify-center text-xl hover:bg-black/80">›</button>
        )}
        <div className="mt-3 text-center text-white space-y-1">
          <p className="font-medium">{TIPO_FOTO_LABELS[f.tipo_imagen] || f.tipo_imagen}</p>
          <p className="text-sm text-neutral-300">
            {f.subido_por?.nombre} {f.subido_por?.apellidos} · {formatDateTime(f.fecha)}
          </p>
          <p className="text-xs text-neutral-400">{current + 1} / {fotos.length}</p>
        </div>
      </div>
      <div className="flex gap-2 mt-4 overflow-x-auto max-w-full pb-2">
        {fotos.map((fi, i) => (
          <button key={fi.id} onClick={e => { e.stopPropagation(); setCurrent(i); }}
            className={`flex-shrink-0 w-14 h-14 rounded overflow-hidden border-2 transition ${
              i === current ? 'border-primary-500' : 'border-transparent opacity-60 hover:opacity-100'
            }`}>
            <img src={getImageUrl(fi.image_url)} alt={fi.tipo_imagen} className="w-full h-full object-cover" />
          </button>
        ))}
      </div>
      <button onClick={onClose} className="absolute top-4 right-4 text-white text-3xl leading-none hover:text-neutral-300">×</button>
    </div>
  );
}

// ── Tarjeta de trabajo (tab Fotos) ────────────────────────────────────────────
function TrabajoCard({ trabajo }) {
  const [open, setOpen] = useState(true);
  const [lightboxFoto, setLightboxFoto] = useState(null);

  const kmDiff = trabajo.km_fin && trabajo.km_inicio ? trabajo.km_fin - trabajo.km_inicio : null;

  return (
    <div className="card overflow-hidden">
      <button className="w-full flex items-center justify-between gap-2 text-left" onClick={() => setOpen(o => !o)}>
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
              {trabajo.responsable_nombre && (
                <span className="text-xs bg-purple-100 text-purple-700 rounded-full px-2 py-0.5">
                  👤 {trabajo.responsable_nombre}
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
          {trabajo.trabajo_id && (
            <Link to={`/trabajos/${trabajo.trabajo_id}`} className="text-xs text-primary-600 hover:underline">
              Ver trabajo →
            </Link>
          )}
          {trabajo.fotos.length === 0 ? (
            <p className="text-sm text-neutral-400 text-center py-4">Sin fotografías</p>
          ) : (
            <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
              {trabajo.fotos.map(foto => (
                <button key={foto.id}
                  className="relative group aspect-square overflow-hidden rounded-lg border hover:border-primary-400 transition"
                  onClick={() => setLightboxFoto(foto)}>
                  <img src={getImageUrl(foto.image_url)} alt={TIPO_FOTO_LABELS[foto.tipo_imagen] || foto.tipo_imagen}
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200" loading="lazy" />
                  <div className="absolute bottom-0 left-0 right-0 bg-black/50 text-white text-[10px] text-center py-0.5 leading-tight">
                    {TIPO_FOTO_LABELS[foto.tipo_imagen] || foto.tipo_imagen}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
      {lightboxFoto && (
        <Lightbox foto={lightboxFoto} fotos={trabajo.fotos} onClose={() => setLightboxFoto(null)} />
      )}
    </div>
  );
}

// ── Tab Incidencias ───────────────────────────────────────────────────────────
function TabIncidencias({ vehicleId }) {
  const { notify } = useNotification();
  const [incidencias, setIncidencias] = useState([]);
  const [loading,     setLoading]     = useState(true);
  const [showForm,    setShowForm]    = useState(false);
  const [form,        setForm]        = useState({ tipo: 'dano_exterior', gravedad: 'leve', descripcion: '', trabajo_id: '' });
  const [saving,      setSaving]      = useState(false);
  const [updatingId,  setUpdatingId]  = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await vehiclesService.listIncidencias(vehicleId);
      setIncidencias(data);
    } catch { notify.error('Error al cargar incidencias'); }
    finally { setLoading(false); }
  }, [vehicleId]);

  useEffect(() => { load(); }, [load]);

  const handleCreate = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      await vehiclesService.createIncidencia(vehicleId, {
        tipo: form.tipo,
        gravedad: form.gravedad,
        descripcion: form.descripcion,
        trabajo_id: form.trabajo_id || undefined,
      });
      notify.success('Incidencia registrada');
      setShowForm(false);
      setForm({ tipo: 'dano_exterior', gravedad: 'leve', descripcion: '', trabajo_id: '' });
      load();
    } catch (err) {
      notify.error(err.response?.data?.message || 'Error al guardar');
    } finally { setSaving(false); }
  };

  const handleEstado = async (inc, nuevoEstado) => {
    setUpdatingId(inc.id);
    try {
      await vehiclesService.updateIncidencia(vehicleId, inc.id, { estado: nuevoEstado });
      notify.success('Estado actualizado');
      load();
    } catch { notify.error('Error al actualizar'); }
    finally { setUpdatingId(null); }
  };

  if (loading) return <PageLoading />;

  const pendientes = incidencias.filter(i => i.estado !== 'resuelto');
  const resueltas  = incidencias.filter(i => i.estado === 'resuelto');

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex gap-2 text-sm">
          <span className="badge bg-red-100 text-red-700">{pendientes.length} pendiente{pendientes.length !== 1 ? 's' : ''}</span>
          <span className="badge bg-green-100 text-green-700">{resueltas.length} resuelta{resueltas.length !== 1 ? 's' : ''}</span>
        </div>
        <button onClick={() => setShowForm(s => !s)} className="btn-primary text-sm">
          {showForm ? '✕ Cancelar' : '+ Nueva incidencia'}
        </button>
      </div>

      {/* Formulario nueva incidencia */}
      {showForm && (
        <form onSubmit={handleCreate} className="card space-y-3 border-primary-200 bg-primary-50/30">
          <h4 className="font-medium text-neutral-800">Nueva incidencia</h4>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-neutral-500 block mb-1">Tipo</label>
              <select className="input text-sm" value={form.tipo} onChange={e => setForm(f => ({ ...f, tipo: e.target.value }))}>
                {Object.entries(TIPO_INC_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-neutral-500 block mb-1">Gravedad</label>
              <select className="input text-sm" value={form.gravedad} onChange={e => setForm(f => ({ ...f, gravedad: e.target.value }))}>
                <option value="leve">Leve</option>
                <option value="moderado">Moderado</option>
                <option value="grave">Grave</option>
              </select>
            </div>
          </div>
          <div>
            <label className="text-xs text-neutral-500 block mb-1">Descripción *</label>
            <textarea className="input text-sm" rows={3} required
              placeholder="Describe el daño o incidencia..."
              value={form.descripcion}
              onChange={e => setForm(f => ({ ...f, descripcion: e.target.value }))} />
          </div>
          <div>
            <label className="text-xs text-neutral-500 block mb-1">ID trabajo asociado (opcional)</label>
            <input className="input text-sm" type="number" min="1" placeholder="ID del trabajo"
              value={form.trabajo_id}
              onChange={e => setForm(f => ({ ...f, trabajo_id: e.target.value }))} />
          </div>
          <div className="flex gap-2">
            <button type="submit" disabled={saving} className="btn-primary text-sm flex-1">
              {saving ? 'Guardando...' : 'Guardar incidencia'}
            </button>
          </div>
        </form>
      )}

      {/* Lista */}
      {incidencias.length === 0 ? (
        <div className="card text-center py-12 text-neutral-400">
          <p className="text-3xl mb-2">✅</p>
          <p className="text-sm">Sin incidencias registradas</p>
        </div>
      ) : (
        <div className="space-y-3">
          {incidencias.map(inc => (
            <div key={inc.id} className={`card space-y-2 ${inc.estado === 'resuelto' ? 'opacity-70' : ''}`}>
              <div className="flex items-start justify-between gap-2 flex-wrap">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={`badge text-xs ${GRAVEDAD_BADGE[inc.gravedad]}`}>
                    {inc.gravedad.charAt(0).toUpperCase() + inc.gravedad.slice(1)}
                  </span>
                  <span className="text-xs text-neutral-500 font-medium">{TIPO_INC_LABELS[inc.tipo] || inc.tipo}</span>
                  <span className={`badge text-xs ${ESTADO_INC_BADGE[inc.estado]}`}>{
                    inc.estado === 'pendiente' ? 'Pendiente' : inc.estado === 'en_revision' ? 'En revisión' : 'Resuelto'
                  }</span>
                </div>
                <span className="text-xs text-neutral-400">{formatDate(inc.created_at)}</span>
              </div>

              <p className="text-sm text-neutral-700">{inc.descripcion}</p>

              {/* Responsable y trabajo */}
              <div className="text-xs text-neutral-500 space-y-0.5">
                {inc.trabajo && (
                  <p>
                    🚑 <Link to={`/trabajos/${inc.trabajo.id}`} className="text-primary-600 hover:underline">
                      {inc.trabajo.referencia || `Trabajo #${inc.trabajo.id}`}
                    </Link>
                    {inc.trabajo.responsable_nombre && (
                      <> · Responsable: <strong className="text-neutral-700">{inc.trabajo.responsable_nombre}</strong></>
                    )}
                  </p>
                )}
                <p>Reportado por: {inc.reportado_por?.nombre} {inc.reportado_por?.apellidos}</p>
                {inc.resuelto_por && (
                  <p>Resuelto por: {inc.resuelto_por.nombre} {inc.resuelto_por.apellidos} · {formatDateTime(inc.resuelto_at)}</p>
                )}
              </div>

              {/* Acciones de estado */}
              {inc.estado !== 'resuelto' && (
                <div className="flex gap-2 pt-1 border-t border-neutral-100">
                  {inc.estado === 'pendiente' && (
                    <button
                      onClick={() => handleEstado(inc, 'en_revision')}
                      disabled={updatingId === inc.id}
                      className="btn-secondary text-xs"
                    >
                      Marcar en revisión
                    </button>
                  )}
                  <button
                    onClick={() => handleEstado(inc, 'resuelto')}
                    disabled={updatingId === inc.id}
                    className="btn-primary text-xs"
                  >
                    Marcar resuelta
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Tab Revisiones ────────────────────────────────────────────────────────────
function TabRevisiones({ vehicleId }) {
  const { notify } = useNotification();
  const [revisiones, setRevisiones] = useState([]);
  const [loading,    setLoading]    = useState(true);
  const [showForm,   setShowForm]   = useState(false);
  const [editRev,    setEditRev]    = useState(null);
  const [saving,     setSaving]     = useState(false);
  const [deletingId, setDeletingId] = useState(null);

  const emptyForm = { tipo: 'mantenimiento', fecha_revision: '', fecha_proxima: '', resultado: 'realizado', descripcion: '', coste: '', realizado_por: '' };
  const [form, setForm] = useState(emptyForm);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await vehiclesService.listRevisiones(vehicleId);
      setRevisiones(data);
    } catch { notify.error('Error al cargar revisiones'); }
    finally { setLoading(false); }
  }, [vehicleId]);

  useEffect(() => { load(); }, [load]);

  const openCreate = () => { setEditRev(null); setForm(emptyForm); setShowForm(true); };
  const openEdit   = (rev) => {
    setEditRev(rev);
    setForm({
      tipo:           rev.tipo,
      fecha_revision: rev.fecha_revision?.slice(0, 10) || '',
      fecha_proxima:  rev.fecha_proxima?.slice(0, 10) || '',
      resultado:      rev.resultado,
      descripcion:    rev.descripcion || '',
      coste:          rev.coste != null ? String(rev.coste) : '',
      realizado_por:  rev.realizado_por || '',
    });
    setShowForm(true);
  };

  const handleSave = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const payload = {
        tipo:          form.tipo,
        fecha_revision: form.fecha_revision,
        fecha_proxima: form.fecha_proxima || undefined,
        resultado:     form.resultado,
        descripcion:   form.descripcion || undefined,
        coste:         form.coste ? parseFloat(form.coste) : undefined,
        realizado_por: form.realizado_por || undefined,
      };
      if (editRev) {
        await vehiclesService.updateRevision(vehicleId, editRev.id, payload);
        notify.success('Revisión actualizada');
      } else {
        await vehiclesService.createRevision(vehicleId, payload);
        notify.success('Revisión registrada');
      }
      setShowForm(false);
      setEditRev(null);
      load();
    } catch (err) {
      notify.error(err.response?.data?.message || 'Error al guardar');
    } finally { setSaving(false); }
  };

  const handleDelete = async (id) => {
    if (!window.confirm('¿Eliminar esta revisión?')) return;
    setDeletingId(id);
    try {
      await vehiclesService.deleteRevision(vehicleId, id);
      notify.success('Revisión eliminada');
      load();
    } catch { notify.error('Error al eliminar'); }
    finally { setDeletingId(null); }
  };

  if (loading) return <PageLoading />;

  // Próximas revisiones con fecha_proxima en ≤ 30 días
  const hoy       = new Date();
  const proximas  = revisiones.filter(r => {
    if (!r.fecha_proxima) return false;
    const diff = (new Date(r.fecha_proxima) - hoy) / (1000 * 60 * 60 * 24);
    return diff <= 30;
  }).sort((a, b) => new Date(a.fecha_proxima) - new Date(b.fecha_proxima));

  return (
    <div className="space-y-4">
      {/* Alertas próximas revisiones */}
      {proximas.length > 0 && (
        <div className="space-y-2">
          {proximas.map(r => {
            const dias = Math.ceil((new Date(r.fecha_proxima) - hoy) / (1000 * 60 * 60 * 24));
            const vencida = dias < 0;
            return (
              <div key={r.id} className={`flex items-center gap-2 text-sm rounded-lg px-3 py-2 ${
                vencida ? 'bg-red-50 border border-red-200 text-red-700' : 'bg-yellow-50 border border-yellow-200 text-yellow-700'
              }`}>
                <span>⚠️</span>
                <span>
                  <strong>{TIPO_REV_LABELS[r.tipo] || r.tipo}</strong>
                  {' '}{vencida ? `vencida hace ${Math.abs(dias)} días` : `en ${dias} día${dias !== 1 ? 's' : ''}`}
                  {' '}({formatDate(r.fecha_proxima)})
                </span>
              </div>
            );
          })}
        </div>
      )}

      <div className="flex justify-end">
        <button onClick={openCreate} className="btn-primary text-sm">+ Nueva revisión</button>
      </div>

      {/* Formulario */}
      {showForm && (
        <form onSubmit={handleSave} className="card space-y-3 border-primary-200 bg-primary-50/30">
          <h4 className="font-medium text-neutral-800">{editRev ? 'Editar revisión' : 'Nueva revisión'}</h4>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-neutral-500 block mb-1">Tipo *</label>
              <select className="input text-sm" value={form.tipo} onChange={e => setForm(f => ({ ...f, tipo: e.target.value }))}>
                {Object.entries(TIPO_REV_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-neutral-500 block mb-1">Resultado</label>
              <select className="input text-sm" value={form.resultado} onChange={e => setForm(f => ({ ...f, resultado: e.target.value }))}>
                <option value="realizado">Realizado</option>
                <option value="aprobado">Aprobado</option>
                <option value="condicionado">Condicionado</option>
                <option value="rechazado">Rechazado</option>
              </select>
            </div>
            <div>
              <label className="text-xs text-neutral-500 block mb-1">Fecha revisión *</label>
              <input className="input text-sm" type="date" required
                value={form.fecha_revision}
                onChange={e => setForm(f => ({ ...f, fecha_revision: e.target.value }))} />
            </div>
            <div>
              <label className="text-xs text-neutral-500 block mb-1">Próxima revisión</label>
              <input className="input text-sm" type="date"
                value={form.fecha_proxima}
                onChange={e => setForm(f => ({ ...f, fecha_proxima: e.target.value }))} />
            </div>
            <div>
              <label className="text-xs text-neutral-500 block mb-1">Coste (€)</label>
              <input className="input text-sm" type="number" min="0" step="0.01" placeholder="0.00"
                value={form.coste}
                onChange={e => setForm(f => ({ ...f, coste: e.target.value }))} />
            </div>
            <div>
              <label className="text-xs text-neutral-500 block mb-1">Realizado por</label>
              <input className="input text-sm" type="text" placeholder="Taller / técnico"
                value={form.realizado_por}
                onChange={e => setForm(f => ({ ...f, realizado_por: e.target.value }))} />
            </div>
          </div>
          <div>
            <label className="text-xs text-neutral-500 block mb-1">Descripción / notas</label>
            <textarea className="input text-sm" rows={2} placeholder="Observaciones..."
              value={form.descripcion}
              onChange={e => setForm(f => ({ ...f, descripcion: e.target.value }))} />
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={() => { setShowForm(false); setEditRev(null); }}
              className="btn-secondary text-sm flex-1">Cancelar</button>
            <button type="submit" disabled={saving} className="btn-primary text-sm flex-1">
              {saving ? 'Guardando...' : editRev ? 'Actualizar' : 'Guardar'}
            </button>
          </div>
        </form>
      )}

      {/* Lista */}
      {revisiones.length === 0 ? (
        <div className="card text-center py-12 text-neutral-400">
          <p className="text-3xl mb-2">🔧</p>
          <p className="text-sm">Sin revisiones registradas</p>
        </div>
      ) : (
        <div className="space-y-3">
          {revisiones.map(rev => {
            const diasProxima = rev.fecha_proxima
              ? Math.ceil((new Date(rev.fecha_proxima) - hoy) / (1000 * 60 * 60 * 24))
              : null;
            return (
              <div key={rev.id} className="card space-y-2">
                <div className="flex items-start justify-between gap-2 flex-wrap">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-sm text-neutral-800">{TIPO_REV_LABELS[rev.tipo] || rev.tipo}</span>
                    <span className={`badge text-xs ${RESULTADO_BADGE[rev.resultado] || 'badge-gray'}`}>
                      {rev.resultado.charAt(0).toUpperCase() + rev.resultado.slice(1)}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <button onClick={() => openEdit(rev)} className="btn-ghost text-xs text-neutral-500">Editar</button>
                    <button onClick={() => handleDelete(rev.id)} disabled={deletingId === rev.id}
                      className="btn-ghost text-xs text-red-500 hover:bg-red-50">
                      {deletingId === rev.id ? '...' : '✕'}
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2 text-xs text-neutral-600">
                  <div>
                    <span className="text-neutral-400">Fecha: </span>
                    <span>{formatDate(rev.fecha_revision)}</span>
                  </div>
                  {rev.fecha_proxima && (
                    <div>
                      <span className="text-neutral-400">Próxima: </span>
                      <span className={diasProxima !== null && diasProxima <= 30
                        ? (diasProxima < 0 ? 'text-red-600 font-semibold' : 'text-yellow-600 font-semibold')
                        : ''}>
                        {formatDate(rev.fecha_proxima)}
                        {diasProxima !== null && diasProxima <= 30 && (
                          <> {diasProxima < 0 ? `(vencida ${Math.abs(diasProxima)}d)` : `(en ${diasProxima}d)`}</>
                        )}
                      </span>
                    </div>
                  )}
                  {rev.coste != null && (
                    <div>
                      <span className="text-neutral-400">Coste: </span>
                      <span>{Number(rev.coste).toLocaleString('es-ES', { style: 'currency', currency: 'EUR' })}</span>
                    </div>
                  )}
                  {rev.realizado_por && (
                    <div>
                      <span className="text-neutral-400">Por: </span>
                      <span>{rev.realizado_por}</span>
                    </div>
                  )}
                </div>

                {rev.descripcion && (
                  <p className="text-xs text-neutral-500 border-t pt-2 mt-1">{rev.descripcion}</p>
                )}

                <p className="text-[11px] text-neutral-400">
                  Registrado por {rev.creado_por_nombre} · {formatDate(rev.created_at)}
                </p>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Página principal ───────────────────────────────────────────────────────────
const TABS = [
  { key: 'fotos',       label: '📷 Fotos' },
  { key: 'incidencias', label: '⚠️ Incidencias' },
  { key: 'revisiones',  label: '🔧 Revisiones' },
];

export default function VehicleHistory() {
  const { id } = useParams();
  const navigate = useNavigate();

  const [tab,     setTab]     = useState('fotos');
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
    <div className="space-y-5 max-w-4xl mx-auto">
      {/* Cabecera */}
      <div className="flex items-center gap-3">
        <button onClick={() => navigate('/vehiculos')} className="btn-ghost text-neutral-500">← Volver</button>
        <div>
          <h1 className="text-xl font-bold text-neutral-900">Historial — {vehicle.alias}</h1>
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
          <p className="text-2xl font-bold text-neutral-900">{vehicle.kilometros_actuales?.toLocaleString()}</p>
          <p className="text-xs text-neutral-500 mt-1">Km actuales</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-neutral-100 p-1 rounded-lg">
        {TABS.map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`flex-1 text-sm font-medium py-1.5 px-3 rounded-md transition ${
              tab === t.key
                ? 'bg-white shadow text-neutral-900'
                : 'text-neutral-500 hover:text-neutral-700'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Contenido de cada tab */}
      {tab === 'fotos' && (
        trabajos.length === 0 ? (
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
        )
      )}

      {tab === 'incidencias' && <TabIncidencias vehicleId={id} />}

      {tab === 'revisiones' && <TabRevisiones vehicleId={id} />}
    </div>
  );
}
