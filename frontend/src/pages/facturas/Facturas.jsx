/**
 * pages/facturas/Facturas.jsx
 *
 * Facturas para descargar, en dos apartados:
 *   - Proveedores: Google Ads y los que vengan. Se suben aquí.
 *   - Mantenimiento vehículos: las que llevan `vehicle_id`. Se suben desde la
 *     ficha del vehículo (pestaña Revisiones) y aquí se ven todas juntas.
 * Solo admin y superadmin: lo decide el backend por rol
 * (routes/facturas.routes.js); el flag `menu_facturas` solo pone la pantalla
 * en el menú.
 *
 * Las de proveedor se suben a mano en dos pasos (el backend lee el PDF y el
 * admin revisa y completa, ver components/facturas/SubirFactura) o llegan
 * solas desde el buzón de facturas@ (lo lee el backend,
 * services/buzonFacturas.service.js). Las del buzón llevan `origen: 'correo'`
 * y se marcan con una etiqueta; arriba va el estado de la última revisión y
 * un botón para revisarlo ya.
 *
 * El apartado y los filtros van en la URL (`useEstadoEnUrl`): desde
 * Mantenimiento se salta a la ficha del vehículo y «atrás» vuelve igual.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { facturasService } from '../../services/facturas.service.js';
import { useNotification } from '../../context/NotificationContext.jsx';
import { PageLoading }     from '../../components/common/LoadingSpinner.jsx';
import ConfirmDialog       from '../../components/common/ConfirmDialog.jsx';
import SubirFactura        from '../../components/facturas/SubirFactura.jsx';
import { useEstadoEnUrl }  from '../../hooks/useNavegacion.js';
import { formatFechaSola } from '../../utils/dateUtils.js';
import { fmtEuros, fmtTamano, nombreDescarga, TIPO_REVISION_LABELS } from '../../utils/facturas.js';

const TODOS = '';
const PROVEEDORES = 'proveedores';
const MANTENIMIENTO = 'mantenimiento';
const APARTADOS = [
  { key: PROVEEDORES,   label: 'Proveedores' },
  { key: MANTENIMIENTO, label: 'Mantenimiento vehículos' },
];

/** «hace 5 min», «hace 2 h», o la fecha si es de otro día. */
function haceCuanto(iso) {
  const min = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (!Number.isFinite(min)) return '';
  if (min < 1) return 'ahora mismo';
  if (min < 60) return `hace ${min} min`;
  if (min < 24 * 60) return `hace ${Math.round(min / 60)} h`;
  return new Date(iso).toLocaleString('es-ES', { timeZone: 'Europe/Madrid', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

/**
 * Estado del buzón de facturas@ (lo lee el backend solo, cada hora) y un botón
 * para revisarlo ya. Sin buzón configurado en el servidor no se pinta nada:
 * la subida a mano sigue igual.
 */
function EstadoBuzon({ estado, revisando, onRevisar }) {
  if (!estado?.configurado) return null;
  const u = estado.ultima;
  return (
    <div className="card p-3 flex flex-col sm:flex-row sm:items-center gap-2 text-sm">
      <div className="flex-1 min-w-0">
        <span className="text-neutral-600">Buzón </span>
        <span className="font-mono text-neutral-900 break-all">{estado.buzon}</span>
        <span className="text-neutral-500">
          {!u ? ' · todavía no se ha revisado desde el último arranque'
            : u.ok ? ` · revisado ${haceCuanto(u.at)}${u.importadas ? `, ${u.importadas} ${u.importadas === 1 ? 'nueva' : 'nuevas'}` : ', nada nuevo'}`
            : null}
        </span>
        {u && !u.ok && <span className="text-bad-600"> · falló {haceCuanto(u.at)}: {u.error}</span>}
        {u?.ok && u.sin_firma > 0 && (
          <span className="text-warn-700"> · {u.sin_firma} sin firma válida del remitente, no se han guardado</span>
        )}
        {u?.ok && u.errores > 0 && (
          <span className="text-bad-600"> · {u.errores} no se {u.errores === 1 ? 'ha' : 'han'} podido guardar</span>
        )}
      </div>
      <button className="btn-secondary self-start sm:self-auto py-1.5 text-sm" onClick={onRevisar} disabled={revisando}>
        {revisando ? 'Revisando…' : 'Revisar ahora'}
      </button>
    </div>
  );
}

/** Vehículo de una factura de mantenimiento, con enlace a sus revisiones. */
function CeldaVehiculo({ f }) {
  return (
    <>
      <Link to={`/vehiculos/${f.vehicle_id}?tab=revisiones`} className="text-primary-700 hover:underline font-medium">
        {f.vehiculo_alias || 'Vehículo'}
      </Link>
      <div className="text-xs text-neutral-500 font-mono">{f.vehiculo_matricula}</div>
      {f.vehiculo_borrado && <span className="text-[11px] text-neutral-400">dado de baja</span>}
    </>
  );
}

export default function Facturas() {
  const { notify } = useNotification();
  const [facturas, setFacturas] = useState([]);
  const [loading, setLoading] = useState(true);
  const [url, cambiar] = useEstadoEnUrl({ apartado: PROVEEDORES, anio: TODOS, proveedor: TODOS, vehiculo: TODOS });
  const apartado = url.apartado === MANTENIMIENTO ? MANTENIMIENTO : PROVEEDORES;   // lo de la URL se valida
  const mantenimiento = apartado === MANTENIMIENTO;
  const { anio, proveedor, vehiculo } = url;
  const [subiendo, setSubiendo] = useState(false);
  const [borrando, setBorrando] = useState(null);
  const [borrandoEnCurso, setBorrandoEnCurso] = useState(false);
  const [descargando, setDescargando] = useState(null);
  const [buzon, setBuzon] = useState(null);
  const [revisando, setRevisando] = useState(false);

  const cargar = useCallback(async () => {
    setLoading(true);
    try {
      setFacturas(await facturasService.list());
    } catch {
      notify.error('No se pudieron cargar las facturas');
    } finally {
      setLoading(false);
    }
  }, [notify]);

  useEffect(() => { cargar(); }, [cargar]);

  // El estado del buzón es un extra: si falla, la pantalla funciona igual.
  useEffect(() => { facturasService.estadoBuzon().then(setBuzon).catch(() => {}); }, []);

  const revisarBuzon = async () => {
    setRevisando(true);
    try {
      const estado = await facturasService.revisarBuzon();
      setBuzon(estado);
      if (estado.ultima?.ok) {
        const n = estado.ultima.importadas;
        notify.success(n ? `${n} ${n === 1 ? 'factura nueva' : 'facturas nuevas'} del buzón` : 'No hay facturas nuevas en el buzón');
        if (n) cargar();
      } else {
        notify.error(estado.ultima?.error || 'No se pudo revisar el buzón');
      }
    } catch (err) {
      notify.error(err.message);
    } finally {
      setRevisando(false);
    }
  };

  // Las del apartado abierto: con vehículo son de mantenimiento.
  const delApartado = useMemo(
    () => facturas.filter(f => Boolean(f.vehicle_id) === mantenimiento),
    [facturas, mantenimiento]
  );
  const anios = useMemo(
    () => [...new Set(delApartado.map(f => f.fecha_emision?.slice(0, 4)).filter(Boolean))].sort().reverse(),
    [delApartado]
  );
  const proveedores = useMemo(
    () => [...new Set(delApartado.map(f => f.proveedor))].sort((a, b) => a.localeCompare(b, 'es')),
    [delApartado]
  );
  const vehiculos = useMemo(() => {
    const porId = new Map();
    for (const f of delApartado) if (f.vehicle_id) porId.set(String(f.vehicle_id), f.vehiculo_alias || f.vehiculo_matricula);
    return [...porId].sort((a, b) => String(a[1]).localeCompare(String(b[1]), 'es'));
  }, [delApartado]);
  const visibles = useMemo(
    () => delApartado.filter(f => (!anio || f.fecha_emision?.startsWith(anio))
      && (!proveedor || f.proveedor === proveedor)
      && (!vehiculo || String(f.vehicle_id) === vehiculo)),
    [delApartado, anio, proveedor, vehiculo]
  );
  const total = visibles.reduce((s, f) => s + (f.importe || 0), 0);
  const sinImporte = visibles.filter(f => f.importe === null).length;

  const descargar = async (f) => {
    setDescargando(f.id);
    try {
      await facturasService.descargar(f, nombreDescarga(f));
    } catch (err) {
      notify.error(err.message);
    } finally {
      setDescargando(null);
    }
  };

  const eliminar = async () => {
    if (!borrando) return;
    setBorrandoEnCurso(true);
    try {
      await facturasService.eliminar(borrando.id);
      setFacturas(fs => fs.filter(f => f.id !== borrando.id));
      notify.success('Factura eliminada');
      setBorrando(null);
    } catch (err) {
      notify.error(err.response?.data?.message || 'No se pudo eliminar la factura');
    } finally {
      setBorrandoEnCurso(false);
    }
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex flex-col sm:flex-row sm:items-end gap-3">
        <div className="flex-1 min-w-0">
          <h1 className="text-[19px] font-semibold text-neutral-900">Facturas</h1>
          <p className="text-neutral-500 text-sm">
            {mantenimiento ? 'Facturas del mantenimiento de las ambulancias' : 'Facturas de proveedores para descargar'}
          </p>
        </div>
        {!mantenimiento && (
          <button className="btn-primary self-start sm:self-auto" onClick={() => setSubiendo(true)}>
            Subir factura
          </button>
        )}
      </div>

      <div className="tabs">
        {APARTADOS.map(a => (
          <button
            key={a.key}
            onClick={() => cambiar({ apartado: a.key, anio: TODOS, proveedor: TODOS, vehiculo: TODOS })}
            aria-pressed={apartado === a.key}
            className={apartado === a.key ? 'tab-active' : 'tab'}
          >
            {a.label}
          </button>
        ))}
      </div>

      {!mantenimiento && <EstadoBuzon estado={buzon} revisando={revisando} onRevisar={revisarBuzon} />}

      {loading ? <PageLoading /> : delApartado.length === 0 ? (
        <div className="empty">
          <p className="empty-title">{mantenimiento ? 'Todavía no hay facturas de mantenimiento' : 'Todavía no hay facturas'}</p>
          <p className="empty-hint">
            {mantenimiento ? 'Se suben desde la ficha de cada vehículo, en la pestaña «Revisiones»'
              : buzon?.configurado ? 'Llegarán solas desde el buzón, o súbelas con «Subir factura»' : 'Sube la primera con «Subir factura»'}
          </p>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <label className="flex items-center gap-2 text-neutral-600">
              Año
              <select className="input py-1.5 text-sm w-auto" value={anio} onChange={e => cambiar({ anio: e.target.value })}>
                <option value={TODOS}>Todos</option>
                {anios.map(a => <option key={a} value={a}>{a}</option>)}
              </select>
            </label>
            {mantenimiento && vehiculos.length > 1 && (
              <label className="flex items-center gap-2 text-neutral-600">
                Vehículo
                <select className="input py-1.5 text-sm w-auto" value={vehiculo} onChange={e => cambiar({ vehiculo: e.target.value })}>
                  <option value={TODOS}>Todos</option>
                  {vehiculos.map(([id, nombre]) => <option key={id} value={id}>{nombre}</option>)}
                </select>
              </label>
            )}
            {proveedores.length > 1 && (
              <label className="flex items-center gap-2 text-neutral-600">
                Proveedor
                <select className="input py-1.5 text-sm w-auto" value={proveedor} onChange={e => cambiar({ proveedor: e.target.value })}>
                  <option value={TODOS}>Todos</option>
                  {proveedores.map(p => <option key={p} value={p}>{p}</option>)}
                </select>
              </label>
            )}
            <span className="text-neutral-500 sm:ml-auto">
              {visibles.length} {visibles.length === 1 ? 'factura' : 'facturas'} ·{' '}
              <span className="font-mono text-neutral-900">{fmtEuros(total)}</span>
              {sinImporte > 0 && <span className="text-neutral-400"> ({sinImporte} sin importe)</span>}
            </span>
          </div>

          {visibles.length === 0 ? (
            <div className="card text-sm text-neutral-500">No hay facturas con estos filtros</div>
          ) : (
            <div className="card p-0 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-neutral-50 text-neutral-600 text-xs uppercase">
                    <tr>
                      <th className="px-3 py-2.5 text-left whitespace-nowrap">Fecha</th>
                      {mantenimiento && <th className="px-3 py-2.5 text-left whitespace-nowrap">Vehículo</th>}
                      <th className="px-3 py-2.5 text-left whitespace-nowrap">Proveedor</th>
                      <th className="px-3 py-2.5 text-left whitespace-nowrap">Nº factura</th>
                      <th className="px-3 py-2.5 text-right whitespace-nowrap">Importe</th>
                      <th className="px-3 py-2.5"><span className="sr-only">Acciones</span></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-neutral-100">
                    {visibles.map(f => (
                      <tr key={f.id}>
                        <td className="px-3 py-2.5 font-mono whitespace-nowrap">{formatFechaSola(f.fecha_emision)}</td>
                        {mantenimiento && <td className="px-3 py-2.5"><CeldaVehiculo f={f} /></td>}
                        <td className="px-3 py-2.5">
                          <div className="text-neutral-900">{f.proveedor}</div>
                          {mantenimiento && f.revision_id && (
                            <div className="text-xs text-neutral-500">
                              {TIPO_REVISION_LABELS[f.revision_tipo] || f.revision_tipo} del {formatFechaSola(f.revision_fecha)}
                            </div>
                          )}
                          {f.notas && <div className="text-xs text-neutral-500">{f.notas}</div>}
                          {f.origen === 'correo' && <span className="text-[11px] text-neutral-400">llegó por correo</span>}
                        </td>
                        <td className="px-3 py-2.5 font-mono whitespace-nowrap">{f.numero}</td>
                        <td className="px-3 py-2.5 text-right font-mono whitespace-nowrap">{fmtEuros(f.importe)}</td>
                        <td className="px-3 py-2.5 text-right whitespace-nowrap">
                          <button
                            className="text-primary-700 hover:underline font-medium disabled:opacity-50"
                            onClick={() => descargar(f)}
                            disabled={descargando === f.id}
                            title={`${f.nombre_fichero} · ${fmtTamano(f.tamano)}`}
                          >
                            {descargando === f.id ? 'Descargando…' : 'Descargar'}
                          </button>
                          <button
                            className="ml-3 text-neutral-400 hover:text-bad-600"
                            onClick={() => setBorrando(f)}
                            aria-label={`Eliminar la factura ${f.numero}`}
                          >
                            Eliminar
                          </button>
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

      <SubirFactura
        isOpen={subiendo}
        onClose={() => setSubiendo(false)}
        proveedores={proveedores}
        facturas={facturas}
        onSubida={(f) => {
          setSubiendo(false);
          if (f) setFacturas(fs => [f, ...fs].sort((a, b) => (b.fecha_emision || '').localeCompare(a.fecha_emision || '') || b.id - a.id));
          else cargar();
        }}
      />

      <ConfirmDialog
        isOpen={Boolean(borrando)}
        onClose={() => !borrandoEnCurso && setBorrando(null)}
        onConfirm={eliminar}
        loading={borrandoEnCurso}
        danger
        title="Eliminar factura"
        message={borrando ? `Se borrará la factura ${borrando.numero} de ${borrando.proveedor} (${formatFechaSola(borrando.fecha_emision)}) con su PDF. Queda anotado en la auditoría.` : ''}
        confirmText="Eliminar"
      />
    </div>
  );
}
