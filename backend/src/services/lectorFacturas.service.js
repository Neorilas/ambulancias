/**
 * services/lectorFacturas.service.js
 * Lee el texto de un PDF de factura y saca proveedor, número, fecha de
 * emisión e importe, para rellenar el formulario de subida (paso 1 de 2;
 * el paso 2 es el admin revisando y completando a mano). docs/MAPA_CODIGO.md §2.8.
 *
 * Todo en el servidor, sin mandar la factura a ningún servicio de fuera.
 * Solo funciona con PDF que llevan texto (los que genera un programa, como
 * los de Google). Uno escaneado no tiene texto: se devuelve `con_texto:
 * false` y todo vacío, y se rellena a mano.
 *
 * Es heurístico a propósito: lo que no encuentra con seguridad lo deja en
 * null en vez de adivinar, porque un campo vacío salta a la vista en el
 * formulario y uno mal rellenado no.
 *
 * Nunca lanza.
 */

'use strict';

const { importeValido, fechaValida } = require('../controllers/facturas.controller');
const { ahora, fechaEnEspana } = require('../utils/fecha.utils');
const logger = require('../utils/logger.utils');

const MAX_PAGINAS = 5;        // los datos están siempre en la primera; 5 por si hay portada
const TIMEOUT_MS  = 15000;    // un PDF retorcido no deja la petición colgada
const MAX = { proveedor: 100, numero: 64 };

// Proveedores que en el PDF no se llaman como se guardan. Google factura como
// «Google Ireland Limited», pero aquí es «Google Ads» (el mismo nombre que pone
// el buzón, para que el UNIQUE (proveedor, numero) case).
const ALIAS = [[/\bgoogle\b/i, 'Google Ads']];

// ── Del PDF al texto ─────────────────────────────────────────────────────────

/**
 * El texto de las primeras páginas, con un salto de línea donde el PDF cambia
 * de renglón (las etiquetas «Total:» y su cifra suelen ir en el mismo).
 * '' si no tiene texto, está cifrado o no se puede abrir.
 */
async function textoDePdf(buffer) {
  let pdf;
  let reloj;
  try {
    const { getDocumentProxy } = require('unpdf');
    const leer = (async () => {
      // isEvalSupported: false (lo pone unpdf, se repite por si cambia): el
      // CVE-2024-4367 de pdf.js ejecutaba JavaScript desde una fuente del PDF.
      pdf = await getDocumentProxy(new Uint8Array(buffer), { isEvalSupported: false });
      const lineas = [];
      for (let n = 1; n <= Math.min(pdf.numPages, MAX_PAGINAS); n++) {
        const pagina = await pdf.getPage(n);
        const { items } = await pagina.getTextContent();
        let linea = '';
        let y = null;
        for (const it of items) {
          if (typeof it.str !== 'string') continue;
          const yItem = it.transform?.[5];
          if (y !== null && yItem !== undefined && Math.abs(yItem - y) > 2 && linea.trim()) {
            lineas.push(linea);
            linea = '';
          }
          linea += (linea && !linea.endsWith(' ') && !it.str.startsWith(' ') ? ' ' : '') + it.str;
          if (yItem !== undefined) y = yItem;
          if (it.hasEOL) { lineas.push(linea); linea = ''; y = null; }
        }
        if (linea.trim()) lineas.push(linea);
      }
      return lineas.map(l => l.replace(/\s+/g, ' ').trim()).filter(Boolean).join('\n');
    })();
    const tope = new Promise((_, rechazar) => {
      reloj = setTimeout(() => rechazar(new Error('tiempo agotado leyendo el PDF')), TIMEOUT_MS);
    });
    return await Promise.race([leer, tope]);
  } catch (err) {
    logger.warn(`Lector de facturas: no se pudo leer el PDF (${err.message})`);
    return '';
  } finally {
    clearTimeout(reloj);
    try { await pdf?.destroy(); } catch { /* ya cerrado */ }
  }
}

// ── Del texto a los datos ────────────────────────────────────────────────────

const sinTildes = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

const MESES = {
  ene: 1, enero: 1, jan: 1, january: 1,
  feb: 2, febrero: 2, february: 2,
  mar: 3, marzo: 3, march: 3,
  abr: 4, abril: 4, apr: 4, april: 4,
  may: 5, mayo: 5,
  jun: 6, junio: 6, june: 6,
  jul: 7, julio: 7, july: 7,
  ago: 8, agosto: 8, aug: 8, august: 8,
  sep: 9, sept: 9, septiembre: 9, setiembre: 9, september: 9,
  oct: 10, octubre: 10, october: 10,
  nov: 11, noviembre: 11, november: 11,
  dic: 12, diciembre: 12, dec: 12, december: 12,
};
const MES = '([a-z]{3,10})\\.?';
const PATRONES_FECHA = [
  // 30/09/2026, 30-09-2026, 30.09.26 (día primero: son facturas españolas)
  { re: /\b(\d{1,2})[/.-](\d{1,2})[/.-](\d{4}|\d{2})\b/, partes: (m) => [m[3], m[2], m[1]] },
  // 2026-09-30
  { re: /\b(\d{4})-(\d{1,2})-(\d{1,2})\b/, partes: (m) => [m[1], m[2], m[3]] },
  // 30 sept 2026, 30 de septiembre de 2026
  { re: new RegExp(`\\b(\\d{1,2})\\s+(?:de\\s+)?${MES}\\s+(?:de\\s+)?(\\d{4})\\b`), partes: (m) => [m[3], MESES[m[2]], m[1]] },
  // Sep 30, 2026
  { re: new RegExp(`\\b${MES}\\s+(\\d{1,2}),?\\s+(\\d{4})\\b`), partes: (m) => [m[3], MESES[m[1]], m[2]] },
];

/** La primera fecha válida y no futura de un trozo de texto, como 'YYYY-MM-DD'. */
function primeraFecha(trozo, hoy) {
  const t = sinTildes(trozo);
  let mejor = null;
  for (const { re, partes } of PATRONES_FECHA) {
    const m = t.match(re);
    if (!m) continue;
    const [a, mes, d] = partes(m);
    if (!mes) continue;
    const anio = String(a).length === 2 ? `20${a}` : String(a);
    const f = fechaValida(`${anio}-${String(mes).padStart(2, '0')}-${String(d).padStart(2, '0')}`);
    if (f && f <= hoy && (!mejor || m.index < mejor.pos)) mejor = { f, pos: m.index };
  }
  return mejor?.f || null;
}

/**
 * Fecha de emisión: la que va detrás de «Fecha de factura / de emisión /
 * de expedición / Invoice date»; si no, la de un «Fecha:» suelto; nunca la de
 * vencimiento. Sin etiqueta no se adivina: la primera fecha del PDF puede ser
 * la del periodo facturado.
 */
function fechaDe(texto, hoy = fechaEnEspana(ahora())) {
  const t = sinTildes(texto);
  const etiquetas = [
    /fecha\s+(?:de\s+)?(?:la\s+)?(?:factura|emision|expedicion)/g,
    /invoice\s+date|date\s+of\s+issue|issue\s+date/g,
    /fecha(?!\s+(?:de\s+)?(?:vencimiento|valor|pago|cargo|inicio|fin))/g,
  ];
  for (const re of etiquetas) {
    for (const m of t.matchAll(re)) {
      const f = primeraFecha(t.slice(m.index + m[0].length, m.index + m[0].length + 40), hoy);
      if (f) return f;
    }
  }
  return null;
}

/** «1.234,56», «65,23», «65.23», «1,234.56» → número; null si no es una cifra con céntimos o miles. */
function cifra(s) {
  let c = String(s).replace(/\s/g, '');
  if (/^\d{1,3}(,\d{3})+\.\d{2}$/.test(c)) c = c.replace(/,/g, '');   // formato inglés
  const v = importeValido(c);
  return v === undefined || Number.isNaN(v) ? null : v;
}

const IMPORTE = /(?:€|eur)?\s*(\d{1,3}(?:[.,]\d{3})+(?:[.,]\d{2})?|\d+[.,]\d{2})\s*(?:€|eur)?/gi;

/**
 * Importe total (IVA incluido): el mayor de los que van en un renglón con
 * «Total» que no sea subtotal, base o impuestos. El total con IVA es siempre
 * el más alto de esos; el último no vale porque a veces debajo va «Total
 * pagado: 0,00».
 */
function importeDe(texto) {
  let mayor = null;
  for (const linea of String(texto).split('\n')) {
    const l = sinTildes(linea);
    const m = l.match(/\b(?:importe\s+)?total\b/);
    if (!m) continue;
    if (/sub\s*-?total|total\s+(?:base|bruto|neto|iva|impuestos?|tax|vat|sin\s+iva|excl)|base\s+imponible|pagado|paid/.test(l)) continue;
    for (const c of l.slice(m.index).matchAll(IMPORTE)) {
      const v = cifra(c[1]);
      if (v !== null && v > 0 && (mayor === null || v > mayor)) mayor = v;
    }
  }
  return mayor;
}

/**
 * Número de factura: lo que va detrás de «Nº de factura», «Número de
 * factura», «Factura nº», «Invoice number»… Si el texto no lo dice,
 * el nombre del fichero si es un número largo (Google los llama por su número).
 */
function numeroDe(texto, nombreFichero) {
  const t = String(texto);
  const etiqueta = /(?:n[úu]mero\s+(?:de\s+)?(?:la\s+)?factura|n\.?\s?[ºo°]\.?\s*(?:de\s+)?factura|factura\s+n\.?\s?[ºo°.]|factura\s+n[úu]m(?:ero|\.)?|num\.?\s+factura|invoice\s+(?:number|no\.?|#)|(?<!fecha\s+(?:de\s+)?(?:la\s+)?)factura\s*:)\s*[:#.]?\s*([A-Z0-9][A-Z0-9/._-]{2,})/gi;
  for (const m of t.matchAll(etiqueta)) {
    const n = m[1].replace(/[._-]+$/, '');
    // Con algún dígito (si no, es una palabra detrás de la etiqueta) y que no sea una fecha
    if (/\d/.test(n) && !/^\d{1,4}[/.-]\d{1,2}[/.-]\d{1,4}$/.test(n)) return n.slice(0, MAX.numero);
  }
  const base = String(nombreFichero || '').replace(/\.pdf$/i, '');
  const largo = base.match(/\d{6,}/);
  return largo ? largo[0].slice(0, MAX.numero) : null;
}

const SOCIEDAD = /\b(?:s\.?\s?l\.?\s?u?|s\.?\s?a\.?\s?u?|s\.?\s?coop|s\.?\s?l\.?\s?l|limited|ltd|inc|gmbh|llc|b\.?\s?v|sarl|s\.?\s?r\.?\s?l)\.?(?=\s|,|$)/i;

/**
 * Proveedor, por este orden: uno de los que ya hay guardados que salga en el
 * texto (así se escribe igual y el UNIQUE no se salta por una tilde); un alias
 * conocido (Google → «Google Ads»); el que diga «Proveedor:/Emisor:»; el primer
 * renglón con forma de sociedad (S.L., S.A., Ltd…) que no sea la propia empresa.
 */
function proveedorDe(texto, conocidos = [], propia = (process.env.FACTURAS_EMPRESA_PROPIA || 'vapss')) {
  const t = sinTildes(texto);
  const enTexto = conocidos
    .filter(p => p && sinTildes(p).trim().length >= 3 && t.includes(sinTildes(p).trim()))
    .sort((a, b) => b.length - a.length);
  if (enTexto.length) return enTexto[0];

  for (const [re, nombre] of ALIAS) if (re.test(texto)) return nombre;

  const esPropia = (l) => propia && sinTildes(l).includes(sinTildes(propia));
  const etiquetado = String(texto).match(/(?:proveedor|emisor|raz[óo]n\s+social|vendedor|seller)\s*:\s*([^\n]{3,})/i);
  if (etiquetado && !esPropia(etiquetado[1])) return etiquetado[1].trim().slice(0, MAX.proveedor);

  for (const linea of String(texto).split('\n')) {
    if (linea.length > 120 || esPropia(linea) || !SOCIEDAD.test(linea)) continue;
    const m = linea.match(SOCIEDAD);
    return linea.slice(0, m.index + m[0].length).trim().slice(0, MAX.proveedor);
  }
  return null;
}

/** Los cuatro datos del formulario sacados del texto; null en lo que no se encuentra. */
function datosDelTexto(texto, { nombreFichero, proveedores = [] } = {}) {
  return {
    proveedor:     proveedorDe(texto, proveedores),
    numero:        numeroDe(texto, nombreFichero),
    fecha_emision: fechaDe(texto),
    importe:       importeDe(texto),
  };
}

/**
 * Lo que devuelve el paso 1: { con_texto, datos: { proveedor, numero, fecha_emision, importe } }.
 * Nunca lanza.
 */
async function leerFactura(buffer, { nombreFichero, proveedores = [] } = {}) {
  const texto = await textoDePdf(buffer);
  if (!texto) {
    // Ni texto: lo único que puede dar algo es el nombre del fichero
    return { con_texto: false, datos: { proveedor: null, numero: numeroDe('', nombreFichero), fecha_emision: null, importe: null } };
  }
  return { con_texto: true, datos: datosDelTexto(texto, { nombreFichero, proveedores }) };
}

module.exports = {
  leerFactura,
  // para los tests
  textoDePdf, datosDelTexto, proveedorDe, numeroDe, fechaDe, importeDe, primeraFecha,
};
