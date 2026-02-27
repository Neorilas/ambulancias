import React, { useState, useEffect } from 'react';
import { format, startOfMonth, endOfMonth, eachDayOfInterval,
         isSameMonth, isSameDay, parseISO, getDay, addMonths, subMonths,
         startOfDay } from 'date-fns';
import { es } from 'date-fns/locale';
import { trabajosService } from '../../services/trabajos.service.js';
import { EstadoBadge } from '../common/StatusBadge.jsx';
import { ESTADO_COLORS } from '../../utils/constants.js';
import { PageLoading } from '../common/LoadingSpinner.jsx';

const DOT_COLORS = {
  programado:            'bg-yellow-400',
  activo:                'bg-blue-500',
  finalizado:            'bg-green-500',
  finalizado_anticipado: 'bg-red-500',
};

export default function CalendarioTrab({ onSelectTrabajo }) {
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [trabajos,     setTrabajos]     = useState([]);
  const [loading,      setLoading]      = useState(false);
  const [selectedDay,  setSelectedDay]  = useState(null);

  useEffect(() => {
    loadMonth(currentMonth);
  }, [currentMonth]);

  async function loadMonth(date) {
    setLoading(true);
    try {
      const data = await trabajosService.listCalendario({
        year:  date.getFullYear(),
        month: date.getMonth() + 1,
      });
      setTrabajos(data || []);
    } catch (err) {
      console.error('Error cargando calendario:', err);
    } finally {
      setLoading(false);
    }
  }

  // Días del mes
  const monthStart = startOfMonth(currentMonth);
  const monthEnd   = endOfMonth(currentMonth);
  const days       = eachDayOfInterval({ start: monthStart, end: monthEnd });

  // Calcular offset (lunes = 0)
  const startDow  = (getDay(monthStart) + 6) % 7; // 0=lun
  const emptyDays = Array(startDow).fill(null);

  // Trabajos que ocurren en un día específico
  const trabajosForDay = (day) => trabajos.filter(t => {
    const inicio = startOfDay(parseISO(t.fecha_inicio));
    const fin    = startOfDay(parseISO(t.fecha_fin));
    return day >= inicio && day <= fin;
  });

  // Trabajos del día seleccionado
  const selectedDayTrabajos = selectedDay ? trabajosForDay(selectedDay) : [];

  return (
    <div className="space-y-4">
      {/* Navegación de mes */}
      <div className="flex items-center justify-between">
        <button
          onClick={() => setCurrentMonth(m => subMonths(m, 1))}
          className="btn-ghost btn-icon"
        >
          ‹
        </button>
        <h2 className="font-semibold text-neutral-900 capitalize">
          {format(currentMonth, 'MMMM yyyy', { locale: es })}
        </h2>
        <button
          onClick={() => setCurrentMonth(m => addMonths(m, 1))}
          className="btn-ghost btn-icon"
        >
          ›
        </button>
      </div>

      {loading ? <PageLoading /> : (
        <>
          {/* Cabecera días semana */}
          <div className="grid grid-cols-7 text-center text-xs font-medium text-neutral-500 pb-1">
            {['Lun','Mar','Mié','Jue','Vie','Sáb','Dom'].map(d => (
              <div key={d}>{d}</div>
            ))}
          </div>

          {/* Cuadrícula de días */}
          <div className="grid grid-cols-7 gap-1">
            {/* Días vacíos del inicio */}
            {emptyDays.map((_, i) => <div key={`empty-${i}`} />)}

            {/* Días del mes */}
            {days.map(day => {
              const dayTrabajos = trabajosForDay(day);
              const isToday     = isSameDay(day, new Date());
              const isSelected  = selectedDay && isSameDay(day, selectedDay);
              const hasTrab     = dayTrabajos.length > 0;

              return (
                <button
                  key={day.toISOString()}
                  onClick={() => setSelectedDay(isSelected ? null : day)}
                  className={`relative aspect-square flex flex-col items-center justify-center
                              rounded-lg text-sm transition-colors p-1
                              ${isSelected  ? 'bg-primary-100 ring-2 ring-primary-500' :
                                isToday     ? 'bg-primary-600 text-white font-bold' :
                                              'hover:bg-neutral-100'}`}
                >
                  <span>{format(day, 'd')}</span>
                  {/* Puntos de color para trabajos */}
                  {hasTrab && (
                    <div className="flex gap-0.5 mt-0.5 flex-wrap justify-center max-w-full">
                      {dayTrabajos.slice(0, 3).map(t => (
                        <span
                          key={t.id}
                          className={`w-1.5 h-1.5 rounded-full ${DOT_COLORS[t.estado] || 'bg-gray-400'}`}
                        />
                      ))}
                      {dayTrabajos.length > 3 && (
                        <span className="text-[9px] text-neutral-400">+{dayTrabajos.length - 3}</span>
                      )}
                    </div>
                  )}
                </button>
              );
            })}
          </div>

          {/* Panel de trabajos del día seleccionado */}
          {selectedDay && (
            <div className="mt-4 space-y-2">
              <h3 className="font-medium text-neutral-700 text-sm">
                {format(selectedDay, "EEEE, d 'de' MMMM", { locale: es })}
              </h3>
              {selectedDayTrabajos.length === 0 ? (
                <p className="text-sm text-neutral-400">Sin trabajos este día</p>
              ) : (
                selectedDayTrabajos.map(t => (
                  <button
                    key={t.id}
                    onClick={() => onSelectTrabajo?.(t)}
                    className="w-full card text-left hover:shadow-md transition-shadow"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-sm truncate">{t.nombre}</p>
                        <p className="text-xs text-neutral-500 mt-0.5">{t.identificador}</p>
                      </div>
                      <EstadoBadge estado={t.estado} />
                    </div>
                  </button>
                ))
              )}
            </div>
          )}

          {/* Leyenda */}
          <div className="flex flex-wrap gap-3 text-xs text-neutral-600 mt-2">
            {Object.entries(DOT_COLORS).map(([estado, color]) => (
              <div key={estado} className="flex items-center gap-1.5">
                <span className={`w-2.5 h-2.5 rounded-full ${color}`} />
                <span className="capitalize">{estado.replace('_', ' ')}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
