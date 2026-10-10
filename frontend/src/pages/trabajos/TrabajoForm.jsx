import React, { useState, useEffect } from 'react';
import Modal from '../../components/common/Modal.jsx';
import ListaMiembros, { UserCombobox } from '../../components/common/ListaMiembros.jsx';
import { trabajosService } from '../../services/trabajos.service.js';
import { vehiclesService } from '../../services/vehicles.service.js';
import { usersService } from '../../services/users.service.js';
import { useNotification } from '../../context/NotificationContext.jsx';
import {
  formularioInicial, ambulanciaVacia, validarTrabajo, payloadTrabajo,
} from '../../utils/trabajos.js';
import { textoSolapes, textoVehiculoOcupado, idsElegidos } from '../../utils/miembrosAsignacion.js';

/**
 * Alta y edición de un trabajo (v33, el trabajo padre).
 *
 * Se rellena el trabajo, quién lo coordina y su EQUIPO (la gente asignada al
 * trabajo, vaya o no en una ambulancia). En el ALTA se pueden poner ya las
 * ambulancias que se sepan, o ninguna (2026-10-10): cada una es una
 * asignación, con sus responsables y su equipo, elegidos del equipo del
 * trabajo (salen primero) o de fuera. Al EDITAR, las ambulancias se añaden y
 * se cambian una a una desde la ficha del trabajo, que es donde se ve su estado.
 */
export default function TrabajoForm({ trabajo, onSaved, onClose }) {
  const isEdit = !!trabajo;
  const alta   = !isEdit;
  const { notify } = useNotification();

  const [vehicles, setVehicles] = useState([]);
  const [users,    setUsers]    = useState([]);
  const [saving,   setSaving]   = useState(false);
  const [errors,   setErrors]   = useState({});
  const [form,     setForm]     = useState(() => formularioInicial(trabajo));

  useEffect(() => {
    vehiclesService.list({ limit: 100 }).then(r => setVehicles(r.data || [])).catch(console.error);
    usersService.list({ limit: 300 }).then(r => setUsers(r.data || [])).catch(console.error);
  }, []);

  const set = (field) => (e) => {
    setForm(f => ({ ...f, [field]: e.target.value }));
    setErrors(er => ({ ...er, [field]: '' }));
  };

  const setCoordinador = (id) => {
    setForm(f => ({ ...f, coordinador_user_id: id }));
    setErrors(er => ({ ...er, coordinador_user_id: '' }));
  };

  const setAmbulancia = (i, campo, valor) => {
    setForm(f => {
      const lista = [...f.asignaciones];
      lista[i] = { ...lista[i], [campo]: valor };
      return { ...f, asignaciones: lista };
    });
    setErrors(er => ({ ...er, asignaciones: '' }));
  };

  const setEquipo = (lista) => setForm(f => ({ ...f, usuarios: lista }));
  // Al elegir quién va en cada ambulancia, la gente del equipo sale primero
  const delEquipo = new Set(idsElegidos(form.usuarios));

  const anadirAmbulancia = () =>
    setForm(f => ({ ...f, asignaciones: [...f.asignaciones, ambulanciaVacia()] }));
  const quitarAmbulancia = (i) =>
    setForm(f => ({ ...f, asignaciones: f.asignaciones.filter((_, j) => j !== i) }));

  // Una ambulancia solo puede ir una vez (D5): cada selector ofrece las que no
  // estén ya elegidas en otra fila, más la suya para poder mostrarla.
  const vehiculosLibres = (propio) => {
    const usados = new Set(form.asignaciones.map(a => String(a.vehicle_id)).filter(Boolean));
    return vehicles.filter(v => String(v.id) === String(propio) || !usados.has(String(v.id)));
  };

  const handleSubmit = async (ev) => {
    ev.preventDefault();
    const e = validarTrabajo(form, { alta });
    setErrors(e);
    if (Object.keys(e).length) return;
    setSaving(true);
    try {
      const payload = payloadTrabajo(form, { alta });
      const guardado = isEdit
        ? await trabajosService.update(trabajo.id, payload)
        : await trabajosService.create(payload);

      notify.success(isEdit ? 'Trabajo actualizado' : 'Trabajo creado');
      // Avisos por ambulancia, como al crear una asignación: lo guardado,
      // guardado está; solo se cuenta.
      for (const a of guardado?.avisos_alta || []) {
        const solapes = textoSolapes(a.solapes);
        if (solapes) notify.warning(solapes, 10000);
        const ocupada = textoVehiculoOcupado(a.vehiculo_ocupado);
        if (ocupada) notify.warning(ocupada, 10000);
        if (a.fuera_del_trabajo) {
          notify.warning('Aviso: las horas de una ambulancia se salen de las del trabajo', 10000);
        }
      }
      onSaved(guardado);
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
          <p className="text-xs text-neutral-500 mt-1">La ve todo el que vaya en cualquiera de las ambulancias.</p>
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

        {/* Coordinador (D1: cualquier usuario activo; no hace falta que vaya) */}
        <div>
          <label className="label">Coordinador <span className="text-bad-500">*</span></label>
          <UserCombobox
            users={users.filter(u => u.activo !== false && u.activo !== 0)}
            value={form.coordinador_user_id}
            onChange={setCoordinador}
            error={!!errors.coordinador_user_id}
          />
          <p className="text-xs text-neutral-500 mt-1">
            Ve todas las ambulancias del trabajo y lo cierra cuando todas han terminado.
            No hace falta que vaya en ninguna.
          </p>
          {errors.coordinador_user_id && <p className="field-error">{errors.coordinador_user_id}</p>}
        </div>

        {/* Equipo del trabajo: la gente asignada, vaya o no en una ambulancia */}
        <div>
          <label className="label">Equipo del trabajo</label>
          <p className="text-xs text-neutral-500 mb-2">
            La gente asignada al trabajo: ven la ficha y quién va en cada ambulancia.
            Al poner responsables a una ambulancia salen los primeros, aunque se
            puede elegir a cualquiera.
          </p>
          <ListaMiembros
            users={users}
            lista={form.usuarios}
            ocupados={form.usuarios}
            onChange={setEquipo}
            minimo={0}
            textoAnadir="Añadir al equipo del trabajo"
          />
        </div>

        {/* Ambulancias: solo en el alta, y opcionales */}
        {alta && (
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="label mb-0">Ambulancias</label>
              <button type="button" onClick={anadirAmbulancia} className="btn-secondary text-xs px-2 py-1">
                + Añadir ambulancia
              </button>
            </div>
            <p className="text-xs text-neutral-500 mb-2">
              Las que ya se sepan; si no, se añaden después desde la ficha del trabajo.
              Los responsables inician, documentan y finalizan su ambulancia; su equipo
              va con ellos y la ve, pero no la opera.
            </p>
            {errors.asignaciones && <p className="field-error mb-2">{errors.asignaciones}</p>}
            <div className="space-y-3">
              {form.asignaciones.map((amb, i) => {
                const ocupados = [...amb.responsables, ...amb.personal];
                return (
                  <div key={i} className="p-3 bg-neutral-50 rounded-lg border border-neutral-200 space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium text-neutral-600">Ambulancia {i + 1}</span>
                      <button type="button" onClick={() => quitarAmbulancia(i)}
                        className="text-bad-500 hover:text-bad-600 text-xs">Quitar</button>
                    </div>
                    <div>
                      <label className="label text-xs">Vehículo</label>
                      <select className="input text-sm" value={amb.vehicle_id}
                        onChange={e => setAmbulancia(i, 'vehicle_id', e.target.value)}>
                        <option value="">Seleccionar...</option>
                        {vehiculosLibres(amb.vehicle_id).map(v => (
                          <option key={v.id} value={v.id}>{v.alias} ({v.matricula})</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="label text-xs">Responsables <span className="text-bad-500">*</span></label>
                      <ListaMiembros
                        users={users}
                        lista={amb.responsables}
                        ocupados={ocupados}
                        onChange={lista => setAmbulancia(i, 'responsables', lista)}
                        minimo={1}
                        textoAnadir="Añadir otro responsable"
                        error={!!errors.asignaciones}
                        destacados={delEquipo}
                      />
                    </div>
                    <div>
                      <label className="label text-xs">Equipo (opcional)</label>
                      <ListaMiembros
                        users={users}
                        lista={amb.personal}
                        ocupados={ocupados}
                        onChange={lista => setAmbulancia(i, 'personal', lista)}
                        minimo={0}
                        textoAnadir="Añadir al equipo"
                        destacados={delEquipo}
                      />
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      <div>
                        <label className="label text-xs">Inicio (si no es el del trabajo)</label>
                        <input type="datetime-local" className="input text-sm" value={amb.fecha_inicio}
                          onChange={e => setAmbulancia(i, 'fecha_inicio', e.target.value)} />
                      </div>
                      <div>
                        <label className="label text-xs">Fin (si no es el del trabajo)</label>
                        <input type="datetime-local" className="input text-sm" value={amb.fecha_fin}
                          onChange={e => setAmbulancia(i, 'fecha_fin', e.target.value)} />
                      </div>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                      <div>
                        <label className="label text-xs">Km inicio</label>
                        <input type="text" inputMode="numeric" className="input text-sm"
                          value={amb.km_inicio} placeholder="Opcional"
                          onChange={e => setAmbulancia(i, 'km_inicio', e.target.value)} />
                      </div>
                      <div className="sm:col-span-2">
                        <label className="label text-xs">Notas para esta ambulancia</label>
                        <input type="text" className="input text-sm" value={amb.notas} maxLength={1000}
                          placeholder="Opcional"
                          onChange={e => setAmbulancia(i, 'notas', e.target.value)} />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </form>
    </Modal>
  );
}
