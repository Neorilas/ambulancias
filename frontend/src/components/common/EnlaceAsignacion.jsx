import React from 'react';
import { Link } from 'react-router-dom';
import { rutaAsignacion, tituloAsignacion } from '../../utils/enlaceAsignacion.js';

/**
 * components/common/EnlaceAsignacion.jsx
 * El título de una asignación, enlazado a su detalle.
 *
 * `enlazar` en false pinta solo el texto: quien no tiene `/asignaciones`
 * (flag `menu_asignaciones` apagado) acabaría rebotado a otra pantalla por
 * `ProtectedRoute`, y un enlace que no lleva a donde dice es peor que ninguno.
 */
export default function EnlaceAsignacion({ asignacion, enlazar = true, className = '' }) {
  const titulo = tituloAsignacion(asignacion);
  if (!enlazar) return <span className={className}>{titulo}</span>;
  return (
    <Link
      to={rutaAsignacion(asignacion.id)}
      className={`font-medium text-primary-600 hover:underline ${className}`}
    >
      {titulo} →
    </Link>
  );
}
