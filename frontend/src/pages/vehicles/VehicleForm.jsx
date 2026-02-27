import React, { useState } from 'react';
import Modal from '../../components/common/Modal.jsx';
import { vehiclesService } from '../../services/vehicles.service.js';
import { useNotification } from '../../context/NotificationContext.jsx';
import { toInputDate } from '../../utils/dateUtils.js';

export default function VehicleForm({ vehicle, onSaved, onClose }) {
  const isEdit = !!vehicle;
  const { notify } = useNotification();

  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState({});
  const [form,   setForm]   = useState({
    matricula:             vehicle?.matricula            || '',
    alias:                 vehicle?.alias                || '',
    kilometros_actuales:   vehicle?.kilometros_actuales  ?? '',
    fecha_ultima_revision: toInputDate(vehicle?.fecha_ultima_revision),
    fecha_ultimo_servicio: toInputDate(vehicle?.fecha_ultimo_servicio),
  });

  const set = (field) => (e) => {
    setForm(f => ({ ...f, [field]: e.target.value }));
    setErrors(er => ({ ...er, [field]: '' }));
  };

  const validate = () => {
    const e = {};
    if (!form.matricula.trim()) e.matricula = 'Matrícula requerida';
    if (!form.alias.trim())     e.alias     = 'Alias requerido';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleSubmit = async (ev) => {
    ev.preventDefault();
    if (!validate()) return;
    setSaving(true);
    try {
      const payload = {
        alias:                 form.alias,
        kilometros_actuales:   form.kilometros_actuales !== '' ? parseInt(form.kilometros_actuales) : 0,
        fecha_ultima_revision: form.fecha_ultima_revision || null,
        fecha_ultimo_servicio: form.fecha_ultimo_servicio || null,
      };
      if (!isEdit) payload.matricula = form.matricula.toUpperCase();

      if (isEdit) await vehiclesService.update(vehicle.id, payload);
      else        await vehiclesService.create(payload);

      notify.success(isEdit ? 'Vehículo actualizado' : 'Vehículo creado');
      onSaved();
    } catch (err) {
      notify.error(err.response?.data?.message || 'Error al guardar');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      isOpen
      onClose={onClose}
      title={isEdit ? `Editar: ${vehicle.alias}` : 'Nuevo vehículo'}
      size="md"
      footer={
        <>
          <button className="btn-secondary" onClick={onClose} disabled={saving}>Cancelar</button>
          <button className="btn-primary" onClick={handleSubmit} disabled={saving}>
            {saving ? 'Guardando...' : (isEdit ? 'Actualizar' : 'Crear vehículo')}
          </button>
        </>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="label">Matrícula <span className="text-red-500">*</span></label>
          <input
            type="text"
            className={`input uppercase ${errors.matricula ? 'input-error' : ''}`}
            value={form.matricula}
            onChange={set('matricula')}
            disabled={isEdit}
            placeholder="Ej: 1234-ABC"
          />
          {errors.matricula && <p className="field-error">{errors.matricula}</p>}
        </div>

        <div>
          <label className="label">Alias <span className="text-red-500">*</span></label>
          <input
            type="text"
            className={`input ${errors.alias ? 'input-error' : ''}`}
            value={form.alias}
            onChange={set('alias')}
            placeholder="Ej: Ambulancia-01"
          />
          {errors.alias && <p className="field-error">{errors.alias}</p>}
        </div>

        <div>
          <label className="label">Kilómetros actuales</label>
          <input
            type="number"
            className="input"
            value={form.kilometros_actuales}
            onChange={set('kilometros_actuales')}
            min={0}
            step={1}
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="label">Última revisión</label>
            <input
              type="date"
              className="input"
              value={form.fecha_ultima_revision}
              onChange={set('fecha_ultima_revision')}
            />
          </div>
          <div>
            <label className="label">Último servicio</label>
            <input
              type="date"
              className="input"
              value={form.fecha_ultimo_servicio}
              onChange={set('fecha_ultimo_servicio')}
            />
          </div>
        </div>
      </form>
    </Modal>
  );
}
