import React, { useState, useEffect } from 'react';
import Modal from '../../components/common/Modal.jsx';
import ListaMiembros from '../../components/common/ListaMiembros.jsx';
import { asignacionesService } from '../../services/asignaciones.service.js';
import { vehiclesService } from '../../services/vehicles.service.js';
import { usersService } from '../../services/users.service.js';
import { useNotification } from '../../context/NotificationContext.jsx';
import { toInputDatetime, toUtcIso } from '../../utils/dateUtils.js';
import {
  idsElegidos, miembrosIniciales, textoSolapes, textoVehiculoOcupado,
} from '../../utils/miembrosAsignacion.js';

// El vehículo se puede tocar mientras la asignación no tenga ni una foto ni
// una incidencia registrada, esté programada o ya activa: en cuanto hay algo
// de eso, reasignarlo lo deja mal atribuido (el backend corta lo mismo en
// PUT /asignaciones/:id — esto solo evita el viaje al servidor para
// enterarse).
function motivoVehiculoBloqueado(asig) {
  if ((asig.evidencias || []).length) {
    return 'No se puede cambiar el vehículo: ya hay evidencia fotográfica subida.';
  }
  if ((asig.incidencias || []).length) {
    return 'No se puede cambiar el vehículo: ya hay incidencias registradas en esta asignación.';
  }
  return '';
}

// ── Formulario principal ──────────────────────────────────────────────────────
// `trabajo` (v33): se está añadiendo una ambulancia a ese trabajo desde su
// ficha. Las fechas salen por defecto las del trabajo y no se ofrecen las
// ambulancias que ya van en él (D5; el backend lo vuelve a comprobar).
export default function AsignacionForm({ asignacion, trabajo = null, onSaved, onClose }) {
  const isEdit = !!asignacion;
  const { notify } = useNotification();
  // El trabajo de la asignación que se edita, o al que se añade
  const trabajoNombre = trabajo?.nombre || asignacion?.trabajo?.nombre || asignacion?.trabajo_nombre || null;
  const yaEnTrabajo = new Set((trabajo?.asignaciones || [])
    .filter(a => a.estado !== 'cancelada').map(a => a.vehicle_id));

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
    fecha_inicio: asignacion ? toInputDatetime(asignacion.fecha_inicio) : toInputDatetime(trabajo?.fecha_inicio),
    fecha_fin:    asignacion ? toInputDatetime(asignacion.fecha_fin)    : toInputDatetime(trabajo?.fecha_fin),
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

  // Con otra ambulancia, los km de inicio de la anterior no valen: se vacían
  // para que no viajen en el PUT (el backend también los descarta). Volver a
  // la original los recupera.
  const setVehiculo = e => {
    const id = e.target.value;
    setForm(f => ({
      ...f,
      vehicle_id: id,
      km_inicio: !isEdit ? f.km_inicio
        : Number(id) === asignacion.vehicle_id ? (asignacion.km_inicio ?? '') : '',
    }));
    setErrors(prev => ({ ...prev, vehicle_id: '' }));
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
        // Solo al añadirla a un trabajo; al editar, el trabajo no se toca
        ...(!isEdit && trabajo ? { trabajo_id: trabajo.id } : {}),
      };
      const guardada = isEdit
        ? await asignacionesService.update(asignacion.id, payload)
        : await asignacionesService.create(payload);
      notify.success(isEdit ? 'Asignación actualizada' : 'Asignación creada');
      // Solape de fechas con otra asignación: se avisa, no se bloquea.
      const aviso = textoSolapes(guardada?.solapes);
      if (aviso) notify.warning(aviso, 10000);
      // La ambulancia, igual: ya está en otra asignación o trabajo esas fechas.
      const avisoVeh = textoVehiculoOcupado(guardada?.vehiculo_ocupado);
      if (avisoVeh) notify.warning(avisoVeh, 10000);
      // D4: las horas de la ambulancia pueden salirse de las del trabajo
      if (guardada?.fuera_del_trabajo) {
        notify.warning('Aviso: las horas de esta ambulancia se salen de las del trabajo', 10000);
      }
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
      title={isEdit ? 'Editar asignación'
        : trabajo ? `Añadir ambulancia a «${trabajo.nombre}»` : 'Nueva asignación de vehículo'}
      size="md"
      footer={
        <>
          <button onClick={onClose} className="btn-secondary" disabled={saving}>Cancelar</button>
          <button onClick={handleSubmit} className="btn-primary" disabled={saving}>
            {saving ? 'Guardando…' : isEdit ? 'Guardar cambios' : trabajo ? 'Añadir ambulancia' : 'Crear asignación'}
          </button>
        </>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {isEdit && trabajoNombre && (
          <p className="text-sm text-neutral-600">
            Trabajo: <span className="font-medium text-neutral-900">{trabajoNombre}</span>
          </p>
        )}
        {isEdit && asignacion.estado === 'activa' && (
          <p className="text-xs text-neutral-600 bg-neutral-50 border border-neutral-200 rounded-lg p-2">
            Servicio en curso. Puedes cambiar responsables, equipo y notas;
            las fotos ya subidas se quedan en la asignación y el nuevo
            responsable sigue desde donde está. El vehículo solo mientras no
            haya fotos ni incidencias; al cambiarlo se avisa al equipo.
          </p>
        )}
        {/* Vehículo */}
        <div>
          <label className="label">Vehículo <span className="text-bad-500">*</span></label>
          <select
            className={`input ${errors.vehicle_id ? 'input-error' : ''}`}
            value={form.vehicle_id}
            onChange={setVehiculo}
            disabled={isEdit && !!vehiculoBloqueado}
          >
            <option value="">— Seleccionar vehículo —</option>
            {vehicles.filter(v => !yaEnTrabajo.has(v.id)).map(v => (
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

        {/* Equipo (0..N) — va con la ambulancia y la ve, pero no la inicia
            ni la finaliza. En BD sigue llamándose `personal` (D8 del plan del
            trabajo padre): renombrar el ENUM obligaría a aceptar los dos
            valores mientras haya frontends viejos. */}
        <div>
          <label className="label">Equipo (opcional)</label>
          <p className="text-xs text-neutral-500 mb-2">
            Va con la ambulancia y ve {trabajoNombre ? 'el trabajo' : 'la asignación'}, pero no puede iniciarla ni finalizarla.
          </p>
          <ListaMiembros
            users={users}
            lista={form.personal}
            ocupados={[...form.responsables, ...form.personal]}
            onChange={setMiembros('personal')}
            minimo={0}
            textoAnadir="Añadir al equipo"
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
