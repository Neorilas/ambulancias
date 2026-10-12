import React from 'react';
import { pasosAsignacion } from '../../utils/pasosAsignacion.js';
import { formatHora } from '../../utils/dateUtils.js';

/**
 * Barra de los cuatro pasos de una asignación, arriba de su ficha: qué está
 * hecho (con su hora), qué toca ahora y qué queda. Solo informa; los botones
 * siguen en la ficha. La lógica, en `utils/pasosAsignacion.js`.
 */
const CIRCULO = {
  hecho:     'bg-ok-500 text-white',
  actual:    'bg-primary-600 text-white ring-4 ring-primary-100',
  pendiente: 'bg-white border border-neutral-300 text-neutral-500',
  no_consta: 'bg-neutral-100 text-neutral-400',
};

function Detalle({ p }) {
  if (p.situacion === 'hecho') return p.hora ? <span className="data">{formatHora(p.hora)}</span> : null;
  if (p.situacion === 'no_consta') return <span>No consta</span>;
  if (p.aviso) return <span className="text-warn-600 font-medium">{p.aviso}</span>;
  // Sin «(opcional)» debajo: lo quitó el usuario el 2026-10-12. Que el evento
  // no bloquea lo sigue diciendo «Finalizar», disponible en secundario.
  return <span>{p.donde}</span>;
}

export default function PasosAsignacion({ asig }) {
  const pasos = pasosAsignacion(asig);
  if (!pasos) return null;

  return (
    <ol className="grid grid-cols-4" aria-label="Pasos de la asignación" data-testid="pasos-asignacion">
      {pasos.map((p, i) => (
        <li key={p.clave} aria-current={p.situacion === 'actual' ? 'step' : undefined}
          className="flex flex-col items-center text-center min-w-0 px-0.5">
          <div className="flex items-center w-full">
            <span className={`flex-1 h-0.5 ${i === 0 ? 'invisible' : pasos[i - 1].situacion === 'hecho' ? 'bg-ok-500' : 'bg-neutral-200'}`} />
            <span className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold shrink-0 ${CIRCULO[p.situacion]}`}>
              {p.situacion === 'hecho' ? (
                <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                  <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                </svg>
              ) : p.situacion === 'no_consta' ? '—' : i + 1}
            </span>
            <span className={`flex-1 h-0.5 ${i === pasos.length - 1 ? 'invisible' : p.situacion === 'hecho' ? 'bg-ok-500' : 'bg-neutral-200'}`} />
          </div>
          <p className={`mt-1.5 text-[11px] leading-tight font-medium ${
            p.situacion === 'actual' ? 'text-primary-700' : p.situacion === 'pendiente' || p.situacion === 'no_consta' ? 'text-neutral-500' : 'text-neutral-800'
          }`}>
            {/* Corte posible tras la barra: «evento/servicio» no cabe entero en
                una cuarta parte de un móvil y se pegaba al título de al lado */}
            {p.titulo.split('/').map((trozo, j) => (
              <React.Fragment key={j}>{j > 0 && <>/<wbr /></>}{trozo}</React.Fragment>
            ))}
          </p>
          <p className="mt-0.5 text-[10.5px] leading-tight text-neutral-500">
            <Detalle p={p} />
          </p>
        </li>
      ))}
    </ol>
  );
}
