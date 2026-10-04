/**
 * pages/informes/Informes.jsx
 *
 * Informe mensual para administración (admin y superadmin): puntualidad,
 * incidencias, calidad del registro, flota y desglose por técnico. Cada cifra
 * del resumen se compara con el mes anterior y con el mismo mes del año pasado.
 *
 * Los datos salen de GET /informes/mensual; un mes ya purgado por la retención
 * llega archivado (`fuente: 'archivado'`) y se pinta igual. Un campo que no
 * exista en un informe viejo sale como «—» (utils/informes.js).
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { informesService } from '../../services/informes.service.js';
import { useNotification } from '../../context/NotificationContext.jsx';
import { PageLoading }     from '../../components/common/LoadingSpinner.jsx';
import {
  nombreMes, pct, por100, valorMetrica, variacion, fmt, fmtMin,
} from '../../utils/informes.js';

/** Mes en curso en hora española, 'YYYY-MM'. */
function mesActual() {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit' })
    .formatToParts(new Date());
  const get = (t) => p.find(x => x.type === t).value;
  return `${get('year')}-${get('month')}`;
}

const COLOR_SENTIDO = { mejor: 'text-ok-700', peor: 'text-bad-600', igual: 'text-neutral-400' };

function Variacion({ etiqueta, v }) {
  return (
    <span className="whitespace-nowrap">
      <span className="text-neutral-400">{etiqueta} </span>
      {v
        ? <span className={`font-mono ${COLOR_SENTIDO[v.sentido]}`}>{v.texto}</span>
        : <span className="text-neutral-400">—</span>}
    </span>
  );
}

/** Una cifra del resumen con su comparativa. */
function Kpi({ titulo, valor, detalle, clave, datos }) {
  const { actual, anterior, anioAnterior } = datos;
  return (
    <div className="card p-3 sm:p-4 space-y-1">
      <div className="text-xs font-medium text-neutral-500">{titulo}</div>
      <div className="text-2xl font-semibold font-mono text-neutral-900 leading-tight">{valor}</div>
      {detalle && <div className="text-xs text-neutral-500">{detalle}</div>}
      {clave && (
        <div className="flex flex-wrap gap-x-3 text-xs pt-1">
          <Variacion etiqueta="vs mes ant." v={variacion(clave, actual, anterior)} />
          <Variacion etiqueta="vs año ant." v={variacion(clave, actual, anioAnterior)} />
        </div>
      )}
    </div>
  );
}

function Seccion({ titulo, nota, children }) {
  return (
    <section className="space-y-2">
      <div>
        <h2 className="text-[15px] font-semibold text-neutral-900">{titulo}</h2>
        {nota && <p className="text-xs text-neutral-500">{nota}</p>}
      </div>
      {children}
    </section>
  );
}

/** Tabla con scroll horizontal propio: la página nunca se desborda en móvil. */
function Tabla({ columnas, filas, vacio, pie }) {
  if (!filas.length) return <div className="card text-sm text-neutral-500">{vacio}</div>;
  return (
    <div className="card p-0 overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-neutral-50 text-neutral-600 text-xs uppercase">
            <tr>
              {columnas.map(c => (
                <th key={c.clave} className={`px-3 py-2.5 whitespace-nowrap ${c.num ? 'text-right' : 'text-left'}`}>
                  {c.titulo}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100">
            {filas.map(f => (
              <tr key={f.key}>
                {columnas.map(c => (
                  <td key={c.clave} className={`px-3 py-2.5 ${c.num ? 'text-right font-mono whitespace-nowrap' : ''}`}>
                    {c.pintar(f)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
          {pie && (
            <tfoot className="bg-neutral-50 border-t border-neutral-200 font-semibold text-neutral-900">
              <tr>
                {columnas.map(c => (
                  <td key={c.clave} className={`px-3 py-2.5 ${c.num ? 'text-right font-mono whitespace-nowrap' : ''}`}>
                    {c.total ? c.total(pie) : c.clave === columnas[0].clave ? 'Total' : ''}
                  </td>
                ))}
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}

const colTecnico = { clave: 'n', titulo: 'Técnico', pintar: t => <span className="font-medium text-neutral-900">{t.nombre}</span> };

/** Suma un campo de todas las filas; «—» si ninguna lo trae (archivado viejo). */
const suma = (campo) => (filas) => {
  const vals = filas.map(f => f[campo]).filter(v => v != null);
  return vals.length ? vals.reduce((a, b) => a + b, 0) : null;
};

/**
 * Pestañas de «Por técnico». Las dos primeras son para fiscalizar la carga de
 * trabajo: el sumatorio de horas del mes de cada técnico, de mayor a menor y
 * con fila de total. Suman todos sus servicios, vaya de responsable o de
 * personal, y solo lo cerrado (lo que sigue abierto sale en su columna). La
 * puntualidad va aparte y es solo de responsable. Los campos de tiempo nacen
 * en VERSION_INFORME 2: en un archivado anterior salen «—».
 */
const PESTANAS_TECNICO = [
  {
    key: 'asignacion',
    label: 'Horas de asignación',
    nota: 'Suma del tiempo entre «Inicio de la asignación» y «Finalizar asignación» de todas sus asignaciones del mes, de responsable o de personal. Una asignación que no se ha finalizado no suma: sale en la última columna.',
    orden: 'minutos_asignacion',
    columnas: [
      colTecnico,
      { clave: 'tt', titulo: 'Horas con asignación activa', num: true,
        pintar: t => fmtMin(t.minutos_asignacion), total: f => fmtMin(suma('minutos_asignacion')(f)) },
      { clave: 'tm', titulo: 'Asignaciones finalizadas', num: true,
        pintar: t => fmt(t.asignaciones_medidas), total: f => fmt(suma('asignaciones_medidas')(f)) },
      { clave: 'ts', titulo: 'Iniciadas sin finalizar', num: true,
        pintar: t => fmt(t.asignaciones_sin_finalizar), total: f => fmt(suma('asignaciones_sin_finalizar')(f)) },
    ],
  },
  {
    key: 'evento',
    label: 'Horas de evento/servicio',
    nota: 'Suma del tiempo entre «Inicio evento/servicio» y «Fin evento/servicio» de todos sus servicios del mes, de responsable o de personal. Si falta alguno de los dos botones ese servicio no suma; los que tienen inicio y no fin salen en la última columna.',
    orden: 'minutos_en_evento',
    columnas: [
      colTecnico,
      { clave: 'et', titulo: 'Horas con evento/servicio activo', num: true,
        pintar: t => fmtMin(t.minutos_en_evento), total: f => fmtMin(suma('minutos_en_evento')(f)) },
      { clave: 'em', titulo: 'Eventos/servicios completos', num: true,
        pintar: t => fmt(t.eventos_medidos), total: f => fmt(suma('eventos_medidos')(f)) },
      { clave: 'es', titulo: 'Con inicio y sin fin', num: true,
        pintar: t => fmt(t.eventos_sin_fin), total: f => fmt(suma('eventos_sin_fin')(f)) },
    ],
  },
  {
    key: 'puntualidad',
    label: 'Puntualidad',
    nota: 'Solo las asignaciones que lleva de responsable (el personal no inicia ni cierra). Si hay varios responsables, el retraso cuenta para todos.',
    columnas: [
      colTecnico,
      { clave: 's',  titulo: 'De responsable', num: true, pintar: t => fmt(t.servicios) },
      { clave: 'p',  titulo: 'De personal', num: true, pintar: t => fmt(t.como_personal) },
      { clave: 't',  titulo: 'Inicios tardíos', num: true, pintar: t => conPct(t.inicios_tardios, t.iniciados) },
      { clave: 'x',  titulo: 'Sin iniciar', num: true, pintar: t => fmt(t.sin_iniciar) },
      { clave: 'ct', titulo: 'Cierres tardíos', num: true, pintar: t => conPct(t.cierres_tardios, t.finalizados) },
      { clave: 'ca', titulo: 'Cierres anticipados', num: true, pintar: t => conPct(t.cierres_anticipados, t.finalizados) },
      { clave: 'l',  titulo: 'Con inicio ev./serv.', num: true, pintar: t => conPct(t.con_llegada, t.iniciados) },
      { clave: 'f',  titulo: 'Fotos tarde', num: true, pintar: t => fmt(t.con_fotos_inicio_tarde) },
      { clave: 'i',  titulo: 'Incidencias', num: true, pintar: t => fmt(t.incidencias) },
    ],
  },
];

/** «3 (12,5 %)» o «—» si no hay denominador. */
function conPct(n, total) {
  const p = pct(n, total);
  return p == null ? fmt(n) : `${fmt(n)} (${fmt(p)} %)`;
}

export default function Informes() {
  const { notify } = useNotification();
  const maxMes = useMemo(mesActual, []);
  const [mes, setMes]         = useState(maxMes);
  const [datos, setDatos]     = useState(null);
  const [loading, setLoading] = useState(true);
  const [tabTecnico, setTabTecnico] = useState(PESTANAS_TECNICO[0].key);
  const pestanaTec = PESTANAS_TECNICO.find(p => p.key === tabTecnico);

  const cargar = useCallback(async () => {
    setLoading(true);
    try {
      setDatos(await informesService.getMensual(mes));
    } catch {
      setDatos(null);
      notify.error('No se pudo cargar el informe');
    } finally {
      setLoading(false);
    }
  }, [mes, notify]);

  useEffect(() => { cargar(); }, [cargar]);

  const actual = datos?.actual;
  const r = actual?.resumen;
  const cmp = {
    actual: r,
    anterior: datos?.comparativa?.anterior?.resumen,
    anioAnterior: datos?.comparativa?.anio_anterior?.resumen,
  };
  const umbral = actual?.umbral_min ?? 30;
  // En las pestañas de horas, de más carga a menos; en puntualidad, el orden del backend.
  const filasTecnico = (actual?.por_tecnico || []).map(t => ({ ...t, key: t.user_id }));
  if (pestanaTec.orden) filasTecnico.sort((a, b) => (b[pestanaTec.orden] ?? -1) - (a[pestanaTec.orden] ?? -1));
  const inc = r?.incidencias || {};

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex flex-col sm:flex-row sm:items-end gap-3">
        <div className="flex-1 min-w-0">
          <h1 className="text-[19px] font-semibold text-neutral-900">Informes</h1>
          <p className="text-neutral-500 text-sm">
            {actual ? <>Informe de {nombreMes(actual.mes)}</> : 'Informe mensual'}
            {actual?.en_curso && <span className="text-warn-700"> · mes en curso, datos hasta hoy</span>}
            {actual?.fuente === 'archivado' && <span className="text-neutral-400"> · archivado</span>}
            {r && <span className="text-neutral-400"> · {fmt(r.servicios)} servicios</span>}
          </p>
        </div>
        <label className="flex items-center gap-2 text-sm text-neutral-600">
          Mes
          <input
            type="month"
            className="input py-1.5 text-sm w-auto"
            value={mes}
            max={maxMes}
            onChange={e => e.target.value && setMes(e.target.value)}
            aria-label="Mes del informe"
          />
        </label>
      </div>

      {loading ? <PageLoading /> : !r ? (
        <div className="empty">
          <p className="empty-title">Sin informe</p>
          <p className="empty-hint">No se ha podido obtener el informe de este mes</p>
        </div>
      ) : (
        <>
          <Seccion
            titulo="Puntualidad"
            nota={`Tarde = «Inicio de la asignación» más de ${umbral} min después de la hora prevista. Los cierres, frente a la hora de fin prevista con el mismo margen.`}
          >
            <div className="grid grid-cols-2 lg:grid-cols-3 gap-2 sm:gap-3">
              <Kpi titulo="Inicios tardíos" clave="inicios_tardios" datos={cmp}
                valor={fmt(valorMetrica('inicios_tardios', r), ' %')}
                detalle={`${fmt(r.inicios_tardios)} de ${fmt(r.iniciados)} iniciados`} />
              <Kpi titulo="Retraso típico (mediana)" clave="retraso_mediana" datos={cmp}
                valor={fmtMin(r.retraso_mediana_min)}
                detalle={r.retraso_medio_min != null ? `media ${fmtMin(r.retraso_medio_min)}, solo los tardíos` : 'solo los tardíos'} />
              <Kpi titulo="Sin iniciar" clave="sin_iniciar" datos={cmp}
                valor={fmt(r.sin_iniciar)}
                detalle="nadie pulsó «Inicio de la asignación»" />
              <Kpi titulo="Desplazamiento (mediana)" clave="desplazamiento" datos={cmp}
                valor={fmtMin(r.desplazamiento_mediana_min)}
                detalle="de inicio de la asignación a inicio del evento/servicio" />
              <Kpi titulo="Cierres tardíos" clave="cierres_tardios" datos={cmp}
                valor={fmt(valorMetrica('cierres_tardios', r), ' %')}
                detalle={`${fmt(r.cierres_tardios)} de ${fmt(r.finalizados)} finalizados`} />
              <Kpi titulo="Cierres anticipados" clave="cierres_anticipados" datos={cmp}
                valor={fmt(valorMetrica('cierres_anticipados', r), ' %')}
                detalle={`${fmt(r.cierres_anticipados)} de ${fmt(r.finalizados)} finalizados`} />
            </div>
          </Seccion>

          <Seccion titulo="Incidencias">
            <div className="grid grid-cols-2 lg:grid-cols-3 gap-2 sm:gap-3">
              <Kpi titulo="Nuevas" clave="inc_nuevas" datos={cmp} valor={fmt(inc.nuevas)}
                detalle={`${fmt(inc.graves)} graves · ${fmt(inc.moderadas)} moderadas · ${fmt(inc.leves)} leves`} />
              <Kpi titulo="Por cada 100 servicios" clave="inc_por100" datos={cmp}
                valor={fmt(por100(inc.nuevas, r.servicios))} />
              <Kpi titulo="Graves" clave="inc_graves" datos={cmp} valor={fmt(inc.graves)} />
              <Kpi titulo="Abiertas al cierre del mes" clave="inc_abiertas" datos={cmp} valor={fmt(inc.abiertas_fin)} />
              <Kpi titulo="Resueltas en el mes" valor={fmt(inc.resueltas)} datos={cmp} />
              <Kpi titulo="Tiempo de resolución (mediana)" clave="inc_resolucion" datos={cmp}
                valor={fmt(inc.resolucion_mediana_horas, ' h')} />
            </div>
          </Seccion>

          <Seccion
            titulo="Calidad del registro"
            nota="Si la app se usa como debe. El inicio del evento/servicio se registra desde el 25/09/2026: antes sale baja porque no existía."
          >
            <div className="grid grid-cols-2 gap-2 sm:gap-3">
              <Kpi titulo="Con inicio evento/servicio" clave="con_llegada" datos={cmp}
                valor={fmt(valorMetrica('con_llegada', r), ' %')}
                detalle={`${fmt(r.con_llegada)} de ${fmt(r.iniciados)} iniciados`} />
              <Kpi titulo="Con fotos de inicio tardías" clave="fotos_tarde" datos={cmp}
                valor={fmt(valorMetrica('fotos_tarde', r), ' %')}
                detalle={`${fmt(r.con_fotos_inicio_tarde)} servicios`} />
            </div>
          </Seccion>

          <Seccion
            titulo="Flota"
            nota={`${fmt(r.vehiculos_usados)} de ${fmt(r.vehiculos_en_flota)} ambulancias con servicio este mes.`}
          >
            <Tabla
              vacio="Ningún vehículo con servicios ni incidencias este mes."
              filas={(actual.por_vehiculo || []).map(v => ({ ...v, key: v.vehicle_id }))}
              columnas={[
                { clave: 'v', titulo: 'Vehículo', pintar: v => (
                  <Link to={`/vehiculos/${v.vehicle_id}`} className="hover:underline">
                    <div className="font-medium text-neutral-900">{v.alias}</div>
                    <div className="text-xs text-neutral-500 font-mono">{v.matricula}</div>
                  </Link>
                ) },
                { clave: 's', titulo: 'Servicios', num: true, pintar: v => fmt(v.servicios) },
                { clave: 'h', titulo: 'Horas', num: true, pintar: v => fmt(v.horas_servicio) },
                { clave: 't', titulo: 'Inicios tardíos', num: true, pintar: v => conPct(v.inicios_tardios, v.iniciados) },
                { clave: 'i', titulo: 'Incidencias', num: true, pintar: v => fmt(v.incidencias) },
              ]}
            />
            {actual.vehiculos_sin_uso?.length > 0 && (
              <p className="text-xs text-neutral-500">
                Sin servicio: {actual.vehiculos_sin_uso.map(v => v.alias).join(', ')}
              </p>
            )}
          </Seccion>

          <Seccion
            titulo="Por técnico"
          >
            <div className="tabs" role="tablist" aria-label="Tramo del servicio">
              {PESTANAS_TECNICO.map(p => (
                <button
                  key={p.key}
                  type="button"
                  role="tab"
                  aria-selected={tabTecnico === p.key}
                  onClick={() => setTabTecnico(p.key)}
                  className={tabTecnico === p.key ? 'tab-active' : 'tab'}
                >
                  {p.label}
                </button>
              ))}
            </div>
            <p className="text-xs text-neutral-500">{pestanaTec.nota}</p>
            <Tabla
              vacio="Nadie tuvo servicios este mes."
              filas={filasTecnico}
              columnas={pestanaTec.columnas}
              pie={pestanaTec.orden ? filasTecnico : null}
            />
          </Seccion>
        </>
      )}
    </div>
  );
}
