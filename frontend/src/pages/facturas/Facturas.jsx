/**
 * pages/facturas/Facturas.jsx
 *
 * Facturas de proveedores (Google Ads y los que vengan) para descargar. Solo
 * admin y superadmin: lo decide el backend por rol (routes/facturas.routes.js);
 * el flag `menu_facturas` solo pone la pantalla en el menú.
 *
 * Se suben a mano o llegan solas desde el buzón de facturas@ (lo lee el
 * backend, services/buzonFacturas.service.js). Las del buzón llevan
 * `origen: 'correo'` y se marcan con una etiqueta; arriba va el estado de la
 * última revisión y un botón para revisarlo ya.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { facturasService } from '../../services/facturas.service.js';
import { useNotification } from '../../context/NotificationContext.jsx';
import { PageLoading }     from '../../components/common/LoadingSpinner.jsx';
import Modal               from '../../components/common/Modal.jsx';
import ConfirmDialog       from '../../components/common/ConfirmDialog.jsx';
import { formatFechaSola } from '../../utils/dateUtils.js';

const PROVEEDOR_POR_DEFECTO = 'Google Ads';
const MAX_MB = 10;
const TODOS = '';
const IMPORTE = /^\d+([.,]\d{1,2})?$|^\d{1,3}(\.\d{3})+(,\d{1,2})?$/;

const euros = new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' });
const fmtEuros = (n) => (n === null || n === undefined ? '—' : euros.format(n));

/** Hoy en hora española, 'YYYY-MM-DD' (tope del selector de fecha). */
function hoyEnEspana() {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(new Date());
  const get = (t) => p.find(x => x.type === t).value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

function fmtTamano(bytes) {
  if (!bytes && bytes !== 0) return '';
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** El mismo nombre que pone el backend, para que la descarga se llame igual. */
function nombreDescarga(f) {
  const limpio = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^_+|_+$/g, '');
  return `Factura_${limpio(f.proveedor) || 'proveedor'}_${limpio(f.numero) || f.id}.pdf`;
}

function formularioVacio(proveedor) {
  return { proveedor: proveedor || PROVEEDOR_POR_DEFECTO, numero: '', fecha_emision: '', importe: '', notas: '', fichero: null };
}

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

function SubirFactura({ isOpen, onClose, onSubida, proveedores }) {
  const { notify } = useNotification();
  const [form, setForm] = useState(formularioVacio());
  const [errores, setErrores] = useState({});
  const [enviando, setEnviando] = useState(false);
  const hoy = hoyEnEspana();

  useEffect(() => {
    if (isOpen) { setForm(formularioVacio()); setErrores({}); }
  }, [isOpen]);

  const set = (campo) => (e) => setForm(f => ({ ...f, [campo]: e.target.value }));

  const elegirFichero = (e) => {
    const fichero = e.target.files?.[0] || null;
    setForm(f => ({ ...f, fichero }));
    setErrores(er => ({ ...er, fichero: undefined }));
  };

  const validar = () => {
    const er = {};
    if (!form.proveedor.trim()) er.proveedor = 'Indica el proveedor';
    if (!form.numero.trim()) er.numero = 'Indica el número de factura';
    if (!form.fecha_emision) er.fecha_emision = 'Indica la fecha de emisión';
    else if (form.fecha_emision > hoy) er.fecha_emision = 'No puede ser una fecha futura';
    // Lo mismo que acepta el backend: «65,23», «65.23», «1.234,56»
    if (form.importe.trim() && !IMPORTE.test(form.importe.replace(/\s|€/g, ''))) {
      er.importe = 'Importe no válido (ej. 65,23)';
    }
    if (!form.fichero) er.fichero = 'Elige el PDF de la factura';
    else if (form.fichero.type && form.fichero.type !== 'application/pdf') er.fichero = 'Tiene que ser un PDF';
    else if (form.fichero.size > MAX_MB * 1024 * 1024) er.fichero = `El PDF no puede pasar de ${MAX_MB} MB`;
    setErrores(er);
    return Object.keys(er).length === 0;
  };

  const enviar = async (e) => {
    e.preventDefault();
    if (enviando || !validar()) return;
    setEnviando(true);
    try {
      const factura = await facturasService.subir({
        proveedor: form.proveedor.trim(),
        numero: form.numero.trim(),
        fecha_emision: form.fecha_emision,
        importe: form.importe.trim(),
        notas: form.notas.trim(),
        fichero: form.fichero,
      });
      notify.success('Factura guardada');
      onSubida(factura);
    } catch (err) {
      notify.error(err.message);
    } finally {
      setEnviando(false);
    }
  };

  const Aviso = ({ campo }) => (errores[campo] ? <p className="text-xs text-bad-600 mt-1">{errores[campo]}</p> : null);

  return (
    <Modal
      isOpen={isOpen}
      onClose={enviando ? () => {} : onClose}
      title="Subir factura"
      footer={
        <>
          <button type="button" className="btn-secondary w-full sm:w-auto" onClick={onClose} disabled={enviando}>Cancelar</button>
          <button type="submit" form="form-factura" className="btn-primary w-full sm:w-auto" disabled={enviando}>
            {enviando ? 'Subiendo…' : 'Guardar factura'}
          </button>
        </>
      }
    >
      <form id="form-factura" onSubmit={enviar} className="space-y-4" noValidate>
        <div>
          <label className="label" htmlFor="factura-fichero">PDF de la factura <span className="text-bad-500">*</span></label>
          <input id="factura-fichero" type="file" accept="application/pdf,.pdf" className="input" onChange={elegirFichero} />
          {form.fichero && !errores.fichero && (
            <p className="text-xs text-neutral-500 mt-1 break-all">{form.fichero.name} · {fmtTamano(form.fichero.size)}</p>
          )}
          <Aviso campo="fichero" />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="label" htmlFor="factura-proveedor">Proveedor <span className="text-bad-500">*</span></label>
            <input id="factura-proveedor" className="input" list="facturas-proveedores" maxLength={100}
              value={form.proveedor} onChange={set('proveedor')} />
            <datalist id="facturas-proveedores">
              {[...new Set([PROVEEDOR_POR_DEFECTO, ...proveedores])].map(p => <option key={p} value={p} />)}
            </datalist>
            <Aviso campo="proveedor" />
          </div>
          <div>
            <label className="label" htmlFor="factura-numero">Nº de factura <span className="text-bad-500">*</span></label>
            <input id="factura-numero" className="input font-mono" maxLength={64}
              value={form.numero} onChange={set('numero')} />
            <Aviso campo="numero" />
          </div>
          <div>
            <label className="label" htmlFor="factura-fecha">Fecha de emisión <span className="text-bad-500">*</span></label>
            <input id="factura-fecha" type="date" className="input" max={hoy}
              value={form.fecha_emision} onChange={set('fecha_emision')} />
            <Aviso campo="fecha_emision" />
          </div>
          <div>
            <label className="label" htmlFor="factura-importe">Importe (€, IVA incl.)</label>
            <input id="factura-importe" className="input font-mono" inputMode="decimal" placeholder="65,23"
              value={form.importe} onChange={set('importe')} />
            <Aviso campo="importe" />
          </div>
        </div>
        <div>
          <label className="label" htmlFor="factura-notas">Notas</label>
          <input id="factura-notas" className="input" maxLength={255}
            value={form.notas} onChange={set('notas')} />
        </div>
      </form>
    </Modal>
  );
}

export default function Facturas() {
  const { notify } = useNotification();
  const [facturas, setFacturas] = useState([]);
  const [loading, setLoading] = useState(true);
  const [anio, setAnio] = useState(TODOS);
  const [proveedor, setProveedor] = useState(TODOS);
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

  const anios = useMemo(
    () => [...new Set(facturas.map(f => f.fecha_emision?.slice(0, 4)).filter(Boolean))].sort().reverse(),
    [facturas]
  );
  const proveedores = useMemo(
    () => [...new Set(facturas.map(f => f.proveedor))].sort((a, b) => a.localeCompare(b, 'es')),
    [facturas]
  );
  const visibles = useMemo(
    () => facturas.filter(f => (!anio || f.fecha_emision?.startsWith(anio)) && (!proveedor || f.proveedor === proveedor)),
    [facturas, anio, proveedor]
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
          <p className="text-neutral-500 text-sm">Facturas de proveedores para descargar</p>
        </div>
        <button className="btn-primary self-start sm:self-auto" onClick={() => setSubiendo(true)}>
          Subir factura
        </button>
      </div>

      <EstadoBuzon estado={buzon} revisando={revisando} onRevisar={revisarBuzon} />

      {loading ? <PageLoading /> : facturas.length === 0 ? (
        <div className="empty">
          <p className="empty-title">Todavía no hay facturas</p>
          <p className="empty-hint">
            {buzon?.configurado ? 'Llegarán solas desde el buzón, o súbelas con «Subir factura»' : 'Sube la primera con «Subir factura»'}
          </p>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <label className="flex items-center gap-2 text-neutral-600">
              Año
              <select className="input py-1.5 text-sm w-auto" value={anio} onChange={e => setAnio(e.target.value)}>
                <option value={TODOS}>Todos</option>
                {anios.map(a => <option key={a} value={a}>{a}</option>)}
              </select>
            </label>
            {proveedores.length > 1 && (
              <label className="flex items-center gap-2 text-neutral-600">
                Proveedor
                <select className="input py-1.5 text-sm w-auto" value={proveedor} onChange={e => setProveedor(e.target.value)}>
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
                        <td className="px-3 py-2.5">
                          <div className="text-neutral-900">{f.proveedor}</div>
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
