/**
 * VehicleHistory.jsx
 * Ficha de un vehículo con cuatro pestañas:
 *   Resumen     — datos del vehículo, documentación y estado de incidencias
 *   Fotos       — historial fotográfico agrupado por trabajo
 *   Incidencias — daños/averías registradas con responsable
 *   Revisiones  — ITV, ITS, mantenimiento, etc.
 *
 * Solo accesible para administradores y gestores.
 */
import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate, useLocation, Link } from 'react-router-dom';
import { vehiclesService } from '../../services/vehicles.service.js';
import { usersService } from '../../services/users.service.js';
import { useNotification } from '../../context/NotificationContext.jsx';
import { PageLoading } from '../../components/common/LoadingSpinner.jsx';
import { formatDate, formatDateTime } from '../../utils/dateUtils.js';
import { getImageUrl } from '../../utils/imageUtils.js';
import { calcProximaITV, calcProximaITS, diasHasta } from '../../utils/vehicleAlerts.js';
import { ESTADO_LABELS, ESTADO_COLORS, ASIGNACION_ESTADO_LABELS, ASIGNACION_ESTADO_COLORS } from '../../utils/constants.js';

// ── Labels ────────────────────────────────────────────────────────────────────

const TIPO_FOTO_LABELS = {
  frontal:                'Frontal',
  lateral_izquierdo:      'Lateral Izq.',
  lateral_derecho:        'Lateral Der.',
  trasera:                'Trasera',
  nivel_aceite:           'Aceite',
  nivel_liquidos_general: 'Líquidos',
  niveles_liquidos:       'Niveles',
  cuentakilometros:       'Cuentakm.',
  danos:                  'Daños',
};

const GRAVEDAD_BADGE = {
  leve:     'bg-warn-50 text-warn-600',
  moderado: 'bg-warn-50 text-warn-600',
  grave:    'bg-bad-50 text-bad-600',
};

const ESTADO_INC_BADGE = {
  pendiente:    'bg-bad-50 text-bad-600',
  en_revision:  'bg-warn-50 text-warn-600',
  resuelto:     'bg-ok-50 text-ok-600',
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
  aprobado:    'bg-ok-50 text-ok-600',
  rechazado:   'bg-bad-50 text-bad-600',
  condicionado:'bg-warn-50 text-warn-600',
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

  const esAsignacion = trabajo.tipo === 'asignacion';
  const titulo = esAsignacion
    ? (trabajo.referencia || `Asignación #${trabajo.asignacion_id}`)
    : (trabajo.referencia || (trabajo.trabajo_id ? `Trabajo #${trabajo.trabajo_id}` : 'Fotos sueltas'));
  const estadoLabel  = esAsignacion ? ASIGNACION_ESTADO_LABELS : ESTADO_LABELS;
  const estadoColor  = esAsignacion ? ASIGNACION_ESTADO_COLORS : ESTADO_COLORS;
  // Las asignaciones libres no tienen página de detalle propia (se ven en un modal
  // desde el listado), así que solo enlazamos los trabajos.
  const detalleHref  = !esAsignacion && trabajo.trabajo_id ? `/trabajos/${trabajo.trabajo_id}` : null;

  return (
    <div className="card overflow-hidden">
      <button className="w-full flex items-center justify-between gap-2 text-left" onClick={() => setOpen(o => !o)}>
        <div className="flex items-start gap-3 min-w-0">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-semibold text-neutral-900 text-sm">
                {titulo}
              </span>
              {trabajo.estado && (
                <span className={`badge text-xs ${estadoColor[trabajo.estado] || 'badge-yellow'}`}>
                  {estadoLabel[trabajo.estado] || trabajo.estado}
                </span>
              )}
              {trabajo.responsable_nombre && (
                <span className="text-xs text-neutral-500">
                  {trabajo.responsable_nombre}
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
          {detalleHref && (
            <Link to={detalleHref} className="text-xs text-primary-600 hover:underline">
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
  const [users,       setUsers]       = useState([]);
  const [reasignId,   setReasignId]   = useState(null);
  const [reasignVal,  setReasignVal]  = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await vehiclesService.listIncidencias(vehicleId);
      setIncidencias(data);
    } catch { notify.error('Error al cargar incidencias'); }
    finally { setLoading(false); }
  }, [vehicleId]);

  useEffect(() => { load(); }, [load]);

  // Empleados a los que se puede atribuir una incidencia
  useEffect(() => {
    usersService.list({ limit: 300 })
      .then(r => setUsers(r.data || []))
      .catch(() => {/* el selector queda vacío; no bloquea la lista */});
  }, []);

  const abrirReasignar = (inc) => {
    setReasignId(inc.id);
    setReasignVal(inc.responsable?.id ? String(inc.responsable.id) : '');
  };

  const guardarResponsable = async (inc) => {
    setUpdatingId(inc.id);
    try {
      await vehiclesService.updateIncidencia(vehicleId, inc.id, {
        responsable_user_id: reasignVal ? parseInt(reasignVal) : null,
      });
      notify.success('Responsable actualizado');
      setReasignId(null);
      load();
    } catch (err) {
      notify.error(err.response?.data?.message || 'Error al reasignar');
    } finally { setUpdatingId(null); }
  };

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
          <span className="badge bg-bad-50 text-bad-600">{pendientes.length} pendiente{pendientes.length !== 1 ? 's' : ''}</span>
          <span className="badge bg-ok-50 text-ok-600">{resueltas.length} resuelta{resueltas.length !== 1 ? 's' : ''}</span>
        </div>
        <button onClick={() => setShowForm(s => !s)} className="btn-primary text-sm">
          {showForm ? 'Cancelar' : '+ Nueva incidencia'}
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
        <div className="empty">
          <p className="empty-title">Sin incidencias registradas</p>
          <p className="empty-hint">Este vehículo no tiene daños ni averías anotadas</p>
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

              {/* Responsable y origen */}
              <div className="text-xs text-neutral-500 space-y-0.5">
                {inc.trabajo && (
                  <p>
                    <Link to={`/trabajos/${inc.trabajo.id}`} className="text-primary-600 hover:underline">
                      {inc.trabajo.referencia || `Trabajo #${inc.trabajo.id}`}
                    </Link>
                  </p>
                )}
                {inc.asignacion_id && (
                  <p>Detectada en la asignación #{inc.asignacion_id}</p>
                )}
                <p>
                  Responsable: <strong className="text-neutral-700">
                    {inc.responsable
                      ? `${inc.responsable.nombre} ${inc.responsable.apellidos || ''}`.trim()
                      : 'Sin asignar'}
                  </strong>
                </p>
                <p>Reportado por: {inc.reportado_por?.nombre} {inc.reportado_por?.apellidos}</p>
                {inc.resuelto_por && (
                  <p>Resuelto por: {inc.resuelto_por.nombre} {inc.resuelto_por.apellidos} · {formatDateTime(inc.resuelto_at)}</p>
                )}
              </div>

              {/* Acciones de estado y responsable */}
              <div className="flex gap-2 flex-wrap pt-1 border-t border-neutral-100">
                {inc.estado === 'pendiente' && (
                  <button
                    onClick={() => handleEstado(inc, 'en_revision')}
                    disabled={updatingId === inc.id}
                    className="btn-secondary text-xs"
                  >
                    Marcar en revisión
                  </button>
                )}
                {inc.estado !== 'resuelto' && (
                  <button
                    onClick={() => handleEstado(inc, 'resuelto')}
                    disabled={updatingId === inc.id}
                    className="btn-primary text-xs"
                  >
                    Marcar resuelta
                  </button>
                )}
                {reasignId !== inc.id && (
                  <button onClick={() => abrirReasignar(inc)} className="btn-ghost text-xs">
                    Reasignar responsable
                  </button>
                )}
              </div>

              {reasignId === inc.id && (
                <div className="flex gap-2 items-end flex-wrap">
                  <div className="flex-1 min-w-[180px]">
                    <label className="text-xs text-neutral-500 block mb-1">Responsable</label>
                    <select className="input text-sm" value={reasignVal}
                      onChange={e => setReasignVal(e.target.value)}>
                      <option value="">Sin asignar</option>
                      {users.map(u => (
                        <option key={u.id} value={u.id}>
                          {u.nombre} {u.apellidos} (@{u.username})
                        </option>
                      ))}
                    </select>
                  </div>
                  <button onClick={() => setReasignId(null)} className="btn-secondary text-xs">Cancelar</button>
                  <button onClick={() => guardarResponsable(inc)} disabled={updatingId === inc.id}
                    className="btn-primary text-xs">
                    {updatingId === inc.id ? 'Guardando…' : 'Guardar'}
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
                vencida ? 'bg-bad-50 border border-bad-200 text-bad-600' : 'bg-warn-50 border border-warn-200 text-warn-600'
              }`}>
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
        <div className="empty">
          <p className="empty-title">Sin revisiones registradas</p>
          <p className="empty-hint">Aún no se ha anotado ninguna ITV, ITS ni mantenimiento</p>
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
                      className="btn-ghost btn-sm text-bad-600 hover:bg-bad-50">
                      {deletingId === rev.id ? '…' : 'Eliminar'}
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
                        ? (diasProxima < 0 ? 'text-bad-600 font-semibold' : 'text-warn-600 font-semibold')
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

// ── Tab Resumen (ficha del vehículo) ──────────────────────────────────────────

/** Fila etiqueta/valor de la ficha. */
function Dato({ label, children }) {
  return (
    <div>
      <p className="text-neutral-400 text-xs mb-0.5">{label}</p>
      <div className="text-sm text-neutral-900">{children ?? '—'}</div>
    </div>
  );
}

/** Fecha de caducidad con aviso de vencida / próxima. */
function FechaVencimiento({ proxima, umbralAviso = 30 }) {
  if (!proxima) return <span className="text-neutral-400">—</span>;
  const dias = diasHasta(proxima);
  const vencida = dias < 0;
  const avisa   = dias <= umbralAviso;
  return (
    <span className={vencida ? 'text-bad-600 font-medium' : avisa ? 'text-warn-600 font-medium' : ''}>
      {formatDate(proxima)}
      {avisa && (
        <span className="ml-1 text-xs">
          {vencida ? `(vencida hace ${Math.abs(dias)} d)` : `(en ${dias} d)`}
        </span>
      )}
    </span>
  );
}

function TabResumen({ vehicleId, historial, onVerIncidencias, onVerRevisiones, onVerFotos }) {
  const { notify } = useNotification();
  const [vehicle,     setVehicle]     = useState(null);
  const [incidencias, setIncidencias] = useState([]);
  const [revisiones,  setRevisiones]  = useState([]);
  const [loading,     setLoading]     = useState(true);

  useEffect(() => {
    let cancelado = false;
    setLoading(true);
    Promise.all([
      vehiclesService.get(vehicleId),
      vehiclesService.listIncidencias(vehicleId),
      vehiclesService.listRevisiones(vehicleId),
    ])
      .then(([veh, incs, revs]) => {
        if (cancelado) return;
        setVehicle(veh);
        setIncidencias(incs || []);
        setRevisiones(revs || []);
      })
      .catch(() => { if (!cancelado) notify.error('Error al cargar la ficha del vehículo'); })
      .finally(() => { if (!cancelado) setLoading(false); });
    return () => { cancelado = true; };
  }, [vehicleId]);

  if (loading) return <PageLoading />;
  if (!vehicle) return null;

  const proximaITV     = calcProximaITV(vehicle.fecha_matriculacion, vehicle.fecha_itv);
  const proximaITS     = calcProximaITS(vehicle.fecha_its);
  const proximaTarjeta = vehicle.fecha_tarjeta_transporte ? new Date(vehicle.fecha_tarjeta_transporte) : null;

  const pendientes  = incidencias.filter(i => i.estado === 'pendiente');
  const enRevision  = incidencias.filter(i => i.estado === 'en_revision');
  const resueltas   = incidencias.filter(i => i.estado === 'resuelto');
  const abiertas    = [...pendientes, ...enRevision];
  const ultimasInc  = incidencias.slice(0, 5);

  const ultimaRevision = revisiones[0] || null;
  const totalFotos = (historial?.trabajos || []).reduce((s, t) => s + t.fotos.length, 0);
  const totalServicios = (historial?.trabajos || []).length;

  const antiguedad = vehicle.fecha_matriculacion
    ? Math.floor((new Date() - new Date(vehicle.fecha_matriculacion)) / (1000 * 60 * 60 * 24 * 365.25))
    : null;

  return (
    <div className="space-y-4">
      {/* Datos generales */}
      <div className="card space-y-3">
        <h3 className="font-medium text-neutral-900 text-sm">Datos del vehículo</h3>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
          <Dato label="Matrícula"><span className="font-mono">{vehicle.matricula}</span></Dato>
          <Dato label="Alias">{vehicle.alias}</Dato>
          <Dato label="Kilómetros actuales">
            {vehicle.kilometros_actuales != null ? `${vehicle.kilometros_actuales.toLocaleString()} km` : null}
          </Dato>
          <Dato label="Fecha de matriculación">
            {vehicle.fecha_matriculacion ? formatDate(vehicle.fecha_matriculacion) : null}
          </Dato>
          <Dato label="Antigüedad">
            {antiguedad != null ? `${antiguedad} año${antiguedad !== 1 ? 's' : ''}` : null}
          </Dato>
          <Dato label="Último servicio">
            {vehicle.fecha_ultimo_servicio ? formatDate(vehicle.fecha_ultimo_servicio) : null}
          </Dato>
        </div>
      </div>

      {/* Documentación y vencimientos */}
      <div className="card space-y-3">
        <h3 className="font-medium text-neutral-900 text-sm">Documentación y vencimientos</h3>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
          <Dato label="Última ITV">{vehicle.fecha_itv ? formatDate(vehicle.fecha_itv) : null}</Dato>
          <Dato label="Próxima ITV"><FechaVencimiento proxima={proximaITV} /></Dato>
          <Dato label="Última ITS">{vehicle.fecha_its ? formatDate(vehicle.fecha_its) : null}</Dato>
          <Dato label="Próxima ITS"><FechaVencimiento proxima={proximaITS} /></Dato>
          <Dato label="Tarjeta de transporte">
            <FechaVencimiento proxima={proximaTarjeta} umbralAviso={60} />
          </Dato>
          <Dato label="Última revisión registrada">
            {ultimaRevision
              ? `${TIPO_REV_LABELS[ultimaRevision.tipo] || ultimaRevision.tipo} · ${formatDate(ultimaRevision.fecha_revision)}`
              : (vehicle.fecha_ultima_revision ? formatDate(vehicle.fecha_ultima_revision) : null)}
          </Dato>
        </div>
        <button onClick={onVerRevisiones} className="btn-secondary text-xs">
          Ver todas las revisiones ({revisiones.length})
        </button>
      </div>

      {/* Incidencias históricas */}
      <div className="card space-y-3">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <h3 className="font-medium text-neutral-900 text-sm">Incidencias históricas</h3>
          <div className="flex gap-2 text-xs">
            <span className="badge bg-bad-50 text-bad-600">{pendientes.length} pendiente{pendientes.length !== 1 ? 's' : ''}</span>
            <span className="badge bg-warn-50 text-warn-600">{enRevision.length} en revisión</span>
            <span className="badge bg-ok-50 text-ok-600">{resueltas.length} resuelta{resueltas.length !== 1 ? 's' : ''}</span>
          </div>
        </div>

        {incidencias.length === 0 ? (
          <p className="text-sm text-neutral-400 py-4 text-center">Sin incidencias registradas</p>
        ) : (
          <>
            {abiertas.length > 0 && (
              <p className="text-xs text-neutral-500">
                {abiertas.length} incidencia{abiertas.length !== 1 ? 's' : ''} sin resolver.
              </p>
            )}
            <div className="divide-y divide-neutral-100">
              {ultimasInc.map(inc => (
                <div key={inc.id} className="py-2 space-y-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={`badge text-xs ${GRAVEDAD_BADGE[inc.gravedad]}`}>
                      {inc.gravedad.charAt(0).toUpperCase() + inc.gravedad.slice(1)}
                    </span>
                    <span className="text-xs text-neutral-500">{TIPO_INC_LABELS[inc.tipo] || inc.tipo}</span>
                    <span className={`badge text-xs ${ESTADO_INC_BADGE[inc.estado]}`}>{
                      inc.estado === 'pendiente' ? 'Pendiente' : inc.estado === 'en_revision' ? 'En revisión' : 'Resuelto'
                    }</span>
                    <span className="text-xs text-neutral-400 ml-auto">{formatDate(inc.created_at)}</span>
                  </div>
                  <p className="text-sm text-neutral-700 line-clamp-2">{inc.descripcion}</p>
                  <p className="text-xs text-neutral-500">
                    Responsable: {inc.responsable
                      ? `${inc.responsable.nombre} ${inc.responsable.apellidos || ''}`.trim()
                      : 'Sin asignar'}
                    {' · '}Reportada por {inc.reportado_por?.nombre} {inc.reportado_por?.apellidos}
                  </p>
                </div>
              ))}
            </div>
            <button onClick={onVerIncidencias} className="btn-secondary text-xs">
              Ver todas las incidencias ({incidencias.length})
            </button>
          </>
        )}
      </div>

      {/* Actividad documentada */}
      <div className="card space-y-3">
        <h3 className="font-medium text-neutral-900 text-sm">Actividad documentada</h3>
        <div className="grid grid-cols-2 gap-4">
          <Dato label="Trabajos y asignaciones con fotos">{totalServicios}</Dato>
          <Dato label="Fotos registradas">{totalFotos}</Dato>
        </div>
        <button onClick={onVerFotos} className="btn-secondary text-xs">
          Ver historial fotográfico
        </button>
      </div>
    </div>
  );
}

// ── Página principal ───────────────────────────────────────────────────────────
const TABS = [
  { key: 'resumen',     label: 'Resumen' },
  { key: 'fotos',       label: 'Fotos' },
  { key: 'incidencias', label: 'Incidencias' },
  { key: 'revisiones',  label: 'Revisiones' },
];

export default function VehicleHistory() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { pathname } = useLocation();

  // /vehiculos/:id → ficha (resumen);  /vehiculos/:id/historial → fotos
  const [tab,     setTab]     = useState(pathname.endsWith('/historial') ? 'fotos' : 'resumen');
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
      <p className="text-bad-500 mb-4">{error}</p>
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
          <h1 className="text-[19px] font-semibold text-neutral-900">{vehicle.alias}</h1>
          <p className="text-sm text-neutral-500 font-mono">{vehicle.matricula}</p>
        </div>
      </div>

      {/* Resumen */}
      <div className="grid grid-cols-3 gap-3">
        <div className="card text-center py-3">
          <p className="text-[19px] font-semibold text-neutral-900">{trabajos.length}</p>
          <p className="text-xs text-neutral-500 mt-1">Trabajos con fotos</p>
        </div>
        <div className="card text-center py-3">
          <p className="text-[19px] font-semibold text-neutral-900">{totalFotos}</p>
          <p className="text-xs text-neutral-500 mt-1">Fotos totales</p>
        </div>
        <div className="card text-center py-3">
          <p className="text-[19px] font-semibold text-neutral-900">{vehicle.kilometros_actuales?.toLocaleString()}</p>
          <p className="text-xs text-neutral-500 mt-1">Km actuales</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="tabs">
        {TABS.map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={tab === t.key ? 'tab-active' : 'tab'}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Contenido de cada tab */}
      {tab === 'resumen' && (
        <TabResumen
          vehicleId={id}
          historial={data}
          onVerIncidencias={() => setTab('incidencias')}
          onVerRevisiones={() => setTab('revisiones')}
          onVerFotos={() => setTab('fotos')}
        />
      )}

      {tab === 'fotos' && (
        trabajos.length === 0 ? (
          <div className="empty">
            <p className="empty-title">Sin fotografías</p>
            <p className="empty-hint">Aún no se ha registrado ninguna foto de este vehículo</p>
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
