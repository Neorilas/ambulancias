import React, { useState, useEffect } from 'react';
import { asignacionesService } from '../../services/asignaciones.service.js';
import { vehiclesService } from '../../services/vehicles.service.js';
import { usersService } from '../../services/users.service.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { useNotification } from '../../context/NotificationContext.jsx';
import { formatDateTime } from '../../utils/dateUtils.js';
import { getImageUrl } from '../../utils/imageUtils.js';
import {
  ASIGNACION_ESTADO_COLORS, ASIGNACION_ESTADO_LABELS,
  IMAGEN_TIPOS_INICIO, IMAGEN_TIPOS_FIN,
} from '../../utils/constants.js';
import ComentariosIncidencia from '../../components/common/ComentariosIncidencia.jsx';
import InicioAsignacion from './InicioAsignacion.jsx';
import FinalizacionAsignacion from './FinalizacionAsignacion.jsx';

const TIPO_INC_OPTS = [
  ['dano_exterior', 'Daño exterior'],
  ['dano_interior', 'Daño interior'],
  ['mecanico',      'Mecánico'],
  ['fluido',        'Fluido'],
  ['electrico',     'Eléctrico'],
  ['otro',          'Otro'],
];

const TIPO_INC_LABELS = Object.fromEntries(TIPO_INC_OPTS);

const GRAVEDAD_BADGE = {
  leve:     'bg-warn-50 text-warn-600',
  moderado: 'bg-warn-50 text-warn-600',
  grave:    'bg-bad-50 text-bad-600',
};

const ESTADO_INC_BADGE = {
  pendiente:   'bg-bad-50 text-bad-600',
  en_revision: 'bg-warn-50 text-warn-600',
  resuelto:    'bg-ok-50 text-ok-600',
};

const ESTADO_INC_LABELS = {
  pendiente:   'Pendiente',
  en_revision: 'En revisión',
  resuelto:    'Resuelto',
};

const nombreCompleto = (u) => (u ? [u.nombre, u.apellidos].filter(Boolean).join(' ') : '—');

/**
 * Ficha de una incidencia ya registrada en la asignación.
 * Muestra todos sus datos y, para admin/gestor, permite reclasificarla
 * (tipo / gravedad / estado) y reasignarla a cualquier empleado.
 */
function IncidenciaCard({ inc, vehicleId, users, canManage, onSaved }) {
  const { notify } = useNotification();
  const { user }   = useAuth();
  const [editing, setEditing] = useState(false);
  const [saving,  setSaving]  = useState(false);

  const formInicial = () => ({
    tipo:                inc.tipo,
    gravedad:            inc.gravedad,
    estado:              inc.estado,
    responsable_user_id: inc.responsable?.id ? String(inc.responsable.id) : '',
  });
  const [form, setForm] = useState(formInicial);

  const cancelar = () => { setForm(formInicial()); setEditing(false); };

  const guardar = async () => {
    setSaving(true);
    try {
      await vehiclesService.updateIncidencia(vehicleId, inc.id, {
        tipo:                form.tipo,
        gravedad:            form.gravedad,
        estado:              form.estado,
        responsable_user_id: form.responsable_user_id ? parseInt(form.responsable_user_id) : null,
      });
      notify.success('Incidencia actualizada');
      setEditing(false);
      onSaved?.();
    } catch (err) {
      notify.error(err.response?.data?.message || 'Error al actualizar la incidencia');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={`card space-y-2 ${inc.estado === 'resuelto' ? 'opacity-70' : ''}`}>
      <div className="flex items-start justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
          <span className={`badge text-xs ${GRAVEDAD_BADGE[inc.gravedad]}`}>
            {inc.gravedad.charAt(0).toUpperCase() + inc.gravedad.slice(1)}
          </span>
          <span className="text-xs text-neutral-500 font-medium">
            {TIPO_INC_LABELS[inc.tipo] || inc.tipo}
          </span>
          <span className={`badge text-xs ${ESTADO_INC_BADGE[inc.estado]}`}>
            {ESTADO_INC_LABELS[inc.estado] || inc.estado}
          </span>
        </div>
        <span className="text-xs text-neutral-400">{formatDateTime(inc.created_at)}</span>
      </div>

      <p className="text-sm text-neutral-700 whitespace-pre-line">{inc.descripcion}</p>

      <div className="text-xs text-neutral-500 space-y-0.5">
        <p>Reportada por: <strong className="text-neutral-700">{nombreCompleto(inc.reportado_por)}</strong></p>
        <p>
          Asignada a:{' '}
          <strong className="text-neutral-700">
            {inc.responsable ? nombreCompleto(inc.responsable) : 'Sin asignar'}
          </strong>
        </p>
        {inc.resuelto_por && (
          <p>Resuelta por: {nombreCompleto(inc.resuelto_por)} · {formatDateTime(inc.resuelto_at)}</p>
        )}
      </div>

      {/* Comentarios: la vía para aportar información sobre una incidencia ya
          registrada, en lugar de dar de alta otra por el mismo daño. */}
      <ComentariosIncidencia
        inc={inc}
        vehicleId={vehicleId}
        puedeComentar={
          canManage ||
          inc.responsable?.id === user?.id ||
          inc.reportado_por?.id === user?.id
        }
        onSaved={onSaved}
      />

      {canManage && !editing && (
        <div className="pt-1 border-t border-neutral-100">
          <button onClick={() => setEditing(true)} className="btn-secondary text-xs">
            Reclasificar / reasignar
          </button>
        </div>
      )}

      {canManage && editing && (
        <div className="pt-2 border-t border-neutral-100 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-neutral-500 block mb-1">Tipo</label>
              <select className="input text-sm" value={form.tipo}
                onChange={e => setForm(f => ({ ...f, tipo: e.target.value }))}>
                {TIPO_INC_OPTS.map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-neutral-500 block mb-1">Gravedad</label>
              <select className="input text-sm" value={form.gravedad}
                onChange={e => setForm(f => ({ ...f, gravedad: e.target.value }))}>
                <option value="leve">Leve</option>
                <option value="moderado">Moderado</option>
                <option value="grave">Grave</option>
              </select>
            </div>
            <div>
              <label className="text-xs text-neutral-500 block mb-1">Estado</label>
              <select className="input text-sm" value={form.estado}
                onChange={e => setForm(f => ({ ...f, estado: e.target.value }))}>
                <option value="pendiente">Pendiente</option>
                <option value="en_revision">En revisión</option>
                <option value="resuelto">Resuelto</option>
              </select>
            </div>
            <div>
              <label className="text-xs text-neutral-500 block mb-1">Responsable</label>
              <select className="input text-sm" value={form.responsable_user_id}
                onChange={e => setForm(f => ({ ...f, responsable_user_id: e.target.value }))}>
                <option value="">Sin asignar</option>
                {users.map(u => (
                  <option key={u.id} value={u.id}>
                    {u.nombre} {u.apellidos} (@{u.username})
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={cancelar} className="btn-secondary text-sm flex-1">Cancelar</button>
            <button type="button" onClick={guardar} disabled={saving} className="btn-primary text-sm flex-1">
              {saving ? 'Guardando…' : 'Guardar cambios'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function AsignacionDetalle({ id, onClose }) {
  const { notify } = useNotification();
  const { user, canManageTrabajos } = useAuth();
  const [asig,    setAsig]    = useState(null);
  const [loading, setLoading] = useState(true);
  const [lightbox, setLightbox] = useState(null);
  const [showInicio, setShowInicio] = useState(false);
  const [showFin,    setShowFin]    = useState(false);
  const [showIncForm, setShowIncForm] = useState(false);
  const emptyIncForm = { tipo: 'dano_exterior', gravedad: 'leve', descripcion: '', responsable_user_id: '' };
  const [incForm, setIncForm] = useState(emptyIncForm);
  const [savingInc, setSavingInc] = useState(false);
  const [users, setUsers] = useState([]);

  const puedeGestionar = canManageTrabajos();

  const load = () => {
    setLoading(true);
    asignacionesService.get(id)
      .then(setAsig)
      .catch(() => notify.error('Error al cargar la asignación'))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, [id]);

  // Empleados a los que se puede atribuir una incidencia (solo admin/gestor)
  useEffect(() => {
    if (!puedeGestionar) return;
    usersService.list({ limit: 300 })
      .then(r => setUsers(r.data || []))
      .catch(() => {/* el selector queda vacío; no bloquea el resto del detalle */});
  }, [puedeGestionar]);

  const handleCrearIncidencia = async (e) => {
    e.preventDefault();
    if (!incForm.descripcion.trim()) return;
    setSavingInc(true);
    try {
      await asignacionesService.crearIncidencia(id, {
        tipo:        incForm.tipo,
        gravedad:    incForm.gravedad,
        descripcion: incForm.descripcion.trim(),
        ...(incForm.responsable_user_id
          ? { responsable_user_id: parseInt(incForm.responsable_user_id) }
          : {}),
      });
      const destino = incForm.responsable_user_id
        ? (users.find(u => String(u.id) === incForm.responsable_user_id)
            ? nombreCompleto(users.find(u => String(u.id) === incForm.responsable_user_id))
            : 'el empleado seleccionado')
        : asig.responsable_nombre;
      notify.success(`Incidencia asignada a ${destino}`);
      setShowIncForm(false);
      setIncForm(emptyIncForm);
      load();
    } catch (err) {
      notify.error(err.response?.data?.message || 'Error al registrar la incidencia');
    } finally {
      setSavingInc(false);
    }
  };

  // Evidencias indexadas por (momento, tipo)
  const evInicio = {};
  const evFin    = {};
  const evGeneral = [];
  asig?.evidencias?.forEach(e => {
    if (e.momento === 'inicio') evInicio[e.tipo_imagen] = e;
    else if (e.momento === 'fin') evFin[e.tipo_imagen] = e;
    else evGeneral.push(e);
  });

  const incidencias = asig?.incidencias || [];

  const soyResponsable = asig?.user_id === user?.id || canManageTrabajos();
  const finalizada     = asig?.estado === 'finalizada' || asig?.estado === 'cancelada';
  const inicioIncompleto = asig?.progreso?.inicio && !asig.progreso.inicio.completo;
  const puedeInicio      = soyResponsable && !finalizada && inicioIncompleto;
  const puedeFin         = soyResponsable && !finalizada && !inicioIncompleto;

  return (
    <div className="fixed inset-0 z-50 flex">
      {/* Overlay */}
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />

      {/* Panel derecho */}
      <div className="relative ml-auto w-full max-w-xl bg-white h-full shadow-2xl flex flex-col overflow-y-auto animate-slide-up">
        {/* Header */}
        <div className="sticky top-0 bg-white border-b border-neutral-100 px-5 py-4 flex items-center justify-between z-10">
          <div>
            <h2 className="font-semibold text-neutral-900">Detalle de asignación #{id}</h2>
            {asig && (
              <span className={`text-xs ${ASIGNACION_ESTADO_COLORS[asig.estado]}`}>
                {ASIGNACION_ESTADO_LABELS[asig.estado]}
              </span>
            )}
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg text-neutral-400 hover:text-neutral-600 hover:bg-neutral-100">
            <svg className="w-5 h-5" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
            </svg>
          </button>
        </div>

        {loading ? (
          <div className="flex-1 flex items-center justify-center text-neutral-400">Cargando…</div>
        ) : !asig ? (
          <div className="flex-1 flex items-center justify-center text-neutral-400">No encontrado</div>
        ) : (
          <div className="flex-1 p-5 space-y-6">
            {/* Info general */}
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <p className="text-neutral-400 text-xs mb-0.5">Vehículo</p>
                <p className="font-medium text-neutral-900">{asig.vehiculo_alias}</p>
                <p className="text-neutral-500 text-xs data">{asig.matricula}</p>
              </div>
              <div>
                <p className="text-neutral-400 text-xs mb-0.5">Responsable</p>
                <p className="font-medium text-neutral-900">{asig.responsable_nombre}</p>
                <p className="text-neutral-500 text-xs">@{asig.responsable_username}</p>
              </div>
              <div>
                <p className="text-neutral-400 text-xs mb-0.5">Inicio previsto</p>
                <p className="text-neutral-900">{formatDateTime(asig.fecha_inicio)}</p>
              </div>
              <div>
                <p className="text-neutral-400 text-xs mb-0.5">Fin</p>
                <p className="text-neutral-900">{formatDateTime(asig.fecha_fin)}</p>
              </div>
              {asig.inicio_real_at && (
                <div>
                  <p className="text-neutral-400 text-xs mb-0.5">Inicio real de servicio</p>
                  <p className="text-neutral-900">{formatDateTime(asig.inicio_real_at)}</p>
                </div>
              )}
              <div>
                <p className="text-neutral-400 text-xs mb-0.5">Km inicio</p>
                <p className="text-neutral-900">{asig.km_inicio != null ? `${asig.km_inicio.toLocaleString()} km` : '—'}</p>
              </div>
              <div>
                <p className="text-neutral-400 text-xs mb-0.5">Km fin</p>
                <p className="text-neutral-900">{asig.km_fin != null ? `${asig.km_fin.toLocaleString()} km` : '—'}</p>
              </div>
              {asig.motivo_fin && (
                <div className="col-span-2">
                  <p className="text-neutral-400 text-xs mb-0.5">Motivo finalización</p>
                  <p className="text-neutral-700 italic">{asig.motivo_fin}</p>
                </div>
              )}
              {asig.notas && (
                <div className="col-span-2">
                  <p className="text-neutral-400 text-xs mb-0.5">Notas</p>
                  <p className="text-neutral-700">{asig.notas}</p>
                </div>
              )}
            </div>

            {/* Aviso persistente: falta inicio */}
            {puedeInicio && (
              <div className="card bg-warn-50 border-warn-200 border-2 space-y-2">
                <div className="flex items-start gap-3">
                  <div className="flex-1">
                    <p className="font-semibold text-warn-700 text-sm">Faltan fotos de inicio</p>
                    <p className="text-xs text-warn-700 mt-0.5">
                      Antes de poder finalizar, documenta el estado del vehículo al recibirlo
                      ({asig.progreso?.inicio?.completado || 0}/{asig.progreso?.inicio?.total || 7}).
                    </p>
                  </div>
                  <button
                    onClick={() => setShowInicio(true)}
                    className="btn-primary text-xs whitespace-nowrap"
                  >
                    Subir ahora
                  </button>
                </div>
              </div>
            )}

            {/* Botones de acción */}
            {(puedeFin || (soyResponsable && !finalizada && !inicioIncompleto)) && (
              <div className="flex gap-2">
                <button onClick={() => setShowFin(true)} className="btn-primary flex-1">
                  Finalizar servicio
                </button>
              </div>
            )}

            {/* ── Incidencias de la asignación ───────────────────── */}
            {(incidencias.length > 0 || evGeneral.length > 0 || puedeGestionar) && (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="font-medium text-neutral-900 text-sm">
                    <span className="inline-block bg-warn-50 text-warn-600 text-[10px] font-semibold px-1.5 py-0.5 rounded mr-2">
                      INCIDENCIAS
                    </span>
                    {incidencias.length > 0
                      ? `${incidencias.length} registrada${incidencias.length !== 1 ? 's' : ''}`
                      : 'Sin incidencias registradas'}
                  </h3>
                  {puedeGestionar && !showIncForm && (
                    <button onClick={() => setShowIncForm(true)} className="btn-secondary text-xs whitespace-nowrap">
                      + Registrar
                    </button>
                  )}
                </div>

                {/* Fotos aportadas al reportar (momento «general») */}
                {evGeneral.length > 0 && (
                  <div>
                    <p className="text-xs text-neutral-500 mb-2">Fotos aportadas en la incidencia</p>
                    <div className="grid grid-cols-3 gap-2">
                      {evGeneral.map(ev => (
                        <div key={ev.id} className="relative aspect-[4/3] rounded-lg overflow-hidden border border-neutral-200 bg-neutral-50">
                          <img
                            src={getImageUrl(ev.image_url)}
                            alt="Foto de incidencia"
                            className="w-full h-full object-cover cursor-pointer"
                            onClick={() => setLightbox(getImageUrl(ev.image_url))}
                          />
                          <div className="absolute bottom-0 left-0 right-0 bg-black/50 text-white text-xs py-0.5 px-1 truncate">
                            {formatDateTime(ev.uploaded_at)}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Listado de incidencias */}
                {incidencias.map(inc => (
                  <IncidenciaCard
                    key={inc.id}
                    inc={inc}
                    vehicleId={asig.vehicle_id}
                    users={users}
                    canManage={puedeGestionar}
                    onSaved={load}
                  />
                ))}

                {/* Alta de una nueva incidencia (admin/gestor) */}
                {puedeGestionar && showIncForm && (
                  <form onSubmit={handleCrearIncidencia} className="card border-warn-200 bg-warn-50/40 space-y-3">
                    <h4 className="font-medium text-neutral-900 text-sm">Nueva incidencia</h4>
                    {incidencias.length > 0 && (
                      <p className="text-xs text-neutral-500">
                        Si es sobre un daño ya registrado, usa «Añadir comentario» en su ficha:
                        así no queda duplicado.
                      </p>
                    )}
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="text-xs text-neutral-500 block mb-1">Tipo</label>
                        <select className="input text-sm" value={incForm.tipo}
                          onChange={e => setIncForm(f => ({ ...f, tipo: e.target.value }))}>
                          {TIPO_INC_OPTS.map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                        </select>
                      </div>
                      <div>
                        <label className="text-xs text-neutral-500 block mb-1">Gravedad</label>
                        <select className="input text-sm" value={incForm.gravedad}
                          onChange={e => setIncForm(f => ({ ...f, gravedad: e.target.value }))}>
                          <option value="leve">Leve</option>
                          <option value="moderado">Moderado</option>
                          <option value="grave">Grave</option>
                        </select>
                      </div>
                    </div>
                    <div>
                      <label className="text-xs text-neutral-500 block mb-1">Responsable</label>
                      <select className="input text-sm" value={incForm.responsable_user_id}
                        onChange={e => setIncForm(f => ({ ...f, responsable_user_id: e.target.value }))}>
                        <option value="">
                          {asig.responsable_nombre} — responsable de la asignación
                        </option>
                        {users.map(u => (
                          <option key={u.id} value={u.id}>
                            {u.nombre} {u.apellidos} (@{u.username})
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="text-xs text-neutral-500 block mb-1">Descripción *</label>
                      <textarea className="input text-sm" rows={3} required
                        placeholder="Describe el daño o incidencia detectada…"
                        value={incForm.descripcion}
                        onChange={e => setIncForm(f => ({ ...f, descripcion: e.target.value }))} />
                    </div>
                    <div className="flex gap-2">
                      <button type="button" onClick={() => { setShowIncForm(false); setIncForm(emptyIncForm); }}
                        className="btn-secondary text-sm flex-1">Cancelar</button>
                      <button type="submit" disabled={savingInc} className="btn-primary text-sm flex-1">
                        {savingInc ? 'Guardando…' : 'Registrar incidencia'}
                      </button>
                    </div>
                  </form>
                )}
              </div>
            )}

            {/* Evidencias de INICIO */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-medium text-neutral-900 text-sm">
                  <span className="inline-block bg-blue-100 text-blue-700 text-[10px] font-semibold px-1.5 py-0.5 rounded mr-2">INICIO</span>
                  Fotos al recibir el vehículo
                </h3>
                <span className={`text-xs font-medium ${asig.progreso?.inicio?.completo ? 'text-ok-600' : 'text-warn-600'}`}>
                  {asig.progreso?.inicio?.completado || 0}/{asig.progreso?.inicio?.total || 7}
                </span>
              </div>
              <div className="grid grid-cols-3 gap-2">
                {IMAGEN_TIPOS_INICIO.map(tipo => {
                  const ev = evInicio[tipo.key];
                  return (
                    <div key={tipo.key} className="relative aspect-[4/3] rounded-lg overflow-hidden border border-neutral-200 bg-neutral-50">
                      {ev ? (
                        <>
                          <img
                            src={getImageUrl(ev.image_url)}
                            alt={tipo.label}
                            className="w-full h-full object-cover cursor-pointer"
                            onClick={() => setLightbox(getImageUrl(ev.image_url))}
                          />
                          <div className="absolute bottom-0 left-0 right-0 bg-black/50 text-white text-xs py-0.5 px-1 truncate">
                            {tipo.label}
                          </div>
                        </>
                      ) : (
                        <div className="flex flex-col items-center justify-center h-full gap-1 text-neutral-300">
                          <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                          </svg>
                          <p className="text-xs text-center px-1 text-neutral-400">{tipo.label}</p>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Evidencias de FIN */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-medium text-neutral-900 text-sm">
                  <span className="inline-block bg-ok-50 text-ok-600 text-[10px] font-semibold px-1.5 py-0.5 rounded mr-2">FIN</span>
                  Fotos al finalizar
                </h3>
                <span className={`text-xs font-medium ${asig.progreso?.fin?.completo ? 'text-ok-600' : 'text-warn-600'}`}>
                  {asig.progreso?.fin?.completado || 0}/{asig.progreso?.fin?.total || 5}
                </span>
              </div>
              <div className="grid grid-cols-3 gap-2">
                {IMAGEN_TIPOS_FIN.map(tipo => {
                  const ev = evFin[tipo.key];
                  return (
                    <div key={tipo.key} className="relative aspect-[4/3] rounded-lg overflow-hidden border border-neutral-200 bg-neutral-50">
                      {ev ? (
                        <>
                          <img
                            src={getImageUrl(ev.image_url)}
                            alt={tipo.label}
                            className="w-full h-full object-cover cursor-pointer"
                            onClick={() => setLightbox(getImageUrl(ev.image_url))}
                          />
                          <div className="absolute bottom-0 left-0 right-0 bg-black/50 text-white text-xs py-0.5 px-1 truncate">
                            {tipo.label}
                          </div>
                        </>
                      ) : (
                        <div className="flex flex-col items-center justify-center h-full gap-1 text-neutral-300">
                          <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                          </svg>
                          <p className="text-xs text-center px-1 text-neutral-400">{tipo.label}</p>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Modales inicio / fin */}
            {showInicio && (
              <div className="fixed inset-0 z-[70] bg-white overflow-y-auto p-5">
                <InicioAsignacion
                  asignacion={asig}
                  onDone={() => { setShowInicio(false); load(); }}
                  onCancel={() => setShowInicio(false)}
                />
              </div>
            )}
            {showFin && (
              <div className="fixed inset-0 z-[70] bg-white overflow-y-auto p-5">
                <FinalizacionAsignacion
                  asignacion={asig}
                  onDone={() => { setShowFin(false); load(); }}
                  onCancel={() => setShowFin(false)}
                />
              </div>
            )}
          </div>
        )}
      </div>

      {/* Lightbox */}
      {lightbox && (
        <div
          className="fixed inset-0 z-[60] bg-black/90 flex items-center justify-center"
          onClick={() => setLightbox(null)}
        >
          <img src={lightbox} alt="Evidencia" className="max-h-[90dvh] max-w-[90vw] object-contain rounded-lg" />
        </div>
      )}
    </div>
  );
}
