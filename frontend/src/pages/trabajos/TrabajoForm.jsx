import React, { useState, useEffect } from 'react';
import Modal from '../../components/common/Modal.jsx';
import { trabajosService } from '../../services/trabajos.service.js';
import { vehiclesService } from '../../services/vehicles.service.js';
import { usersService } from '../../services/users.service.js';
import { useNotification } from '../../context/NotificationContext.jsx';
import { toInputDatetime } from '../../utils/dateUtils.js';

export default function TrabajoForm({ trabajo, onSaved, onClose }) {
  const isEdit = !!trabajo;
  const { notify } = useNotification();

  const [vehicles, setVehicles] = useState([]);
  const [users,    setUsers]    = useState([]);
  const [saving,   setSaving]   = useState(false);
  const [errors,   setErrors]   = useState({});

  const [form, setForm] = useState({
    nombre:      trabajo?.nombre      || '',
    tipo:        trabajo?.tipo        || 'traslado',
    fecha_inicio: toInputDatetime(trabajo?.fecha_inicio) || '',
    fecha_fin:    toInputDatetime(trabajo?.fecha_fin)    || '',
    vehiculos:   trabajo?.vehiculos?.map(v => ({
      vehicle_id:           v.vehicle_id,
      responsable_user_id:  v.responsable_user_id,
      kilometros_inicio:    v.kilometros_inicio || '',
    })) || [],
    usuarios:    trabajo?.usuarios?.map(u => u.user_id) || [],
  });

  useEffect(() => {
    Promise.all([
      vehiclesService.list({ limit: 100 }),
      usersService.list({ limit: 100 }),
    ]).then(([vResp, uResp]) => {
      setVehicles(vResp.data || []);
      setUsers(uResp.data   || []);
    });
  }, []);

  const set = (field) => (e) => {
    setForm(f => ({ ...f, [field]: e.target.value }));
    setErrors(er => ({ ...er, [field]: '' }));
  };

  const addVehicle = () => {
    setForm(f => ({
      ...f,
      vehiculos: [...f.vehiculos, { vehicle_id: '', responsable_user_id: '', kilometros_inicio: '' }],
    }));
  };

  const removeVehicle = (i) => {
    setForm(f => ({ ...f, vehiculos: f.vehiculos.filter((_, idx) => idx !== i) }));
  };

  const setVehicleField = (i, field, val) => {
    setForm(f => {
      const vs = [...f.vehiculos];
      vs[i] = { ...vs[i], [field]: val };
      return { ...f, vehiculos: vs };
    });
  };

  const toggleUser = (uid) => {
    setForm(f => ({
      ...f,
      usuarios: f.usuarios.includes(uid)
        ? f.usuarios.filter(u => u !== uid)
        : [...f.usuarios, uid],
    }));
  };

  const validate = () => {
    const e = {};
    if (!form.nombre.trim())     e.nombre      = 'Nombre requerido';
    if (!form.fecha_inicio)      e.fecha_inicio = 'Fecha inicio requerida';
    if (!form.fecha_fin)         e.fecha_fin    = 'Fecha fin requerida';
    if (form.fecha_fin && form.fecha_inicio && form.fecha_fin <= form.fecha_inicio) {
      e.fecha_fin = 'Fecha fin debe ser posterior a fecha inicio';
    }
    for (const v of form.vehiculos) {
      if (!v.vehicle_id || !v.responsable_user_id) {
        e.vehiculos = 'Cada vehículo necesita vehículo y responsable asignados';
        break;
      }
    }
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleSubmit = async (ev) => {
    ev.preventDefault();
    if (!validate()) return;
    setSaving(true);
    try {
      const payload = {
        nombre:       form.nombre,
        tipo:         form.tipo,
        fecha_inicio: form.fecha_inicio,
        fecha_fin:    form.fecha_fin,
        vehiculos:    form.vehiculos.map(v => ({
          vehicle_id:          parseInt(v.vehicle_id),
          responsable_user_id: parseInt(v.responsable_user_id),
          kilometros_inicio:   v.kilometros_inicio ? parseInt(v.kilometros_inicio) : null,
        })).filter(v => v.vehicle_id && v.responsable_user_id),
        usuarios: form.usuarios.map(Number),
      };

      if (isEdit) await trabajosService.update(trabajo.id, payload);
      else        await trabajosService.create(payload);

      notify.success(isEdit ? 'Trabajo actualizado' : 'Trabajo creado');
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
      title={isEdit ? 'Editar trabajo' : 'Nuevo trabajo'}
      size="lg"
      footer={
        <>
          <button className="btn-secondary" onClick={onClose} disabled={saving}>Cancelar</button>
          <button className="btn-primary" onClick={handleSubmit} disabled={saving}>
            {saving ? 'Guardando...' : (isEdit ? 'Actualizar' : 'Crear trabajo')}
          </button>
        </>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-5">
        {/* Nombre */}
        <div>
          <label className="label">Nombre <span className="text-red-500">*</span></label>
          <input type="text" className={`input ${errors.nombre ? 'input-error' : ''}`}
            value={form.nombre} onChange={set('nombre')} placeholder="Nombre descriptivo del trabajo" />
          {errors.nombre && <p className="field-error">{errors.nombre}</p>}
        </div>

        {/* Tipo */}
        <div>
          <label className="label">Tipo</label>
          <select className="input" value={form.tipo} onChange={set('tipo')}>
            <option value="traslado">Traslado</option>
            <option value="cobertura_evento">Cobertura de evento</option>
            <option value="otro">Otro</option>
          </select>
        </div>

        {/* Fechas */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="label">Fecha inicio <span className="text-red-500">*</span></label>
            <input type="datetime-local" className={`input ${errors.fecha_inicio ? 'input-error' : ''}`}
              value={form.fecha_inicio} onChange={set('fecha_inicio')} />
            {errors.fecha_inicio && <p className="field-error">{errors.fecha_inicio}</p>}
          </div>
          <div>
            <label className="label">Fecha fin <span className="text-red-500">*</span></label>
            <input type="datetime-local" className={`input ${errors.fecha_fin ? 'input-error' : ''}`}
              value={form.fecha_fin} onChange={set('fecha_fin')} />
            {errors.fecha_fin && <p className="field-error">{errors.fecha_fin}</p>}
          </div>
        </div>

        {/* Vehículos */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="label mb-0">Vehículos asignados</label>
            <button type="button" onClick={addVehicle} className="btn-secondary text-xs px-2 py-1">
              + Añadir vehículo
            </button>
          </div>
          {errors.vehiculos && <p className="field-error mb-2">{errors.vehiculos}</p>}
          <div className="space-y-3">
            {form.vehiculos.map((veh, i) => (
              <div key={i} className="p-3 bg-neutral-50 rounded-lg border border-neutral-200 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-neutral-600">Vehículo {i + 1}</span>
                  <button type="button" onClick={() => removeVehicle(i)}
                    className="text-red-500 hover:text-red-700 text-xs">✕ Quitar</button>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  <div>
                    <label className="label text-xs">Vehículo</label>
                    <select className="input text-sm" value={veh.vehicle_id}
                      onChange={e => setVehicleField(i, 'vehicle_id', e.target.value)}>
                      <option value="">Seleccionar...</option>
                      {vehicles.map(v => (
                        <option key={v.id} value={v.id}>{v.alias} ({v.matricula})</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="label text-xs">Responsable</label>
                    <select className="input text-sm" value={veh.responsable_user_id}
                      onChange={e => setVehicleField(i, 'responsable_user_id', e.target.value)}>
                      <option value="">Seleccionar...</option>
                      {users.map(u => (
                        <option key={u.id} value={u.id}>{u.nombre} {u.apellidos}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="label text-xs">Km inicio</label>
                    <input type="number" className="input text-sm" min={0}
                      value={veh.kilometros_inicio}
                      onChange={e => setVehicleField(i, 'kilometros_inicio', e.target.value)}
                      placeholder="Opcional" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Personal */}
        <div>
          <label className="label">Personal asignado</label>
          <div className="flex flex-wrap gap-2 max-h-40 overflow-y-auto p-2 bg-neutral-50 rounded-lg border border-neutral-200">
            {users.map(u => {
              const sel = form.usuarios.includes(u.id);
              return (
                <button
                  key={u.id}
                  type="button"
                  onClick={() => toggleUser(u.id)}
                  className={`px-3 py-1.5 rounded-full text-sm font-medium border transition-colors
                    ${sel
                      ? 'bg-primary-600 text-white border-primary-600'
                      : 'bg-white text-neutral-600 border-neutral-300 hover:border-primary-400'}`}
                >
                  {u.nombre} {u.apellidos}
                  {u.roles?.length > 0 && (
                    <span className="ml-1 text-xs opacity-70">({u.roles[0]})</span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      </form>
    </Modal>
  );
}
