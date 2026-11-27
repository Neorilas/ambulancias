import React, { useState, useMemo, useEffect } from 'react';
import { asignacionesService } from '../../services/asignaciones.service.js';
import { useNotification } from '../../context/NotificationContext.jsx';
import CameraCapture from '../../components/camera/CameraCapture.jsx';
import { formatDateTime, inicioServicioPermitidoDesde, esProntoParaIniciar } from '../../utils/dateUtils.js';
import useAhora from '../../hooks/useAhora.js';
import {
  IMAGEN_TIPOS_INICIO,
  IMAGEN_TIPOS_INICIO_MECANICA,
  IMAGEN_TIPOS_INICIO_EXTERIOR,
} from '../../utils/constants.js';
import { esFalloDeRed, mensajeFalloSubida, DURACION_AVISO_FALLO_SUBIDA_MS } from '../../utils/subidaFotos.js';
import { getImageUrl } from '../../utils/imageUtils.js';

/**
 * Wizard de INICIO de la asignación — revisión del vehículo antes de arrancar.
 *
 * Está construido sobre una lista de SECCIONES configurable, para poder
 * añadir en el futuro nuevas secciones tipo menú ("material", etc.) sin
 * reescribir el flujo: basta con añadir una entrada a `secciones`.
 *
 * Secciones actuales:
 *   1. inicio    — botón "Inicio de la asignación" (registra la hora real / activa)
 *   2. photos    — Revisión mecánica (aceite, líquidos, cuadro) → «Guardar»
 *   3. photos    — Estado exterior (4 caras, orden libre)
 *   4. incidencias — fotos opcionales + observaciones / "No hay incidencias"
 *
 * DOS TANDAS (2026-11-27). Las tres de mecánica se hacen con la ambulancia
 * dentro; para la carrocería hay que sacarla, y entre medias el móvil se
 * bloquea. Con todo en memoria hasta el final, a muchos se les caía la subida
 * o perdían las fotos. Ahora la mecánica se SUBE con «Guardar» y sale una
 * pausa («saca la ambulancia…»); si se cierra o se recarga, el asistente
 * vuelve a abrirse por la carrocería: lo que ya está en el servidor
 * (`asignacion.evidencias`) cuenta como hecho y no se pide otra vez.
 *
 * Al terminar sube las fotos de inicio que falten (momento='inicio'), las de
 * incidencia (momento='general') y registra la incidencia si se ha reportado.
 *
 * Props: asignacion (con `evidencias`), onDone(), onCancel()
 */

// ── Definición de secciones (extensible) ─────────────────────────────────
const SECCIONES = [
  { id: 'inicio',      tipo: 'inicio',      titulo: 'Inicio de la asignación' },
  { id: 'mecanica',    tipo: 'photos',      titulo: 'Revisión mecánica',
    subtitulo: 'Aceite, líquidos y cuadro de instrumentos', fotos: IMAGEN_TIPOS_INICIO_MECANICA,
    guardar: true },
  { id: 'exterior',    tipo: 'photos',      titulo: 'Estado exterior',
    subtitulo: 'Las cuatro caras del vehículo (orden libre)', fotos: IMAGEN_TIPOS_INICIO_EXTERIOR },
  { id: 'incidencias', tipo: 'incidencias', titulo: 'Incidencias' },
];

// Las fotos de inicio que ya están en el servidor, por tipo: { tipo: url }
function fotosInicioEnServidor(asignacion) {
  const map = {};
  for (const e of asignacion?.evidencias || []) {
    if (e.momento === 'inicio' && e.tipo_imagen) map[e.tipo_imagen] = getImageUrl(e.image_url);
  }
  return map;
}

// Por dónde se abre: sin pulsar el inicio, por el botón; pulsado, por la
// primera sección de fotos a la que le falte alguna (la carrocería, si la
// mecánica ya se guardó); con todas, por las incidencias.
function pasoInicial(activado, enServidor) {
  if (!activado) return 0;
  const i = SECCIONES.findIndex(s => s.tipo === 'photos' && s.fotos.some(t => !enServidor[t.key]));
  return i === -1 ? SECCIONES.length - 1 : i;
}

export default function InicioAsignacion({ asignacion, onDone, onCancel }) {
  const { notify } = useNotification();

  const activadoAlAbrir = asignacion?.estado === 'activa' && !!asignacion?.inicio_real_at;
  // Lo que ya estaba subido al abrir. No se actualiza con lo que se sube aquí:
  // eso lo lleva `subidas`, que guarda el File para saber si se repitió.
  const [enServidor] = useState(() => fotosInicioEnServidor(asignacion));
  const [step,   setStep]   = useState(() => pasoInicial(activadoAlAbrir, enServidor));
  // Pausa entre la mecánica y la carrocería, tras guardar la primera tanda
  const [pausa,  setPausa]  = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [fotos,  setFotos]  = useState({});          // { tipoKey: File } (inicio)
  const [incFotos,  setIncFotos]  = useState([]);    // File[] (incidencia)
  const [hayInc,    setHayInc]    = useState(false); // ¿reportar incidencia?
  const [observ,    setObserv]    = useState('');
  const [activando, setActivando] = useState(false);
  const [activado,  setActivado]  = useState(activadoAlAbrir);
  const [uploading, setUploading] = useState(false);
  const [progress,  setProgress]  = useState({});
  // Fotos que ya están en el servidor. Si el envío se corta a mitad (red mala,
  // 429), el reintento sube sólo lo que falta en vez de repetir las siete.
  // Se guarda el propio File, no un booleano: si el técnico repite una foto el
  // File es otro y vuelve a subirse, en vez de darse por hecha la anterior.
  const [subidas,   setSubidas]   = useState(() => ({ inicio: {}, incidencia: new Set() }));

  // Cámara
  const [showCamera,  setShowCamera]  = useState(false);
  const [camTipos,    setCamTipos]    = useState([]);
  const [camIndex,    setCamIndex]    = useState(0);
  const [camTarget,   setCamTarget]   = useState('inicio'); // 'inicio' | 'incidencia'

  // No se puede iniciar antes de media hora de la hora prevista (lo corta el
  // backend; aquí solo se explica y se deshabilita). El reloj refresca solo.
  const ahora     = useAhora();
  const esPronto  = !activado && esProntoParaIniciar(asignacion?.fecha_inicio, ahora);

  const seccion = SECCIONES[step];
  const esUltima = step === SECCIONES.length - 1;

  // Previews de fotos de inicio
  const previews = useMemo(() => {
    const map = {};
    for (const [k, f] of Object.entries(fotos)) if (f) map[k] = URL.createObjectURL(f);
    return map;
  }, [fotos]);
  useEffect(() => () => Object.values(previews).forEach(URL.revokeObjectURL), [previews]);

  // Previews de fotos de incidencia
  const incPreviews = useMemo(() => incFotos.map(f => URL.createObjectURL(f)), [incFotos]);
  useEffect(() => () => incPreviews.forEach(URL.revokeObjectURL), [incPreviews]);

  // ── Cámara ──────────────────────────────────────────────────
  const openCamera = (tipos, index, target) => {
    setCamTipos(tipos); setCamIndex(index); setCamTarget(target); setShowCamera(true);
  };
  const handleCameraComplete = (captures) => {
    setShowCamera(false);
    if (camTarget === 'incidencia') {
      setIncFotos(prev => [...prev, ...captures.map(c => c.file)]);
    } else {
      setFotos(prev => {
        const next = { ...prev };
        captures.forEach(c => { next[c.tipo] = c.file; });
        return next;
      });
    }
  };

  // ── Paso 1: Inicio de la asignación ──────────────────────────────
  const handleInicioServicio = async () => {
    if (activado) { setStep(step + 1); return; }
    setActivando(true);
    try {
      await asignacionesService.activar(asignacion.id);
      setActivado(true);
      notify.success('Asignación iniciada');
      setStep(step + 1);
    } catch (err) {
      notify.error(err.response?.data?.message || 'No se pudo iniciar la asignación');
    } finally {
      setActivando(false);
    }
  };

  // Hecha = hecha aquí o ya en el servidor al abrir
  const fotoHecha = (key) => !!fotos[key] || !!enServidor[key];

  // Sube las fotos de inicio de `tipos` hechas aquí que aún no han llegado.
  // `cuenta.subidas` se va sumando para el mensaje de error: el estado
  // `subidas` no se ve actualizado dentro de esta misma ejecución.
  const subirFotosInicio = async (tipos, cuenta) => {
    for (const tipo of tipos) {
      const file = fotos[tipo.key];
      if (!file) continue;
      if (subidas.inicio[tipo.key] === file) continue;   // ya está en el servidor
      setProgress(p => ({ ...p, [tipo.key]: 'Subiendo…' }));
      const fd = new FormData();
      fd.append('image', file);
      fd.append('tipo_imagen', tipo.key);
      fd.append('momento', 'inicio');
      await asignacionesService.uploadEvidencia(asignacion.id, fd);
      cuenta.subidas++;
      setSubidas(s => ({ ...s, inicio: { ...s.inicio, [tipo.key]: file } }));
      setProgress(p => ({ ...p, [tipo.key]: 'Subida' }));
    }
  };
  const cuentaDe = (tipos) => {
    const conFoto = tipos.filter(t => fotos[t.key]);
    return {
      total:   conFoto.length,
      subidas: conFoto.filter(t => subidas.inicio[t.key] === fotos[t.key]).length,
    };
  };

  // ── Primera tanda: «Guardar» la revisión mecánica ───────────
  const handleGuardar = async () => {
    const tipos = seccion.fotos;
    const cuenta = cuentaDe(tipos);
    // Nada nuevo que subir (vuelve atrás desde la carrocería): se sigue sin pausa
    if (cuenta.subidas === cuenta.total) { setStep(step + 1); return; }
    setGuardando(true);
    try {
      await subirFotosInicio(tipos, cuenta);
      setPausa(true);
    } catch (err) {
      if (esFalloDeRed(err)) {
        notify.error(mensajeFalloSubida({ ...cuenta, boton: 'Guardar' }), DURACION_AVISO_FALLO_SUBIDA_MS);
      } else {
        notify.error(err.response?.data?.message || err.message || 'No se han podido guardar las fotos');
      }
    } finally {
      setGuardando(false);
    }
  };

  // ── Envío final ─────────────────────────────────────────────
  const handleSubmit = async () => {
    setUploading(true);
    const incPendientes = hayInc ? incFotos : [];
    const cuenta = cuentaDe(IMAGEN_TIPOS_INICIO);
    cuenta.total   += incPendientes.length;
    cuenta.subidas += incPendientes.filter(f => subidas.incidencia.has(f)).length;
    try {
      // 1. Fotos de inicio (las que falten: la mecánica ya suele estar guardada)
      await subirFotosInicio(IMAGEN_TIPOS_INICIO, cuenta);

      // 2. Fotos de incidencia (opcionales, no bloquean)
      if (hayInc) {
        for (const file of incFotos) {
          if (subidas.incidencia.has(file)) continue;
          const fd = new FormData();
          fd.append('image', file);
          fd.append('tipo_imagen', 'danos');
          fd.append('momento', 'general');
          await asignacionesService.uploadEvidencia(asignacion.id, fd);
          cuenta.subidas++;
          setSubidas(s => ({ ...s, incidencia: new Set(s.incidencia).add(file) }));
        }
        // 3. Registrar la incidencia (queda en el historial del vehículo)
        const descripcion = observ.trim() || 'Incidencia reportada en la revisión de inicio (ver fotos).';
        await asignacionesService.crearIncidencia(asignacion.id, { descripcion });
      }

      notify.success('Revisión de inicio completada');
      onDone?.();
    } catch (err) {
      if (esFalloDeRed(err)) {
        notify.error(mensajeFalloSubida({ ...cuenta, boton: 'Finalizar revisión' }), DURACION_AVISO_FALLO_SUBIDA_MS);
      } else {
        notify.error(err.response?.data?.message || err.message || 'Error al guardar la revisión');
      }
    } finally {
      setUploading(false);
    }
  };

  // ── Cámara a pantalla completa ──────────────────────────────
  if (showCamera) {
    return (
      <CameraCapture
        tipos={camTipos}
        onComplete={handleCameraComplete}
        onCancel={() => setShowCamera(false)}
        initialIndex={camIndex}
      />
    );
  }

  // ── Barra de progreso de secciones ──────────────────────────
  const Stepper = () => (
    <div className="flex items-center gap-1.5">
      {SECCIONES.map((s, i) => (
        <div
          key={s.id}
          className={`h-1.5 flex-1 rounded-full transition-colors ${
            i < step ? 'bg-ok-500' : i === step ? 'bg-primary-500' : 'bg-neutral-200'
          }`}
        />
      ))}
    </div>
  );

  const Header = () => (
    <div className="space-y-3">
      <Stepper />
      <div>
        <p className="text-xs text-neutral-400">Paso {step + 1} de {SECCIONES.length}</p>
        <h2 className="text-lg font-semibold text-neutral-900">{seccion.titulo}</h2>
        {seccion.subtitulo && <p className="text-sm text-neutral-500">{seccion.subtitulo}</p>}
      </div>
    </div>
  );

  // ── Pausa tras guardar la mecánica ──────────────────────────
  // Lo normal aquí es bloquear el móvil y sacar la ambulancia: al desbloquear
  // se encuentra esta pantalla pidiendo la carrocería. Si el navegador la ha
  // descartado mientras tanto, la ficha dice «Faltan las fotos de la
  // carrocería» y el asistente se abre directamente por ahí.
  if (pausa) {
    return (
      <div className="space-y-6" data-testid="pausa-carroceria">
        <Stepper />
        <div className="card bg-ok-50 border border-ok-200">
          <p className="font-semibold text-ok-600 text-sm">Revisión mecánica guardada</p>
          <p className="text-sm text-neutral-600 mt-1">
            Las fotos del aceite, los líquidos y el cuentakilómetros ya están subidas.
          </p>
        </div>
        <div className="card bg-primary-50 border border-primary-200 space-y-1">
          <p className="font-semibold text-primary-800">Ahora, la carrocería</p>
          <p className="text-sm text-primary-800">
            Saca la ambulancia y haz las fotos de las cuatro caras. Puedes bloquear el
            teléfono mientras tanto: al volver te las pedirá aquí.
          </p>
        </div>
        <div className="flex gap-3">
          <button onClick={onDone} className="btn-secondary flex-1">Más tarde</button>
          <button onClick={() => { setPausa(false); setStep(step + 1); }} className="btn-primary flex-1">
            Fotos de la carrocería →
          </button>
        </div>
      </div>
    );
  }

  // ── Sección: Inicio de la asignación ─────────────────────────────
  if (seccion.tipo === 'inicio') {
    return (
      <div className="space-y-6">
        <Header />
        <div className="card space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-neutral-500 text-sm">Vehículo</span>
            <span className="font-semibold text-neutral-900">
              {asignacion.vehiculo_alias}
              <span className="data font-normal text-neutral-500 ml-2">{asignacion.matricula}</span>
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-neutral-500 text-sm">Inicio previsto en base</span>
            <span className="text-neutral-700 text-sm">{formatDateTime(asignacion.fecha_inicio)}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-neutral-500 text-sm">Fin previsto en base</span>
            <span className="text-neutral-700 text-sm">{formatDateTime(asignacion.fecha_fin)}</span>
          </div>
        </div>
        {esPronto ? (
          <div className="card bg-warn-50 border border-warn-200">
            <p className="text-warn-700 text-sm">
              Aún es pronto. Podrás iniciar la asignación a partir del{' '}
              <strong className="data">{formatDateTime(inicioServicioPermitidoDesde(asignacion.fecha_inicio))}</strong>,
              media hora antes de la hora prevista.
            </p>
          </div>
        ) : (
          <div className="card bg-primary-50 border border-primary-200">
            <p className="text-primary-800 text-sm">
              Púlsalo en base, al recoger la ambulancia: se registra la fecha y la hora reales
              y después se hacen las fotos del vehículo.{' '}
              {asignacion?.jornadas?.length ? (
                // Jornadas por día (v39): las fotos, una sola vez; cada día, su jornada
                <>Son las únicas fotos de inicio del servicio: después, cada día, se marca
                  <strong> Inicio de jornada</strong> y <strong>Fin de jornada</strong>.</>
              ) : (
                <>La llegada al lugar del servicio se marca más tarde, con
                  <strong> Inicio evento/servicio</strong>.</>
              )}
            </p>
          </div>
        )}
        <div className="flex gap-3">
          <button onClick={onCancel} className="btn-secondary flex-1" disabled={activando}>Cancelar</button>
          <button onClick={handleInicioServicio} className="btn-primary flex-1" disabled={activando || esPronto}>
            {activando ? 'Iniciando…' : activado ? 'Continuar →' : '▶ Inicio de la asignación'}
          </button>
        </div>
      </div>
    );
  }

  // ── Sección: fotos (mecánica / exterior) ────────────────────
  if (seccion.tipo === 'photos') {
    const tipos = seccion.fotos;
    const done  = tipos.filter(t => fotoHecha(t.key)).length;
    const completa = done === tipos.length;
    const ocupado  = guardando;
    // Hechas aquí y aún sin subir; si no hay ninguna (ya guardadas antes), no
    // hay nada que «Guardar» y el botón solo avanza
    const hayNuevas = tipos.some(t => fotos[t.key] && subidas.inicio[t.key] !== fotos[t.key]);
    return (
      <div className="space-y-6">
        <Header />
        <div className="flex items-center justify-between">
          <button onClick={() => openCamera(tipos, 0, 'inicio')} className="btn-secondary text-sm">
            Cámara guiada
          </button>
          <span className="text-xs text-neutral-500">{done}/{tipos.length} fotos</span>
        </div>

        <div className="grid grid-cols-2 gap-3">
          {tipos.map((tipo, index) => {
            const file = fotoHecha(tipo.key);
            const preview = previews[tipo.key] || enServidor[tipo.key];
            return (
              <div key={tipo.key} className="space-y-1">
                <p className="text-xs font-medium text-neutral-600">{tipo.label}</p>
                <div
                  className={`relative aspect-[4/3] rounded-xl overflow-hidden border-2 cursor-pointer transition-colors
                    ${file ? 'border-ok-500 bg-ok-50' : 'border-dashed border-neutral-300 bg-neutral-50 hover:border-primary-400'}`}
                  onClick={() => openCamera(tipos, index, 'inicio')}
                >
                  {preview ? (
                    <img src={preview} alt={tipo.label} className="w-full h-full object-cover" />
                  ) : (
                    <div className="flex flex-col items-center justify-center h-full gap-2 text-neutral-300 p-2">
                      <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
                      </svg>
                      <span className="text-xs text-neutral-400 text-center">{tipo.instruccion}</span>
                    </div>
                  )}
                  {file && (
                    <div className="absolute top-1 right-1 w-6 h-6 bg-ok-500 rounded-full flex items-center justify-center shadow">
                      <svg className="w-4 h-4 text-white" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                      </svg>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {seccion.guardar && (hayNuevas || !completa) && (
          <p className="text-xs text-neutral-500">
            Al pulsar <strong>Guardar</strong> se suben estas tres. Las de la carrocería se
            hacen después, con la ambulancia fuera.
          </p>
        )}

        <div className="flex gap-3">
          <button onClick={() => setStep(step - 1)} className="btn-secondary flex-1" disabled={ocupado}>← Atrás</button>
          {seccion.guardar ? (
            <button onClick={handleGuardar} disabled={!completa || ocupado} className="btn-primary flex-1">
              {guardando ? 'Guardando…' : hayNuevas || !completa ? 'Guardar' : 'Siguiente →'}
            </button>
          ) : (
            <button onClick={() => setStep(step + 1)} disabled={!completa} className="btn-primary flex-1">
              Siguiente →
            </button>
          )}
        </div>
      </div>
    );
  }

  // ── Sección: incidencias / observaciones ────────────────────
  return (
    <div className="space-y-6">
      <Header />
      <p className="text-sm text-neutral-500">
        ¿Has detectado algún daño o algo relevante al revisar el vehículo?
      </p>

      <div className="grid grid-cols-2 gap-3">
        <button
          onClick={() => setHayInc(false)}
          className={`card text-sm font-medium py-4 border-2 ${!hayInc ? 'border-ok-500 bg-ok-50 text-ok-600' : 'border-neutral-200 text-neutral-600'}`}
        >
          No hay incidencias
        </button>
        <button
          onClick={() => setHayInc(true)}
          className={`card text-sm font-medium py-4 border-2 ${hayInc ? 'border-warn-500 bg-warn-50 text-warn-600' : 'border-neutral-200 text-neutral-600'}`}
        >
          Reportar incidencia
        </button>
      </div>

      {hayInc && (
        <div className="space-y-4">
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="label mb-0">Fotos de la incidencia</label>
              <button
                onClick={() => openCamera([{ key: 'danos', label: 'Daños / Incidencias', instruccion: 'Fotografía el daño o lo relevante', landscape: false, multiple: true }], 0, 'incidencia')}
                className="btn-secondary text-xs"
              >
                Añadir foto
              </button>
            </div>
            {incFotos.length === 0 ? (
              <p className="text-xs text-neutral-400">Aún no has añadido fotos (opcional).</p>
            ) : (
              <div className="grid grid-cols-3 gap-2">
                {incPreviews.map((src, i) => (
                  <div key={i} className="relative aspect-square rounded-lg overflow-hidden border border-neutral-200">
                    <img src={src} alt={`Incidencia ${i + 1}`} className="w-full h-full object-cover" />
                    <button
                      onClick={() => setIncFotos(prev => prev.filter((_, j) => j !== i))}
                      className="absolute top-0.5 right-0.5 w-5 h-5 bg-black/60 text-white rounded-full text-xs flex items-center justify-center"
                    >✕</button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div>
            <label className="label">Observaciones</label>
            <textarea
              className="input resize-none" rows={4}
              placeholder="Describe el daño o lo que hayas detectado…"
              value={observ}
              onChange={e => setObserv(e.target.value)}
            />
          </div>
        </div>
      )}

      <div className="flex gap-3">
        <button onClick={() => setStep(step - 1)} className="btn-secondary flex-1" disabled={uploading}>← Atrás</button>
        <button onClick={handleSubmit} className="btn-primary flex-1" disabled={uploading}>
          {uploading ? 'Guardando…' : 'Finalizar revisión'}
        </button>
      </div>
    </div>
  );
}
