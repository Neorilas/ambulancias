/**
 * Encuadre de las fotos exteriores: ¿se ve la ambulancia entera?
 *
 * Recibe lo que devuelve el detector de objetos (COCO-SSD, ver
 * components/camera/detectorVehiculo.js) y decide si avisar. Igual que
 * calidadFoto.js, SOLO AVISA: el técnico puede seguir.
 *
 * Lo que el detector sabe y lo que no:
 *  - Sí: si hay un coche/camión/autobús y su recuadro. Una ambulancia sale
 *    como «truck» o «car» según el modelo de carrocería; se aceptan las tres.
 *  - No: si es ESTA ambulancia, ni si es el lateral izquierdo o el derecho.
 *    Eso no se intenta.
 *
 * Con varios vehículos en la foto (otra ambulancia aparcada al lado) se toma
 * el de mayor recuadro, que es el que se está fotografiando.
 *
 * Ajustado con 164 fotos exteriores reales de PRO (2026-09-24):
 *  - Solo se mira si se corta por los LADOS. El borde de arriba y el de abajo
 *    daban falsos «cortada» con la ambulancia entera: el recuadro del detector
 *    llega hasta el suelo y el techo aunque haya un palmo de margen.
 *  - Un lateral con el recuadro más alto que ancho es una foto girada 90°:
 *    salieron 4 así, con el móvil en horizontal pero la pantalla sin girar
 *    (rotación bloqueada). Avisar de «cortada» ahí despistaba.
 */

export const TIPOS_CON_ENCUADRE = ['frontal', 'trasera', 'lateral_izquierdo', 'lateral_derecho'];

const CLASES_VEHICULO = ['truck', 'car', 'bus'];

export const UMBRALES_ENCUADRE = {
  confianza: 0.30,
  // fracción de la foto que debe ocupar el recuadro
  areaMinima: 0.15,
  // en los laterales lo que importa es que la ambulancia llene el ancho
  anchoMinimoLateral: 0.45,
  // un recuadro a menos de esto del borde (fracción del ancho) se considera
  // cortado por ese lado. En los laterales, 2 %: con 1 % se escapaban
  // ambulancias cortadas, porque el detector deja el recuadro unos píxeles
  // por dentro aunque el vehículo siga fuera. De frente/detrás, 1 %: la foto
  // va en vertical, la furgoneta llena casi todo el ancho y con 2 % avisaba
  // de fotos correctas
  margenLateral: 0.02,
  margenFrente:  0.01,
};

/**
 * @param detecciones [{ class, score, bbox: [x, y, ancho, alto] }] en píxeles
 * @param ancho, alto  tamaño de la imagen que vio el detector
 * @returns avisos [{ codigo, titulo, consejo }] — [] si el encuadre está bien
 */
export function evaluarEncuadre(detecciones, ancho, alto, tipoKey) {
  if (!TIPOS_CON_ENCUADRE.includes(tipoKey)) return [];
  const U = UMBRALES_ENCUADRE;

  const vehiculos = (detecciones || []).filter(
    d => CLASES_VEHICULO.includes(d.class) && d.score >= U.confianza
  );
  if (!vehiculos.length) {
    return [{
      codigo: 'sin_vehiculo',
      titulo: 'No se distingue la ambulancia',
      consejo: 'Colócate de forma que la ambulancia se vea entera y ocupe casi toda la foto.',
    }];
  }

  const area = d => d.bbox[2] * d.bbox[3];
  const [x, , w, h] = vehiculos.reduce((a, b) => (area(b) > area(a) ? b : a)).bbox;
  const lateral = tipoKey.startsWith('lateral');

  // Una ambulancia de lado siempre es más larga que alta
  if (lateral && h > w) {
    return [{
      codigo: 'girada',
      titulo: 'La foto ha salido girada',
      consejo: 'Pon el móvil en horizontal y comprueba que la pantalla gira con él. Si no gira, quita el bloqueo de rotación del móvil.',
    }];
  }

  const mx = ancho * (lateral ? U.margenLateral : U.margenFrente);
  const izquierda = x <= mx;
  const derecha   = x + w >= ancho - mx;

  if (izquierda && derecha) {
    return [{
      codigo: 'cerca',
      titulo: 'La ambulancia no cabe entera',
      consejo: 'Aléjate un par de pasos hasta que se vea de un extremo a otro.',
    }];
  }
  if (izquierda || derecha) {
    return [{
      codigo: 'cortada',
      titulo: `La ambulancia sale cortada por la ${izquierda ? 'izquierda' : 'derecha'}`,
      consejo: 'Muévete o aléjate un poco para que quepa entera, con algo de margen alrededor.',
    }];
  }

  const pequena = lateral ? w / ancho < U.anchoMinimoLateral : (w * h) / (ancho * alto) < U.areaMinima;
  if (pequena) {
    return [{
      codigo: 'lejos',
      titulo: 'La ambulancia se ve muy pequeña',
      consejo: 'Acércate hasta que ocupe casi toda la foto, sin que se corte.',
    }];
  }
  return [];
}
