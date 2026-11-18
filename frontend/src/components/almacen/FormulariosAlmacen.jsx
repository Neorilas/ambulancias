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
