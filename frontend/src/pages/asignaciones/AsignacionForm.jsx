import React, { useState, useEffect, useRef } from 'react';
import Modal from '../../components/common/Modal.jsx';
import { asignacionesService } from '../../services/asignaciones.service.js';
import { vehiclesService } from '../../services/vehicles.service.js';
import { usersService } from '../../services/users.service.js';
import { useNotification } from '../../context/NotificationContext.jsx';
import { toInputDatetime, toUtcIso } from '../../utils/dateUtils.js';
import {
  idsElegidos, usuariosDisponibles, miembrosIniciales, puedeAnadir, textoSolapes,
} from '../../utils/miembrosAsignacion.js';

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

// ── Lista de personas (responsables o personal) ─────────────────────────────
// Una fila por persona, con «Añadir…» debajo. Cada combobox ofrece solo a
// quien no esté ya en NINGUNA de las dos listas: la misma persona no puede
// figurar dos veces (el backend lo rechaza igualmente).
function ListaMiembros({ users, lista, ocupados, onChange, minimo, textoAnadir, error }) {
  const cambiar = (i, id) => onChange(lista.map((v, j) => (j === i ? id : v)));
  const quitar  = i => onChange(lista.filter((_, j) => j !== i));
  return (
    <div className="space-y-2">
      {lista.map((valor, i) => (
        <div key={i} className="flex items-start gap-2">
          <div className="flex-1">
            <UserCombobox
              users={usuariosDisponibles(users, ocupados, valor)}
              value={valor}
              onChange={id => cambiar(i, id)}
              error={error && !valor}
            />
          </div>
          {lista.length > minimo && (
            <button
              type="button"
              onClick={() => quitar(i)}
              className="btn-ghost btn-sm text-neutral-500 shrink-0 mt-1"
              aria-label="Quitar"
            >
              Quitar
            </button>
          )}
        </div>
      ))}
      <button
        type="button"
        onClick={() => onChange([...lista, ''])}
        disabled={!puedeAnadir(lista)}
        className="btn-secondary btn-sm"
      >
        + {textoAnadir}
      </button>
    </div>
  );
}

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
