/**
 * pages/informes/DetalleTecnico.jsx
 *
 * Lo que se abre al pulsar un técnico en «Por técnico»: sus servicios del mes,
 * uno por fila, con las horas de evento/servicio y de asignación y lo que no
 * cuadra (sin iniciar, sin finalizar, sin inicio o sin fin de evento, fin del
 * evento pulsado en base…). Las sumas son las de la tabla del informe.
 * «Descargar PDF» genera lo mismo en el navegador (utils/pdfInformeTecnico.js).
 *
 * Datos: GET /informes/tecnico/:userId?mes (informes.service → detalleTecnico).
 */

import React, { useEffect, useState } from 'react';
import Modal from '../../components/common/Modal.jsx';
import { informesService } from '../../services/informes.service.js';
import { useNotification } from '../../context/NotificationContext.jsx';
import { formatDate } from '../../utils/dateUtils.js';
import {
  nombreMes, fmtMin, textoAviso, totalesDetalle, tramo, horasDudosas, ROL_SERVICIO,
} from '../../utils/informes.js';

const FONDO_FILA = { grave: 'bg-bad-50', aviso: 'bg-warn-50' };
const COLOR_AVISO = { grave: 'text-bad-600', aviso: 'text-warn-700' };

function Cifra({ titulo, valor, alerta }) {
  return (
    <div className="rounded-lg border border-neutral-200 px-3 py-2">
      <div className="text-xs text-neutral-500">{titulo}</div>
      <div className={`text-lg font-semibold font-mono ${alerta ? 'text-bad-600' : 'text-neutral-900'}`}>{valor}</div>
    </div>
  );
}

export default function DetalleTecnico({ userId, mes, nombre, onClose }) {
  const { notify } = useNotification();
  const [detalle, setDetalle] = useState(null);
  const [loading, setLoading] = useState(true);
  const [generando, setGenerando] = useState(false);

  useEffect(() => {
    let vivo = true;
    setLoading(true);
    setDetalle(null);
    informesService.getDetalleTecnico(userId, mes)
      .then(d => { if (vivo) setDetalle(d); })
      .catch(() => { if (vivo) notify.error('No se pudo cargar el detalle del técnico'); })
      .finally(() => { if (vivo) setLoading(false); });
    return () => { vivo = false; };
  }, [userId, mes, notify]);

  const descargar = async () => {
    setGenerando(true);
    try {
      const { descargarPdfTecnico } = await import('../../utils/pdfInformeTecnico.js');
      await descargarPdfTecnico(detalle);
    } catch {
      notify.error('No se pudo generar el PDF. Recarga la página e inténtalo de nuevo.');
    } finally {
      setGenerando(false);
    }
  };

  const servicios = detalle?.servicios || [];
  const t = totalesDetalle(servicios);

  return (
    <Modal
      isOpen
      onClose={onClose}
      size="full"
      title={`Horas de ${detalle?.nombre || nombre || 'técnico'}`}
      footer={(
        <>
          <button type="button" className="btn-secondary" onClick={onClose}>Cerrar</button>
          <button type="button" className="btn-primary" onClick={descargar}
            disabled={!detalle || generando}>
            {generando ? 'Generando…' : 'Descargar PDF'}
          </button>
        </>
      )}
    >
      {loading ? (
        <p className="text-sm text-neutral-500 py-6 text-center">Cargando servicios…</p>
      ) : !detalle ? (
        <p className="text-sm text-neutral-500 py-6 text-center">No se ha podido obtener el detalle.</p>
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-neutral-500">
            Servicios de {nombreMes(detalle.mes)}
            {detalle.en_curso && <span className="text-warn-700"> · mes en curso, datos hasta hoy</span>}
          </p>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <Cifra titulo="Horas de evento/servicio" valor={fmtMin(t.minutos_en_evento)} />
            <Cifra titulo="Horas de asignación" valor={fmtMin(t.minutos_asignacion)} />
            <Cifra titulo="Servicios" valor={t.servicios} />
            <Cifra titulo="En rojo: horas que no valen" valor={t.con_horas_dudosas} alerta={t.con_horas_dudosas > 0} />
          </div>

          <p className="text-xs text-neutral-500">
            Solo suma lo cerrado. <span className="text-bad-600 font-medium">En rojo</span>, servicios cuyas horas
            no suman o no son reales; <span className="text-warn-700 font-medium">en ámbar</span>, los que suman
            pero no cuadran con lo previsto.
            {detalle.archivado && ' Este mes ya está archivado: parte de sus servicios puede haberse purgado y el detalle quedar incompleto.'}
          </p>

          {!servicios.length ? (
            <div className="card text-sm text-neutral-500">No tuvo servicios este mes.</div>
          ) : (
            <div className="border border-neutral-200 rounded-lg overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-neutral-50 text-neutral-600 text-xs uppercase">
                  <tr>
                    <th className="px-3 py-2 text-left whitespace-nowrap">Fecha prevista</th>
                    <th className="px-3 py-2 text-left">Trabajo / ambulancia</th>
                    <th className="px-3 py-2 text-left whitespace-nowrap">Evento/servicio</th>
                    <th className="px-3 py-2 text-right whitespace-nowrap">Horas evento</th>
                    <th className="px-3 py-2 text-left">Asignación</th>
                    <th className="px-3 py-2 text-right whitespace-nowrap">Horas asign.</th>
                    <th className="px-3 py-2 text-left whitespace-nowrap">Qué no cuadra</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100">
                  {servicios.map(s => {
                    const nivel = horasDudosas(s) ? 'grave' : s.avisos?.length ? 'aviso' : null;
                    return (
                      <tr key={s.asignacion_id} className={nivel ? FONDO_FILA[nivel] : ''}>
                        <td className="px-3 py-2 font-mono whitespace-nowrap align-top">{formatDate(s.fecha_inicio, 'dd/MM HH:mm')}</td>
                        <td className="px-3 py-2 align-top min-w-[11rem]">
                          {s.trabajo && <div className="text-neutral-900">{s.trabajo}</div>}
                          <div className={`whitespace-nowrap ${s.trabajo ? 'text-xs text-neutral-500' : 'text-neutral-900'}`}>
                            {s.alias}{s.matricula && <span className="font-mono"> · {s.matricula}</span>}
                          </div>
                          <div className="text-xs text-neutral-400">{ROL_SERVICIO[s.rol] || s.rol}</div>
                        </td>
                        <td className="px-3 py-2 font-mono whitespace-nowrap align-top">{tramo(s.llegada_servicio_at, s.fin_servicio_at)}</td>
                        <td className="px-3 py-2 font-mono whitespace-nowrap text-right align-top">{fmtMin(s.minutos_en_evento)}</td>
                        <td className="px-3 py-2 font-mono whitespace-nowrap align-top">
                          {tramo(s.inicio_real_at, s.finalizado_at, { sinHasta: 'sin finalizar' })}
                        </td>
                        <td className="px-3 py-2 font-mono whitespace-nowrap text-right align-top">{fmtMin(s.minutos_asignacion)}</td>
                        <td className="px-3 py-2 align-top min-w-[13rem]">
                          {(s.avisos || []).map(a => (
                            <div key={a.codigo} className={`text-xs ${COLOR_AVISO[a.nivel] || 'text-neutral-600'}`}>
                              {textoAviso(a)}
                            </div>
                          ))}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot className="bg-neutral-50 border-t border-neutral-200 font-semibold text-neutral-900">
                  <tr>
                    <td className="px-3 py-2">Total</td>
                    <td className="px-3 py-2">{t.servicios} {t.servicios === 1 ? 'servicio' : 'servicios'}</td>
                    <td />
                    <td className="px-3 py-2 font-mono whitespace-nowrap text-right">{fmtMin(t.minutos_en_evento)}</td>
                    <td />
                    <td className="px-3 py-2 font-mono whitespace-nowrap text-right">{fmtMin(t.minutos_asignacion)}</td>
                    <td />
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
