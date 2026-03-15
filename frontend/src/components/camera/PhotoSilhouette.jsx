import React from 'react';

// ── Siluetas SVG — furgoneta sanitaria (perfil limpio minimalista) ──────────
const SILUETAS = {

  // Vista frontal — boxy, alta, parabrisas grande
  frontal: (
    <svg viewBox="0 0 200 210" fill="none" stroke="white" strokeWidth="2.5"
         strokeLinecap="round" strokeLinejoin="round" opacity="0.8" className="w-full h-full">
      <rect x="14" y="16" width="172" height="162" rx="14"/>
      <rect x="26" y="24" width="148" height="92" rx="8"/>
      <rect x="0"   y="54" width="12" height="24" rx="3"/>
      <rect x="188" y="54" width="12" height="24" rx="3"/>
      <rect x="16"  y="124" width="44" height="22" rx="6"/>
      <rect x="140" y="124" width="44" height="22" rx="6"/>
      <rect x="70"  y="128" width="60" height="14" rx="4"/>
      <rect x="10"  y="156" width="180" height="16" rx="7"/>
      <rect x="52"  y="5"   width="96"  height="13" rx="5"/>
      <path d="M 0 192 Q 28 175 56 192"/>
      <path d="M 144 192 Q 172 175 200 192"/>
    </svg>
  ),

  // Vista lateral izquierda — pendiente del parabrisas a la izquierda
  lateral_izquierdo: (
    <svg viewBox="0 0 220 110" fill="none" stroke="white" strokeWidth="2.5"
         strokeLinecap="round" strokeLinejoin="round" opacity="0.8" className="w-full h-full">
      <path d="M 16 84 L 16 54 Q 18 24 50 16 L 206 16 Q 216 16 216 26 L 216 84 Q 216 90 210 90 L 22 90 Q 16 90 16 84 Z"/>
      <path d="M 20 54 Q 22 24 52 18 L 106 18 L 106 54 Z" strokeWidth="2"/>
      <rect x="2" y="34" width="12" height="20" rx="3"/>
      <rect x="14" y="62" width="6" height="16" rx="2"/>
      <rect x="212" y="50" width="6" height="20" rx="2"/>
      <circle cx="62"  cy="95" r="18"/>
      <circle cx="62"  cy="95" r="8"/>
      <circle cx="168" cy="95" r="18"/>
      <circle cx="168" cy="95" r="8"/>
    </svg>
  ),

  // Vista trasera — dos hojas de puerta
  trasera: (
    <svg viewBox="0 0 200 210" fill="none" stroke="white" strokeWidth="2.5"
         strokeLinecap="round" strokeLinejoin="round" opacity="0.8" className="w-full h-full">
      <rect x="14" y="16" width="172" height="162" rx="14"/>
      <rect x="48"  y="5"   width="104" height="13" rx="5"/>
      <line x1="100" y1="16" x2="100" y2="178" strokeWidth="2.8"/>
      <rect x="16"  y="20" width="32" height="68" rx="6"/>
      <rect x="152" y="20" width="32" height="68" rx="6"/>
      <rect x="76"  y="92" width="12" height="32" rx="3"/>
      <rect x="112" y="92" width="12" height="32" rx="3"/>
      <rect x="66"  y="152" width="68" height="20" rx="3"/>
      <rect x="10"  y="158" width="180" height="16" rx="7"/>
      <path d="M 0 194 Q 28 177 56 194"/>
      <path d="M 144 194 Q 172 177 200 194"/>
    </svg>
  ),

  // Vista lateral derecha — espejado
  lateral_derecho: (
    <svg viewBox="0 0 220 110" fill="none" stroke="white" strokeWidth="2.5"
         strokeLinecap="round" strokeLinejoin="round" opacity="0.8" className="w-full h-full">
      <path d="M 204 84 L 204 54 Q 202 24 170 16 L 14 16 Q 4 16 4 26 L 4 84 Q 4 90 10 90 L 198 90 Q 204 90 204 84 Z"/>
      <path d="M 200 54 Q 198 24 168 18 L 114 18 L 114 54 Z" strokeWidth="2"/>
      <rect x="206" y="34" width="12" height="20" rx="3"/>
      <rect x="200" y="62" width="6" height="16" rx="2"/>
      <rect x="2" y="50" width="6" height="20" rx="2"/>
      <circle cx="158" cy="95" r="18"/>
      <circle cx="158" cy="95" r="8"/>
      <circle cx="52"  cy="95" r="18"/>
      <circle cx="52"  cy="95" r="8"/>
    </svg>
  ),

  // Cuentakilómetros — cuadro de instrumentos
  cuentakilometros: (
    <svg viewBox="0 0 280 180" fill="none" stroke="white" strokeWidth="2.5"
         strokeLinecap="round" strokeLinejoin="round" opacity="0.8" className="w-full h-full">
      <rect x="12" y="18" width="256" height="148" rx="10"/>
      <circle cx="98" cy="92" r="62"/>
      <circle cx="98" cy="92" r="5" fill="white" opacity="0.7"/>
      <path d="M 42 136 A 62 62 0 1 1 154 136" strokeWidth="2.5"/>
      {[0, 36, 72, 108, 144, 180].map((deg, i) => {
        const a = (deg - 90) * Math.PI / 180;
        return <line key={i}
          x1={98 + 55 * Math.cos(a)} y1={92 + 55 * Math.sin(a)}
          x2={98 + 47 * Math.cos(a)} y2={92 + 47 * Math.sin(a)}
          strokeWidth="2"/>;
      })}
      <line x1="98" y1="92" x2="142" y2="54" strokeWidth="2.5"/>
      <rect x="60" y="115" width="76" height="20" rx="4"/>
      <circle cx="196" cy="92" r="46"/>
      <circle cx="196" cy="92" r="4" fill="white" opacity="0.7"/>
      <path d="M 157 130 A 46 46 0 1 1 235 130" strokeWidth="1.8"/>
      <line x1="196" y1="92" x2="218" y2="58" strokeWidth="2"/>
    </svg>
  ),
};

const SILUETA_RATIO = {
  frontal:           '200/210',
  lateral_izquierdo: '220/110',
  trasera:           '200/210',
  lateral_derecho:   '220/110',
  niveles_liquidos:  '4/3',
  cuentakilometros:  '280/180',
};

/**
 * PhotoSilhouette — silueta SVG de encuadre + instrucción para cada tipo de foto.
 * Componente puro: no tiene estado ni efectos secundarios.
 *
 * Props:
 *   tipoKey      — clave del tipo de foto (ej: 'frontal', 'lateral_izquierdo')
 *   wantLandscape — si el tipo requiere orientación horizontal
 *   isLandscape  — si el dispositivo está actualmente en horizontal
 *   instruccion  — texto de ayuda a mostrar bajo la silueta
 */
export default function PhotoSilhouette({ tipoKey, wantLandscape, isLandscape, instruccion }) {
  const svg = SILUETAS[tipoKey];
  if (!svg) return null;

  const style = (() => {
    if (wantLandscape) return { width: '94%' };
    if (isLandscape)   return { height: '55dvh', width: 'auto', aspectRatio: SILUETA_RATIO[tipoKey] ?? '4/3' };
    return { width: 'min(68%, 240px)' };
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
