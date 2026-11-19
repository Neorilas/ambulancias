/**
 * components/inventario/InventarioAmbulancia.jsx
 *
 * Lo que lleva dentro una ambulancia (v46, MAPA_CODIGO.md §2.10 «Inventario
 * de las ambulancias»). Se usa en dos sitios, siempre con `lazy()`:
 *   - la pestaña «Inventario» de la ficha del vehículo (VehicleHistory), que
 *     ven admin, gestor y superadmin;
 *   - la vista «Ambulancias» del almacén (Almacen.jsx), solo administración.
 *
 * `puedeEditar` (admin y superadmin) enseña «Añadir» y «Editar»; el gestor
 * solo mira. Lo decide de verdad el backend (403 al gestor).
 *
 * Una línea es un producto del catálogo del almacén o un texto libre. Dar de
 * alta aquí NO toca el almacén: es apuntar lo que ya hay dentro. Lo que sale
 * del almacén hacia una ambulancia entra solo, desde el almacén.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Modal from '../common/Modal.jsx';
import ConfirmDialog from '../common/ConfirmDialog.jsx';
import { PageLoading } from '../common/LoadingSpinner.jsx';
import { useNotification } from '../../context/NotificationContext.jsx';
import { inventarioService } from '../../services/inventario.service.js';
import { asignacionesService } from '../../services/asignaciones.service.js';
import { formatFechaSola } from '../../utils/dateUtils.js';
import { buscarProductos, presentacionVisible } from '../../utils/materialGastado.js';
import { claseCaducidad, estadoCaducidad, hoyEnEspana, textoCaducidad } from '../../utils/almacen.js';
import { avisosInventario, cantidadEscrita, filtrarLineas, productoExacto } from '../../utils/inventario.js';

const Fallo = ({ texto }) => (texto ? <p role="alert" className="text-sm text-bad-600">{texto}</p> : null);

function Pie({ onClose, enviando, texto, form }) {
  return (
    <>
      <button type="button" className="btn-secondary" onClick={onClose} disabled={enviando}>Cancelar</button>
      <button type="submit" form={form} className="btn-primary" disabled={enviando}>
        {enviando ? 'Guardando…' : texto}
      </button>
    </>
  );
}

/** Caducidad, cantidad y notas: lo común al alta y a la edición. */
function CamposComunes({ f, setF, prefijo, cantidadMin }) {
  return (
    <>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label" htmlFor={`${prefijo}-cantidad`}>Cantidad <span className="text-bad-500">*</span></label>
          <input id={`${prefijo}-cantidad`} className="input" inputMode="numeric" value={f.cantidad}
            onChange={e => setF(x => ({ ...x, cantidad: e.target.value }))} placeholder={String(cantidadMin)} />
        </div>
        <div>
          <label className="label" htmlFor={`${prefijo}-caducidad`}>Caducidad</label>
          <input id={`${prefijo}-caducidad`} type="date" className="input" value={f.caducidad}
            onChange={e => setF(x => ({ ...x, caducidad: e.target.value }))} />
          <p className="hint">En blanco = no caduca</p>
        </div>
      </div>
      <div>
        <label className="label" htmlFor={`${prefijo}-notas`}>Notas</label>
        <input id={`${prefijo}-notas`} className="input" maxLength={255} value={f.notas} placeholder="Dónde va, en qué bolsa…"
          onChange={e => setF(x => ({ ...x, notas: e.target.value }))} />
      </div>
    </>
  );
}

/** Alta: el nombre se autocompleta con el catálogo del almacén; si no está, texto libre. */
function LineaNuevaForm({ isOpen, vehicleId, onClose, onHecho }) {
  const [catalogo, setCatalogo] = useState(null);
  const [falloCatalogo, setFalloCatalogo] = useState(false);
  const [texto, setTexto] = useState('');
  const [producto, setProducto] = useState(null);
  const [f, setF] = useState({ cantidad: '', caducidad: '', notas: '' });
  const [enviando, setEnviando] = useState(false);
  const [fallo, setFallo] = useState('');

  useEffect(() => {
    if (!isOpen) return;
    setTexto(''); setProducto(null); setF({ cantidad: '', caducidad: '', notas: '' }); setFallo('');
    if (catalogo) return;
    asignacionesService.catalogoMaterial()
      .then(c => setCatalogo(c || []))
      .catch(() => { setCatalogo([]); setFalloCatalogo(true); });
  }, [isOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  const sugerencias = useMemo(
    () => (producto ? [] : buscarProductos(catalogo, texto)),
    [catalogo, texto, producto]
  );
  const exacto = producto || productoExacto(catalogo, texto);
  const libre = !exacto && texto.trim().length > 0;

  const submit = async (e) => {
    e.preventDefault();
    if (!exacto && !texto.trim()) return setFallo('Di qué es: busca un producto del almacén o escribe el nombre');
    const cantidad = cantidadEscrita(f.cantidad, 1);
    if (cantidad === null) return setFallo('La cantidad tiene que ser un número entero, 1 o más');
    const datos = {
      ...(exacto ? { producto_id: exacto.id } : { nombre: texto.trim() }),
      cantidad, caducidad: f.caducidad || null, notas: f.notas.trim() || null,
    };
    setEnviando(true);
    setFallo('');
    try {
      onHecho(await inventarioService.anadir(vehicleId, datos));
    } catch (err) {
      setFallo(err.message);
    } finally {
      setEnviando(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={enviando ? () => {} : onClose} title="Añadir al inventario"
      footer={<Pie onClose={onClose} enviando={enviando} texto="Añadir" form="inventario-nueva" />}>
      <form id="inventario-nueva" onSubmit={submit} className="space-y-4" noValidate>
        <div>
          <label className="label" htmlFor="inventario-nombre">Qué es <span className="text-bad-500">*</span></label>
          {producto ? (
            <div className="flex items-center gap-2 rounded-lg border border-primary-200 bg-primary-50 px-3 py-2 text-sm">
              <span className="flex-1 min-w-0 font-medium text-neutral-900">
                {producto.nombre}
                {presentacionVisible(producto) && <span className="text-neutral-500 font-normal"> · {presentacionVisible(producto)}</span>}
              </span>
              <button type="button" className="text-primary-700 hover:underline" onClick={() => { setProducto(null); setTexto(''); }}>
                Cambiar
              </button>
            </div>
          ) : (
            <>
              <input id="inventario-nombre" className="input" maxLength={150} autoComplete="off" value={texto}
                placeholder="Busca en el almacén o escribe el nombre" onChange={e => setTexto(e.target.value)} />
              {sugerencias.length > 0 && (
                <ul className="mt-1 rounded-lg border border-neutral-200 divide-y divide-neutral-100 text-sm" aria-label="Productos del almacén">
                  {sugerencias.map(p => (
                    <li key={p.id}>
                      <button type="button" className="w-full text-left px-3 py-2 hover:bg-neutral-50"
                        onClick={() => { setProducto(p); setTexto(p.nombre); }}>
                        {p.nombre}
                        {presentacionVisible(p) && <span className="text-neutral-500"> · {presentacionVisible(p)}</span>}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {libre && (
                <p className="hint">
                  {sugerencias.length > 0
                    ? 'Elige uno del almacén; si no es ninguno, se apunta como texto libre'
                    : 'No está en el almacén: se apunta como texto libre'}
                </p>
              )}
              {falloCatalogo && (
                <p className="hint text-warn-700">No se pudo cargar el catálogo del almacén: escribe el nombre a mano</p>
              )}
            </>
          )}
        </div>
        <CamposComunes f={f} setF={setF} prefijo="inventario-nueva" cantidadMin={1} />
        <p className="hint">Esto no resta nada del almacén: es apuntar lo que ya lleva la ambulancia.</p>
        <Fallo texto={fallo} />
      </form>
    </Modal>
  );
}

/** Edición de una línea: cantidad (0 = se acabó), caducidad y notas; o quitarla. */
function LineaEditarForm({ linea, onClose, onHecho, onQuitar }) {
  const [f, setF] = useState({ cantidad: '', caducidad: '', notas: '' });
  const [enviando, setEnviando] = useState(false);
  const [fallo, setFallo] = useState('');

  useEffect(() => {
    if (!linea) return;
    setF({ cantidad: String(linea.cantidad), caducidad: linea.caducidad || '', notas: linea.notas || '' });
    setFallo('');
  }, [linea]);

  const submit = async (e) => {
    e.preventDefault();
    const cantidad = cantidadEscrita(f.cantidad, 0);
    if (cantidad === null) return setFallo('La cantidad tiene que ser un número entero, 0 o más');
    setEnviando(true);
    setFallo('');
    try {
      onHecho(await inventarioService.guardar(linea.id, {
        cantidad, caducidad: f.caducidad || null, notas: f.notas.trim() || null,
      }));
    } catch (err) {
      setFallo(err.message);
    } finally {
      setEnviando(false);
    }
  };

  return (
    <Modal isOpen={!!linea} onClose={enviando ? () => {} : onClose} title={linea?.nombre || 'Editar'}
      footer={<Pie onClose={onClose} enviando={enviando} texto="Guardar" form="inventario-editar" />}>
      <form id="inventario-editar" onSubmit={submit} className="space-y-4" noValidate>
        <CamposComunes f={f} setF={setF} prefijo="inventario-editar" cantidadMin={0} />
        <p className="hint">Con 0 la línea se queda (para saber que hay que reponer). Para quitarla del todo:</p>
        <button type="button" className="text-sm text-bad-600 hover:underline" onClick={() => onQuitar(linea)} disabled={enviando}>
          Quitar del inventario
        </button>
        <Fallo texto={fallo} />
      </form>
    </Modal>
  );
}

export default function InventarioAmbulancia({ vehicleId, puedeEditar = false }) {
  const { notify } = useNotification();
  const hoy = hoyEnEspana();
  const [lineas, setLineas] = useState(null);
  const [fallo, setFallo] = useState('');
  const [q, setQ] = useState('');
  const [nueva, setNueva] = useState(false);
  const [editando, setEditando] = useState(null);
  const [quitando, setQuitando] = useState(null);
  const [borrando, setBorrando] = useState(false);

  const cargar = useCallback(async () => {
    setFallo('');
    try {
      const d = await inventarioService.deAmbulancia(vehicleId);
      setLineas(d.lineas);
    } catch (err) {
      setFallo(err.message);
    }
  }, [vehicleId]);
  useEffect(() => { setLineas(null); setQ(''); cargar(); }, [cargar]);

  const visibles = useMemo(() => filtrarLineas(lineas || [], q), [lineas, q]);
  const avisos = useMemo(() => avisosInventario(lineas || [], hoy), [lineas, hoy]);

  const quitar = async () => {
    setBorrando(true);
    try {
      await inventarioService.quitar(quitando.id);
      setQuitando(null);
      setEditando(null);
      notify.success('Quitado del inventario');
      cargar();
    } catch (err) {
      notify.error(err.message);
    } finally {
      setBorrando(false);
    }
  };

  if (fallo) {
    return (
      <div className="card text-sm">
        <p className="text-bad-600">{fallo}</p>
        <button className="btn-secondary mt-3 py-1.5 text-sm" onClick={cargar}>Reintentar</button>
      </div>
    );
  }
  if (!lineas) return <PageLoading />;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3 text-sm">
        {lineas.length > 0 && (
          <input type="search" className="input py-1.5 text-sm flex-1 min-w-[10rem] max-w-sm" placeholder="Buscar en el inventario…"
            value={q} onChange={e => setQ(e.target.value)} aria-label="Buscar en el inventario" />
        )}
        <span className="text-neutral-500">
          {lineas.length} {lineas.length === 1 ? 'elemento' : 'elementos'}
          {avisos.caducado > 0 && <span className="text-bad-600 font-semibold"> · {avisos.caducado} caducado{avisos.caducado === 1 ? '' : 's'}</span>}
          {avisos.pronto > 0 && <span className="text-warn-700 font-semibold"> · {avisos.pronto} caduca{avisos.pronto === 1 ? '' : 'n'} pronto</span>}
          {avisos.agotado > 0 && <span className="text-neutral-700"> · {avisos.agotado} a 0</span>}
        </span>
        {puedeEditar && (
          <button className="btn-primary py-1.5 text-sm ml-auto" onClick={() => setNueva(true)}>Añadir</button>
        )}
      </div>

      {lineas.length === 0 ? (
        <div className="empty">
          <p className="empty-title">El inventario está vacío</p>
          <p className="empty-hint">
            {puedeEditar
              ? 'Añade lo que lleva con «Añadir». Lo que salga del almacén hacia esta ambulancia aparecerá aquí solo.'
              : 'Aún no se ha apuntado lo que lleva esta ambulancia.'}
          </p>
        </div>
      ) : visibles.length === 0 ? (
        <div className="card text-sm text-neutral-500">Nada con «{q}»</div>
      ) : (
        <ul className="card p-0 divide-y divide-neutral-100" aria-label="Inventario de la ambulancia">
          {visibles.map(l => {
            const cad = l.cantidad > 0 ? estadoCaducidad(l.caducidad, hoy) : null;
            return (
              <li key={l.id} className="flex items-start gap-3 px-3 py-2.5 text-sm">
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-neutral-900 break-words">
                    {l.nombre}
                    {presentacionVisible(l) && <span className="text-neutral-500 font-normal"> · {presentacionVisible(l)}</span>}
                  </div>
                  <div className="text-xs text-neutral-500 flex flex-wrap gap-x-2">
                    {l.caducidad ? (
                      <span className={claseCaducidad(l.cantidad > 0 ? l.caducidad : null, hoy)}>
                        Cad. <span className="font-mono">{formatFechaSola(l.caducidad)}</span>
                        {cad && cad !== 'ok' && ` · ${textoCaducidad(l.caducidad, hoy)}`}
                      </span>
                    ) : <span>No caduca</span>}
                    {!l.del_almacen && <span>· No es del almacén</span>}
                  </div>
                  {l.notas && <div className="text-xs text-neutral-600 break-words">{l.notas}</div>}
                </div>
                <span className={`font-mono text-base whitespace-nowrap ${l.cantidad <= 0 ? 'text-bad-600 font-semibold' : 'text-neutral-900'}`}
                  aria-label={`Cantidad ${l.cantidad}`}>
                  {l.cantidad}
                </span>
                {puedeEditar && (
                  <button className="text-primary-700 hover:underline font-medium whitespace-nowrap" onClick={() => setEditando(l)}
                    aria-label={`Editar ${l.nombre}`}>
                    Editar
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {puedeEditar && (
        <>
          <LineaNuevaForm isOpen={nueva} vehicleId={vehicleId} onClose={() => setNueva(false)}
            onHecho={(r) => { setNueva(false); notify.success(r?.message || 'Añadido al inventario'); cargar(); }} />
          <LineaEditarForm linea={quitando ? null : editando} onClose={() => setEditando(null)} onQuitar={setQuitando}
            onHecho={() => { setEditando(null); notify.success('Guardado'); cargar(); }} />
          <ConfirmDialog isOpen={!!quitando} onClose={() => setQuitando(null)} onConfirm={quitar} loading={borrando} danger
            title="Quitar del inventario" confirmText="Quitar"
            message={quitando ? `Se quita «${quitando.nombre}» (${quitando.cantidad}) del inventario de esta ambulancia. No toca el almacén.` : ''} />
        </>
      )}
    </div>
  );
}
