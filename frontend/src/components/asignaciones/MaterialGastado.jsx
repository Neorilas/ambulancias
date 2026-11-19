import React, { useState } from 'react';
import { buscarProductos, presentacionVisible, MAX_CANTIDAD, MIN_LETRAS, SIN_GASTO } from '../../utils/materialGastado.js';

/**
 * Paso «Material utilizado» del cierre (v45, MAPA_CODIGO.md §2.10).
 *
 * Pensado para el móvil: una pregunta con dos botones; con «Sí», un buscador
 * que enseña como mucho 5 productos del almacén (nada de desplegables con
 * 200), lo elegido como fichas con −/+, y «No lo encuentro» para el texto
 * libre de siempre. Controlado: el estado vive en FinalizacionAsignacion para
 * que no se pierda al ir y volver entre pasos.
 *
 * Props:
 *   valor     { gasto: null|'no'|'si', items: [{producto_id, nombre, presentacion, cantidad}], libre, verLibre }
 *   onChange  (nuevoValor) => void
 *   catalogo  { estado: 'cargando'|'ok'|'error', productos: [{id, nombre, presentacion}] }
 */
export default function MaterialGastado({ valor, onChange, catalogo }) {
  const [busqueda, setBusqueda] = useState('');
  const set = (cambios) => onChange({ ...valor, ...cambios });

  const sinCatalogo = catalogo.estado === 'error' || (catalogo.estado === 'ok' && !catalogo.productos.length);
  // Sin catálogo (red mala, almacén vacío) el texto libre va abierto: es lo único que queda
  const verLibre = valor.verLibre || sinCatalogo;
  const sugerencias = buscarProductos(catalogo.productos, busqueda, valor.items);
  const buscando = busqueda.trim().length >= MIN_LETRAS;

  const elegir = (p) => {
    set({ items: [...valor.items, { producto_id: p.id, nombre: p.nombre, presentacion: p.presentacion, cantidad: 1 }] });
    setBusqueda('');
  };
  const cambiarCantidad = (id, delta) => {
    set({
      items: valor.items
        .map(i => (i.producto_id === id ? { ...i, cantidad: Math.min(MAX_CANTIDAD, i.cantidad + delta) } : i))
        .filter(i => i.cantidad > 0),
    });
  };

  const botonGasto = (clave, texto) => {
    const activo = valor.gasto === clave;
    return (
      <button
        type="button" aria-pressed={activo}
        onClick={() => set({ gasto: clave })}
        className={`flex-1 min-h-[48px] rounded-lg border text-base font-medium transition-colors ${
          activo ? 'bg-primary-600 border-primary-600 text-white' : 'bg-white border-neutral-300 text-neutral-700'
        }`}
      >{texto}</button>
    );
  };

  return (
    <div className="space-y-4">
      <div>
        <p className="label">¿Has gastado material? <span className="text-bad-500">*</span></p>
        <div className="flex gap-3">
          {botonGasto('no', 'No')}
          {botonGasto('si', 'Sí')}
        </div>
      </div>

      {valor.gasto === 'no' && (
        <p className="text-sm text-neutral-600" data-testid="sin-gasto">Se guardará «{SIN_GASTO}».</p>
      )}

      {valor.gasto === 'si' && (
        <div className="space-y-3">
          {!sinCatalogo && (
            <div>
              <label htmlFor="buscar-material" className="label">Busca el producto</label>
              <input
                id="buscar-material" type="search" className="input"
                autoComplete="off" enterKeyHint="search"
                placeholder={catalogo.estado === 'cargando' ? 'Cargando productos…' : 'Mascarilla, suero, guantes…'}
                value={busqueda} onChange={e => setBusqueda(e.target.value)}
              />
              {buscando && (
                <ul className="mt-1 border border-neutral-200 rounded-lg divide-y divide-neutral-100 bg-white" aria-label="Productos encontrados">
                  {sugerencias.map(p => (
                    <li key={p.id}>
                      <button type="button" onClick={() => elegir(p)}
                        className="w-full text-left px-3 min-h-[44px] flex items-center justify-between gap-2 active:bg-primary-50">
                        <span className="text-neutral-900">{p.nombre}</span>
                        {presentacionVisible(p) && <span className="text-xs text-neutral-500 shrink-0">{presentacionVisible(p)}</span>}
                      </button>
                    </li>
                  ))}
                  {!sugerencias.length && catalogo.estado === 'ok' && (
                    <li className="px-3 py-2 text-sm text-neutral-500">No hay ningún producto con «{busqueda.trim()}».</li>
                  )}
                </ul>
              )}
            </div>
          )}

          {valor.items.length > 0 && (
            <ul className="space-y-2" aria-label="Material elegido">
              {valor.items.map(i => (
                <li key={i.producto_id} className="flex items-center gap-2 border border-neutral-200 rounded-lg pl-3 pr-1 py-1 bg-white">
                  <span className="flex-1 min-w-0 text-sm text-neutral-900">
                    {i.nombre}
                    {presentacionVisible(i) && <span className="text-neutral-500"> · {presentacionVisible(i)}</span>}
                  </span>
                  <button type="button" onClick={() => cambiarCantidad(i.producto_id, -1)}
                    aria-label={i.cantidad === 1 ? `Quitar ${i.nombre}` : `Uno menos de ${i.nombre}`}
                    className={`w-10 h-10 rounded-lg border text-lg leading-none ${i.cantidad === 1 ? 'border-bad-200 text-bad-600' : 'border-neutral-300 text-neutral-700'}`}>
                    {i.cantidad === 1 ? '×' : '−'}
                  </button>
                  <span className="data w-8 text-center font-medium" aria-label={`Cantidad de ${i.nombre}`}>{i.cantidad}</span>
                  <button type="button" onClick={() => cambiarCantidad(i.producto_id, 1)}
                    aria-label={`Uno más de ${i.nombre}`}
                    className="w-10 h-10 rounded-lg border border-neutral-300 text-neutral-700 text-lg leading-none">+</button>
                </li>
              ))}
            </ul>
          )}

          {sinCatalogo && (
            <p className="text-sm text-warn-700">
              {catalogo.estado === 'error'
                ? 'No se ha podido cargar la lista del almacén. Escribe el material a mano.'
                : 'El almacén no tiene productos. Escribe el material a mano.'}
            </p>
          )}

          {verLibre ? (
            <div>
              <label htmlFor="material-libre" className="label">
                {sinCatalogo ? 'Material utilizado' : 'Lo que no está en la lista'}
              </label>
              <textarea
                id="material-libre" className="input resize-none" rows={3}
                placeholder="Ej.: 1 manta térmica"
                value={valor.libre} onChange={e => set({ libre: e.target.value })}
              />
            </div>
          ) : (
            <button type="button" onClick={() => set({ verLibre: true })}
              className="text-sm text-primary-700 underline underline-offset-2 min-h-[44px]">
              No lo encuentro
            </button>
          )}
        </div>
      )}
    </div>
  );
}
