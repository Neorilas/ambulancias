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

// ── Definición canónica de cada tipo de foto ───────────────────────────────
const FRONTAL            = { key: 'frontal',                 label: 'Frontal',            instruccion: 'Colócate frente al vehículo a ~3m',                                landscape: false, multiple: false };
const LATERAL_IZQUIERDO  = { key: 'lateral_izquierdo',       label: 'Lateral Izquierdo',  instruccion: 'Lado izquierdo completo · gira el móvil horizontal',               landscape: true,  multiple: false };
const TRASERA            = { key: 'trasera',                 label: 'Trasera',            instruccion: 'Colócate detrás del vehículo a ~3m',                               landscape: false, multiple: false };
const LATERAL_DERECHO    = { key: 'lateral_derecho',         label: 'Lateral Derecho',    instruccion: 'Lado derecho completo · gira el móvil horizontal',                 landscape: true,  multiple: false };
const NIVEL_ACEITE       = { key: 'nivel_aceite',            label: 'Nivel de Aceite',    instruccion: 'Saca la varilla y fotografía el nivel de aceite del motor',        landscape: false, multiple: false };
const NIVEL_LIQUIDOS     = { key: 'nivel_liquidos_general',  label: 'Líquidos en General',instruccion: 'Fotografía los depósitos de refrigerante, frenos y demás líquidos', landscape: false, multiple: false };
const CUENTAKILOMETROS   = { key: 'cuentakilometros',        label: 'Cuentakilómetros',   instruccion: 'Fotografía el cuadro de instrumentos mostrando los km',            landscape: false, multiple: false };
const DANOS              = { key: 'danos',                   label: 'Daños / Incidencias',instruccion: 'Fotografía cualquier daño visible en el vehículo',                 landscape: false, multiple: true  };
// Histórico (sólo para mostrar, ya no se sube)
const NIVELES_LIQUIDOS_LEGACY = { key: 'niveles_liquidos',   label: 'Niveles (legacy)',   instruccion: 'Niveles de líquidos',                                              landscape: false, multiple: false };

// Fotos de INICIO — cuando te asignan el vehículo
export const IMAGEN_TIPOS_INICIO = [
  FRONTAL, LATERAL_IZQUIERDO, TRASERA, LATERAL_DERECHO,
  NIVEL_ACEITE, NIVEL_LIQUIDOS,
];

// Fotos de FIN — al finalizar el trabajo/asignación
export const IMAGEN_TIPOS_FIN = [
  FRONTAL, LATERAL_IZQUIERDO, TRASERA, LATERAL_DERECHO,
  CUENTAKILOMETROS,
];

// Fotos opcionales fuera del flujo principal
export const IMAGEN_TIPOS_OPCIONALES = [DANOS];

// Lookup por key para labels, tooltips, etc. (incluye legacy)
export const IMAGEN_TIPO_BY_KEY = Object.fromEntries(
  [FRONTAL, LATERAL_IZQUIERDO, TRASERA, LATERAL_DERECHO,
   NIVEL_ACEITE, NIVEL_LIQUIDOS, CUENTAKILOMETROS, DANOS,
   NIVELES_LIQUIDOS_LEGACY]
    .map(t => [t.key, t])
);

// Labels planos (para badges, filtros, listas)
export const IMAGEN_TIPO_LABELS = Object.fromEntries(
  Object.entries(IMAGEN_TIPO_BY_KEY).map(([k, v]) => [k, v.label])
);

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

export const ASIGNACION_ESTADO_COLORS = {
  programada: 'badge-yellow',
  activa:     'badge-blue',
  finalizada: 'badge-green',
  cancelada:  'badge-gray',
};

export const ASIGNACION_ESTADO_LABELS = {
  programada: 'Programada',
  activa:     'Activa',
  finalizada: 'Finalizada',
  cancelada:  'Cancelada',
};
