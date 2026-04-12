import React, { useState, useEffect, useRef } from 'react';
import Modal from '../../components/common/Modal.jsx';
import { asignacionesService } from '../../services/asignaciones.service.js';
import { vehiclesService } from '../../services/vehicles.service.js';
import { usersService } from '../../services/users.service.js';
import { useNotification } from '../../context/NotificationContext.jsx';
import { toInputDatetime, toUtcIso } from '../../utils/dateUtils.js';

// ── Combobox buscador de usuario ─────────────────────────────────────────────
function UserCombobox({ users, value, onChange, error }) {
  const [query,    setQuery]    = useState('');
  const [open,     setOpen]     = useState(false);
  const [selected, setSelected] = useState(null);
  const wrapperRef = useRef(null);

  // Sincronizar selected cuando cambia value o users desde fuera
  useEffect(() => {
    if (value && users.length) {
      const u = users.find(u => u.id === parseInt(value));
      setSelected(u || null);
      if (u) setQuery(`${u.nombre} ${u.apellidos}`);
    } else if (!value) {
      setSelected(null);
      setQuery('');
    }
  }, [value, users]);

  // Cerrar al hacer click fuera
  useEffect(() => {
    function handleClick(e) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target)) {
        setOpen(false);
        // Restaurar texto del seleccionado si el input queda a medias
        if (selected) setQuery(`${selected.nombre} ${selected.apellidos}`);
        else setQuery('');
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [selected]);

  const filtered = query.trim() === ''
    ? users
    : users.filter(u => {
        const haystack = `${u.nombre} ${u.apellidos} ${u.username}`.toLowerCase();
        return haystack.includes(query.toLowerCase());
      });

  const handleSelect = (u) => {
    setSelected(u);
    setQuery(`${u.nombre} ${u.apellidos}`);
    setOpen(false);
    onChange(u.id);
  };

  const handleInputChange = (e) => {
    setQuery(e.target.value);
    setOpen(true);
    // Si el usuario borra el texto, limpiar selección
    if (!e.target.value.trim()) {
      setSelected(null);
      onChange('');
    }
  };

  const handleClear = () => {
    setSelected(null);
    setQuery('');
    onChange('');
    setOpen(false);
  };

  return (
    <div ref={wrapperRef} className="relative">
      <div className={`flex items-center input p-0 overflow-hidden ${error ? 'input-error' : ''}`}>
        <input
          type="text"
          className="flex-1 px-3 py-2 bg-transparent outline-none text-sm placeholder-neutral-400"
          placeholder="Buscar por nombre o usuario…"
          value={query}
          onChange={handleInputChange}
          onFocus={() => setOpen(true)}
          autoComplete="off"
        />
        {selected ? (
          <button
            type="button"
            onClick={handleClear}
            className="px-2 text-neutral-400 hover:text-neutral-600 shrink-0"
            tabIndex={-1}
          >
            ✕
          </button>
        ) : (
          <span className="px-2 text-neutral-400 shrink-0 text-xs">▾</span>
        )}
      </div>

      {open && (
        <ul className="absolute z-50 mt-1 w-full bg-white border border-neutral-200 rounded-xl shadow-lg max-h-56 overflow-y-auto">
          {filtered.length === 0 ? (
            <li className="px-3 py-2 text-sm text-neutral-400 text-center">Sin resultados</li>
          ) : (
            filtered.slice(0, 50).map(u => (
              <li
                key={u.id}
                className={`px-3 py-2 cursor-pointer text-sm flex items-center justify-between hover:bg-primary-50
                  ${selected?.id === u.id ? 'bg-primary-50 font-medium text-primary-700' : 'text-neutral-700'}`}
                onMouseDown={() => handleSelect(u)}
              >
                <span>{u.nombre} {u.apellidos}</span>
                <span className="text-xs text-neutral-400 ml-2">@{u.username}</span>
              </li>
            ))
          )}
          {filtered.length > 50 && (
            <li className="px-3 py-1.5 text-xs text-neutral-400 text-center border-t border-neutral-100">
              Mostrando 50 de {filtered.length} — refina la búsqueda
            </li>
          )}
        </ul>
      )}
    </div>
  );
}

// ── Formulario principal ──────────────────────────────────────────────────────
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
    usersService.list({ limit: 300 }).then(r => setUsers(r.data || [])).catch(console.error);
  }, []);

  const set = field => e => {
    setForm(f => ({ ...f, [field]: e.target.value }));
    setErrors(prev => ({ ...prev, [field]: '' }));
  };

  const validate = () => {
    const errs = {};
    if (!form.vehicle_id)   errs.vehicle_id   = 'Selecciona un vehículo';
    if (!form.user_id)      errs.user_id      = 'Selecciona un responsable';
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
        user_id:      parseInt(form.user_id),
        fecha_inicio: toUtcIso(form.fecha_inicio),
        fecha_fin:    toUtcIso(form.fecha_fin),
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

        {/* Responsable — combobox buscable */}
        <div>
          <label className="label">Responsable <span className="text-red-500">*</span></label>
          <UserCombobox
            users={users}
            value={form.user_id}
            onChange={id => {
              setForm(f => ({ ...f, user_id: id }));
              setErrors(prev => ({ ...prev, user_id: '' }));
            }}
            error={!!errors.user_id}
          />
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
