/**
 * controllers/csp.controller.js
 * Recoge los informes de violación de la Content-Security-Policy del frontend.
 *
 * La CSP de la PWA (frontend/public/.htaccess) arranca en modo
 * `Report-Only`: no bloquea nada, solo avisa. Sin este endpoint los avisos se
 * quedarían en la consola de cada móvil y nadie sabría si la política está
 * lista para pasar a obligatoria. Aquí se resumen en el log (`logger.warn`).
 *
 * Es un endpoint público (el navegador no manda token): no se guarda nada en
 * BD, se recortan las URL a origen + ruta (la query puede llevar datos) y cada
 * combinación directiva + recurso bloqueado se registra UNA vez por hora, para
 * que una página que viola la política en bucle no inunde el log.
 */

'use strict';

const logger = require('../utils/logger.utils');

const VISTOS_MAX   = 500;
const VENTANA_MS   = 60 * 60 * 1000;
const vistos       = new Map();   // clave → instante en que se registró

/** Origen + ruta, sin query ni fragmento. Lo que no es URL se deja tal cual, corto. */
function recortarUri(valor) {
  if (!valor || typeof valor !== 'string') return '-';
  try {
    const u = new URL(valor);
    return `${u.origin}${u.pathname}`.slice(0, 200);
  } catch {
    return valor.slice(0, 60);   // 'inline', 'eval', 'data', 'blob'…
  }
}

/**
 * Normaliza los dos formatos que mandan los navegadores:
 * - `report-uri` (application/csp-report): { "csp-report": { … } } con guiones.
 * - Reporting API (application/reports+json): [ { type, body: { … } } ] en camelCase.
 */
function extraerInformes(body) {
  if (Array.isArray(body)) {
    return body
      .filter((r) => r && r.type === 'csp-violation' && r.body)
      .map((r) => ({
        directiva: r.body.effectiveDirective || r.body.violatedDirective,
        bloqueado: r.body.blockedURL,
        documento: r.body.documentURL,
        fuente:    r.body.sourceFile,
      }));
  }
  const r = body && body['csp-report'];
  if (!r) return [];
  return [{
    directiva: r['effective-directive'] || r['violated-directive'],
    bloqueado: r['blocked-uri'],
    documento: r['document-uri'],
    fuente:    r['source-file'],
  }];
}

function yaVisto(clave, ahoraMs) {
  const t = vistos.get(clave);
  if (t && ahoraMs - t < VENTANA_MS) return true;
  if (vistos.size >= VISTOS_MAX) vistos.delete(vistos.keys().next().value);
  vistos.set(clave, ahoraMs);
  return false;
}

// POST /csp-report
function recibirInforme(req, res) {
  try {
    const ahoraMs = Date.now();
    for (const inf of extraerInformes(req.body)) {
      const directiva = String(inf.directiva || '-').slice(0, 60);
      const bloqueado = recortarUri(inf.bloqueado);
      if (yaVisto(`${directiva}|${bloqueado}`, ahoraMs)) continue;
      logger.warn(`CSP (report-only): ${directiva} bloquearía ${bloqueado} en ${recortarUri(inf.documento)}`
        + (inf.fuente ? ` [origen: ${recortarUri(inf.fuente)}]` : ''));
    }
  } catch {
    // Un informe mal formado no es asunto de nadie: se ignora.
  }
  return res.status(204).send();
}

module.exports = { recibirInforme, extraerInformes, recortarUri, _vistos: vistos };
