/**
 * components/facturas/SubirFactura.jsx
 *
 * El popup de subida de una factura, en dos pasos:
 *   1. Elegir el PDF. El backend lo lee (POST /facturas/leer) y devuelve
 *      proveedor, número, fecha e importe, sin guardar nada.
 *   2. El formulario sale relleno con eso. Lo que no se ha encontrado va
 *      marcado en ámbar para rellenarlo a mano; lo encontrado, para
 *      comprobarlo. Al guardar, el PDF vuelve a subir con los datos (POST /facturas).
 * Si la lectura falla (red, PDF raro) se pasa igual al paso 2, vacío: leer es
 * una ayuda, no un requisito para poder subir la factura.
 *
 * Lo usan la pantalla de Facturas (de proveedor) y la ficha del vehículo
 * (de mantenimiento: con `vehiculo`, la factura va a ese vehículo y, si se
 * elige, a una de sus `revisiones`). Desde la ficha se carga con `lazy()`,
 * como la pantalla: solo descarga este código quien sube una factura.
 */

import React, { useEffect, useState } from 'react';
import { facturasService } from '../../services/facturas.service.js';
import { useNotification } from '../../context/NotificationContext.jsx';
import Modal               from '../common/Modal.jsx';
import { formatFechaSola } from '../../utils/dateUtils.js';
import { fmtTamano, TIPO_REVISION_LABELS } from '../../utils/facturas.js';

export const PROVEEDOR_POR_DEFECTO = 'Google Ads';
const MAX_MB = 10;
const IMPORTE = /^\d+([.,]\d{1,2})?$|^\d{1,3}(\.\d{3})+(,\d{1,2})?$/;
const SIN_REVISION = '';

/** Hoy en hora española, 'YYYY-MM-DD' (tope del selector de fecha). */
function hoyEnEspana() {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(new Date());
  const get = (t) => p.find(x => x.type === t).value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

function formularioVacio(proveedor, revision = SIN_REVISION) {
  return { proveedor: proveedor || PROVEEDOR_POR_DEFECTO, numero: '', fecha_emision: '', importe: '', notas: '', fichero: null,
           revision_id: revision };
}

const CAMPOS_LEIDOS = ['proveedor', 'numero', 'fecha_emision', 'importe'];

/** 65.23 → «65,23», 1210 → «1210,00», como lo escribiría el admin. */
const importeATexto = (n) => (n === null || n === undefined ? '' : Number(n).toFixed(2).replace('.', ','));

/** «Mantenimiento · 12/09/2026 · Taller Pepe», para el selector de revisión. */
export function textoRevision(r) {
  return [TIPO_REVISION_LABELS[r.tipo] || r.tipo, formatFechaSola(r.fecha_revision?.slice(0, 10)), r.realizado_por]
    .filter(Boolean).join(' · ');
}

export default function SubirFactura({
  isOpen, onClose, onSubida, proveedores, facturas,
  vehiculo = null, revisiones = [], revisionInicial = null,
}) {
  const { notify } = useNotification();
  const revisionDeInicio = revisionInicial ? String(revisionInicial.id) : SIN_REVISION;
  const [paso, setPaso] = useState(1);
  const [form, setForm] = useState(formularioVacio(null, revisionDeInicio));
  const [errores, setErrores] = useState({});
  const [leyendo, setLeyendo] = useState(false);
  const [lectura, setLectura] = useState(null);   // { con_texto, encontrados: Set, fallo? }
  const [enviando, setEnviando] = useState(false);
  const hoy = hoyEnEspana();

  useEffect(() => {
    if (isOpen) { setPaso(1); setForm(formularioVacio(null, revisionDeInicio)); setErrores({}); setLectura(null); }
  }, [isOpen, revisionDeInicio]);

  const set = (campo) => (e) => setForm(f => ({ ...f, [campo]: e.target.value }));

  const elegirFichero = (e) => {
    const fichero = e.target.files?.[0] || null;
    setForm(f => ({ ...f, fichero }));
    setErrores(er => ({ ...er, fichero: undefined }));
    setLectura(null);   // otro PDF: hay que volver a leerlo
  };

  const validarFichero = () => {
    let error;
    if (!form.fichero) error = 'Elige el PDF de la factura';
    else if (form.fichero.type && form.fichero.type !== 'application/pdf') error = 'Tiene que ser un PDF';
    else if (form.fichero.size > MAX_MB * 1024 * 1024) error = `El PDF no puede pasar de ${MAX_MB} MB`;
    setErrores(er => ({ ...er, fichero: error }));
    return !error;
  };

  const leer = async (e) => {
    e.preventDefault();
    if (leyendo || !validarFichero()) return;
    // Atrás y Siguiente con el mismo PDF: no se relee, que pisaría lo ya corregido a mano
    if (lectura) { setPaso(2); return; }
    setLeyendo(true);
    try {
      const { con_texto, datos } = await facturasService.leer(form.fichero);
      const encontrados = new Set(CAMPOS_LEIDOS.filter(c => datos[c] !== null && datos[c] !== undefined && datos[c] !== ''));
      setForm(f => ({
        ...f,
        proveedor:     datos.proveedor || '',
        numero:        datos.numero || '',
        fecha_emision: datos.fecha_emision || '',
        importe:       importeATexto(datos.importe),
      }));
      setLectura({ con_texto, encontrados });
    } catch (err) {
      // Un rechazo del backend (no es un PDF de verdad, pesa demasiado, sin
      // permiso) se queda en el paso 1: el paso 2 tampoco lo guardaría. Solo un
      // fallo de red, de tiempo o del servidor pasa al paso 2 para rellenar a mano.
      if (err.status >= 400 && err.status < 500 && err.status !== 408 && err.status !== 429) {
        setErrores(er => ({ ...er, fichero: err.message }));
        setLeyendo(false);
        return;
      }
      setForm(f => ({ ...formularioVacio(), proveedor: '', fichero: f.fichero, revision_id: f.revision_id }));
      setLectura({ con_texto: false, encontrados: new Set(), fallo: err.message });
    }
    setLeyendo(false);
    setErrores({});
    setPaso(2);
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
        ...(vehiculo && { vehicle_id: vehiculo.id, revision_id: form.revision_id }),
      });
      notify.success('Factura guardada');
      onSubida(factura);
    } catch (err) {
      notify.error(err.message);
    } finally {
      setEnviando(false);
    }
  };

  // La misma (proveedor, número) ya guardada: el backend la rechazaría con un 409; mejor verlo antes.
  const repetida = paso === 2 && form.proveedor.trim() && form.numero.trim()
    && facturas.find(f => f.proveedor.toLowerCase() === form.proveedor.trim().toLowerCase()
      && f.numero.toLowerCase() === form.numero.trim().toLowerCase());   // el UNIQUE de MySQL no distingue mayúsculas

  const Aviso = ({ campo }) => (errores[campo] ? <p className="text-xs text-bad-600 mt-1">{errores[campo]}</p> : null);

  /** Bajo cada campo del paso 2: si se ha leído del PDF o hay que escribirlo. */
  const Origen = ({ campo, opcional }) => {
    if (errores[campo] || !lectura) return null;
    if (lectura.encontrados.has(campo)) return <p className="text-xs text-neutral-500 mt-1">Leído del PDF, compruébalo</p>;
    return <p className="text-xs text-warn-700 mt-1">No está en el PDF{opcional ? ', escríbelo si lo sabes' : ', rellénalo a mano'}</p>;
  };

  /** Ámbar en lo que falta y sigue vacío, para ver de un vistazo qué queda por rellenar. */
  const claseFalta = (campo) => (lectura && !lectura.encontrados.has(campo) && !form[campo] ? ' border-warn-500 bg-warn-50' : '');

  const pie = paso === 1 ? (
    <>
      <button type="button" className="btn-secondary w-full sm:w-auto" onClick={onClose} disabled={leyendo}>Cancelar</button>
      <button type="submit" form="form-factura-pdf" className="btn-primary w-full sm:w-auto" disabled={leyendo || !form.fichero}>
        {leyendo ? 'Leyendo la factura…' : 'Siguiente'}
      </button>
    </>
  ) : (
    <>
      <button type="button" className="btn-secondary w-full sm:w-auto" onClick={() => { setPaso(1); setErrores({}); }} disabled={enviando}>Atrás</button>
      <button type="submit" form="form-factura" className="btn-primary w-full sm:w-auto" disabled={enviando}>
        {enviando ? 'Subiendo…' : 'Guardar factura'}
      </button>
    </>
  );

  // De qué vehículo es, arriba en los dos pasos: el popup tapa la ficha.
  const deVehiculo = vehiculo && (
    <p className="text-sm text-neutral-700">
      Factura de mantenimiento de <strong>{vehiculo.alias}</strong>{' '}
      <span className="font-mono text-neutral-500">{vehiculo.matricula}</span>
    </p>
  );

  return (
    <Modal
      isOpen={isOpen}
      onClose={enviando || leyendo ? () => {} : onClose}
      title={paso === 1 ? 'Subir factura · 1 de 2' : 'Revisar los datos · 2 de 2'}
      footer={pie}
    >
      {paso === 1 ? (
        <form id="form-factura-pdf" onSubmit={leer} className="space-y-3" noValidate>
          {deVehiculo}
          <p className="text-sm text-neutral-600">
            Elige el PDF. Se leen el proveedor, el número, la fecha y el importe, y en el paso siguiente
            revisas los datos y completas lo que falte.
          </p>
          <div>
            <label className="label" htmlFor="factura-fichero">PDF de la factura <span className="text-bad-500">*</span></label>
            <input id="factura-fichero" type="file" accept="application/pdf,.pdf" className="input" onChange={elegirFichero} disabled={leyendo} />
            {form.fichero && !errores.fichero && (
              <p className="text-xs text-neutral-500 mt-1 break-all">{form.fichero.name} · {fmtTamano(form.fichero.size)}</p>
            )}
            <Aviso campo="fichero" />
          </div>
        </form>
      ) : (
        <form id="form-factura" onSubmit={enviar} className="space-y-4" noValidate>
          {deVehiculo}
          <p className="text-xs text-neutral-500 break-all">
            <span className="font-mono">{form.fichero?.name}</span> · {fmtTamano(form.fichero?.size)}
          </p>
          {lectura?.fallo && (
            <div className="rounded-lg border border-warn-200 bg-warn-50 p-3 text-sm text-warn-700">
              No se ha podido leer la factura ({lectura.fallo}). Rellena los datos a mano.
            </div>
          )}
          {lectura && !lectura.fallo && !lectura.con_texto && (
            <div className="rounded-lg border border-warn-200 bg-warn-50 p-3 text-sm text-warn-700">
              Este PDF no tiene texto que leer (parece escaneado). Rellena los datos a mano.
            </div>
          )}
          {lectura?.con_texto && (
            <p className="text-sm text-neutral-600">
              {lectura.encontrados.size === CAMPOS_LEIDOS.length
                ? 'Se han leído todos los datos del PDF. Compruébalos antes de guardar.'
                : 'Lo que no se ha encontrado en el PDF está marcado en ámbar: rellénalo a mano.'}
            </p>
          )}
          {repetida && (
            <div className="rounded-lg border border-bad-200 bg-bad-50 p-3 text-sm text-bad-700">
              Ya hay una factura {repetida.numero} de {repetida.proveedor} ({formatFechaSola(repetida.fecha_emision)}). No se puede guardar dos veces.
            </div>
          )}
          {vehiculo && (
            <div>
              <label className="label" htmlFor="factura-revision">Revisión que factura</label>
              <select id="factura-revision" className="input" value={form.revision_id} onChange={set('revision_id')}>
                <option value={SIN_REVISION}>Ninguna en concreto</option>
                {revisiones.map(r => <option key={r.id} value={String(r.id)}>{textoRevision(r)}</option>)}
              </select>
            </div>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="label" htmlFor="factura-proveedor">Proveedor <span className="text-bad-500">*</span></label>
              <input id="factura-proveedor" className={`input${claseFalta('proveedor')}`} list="facturas-proveedores" maxLength={100}
                value={form.proveedor} onChange={set('proveedor')} />
              <datalist id="facturas-proveedores">
                {[...new Set([...(vehiculo ? [] : [PROVEEDOR_POR_DEFECTO]), ...proveedores])].map(p => <option key={p} value={p} />)}
              </datalist>
              <Aviso campo="proveedor" />
              <Origen campo="proveedor" />
            </div>
            <div>
              <label className="label" htmlFor="factura-numero">Nº de factura <span className="text-bad-500">*</span></label>
              <input id="factura-numero" className={`input font-mono${claseFalta('numero')}`} maxLength={64}
                value={form.numero} onChange={set('numero')} />
              <Aviso campo="numero" />
              <Origen campo="numero" />
            </div>
            <div>
              <label className="label" htmlFor="factura-fecha">Fecha de emisión <span className="text-bad-500">*</span></label>
              <input id="factura-fecha" type="date" className={`input${claseFalta('fecha_emision')}`} max={hoy}
                value={form.fecha_emision} onChange={set('fecha_emision')} />
              <Aviso campo="fecha_emision" />
              <Origen campo="fecha_emision" />
            </div>
            <div>
              <label className="label" htmlFor="factura-importe">Importe (€, IVA incl.)</label>
              <input id="factura-importe" className={`input font-mono${claseFalta('importe')}`} inputMode="decimal" placeholder="65,23"
                value={form.importe} onChange={set('importe')} />
              <Aviso campo="importe" />
              <Origen campo="importe" opcional />
            </div>
          </div>
          <div>
            <label className="label" htmlFor="factura-notas">Notas</label>
            <input id="factura-notas" className="input" maxLength={255}
              value={form.notas} onChange={set('notas')} />
          </div>
        </form>
      )}
    </Modal>
  );
}
