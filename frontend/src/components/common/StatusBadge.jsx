import React from 'react';
import { ESTADO_COLORS, ESTADO_LABELS, TIPO_LABELS, labelRol } from '../../utils/constants.js';

export function EstadoBadge({ estado }) {
  const color = ESTADO_COLORS[estado] || 'badge-gray';
  const label = ESTADO_LABELS[estado] || estado;
  return <span className={color}>{label}</span>;
}

export function TipoBadge({ tipo }) {
  const label = TIPO_LABELS[tipo] || tipo;
  return <span className="badge badge-gray">{label}</span>;
}

export function RolBadge({ rol }) {
  const colors = {
    administrador: 'badge-red',
    gestor:        'badge-blue',
    tecnico:       'badge-yellow',
    enfermero:     'badge-green',
    medico:        'badge-blue',
    tes_conductor: 'badge-yellow',
  };
  return <span className={colors[rol] || 'badge-gray'}>{labelRol(rol)}</span>;
}

export function ActiveBadge({ activo }) {
  return activo
    ? <span className="badge-green">Activo</span>
    : <span className="badge-gray">Inactivo</span>;
}
