import React, { useState, useEffect } from 'react';
import Modal from '../../components/common/Modal.jsx';
import ListaMiembros from '../../components/common/ListaMiembros.jsx';
import { asignacionesService } from '../../services/asignaciones.service.js';
import { vehiclesService } from '../../services/vehicles.service.js';
import { usersService } from '../../services/users.service.js';
import { useNotification } from '../../context/NotificationContext.jsx';
import { toInputDatetime, toUtcIso } from '../../utils/dateUtils.js';
import {
  idsElegidos, miembrosIniciales, textoSolapes,
} from '../../utils/miembrosAsignacion.js';

// El vehículo solo se puede tocar mientras la asignación sigue "programada" y
// no tiene ni una foto ni una incidencia registrada: en cuanto hay algo de
// eso, reasignarlo lo deja mal atribuido (el backend corta lo mismo en
// PUT /asignaciones/:id — esto solo evita el viaje al servidor para
// enterarse).
function motivoVehiculoBloqueado(asig) {
  if (asig.estado !== 'programada') {
    return 'El vehículo solo se puede cambiar mientras la asignación está "programada".';
  }
  if ((asig.evidencias || []).length) {
    return 'No se puede cambiar el vehículo: ya hay evidencia fotográfica subida.';
  }
  if ((asig.incidencias || []).length) {
    return 'No se puede cambiar el vehículo: ya hay incidencias registradas en esta asignación.';
  }
  return '';
}

// ── Formulario principal ──────────────────────────────────────────────────────
export default function AsignacionForm({ asignacion, onSaved, onClose }) {
  const isEdit = !!asignacion;
  const { notify } = useNotification();

  const [vehicles, setVehicles] = useState([]);
  const [users,    setUsers]    = useState([]);
  const [saving,   setSaving]   = useState(false);
  const [errors,   setErrors]   = useState({});
  // Bloqueado por defecto en edición hasta saber estado+evidencias de verdad;
  // en creación no aplica.
  const [vehiculoBloqueado, setVehiculoBloqueado] = useState(
    isEdit ? (motivoVehiculoBloqueado(asignacion) || 'Comprobando…') : ''
  );

  const [form, setForm] = useState({
    vehicle_id:   asignacion?.vehicle_id   || '',
    ...miembrosIniciales(asignacion),
    fecha_inicio: asignacion ? toInputDatetime(asignacion.fecha_inicio) : '',
    fecha_fin:    asignacion ? toInputDatetime(asignacion.fecha_fin)    : '',
    km_inicio:    asignacion?.km_inicio    ?? '',
    notas:        asignacion?.notas        || '',
  });

  useEffect(() => {
    vehiclesService.list({ limit: 100 }).then(r => setVehicles(r.data || [])).catch(console.error);
    usersService.list({ limit: 300 }).then(r => setUsers(r.data || [])).catch(console.error);
  }, []);

  // Desde el listado llega la fila, que no trae ni los ids de los miembros ni
  // las evidencias: se pide la asignación completa para rellenar las listas
  // y para saber si el vehículo se puede tocar.
  useEffect(() => {
    if (!asignacion?.id) return;
    if (asignacion.responsables && asignacion.evidencias !== undefined) {
      setVehiculoBloqueado(motivoVehiculoBloqueado(asignacion));
      return;
    }
    asignacionesService.get(asignacion.id)
      .then(full => {
        if (!asignacion.responsables) setForm(f => ({ ...f, ...miembrosIniciales(full) }));
        setVehiculoBloqueado(motivoVehiculoBloqueado(full));
      })
      .catch(console.error);
  }, [asignacion]);

  const setMiembros = campo => lista => {
    setForm(f => ({ ...f, [campo]: lista }));
    setErrors(prev => ({ ...prev, responsables: '' }));
  };

  const set = field => e => {
    setForm(f => ({ ...f, [field]: e.target.value }));
    setErrors(prev => ({ ...prev, [field]: '' }));
  };

  const validate = () => {
    const errs = {};
    if (!form.vehicle_id)   errs.vehicle_id   = 'Selecciona un vehículo';
    if (!idsElegidos(form.responsables).length) errs.responsables = 'Selecciona al menos un responsable';
    if (!form.fecha_inicio) errs.fecha_inicio = 'Fecha inicio requerida';
    if (!form.fecha_fin)    errs.fecha_fin    = 'Fecha fin requerida';
    if (form.fecha_inicio && form.fecha_fin && new Date(form.fecha_fin) <= new Date(form.fecha_inicio)) {
      errs.fecha_fin = 'Fecha fin debe ser posterior a fecha inicio';
    }
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleSubmit = async e => {
    e.preventDefault();
    if (!validate()) return;
    setSaving(true);
    try {
      const payload = {
        vehicle_id:   parseInt(form.vehicle_id),
        responsables: idsElegidos(form.responsables),
        personal:     idsElegidos(form.personal),
        fecha_inicio: toUtcIso(form.fecha_inicio),
        fecha_fin:    toUtcIso(form.fecha_fin),
        km_inicio:    form.km_inicio !== '' ? parseInt(form.km_inicio) : null,
        notas:        form.notas || null,
      };
      const guardada = isEdit
        ? await asignacionesService.update(asignacion.id, payload)
        : await asignacionesService.create(payload);
      notify.success(isEdit ? 'Asignación actualizada' : 'Asignación creada');
      // Solape de fechas con otra asignación: se avisa, no se bloquea.
      const aviso = textoSolapes(guardada?.solapes);
      if (aviso) notify.warning(aviso, 10000);
      onSaved();
    } catch (err) {
      notify.error(err.response?.data?.message || 'Error al guardar la asignación');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      isOpen
      onClose={onClose}
      title={isEdit ? 'Editar asignación' : 'Nueva asignación de vehículo'}
      size="md"
      footer={
        <>
          <button onClick={onClose} className="btn-secondary" disabled={saving}>Cancelar</button>
          <button onClick={handleSubmit} className="btn-primary" disabled={saving}>
            {saving ? 'Guardando…' : isEdit ? 'Guardar cambios' : 'Crear asignación'}
          </button>
        </>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {isEdit && asignacion.estado === 'activa' && (
          <p className="text-xs text-neutral-600 bg-neutral-50 border border-neutral-200 rounded-lg p-2">
            Servicio en curso. Puedes cambiar responsables, personal y notas;
            las fotos ya subidas se quedan en la asignación y el nuevo
            responsable sigue desde donde está.
          </p>
        )}
        {/* Vehículo */}
        <div>
          <label className="label">Vehículo <span className="text-bad-500">*</span></label>
          <select
            className={`input ${errors.vehicle_id ? 'input-error' : ''}`}
            value={form.vehicle_id}
            onChange={set('vehicle_id')}
            disabled={isEdit && !!vehiculoBloqueado}
          >
            <option value="">— Seleccionar vehículo —</option>
            {vehicles.map(v => (
              <option key={v.id} value={v.id}>
                {v.alias} · {v.matricula}
              </option>
            ))}
          </select>
          {errors.vehicle_id && <p className="field-error">{errors.vehicle_id}</p>}
          {isEdit && vehiculoBloqueado && (
            <p className="text-xs text-neutral-500 mt-1">{vehiculoBloqueado}</p>
          )}
        </div>

        {/* Responsables (1..N) — activan, documentan y cierran */}
        <div>
          <label className="label">Responsables <span className="text-bad-500">*</span></label>
          <ListaMiembros
            users={users}
            lista={form.responsables}
            ocupados={[...form.responsables, ...form.personal]}
            onChange={setMiembros('responsables')}
            minimo={1}
            textoAnadir="Añadir otro responsable"
            error={!!errors.responsables}
          />
          {errors.responsables && <p className="field-error">{errors.responsables}</p>}
        </div>

        {/* Personal (0..N) — va con el vehículo y ve la asignación, pero no
            la inicia ni la finaliza. PROVISIONAL hasta Trabajos. */}
        <div>
          <label className="label">Personal (opcional)</label>
          <p className="text-xs text-neutral-500 mb-2">
            Ve la asignación, pero no puede iniciarla ni finalizarla.
          </p>
          <ListaMiembros
            users={users}
            lista={form.personal}
            ocupados={[...form.responsables, ...form.personal]}
            onChange={setMiembros('personal')}
            minimo={0}
            textoAnadir="Añadir personal"
          />
        </div>

        {/* Fechas */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="label">Fecha inicio <span className="text-bad-500">*</span></label>
            <input
              type="datetime-local"
              className={`input ${errors.fecha_inicio ? 'input-error' : ''}`}
              value={form.fecha_inicio}
              onChange={set('fecha_inicio')}
            />
            {errors.fecha_inicio && <p className="field-error">{errors.fecha_inicio}</p>}
          </div>
          <div>
            <label className="label">Fecha fin <span className="text-bad-500">*</span></label>
            <input
              type="datetime-local"
              className={`input ${errors.fecha_fin ? 'input-error' : ''}`}
              value={form.fecha_fin}
              onChange={set('fecha_fin')}
            />
            {errors.fecha_fin && <p className="field-error">{errors.fecha_fin}</p>}
          </div>
        </div>

        {/* Km inicio */}
        <div>
          <label className="label">Km inicio (opcional)</label>
          <input
            type="number"
            min="0"
            className="input"
            placeholder="p. ej. 125000"
            value={form.km_inicio}
            onChange={set('km_inicio')}
          />
        </div>

        {/* Notas */}
        <div>
          <label className="label">Notas (opcional)</label>
          <textarea
            className="input resize-none"
            rows={3}
            placeholder="Observaciones o instrucciones para quien va en la asignación"
            value={form.notas}
            onChange={set('notas')}
          />
        </div>
      </form>
    </Modal>
  );
}
