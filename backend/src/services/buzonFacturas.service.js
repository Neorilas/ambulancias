/**
 * services/buzonFacturas.service.js
 * Lee el buzón de facturas (facturas@vapss.net, en Hostalia) y guarda en
 * `facturas` los PDF adjuntos, con origen 'correo'. Así las de Google Ads
 * llegan solas, sin subida manual (docs/MAPA_CODIGO.md §2.8).
 *
 * Reglas:
 *   - Solo lectura del buzón: no marca, no mueve, no borra. Cada pasada mira
 *     los correos de los últimos FACTURAS_BUZON_DIAS días, y lo que ya está
 *     guardado se salta por (proveedor, numero). Da igual que alguien abra el
 *     correo a mano antes.
 *   - Solo remitentes de FACTURAS_REMITENTES (dominios o direcciones). El
 *     buzón es público: sin esto, cualquiera mete un PDF en el panel. Y como
 *     el From se puede falsificar, además se exige que el servidor de correo
 *     que lo recibió diga que la firma es buena (DKIM o DMARC del dominio
 *     permitido, en Authentication-Results). FACTURAS_EXIGIR_FIRMA=0 lo quita.
 *   - Un adjunto solo entra si de verdad es un PDF (cabecera `%PDF-`).
 *   - Nunca lanza: devuelve un resumen, que es lo que enseña la pantalla.
 *
 * Lo que se saca de cada correo (proveedor, número, fecha, importe) es
 * heurístico hasta ver el formato real de Google: ver `datosDeFactura`.
 */

'use strict';

const { ImapFlow }     = require('imapflow');
const { simpleParser } = require('mailparser');
const { query }        = require('../config/database');
const { ahora, fechaEnEspana } = require('../utils/fecha.utils');
const { esPdf, importeValido } = require('../controllers/facturas.controller');
const { logAudit }     = require('../controllers/admin.controller');
const logger           = require('../utils/logger.utils');

const MAX_PDF_BYTES = 15 * 1024 * 1024;   // MEDIUMBLOB son 16 MB

function config() {
  const e = process.env;
  return {
    host:       e.FACTURAS_IMAP_HOST || 'imap.servidor-correo.net',
    port:       parseInt(e.FACTURAS_IMAP_PORT, 10) || 993,
    usuario:    (e.FACTURAS_IMAP_USUARIO || '').trim(),
    contrasena: e.FACTURAS_IMAP_CONTRASENA || '',
    carpeta:    e.FACTURAS_IMAP_CARPETA || 'INBOX',
    remitentes: (e.FACTURAS_REMITENTES || 'google.com').split(',').map(s => s.trim().toLowerCase()).filter(Boolean),
    dias:       parseInt(e.FACTURAS_BUZON_DIAS, 10) || 45,
    exigirFirma: e.FACTURAS_EXIGIR_FIRMA !== '0',
  };
}

const configurado = () => { const c = config(); return Boolean(c.usuario && c.contrasena); };

// ── Lo que se deduce de cada correo ──────────────────────────────────────────

/** ¿Lo manda alguien de la lista? Vale un dominio (y sus subdominios) o una dirección exacta. */
function remitentePermitido(direccion, permitidos = config().remitentes) {
  const dir = String(direccion || '').trim().toLowerCase();
  const dominio = dir.split('@')[1];
  if (!dominio) return false;
  return permitidos.some(p => (p.includes('@')
    ? dir === p
    : dominio === p || dominio.endsWith(`.${p}`)));
}

/**
 * ¿Dice el servidor que lo recibió que la firma es de un dominio permitido?
 * Se mira solo el PRIMER Authentication-Results, que es el que añade nuestro
 * servidor al recibir; los de más abajo los puede traer el propio correo.
 * Vale `dkim=pass` con `header.d=<dominio>` o `dmarc=pass` con
 * `header.from=<dominio>` (o un subdominio).
 */
function firmaValida(cabecera, permitidos = config().remitentes) {
  const primera = String(Array.isArray(cabecera) ? cabecera[0] : (cabecera || '')).toLowerCase();
  if (!primera) return false;
  const dominios = permitidos.map(p => (p.includes('@') ? p.split('@')[1] : p));
  const encaja = (d) => dominios.some(p => d === p || d.endsWith(`.${p}`));
  const dkim  = [...primera.matchAll(/dkim=pass[^;]*?header\.d=([a-z0-9.-]+)/g)].map(m => m[1]);
  const dmarc = [...primera.matchAll(/dmarc=pass[^;]*?header\.from=([a-z0-9.-]+)/g)].map(m => m[1]);
  return [...dkim, ...dmarc].some(encaja);
}

/** El proveedor por el remitente: Google → «Google Ads» (lo que se usa a mano), el resto por su nombre. */
function proveedorDe(direccion, nombre) {
  const dominio = String(direccion || '').toLowerCase().split('@')[1] || '';
  if (dominio === 'google.com' || dominio.endsWith('.google.com')) return 'Google Ads';
  return (String(nombre || '').trim() || dominio || 'Desconocido').slice(0, 100);
}

/** ¿La estructura del correo trae algún PDF? Para no descargar los que no. */
function tienePdf(nodo) {
  if (!nodo) return false;
  const nombre = String(nodo.dispositionParameters?.filename || nodo.parameters?.name || '').toLowerCase();
  if (String(nodo.type || '').toLowerCase() === 'application/pdf' || nombre.endsWith('.pdf')) return true;
  return (nodo.childNodes || []).some(tienePdf);
}

/**
 * Número de factura: el del nombre del PDF si parece uno (Google los llama
 * por su número), si no el que diga el texto del correo, y si no, el nombre
 * del fichero tal cual.
 */
function numeroDe(nombreFichero, texto, fecha) {
  const base = String(nombreFichero || '').replace(/\.pdf$/i, '').trim();
  const largo = base.match(/\d{6,}/);
  if (largo) return largo[0].slice(0, 64);
  const enTexto = String(texto || '').match(/(?:n[úu]mero de (?:la )?factura|n\.?º de factura|invoice number|factura n\.?º?)\s*[:#]?\s*([A-Z0-9][A-Z0-9-]{3,})/i);
  if (enTexto) return enTexto[1].slice(0, 64);
  // Sin número a la vista: el nombre del fichero y el día, para que dos
  // «factura.pdf» de meses distintos no se tomen por la misma.
  const sufijo = fecha ? `-${fecha}` : '';
  return `${(base || 'sin-numero').slice(0, 64 - sufijo.length)}${sufijo}`;
}

/** Importe en euros que diga el texto del correo («Total: 65,23 €», «Importe: €65,23»), o null. */
function importeDe(texto) {
  const m = String(texto || '').match(/(?:total|importe)[^\d€\n]{0,40}(?:€\s*)?(\d{1,3}(?:\.\d{3})+,\d{2}|\d+[.,]\d{2})/i);
  if (!m) return null;
  const v = importeValido(m[1]);
  return Number.isNaN(v) || v === undefined ? null : v;
}

/** Proveedor, número, fecha, importe y notas de un PDF adjunto a un correo ya parseado. */
function datosDeFactura(correo, adjunto) {
  const de = correo.from?.value?.[0] || {};
  const texto = [correo.subject, correo.text].filter(Boolean).join('\n');
  const recibido = correo.date instanceof Date && !Number.isNaN(correo.date.getTime()) ? correo.date : ahora();
  // Fecha en que llegó el correo, en hora española. La de emisión de verdad
  // está en el PDF; Google emite el último día del mes y manda el correo días después.
  const fecha = fechaEnEspana(recibido);
  return {
    proveedor: proveedorDe(de.address, de.name),
    numero:    numeroDe(adjunto.filename, texto, fecha),
    fecha,
    importe:   importeDe(texto),
    notas:     `Recibida por correo: ${String(correo.subject || '(sin asunto)')}`.slice(0, 255),
    nombre:    String(adjunto.filename || 'factura.pdf').slice(0, 255),
  };
}

// ── La pasada ────────────────────────────────────────────────────────────────

let enCurso = null;
let ultima = null;   // { at, ok, revisados, importadas, ya_estaban, descartados, error? }

/** Estado para la pantalla: si está configurado y cómo fue la última pasada. */
function estado() {
  const c = config();
  return { configurado: configurado(), buzon: c.usuario || null, ultima };
}

async function yaEsta(proveedor, numero) {
  const [filas] = await query('SELECT id FROM facturas WHERE proveedor = ? AND numero = ? LIMIT 1', [proveedor, numero]);
  return filas.length > 0;
}

async function guardar(d, adjunto) {
  const [r] = await query(
    `INSERT INTO facturas
       (proveedor, numero, fecha_emision, importe, notas, nombre_fichero, tamano, contenido, origen, subido_por, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'correo', NULL, ?)`,
    [d.proveedor, d.numero, d.fecha, d.importe, d.notas, d.nombre, adjunto.content.length, adjunto.content, ahora()]
  );
  await logAudit({
    userId: null,
    userInfo: 'sistema (buzón de facturas)',
    action: 'import_factura',
    entityType: 'factura',
    entityId: r.insertId,
    details: { proveedor: d.proveedor, numero: d.numero, fecha_emision: d.fecha, importe: d.importe, tamano: adjunto.content.length },
  });
}

async function pasada() {
  const c = config();
  const res = { at: ahora().toISOString(), ok: false, revisados: 0, importadas: 0, ya_estaban: 0, descartados: 0, sin_firma: 0, errores: 0 };
  if (!configurado()) return { ...res, error: 'Buzón sin configurar' };

  const cliente = new ImapFlow({
    host: c.host, port: c.port, secure: true,
    auth: { user: c.usuario, pass: c.contrasena },
    logger: false,
    socketTimeout: 60000,
  });
  // Imprescindible: una vez conectado, imapflow avisa de los fallos de red
  // (timeout, ECONNRESET a mitad de un fetch) con un evento 'error'. Sin
  // nadie escuchando, ese evento lanza fuera de este try y el
  // uncaughtException de server.js tumba la API entera. La operación en curso
  // falla igual y la recoge el catch de abajo.
  cliente.on('error', (err) => logger.error(`Buzón de facturas (conexión): ${err.code || err.message}`));

  try {
    await cliente.connect();
    const candado = await cliente.getMailboxLock(c.carpeta, { readOnly: true });
    try {
      const desde = new Date(ahora().getTime() - c.dias * 24 * 60 * 60 * 1000);
      const uids = (await cliente.search({ since: desde }, { uid: true })) || [];
      if (!uids.length) { res.ok = true; return res; }

      // Primero solo la cabecera y la estructura: se descarga entero solo lo
      // que viene de un remitente permitido y trae un PDF.
      const aDescargar = [];
      for await (const m of cliente.fetch(uids, { envelope: true, bodyStructure: true }, { uid: true })) {
        res.revisados++;
        const de = m.envelope?.from?.[0]?.address;
        if (remitentePermitido(de, c.remitentes) && tienePdf(m.bodyStructure)) aDescargar.push(m.uid);
        else res.descartados++;
      }

      for (const uid of aDescargar) {
        const m = await cliente.fetchOne(uid, { source: true }, { uid: true });
        if (!m?.source) { res.descartados++; continue; }
        const correo = await simpleParser(m.source);
        // Lo que dice el sobre puede no coincidir con la cabecera parseada: se vuelve a mirar.
        if (!remitentePermitido(correo.from?.value?.[0]?.address, c.remitentes)) { res.descartados++; continue; }
        // El From se falsifica gratis; la firma que comprobó nuestro servidor, no.
        if (c.exigirFirma && !firmaValida(correo.headers?.get?.('authentication-results'), c.remitentes)) {
          res.sin_firma++;
          continue;
        }

        const pdfs = (correo.attachments || []).filter(a =>
          Buffer.isBuffer(a.content) && a.content.length <= MAX_PDF_BYTES && esPdf(a.content));
        if (!pdfs.length) { res.descartados++; continue; }

        for (const adjunto of pdfs) {
          // Un adjunto que falla (un dato que no cabe, un fallo de BD) no para
          // la pasada: si lo hiciera, ese correo bloquearía todos los de detrás
          // en cada revisión.
          try {
            const d = datosDeFactura(correo, adjunto);
            if (await yaEsta(d.proveedor, d.numero)) { res.ya_estaban++; continue; }
            await guardar(d, adjunto);
            res.importadas++;
            logger.info(`Buzón de facturas: guardada ${d.proveedor} ${d.numero} (${adjunto.content.length} B)`);
          } catch (err) {
            // Otra pasada o una subida a mano la ha metido entre medias
            if (err.code === 'ER_DUP_ENTRY') { res.ya_estaban++; continue; }
            res.errores++;
            logger.error(`Buzón de facturas: no se pudo guardar un adjunto (uid ${uid}): ${err.code || err.message}`);
          }
        }
      }
      res.ok = true;
      return res;
    } finally {
      candado.release();
    }
  } catch (err) {
    // Sin la contraseña ni nada del correo en el mensaje: solo qué pasó.
    const motivo = err.authenticationFailed ? 'Usuario o contraseña del buzón incorrectos'
      : err.code === 'ENOTFOUND' ? `No se encuentra el servidor ${c.host}`
      : (err.responseText || err.message || 'Error desconocido');
    logger.error(`Buzón de facturas: ${motivo}`);
    return { ...res, ok: false, error: String(motivo).slice(0, 300) };
  } finally {
    try { await cliente.logout(); } catch { /* ya cerrada */ }
  }
}

/** Una pasada; si ya hay una en marcha (cron y botón a la vez), espera a esa. Nunca lanza. */
async function revisarBuzon() {
  if (!enCurso) {
    enCurso = pasada()
      .catch((err) => ({ at: ahora().toISOString(), ok: false, revisados: 0, importadas: 0, ya_estaban: 0, descartados: 0, sin_firma: 0, errores: 0, error: err.message }))
      .then((r) => { ultima = r; return r; })
      .finally(() => { enCurso = null; });
  }
  return enCurso;
}

module.exports = {
  revisarBuzon, estado, configurado, config,
  // para los tests
  remitentePermitido, firmaValida, proveedorDe, tienePdf, numeroDe, importeDe, datosDeFactura,
  _reiniciar: () => { enCurso = null; ultima = null; },
};
