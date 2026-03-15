export const ROLES = {
  SUPERADMIN:    'superadmin',
  ADMINISTRADOR: 'administrador',
  GESTOR:        'gestor',
  TECNICO:       'tecnico',
  ENFERMERO:     'enfermero',
  MEDICO:        'medico',
};

export const PERMISSIONS = {
  MANAGE_VEHICLES:    'manage_vehicles',
  MANAGE_USERS:       'manage_users',
  MANAGE_TRABAJOS:    'manage_trabajos',
  VIEW_ALL_TRABAJOS:  'view_all_trabajos',
  MANAGE_INCIDENCIAS: 'manage_incidencias',
  ACCESS_ADMIN:       'access_admin',
};

export const TRABAJO_ESTADOS = {
  PROGRAMADO:            'programado',
  ACTIVO:                'activo',
  FINALIZADO:            'finalizado',
  FINALIZADO_ANTICIPADO: 'finalizado_anticipado',
};

export const TRABAJO_TIPOS = {
  TRASLADO:         'traslado',
  COBERTURA_EVENTO: 'cobertura_evento',
  OTRO:             'otro',
};

// Fotos requeridas en el flujo de finalización — orden walk-around natural
export const IMAGEN_TIPOS = [
  { key: 'frontal',           label: 'Frontal',            instruccion: 'Colócate frente al vehículo a ~3m',                         landscape: false, multiple: false },
  { key: 'lateral_izquierdo', label: 'Lateral Izquierdo',  instruccion: 'Lado izquierdo completo · gira el móvil horizontal',         landscape: true,  multiple: false },
  { key: 'trasera',           label: 'Trasera',            instruccion: 'Colócate detrás del vehículo a ~3m',                         landscape: false, multiple: false },
  { key: 'lateral_derecho',   label: 'Lateral Derecho',    instruccion: 'Lado derecho completo · gira el móvil horizontal',           landscape: true,  multiple: false },
  { key: 'niveles_liquidos',  label: 'Niveles Líquidos',   instruccion: 'Fotografía aceite, refrigerante y demás líquidos del motor',  landscape: false, multiple: true  },
  { key: 'cuentakilometros',  label: 'Cuentakilómetros',   instruccion: 'Fotografía el cuadro de instrumentos mostrando los km',       landscape: false, multiple: false },
];

// Fotos opcionales disponibles en el detalle del trabajo (fuera del flujo de finalización)
export const IMAGEN_TIPOS_OPCIONALES = [
  { key: 'danos', label: 'Daños / Incidencias', instruccion: 'Fotografía cualquier daño visible en el vehículo' },
];

export const ESTADO_COLORS = {
  programado:            'badge-yellow',
  activo:                'badge-blue',
  finalizado:            'badge-green',
  finalizado_anticipado: 'badge-red',
};

export const ESTADO_LABELS = {
  programado:            'Programado',
  activo:                'Activo',
  finalizado:            'Finalizado',
  finalizado_anticipado: 'Fin. Anticipado',
};

export const TIPO_LABELS = {
  traslado:         'Traslado',
  cobertura_evento: 'Cobertura Evento',
  otro:             'Otro',
};
