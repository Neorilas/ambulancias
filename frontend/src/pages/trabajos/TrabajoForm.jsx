import React, { useState, useEffect } from 'react';
import Modal from '../../components/common/Modal.jsx';
import ListaMiembros from '../../components/common/ListaMiembros.jsx';
import { trabajosService } from '../../services/trabajos.service.js';
import { vehiclesService } from '../../services/vehicles.service.js';
import { usersService } from '../../services/users.service.js';
import { useNotification } from '../../context/NotificationContext.jsx';
import {
  formularioInicial, vehiculoVacio, validarTrabajo, payloadTrabajo,
} from '../../utils/trabajos.js';

export default function TrabajoForm({ trabajo, onSaved, onClose }) {
  const isEdit = !!trabajo;
  const { notify } = useNotification();

  const [vehicles, setVehicles] = useState([]);
  const [users,    setUsers]    = useState([]);
  const [saving,   setSaving]   = useState(false);
  const [errors,   setErrors]   = useState({});
  const [form,     setForm]     = useState(() => formularioInicial(trabajo));

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
    setForm(f => ({ ...f, vehiculos: [...f.vehiculos, vehiculoVacio()] }));
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
    setErrors(er => ({ ...er, vehiculos: '' }));
  };

  const toggleUser = (uid) => {
    setForm(f => ({
      ...f,
      usuarios: f.usuarios.includes(uid)
        ? f.usuarios.filter(u => u !== uid)
        : [...f.usuarios, uid],
    }));
  };

  // Un vehículo solo puede ir una vez: cada selector ofrece los que no estén
  // ya elegidos en otra fila (más el suyo, para poder mostrarlo).
  const vehiculosLibres = (propio) => {
    const usados = new Set(form.vehiculos.map(v => String(v.vehicle_id)).filter(Boolean));
    return vehicles.filter(v => String(v.id) === String(propio) || !usados.has(String(v.id)));
  };

  const handleSubmit = async (ev) => {
    ev.preventDefault();
    const e = validarTrabajo(form);
    setErrors(e);
    if (Object.keys(e).length) return;
    setSaving(true);
    try {
      const payload = payloadTrabajo(form);
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
        {/* Título */}
        <div>
          <label className="label">Título <span className="text-bad-500">*</span></label>
          <input type="text" className={`input ${errors.nombre ? 'input-error' : ''}`}
            value={form.nombre} onChange={set('nombre')} placeholder="Ej.: Cobertura maratón de Madrid" />
          {errors.nombre && <p className="field-error">{errors.nombre}</p>}
        </div>

        {/* Descripción */}
        <div>
          <label className="label">Descripción</label>
          <textarea className="input min-h-20 resize-y" value={form.descripcion}
            onChange={set('descripcion')}
            placeholder="Qué hay que hacer, punto de encuentro, contacto…" />
        </div>

        {/* Ubicación y tipo */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="label">Ubicación</label>
            <input type="text" className={`input ${errors.ubicacion ? 'input-error' : ''}`}
              value={form.ubicacion} onChange={set('ubicacion')} maxLength={255}
              placeholder="Nombre del sitio o dirección" />
            {errors.ubicacion && <p className="field-error">{errors.ubicacion}</p>}
          </div>
          <div>
            <label className="label">Tipo</label>
            <select className="input" value={form.tipo} onChange={set('tipo')}>
              <option value="traslado">Traslado</option>
              <option value="cobertura_evento">Cobertura de evento</option>
              <option value="otro">Otro</option>
            </select>
          </div>
        </div>

        {/* Fechas */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="label">Fecha inicio <span className="text-bad-500">*</span></label>
            <input type="datetime-local" className={`input ${errors.fecha_inicio ? 'input-error' : ''}`}
              value={form.fecha_inicio} onChange={set('fecha_inicio')} />
            {errors.fecha_inicio && <p className="field-error">{errors.fecha_inicio}</p>}
          </div>
          <div>
            <label className="label">Fecha fin <span className="text-bad-500">*</span></label>
            <input type="datetime-local" className={`input ${errors.fecha_fin ? 'input-error' : ''}`}
              value={form.fecha_fin} onChange={set('fecha_fin')} />
            {errors.fecha_fin && <p className="field-error">{errors.fecha_fin}</p>}
          </div>
        </div>

        {/* Vehículos */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="label mb-0">Vehículos</label>
            <button type="button" onClick={addVehicle} className="btn-secondary text-xs px-2 py-1">
              + Añadir vehículo
            </button>
          </div>
          <p className="text-xs text-neutral-500 mb-2">
            Cada responsable activa, documenta y cierra su vehículo por su cuenta.
          </p>
          {errors.vehiculos && <p className="field-error mb-2">{errors.vehiculos}</p>}
          <div className="space-y-3">
            {form.vehiculos.map((veh, i) => (
              <div key={i} className="p-3 bg-neutral-50 rounded-lg border border-neutral-200 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-neutral-600">Vehículo {i + 1}</span>
                  {veh.bloqueado ? (
                    <span className="text-xs text-neutral-400">Ya en servicio: no se puede quitar</span>
                  ) : (
                    <button type="button" onClick={() => removeVehicle(i)}
                      className="text-bad-500 hover:text-bad-600 text-xs">Quitar</button>
                  )}
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  <div className="sm:col-span-2">
                    <label className="label text-xs">Vehículo</label>
                    <select className="input text-sm" value={veh.vehicle_id} disabled={veh.bloqueado}
                      onChange={e => setVehicleField(i, 'vehicle_id', e.target.value)}>
                      <option value="">Seleccionar...</option>
                      {vehiculosLibres(veh.vehicle_id).map(v => (
                        <option key={v.id} value={v.id}>{v.alias} ({v.matricula})</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="label text-xs">Km inicio</label>
                    <input type="text" inputMode="numeric" className="input text-sm"
                      value={veh.kilometros_inicio} disabled={veh.bloqueado}
                      onChange={e => setVehicleField(i, 'kilometros_inicio', e.target.value)}
                      placeholder="Opcional" />
                  </div>
                </div>
                <div>
                  <label className="label text-xs">Responsables <span className="text-bad-500">*</span></label>
                  <ListaMiembros
                    users={users}
                    lista={veh.responsables}
                    ocupados={veh.responsables}
                    onChange={lista => setVehicleField(i, 'responsables', lista)}
                    minimo={1}
                    textoAnadir="Añadir otro responsable"
                    error={!!errors.vehiculos}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Equipo */}
        <div>
          <label className="label">Equipo</label>
          <p className="text-xs text-neutral-500 mb-2">
            Ven el título, la descripción, la ubicación y las fechas del trabajo,
            pero no la evidencia de los vehículos. Los responsables de un
            vehículo no hace falta marcarlos aquí.
          </p>
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
