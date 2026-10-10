import React, { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { trabajosService } from '../services/trabajos.service.js';
import { useNotification } from '../context/NotificationContext.jsx';
import { EstadoBadge } from '../components/common/StatusBadge.jsx';
import { PageLoading } from '../components/common/LoadingSpinner.jsx';
import CalendarioPersonal from '../components/calendar/CalendarioPersonal.jsx';
import { formatDateTime, formatDateTimeShort, diaEnEspana } from '../utils/dateUtils.js';
import { textoEstadoAmbulancia } from '../utils/trabajos.js';
import { diaInicial } from '../utils/calendario.js';
import { getItem, setItem } from '../utils/sessionStorage.js';

/**
 * «Mis trabajos»: la portada del técnico (D7 del plan del trabajo padre).
 *
 * Una tarjeta por trabajo que coordina, en cuyo equipo está o en el que va en
 * alguna ambulancia:
 * hoy arriba, los próximos debajo. La tarjeta NO ejecuta nada: su único botón
 * es «Ver trabajo», y las acciones (inicio, fotos, llegada, cierre) están
 * dentro, en «Tu ambulancia». Con su ambulancia finalizada la tarjeta sigue
 * hasta que el coordinador cierra el trabajo (D11): lo decide el backend, que
 * filtra por el estado del trabajo.
 *
 * «Calendario» (2026-10-11) es la otra forma de verlo, para quien la quiera:
 * lo suyo del mes, también lo ya cerrado. Qué vista y qué día van en la URL
 * (`?vista=calendario&dia=…`) para que «‹» desde la ficha de un trabajo vuelva
 * al mismo sitio; la vista elegida se recuerda además en este dispositivo
 * (`VISTA_GUARDADA`, se borra al cerrar sesión con el resto de claves).
 */

const VISTA_GUARDADA = 'vistaMisTrabajos';

// Lo que está en marcha o empieza hoy (calendario español) va en «Hoy»
const esDeHoy = (t, hoy) => t.estado !== 'programado' || diaEnEspana(t.fecha_inicio) <= hoy;

function TarjetaTrabajo({ t, onVer }) {
  const mia = t.mi_asignacion;
  return (
    <div className="card pl-5 space-y-2.5" data-testid="tarjeta-trabajo">
      <span className={t.estado === 'programado' ? 'stripe-programada' : 'stripe-activa'} />
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-semibold text-neutral-900">{t.nombre}</p>
          <p className="text-xs text-neutral-500 data">
            {formatDateTime(t.fecha_inicio)} → {formatDateTimeShort(t.fecha_fin)}
          </p>
          {t.ubicacion && <p className="text-xs text-neutral-600 mt-0.5">{t.ubicacion}</p>}
        </div>
        <EstadoBadge estado={t.estado} />
      </div>

      {mia ? (
        <div className="text-sm space-y-0.5">
          <p>
            <span className="text-neutral-500">Tu ambulancia: </span>
            <strong className="text-neutral-900">{mia.vehiculo_alias || mia.matricula}</strong>
            <span className="text-neutral-600"> · {textoEstadoAmbulancia(mia)}</span>
          </p>
          {mia.mi_rol === 'equipo' && (
            <p className="text-xs text-neutral-500">
              Vas en el equipo. Lo lleva {mia.responsables_nombres || 'su responsable'}.
            </p>
          )}
        </div>
      ) : t.mis_vehiculos_v25 ? (
        // Trabajo del modelo anterior (convive hasta la fase 6): sus
        // vehículos se inician y se cierran dentro, en la ficha
        <p className="text-sm">
          <span className="text-neutral-500">
            {t.mis_vehiculos_v25.includes(',') ? 'Tus vehículos: ' : 'Tu vehículo: '}
          </span>
          <strong className="text-neutral-900">{t.mis_vehiculos_v25}</strong>
          <span className="text-neutral-600"> · pendiente de cerrar</span>
        </p>
      ) : t.soy_coordinador ? (
        <p className="text-sm text-neutral-600">
          Coordinas este trabajo{t.estado === 'pendiente_cierre' ? ': todas han terminado, falta que lo cierres' : ''}.
        </p>
      ) : t.en_equipo ? (
        // En el equipo del trabajo, todavía (o nunca) en una ambulancia
        <p className="text-sm text-neutral-600">Estás en el equipo de este trabajo.</p>
      ) : null}

      <button onClick={onVer} className="btn-primary w-full sm:w-auto">Ver trabajo</button>
    </div>
  );
}

function ListaMisTrabajos({ onVer }) {
  const { notify } = useNotification();
  const [trabajos, setTrabajos] = useState([]);
  const [loading,  setLoading]  = useState(true);

  useEffect(() => {
    trabajosService.misTrab({ limit: 50 })
      .then(r => setTrabajos(r.data || []))
      .catch(() => notify.error('Error al cargar tus trabajos'))
      .finally(() => setLoading(false));
  }, []);

  const hoy      = diaEnEspana(new Date());
  const deHoy    = trabajos.filter(t => esDeHoy(t, hoy));
  const proximos = trabajos.filter(t => !esDeHoy(t, hoy));

  if (loading) return <PageLoading />;
  if (trabajos.length === 0) {
    return (
      <div className="empty">
        <p className="empty-title">No tienes trabajos</p>
        <p className="empty-hint">Aquí aparecerán los trabajos en los que te pongan</p>
      </div>
    );
  }
  return (
    <>
      {deHoy.length > 0 && (
        <section className="space-y-3">
          <p className="micro">Hoy</p>
          {deHoy.map(t => <TarjetaTrabajo key={t.id} t={t} onVer={() => onVer(t.id)} />)}
        </section>
      )}
      {proximos.length > 0 && (
        <section className="space-y-3">
          <p className="micro">Próximos</p>
          {proximos.map(t => <TarjetaTrabajo key={t.id} t={t} onVer={() => onVer(t.id)} />)}
        </section>
      )}
    </>
  );
}

export default function MisTrabajos() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();

  const vistaUrl = params.get('vista');
  const vista = ['lista', 'calendario'].includes(vistaUrl) ? vistaUrl
    : getItem(VISTA_GUARDADA) === 'calendario' ? 'calendario' : 'lista';
  const dia = diaInicial(params.get('dia'));

  // `replace`: cambiar de vista o de día no deja rastro en el historial, así
  // «‹» desde la ficha vuelve aquí y no recorre los días que se miraron
  const cambiarVista = (v) => {
    setItem(VISTA_GUARDADA, v);
    setParams({ vista: v }, { replace: true });
  };
  const cambiarDia = (d) => setParams({ vista: 'calendario', dia: d }, { replace: true });

  const ver = (id, asignacionId) =>
    navigate(`/trabajos/${id}${asignacionId ? `?asignacion=${asignacionId}` : ''}`);

  const pestana = (v, texto, borde) => (
    <button
      onClick={() => cambiarVista(v)}
      aria-pressed={vista === v}
      className={`px-3 h-8 text-[12.5px] font-medium ${borde ? 'border-r border-neutral-200' : ''} ${vista === v ? 'bg-neutral-900 text-white' : 'text-neutral-600 hover:bg-neutral-50'}`}
    >
      {texto}
    </button>
  );

  return (
    <div className="space-y-4 animate-fade-in">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-[19px] font-semibold text-neutral-900">Mis trabajos</h1>
          <p className="text-neutral-500 text-[13px] mt-0.5">Los trabajos en los que vas o que coordinas</p>
        </div>
        <div className="flex shrink-0 rounded-md border border-neutral-200 overflow-hidden bg-white">
          {pestana('lista', 'Lista', true)}
          {pestana('calendario', 'Calendario', false)}
        </div>
      </div>

      {vista === 'calendario' ? (
        <CalendarioPersonal dia={dia} onCambiarDia={cambiarDia}
          onAbrir={(e) => ver(e.trabajo_id, e.asignacion_id)} />
      ) : (
        <ListaMisTrabajos onVer={(id) => ver(id)} />
      )}
    </div>
  );
}
