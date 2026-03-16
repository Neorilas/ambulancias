import React, { useState, useEffect } from 'react';
import Modal from '../../components/common/Modal.jsx';
import { asignacionesService } from '../../services/asignaciones.service.js';
import { vehiclesService } from '../../services/vehicles.service.js';
import { usersService } from '../../services/users.service.js';
import { useNotification } from '../../context/NotificationContext.jsx';
import { toInputDatetime } from '../../utils/dateUtils.js';

export default function AsignacionForm({ asignacion, onSaved, onClose }) {
  const isEdit = !!asignacion;
  const { notify } = useNotification();

  const [vehicles, setVehicles] = useState([]);
  const [users,    setUsers]    = useState([]);
  const [saving,   setSaving]   = useState(false);
  const [errors,   setErrors]   = useState({});

  const [form, setForm] = useState({
    vehicle_id:   asignacion?.vehicle_id   || '',
    user_id:      asignacion?.user_id      || '',
    fecha_inicio: asignacion ? toInputDatetime(asignacion.fecha_inicio) : '',
    fecha_fin:    asignacion ? toInputDatetime(asignacion.fecha_fin)    : '',
    km_inicio:    asignacion?.km_inicio    ?? '',
    notas:        asignacion?.notas        || '',
  });

  useEffect(() => {
    vehiclesService.list({ limit: 100 }).then(r => setVehicles(r.data || [])).catch(console.error);
    usersService.list({ limit: 200 }).then(r => setUsers(r.data || [])).catch(console.error);
  }, []);

  const set = field => e => {
    setForm(f => ({ ...f, [field]: e.target.value }));
    setErrors(e => ({ ...e, [field]: '' }));
  };

  const validate = () => {
    const e = {};
    if (!form.vehicle_id)   e.vehicle_id   = 'Selecciona un vehículo';
    if (!form.user_id)      e.user_id      = 'Selecciona un responsable';
    if (!form.fecha_inicio) e.fecha_inicio = 'Fecha inicio requerida';
    if (!form.fecha_fin)    e.fecha_fin    = 'Fecha fin requerida';
    if (form.fecha_inicio && form.fecha_fin && new Date(form.fecha_fin) <= new Date(form.fecha_inicio)) {
      e.fecha_fin = 'Fecha fin debe ser posterior a fecha inicio';
    }
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleSubmit = async e => {
    e.preventDefault();
    if (!validate()) return;
    setSaving(true);
    try {
      const payload = {
        vehicle_id:   parseInt(form.vehicle_id),
        user_id:      parseInt(form.user_id),
        fecha_inicio: form.fecha_inicio,
        fecha_fin:    form.fecha_fin,
        km_inicio:    form.km_inicio !== '' ? parseInt(form.km_inicio) : null,
        notas:        form.notas || null,
      };
      if (isEdit) {
        await asignacionesService.update(asignacion.id, payload);
        notify.success('Asignación actualizada');
      } else {
        await asignacionesService.create(payload);
        notify.success('Asignación creada');
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
        {/* Vehículo */}
        <div>
          <label className="label">Vehículo <span className="text-red-500">*</span></label>
          <select
            className={`input ${errors.vehicle_id ? 'input-error' : ''}`}
            value={form.vehicle_id}
            onChange={set('vehicle_id')}
            disabled={isEdit}
          >
            <option value="">— Seleccionar vehículo —</option>
            {vehicles.map(v => (
              <option key={v.id} value={v.id}>
                {v.matricula}{v.alias ? ` · ${v.alias}` : ''}
              </option>
            ))}
          </select>
          {errors.vehicle_id && <p className="field-error">{errors.vehicle_id}</p>}
        </div>

        {/* Responsable */}
        <div>
          <label className="label">Responsable <span className="text-red-500">*</span></label>
          <select
            className={`input ${errors.user_id ? 'input-error' : ''}`}
            value={form.user_id}
            onChange={set('user_id')}
          >
            <option value="">— Seleccionar usuario —</option>
            {users.map(u => (
              <option key={u.id} value={u.id}>
                {u.nombre} {u.apellidos} (@{u.username})
              </option>
            ))}
          </select>
          {errors.user_id && <p className="field-error">{errors.user_id}</p>}
        </div>

        {/* Fechas */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="label">Fecha inicio <span className="text-red-500">*</span></label>
            <input
              type="datetime-local"
              className={`input ${errors.fecha_inicio ? 'input-error' : ''}`}
              value={form.fecha_inicio}
              onChange={set('fecha_inicio')}
            />
            {errors.fecha_inicio && <p className="field-error">{errors.fecha_inicio}</p>}
          </div>
          <div>
            <label className="label">Fecha fin <span className="text-red-500">*</span></label>
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
            placeholder="Observaciones o instrucciones para el responsable"
            value={form.notas}
            onChange={set('notas')}
          />
        </div>
      </form>
    </Modal>
  );
}
