import React, { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { estadoMeta } from '../../utils/flota.js';
import { tituloAsignacion } from '../../utils/enlaceAsignacion.js';

/**
 * components/flota/MapaLeaflet.jsx
 * El mapa, y solo el mapa. Leaflet con teselas de OpenStreetMap (sin clave ni
 * cuenta de terceros).
 *
 * Por qué Leaflet «a pelo» y no `react-leaflet`: react-leaflet 5 exige React 19
 * y aquí vamos por el 18, así que habría que quedarse clavado en la 4.x hasta
 * que se migre React. Lo que necesita esta pantalla —marcadores, popup y
 * encuadre— son las tres llamadas que hay aquí abajo, y no compensa una
 * dependencia que además condiciona la próxima subida de React.
 *
 * El ciclo de vida va a mano y con cuidado, porque el componente se vuelve a
 * pintar cada 30 segundos:
 *   - el mapa se crea UNA vez (`mapa.current`) y se destruye al desmontar;
 *   - los marcadores se reutilizan por clave y solo se mueven los que cambian,
 *     en vez de borrarlos todos y crearlos de nuevo: recrearlos cerraría el
 *     popup que el usuario tuviera abierto justo en ese momento;
 *   - el encuadre automático se hace SOLO la primera vez que hay puntos. Si se
 *     rehiciera en cada refresco, el mapa daría un salto cada medio minuto y
 *     sería imposible mirar una zona con calma.
 */

// Centro de reserva (Madrid) para cuando no hay ni un punto que enseñar: un
// mapa sin centro arranca en medio del Atlántico.
const CENTRO_POR_DEFECTO = [40.4168, -3.7038];
const ZOOM_POR_DEFECTO = 6;

/** Marcador redondo con el color del estado y, si cabe, el rumbo. */
function iconoDe(entrada) {
  const { color } = estadoMeta(entrada.estado);
  const rumbo = entrada.gps?.rumbo;
  // La flecha solo se dibuja si el vehículo se mueve: en uno parado el rumbo
  // que quedó grabado apunta a donde iba hace rato y solo despista.
  const flecha = entrada.estado === 'movimiento' && rumbo !== null && rumbo !== undefined
    ? `<div style="position:absolute;inset:0;transform:rotate(${rumbo}deg)">
         <div style="position:absolute;top:-7px;left:50%;margin-left:-4px;
                     width:0;height:0;border-left:4px solid transparent;
                     border-right:4px solid transparent;border-bottom:7px solid ${color}"></div>
       </div>`
    : '';

  return L.divIcon({
    className: 'marcador-flota',
    iconSize: [18, 18],
    iconAnchor: [9, 9],
    html: `<div style="position:relative;width:18px;height:18px">
             ${flecha}
             <div style="width:18px;height:18px;border-radius:9999px;background:${color};
                         border:2px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,.4)"></div>
           </div>`,
  });
}

/**
 * Contenido del globo al pinchar un marcador. Texto plano: nada de HTML ajeno.
 *
 * La asignación activa va como botón y no como `<a href>`: un enlace crudo
 * saltaría el router (recarga entera y sin el `basename` de /app/). El botón
 * llama a `alAbrir`, que navega con el router.
 */
function popupDe(entrada, alAbrir, trabajosVisibles) {
  const nodo = document.createElement('div');
  nodo.className = 'text-[13px] leading-snug';

  const titulo = document.createElement('div');
  titulo.className = 'font-semibold text-neutral-900';
  titulo.textContent = entrada.alias || entrada.matricula || 'Sin identificar';
  nodo.appendChild(titulo);

  if (entrada.alias && entrada.matricula) {
    const mat = document.createElement('div');
    mat.className = 'font-mono text-[11px] text-neutral-500';
    mat.textContent = entrada.matricula;
    nodo.appendChild(mat);
  }

  if (entrada.asignacion) {
    const asig = document.createElement('div');
    asig.className = 'mt-1.5 pt-1.5 border-t border-neutral-200';
    const boton = document.createElement('button');
    boton.type = 'button';
    boton.className = 'font-medium text-primary-600 hover:underline';
    boton.textContent = `${tituloAsignacion(entrada.asignacion, trabajosVisibles)} →`;
    // La asignación entera, no su id: con trabajo, el destino es el trabajo
    boton.addEventListener('click', () => alAbrir.current?.(entrada.asignacion));
    asig.appendChild(boton);
    if (entrada.asignacion.responsable) {
      const quien = document.createElement('div');
      quien.className = 'text-[11px] text-neutral-500';
      quien.textContent = entrada.asignacion.responsable;
      asig.appendChild(quien);
    }
    nodo.appendChild(asig);
  }
  return nodo;
}

// `trabajosVisibles`: si la pantalla de trabajos está abierta, el globo de
// una asignación con trabajo lo nombra y lleva a él (enlaceAsignacion.js).
export default function MapaLeaflet({ entradas = [], seleccionada = null, onSeleccionar, onAbrirAsignacion, trabajosVisibles = false }) {
  const contenedor  = useRef(null);
  const mapa        = useRef(null);
  const marcadores  = useRef(new Map());
  const yaEncuadrado = useRef(false);
  // El manejador vive en una ref para que el marcador no tenga que volver a
  // suscribirse cada vez que el padre reconstruye la función.
  const alSeleccionar = useRef(onSeleccionar);
  alSeleccionar.current = onSeleccionar;
  // Lo mismo para el enlace a la asignación del globo; sin él (null), el globo
  // la nombra pero el botón no hace nada.
  const alAbrirAsignacion = useRef(onAbrirAsignacion);
  alAbrirAsignacion.current = onAbrirAsignacion;

  // ── Crear el mapa (una sola vez) ───────────────────────────────────────
  useEffect(() => {
    if (mapa.current || !contenedor.current) return;

    mapa.current = L.map(contenedor.current, {
      center: CENTRO_POR_DEFECTO,
      zoom: ZOOM_POR_DEFECTO,
      zoomControl: true,
      // En el móvil el mapa ocupa media pantalla y el resto se hace scroll con
      // el dedo: sin esto, arrastrar la página dentro del mapa lo mueve a él.
      tapHold: true,
    });

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      // La atribución no es opcional: es la condición de uso de las teselas.
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(mapa.current);

    return () => {
      // stop() antes de remove(): si se sale de la página a mitad de una
      // animación (el setView de un clic), Leaflet la remata sobre un mapa
      // ya destruido y lanza «reading '_leaflet_pos'».
      // La ref se suelta ANTES del stop(): parar la animación dispara moveend,
      // y el globo pendiente de abrir (ver «Centrar») mira la ref para no
      // abrirse sobre un mapa que se está destruyendo.
      const m = mapa.current;
      mapa.current = null;
      m?.stop();
      m?.remove();
      marcadores.current.clear();
      yaEncuadrado.current = false;
    };
  }, []);

  // ── Sincronizar los marcadores con los datos ───────────────────────────
  useEffect(() => {
    if (!mapa.current) return;
    const vivos = new Set();

    for (const entrada of entradas) {
      const { lat, lng } = entrada.gps || {};
      if (lat === null || lat === undefined || lng === null || lng === undefined) continue;
      vivos.add(entrada.clave);

      let marcador = marcadores.current.get(entrada.clave);
      if (marcador) {
        marcador.setLatLng([lat, lng]);
        marcador.setIcon(iconoDe(entrada));
        marcador.setPopupContent(popupDe(entrada, alAbrirAsignacion, trabajosVisibles));
      } else {
        marcador = L.marker([lat, lng], { icon: iconoDe(entrada), title: entrada.alias || entrada.matricula || '' })
          .addTo(mapa.current)
          .bindPopup(popupDe(entrada, alAbrirAsignacion, trabajosVisibles));
        marcador.on('click', () => alSeleccionar.current?.(entrada.clave));
        marcadores.current.set(entrada.clave, marcador);
      }
    }

    // Los que ya no están (filtrados fuera, o el GPS dejó de mandarlos).
    for (const [clave, marcador] of marcadores.current) {
      if (vivos.has(clave)) continue;
      marcador.remove();
      marcadores.current.delete(clave);
    }

    // Encuadre automático: solo la primera vez que hay algo que encuadrar.
    if (!yaEncuadrado.current && vivos.size > 0) {
      const limites = L.latLngBounds([...marcadores.current.values()].map(m => m.getLatLng()));
      // Sin animación: llega ~1 s después de entrar (cuando responde la API),
      // y salir justo entonces dejaba la animación colgando del mapa
      // desmontado (el mismo error de arriba). El primer encuadre no necesita
      // transición.
      mapa.current.fitBounds(limites, { padding: [40, 40], maxZoom: 14, animate: false });
      yaEncuadrado.current = true;
    }
  }, [entradas, trabajosVisibles]);

  // ── Centrar en la que se elija desde la lista ──────────────────────────
  useEffect(() => {
    if (!mapa.current || !seleccionada) return;
    const marcador = marcadores.current.get(seleccionada);
    if (!marcador) return;
    const m = mapa.current;
    // El globo se abre al TERMINAR el viaje, no a la vez. Abrirlo en el mismo
    // instante hacía que su auto-encuadre (autoPan) parase la animación del
    // setView a medio camino y moviera el mapa solo lo justo para que cupiera
    // el globo: el vehículo acababa en una esquina en vez de en el centro.
    // El listener va ANTES del setView: sin animación, moveend sale síncrono.
    // Y antes de todo, stop(): con dos clics seguidos en la lista, el setView
    // del segundo cae mientras aún anima el zoom del primero, Leaflet lo
    // ignora (_tryAnimatedZoom) y el mapa terminaba centrado en el primero,
    // con el segundo fuera de la vista.
    m.stop();
    const abrir = () => {
      if (mapa.current === m && marcadores.current.get(seleccionada) === marcador) marcador.openPopup();
    };
    m.once('moveend', abrir);
    m.setView(marcador.getLatLng(), Math.max(m.getZoom(), 14), { animate: true });
    return () => { m.off('moveend', abrir); };
  }, [seleccionada]);

  return <div ref={contenedor} className="h-full w-full rounded-lg z-0" />;
}
