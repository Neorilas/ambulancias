import React from 'react';

// ── Siluetas SVG — formas simples, sin detalle ──────────────────────────────
const SILUETAS = {

  // Vista frontal — rectángulo + parabrisas
  frontal: (
    <svg viewBox="0 0 100 110" fill="none" stroke="white" strokeWidth="3"
         strokeLinecap="round" strokeLinejoin="round" opacity="0.75" className="w-full h-full">
      {/* Cuerpo */}
      <rect x="5" y="10" width="90" height="85" rx="6"/>
      {/* Parabrisas */}
      <rect x="14" y="18" width="72" height="45" rx="4"/>
    </svg>
  ),

  // Vista lateral — cuerpo + 2 ruedas
  lateral_izquierdo: (
    <svg viewBox="0 0 220 100" fill="none" stroke="white" strokeWidth="3"
         strokeLinecap="round" strokeLinejoin="round" opacity="0.75" className="w-full h-full">
      {/* Cuerpo */}
      <rect x="10" y="10" width="200" height="65" rx="6"/>
      {/* Rueda delantera */}
      <circle cx="48" cy="82" r="16"/>
      {/* Rueda trasera */}
      <circle cx="172" cy="82" r="16"/>
    </svg>
  ),

  // Vista trasera — rectángulo + separación central
  trasera: (
    <svg viewBox="0 0 100 110" fill="none" stroke="white" strokeWidth="3"
         strokeLinecap="round" strokeLinejoin="round" opacity="0.75" className="w-full h-full">
      {/* Cuerpo */}
      <rect x="5" y="10" width="90" height="85" rx="6"/>
      {/* División central de puertas */}
      <line x1="50" y1="10" x2="50" y2="95" strokeWidth="2.5"/>
    </svg>
  ),

  // Vista lateral derecha — igual que izquierda (espejado)
  lateral_derecho: (
    <svg viewBox="0 0 220 100" fill="none" stroke="white" strokeWidth="3"
         strokeLinecap="round" strokeLinejoin="round" opacity="0.75" className="w-full h-full">
      {/* Cuerpo */}
      <rect x="10" y="10" width="200" height="65" rx="6"/>
      {/* Rueda delantera */}
      <circle cx="172" cy="82" r="16"/>
      {/* Rueda trasera */}
      <circle cx="48" cy="82" r="16"/>
    </svg>
  ),

  // Cuentakilómetros — círculo con aguja
  cuentakilometros: (
    <svg viewBox="0 0 120 120" fill="none" stroke="white" strokeWidth="3"
         strokeLinecap="round" strokeLinejoin="round" opacity="0.75" className="w-full h-full">
      {/* Marco cuadro de mandos */}
      <rect x="5" y="15" width="110" height="90" rx="6"/>
      {/* Velocímetro */}
      <circle cx="60" cy="65" r="38"/>
      {/* Aguja */}
      <line x1="60" y1="65" x2="85" y2="38" strokeWidth="2.5"/>
      {/* Centro */}
      <circle cx="60" cy="65" r="4" fill="white" opacity="0.7"/>
    </svg>
  ),

  // Niveles de líquidos — icono de depósito genérico
  niveles_liquidos: (
    <svg viewBox="0 0 100 120" fill="none" stroke="white" strokeWidth="3"
         strokeLinecap="round" strokeLinejoin="round" opacity="0.75" className="w-full h-full">
      {/* Depósito */}
      <rect x="25" y="20" width="50" height="75" rx="5"/>
      {/* Nivel del líquido (línea horizontal interior) */}
      <line x1="25" y1="65" x2="75" y2="65" strokeWidth="2" strokeDasharray="6 3"/>
      {/* Tapón superior */}
      <rect x="38" y="12" width="24" height="10" rx="3"/>
    </svg>
  ),
};

const SILUETA_RATIO = {
  frontal:           '100/110',
  lateral_izquierdo: '220/100',
  trasera:           '100/110',
  lateral_derecho:   '220/100',
  niveles_liquidos:  '100/120',
  cuentakilometros:  '120/120',
};

/**
 * PhotoSilhouette — silueta SVG de encuadre + instrucción para cada tipo de foto.
 * Componente puro: no tiene estado ni efectos secundarios.
 *
 * Props:
 *   tipoKey       — clave del tipo de foto (ej: 'frontal', 'lateral_izquierdo')
 *   wantLandscape — si el tipo requiere orientación horizontal
 *   isLandscape   — si el dispositivo está actualmente en horizontal
 *   instruccion   — texto de ayuda a mostrar bajo la silueta
 */
export default function PhotoSilhouette({ tipoKey, wantLandscape, isLandscape, instruccion }) {
  const svg = SILUETAS[tipoKey];
  if (!svg) return null;

  const style = (() => {
    if (wantLandscape) return { width: '88%' };
    if (isLandscape)   return { height: '50dvh', width: 'auto', aspectRatio: SILUETA_RATIO[tipoKey] ?? '4/3' };
    return { width: 'min(60%, 220px)' };
  })();

  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
      <div className="drop-shadow-[0_0_8px_rgba(0,0,0,0.9)]" style={style}>
        {svg}
      </div>
      <div className="absolute bottom-32 left-0 right-0 text-center px-6">
        <p className="text-white text-sm bg-black/50 rounded-lg px-3 py-2 inline-block">
          {instruccion}
        </p>
      </div>
    </div>
  );
}
