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
 */

export const TIPOS_CON_ENCUADRE = ['frontal', 'trasera', 'lateral_izquierdo', 'lateral_derecho'];

const CLASES_VEHICULO = ['truck', 'car', 'bus'];

export const UMBRALES_ENCUADRE = {
  confianza: 0.30,
  // fracción de la foto que debe ocupar el recuadro
  areaMinima: 0.15,
  // en los laterales lo que importa es que la ambulancia llene el ancho
  anchoMinimoLateral: 0.45,
  // un recuadro a menos de esto del borde se considera cortado por ese lado.
  // Con 1 % se escapaban ambulancias cortadas: el detector deja el recuadro
  // unos píxeles por dentro de la foto aunque el vehículo siga fuera
  margenBorde: 0.02,
};

const LADOS = { izquierda: 'la izquierda', derecha: 'la derecha', arriba: 'arriba', abajo: 'abajo' };

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
  const [x, y, w, h] = vehiculos.reduce((a, b) => (area(b) > area(a) ? b : a)).bbox;

  const mx = ancho * U.margenBorde;
  const my = alto * U.margenBorde;
  const cortes = [];
  if (x <= mx)              cortes.push('izquierda');
  if (x + w >= ancho - mx)  cortes.push('derecha');
  if (y <= my)              cortes.push('arriba');
  if (y + h >= alto - my)   cortes.push('abajo');

  if (cortes.includes('izquierda') && cortes.includes('derecha')) {
    return [{
      codigo: 'cerca',
      titulo: 'La ambulancia no cabe entera',
      consejo: 'Aléjate un par de pasos hasta que se vea de un extremo a otro.',
    }];
  }
  if (cortes.length) {
    const lados = cortes.map(c => LADOS[c]);
    const texto = lados.length > 1 ? `${lados.slice(0, -1).join(', ')} y ${lados.at(-1)}` : lados[0];
    return [{
      codigo: 'cortada',
      titulo: `La ambulancia sale cortada por ${texto}`,
      consejo: 'Muévete o aléjate un poco para que quepa entera, con algo de margen alrededor.',
    }];
  }

  const lateral = tipoKey.startsWith('lateral');
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
