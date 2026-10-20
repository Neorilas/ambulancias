import React, { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { COLOR_RUTA, COLOR_SALIDA, COLOR_FINAL } from '../../utils/flota.js';

/**
 * components/flota/MapaRecorrido.jsx
 * La ruta de un servicio: los tramos que manda el backend como líneas y dos
 * marcas, salida y última posición. Leaflet a pelo por lo mismo que
 * `MapaLeaflet` (react-leaflet 5 exige React 19).
 *
 * Los tramos llegan ya cortados donde hubo un hueco sin cobertura: no se unen
 * aquí, porque la recta entre ellos dibujaría un camino que no se hizo.
 *
 * El encuadre se hace solo la primera vez que hay ruta. Con un servicio en
 * curso los datos se refrescan cada minuto y reencuadrar en cada refresco
 * haría saltar el mapa mientras alguien mira una zona.
 */


const CENTRO_POR_DEFECTO = [40.4168, -3.7038];

function marca(color) {
  return L.divIcon({
    className: 'marcador-recorrido',
    iconSize: [14, 14],
    iconAnchor: [7, 7],
    html: `<div style="width:14px;height:14px;border-radius:9999px;background:${color};
                       border:2px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,.4)"></div>`,
  });
}

export default function MapaRecorrido({ recorrido, enCurso }) {
  const contenedor = useRef(null);
  const mapa = useRef(null);
  const capa = useRef(null);
  const yaEncuadrado = useRef(false);

  useEffect(() => {
    if (mapa.current || !contenedor.current) return;
    mapa.current = L.map(contenedor.current, {
      center: CENTRO_POR_DEFECTO,
      zoom: 6,
      tapHold: true,
    });
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(mapa.current);
    capa.current = L.layerGroup().addTo(mapa.current);

    return () => {
      // Igual que en MapaLeaflet: soltar la ref antes de stop()/remove()
      const m = mapa.current;
      mapa.current = null;
      capa.current = null;
      m?.stop();
      m?.remove();
      yaEncuadrado.current = false;
    };
  }, []);

  useEffect(() => {
    if (!mapa.current || !capa.current) return;
    capa.current.clearLayers();
    const tramos = recorrido?.tramos || [];
    if (!tramos.length) return;

    const lineas = tramos.map(t => L.polyline(t, { color: COLOR_RUTA, weight: 4, opacity: 0.85 }));
    lineas.forEach(l => l.addTo(capa.current));

    if (recorrido.inicio) {
      L.marker([recorrido.inicio.lat, recorrido.inicio.lng], { icon: marca(COLOR_SALIDA), title: 'Salida' })
        .addTo(capa.current);
    }
    if (recorrido.fin) {
      L.marker([recorrido.fin.lat, recorrido.fin.lng], {
        icon: marca(COLOR_FINAL), title: enCurso ? 'Última posición' : 'Final',
      }).addTo(capa.current);
    }

    if (!yaEncuadrado.current) {
      const limites = L.latLngBounds(tramos.flat());
      mapa.current.fitBounds(limites, { padding: [24, 24], maxZoom: 15, animate: false });
      yaEncuadrado.current = true;
    }
  }, [recorrido, enCurso]);

  return <div ref={contenedor} className="h-full w-full rounded-lg z-0" />;
}

