#!/usr/bin/env node
/**
 * Dependencias de producción marcadas como obsoletas (deprecated) en npm.
 *
 *   node scripts/dependencias-obsoletas.mjs <carpeta con package-lock.json>
 *
 * Por qué existe: multer 1.4.5-lts.2 llevaba meses marcada como obsoleta «por
 * vulnerabilidades», y `npm audit` daba 0 porque una versión prerelease
 * (`-lts.2`) no casa con el rango de los avisos. El aviso de obsoleta sí
 * estaba, pero no lo miraba nadie (auditoría 2026-10-04, SEC-15).
 *
 * Lee el lockfile (sin instalar nada), pregunta al registro por cada paquete
 * de producción y:
 *   - FALLA (exit 1) si una dependencia DIRECTA está obsoleta: esa la hemos
 *     elegido nosotros y se cambia en package.json;
 *   - AVISA (anotación de GitHub, sin fallar) si es una transitiva: no depende
 *     de nosotros y no debe bloquear un despliegue urgente.
 * Si el registro no responde, avisa y no falla: esto no puede tumbar un
 * despliegue por un problema de red.
 */

import { readFile } from 'node:fs/promises';
import path from 'node:path';

const REGISTRO    = 'https://registry.npmjs.org';
const EN_PARALELO = 16;
const ESPERA_MS   = 15000;   // por petición: un registro que no contesta no cuelga el deploy

const carpeta = process.argv[2] || '.';
const lock = JSON.parse(await readFile(path.join(carpeta, 'package-lock.json'), 'utf8'));
const raiz = lock.packages?.[''] || {};
const directas = new Set(Object.keys({ ...raiz.dependencies, ...raiz.optionalDependencies }));

// Paquetes de producción del lockfile v2/v3: `dev: true` marca los de desarrollo
const paquetes = new Map();
for (const [ruta, info] of Object.entries(lock.packages || {})) {
  if (!ruta || info.dev || info.link || !info.version) continue;
  if (!ruta.includes('node_modules/')) continue;              // un workspace, no del registro
  if (info.resolved && !info.resolved.startsWith(REGISTRO)) continue;   // git+ / file:
  // `clave` es como se instala; `info.name`, el paquete real si va con alias (npm:)
  const clave  = ruta.slice(ruta.lastIndexOf('node_modules/') + 'node_modules/'.length);
  const nombre = info.name || clave;
  const directa = ruta === `node_modules/${clave}` && directas.has(clave);
  const previa = paquetes.get(`${nombre}@${info.version}`);
  paquetes.set(`${nombre}@${info.version}`, { nombre, version: info.version, directa: directa || !!previa?.directa });
}

async function obsoleta({ nombre, version }) {
  const url = `${REGISTRO}/${nombre.replace('/', '%2F')}/${encodeURIComponent(version)}`;
  const r = await fetch(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(ESPERA_MS) });
  if (!r.ok) throw new Error(`${r.status} en ${nombre}@${version}`);
  return (await r.json()).deprecated || null;
}

const lista = [...paquetes.values()];
const encontradas = [];
let sinRespuesta = 0;
for (let i = 0; i < lista.length; i += EN_PARALELO) {
  const tanda = lista.slice(i, i + EN_PARALELO);
  const resultados = await Promise.allSettled(tanda.map(obsoleta));
  resultados.forEach((res, j) => {
    if (res.status === 'rejected') sinRespuesta++;
    else if (res.value) encontradas.push({ ...tanda[j], motivo: res.value });
  });
}

const enGitHub = !!process.env.GITHUB_ACTIONS;
const una = (s) => String(s).replace(/\s+/g, ' ').trim();
for (const d of encontradas) {
  const texto = `${d.nombre}@${d.version} está obsoleta${d.directa ? '' : ' (transitiva)'}: ${una(d.motivo)}`;
  console.log(enGitHub ? `::${d.directa ? 'error' : 'warning'}::${texto}` : `${d.directa ? 'ERROR ' : 'aviso '} ${texto}`);
}
if (sinRespuesta) {
  const texto = `${sinRespuesta} paquete(s) sin respuesta del registro: no se han podido comprobar`;
  console.log(enGitHub ? `::warning::${texto}` : `aviso  ${texto}`);
}

const fallan = encontradas.filter(d => d.directa);
console.log(`${lista.length} paquetes de producción revisados: ${fallan.length} directa(s) obsoleta(s), ${encontradas.length - fallan.length} transitiva(s).`);
process.exit(fallan.length ? 1 : 0);
