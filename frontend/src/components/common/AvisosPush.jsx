/**
 * components/common/AvisosPush.jsx
 * Sección «Avisos en este dispositivo» del perfil.
 *
 * Un dispositivo, un estado. La suscripción vive en el navegador, así que esto
 * se activa teléfono a teléfono: que un admin lo tenga puesto en el móvil no
 * significa que le suene el portátil, ni al revés.
 *
 * Los estados posibles y por qué están todos contemplados:
 *   cargando       · mientras se pregunta al navegador y al servidor
 *   no-soportado   · navegador sin Push API
 *   ios-sin-instalar · iPhone/iPad en Safari: no llega nada hasta instalarla
 *   sin-configurar · el backend de este entorno no tiene claves VAPID
 *   bloqueado      · el usuario denegó el permiso; el botón ya no serviría
 *   activo         · suscrito y registrado en el servidor
 *   inactivo       · todo listo, falta pulsar
 */

import React, { useCallback, useEffect, useState } from 'react';
import { pushService }      from '../../services/push.service.js';
import { useNotification }  from '../../context/NotificationContext.jsx';
import {
  soportaPush, estaInstalada, esIOS, permisoActual,
  suscripcionActual, suscribir, desuscribir,
} from '../../utils/push.js';

function Estado({ tono, children }) {
  return <span className={`badge-${tono}`}>{children}</span>;
}

/**
 * Cómo conseguir que suene fuerte, que es lo que casi siempre se pregunta
 * después de activarlos.
 *
 * Está aquí y no en un manual aparte porque el volumen y el tono NO se pueden
 * fijar desde la app: en Android los decide el canal de notificaciones del
 * sistema y una web no puede crear canales. Con la PWA instalada, sin embargo,
 * Android le da a VAPSS su propia entrada en los ajustes, y ahí sí se puede
 * poner un tono propio y subirla a urgente — exactamente igual que WhatsApp.
 */
function AjustesDelTelefono() {
  return (
    <details className="border-t border-neutral-200 pt-3 mt-1">
      <summary className="text-[13px] font-medium text-neutral-700 cursor-pointer">
        ¿Suena demasiado flojo o llega tarde?
      </summary>
      <div className="mt-2 space-y-3">
        <div>
          <p className="text-[12.5px] font-medium text-neutral-700">
            Tono propio y volumen (Android, con la app instalada)
          </p>
          <ol className="text-[12.5px] text-neutral-500 list-decimal pl-5 space-y-1 mt-1">
            <li>Ajustes del teléfono → Aplicaciones → <span className="font-medium text-neutral-700">VAPSS</span> → Notificaciones.</li>
            <li>Entra en la categoría de avisos que aparezca.</li>
            <li>Comportamiento: pon <span className="font-medium text-neutral-700">Urgente</span> («mostrar en pantalla y hacer sonido»).</li>
            <li>Sonido: elige el tono que quieras, el mismo de WhatsApp si te vale.</li>
            <li>Si quieres que suene también en «No molestar», activa la excepción ahí mismo.</li>
          </ol>
        </div>
        <div>
          <p className="text-[12.5px] font-medium text-neutral-700">Para que no lleguen tarde</p>
          <p className="text-[12.5px] text-neutral-500 mt-1">
            Ajustes → Aplicaciones → VAPSS → Batería → <span className="font-medium text-neutral-700">Sin restricciones</span>.
            Con la batería optimizada, Android retrasa los avisos hasta que se despierta el teléfono.
          </p>
        </div>
        <p className="text-[12px] text-neutral-400">
          Sin la app instalada en la pantalla de inicio, los avisos salen bajo Chrome
          (Ajustes → Chrome → Notificaciones → Sitios) y comparten tono con el resto de webs.
        </p>
      </div>
    </details>
  );
}

export default function AvisosPush() {
  const { notify } = useNotification();

  const [estado,    setEstado]    = useState('cargando');
  const [ocupado,   setOcupado]   = useState(false);
  const [claveVapid, setClaveVapid] = useState(null);

  // Estado real = lo que dice el navegador Y lo que dice el servidor. Hacen
  // falta los dos: el navegador puede conservar una suscripción que el
  // servidor ya borró por caducada, y entonces el botón diría «activo» aunque
  // no fuese a sonar nunca.
  const revisar = useCallback(async () => {
    if (!soportaPush()) {
      setEstado(esIOS() && !estaInstalada() ? 'ios-sin-instalar' : 'no-soportado');
      return;
    }

    try {
      const { configurado, publicKey } = await pushService.getClavePublica();
      setClaveVapid(publicKey);
      if (!configurado) { setEstado('sin-configurar'); return; }
    } catch {
      setEstado('error');
      return;
    }

    if (permisoActual() === 'denied') { setEstado('bloqueado'); return; }

    try {
      const suscripcion = await suscripcionActual();
      if (!suscripcion) { setEstado('inactivo'); return; }
      const { registrado } = await pushService.getEstado(suscripcion.endpoint);
      setEstado(registrado ? 'activo' : 'inactivo');
    } catch {
      setEstado('inactivo');
    }
  }, []);

  useEffect(() => { revisar(); }, [revisar]);

  const activar = async () => {
    setOcupado(true);
    try {
      // El permiso se pide dentro de `suscribir`, y esto cuelga de un clic:
      // los navegadores ignoran la petición de permiso que no nace de un gesto.
      const suscripcion = await suscribir(claveVapid);
      await pushService.subscribe(suscripcion);
      setEstado('activo');
      notify.success('Avisos activados en este dispositivo');
    } catch (err) {
      if (permisoActual() === 'denied') setEstado('bloqueado');
      notify.error(err?.response?.data?.message || err.message || 'No se pudieron activar los avisos');
    } finally {
      setOcupado(false);
    }
  };

  const desactivar = async () => {
    setOcupado(true);
    try {
      const endpoint = await desuscribir();
      // Aunque el navegador no tuviera suscripción, se intenta la baja en el
      // servidor: puede quedar una fila huérfana de una instalación anterior.
      if (endpoint) await pushService.unsubscribe(endpoint);
      setEstado('inactivo');
      notify.success('Avisos desactivados en este dispositivo');
    } catch (err) {
      notify.error(err?.response?.data?.message || 'No se pudieron desactivar los avisos');
    } finally {
      setOcupado(false);
    }
  };

  const probar = async () => {
    setOcupado(true);
    try {
      // El servidor responde a cuántos dispositivos ha salido. Se enseña tal
      // cual porque es el único dato que separa «no ha salido» de «ha salido y
      // el teléfono no lo ha pintado», que se arreglan en sitios distintos.
      const res = await pushService.test();
      notify.info(res?.message || 'Aviso de prueba enviado. Debería sonar en unos segundos.');
    } catch (err) {
      notify.error(err?.response?.data?.message || 'No se pudo enviar el aviso de prueba');
    } finally {
      setOcupado(false);
    }
  };

  return (
    <section className="card">
      <div className="card-header">
        <div>
          <h2 className="text-[15px] font-semibold text-neutral-900">Avisos en este dispositivo</h2>
          <p className="text-[12.5px] text-neutral-500 mt-0.5">
            Suena cuando se inicia un servicio, cuando se completan las fotos de inicio
            y cuando se finaliza.
          </p>
        </div>
        {estado === 'activo'    && <Estado tono="green">Activos</Estado>}
        {estado === 'inactivo'  && <Estado tono="gray">Desactivados</Estado>}
        {estado === 'bloqueado' && <Estado tono="red">Bloqueados</Estado>}
      </div>

      {estado === 'cargando' && (
        <p className="text-[13.5px] text-neutral-500">Comprobando…</p>
      )}

      {estado === 'error' && (
        <div className="space-y-3">
          <p className="text-[13.5px] text-neutral-600">
            No se ha podido consultar el estado de los avisos.
          </p>
          <button className="btn-secondary" onClick={revisar}>Reintentar</button>
        </div>
      )}

      {estado === 'inactivo' && (
        <div className="space-y-3">
          <p className="text-[13.5px] text-neutral-600">
            Los avisos están desactivados en este dispositivo. Al activarlos, el navegador
            pedirá permiso para mostrar notificaciones.
          </p>
          <button className="btn-primary btn-full sm:w-auto" onClick={activar} disabled={ocupado}>
            {ocupado ? 'Activando…' : 'Activar avisos'}
          </button>
        </div>
      )}

      {estado === 'activo' && (
        <div className="space-y-3">
          <p className="text-[13.5px] text-neutral-600">
            Este dispositivo recibirá los avisos. Si el teléfono está en silencio o en
            «No molestar», la notificación llega igual pero no suena.
          </p>
          <div className="flex flex-col sm:flex-row gap-2">
            <button className="btn-secondary" onClick={probar} disabled={ocupado}>
              Enviar aviso de prueba
            </button>
            <button className="btn-danger" onClick={desactivar} disabled={ocupado}>
              Desactivar
            </button>
          </div>
          <AjustesDelTelefono />
        </div>
      )}

      {estado === 'bloqueado' && (
        <div className="space-y-2">
          <p className="text-[13.5px] text-neutral-600">
            Has bloqueado las notificaciones para esta app, así que el botón de activar
            no puede hacer nada hasta que lo deshagas en el navegador.
          </p>
          <ul className="text-[12.5px] text-neutral-500 list-disc pl-5 space-y-1">
            <li><span className="font-medium text-neutral-700">Android / Chrome:</span> candado de la barra de direcciones → Permisos → Notificaciones → Permitir.</li>
            <li><span className="font-medium text-neutral-700">iPhone:</span> Ajustes → Notificaciones → VAPSS → Permitir notificaciones.</li>
            <li><span className="font-medium text-neutral-700">Escritorio:</span> candado de la barra de direcciones → Notificaciones → Permitir, y recarga la página.</li>
          </ul>
        </div>
      )}

      {estado === 'ios-sin-instalar' && (
        <div className="space-y-2">
          <p className="text-[13.5px] text-neutral-600">
            En iPhone y iPad los avisos solo llegan con la app instalada en la pantalla
            de inicio (iOS 16.4 o superior). Desde Safari no llega nada.
          </p>
          <ol className="text-[12.5px] text-neutral-500 list-decimal pl-5 space-y-1">
            <li>Abre esta página en Safari.</li>
            <li>Pulsa el botón de compartir.</li>
            <li>Elige «Añadir a pantalla de inicio».</li>
            <li>Abre la app desde el icono nuevo y vuelve aquí.</li>
          </ol>
        </div>
      )}

      {estado === 'no-soportado' && (
        <p className="text-[13.5px] text-neutral-600">
          Este navegador no admite avisos push. Prueba con Chrome en Android o con la app
          instalada en la pantalla de inicio.
        </p>
      )}

      {estado === 'sin-configurar' && (
        <p className="text-[13.5px] text-neutral-600">
          Los avisos no están configurados en este entorno. Habla con administración de
          sistemas para que se carguen las claves.
        </p>
      )}
    </section>
  );
}
