/**
 * Calidad de una foto de evidencia: ¿está borrosa, movida, oscura o quemada?
 *
 * Se mira en el móvil, sobre la foto recién hecha, y SOLO AVISA: quien decide
 * si se repite es el técnico (`CameraCapture` le deja seguir igualmente). Los
 * umbrales son heurísticos y se equivocan a veces; un aviso de más cuesta un
 * toque, un bloqueo equivocado deja un servicio sin cerrar.
 *
 * Todo trabaja sobre una imagen ya reducida (LADO_ANALISIS) en escala de
 * grises. Reducir no es solo por velocidad: promedia el ruido del sensor, que
 * de noche es lo que haría pasar por nítida una foto que no lo está.
 *
 * NITIDEZ = ANCHURA DE LOS BORDES. En cada borde se divide el salto más grande
 * entre dos píxeles vecinos por el contraste total del borde: 1 si el cambio
 * se hace en un píxel, 1/N si se reparte en N. Es un cociente, así que NO
 * depende de cuánta luz había ni de cuánto ocupa el contenido: la foto del
 * cuadro de noche —casi todo negro y unos dígitos iluminados— se mide igual
 * que la de un lateral a pleno sol.
 *   Se probaron antes el laplaciano global (lo que se usa normalmente) y el
 * cociente 2ª/1ª derivada, con escenas sintéticas degradadas a propósito. El
 * primero daba «borrosa» a toda foto nocturna y no veía las movidas; el
 * segundo se queda clavado en 0,5 ante un movimiento lineal, sea de 5 píxeles
 * o de 30, porque un borde arrastrado es una rampa y su 2ª derivada no cambia.
 *
 * MOVIDA. Dos pistas, basta una: (a) los bordes gruesos mucho más anchos en un
 * eje que en el otro, y (b) la «estela» (ver estelaDireccion), que es la que
 * delata el movimiento en los trazos finos del cuadro. La nitidez que cuenta
 * para «borrosa» es la del PEOR eje.
 *
 * CALIBRACIÓN. Los umbrales salen de escenas sintéticas (un lateral con damero
 * y el cuadro de día y de noche) degradadas con desenfoque, movimiento
 * horizontal/vertical/diagonal, oscuridad, ruido y sobreexposición. No hay aún
 * fotos reales malas con que contrastarlos: si en campo avisa de más o de
 * menos, es aquí donde se toca.
 *
 * LUZ. Depende del tipo de foto (PERFIL_POR_TIPO). El cuentakilómetros se hace
 * muchas veces de noche o en el interior en penumbra: ahí lo normal es que casi
 * todo esté negro, y solo se avisa si no hay NADA iluminado (el cuadro apagado),
 * mirando el percentil 99,5 del brillo y no la media.
 */

// Lado LARGO de la imagen que se analiza. Los umbrales están calibrados a
// esta escala (una foto de 1920 px reducida ~3,75 veces): cambiarlo obliga a
// recalibrar, sobre todo estelaMax, que va en píxeles.
export const LADO_ANALISIS = 512;

// Qué criterio de luz aplica a cada tipo de foto. Lo que no esté aquí usa el
// exterior, que es el más exigente.
export const PERFIL_POR_TIPO = {
  cuentakilometros:        'cuadro',
  nivel_aceite:            'motor',
  nivel_liquidos_general:  'motor',
  niveles_liquidos:        'motor',
};

export const UMBRALES = {
  // nitidez del peor eje (salto máximo / contraste del borde) por debajo → borrosa
  nitidez:        0.30,
  // eje menos nítido / eje más nítido por debajo → movida (si ya es borrosa)
  asimetria:      0.60,
  // un borde es un salto con al menos este contraste (niveles de gris) en
  // radioBorde píxeles a cada lado; por debajo es ruido o textura
  contrasteBorde: 20,
  radioBorde:     8,
  // con menos bordes que esto (fracción de los píxeles) no hay con qué medir
  // la nitidez: foto lisa o negra, y el aviso que toca es el de luz
  bordesMinimos:  0.002,
  // qué borde representa la foto. Con 0,75 o menos el ruido de una foto
  // nocturna la hacía pasar por movida
  percentilBorde: 0.9,
  // estela (autocorrelación, -1..0) a partir de la cual hay movimiento, y
  // cuánto más marcada tiene que ser que en la dirección perpendicular. Un
  // desenfoque normal llega a -0,39 pero con contraste ≤ 0,12; fotos reales
  // nítidas de ambulancias, ≥ -0,15 y ≤ 0,12; movidas en diagonal, -0,25 a
  // -0,28 con ≥ 0,19 (con -0,30 se escapaban)
  estela:          -0.22,
  estelaContraste:  0.17,
  // mayor desfase (px a LADO_ANALISIS) en que se busca la estela: ~90 px
  // de la foto original, un tirón muy exagerado
  estelaMax:      24,
  // Oscura = no hay casi nada iluminado (p98), NO que el brillo medio sea
  // bajo. Con fotos reales de PRO (2026-09-24): las exteriores de noche con
  // la ambulancia bien visible tienen brillo medio 12-43 pero p98 ≥ 82; con el
  // criterio anterior (p98 < 90 o brillo < 45) las 16 daban aviso sin motivo.
  // Las realmente inservibles (tapadas, habitación a oscuras) quedan en p98 ≤ 44.
  luz: {
    exterior: { oscura: { p98: 60, brillo: 0 }, quemados: 0.30 },
    motor:    { oscura: { p98: 50, brillo: 0 }, quemados: 0.30 },
    // de noche el brillo medio no dice nada; solo cuenta que haya algo
    // encendido, aunque sea poco (los dígitos): percentil 99,5
    cuadro:   { oscura: { p995: 60, brillo: 0 }, quemados: 0.25 },
  },
};

/** Luminancia 0..255 (entera) de un ImageData RGBA. */
export function aGrises({ data, width, height }) {
  const gris = new Uint8Array(width * height);
  for (let i = 0, j = 0; j < gris.length; i += 4, j++) {
    gris[j] = (data[i] * 77 + data[i + 1] * 150 + data[i + 2] * 29) >> 8;
  }
  return gris;
}

/** Percentil p (0..1) de un histograma. */
function percentil(hist, total, p) {
  const objetivo = total * p;
  let acumulado = 0;
  for (let v = 0; v < hist.length; v++) {
    acumulado += hist[v];
    if (acumulado >= objetivo) return v;
  }
  return hist.length - 1;
}

/**
 * Nitidez de un eje ('x' recorre filas, 'y' columnas). Un borde es un máximo
 * local del salto entre vecinos con al menos `contrasteBorde` de contraste en
 * su entorno; de cada uno se toma salto / contraste. Devuelve un percentil
 * alto, no la media (una foto nítida también tiene bordes suaves: sombras,
 * degradados), o null
 * si no hay bordes suficientes para medir.
 */
function nitidezEje(gris, ancho, alto, eje) {
  const R      = UMBRALES.radioBorde;
  const enX    = eje === 'x';
  const largo  = enX ? ancho : alto;
  const lineas = enX ? alto : ancho;
  const paso   = enX ? 1 : ancho;
  const linea  = new Uint8Array(largo);
  const salto  = new Uint8Array(largo);
  const hist   = new Uint32Array(101);
  let bordes = 0;

  for (let l = 0; l < lineas; l++) {
    const inicio = enX ? l * ancho : l;
    for (let k = 0; k < largo; k++) linea[k] = gris[inicio + k * paso];
    for (let k = 0; k < largo - 1; k++) salto[k] = Math.abs(linea[k + 1] - linea[k]);

    for (let k = R; k < largo - R - 1; k++) {
      const s = salto[k];
      if (s === 0 || s < salto[k - 1] || s < salto[k + 1]) continue;
      let min = 255, max = 0;
      for (let j = k - R; j <= k + R + 1; j++) {
        const v = linea[j];
        if (v < min) min = v;
        if (v > max) max = v;
      }
      const contraste = max - min;
      if (contraste < UMBRALES.contrasteBorde) continue;
      hist[Math.round((100 * s) / contraste)]++;
      bordes++;
    }
  }
  if (bordes < ancho * alto * UMBRALES.bordesMinimos) return null;
  return percentil(hist, bordes, UMBRALES.percentilBorde) / 100;
}

// Direcciones en que se busca la estela: horizontal, vertical y las dos
// diagonales (el pulso tiembla hacia cualquier lado). Cada una con su
// perpendicular, que es la referencia para saber si es movimiento o no.
const DIRECCIONES = [
  { nombre: 'h',  dx: 1, dy: 0,  perp: 'v'  },
  { nombre: 'v',  dx: 0, dy: 1,  perp: 'h'  },
  { nombre: 'd1', dx: 1, dy: 1,  perp: 'd2' },
  { nombre: 'd2', dx: 1, dy: -1, perp: 'd1' },
];

/**
 * Estela de movimiento en una dirección. Si la cámara se desplaza L píxeles
 * durante la exposición, cada borde aparece dos veces, con signo contrario,
 * separado L: la derivada en esa dirección se parece a sí misma desplazada L
 * pero invertida. Devuelve la autocorrelación más negativa de la derivada
 * entre los desfases 3..estelaMax (-1 = estela perfecta, ~0 = nada).
 *
 * Hace falta además de la anchura de borde porque los trazos FINOS (dígitos,
 * agujas, el aro de un reloj) no se ensanchan al moverse: dejan una estela de
 * bordes nítidos. Con solo la anchura, la foto del cuadro movida salía nítida.
 * Un desenfoque normal también da valores negativos (el trazo fino
 * emborronado), pero IGUAL en todas las direcciones; el movimiento, no.
 */
function estelaDireccion(gris, ancho, alto, { dx, dy }) {
  const MAX = UMBRALES.estelaMax;
  // derivada en la dirección; 0 fuera de la imagen
  const d = new Int16Array(ancho * alto);
  const y0 = Math.max(0, -dy), y1 = alto - Math.max(0, dy);
  let energia = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = 0; x < ancho - dx; x++) {
      const i = y * ancho + x;
      const v = gris[i + dy * ancho + dx] - gris[i];
      d[i] = v;
      energia += v * v;
    }
  }
  if (!energia) return 0;

  const corr = new Float64Array(2 * MAX + 1);
  for (let lag = 3; lag <= 2 * MAX; lag++) {
    const ox = dx * lag, oy = dy * lag;
    let s = 0;
    for (let y = Math.max(0, -oy); y < alto - Math.max(0, oy); y++) {
      const fila = y * ancho, filaDesp = (y + oy) * ancho + ox;
      for (let x = 0; x < ancho - ox; x++) s += d[fila + x] * d[filaDesp + x];
    }
    corr[lag] = s / energia;
  }

  // Un patrón PERIÓDICO (el damero de la carrocería, una rejilla) también
  // correla en negativo a medio periodo, pero vuelve a correlar en positivo
  // al periodo entero, el doble de desfase. La estela de un movimiento no.
  // Descontar esa vuelta es lo que evita llamar «movida» a un damero nítido.
  let peor = 0;
  for (let lag = 3; lag <= MAX; lag++) {
    peor = Math.min(peor, corr[lag] + Math.max(0, corr[2 * lag]));
  }
  return peor;
}

/**
 * La dirección con más estela y cuánto destaca sobre su perpendicular.
 * { valor, contraste } — contraste > 0 cuanto más propia de UNA dirección es.
 */
function medirEstela(gris, ancho, alto) {
  const por = {};
  for (const dir of DIRECCIONES) por[dir.nombre] = estelaDireccion(gris, ancho, alto, dir);
  let peor = DIRECCIONES[0];
  for (const dir of DIRECCIONES) if (por[dir.nombre] < por[peor.nombre]) peor = dir;
  return { valor: por[peor.nombre], contraste: por[peor.perp] - por[peor.nombre], por };
}

/**
 * Métricas de una imagen en grises. Todas adimensionales o en 0..255, para que
 * no dependan de la resolución de la cámara.
 */
export function medirImagen(gris, ancho, alto) {
  const total = ancho * alto;
  const histLuz = new Uint32Array(256);
  let suma = 0;
  for (let i = 0; i < total; i++) { histLuz[gris[i]]++; suma += gris[i]; }

  let quemados = 0;
  for (let v = 250; v < 256; v++) quemados += histLuz[v];

  const nitidezX = nitidezEje(gris, ancho, alto, 'x');
  const nitidezY = nitidezEje(gris, ancho, alto, 'y');
  return {
    brillo:   suma / total,
    p02:      percentil(histLuz, total, 0.02),
    p98:      percentil(histLuz, total, 0.98),
    p995:     percentil(histLuz, total, 0.995),
    quemados: quemados / total,
    nitidezX,
    nitidezY,
    estela:   medirEstela(gris, ancho, alto),
    // la del peor eje; null = no se ha podido medir
    nitidez:  nitidezX == null || nitidezY == null ? null : Math.min(nitidezX, nitidezY),
  };
}

/**
 * Avisos de calidad para unas métricas y un tipo de foto. Devuelve [] si la
 * foto está bien. Cada aviso: { codigo, titulo, consejo }.
 */
export function evaluarCalidad(m, tipoKey) {
  const perfil = PERFIL_POR_TIPO[tipoKey] || 'exterior';
  const luz    = UMBRALES.luz[perfil].oscura;
  const avisos = [];

  const oscura = m.brillo < luz.brillo
    || (luz.p98  != null && m.p98  < luz.p98)
    || (luz.p995 != null && m.p995 < luz.p995);
  if (oscura) {
    avisos.push({
      codigo: 'oscura',
      titulo: 'La foto está muy oscura',
      consejo: perfil === 'cuadro'
        ? 'No se distingue el cuadro. Pon el contacto para que se encienda o acerca una linterna.'
        : 'Busca más luz o enciende la linterna del móvil.',
    });
  } else if (m.quemados > UMBRALES.luz[perfil].quemados) {
    avisos.push({
      codigo: 'sobreexpuesta',
      titulo: perfil === 'cuadro' ? 'Hay un reflejo fuerte' : 'La foto tiene demasiada luz',
      consejo: perfil === 'cuadro'
        ? 'Cambia un poco el ángulo para que el reflejo no tape los números.'
        : 'Evita tener el sol o un foco de frente.',
    });
  }

  // Sin bordes que medir y con luz: una foto lisa (lente tapada, una pared, el
  // suelo de cerca). Si además está oscura, ya lo dice el aviso de luz.
  if (m.nitidez == null && !oscura) {
    avisos.push({
      codigo: 'sin_detalle',
      titulo: 'No se distingue nada en la foto',
      consejo: 'Comprueba que no hay nada tapando la cámara y encuadra lo que hay que fotografiar.',
    });
  }

  // Movida: o hay estela clara en una dirección (lo que delata los trazos
  // finos), o los bordes gruesos están mucho más emborronados en un eje que
  // en el otro.
  const borrosa = m.nitidez != null && m.nitidez < UMBRALES.nitidez;
  const estela  = m.estela && m.estela.valor <= UMBRALES.estela && m.estela.contraste >= UMBRALES.estelaContraste;
  const asimetrica = borrosa && m.nitidez / Math.max(m.nitidezX, m.nitidezY) < UMBRALES.asimetria;
  const movida  = estela || asimetrica;

  if (borrosa || movida) {
    const pocaLuz = perfil === 'cuadro' || oscura;
    avisos.push(movida
      ? {
          codigo: 'movida',
          titulo: 'La foto ha salido movida',
          consejo: pocaLuz
            ? 'Con poca luz la cámara tarda más: apoya el móvil (en el volante, por ejemplo) y no lo muevas hasta que se haga la foto.'
            : 'Sujeta el móvil con las dos manos y quieto hasta que se haga la foto.',
        }
      : {
          codigo: 'borrosa',
          titulo: 'La foto está borrosa',
          consejo: 'Toca la pantalla sobre lo que quieres fotografiar para enfocar y limpia la lente si hace falta.',
        });
  }

  return avisos;
}
