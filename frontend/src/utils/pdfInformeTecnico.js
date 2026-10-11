/**
 * utils/pdfInformeTecnico.js
 * PDF del detalle de un técnico en Informes: sus servicios del mes con las
 * horas y lo que no cuadra. Se genera en el navegador con los mismos datos y
 * los mismos textos que la pantalla (utils/informes.js), sin pasar por el
 * backend.
 *
 * jsPDF va con `import()` dinámico: pesa y solo lo necesita quien descarga,
 * así que no entra en el bundle de los técnicos.
 *
 * OJO con los caracteres: las fuentes estándar de jsPDF (Helvetica) solo
 * llevan WinAnsi. Tildes, ñ, «», – y — salen; una flecha o un emoji, no.
 */

import {
  nombreMes, fmtMin, textoAviso, totalesDetalle, tramo, horasDudosas, ROL_SERVICIO,
} from './informes.js';
import { formatDate } from './dateUtils.js';

// Los mismos tonos que la pantalla (bad/warn de Tailwind), en RGB
const ROJO_FONDO  = [254, 242, 242];
const AMBAR_FONDO = [255, 251, 235];
const GRIS_CABECERA = [245, 245, 245];

/** 'Horas_Ana_Ruiz_2026-10.pdf': sin tildes ni signos, que algunos móviles los rompen. */
export function nombreFicheroPdf(detalle) {
  const limpio = String(detalle?.nombre || 'tecnico')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  return `Horas_${limpio || 'tecnico'}_${detalle?.mes || ''}.pdf`;
}

/** Las filas de la tabla del PDF (texto plano) y el nivel de cada una. */
export function filasPdf(servicios = []) {
  return servicios.map(s => ({
    nivel: horasDudosas(s) ? 'grave' : s.avisos?.length ? 'aviso' : null,
    celdas: [
      formatDate(s.fecha_inicio, 'dd/MM HH:mm'),
      [s.trabajo, `${s.alias || ''}${s.matricula ? ` (${s.matricula})` : ''}`].filter(Boolean).join('\n'),
      ROL_SERVICIO[s.rol] || s.rol || '',
      tramo(s.llegada_servicio_at, s.fin_servicio_at),
      fmtMin(s.minutos_en_evento),
      tramo(s.inicio_real_at, s.finalizado_at, { sinHasta: 'sin finalizar' }),
      fmtMin(s.minutos_asignacion),
      (s.avisos || []).map(textoAviso).join('\n'),
    ],
  }));
}

/**
 * Monta el documento. Recibe las dos librerías para poder probarlo sin el
 * import dinámico.
 */
export function construirPdfTecnico(JsPDF, autoTable, detalle, generado = new Date()) {
  const doc = new JsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const ancho = doc.internal.pageSize.getWidth();
  const t = totalesDetalle(detalle.servicios);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(15);
  doc.text(`Horas de ${detalle.nombre}`, 14, 16);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(90);
  const sub = [`Servicios de ${nombreMes(detalle.mes)}`];
  if (detalle.en_curso) sub.push('mes en curso, datos hasta hoy');
  sub.push(`generado el ${formatDate(generado, 'dd/MM/yyyy HH:mm')}`);
  doc.text(sub.join(' · '), 14, 22);

  doc.setTextColor(20);
  doc.setFontSize(10);
  const resumen = [
    `Horas de evento/servicio: ${fmtMin(t.minutos_en_evento)}`,
    `Horas de asignación: ${fmtMin(t.minutos_asignacion)}`,
    `Servicios: ${t.servicios}`,
    `Con horas que no cuadran: ${t.con_horas_dudosas}`,
  ];
  doc.text(resumen.join('     '), 14, 30);

  let y = 35;
  doc.setFontSize(8);
  doc.setTextColor(90);
  const notas = [
    'Solo suma lo cerrado: un servicio sin inicio o sin fin de evento no suma horas de evento, y uno sin finalizar no suma horas de asignación.',
    'En rojo, servicios cuyas horas no suman o no son reales; en ámbar, los que suman pero no cuadran con lo previsto.',
  ];
  if (detalle.archivado) notas.push('Este mes ya está archivado: parte de sus servicios puede haberse purgado y el detalle quedar incompleto.');
  for (const n of notas) {
    const lineas = doc.splitTextToSize(n, ancho - 28);
    doc.text(lineas, 14, y);
    y += 3.6 * lineas.length;
  }

  const filas = filasPdf(detalle.servicios);
  autoTable(doc, {
    startY: y + 1,
    head: [['Fecha prevista', 'Trabajo / ambulancia', 'Rol', 'Evento/servicio', 'Horas evento',
            'Asignación', 'Horas asign.', 'Qué no cuadra']],
    body: filas.map(f => f.celdas),
    foot: [['Total', `${t.servicios} servicios`, '', '', fmtMin(t.minutos_en_evento),
            '', fmtMin(t.minutos_asignacion), `${t.con_horas_dudosas} con horas que no cuadran`]],
    showFoot: 'lastPage',
    rowPageBreak: 'avoid',
    theme: 'grid',
    styles: { font: 'helvetica', fontSize: 8, cellPadding: 1.6, valign: 'top', lineColor: [220, 220, 220], textColor: 20 },
    headStyles: { fillColor: GRIS_CABECERA, textColor: 60, fontStyle: 'bold' },
    footStyles: { fillColor: GRIS_CABECERA, textColor: 20, fontStyle: 'bold' },
    columnStyles: {
      0: { cellWidth: 22 },
      1: { cellWidth: 52 },
      2: { cellWidth: 20 },
      3: { cellWidth: 28 },
      4: { cellWidth: 20, halign: 'right' },
      5: { cellWidth: 28 },
      6: { cellWidth: 20, halign: 'right' },
    },
    didParseCell: (data) => {
      if (data.section === 'foot' && (data.column.index === 4 || data.column.index === 6)) data.cell.styles.halign = 'right';
      if (data.section !== 'body') return;
      const nivel = filas[data.row.index]?.nivel;
      if (nivel) data.cell.styles.fillColor = nivel === 'grave' ? ROJO_FONDO : AMBAR_FONDO;
      if (nivel === 'grave' && data.column.index === 7) data.cell.styles.textColor = [185, 28, 28];
    },
    didDrawPage: () => {
      const n = doc.internal.getNumberOfPages();
      doc.setFontSize(8);
      doc.setTextColor(140);
      doc.text(`${detalle.nombre} · ${nombreMes(detalle.mes)} · página ${n}`, 14, doc.internal.pageSize.getHeight() - 8);
    },
  });

  if (!filas.length) {
    doc.setFontSize(10);
    doc.setTextColor(90);
    doc.text('No tuvo servicios este mes.', 14, doc.lastAutoTable.finalY + 8);
  }
  return doc;
}

/** Genera el PDF y lo descarga. */
export async function descargarPdfTecnico(detalle) {
  const [{ jsPDF }, { autoTable }] = await Promise.all([import('jspdf'), import('jspdf-autotable')]);
  construirPdfTecnico(jsPDF, autoTable, detalle).save(nombreFicheroPdf(detalle));
}
