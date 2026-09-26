#!/usr/bin/env node
/**
 * scripts/publicador/publicar-ftp.mjs
 * Sube el build (dist/) al hosting de Hostalia por FTPS, VERIFICANDO el
 * certificado. Lo usa el job `publicar` de .github/workflows/deploy-frontend.yml.
 *
 * Por qué no FTP-Deploy-Action: se conecta a FTP_HOST, que es una IP, y el
 * certificado del FTP es el de Hostalia (*.servicio-online.net), que no cubre
 * esa IP ni ningún nombre que apunte a ella. Con verificación estricta falla
 * siempre, así que la acción iba en modo «loose» (acepta cualquier
 * certificado): un MITM en la red del runner se llevaba la contraseña del FTP,
 * y con ella podía cambiar el JavaScript que ejecutan todos los técnicos.
 *
 * Aquí se valida la cadena contra las CA del sistema (`rejectUnauthorized`) y
 * el nombre contra FTP_TLS_NOMBRE en vez de contra la IP. Un atacante
 * necesitaría un certificado válido emitido para el dominio de Hostalia.
 * Si Hostalia cambia de certificado a otro dominio, esto falla ANTES de
 * enviar la contraseña: el deploy sale en rojo y hay que actualizar
 * FTP_TLS_NOMBRE en el workflow (mirar el nuevo con
 * `openssl s_client -starttls ftp -connect <ip>:21`).
 *
 * Orden de subida: primero todo lo demás y al final .htaccess, el manifest,
 * sw.js e index.html. Si la subida se corta a medias, el index.html viejo
 * sigue apuntando a sus chunks viejos, que siguen ahí (nunca se borra nada).
 *
 * `assets/` y `modelos/` llevan versión en el nombre (hash / coco-ssd-vN): si
 * en el servidor ya hay un fichero con ese nombre y tamaño, no se vuelve a
 * subir. Así el modelo de 7 MB no viaja en cada deploy. OJO: en `modelos/` la
 * versión es la de la CARPETA, no un hash del contenido. Si se cambia un
 * fichero del modelo sin cambiar de carpeta y queda con el mismo tamaño, no se
 * subirá nunca. Un modelo nuevo va SIEMPRE en una carpeta nueva (coco-ssd-vN+1).
 *
 * Las dependencias (basic-ftp) van en el package.json/package-lock.json de
 * esta carpeta, con versión y hash fijados; el workflow las instala con
 * `npm ci --ignore-scripts`. Si se regenera el lock, con npm 10
 * (`npx npm@10.9.8 install --package-lock-only`), que es el del runner.
 *
 * Uso:
 *   node publicar-ftp.mjs               sube DIST (por defecto ./dist)
 *   node publicar-ftp.mjs --comprobar   solo conecta, verifica y lista: no sube
 *
 * Entorno: FTP_HOST, FTP_USER, FTP_PASSWORD, FTP_REMOTE_DIR, FTP_TLS_NOMBRE, DIST.
 */

import { Client } from 'basic-ftp';
import tls  from 'node:tls';
import fs   from 'node:fs';
import path from 'node:path';

const ULTIMOS    = ['.htaccess', 'manifest.webmanifest', 'sw.js', 'index.html'];
const INMUTABLES = ['assets/', 'modelos/'];

function requerida(nombre) {
  const v = process.env[nombre];
  if (!v) { console.error(`Falta la variable de entorno ${nombre}`); process.exit(1); }
  return v;
}

/** Ficheros de `dir` con su ruta relativa en formato POSIX. */
function listarLocal(dir, base = dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const abs = path.join(dir, e.name);
    if (e.isDirectory()) return listarLocal(abs, base);
    return [{ abs, rel: path.relative(base, abs).split(path.sep).join('/') }];
  });
}

/** Orden de subida: lo de ULTIMOS al final y en ese orden. */
function ordenarParaSubir(rels) {
  const resto  = rels.filter((r) => !ULTIMOS.includes(r)).sort();
  const finales = ULTIMOS.filter((u) => rels.includes(u));
  return [...resto, ...finales];
}

const esInmutable = (rel) => INMUTABLES.some((p) => rel.startsWith(p));

async function conectar() {
  const nombreTls = requerida('FTP_TLS_NOMBRE');
  const client = new Client(60000);
  await client.access({
    host:     requerida('FTP_HOST'),
    port:     21,
    user:     requerida('FTP_USER'),
    password: requerida('FTP_PASSWORD'),
    secure:   true,
    secureOptions: {
      rejectUnauthorized: true,
      // Se ignora el host (una IP) y se comprueba contra el nombre del
      // certificado de Hostalia. Vale también para las conexiones de datos,
      // que basic-ftp abre con estas mismas opciones.
      checkServerIdentity: (_host, cert) => tls.checkServerIdentity(nombreTls, cert),
    },
  });
  return client;
}

async function main() {
  const soloComprobar = process.argv.includes('--comprobar');
  const remoto = requerida('FTP_REMOTE_DIR').replace(/\/+$/, '');
  const client = await conectar();

  try {
    await client.cd(remoto);
    // FTP_REMOTE_DIR es RELATIVA a la home del usuario (vapss.net/app): volver
    // a hacer cd(remoto) desde dentro de una subcarpeta falla con 550. Se
    // guarda la ruta absoluta y el bucle vuelve siempre a ella.
    const base = await client.pwd();
    const raiz = await client.list();
    console.log(`Conexión verificada. El destino tiene ${raiz.length} entradas; index.html ${raiz.some((f) => f.name === 'index.html') ? 'presente' : 'AUSENTE'}.`);
    if (soloComprobar) return;

    const dist = path.resolve(process.env.DIST || 'dist');
    const locales = new Map(listarLocal(dist).map((f) => [f.rel, f.abs]));
    const orden = ordenarParaSubir([...locales.keys()]);
    const listados = new Map();   // dir remoto → Map(nombre → tamaño)
    let subidos = 0, saltados = 0;

    for (const rel of orden) {
      const dir    = path.posix.dirname(rel);
      const nombre = path.posix.basename(rel);
      const abs    = locales.get(rel);

      await client.cd(base);
      if (dir !== '.') await client.ensureDir(dir);

      if (esInmutable(rel)) {
        if (!listados.has(dir)) {
          listados.set(dir, new Map((await client.list()).map((f) => [f.name, f.size])));
        }
        if (listados.get(dir).get(nombre) === fs.statSync(abs).size) { saltados++; continue; }
      }

      await client.uploadFrom(abs, nombre);
      subidos++;
      console.log(`  ↑ ${rel}`);
    }
    console.log(`Publicado: ${subidos} subidos, ${saltados} ya estaban.`);
  } finally {
    client.close();
  }
}

main().catch((err) => {
  console.error(`Publicación fallida: ${err.message}`);
  process.exit(1);
});
