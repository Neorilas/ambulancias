import { describe, it, expect } from 'vitest';
import { rutaAsignacion, tituloAsignacion, enlazaAlTrabajo } from '../../../utils/enlaceAsignacion.js';

// Decisión 8 del plan del trabajo padre: todo enlace que localiza un vehículo
// en una asignación lleva al trabajo, con esa ambulancia señalada.
describe('utils/enlaceAsignacion', () => {
  const EN_TRABAJO = { id: 5, trabajo_id: 40, trabajo_nombre: 'Maratón' };

  it('con trabajo y su pantalla abierta, al trabajo con la ambulancia señalada', () => {
    expect(rutaAsignacion(EN_TRABAJO, true)).toBe('/trabajos/40?asignacion=5');
    expect(tituloAsignacion(EN_TRABAJO, true)).toBe('Trabajo «Maratón»');
    expect(enlazaAlTrabajo(EN_TRABAJO, true)).toBe(true);
  });

  it('con la pantalla de trabajos cerrada, al detalle de siempre: no rebota', () => {
    expect(rutaAsignacion(EN_TRABAJO, false)).toBe('/asignaciones?id=5');
    expect(tituloAsignacion(EN_TRABAJO)).toBe('Asignación #5');
    expect(enlazaAlTrabajo(EN_TRABAJO)).toBe(false);
  });

  it('sin trabajo (modelo antiguo), o con solo el id, al detalle de siempre', () => {
    expect(rutaAsignacion({ id: 6 }, true)).toBe('/asignaciones?id=6');
    expect(rutaAsignacion(7, true)).toBe('/asignaciones?id=7');
    expect(tituloAsignacion(7, true)).toBe('Asignación #7');
  });
});
