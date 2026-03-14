export const ROLES = {
  ADMINISTRADOR: 'administrador',
  GESTOR:        'gestor',
  TECNICO:       'tecnico',
  ENFERMERO:     'enfermero',
  MEDICO:        'medico',
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

// Fotos requeridas en el flujo de finalización de trabajo
export const IMAGEN_TIPOS = [
  { key: 'frontal',           label: 'Frontal',            instruccion: 'Colócate frente al vehículo a ~3m' },
  { key: 'lateral_izquierdo', label: 'Lateral Izquierdo',  instruccion: 'Sitúate al lado izquierdo del vehículo' },
  { key: 'lateral_derecho',   label: 'Lateral Derecho',    instruccion: 'Sitúate al lado derecho del vehículo' },
  { key: 'trasera',           label: 'Trasera',            instruccion: 'Colócate detrás del vehículo a ~3m' },
  { key: 'niveles_liquidos',  label: 'Niveles Líquidos',   instruccion: 'Abre el capó y fotografía niveles de aceite, refrigerante y demás líquidos' },
  { key: 'cuentakilometros',  label: 'Cuentakilómetros',   instruccion: 'Fotografía el cuadro de instrumentos mostrando los kilómetros' },
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
