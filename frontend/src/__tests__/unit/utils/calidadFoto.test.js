import { describe, it, expect } from 'vitest';
import {
  aGrises, medirImagen, evaluarCalidad, UMBRALES, PERFIL_POR_TIPO,
} from '../../../utils/calidadFoto.js';

// Imágenes sintéticas en grises, a la escala en que se analiza (lado largo
// 512). Son las mismas degradaciones con que se calibraron los umbrales:
// desenfoque, arrastre de la cámara, oscuridad, reflejo.
const W = 256, H = 160;

function lienzo(fondo = 0) {
  return new Uint8Array(W * H).fill(fondo);
}

/** Generador con semilla: escenas distintas pero repetibles. */
function azar(semilla) {
  let s = semilla;
  return () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648;
}

/**
 * Escena pseudoaleatoria. Por defecto, bloques de tamaño y brillo variados
 * (un exterior); con `finos`, trazos de 2 px sobre negro (dígitos y agujas
 * del cuadro de noche). Aleatoria a propósito: una rejilla regular es un
 * patrón periódico y engaña a la medida de estela (ver calidadFoto.js).
 */
function escena({ fondo = 40, luz = 220, semilla = 7, finos = false } = {}) {
  const r = azar(semilla);
  const g = lienzo(fondo);
  const rect = (x0, y0, w, h, v) => {
    for (let y = y0; y < Math.min(H, y0 + h); y++) for (let x = x0; x < Math.min(W, x0 + w); x++) g[y * W + x] = v;
  };
  for (let i = 0; i < (finos ? 60 : 25); i++) {
    const v = Math.round(fondo + (luz - fondo) * (0.4 + 0.6 * r()));
    const x = Math.floor(r() * (W - 30)), y = Math.floor(r() * (H - 30));
    if (finos) {
      const horizontal = r() < 0.5, largo = 8 + Math.floor(r() * 20);
      rect(x, y, horizontal ? largo : 2, horizontal ? 2 : largo, v);
    } else {
      rect(x, y, 4 + Math.floor(r() * 40), 4 + Math.floor(r() * 40), v);
    }
  }
  return g;
}

/** Media móvil a lo largo de un eje: la cámara arrastrada `n` píxeles. */
function arrastrar(g, n, eje = 'x') {
  const out = new Uint8Array(g.length);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let s = 0, c = 0;
      for (let k = 0; k < n; k++) {
        const xx = eje === 'x' ? x - k : x;
        const yy = eje === 'y' ? y - k : y;
        if (xx >= 0 && yy >= 0) { s += g[yy * W + xx]; c++; }
      }
      out[y * W + x] = Math.round(s / c);
    }
  }
  return out;
}

/** Desenfoque de caja en los dos ejes (fuera de foco). */
const desenfocar = (g, n) => arrastrar(arrastrar(g, n, 'x'), n, 'y');

const codigos = (g, tipo = 'frontal') => evaluarCalidad(medirImagen(g, W, H), tipo).map(a => a.codigo);

describe('aGrises', () => {
  it('convierte RGBA a luminancia con los pesos habituales', () => {
    const data = new Uint8ClampedArray([255, 255, 255, 255, 0, 0, 0, 255, 255, 0, 0, 255, 0, 255, 0, 255]);
    const g = aGrises({ data, width: 4, height: 1 });
    expect(Array.from(g)).toEqual([255, 0, 76, 149]);
  });
});

describe('medirImagen', () => {
  it('una escena nítida mide nitidez alta en los dos ejes', () => {
    const m = medirImagen(escena(), W, H);
    expect(m.nitidezX).toBeGreaterThan(0.8);
    expect(m.nitidezY).toBeGreaterThan(0.8);
    expect(m.estela.valor).toBeGreaterThan(UMBRALES.estela);
  });

  it('una imagen lisa no tiene bordes con que medir: nitidez null', () => {
    const m = medirImagen(lienzo(128), W, H);
    expect(m.nitidez).toBeNull();
    expect(m.estela.valor).toBe(0);
  });

  it('cuenta los píxeles quemados', () => {
    const m = medirImagen(lienzo(255), W, H);
    expect(m.quemados).toBe(1);
    expect(m.p98).toBe(255);
  });
});

describe('evaluarCalidad — nitidez', () => {
  const SEMILLAS = [7, 21, 99];

  it('una foto nítida y bien iluminada no da avisos', () => {
    for (const semilla of SEMILLAS) expect(codigos(escena({ semilla }))).toEqual([]);
  });

  it('una foto desenfocada avisa de borrosa', () => {
    for (const semilla of SEMILLAS) expect(codigos(desenfocar(escena({ semilla }), 9))).toEqual(['borrosa']);
  });

  it('un desenfoque leve no avisa', () => {
    expect(codigos(desenfocar(escena(), 2))).toEqual([]);
  });

  it('una foto arrastrada avisa de movida (no de borrosa), en horizontal y en vertical', () => {
    for (const semilla of SEMILLAS) {
      expect(codigos(arrastrar(escena({ semilla }), 10, 'x'))).toEqual(['movida']);
      expect(codigos(arrastrar(escena({ semilla }), 10, 'y'))).toEqual(['movida']);
    }
  });

  // Lo que obligó a añadir la estela: los trazos finos no se ensanchan al
  // moverse, dejan una estela de bordes nítidos.
  it('detecta el movimiento en el cuadro, donde todo son trazos finos', () => {
    for (const semilla of SEMILLAS) {
      const g = escena({ semilla, fondo: 0, luz: 230, finos: true });
      expect(codigos(g, 'cuentakilometros')).toEqual([]);
      expect(codigos(arrastrar(g, 8, 'x'), 'cuentakilometros')).toEqual(['movida']);
      expect(codigos(arrastrar(g, 8, 'y'), 'cuentakilometros')).toEqual(['movida']);
    }
  });

  it('un trazo fino algo desenfocado no se confunde con movimiento', () => {
    const g = escena({ fondo: 0, luz: 230, finos: true });
    expect(codigos(desenfocar(g, 3), 'cuentakilometros')).toEqual([]);
  });

  // Un damero nítido (la carrocería) es periódico: correla en negativo a
  // medio periodo igual que una estela. No debe avisar.
  it('un damero nítido no es una foto movida', () => {
    const g = lienzo(0);
    for (let y = 30; y < 130; y++) for (let x = 0; x < W; x++) g[y * W + x] = ((x >> 4) + (y >> 4)) % 2 ? 230 : 40;
    expect(codigos(g)).toEqual([]);
  });
});

describe('evaluarCalidad — luz', () => {
  it('una foto exterior oscura avisa', () => {
    expect(codigos(escena({ fondo: 5, luz: 50 }))).toContain('oscura');
  });

  // El cuentakilómetros de noche: casi todo negro y los dígitos encendidos.
  // Es lo normal, no un defecto.
  it('el cuadro de noche con los dígitos encendidos NO es oscuro', () => {
    const g = lienzo(0);
    for (let y = 60; y < 80; y++) for (let x = 100; x < 160; x += 3) g[y * W + x] = 200;
    expect(codigos(g, 'cuentakilometros')).not.toContain('oscura');
    // la misma imagen como foto exterior sí lo es
    expect(codigos(g, 'frontal')).toContain('oscura');
  });

  it('el cuadro apagado (nada encendido) sí avisa, con consejo propio', () => {
    const avisos = evaluarCalidad(medirImagen(lienzo(10), W, H), 'cuentakilometros');
    expect(avisos.map(a => a.codigo)).toEqual(['oscura']);
    expect(avisos[0].consejo).toMatch(/contacto/);
  });

  it('una foto quemada avisa de sobreexposición', () => {
    const avisos = evaluarCalidad(medirImagen(escena({ fondo: 255, luz: 120 }), W, H), 'frontal');
    expect(avisos.map(a => a.codigo)).toEqual(['sobreexpuesta']);
    expect(avisos[0].titulo).toMatch(/demasiada luz/);
  });

  it('en el cuadro, la sobreexposición es un reflejo', () => {
    const avisos = evaluarCalidad(medirImagen(escena({ fondo: 255, luz: 120 }), W, H), 'cuentakilometros');
    expect(avisos[0].titulo).toMatch(/reflejo/);
  });

  it('los niveles usan el perfil de motor, más tolerante que el exterior', () => {
    expect(PERFIL_POR_TIPO.nivel_aceite).toBe('motor');
    const m = { brillo: 35, p98: 55, p995: 70, quemados: 0, nitidez: 0.8, nitidezX: 0.8, nitidezY: 0.8 };
    expect(evaluarCalidad(m, 'nivel_aceite')).toEqual([]);
    expect(evaluarCalidad(m, 'frontal').map(a => a.codigo)).toEqual(['oscura']);
  });

  // Fotos reales de PRO: de noche, la ambulancia bien visible con brillo medio
  // de 12 a 43. Lo que cuenta es que haya algo iluminado, no la media.
  it('una exterior de noche con la ambulancia iluminada no es oscura', () => {
    const m = { brillo: 20, p98: 150, p995: 230, quemados: 0.005, nitidez: 0.55, nitidezX: 0.55, nitidezY: 0.6, estela: { valor: -0.1, contraste: 0.03 } };
    expect(evaluarCalidad(m, 'lateral_izquierdo')).toEqual([]);
  });

  it('una foto lisa y con luz (lente tapada con el dedo) avisa', () => {
    const avisos = evaluarCalidad(medirImagen(lienzo(140), W, H), 'nivel_aceite');
    expect(avisos.map(a => a.codigo)).toEqual(['sin_detalle']);
  });

  it('una foto lisa y negra solo dice que está oscura', () => {
    expect(codigos(lienzo(2))).toEqual(['oscura']);
  });
});

describe('evaluarCalidad — consejos según el caso', () => {
  const base = { brillo: 120, p98: 200, p995: 220, quemados: 0 };

  it('movida con poca luz sugiere apoyar el móvil', () => {
    const m = { ...base, nitidez: 0.6, nitidezX: 0.6, nitidezY: 0.7, estela: { valor: -0.45, contraste: 0.3 } };
    const [aviso] = evaluarCalidad(m, 'cuentakilometros');
    expect(aviso.codigo).toBe('movida');
    expect(aviso.consejo).toMatch(/apoya el móvil/);
  });

  it('movida a plena luz sugiere sujetarlo con las dos manos', () => {
    const m = { ...base, nitidez: 0.6, nitidezX: 0.6, nitidezY: 0.7, estela: { valor: -0.45, contraste: 0.3 } };
    expect(evaluarCalidad(m, 'frontal')[0].consejo).toMatch(/dos manos/);
  });

  it('una estela igual en todas direcciones es desenfoque, no movimiento', () => {
    const m = { ...base, nitidez: 0.5, nitidezX: 0.5, nitidezY: 0.5, estela: { valor: -0.38, contraste: 0.02 } };
    expect(evaluarCalidad(m, 'cuentakilometros')).toEqual([]);
  });

  it('bordes mucho más anchos en un eje que en el otro es movimiento', () => {
    const m = { ...base, nitidez: 0.2, nitidezX: 0.2, nitidezY: 0.8, estela: { valor: -0.1, contraste: 0.05 } };
    expect(evaluarCalidad(m, 'frontal').map(a => a.codigo)).toEqual(['movida']);
  });

  it('sin métrica de estela (null) sigue funcionando', () => {
    const m = { ...base, nitidez: 0.2, nitidezX: 0.2, nitidezY: 0.25, estela: null };
    expect(evaluarCalidad(m, 'frontal').map(a => a.codigo)).toEqual(['borrosa']);
  });
});
