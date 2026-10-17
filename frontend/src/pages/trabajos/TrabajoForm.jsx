import React, { useState, useEffect } from 'react';
import Modal from '../../components/common/Modal.jsx';
import ListaMiembros from '../../components/common/ListaMiembros.jsx';
import HorarioJornadas from '../../components/trabajos/HorarioJornadas.jsx';
import { trabajosService } from '../../services/trabajos.service.js';
import { vehiclesService } from '../../services/vehicles.service.js';
import { usersService } from '../../services/users.service.js';
import { useNotification } from '../../context/NotificationContext.jsx';
import {
  formularioInicial, ambulanciaVacia, validarTrabajo, payloadTrabajo, asociadosDeFormulario,
} from '../../utils/trabajos.js';
import { textoSolapes, textoVehiculoOcupado } from '../../utils/miembrosAsignacion.js';
import { inicioYaPasado, AVISO_INICIO_PASADO } from '../../utils/dateUtils.js';
import { esEnlaceGoogleMaps, enlaceBusquedaMaps, MAX_ENLACE_MAPS } from '../../utils/mapas.js';
import { cruzaDias, horarioDentro, etiquetaDia, textoTramos } from '../../utils/jornadas.js';

/**
 * Alta y edición de un trabajo (v33, el trabajo padre).
 *
 * Se rellena el trabajo, quién lo coordina (1..N, v35) y su EQUIPO (la gente asignada al
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

  const setCoordinadores = (lista) => {
    setForm(f => ({ ...f, coordinadores: lista }));
    setErrors(er => ({ ...er, coordinadores: '' }));
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

  const setHorario = (horario) => {
    setForm(f => ({ ...f, horario }));
    setErrors(er => ({ ...er, horario: '' }));
  };
  // El horario por días (v39) se ofrece cuando el trabajo ocupa más de un
  // día, o si ya tiene uno (para poder quitarlo)
  const conHorario = cruzaDias(form.fecha_inicio, form.fecha_fin) || form.horario.length > 0;
  // Lo que hereda una ambulancia que sigue al trabajo: los días que tocan sus fechas
  const fechasDe = (amb) => [amb.fecha_inicio || form.fecha_inicio, amb.fecha_fin || form.fecha_fin];
  const heredado = (amb) => horarioDentro(form.horario, ...fechasDe(amb));
  // «Horario propio»: arranca con una copia de lo que heredaba, para retocarla
  const setHorarioPropio = (i, propio) => {
    setForm(f => {
      const lista = [...f.asignaciones];
      const amb = lista[i];
      lista[i] = { ...amb, horario_propio: propio,
        horario: propio ? horarioDentro(f.horario, amb.fecha_inicio || f.fecha_inicio, amb.fecha_fin || f.fecha_fin) : [] };
      return { ...f, asignaciones: lista };
    });
    setErrors(er => ({ ...er, asignaciones: '' }));
  };

  // Sin enlace de Maps, quien vaya verá una búsqueda con el texto de la
  // ubicación, que puede no llevar al sitio exacto: se avisa y se deja
  // comprobar adónde lleva antes de guardar.
  const busquedaMaps = !esEnlaceGoogleMaps(form.ubicacion_url) ? enlaceBusquedaMaps(form.ubicacion) : null;
  // Al elegir quién va en cada ambulancia, arriba la gente ya asociada al
  // trabajo (equipo, coordinador, quien va en otra ambulancia) y debajo el resto
  const delEquipo = asociadosDeFormulario(form);

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

        {/* Enlace de Google Maps (v34): el punto exacto */}
        <div>
          <label className="label">Enlace de Google Maps</label>
          <input type="url" inputMode="url" autoComplete="off"
            className={`input ${errors.ubicacion_url ? 'input-error' : ''}`}
            value={form.ubicacion_url} onChange={set('ubicacion_url')} maxLength={MAX_ENLACE_MAPS}
            placeholder="https://maps.app.goo.gl/…" />
          {errors.ubicacion_url ? (
            <p className="field-error">{errors.ubicacion_url}</p>
          ) : (
            <p className="text-xs text-neutral-500 mt-1">
              Opcional. En Google Maps, busca el sitio, pulsa «Compartir», copia el enlace y pégalo aquí.
            </p>
          )}
          {busquedaMaps && (
            <div className="mt-2 rounded-lg border border-warn-200 bg-warn-50 px-3 py-2 text-xs text-warn-700"
              data-testid="aviso-ubicacion-imprecisa">
              Sin enlace, quien vaya en el trabajo verá «Buscar en Google Maps» con el texto de la
              ubicación, y la búsqueda puede no llevar al sitio exacto. Revisa adónde lleva o pega el
              enlace.{' '}
              <a href={busquedaMaps} target="_blank" rel="noopener noreferrer"
                className="font-medium underline whitespace-nowrap">
                Comprobar en Google Maps
              </a>
            </div>
          )}
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

        {/* Horario por días (v39): lo heredan las ambulancias, y en cada día
            su responsable pulsa «Inicio de jornada» y «Fin de jornada» */}
        {conHorario && (
          <div>
            <label className="label">Horario por días</label>
            <p className="text-xs text-neutral-500 mb-2">
              Cada día, el responsable de cada ambulancia pulsa «Inicio de jornada» y «Fin de jornada».
              Las fotos de inicio se hacen una vez, el primer día en base, y las de fin al volver el
              último. Todas las ambulancias siguen este horario salvo que se les ponga uno propio.
            </p>
            <HorarioJornadas value={form.horario} onChange={setHorario}
              fechaInicio={form.fecha_inicio} fechaFin={form.fecha_fin} error={errors.horario} />
          </div>
        )}

        {/* Coordinadores (D1: cualquier usuario activo; no hace falta que vaya).
            Uno o varios (v35), todos con las mismas funciones */}
        <div>
          <label className="label">Coordinadores <span className="text-bad-500">*</span></label>
          <ListaMiembros
            users={users}
            lista={form.coordinadores}
            ocupados={form.coordinadores}
            onChange={setCoordinadores}
            minimo={1}
            textoAnadir="Añadir otro coordinador"
            error={!!errors.coordinadores}
          />
          <p className="text-xs text-neutral-500 mt-1">
            Ven todas las ambulancias del trabajo y cualquiera de ellos lo cierra cuando
            todas han terminado. No hace falta que vayan en ninguna.
          </p>
          {errors.coordinadores && <p className="field-error">{errors.coordinadores}</p>}
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
                    {/* En blanco es la del trabajo: es la que guardará el backend */}
                    {inicioYaPasado(amb.fecha_inicio || form.fecha_inicio) && (
                      <p className="text-xs text-warn-700" data-testid="aviso-inicio-pasado">{AVISO_INICIO_PASADO}</p>
                    )}
                    {(form.horario.length > 0 || amb.horario_propio || cruzaDias(...fechasDe(amb))) && (
                      <div data-testid={`horario-ambulancia-${i}`}>
                        <label className="label text-xs">Horario por días de esta ambulancia</label>
                        <div className="flex flex-wrap gap-4 text-sm mb-2">
                          <label className="flex items-center gap-1.5">
                            <input type="radio" checked={!amb.horario_propio}
                              onChange={() => setHorarioPropio(i, false)} />
                            Igual que el trabajo
                          </label>
                          <label className="flex items-center gap-1.5">
                            <input type="radio" checked={!!amb.horario_propio}
                              onChange={() => setHorarioPropio(i, true)} />
                            Horario propio
                          </label>
                        </div>
                        {amb.horario_propio ? (
                          <HorarioJornadas value={amb.horario}
                            onChange={h => setAmbulancia(i, 'horario', h)}
                            fechaInicio={fechasDe(amb)[0]} fechaFin={fechasDe(amb)[1]} />
                        ) : heredado(amb).length ? (
                          <ul className="text-xs text-neutral-600 space-y-0.5">
                            {heredado(amb).map(d => (
                              <li key={d.dia}>{etiquetaDia(d.dia)}: {textoTramos(d.tramos)}</li>
                            ))}
                          </ul>
                        ) : (
                          <p className="text-xs text-neutral-500">
                            El trabajo no tiene horario por días en las fechas de esta ambulancia.
                          </p>
                        )}
                      </div>
                    )}
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
