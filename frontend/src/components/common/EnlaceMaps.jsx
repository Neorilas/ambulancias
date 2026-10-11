import React from 'react';
import { mapsDeTrabajo } from '../../utils/mapas.js';

/**
 * Botón a Google Maps con la ubicación de un trabajo (v34): «Abrir» si quien
 * lo creó pegó el enlace, «Buscar» si solo hay texto — esa búsqueda puede no
 * llevar al sitio exacto, y el botón no promete más de lo que hay.
 *
 * Pestaña nueva y sin `opener`/`referrer`: es un sitio de fuera. En Android
 * abre la app de Maps; en un iPhone con la app instalada como PWA se abre en
 * la ventana de Safari de la app, con su botón «Abrir en la app».
 */
export default function EnlaceMaps({ trabajo, className = '' }) {
  const maps = mapsDeTrabajo(trabajo);
  if (!maps) return null;
  return (
    <a href={maps.url} target="_blank" rel="noopener noreferrer"
      className={`btn-secondary btn-sm inline-flex ${className}`}
      data-testid="enlace-maps">
      {maps.exacto ? 'Abrir en Google Maps' : 'Buscar en Google Maps'}
    </a>
  );
}
