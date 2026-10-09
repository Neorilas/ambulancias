import React from 'react';
import { Link } from 'react-router-dom';
import { useFeatures } from '../../context/FeaturesContext.jsx';
import { rutaAsignacion, tituloAsignacion, enlazaAlTrabajo } from '../../utils/enlaceAsignacion.js';

/**
 * components/common/EnlaceAsignacion.jsx
 * El título de una asignación, enlazado a su trabajo (si lo tiene y la
 * pantalla de trabajos está abierta) o a su detalle en el listado.
 *
 * `enlazar` es para el destino de siempre, `/asignaciones`: quien no lo tiene
 * (flag `menu_asignaciones` apagado) acabaría rebotado por `ProtectedRoute`, y
 * un enlace que no lleva a donde dice es peor que ninguno; con false se pinta
 * solo el texto. Al trabajo se enlaza según `menu_trabajos`.
 */
export default function EnlaceAsignacion({ asignacion, enlazar = true, className = '' }) {
  const { isFeatureEnabled } = useFeatures();
  const trabajosVisibles = isFeatureEnabled('menu_trabajos');
  const titulo = tituloAsignacion(asignacion, trabajosVisibles);
  if (!enlazaAlTrabajo(asignacion, trabajosVisibles) && !enlazar) {
    return <span className={className}>{titulo}</span>;
  }
  return (
    <Link
      to={rutaAsignacion(asignacion, trabajosVisibles)}
      className={`font-medium text-primary-600 hover:underline ${className}`}
    >
      {titulo} →
    </Link>
  );
}
