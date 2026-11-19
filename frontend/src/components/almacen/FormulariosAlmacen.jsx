/**
 * components/almacen/FormulariosAlmacen.jsx
 * Los popups del almacén: producto (alta y edición), entrada, salida,
 * recuento de un lote y corrección de su caducidad. Solo los usa
 * pages/almacen/Almacen.jsx (chunk lazy, solo administración).
 *
 * Todos siguen la misma forma: `isOpen`, `onClose`, los datos que necesitan y
 * `onHecho(resultado)` cuando el backend ha guardado. El error del backend
 * (p. ej. «De ese lote solo quedan 2») se enseña dentro del popup, sin
 * cerrarlo, para poder corregir y reintentar.
 */

import React, { useEffect, useState } from 'react';
import Modal from '../common/Modal.jsx';
import { almacenService } from '../../services/almacen.service.js';
import { formatFechaSola } from '../../utils/dateUtils.js';
import { PRESENTACIONES, TIPOS_PRODUCTO, claseCaducidad, textoCaducidad } from '../../utils/almacen.js';

/** Pie de los popups: Cancelar + el botón de guardar. */
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

/** Estado de envío común: llama a `accion`, y si falla deja el mensaje en `fallo`. */
function useEnvio(onHecho) {
  const [enviando, setEnviando] = useState(false);
  const [fallo, setFallo] = useState('');
  const enviar = async (accion) => {
    setEnviando(true);
    setFallo('');
    try {
      onHecho(await accion());
    } catch (err) {
      setFallo(err.message);
    } finally {
      setEnviando(false);
    }
  };
  return { enviando, fallo, setFallo, enviar };
}

const Fallo = ({ texto }) => (texto ? <p role="alert" className="text-sm text-bad-600">{texto}</p> : null);

/** Cantidad entera positiva escrita en el campo, o null. */
const cantidadValida = (t) => (/^\d{1,6}$/.test(String(t).trim()) && Number(t) > 0 ? Number(t) : null);

// ── Producto ──────────────────────────────────────────────────────────────────

export function ProductoForm({ isOpen, onClose, producto, onHecho }) {
  const nuevo = !producto;
  const [f, setF] = useState({});
  const { enviando, fallo, setFallo, enviar } = useEnvio(onHecho);

  useEffect(() => {
    if (!isOpen) return;
    setFallo('');
    setF(producto
      ? { nombre: producto.nombre, presentacion: producto.presentacion, tipo: producto.tipo,
          stock_minimo: String(producto.stock_minimo), activo: producto.activo }
      : { nombre: '', presentacion: 'Unidad', tipo: 'producto', stock_minimo: '0', activo: true });
  }, [isOpen, producto, setFallo]);

  const submit = (e) => {
    e.preventDefault();
    if (!f.nombre?.trim()) return setFallo('Pon el nombre del producto');
    if (!/^\d{1,6}$/.test(String(f.stock_minimo).trim())) return setFallo('El stock mínimo tiene que ser un número entero, 0 o más');
    const datos = { nombre: f.nombre, presentacion: f.presentacion, tipo: f.tipo, stock_minimo: Number(f.stock_minimo) };
    if (!nuevo) datos.activo = f.activo;
    return enviar(() => (nuevo ? almacenService.crearProducto(datos) : almacenService.guardarProducto(producto.id, datos)));
  };

  return (
    <Modal isOpen={isOpen} onClose={enviando ? () => {} : onClose} title={nuevo ? 'Nuevo producto' : 'Editar producto'}
      footer={<Pie onClose={onClose} enviando={enviando} texto={nuevo ? 'Añadir' : 'Guardar'} form="form-producto" />}>
      <form id="form-producto" onSubmit={submit} className="space-y-4" noValidate>
        <div>
          <label className="label" htmlFor="producto-nombre">Nombre <span className="text-bad-500">*</span></label>
          <input id="producto-nombre" className="input" value={f.nombre || ''} maxLength={150} autoFocus
            onChange={e => setF({ ...f, nombre: e.target.value })} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label" htmlFor="producto-presentacion">Presentación</label>
            <input id="producto-presentacion" className="input" list="presentaciones" maxLength={30}
              value={f.presentacion || ''} onChange={e => setF({ ...f, presentacion: e.target.value })} />
            <datalist id="presentaciones">{PRESENTACIONES.map(p => <option key={p} value={p} />)}</datalist>
          </div>
          <div>
            <label className="label" htmlFor="producto-tipo">Tipo</label>
            <select id="producto-tipo" className="input" value={f.tipo || 'producto'} onChange={e => setF({ ...f, tipo: e.target.value })}>
              {TIPOS_PRODUCTO.map(t => <option key={t.key} value={t.key}>{t.label}</option>)}
            </select>
          </div>
        </div>
        <div>
          <label className="label" htmlFor="producto-minimo">Stock mínimo</label>
          <input id="producto-minimo" className="input w-32" inputMode="numeric" value={f.stock_minimo ?? ''}
            onChange={e => setF({ ...f, stock_minimo: e.target.value })} />
          <p className="hint">Por debajo de esta cantidad sale en rojo. 0 = sin mínimo.</p>
        </div>
        {!nuevo && (
          <label className="flex items-start gap-2 text-sm text-neutral-700">
            <input type="checkbox" className="mt-0.5" checked={!f.activo} onChange={e => setF({ ...f, activo: !e.target.checked })} />
            <span>Retirado del catálogo <span className="block text-neutral-500">Ya no se usa: deja de salir en la lista, pero se conserva su historial.</span></span>
          </label>
        )}
        <Fallo texto={fallo} />
      </form>
    </Modal>
  );
}

// ── Entrada ───────────────────────────────────────────────────────────────────

export function EntradaForm({ isOpen, onClose, producto, onHecho }) {
  const [caducidad, setCaducidad] = useState('');
  const [noCaduca, setNoCaduca] = useState(false);
  const [cantidad, setCantidad] = useState('');
  const [notas, setNotas] = useState('');
  const { enviando, fallo, setFallo, enviar } = useEnvio(onHecho);

  useEffect(() => {
    if (!isOpen) return;
    setCaducidad(''); setCantidad(''); setNotas(''); setFallo('');
    // Si lo que hay de este producto no caduca, lo normal es que lo nuevo tampoco
    setNoCaduca(Boolean(producto?.lotes_con_stock) && !producto?.proxima_caducidad);
  }, [isOpen, producto, setFallo]);

  const submit = (e) => {
    e.preventDefault();
    const n = cantidadValida(cantidad);
    if (!n) return setFallo('Pon cuántas unidades entran');
    if (!noCaduca && !caducidad) return setFallo('Pon la caducidad, o marca «No caduca»');
    return enviar(() => almacenService.movimiento({
      tipo: 'entrada', producto_id: producto.id, caducidad: noCaduca ? '' : caducidad, cantidad: n, notas,
    }));
  };

  return (
    <Modal isOpen={isOpen} onClose={enviando ? () => {} : onClose} title="Entrada al almacén"
      footer={<Pie onClose={onClose} enviando={enviando} texto="Apuntar entrada" form="form-entrada" />}>
      <form id="form-entrada" onSubmit={submit} className="space-y-4" noValidate>
        <p className="text-sm text-neutral-700"><span className="font-semibold">{producto?.nombre}</span> · {producto?.presentacion}</p>
        <div>
          <label className="label" htmlFor="entrada-cantidad">Cantidad <span className="text-bad-500">*</span></label>
          <input id="entrada-cantidad" className="input w-32" inputMode="numeric" value={cantidad} autoFocus
            onChange={e => setCantidad(e.target.value)} />
        </div>
        <div>
          <label className="label" htmlFor="entrada-caducidad">Caducidad <span className="text-bad-500">*</span></label>
          <input id="entrada-caducidad" type="date" className="input w-48" value={caducidad} disabled={noCaduca}
            onChange={e => setCaducidad(e.target.value)} />
          <label className="mt-2 flex items-center gap-2 text-sm text-neutral-700">
            <input type="checkbox" checked={noCaduca} onChange={e => setNoCaduca(e.target.checked)} /> No caduca
          </label>
          <p className="hint">Si ya hay un lote con esa caducidad, se suma a él.</p>
        </div>
        <div>
          <label className="label" htmlFor="entrada-notas">Notas</label>
          <input id="entrada-notas" className="input" maxLength={255} value={notas} placeholder="Proveedor, albarán…"
            onChange={e => setNotas(e.target.value)} />
        </div>
        <Fallo texto={fallo} />
      </form>
    </Modal>
  );
}

// ── Salida ────────────────────────────────────────────────────────────────────

const DESTINOS = [
  { key: 'salida_ambulancia', label: 'A una ambulancia' },
  { key: 'salida_otros',      label: 'A otro sitio' },
  { key: 'descarte',          label: 'Descarte (caducado, roto…)' },
];

/**
 * `lotes` son los del producto (de `GET /productos/:id`); solo se ofrecen los
 * que tienen existencias, el que caduca antes primero y elegido de entrada.
 */
export function SalidaForm({ isOpen, onClose, producto, lotes = [], loteInicial, ambulancias = [], hoy, onHecho }) {
  const conStock = lotes.filter(l => l.stock > 0);
  const [lote, setLote] = useState('');
  const [tipo, setTipo] = useState('salida_ambulancia');
  const [vehiculo, setVehiculo] = useState('');
  const [destino, setDestino] = useState('');
  const [cantidad, setCantidad] = useState('');
  const [notas, setNotas] = useState('');
  const { enviando, fallo, setFallo, enviar } = useEnvio(onHecho);

  useEffect(() => {
    if (!isOpen) return;
    setLote(String(loteInicial || conStock[0]?.id || ''));
    setTipo('salida_ambulancia'); setVehiculo(''); setDestino(''); setCantidad(''); setNotas(''); setFallo('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, loteInicial, setFallo]);

  const elegido = conStock.find(l => String(l.id) === lote);

  const submit = (e) => {
    e.preventDefault();
    if (!elegido) return setFallo('Elige de qué lote sale');
    const n = cantidadValida(cantidad);
    if (!n) return setFallo('Pon cuántas unidades salen');
    if (n > elegido.stock) return setFallo(`De ese lote solo quedan ${elegido.stock}`);
    if (tipo === 'salida_ambulancia' && !vehiculo) return setFallo('Elige la ambulancia');
    if (tipo === 'salida_otros' && !destino.trim()) return setFallo('Di adónde va');
    return enviar(() => almacenService.movimiento({
      tipo, lote_id: elegido.id, cantidad: n, notas,
      ...(tipo === 'salida_ambulancia' && { vehicle_id: Number(vehiculo) }),
      ...(tipo === 'salida_otros' && { destino }),
    }));
  };

  return (
    <Modal isOpen={isOpen} onClose={enviando ? () => {} : onClose} title="Salida del almacén"
      footer={conStock.length ? <Pie onClose={onClose} enviando={enviando} texto="Apuntar salida" form="form-salida" /> : null}>
      {conStock.length === 0 ? (
        <p className="text-sm text-neutral-600">De <span className="font-semibold">{producto?.nombre}</span> no queda nada en el almacén.</p>
      ) : (
        <form id="form-salida" onSubmit={submit} className="space-y-4" noValidate>
          <p className="text-sm text-neutral-700"><span className="font-semibold">{producto?.nombre}</span> · {producto?.presentacion}</p>
          <div>
            <label className="label" htmlFor="salida-lote">Lote</label>
            <select id="salida-lote" className="input" value={lote} onChange={e => setLote(e.target.value)}>
              {conStock.map(l => (
                <option key={l.id} value={l.id}>
                  {l.caducidad ? `Caduca ${formatFechaSola(l.caducidad)}` : 'No caduca'} · quedan {l.stock}
                </option>
              ))}
            </select>
            {elegido?.caducidad && (
              <p className={`hint ${claseCaducidad(elegido.caducidad, hoy)}`}>{textoCaducidad(elegido.caducidad, hoy)}</p>
            )}
          </div>
          <div>
            <label className="label" htmlFor="salida-cantidad">Cantidad <span className="text-bad-500">*</span></label>
            <input id="salida-cantidad" className="input w-32" inputMode="numeric" value={cantidad} autoFocus
              onChange={e => setCantidad(e.target.value)} />
          </div>
          <fieldset>
            <legend className="label">Adónde va</legend>
            <div className="space-y-1.5">
              {DESTINOS.map(d => (
                <label key={d.key} className="flex items-center gap-2 text-sm text-neutral-700">
                  <input type="radio" name="salida-tipo" value={d.key} checked={tipo === d.key} onChange={() => setTipo(d.key)} />
                  {d.label}
                </label>
              ))}
            </div>
          </fieldset>
          {tipo === 'salida_ambulancia' && (
            <div>
              <label className="label" htmlFor="salida-ambulancia">Ambulancia <span className="text-bad-500">*</span></label>
              <select id="salida-ambulancia" className="input" value={vehiculo} onChange={e => setVehiculo(e.target.value)}>
                <option value="">Elige…</option>
                {ambulancias.map(a => (
                  <option key={a.id} value={a.id}>{a.alias ? `${a.alias} · ${a.matricula}` : a.matricula}</option>
                ))}
              </select>
            </div>
          )}
          {tipo === 'salida_otros' && (
            <div>
              <label className="label" htmlFor="salida-destino">Destino <span className="text-bad-500">*</span></label>
              <input id="salida-destino" className="input" maxLength={150} value={destino} placeholder="Botiquín, ampulario, obra…"
                onChange={e => setDestino(e.target.value)} />
            </div>
          )}
          <div>
            <label className="label" htmlFor="salida-notas">Notas</label>
            <input id="salida-notas" className="input" maxLength={255} value={notas} onChange={e => setNotas(e.target.value)} />
          </div>
          <Fallo texto={fallo} />
        </form>
      )}
    </Modal>
  );
}

// ── Recuento y caducidad de un lote ───────────────────────────────────────────

export function RecuentoForm({ isOpen, onClose, producto, lote, onHecho }) {
  const [contado, setContado] = useState('');
  const [notas, setNotas] = useState('');
  const { enviando, fallo, setFallo, enviar } = useEnvio(onHecho);

  useEffect(() => {
    if (!isOpen) return;
    setContado(''); setNotas(''); setFallo('');
  }, [isOpen, setFallo]);

  const submit = (e) => {
    e.preventDefault();
    if (!/^\d{1,6}$/.test(contado.trim())) return setFallo('Pon cuántas hay de verdad (0 si no queda ninguna)');
    return enviar(() => almacenService.recuento(lote.id, Number(contado), notas));
  };
  const diferencia = /^\d{1,6}$/.test(contado.trim()) && lote ? Number(contado) - lote.stock : null;

  return (
    <Modal isOpen={isOpen} onClose={enviando ? () => {} : onClose} title="Recuento del lote"
      footer={<Pie onClose={onClose} enviando={enviando} texto="Apuntar recuento" form="form-recuento" />}>
      <form id="form-recuento" onSubmit={submit} className="space-y-4" noValidate>
        <p className="text-sm text-neutral-700">
          <span className="font-semibold">{producto?.nombre}</span> · {lote?.caducidad ? `caduca ${formatFechaSola(lote.caducidad)}` : 'no caduca'}
          <span className="block text-neutral-500">Según la app quedan <span className="font-mono">{lote?.stock}</span>.</span>
        </p>
        <div>
          <label className="label" htmlFor="recuento-contado">Contadas en el almacén <span className="text-bad-500">*</span></label>
          <input id="recuento-contado" className="input w-32" inputMode="numeric" value={contado} autoFocus
            onChange={e => setContado(e.target.value)} />
          {diferencia !== null && diferencia !== 0 && (
            <p className="hint">Se apuntará un ajuste de <span className="font-mono">{diferencia > 0 ? `+${diferencia}` : diferencia}</span>.</p>
          )}
          {diferencia === 0 && <p className="hint">Cuadra: no se apuntará nada.</p>}
        </div>
        <div>
          <label className="label" htmlFor="recuento-notas">Notas</label>
          <input id="recuento-notas" className="input" maxLength={255} value={notas} placeholder="Recuento"
            onChange={e => setNotas(e.target.value)} />
        </div>
        <Fallo texto={fallo} />
      </form>
    </Modal>
  );
}

/**
 * Recuento de un producto entero: una casilla por lote con lo contado. En
 * blanco = no contado (no se toca). «Otra caducidad» es para unidades cuyo
 * lote no está en la app; si esa fecha ya tiene un lote vacío, se cuenta en
 * ese lote en vez de crear otro.
 */
export function RecuentoProductoForm({ isOpen, onClose, producto, onHecho }) {
  const [contado, setContado] = useState({});
  const [nuevos, setNuevos] = useState([]);
  const [notas, setNotas] = useState('');
  const [verVacios, setVerVacios] = useState(false);
  const { enviando, fallo, setFallo, enviar } = useEnvio(onHecho);
  const lotes = producto?.lotes || [];

  useEffect(() => {
    if (!isOpen) return;
    setContado({}); setNuevos([]); setNotas(''); setVerVacios(false); setFallo('');
  }, [isOpen, setFallo]);

  const numero = t => (/^\d{1,6}$/.test(String(t ?? '').trim()) ? Number(t) : null);
  const vacios = lotes.filter(l => l.stock === 0).length;
  const visibles = verVacios ? lotes : lotes.filter(l => l.stock !== 0 || contado[l.id] !== undefined);
  const cambiarNuevo = (i, campo, v) => setNuevos(ns => ns.map((n, j) => (j === i ? { ...n, [campo]: v } : n)));

  const submit = (e) => {
    e.preventDefault();
    const cuentas = {};
    for (const l of lotes) {
      const t = contado[l.id];
      if (t === undefined || String(t).trim() === '') continue;
      if (numero(t) === null) return setFallo(`Lo contado del lote ${l.caducidad ? formatFechaSola(l.caducidad) : 'sin caducidad'} tiene que ser un número, 0 o más`);
      cuentas[l.id] = numero(t);
    }
    const lotesNuevos = [];
    for (const n of nuevos) {
      if (!n.caducidad && !n.noCaduca && String(n.cantidad ?? '').trim() === '') continue;
      const cant = numero(n.cantidad);
      if (!n.noCaduca && !n.caducidad) return setFallo('Pon la caducidad de la fila nueva, o marca «No caduca»');
      if (!cant) return setFallo('Una fila nueva tiene que tener 1 unidad o más');
      const caducidad = n.noCaduca ? null : n.caducidad;
      const existe = lotes.find(l => (l.caducidad || null) === caducidad);
      if (existe) {
        if (existe.stock !== 0 || cuentas[existe.id] !== undefined) {
          return setFallo(`Ya hay un lote ${caducidad ? `que caduca el ${formatFechaSola(caducidad)}` : 'sin caducidad'}: cuéntalo en su fila`);
        }
        cuentas[existe.id] = cant;
        continue;
      }
      if (lotesNuevos.some(x => x.caducidad === caducidad)) return setFallo('Hay dos filas nuevas con la misma caducidad');
      lotesNuevos.push({ caducidad: caducidad || '', stock_real: cant });
    }
    const contados = Object.entries(cuentas).map(([id, n]) => ({ lote_id: Number(id), stock_real: n }));
    if (!contados.length && !lotesNuevos.length) return setFallo('Pon lo contado de al menos un lote');
    return enviar(() => almacenService.recuentoProducto(producto.id, { lotes: contados, nuevos: lotesNuevos, notas }));
  };

  return (
    <Modal isOpen={isOpen} onClose={enviando ? () => {} : onClose} title="Recuento del producto" size="lg"
      footer={<Pie onClose={onClose} enviando={enviando} texto="Apuntar recuento" form="form-recuento-producto" />}>
      <form id="form-recuento-producto" onSubmit={submit} className="space-y-4" noValidate>
        <p className="text-sm text-neutral-700">
          <span className="font-semibold">{producto?.nombre}</span>
          <span className="block text-neutral-500">
            Cuenta lo que hay de cada caducidad. Si un lote está en negativo, cuenta todos: casi siempre es que se sacó de otro lote.
            Lo que dejes en blanco no se toca.
          </span>
        </p>
        <div className="card p-0 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-neutral-50 text-neutral-600 text-xs uppercase">
              <tr>
                <th className="px-3 py-2 text-left">Caducidad</th>
                <th className="px-3 py-2 text-right">En la app</th>
                <th className="px-3 py-2 text-left">Contadas</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {visibles.map(l => {
                const n = numero(contado[l.id]);
                const dif = n === null ? null : n - l.stock;
                const nombre = l.caducidad ? formatFechaSola(l.caducidad) : 'No caduca';
                return (
                  <tr key={l.id}>
                    <td className="px-3 py-2 font-mono">{nombre}</td>
                    <td className={`px-3 py-2 text-right font-mono ${l.stock < 0 ? 'text-bad-600 font-semibold' : ''}`}>{l.stock}</td>
                    <td className="px-3 py-2">
                      <input className="input w-20 py-1" inputMode="numeric" aria-label={`Contadas del lote ${nombre}`}
                        value={contado[l.id] ?? ''} onChange={e => setContado(c => ({ ...c, [l.id]: e.target.value }))} />
                      {dif !== null && (
                        <span className={`ml-2 text-xs font-mono ${dif === 0 ? 'text-neutral-400' : 'text-neutral-700'}`}>
                          {dif === 0 ? 'cuadra' : dif > 0 ? `+${dif}` : dif}
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
              {nuevos.map((n, i) => (
                <tr key={`nuevo-${i}`}>
                  <td className="px-3 py-2" colSpan={2}>
                    <input type="date" className="input w-40 py-1" aria-label="Caducidad de la fila nueva" value={n.caducidad || ''}
                      disabled={n.noCaduca} onChange={e => cambiarNuevo(i, 'caducidad', e.target.value)} />
                    <label className="mt-1 flex items-center gap-2 text-xs text-neutral-600">
                      <input type="checkbox" checked={!!n.noCaduca} onChange={e => cambiarNuevo(i, 'noCaduca', e.target.checked)} /> No caduca
                    </label>
                  </td>
                  <td className="px-3 py-2">
                    <input className="input w-20 py-1" inputMode="numeric" aria-label="Contadas de la fila nueva"
                      value={n.cantidad || ''} onChange={e => cambiarNuevo(i, 'cantidad', e.target.value)} />
                    <button type="button" className="ml-2 text-xs text-neutral-500 hover:underline"
                      onClick={() => setNuevos(ns => ns.filter((_, j) => j !== i))}>Quitar</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
          <button type="button" className="text-primary-700 hover:underline" onClick={() => setNuevos(ns => [...ns, {}])}>
            + Otra caducidad que no está en la lista
          </button>
          {vacios > 0 && (
            <button type="button" className="text-primary-700 hover:underline" onClick={() => setVerVacios(v => !v)}>
              {verVacios ? 'Ocultar los vacíos' : `Ver también los vacíos (${vacios})`}
            </button>
          )}
        </div>
        <div>
          <label className="label" htmlFor="recuento-producto-notas">Notas</label>
          <input id="recuento-producto-notas" className="input" maxLength={255} value={notas} placeholder="Recuento"
            onChange={e => setNotas(e.target.value)} />
        </div>
        <Fallo texto={fallo} />
      </form>
    </Modal>
  );
}

export function CaducidadForm({ isOpen, onClose, producto, lote, onHecho }) {
  const [caducidad, setCaducidad] = useState('');
  const [noCaduca, setNoCaduca] = useState(false);
  const { enviando, fallo, setFallo, enviar } = useEnvio(onHecho);

  useEffect(() => {
    if (!isOpen) return;
    setCaducidad(lote?.caducidad || ''); setNoCaduca(!lote?.caducidad); setFallo('');
  }, [isOpen, lote, setFallo]);

  const submit = (e) => {
    e.preventDefault();
    if (!noCaduca && !caducidad) return setFallo('Pon la caducidad, o marca «No caduca»');
    return enviar(() => almacenService.corregirCaducidad(lote.id, noCaduca ? '' : caducidad));
  };

  return (
    <Modal isOpen={isOpen} onClose={enviando ? () => {} : onClose} title="Corregir la caducidad"
      footer={<Pie onClose={onClose} enviando={enviando} texto="Guardar" form="form-caducidad" />}>
      <form id="form-caducidad" onSubmit={submit} className="space-y-4" noValidate>
        <p className="text-sm text-neutral-700"><span className="font-semibold">{producto?.nombre}</span> · quedan <span className="font-mono">{lote?.stock}</span></p>
        <div>
          <label className="label" htmlFor="caducidad-fecha">Caducidad</label>
          <input id="caducidad-fecha" type="date" className="input w-48" value={caducidad} disabled={noCaduca}
            onChange={e => setCaducidad(e.target.value)} />
          <label className="mt-2 flex items-center gap-2 text-sm text-neutral-700">
            <input type="checkbox" checked={noCaduca} onChange={e => setNoCaduca(e.target.checked)} /> No caduca
          </label>
          <p className="hint">Para un lote mal apuntado. Las existencias no cambian.</p>
        </div>
        <Fallo texto={fallo} />
      </form>
    </Modal>
  );
}
