import React, { useState } from 'react';
import Modal from '../../components/common/Modal.jsx';
import { vehiclesService } from '../../services/vehicles.service.js';
import { useNotification } from '../../context/NotificationContext.jsx';
import { toInputDate } from '../../utils/dateUtils.js';

/**
 * Calcula la próxima fecha de ITV según normativa:
 * - Menos de 5 años desde matriculación: revisión anual
 * - 5 o más años: revisión semestral (cada 6 meses)
 */
function calcProximaITV(fechaMatriculacion, fechaUltimaITV) {
  if (!fechaUltimaITV) return null;
  const matricula = fechaMatriculacion ? new Date(fechaMatriculacion) : null;
  const ultimaITV = new Date(fechaUltimaITV);
  const hoy = new Date();

  let mesesIntervalo = 12;
  if (matricula) {
    const edadAnios = (hoy - matricula) / (1000 * 60 * 60 * 24 * 365.25);
    if (edadAnios >= 5) mesesIntervalo = 6;
  }

  const proxima = new Date(ultimaITV);
  proxima.setMonth(proxima.getMonth() + mesesIntervalo);
  return proxima;
}

function calcProximaITS(fechaUltimaITS) {
  if (!fechaUltimaITS) return null;
  const proxima = new Date(fechaUltimaITS);
  proxima.setFullYear(proxima.getFullYear() + 1);
  return proxima;
}

function RevisionBadge({ label, proxima }) {
  if (!proxima) return null;
  const hoy = new Date();
  const diasRestantes = Math.ceil((proxima - hoy) / (1000 * 60 * 60 * 24));
  const vencida   = diasRestantes < 0;
  const proxima30 = diasRestantes >= 0 && diasRestantes <= 30;

  let cls = 'text-green-700 bg-green-50 border-green-200';
  let icono = '✓';
  if (vencida)   { cls = 'text-red-700 bg-red-50 border-red-200';         icono = '✕'; }
  if (proxima30) { cls = 'text-yellow-700 bg-yellow-50 border-yellow-200'; icono = '⚠'; }

  return (
    <div className={`text-xs border rounded px-2 py-1 ${cls}`}>
      <span className="font-semibold">{icono} {label}:</span>{' '}
      {vencida
        ? `Vencida hace ${Math.abs(diasRestantes)} días`
        : `Vence en ${diasRestantes} días (${proxima.toLocaleDateString('es-ES')})`}
    </div>
  );
}

export default function VehicleForm({ vehicle, onSaved, onClose }) {
  const isEdit = !!vehicle;
  const { notify } = useNotification();

  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState({});
  const [form,   setForm]   = useState({
    matricula:             vehicle?.matricula             || '',
    alias:                 vehicle?.alias                 || '',
    kilometros_actuales:   vehicle?.kilometros_actuales   ?? '',
    fecha_matriculacion:   toInputDate(vehicle?.fecha_matriculacion),
    fecha_itv:             toInputDate(vehicle?.fecha_itv),
    fecha_its:             toInputDate(vehicle?.fecha_its),
    fecha_ultima_revision: toInputDate(vehicle?.fecha_ultima_revision),
    fecha_ultimo_servicio: toInputDate(vehicle?.fecha_ultimo_servicio),
  });

  const set = (field) => (e) => {
    setForm(f => ({ ...f, [field]: e.target.value }));
    setErrors(er => ({ ...er, [field]: '' }));
  };

  const validate = () => {
    const e = {};
    if (!form.matricula.trim()) e.matricula = 'Matrícula requerida';
    if (!form.alias.trim())     e.alias     = 'Alias requerido';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleSubmit = async (ev) => {
    ev.preventDefault();
    if (!validate()) return;
    setSaving(true);
    try {
      const payload = {
        alias:                 form.alias,
        kilometros_actuales:   form.kilometros_actuales !== '' ? parseInt(form.kilometros_actuales) : 0,
        fecha_matriculacion:   form.fecha_matriculacion   || null,
        fecha_itv:             form.fecha_itv             || null,
        fecha_its:             form.fecha_its             || null,
        fecha_ultima_revision: form.fecha_ultima_revision || null,
        fecha_ultimo_servicio: form.fecha_ultimo_servicio || null,
      };
      if (!isEdit) payload.matricula = form.matricula.toUpperCase();

      if (isEdit) await vehiclesService.update(vehicle.id, payload);
      else        await vehiclesService.create(payload);

      notify.success(isEdit ? 'Vehículo actualizado' : 'Vehículo creado');
      onSaved();
    } catch (err) {
      notify.error(err.response?.data?.message || 'Error al guardar');
    } finally {
      setSaving(false);
    }
  };

  const proximaITV = calcProximaITV(form.fecha_matriculacion, form.fecha_itv);
  const proximaITS = calcProximaITS(form.fecha_its);

  return (
    <Modal
      isOpen
      onClose={onClose}
      title={isEdit ? `Editar: ${vehicle.alias}` : 'Nuevo vehículo'}
      size="md"
      footer={
        <>
          <button className="btn-secondary" onClick={onClose} disabled={saving}>Cancelar</button>
          <button className="btn-primary" onClick={handleSubmit} disabled={saving}>
            {saving ? 'Guardando...' : (isEdit ? 'Actualizar' : 'Crear vehículo')}
          </button>
        </>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-4">

        {/* Matrícula y Alias */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="label">Matrícula <span className="text-red-500">*</span></label>
            <input
              type="text"
              className={`input uppercase ${errors.matricula ? 'input-error' : ''}`}
              value={form.matricula}
              onChange={set('matricula')}
              disabled={isEdit}
              placeholder="Ej: 1234-ABC"
            />
            {errors.matricula && <p className="field-error">{errors.matricula}</p>}
          </div>
          <div>
            <label className="label">Alias <span className="text-red-500">*</span></label>
            <input
              type="text"
              className={`input ${errors.alias ? 'input-error' : ''}`}
              value={form.alias}
              onChange={set('alias')}
              placeholder="Ej: Ambulancia-01"
            />
            {errors.alias && <p className="field-error">{errors.alias}</p>}
          </div>
        </div>

        {/* Kilómetros y Fecha matriculación */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="label">Kilómetros actuales</label>
            <input
              type="number"
              className="input"
              value={form.kilometros_actuales}
              onChange={set('kilometros_actuales')}
              min={0}
              step={1}
            />
          </div>
          <div>
            <label className="label">Fecha de matriculación</label>
            <input
              type="date"
              className="input"
              value={form.fecha_matriculacion}
              onChange={set('fecha_matriculacion')}
            />
            <p className="text-xs text-neutral-400 mt-1">Determina la frecuencia de ITV</p>
          </div>
        </div>

        {/* ITV e ITS */}
        <div className="border border-neutral-200 rounded-lg p-3 space-y-3">
          <h4 className="text-sm font-semibold text-neutral-700">Revisiones técnicas</h4>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="label">Última ITV</label>
              <input
                type="date"
                className="input"
                value={form.fecha_itv}
                onChange={set('fecha_itv')}
              />
              {form.fecha_matriculacion && form.fecha_itv && (
                <p className="text-xs text-neutral-400 mt-1">
                  {(() => {
                    const edad = (new Date() - new Date(form.fecha_matriculacion)) / (1000 * 60 * 60 * 24 * 365.25);
                    return edad >= 5 ? '⏱ Semestral (vehículo ≥5 años)' : '⏱ Anual (vehículo <5 años)';
                  })()}
                </p>
              )}
            </div>
            <div>
              <label className="label">Última ITS</label>
              <input
                type="date"
                className="input"
                value={form.fecha_its}
                onChange={set('fecha_its')}
              />
              <p className="text-xs text-neutral-400 mt-1">⏱ Anual</p>
            </div>
          </div>

          {(proximaITV || proximaITS) && (
            <div className="space-y-1.5">
              <RevisionBadge label="Próxima ITV" proxima={proximaITV} />
              <RevisionBadge label="Próxima ITS" proxima={proximaITS} />
            </div>
          )}
        </div>

        {/* Revisión general y servicio */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="label">Última revisión general</label>
            <input
              type="date"
              className="input"
              value={form.fecha_ultima_revision}
              onChange={set('fecha_ultima_revision')}
            />
          </div>
          <div>
            <label className="label">Último servicio</label>
            <input
              type="date"
              className="input"
              value={form.fecha_ultimo_servicio}
              onChange={set('fecha_ultimo_servicio')}
            />
          </div>
        </div>

      </form>
    </Modal>
  );
}
