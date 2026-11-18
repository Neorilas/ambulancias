/**
 * pages/almacen/Almacen.jsx
 *
 * Inventario del almacén de material (sustituye al AppSheet «AmbulanciaDB»,
 * MAPA_CODIGO.md §2.10). Dos vistas:
 *   - Stock: el catálogo con lo que queda de cada producto, el mínimo y la
 *     caducidad más próxima. Desde cada fila se apunta una entrada o una
 *     salida; el nombre abre la ficha con sus lotes (recuento, corregir
 *     caducidad) y sus últimos movimientos.
 *   - Movimientos: el historial, filtrable por tipo y ambulancia.
 *
 * Solo admin y superadmin, y oculta para el resto como Facturas: lo decide el
 * backend por rol (routes/almacen.routes.js); el flag `menu_almacen` solo la
 * pone en el menú. Va en su propio chunk (lazy en App.jsx) fuera del precache
 * de la PWA.
 *
 * Las ambulancias todavía no tienen inventario propio (2026-11-18): una salida
 * a una ambulancia solo dice a cuál fue.
 *
 * Vista, filtros y la ficha abierta van en la URL (`useEstadoEnUrl`,
 * `usePanelEnUrl`): «atrás» cierra la ficha y no se pierden los filtros.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { almacenService } from '../../services/almacen.service.js';
import { vehiclesService } from '../../services/vehicles.service.js';
import { useNotification } from '../../context/NotificationContext.jsx';
import { PageLoading } from '../../components/common/LoadingSpinner.jsx';
import Modal from '../../components/common/Modal.jsx';
import {
  ProductoForm, EntradaForm, SalidaForm, RecuentoForm, CaducidadForm,
} from '../../components/almacen/FormulariosAlmacen.jsx';
import { useBuscadorEnUrl, useEstadoEnUrl, usePanelEnUrl, paginaDeUrl } from '../../hooks/useNavegacion.js';
import { formatDateTime, formatFechaSola } from '../../utils/dateUtils.js';
import {
  FILTROS_ESTADO, TIPOS_PRODUCTO, TIPO_MOVIMIENTO, bajoMinimo, cantidadConSigno, claseCaducidad,
  destinoMovimiento, estadoCaducidad, filtrarProductos, hoyEnEspana, resumenAvisos, textoCaducidad,
} from '../../utils/almacen.js';

const VISTAS = [
  { key: 'stock',       label: 'Stock' },
  { key: 'movimientos', label: 'Movimientos' },
];
const POR_PAGINA = 50;

const nombreAmbulancia = (a) => (a.alias ? `${a.alias} · ${a.matricula}` : a.matricula);

/** Celda de stock: en rojo si está por debajo del mínimo o agotado. */
function Stock({ p }) {
  const mal = p.activo && (p.stock <= 0 || bajoMinimo(p));
  return (
    <span className={`font-mono ${mal ? 'text-bad-600 font-semibold' : 'text-neutral-900'}`}>
      {p.stock}
      {p.lotes_negativos > 0 && (
        <span className="ml-1 text-warn-700" title="Algún lote tiene más salidas que entradas: haz un recuento">⚠</span>
      )}
    </span>
  );
}

/** Tabla de movimientos (la vista Movimientos y la ficha del producto). */
function TablaMovimientos({ movimientos, conProducto = true }) {
  if (!movimientos.length) return <div className="card text-sm text-neutral-500">No hay movimientos</div>;
  return (
    <div className="card p-0 overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-neutral-50 text-neutral-600 text-xs uppercase">
            <tr>
              <th className="px-3 py-2.5 text-left whitespace-nowrap">Fecha</th>
              <th className="px-3 py-2.5 text-left whitespace-nowrap">Tipo</th>
              {conProducto && <th className="px-3 py-2.5 text-left">Producto</th>}
              <th className="px-3 py-2.5 text-left whitespace-nowrap">Caducidad</th>
              <th className="px-3 py-2.5 text-right whitespace-nowrap">Cantidad</th>
              <th className="px-3 py-2.5 text-left">Destino</th>
              <th className="px-3 py-2.5 text-left">Quién</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100">
            {movimientos.map(m => {
              const t = TIPO_MOVIMIENTO[m.tipo] || { label: m.tipo, clase: 'badge-gray' };
              return (
                <tr key={m.id}>
                  <td className="px-3 py-2.5 font-mono whitespace-nowrap">{formatDateTime(m.fecha)}</td>
                  <td className="px-3 py-2.5 whitespace-nowrap"><span className={t.clase}>{t.label}</span></td>
                  {conProducto && <td className="px-3 py-2.5 text-neutral-900">{m.producto}</td>}
                  <td className="px-3 py-2.5 font-mono whitespace-nowrap">{m.caducidad ? formatFechaSola(m.caducidad) : '—'}</td>
                  <td className={`px-3 py-2.5 text-right font-mono whitespace-nowrap ${m.cantidad < 0 ? 'text-neutral-700' : 'text-ok-600'}`}>
                    {cantidadConSigno(m.cantidad)}
                  </td>
                  <td className="px-3 py-2.5">
                    {destinoMovimiento(m)}
                    {m.notas && <div className="text-xs text-neutral-500">{m.notas}</div>}
                  </td>
                  <td className="px-3 py-2.5 text-xs text-neutral-600 break-all">
                    {m.usuario || '—'}
                    {m.importado && <div className="text-[11px] text-neutral-400">del AppSheet</div>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** Ficha de un producto: sus lotes y sus últimos movimientos. */
function FichaProducto({ id, hoy, onCerrar, onAccion, version }) {
  const [producto, setProducto] = useState(null);
  const [movs, setMovs] = useState([]);
  const [fallo, setFallo] = useState('');
  const [verVacios, setVerVacios] = useState(false);

  useEffect(() => {
    let vivo = true;
    setFallo('');
    Promise.all([almacenService.producto(id), almacenService.movimientos({ producto_id: id, limit: 20 })])
      .then(([p, m]) => { if (vivo) { setProducto(p); setMovs(m.data); } })
      .catch(err => vivo && setFallo(err.message));
    return () => { vivo = false; };
  }, [id, version]);

  const lotes = producto?.lotes || [];
  const vacios = lotes.filter(l => l.stock === 0).length;
  const visibles = verVacios ? lotes : lotes.filter(l => l.stock !== 0);

  return (
    <Modal isOpen onClose={onCerrar} size="xl" title={producto?.nombre || 'Producto'}>
      {fallo ? <p role="alert" className="text-sm text-bad-600">{fallo}</p> : !producto ? <PageLoading /> : (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
            <span className="text-neutral-600">{producto.presentacion} · {TIPOS_PRODUCTO.find(t => t.key === producto.tipo)?.label}</span>
            <span>Quedan <Stock p={producto} /></span>
            <span className="text-neutral-600">Mínimo <span className="font-mono">{producto.stock_minimo || '—'}</span></span>
            {!producto.activo && <span className="badge-gray">Retirado</span>}
            <div className="flex gap-2 sm:ml-auto">
              <button className="btn-secondary py-1.5 text-sm" onClick={() => onAccion('editar', producto)}>Editar</button>
              {producto.activo && <button className="btn-secondary py-1.5 text-sm" onClick={() => onAccion('entrada', producto)}>Entrada</button>}
              <button className="btn-primary py-1.5 text-sm" onClick={() => onAccion('salida', producto)} disabled={producto.stock <= 0}>Salida</button>
            </div>
          </div>

          <section>
            <div className="flex items-center mb-2">
              <h3 className="text-sm font-semibold text-neutral-900">Lotes</h3>
              {vacios > 0 && (
                <button className="ml-auto text-xs text-primary-700 hover:underline" onClick={() => setVerVacios(v => !v)}>
                  {verVacios ? 'Ocultar los vacíos' : `Ver también los vacíos (${vacios})`}
                </button>
              )}
            </div>
            {visibles.length === 0 ? (
              <div className="card text-sm text-neutral-500">No queda nada de este producto</div>
            ) : (
              <div className="card p-0 overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-neutral-50 text-neutral-600 text-xs uppercase">
                    <tr>
                      <th className="px-3 py-2 text-left">Caducidad</th>
                      <th className="px-3 py-2 text-right">Quedan</th>
                      <th className="px-3 py-2"><span className="sr-only">Acciones</span></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-neutral-100">
                    {visibles.map(l => (
                      <tr key={l.id}>
                        <td className="px-3 py-2">
                          <span className="font-mono">{l.caducidad ? formatFechaSola(l.caducidad) : 'No caduca'}</span>
                          {l.caducidad && l.stock > 0 && estadoCaducidad(l.caducidad, hoy) !== 'ok' && (
                            <span className={`ml-2 text-xs ${claseCaducidad(l.caducidad, hoy)}`}>{textoCaducidad(l.caducidad, hoy)}</span>
                          )}
                        </td>
                        <td className={`px-3 py-2 text-right font-mono ${l.stock < 0 ? 'text-bad-600 font-semibold' : ''}`}>{l.stock}</td>
                        <td className="px-3 py-2 text-right whitespace-nowrap text-sm">
                          {l.stock > 0 && (
                            <button className="text-primary-700 hover:underline font-medium" onClick={() => onAccion('salida', producto, l)}>Salida</button>
                          )}
                          <button className="ml-3 text-primary-700 hover:underline" onClick={() => onAccion('recuento', producto, l)}>Recuento</button>
                          <button className="ml-3 text-neutral-500 hover:underline" onClick={() => onAccion('caducidad', producto, l)}>Caducidad</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {producto.lotes_negativos > 0 && (
              <p className="mt-2 text-xs text-warn-700">
                Un lote en negativo viene del AppSheet (salieron más de las que se apuntaron al entrar). Cuenta lo que hay y apúntalo con «Recuento».
              </p>
            )}
          </section>

          <section>
            <h3 className="text-sm font-semibold text-neutral-900 mb-2">Últimos movimientos</h3>
            <TablaMovimientos movimientos={movs} conProducto={false} />
          </section>
        </div>
      )}
    </Modal>
  );
}

/** La vista Movimientos: historial paginado con filtros en la URL. */
function VistaMovimientos({ ambulancias, version }) {
  const [url, cambiar] = useEstadoEnUrl({ tipo: '', ambulancia: '', pagina: '1' });
  const pagina = paginaDeUrl(url.pagina);
  const [datos, setDatos] = useState(null);
  const [fallo, setFallo] = useState('');

  useEffect(() => {
    let vivo = true;
    setFallo('');
    almacenService.movimientos({ tipo: url.tipo, vehicle_id: url.ambulancia, page: pagina, limit: POR_PAGINA })
      .then(d => vivo && setDatos(d))
      .catch(err => vivo && setFallo(err.message));
    return () => { vivo = false; };
  }, [url.tipo, url.ambulancia, pagina, version]);

  const p = datos?.pagination;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <label className="flex items-center gap-2 text-neutral-600">
          Tipo
          <select className="input py-1.5 text-sm w-auto" value={url.tipo} onChange={e => cambiar({ tipo: e.target.value, pagina: '1' })}>
            <option value="">Todos</option>
            {Object.entries(TIPO_MOVIMIENTO).map(([k, t]) => <option key={k} value={k}>{t.label}</option>)}
          </select>
        </label>
        <label className="flex items-center gap-2 text-neutral-600">
          Ambulancia
          <select className="input py-1.5 text-sm w-auto" value={url.ambulancia} onChange={e => cambiar({ ambulancia: e.target.value, pagina: '1' })}>
            <option value="">Todas</option>
            {ambulancias.map(a => <option key={a.id} value={a.id}>{nombreAmbulancia(a)}</option>)}
          </select>
        </label>
        {p && <span className="text-neutral-500 sm:ml-auto">{p.total} {p.total === 1 ? 'movimiento' : 'movimientos'}</span>}
      </div>
      {fallo ? (
        <div className="card text-sm text-bad-600">{fallo}</div>
      ) : !datos ? <PageLoading /> : (
        <>
          <TablaMovimientos movimientos={datos.data} />
          {p.totalPages > 1 && (
            <div className="flex items-center justify-center gap-3 text-sm">
              <button className="btn-secondary py-1.5" disabled={!p.hasPrev} onClick={() => cambiar({ pagina: String(pagina - 1) })}>Anterior</button>
              <span className="text-neutral-600">Página {p.page} de {p.totalPages}</span>
              <button className="btn-secondary py-1.5" disabled={!p.hasNext} onClick={() => cambiar({ pagina: String(pagina + 1) })}>Siguiente</button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default function Almacen() {
  const { notify } = useNotification();
  const hoy = hoyEnEspana();
  const [productos, setProductos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [falloCarga, setFalloCarga] = useState('');
  const [ambulancias, setAmbulancias] = useState([]);
  const [url, cambiar] = useEstadoEnUrl({ vista: 'stock', q: '', tipo: '', estado: '', retirados: '' });
  const vista = url.vista === 'movimientos' ? 'movimientos' : 'stock';
  const [texto, setTexto] = useBuscadorEnUrl(url.q, (q) => cambiar({ q }));
  // La ficha abierta va en la URL con push: «atrás» la cierra
  const [abierto, abrirFicha, cerrarFicha] = usePanelEnUrl('producto');
  // Un popup a la vez: { tipo, producto, lote, lotes }
  const [popup, setPopup] = useState(null);
  // Sube con cada cambio guardado, para que la ficha y el historial se recarguen
  const [version, setVersion] = useState(0);

  const cargar = useCallback(async () => {
    setLoading(true);
    setFalloCarga('');
    try {
      setProductos(await almacenService.productos());
    } catch (err) {
      setFalloCarga(err.message);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { cargar(); }, [cargar]);
  useEffect(() => {
    listarAmbulancias().then(setAmbulancias).catch(() => {});
  }, []);

  const visibles = useMemo(
    () => filtrarProductos(productos, { q: url.q, tipo: url.tipo, estado: url.estado, retirados: url.retirados === '1' }, hoy),
    [productos, url.q, url.tipo, url.estado, url.retirados, hoy]
  );
  const avisos = useMemo(() => resumenAvisos(productos, hoy), [productos, hoy]);

  /** Sustituye un producto de la lista por su versión recién guardada. */
  const actualizar = (p) => {
    if (!p) return;
    setProductos(ps => (ps.some(x => x.id === p.id) ? ps.map(x => (x.id === p.id ? p : x)) : [...ps, p])
      .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es')));
  };

  /** Abre un popup. La salida necesita los lotes: se piden antes si no vienen. */
  const accion = async (tipo, producto, lote = null) => {
    if (tipo === 'salida') {
      try {
        const completo = producto.lotes ? producto : await almacenService.producto(producto.id);
        setPopup({ tipo, producto: completo, lote, lotes: completo.lotes });
      } catch (err) {
        notify.error(err.message);
      }
      return;
    }
    setPopup({ tipo, producto, lote });
  };

  const hecho = (mensaje) => (r) => {
    setPopup(null);
    // Las altas y salidas devuelven el producto ya recalculado; el recuento y
    // la caducidad no, y entonces se recarga la lista
    const p = r?.producto || (r?.nombre ? r : null);
    if (p) actualizar(p);
    else almacenService.productos().then(setProductos).catch(() => {});
    setVersion(v => v + 1);
    notify.success(typeof mensaje === 'function' ? mensaje(r) : mensaje);
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex flex-col sm:flex-row sm:items-end gap-3">
        <div className="flex-1 min-w-0">
          <h1 className="text-[19px] font-semibold text-neutral-900">Almacén</h1>
          <p className="text-neutral-500 text-sm">Material y medicación del almacén: existencias, caducidades y movimientos</p>
        </div>
        <button className="btn-primary self-start sm:self-auto" onClick={() => setPopup({ tipo: 'editar', producto: null })}>
          Nuevo producto
        </button>
      </div>

      <div className="tabs">
        {VISTAS.map(v => (
          <button key={v.key} onClick={() => cambiar({ vista: v.key })} aria-pressed={vista === v.key}
            className={vista === v.key ? 'tab-active' : 'tab'}>
            {v.label}
          </button>
        ))}
      </div>

      {vista === 'movimientos' ? <VistaMovimientos ambulancias={ambulancias} version={version} /> : loading ? <PageLoading /> : falloCarga ? (
        <div className="card text-sm">
          <p className="text-bad-600">{falloCarga}</p>
          <button className="btn-secondary mt-3 py-1.5 text-sm" onClick={cargar}>Reintentar</button>
        </div>
      ) : productos.length === 0 ? (
        <div className="empty">
          <p className="empty-title">El almacén está vacío</p>
          <p className="empty-hint">Da de alta el primer producto con «Nuevo producto»</p>
        </div>
      ) : (
        <>
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <input type="search" className="input py-1.5 text-sm flex-1 min-w-[12rem] max-w-sm" placeholder="Buscar producto…"
                value={texto} onChange={e => setTexto(e.target.value)} aria-label="Buscar producto" />
              <select className="input py-1.5 text-sm w-auto" value={url.tipo} onChange={e => cambiar({ tipo: e.target.value })} aria-label="Tipo">
                <option value="">Material y medicación</option>
                {TIPOS_PRODUCTO.map(t => <option key={t.key} value={t.key}>{t.label}</option>)}
              </select>
              <label className="flex items-center gap-2 text-neutral-600">
                <input type="checkbox" checked={url.retirados === '1'} onChange={e => cambiar({ retirados: e.target.checked ? '1' : '' })} />
                Ver retirados
              </label>
            </div>
            <div className="flex flex-wrap gap-2 text-sm" role="group" aria-label="Filtrar por aviso">
              {FILTROS_ESTADO.map(f => {
                const n = avisos[f.key];
                if (f.key && !n && url.estado !== f.key) return null;
                const activo = url.estado === f.key;
                return (
                  <button key={f.key || 'todos'} onClick={() => cambiar({ estado: f.key })} aria-pressed={activo}
                    className={`px-3 py-1 rounded-full border ${activo ? 'bg-primary-600 text-white border-primary-600' : 'border-neutral-200 text-neutral-700 hover:bg-neutral-50'}`}>
                    {f.label}{f.key ? ` · ${n}` : ''}
                  </button>
                );
              })}
              <span className="text-neutral-500 self-center sm:ml-auto">
                {visibles.length} {visibles.length === 1 ? 'producto' : 'productos'}
              </span>
            </div>
          </div>

          {visibles.length === 0 ? (
            <div className="card text-sm text-neutral-500">No hay productos con estos filtros</div>
          ) : (
            <div className="card p-0 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-neutral-50 text-neutral-600 text-xs uppercase">
                    <tr>
                      <th className="px-3 py-2.5 text-left">Producto</th>
                      <th className="px-3 py-2.5 text-right whitespace-nowrap">Quedan</th>
                      <th className="px-3 py-2.5 text-right whitespace-nowrap">Mínimo</th>
                      <th className="px-3 py-2.5 text-left whitespace-nowrap">Próxima caducidad</th>
                      <th className="px-3 py-2.5"><span className="sr-only">Acciones</span></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-neutral-100">
                    {visibles.map(p => (
                      <tr key={p.id} className={p.activo ? '' : 'opacity-60'}>
                        <td className="px-3 py-2.5">
                          <button className="text-left text-primary-700 hover:underline font-medium" onClick={() => abrirFicha(p.id)}>
                            {p.nombre}
                          </button>
                          <div className="text-xs text-neutral-500">
                            {p.presentacion}{p.tipo === 'medicacion' ? ' · Medicación' : ''}{!p.activo ? ' · Retirado' : ''}
                          </div>
                        </td>
                        <td className="px-3 py-2.5 text-right whitespace-nowrap"><Stock p={p} /></td>
                        <td className="px-3 py-2.5 text-right font-mono text-neutral-500">{p.stock_minimo || '—'}</td>
                        <td className="px-3 py-2.5 whitespace-nowrap">
                          {p.proxima_caducidad ? (
                            <>
                              <span className={`font-mono ${claseCaducidad(p.proxima_caducidad, hoy)}`}>{formatFechaSola(p.proxima_caducidad)}</span>
                              {estadoCaducidad(p.proxima_caducidad, hoy) !== 'ok' && (
                                <div className={`text-xs ${claseCaducidad(p.proxima_caducidad, hoy)}`}>{textoCaducidad(p.proxima_caducidad, hoy)}</div>
                              )}
                            </>
                          ) : <span className="text-neutral-400">{p.stock > 0 ? 'No caduca' : '—'}</span>}
                        </td>
                        <td className="px-3 py-2.5 text-right whitespace-nowrap">
                          {p.activo && (
                            <button className="text-primary-700 hover:underline font-medium" onClick={() => accion('entrada', p)}>Entrada</button>
                          )}
                          {p.stock > 0 && (
                            <button className="ml-3 text-primary-700 hover:underline font-medium" onClick={() => accion('salida', p)}>Salida</button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}

      {abierto && <FichaProducto id={abierto} hoy={hoy} version={version} onCerrar={cerrarFicha} onAccion={accion} />}

      <ProductoForm isOpen={popup?.tipo === 'editar'} producto={popup?.producto} onClose={() => setPopup(null)}
        onHecho={hecho(popup?.producto ? 'Producto guardado' : 'Producto añadido')} />
      <EntradaForm isOpen={popup?.tipo === 'entrada'} producto={popup?.producto} onClose={() => setPopup(null)}
        onHecho={hecho('Entrada apuntada')} />
      <SalidaForm isOpen={popup?.tipo === 'salida'} producto={popup?.producto} lotes={popup?.lotes} loteInicial={popup?.lote?.id}
        ambulancias={ambulancias} hoy={hoy} onClose={() => setPopup(null)} onHecho={hecho('Salida apuntada')} />
      <RecuentoForm isOpen={popup?.tipo === 'recuento'} producto={popup?.producto} lote={popup?.lote} onClose={() => setPopup(null)}
        onHecho={hecho(r => r?.message || 'Recuento apuntado')} />
      <CaducidadForm isOpen={popup?.tipo === 'caducidad'} producto={popup?.producto} lote={popup?.lote} onClose={() => setPopup(null)}
        onHecho={hecho('Caducidad corregida')} />
    </div>
  );
}

/** Las ambulancias vivas para el selector de destino, por nombre. */
async function listarAmbulancias() {
  const r = await vehiclesService.list({ limit: 100 });
  return (r.data || []).slice().sort((a, b) => nombreAmbulancia(a).localeCompare(nombreAmbulancia(b), 'es', { numeric: true }));
}
