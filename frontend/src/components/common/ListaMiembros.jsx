/**
 * components/common/ListaMiembros.jsx
 * Selector de 1..N personas: una fila con buscador por persona.
 */
import React, { useState, useEffect, useRef } from 'react';
import { usuariosDisponibles, puedeAnadir } from '../../utils/miembrosAsignacion.js';

// ── Combobox buscador de usuario ─────────────────────────────────────────────
export function UserCombobox({ users, value, onChange, error }) {
  const [query,    setQuery]    = useState('');
  const [open,     setOpen]     = useState(false);
  const [selected, setSelected] = useState(null);
  const wrapperRef = useRef(null);

  // Sincronizar selected cuando cambia value o users desde fuera
  useEffect(() => {
    if (value && users.length) {
      const u = users.find(u => u.id === parseInt(value));
      setSelected(u || null);
      if (u) setQuery(`${u.nombre} ${u.apellidos}`);
    } else if (!value) {
      setSelected(null);
      setQuery('');
    }
  }, [value, users]);

  // Cerrar al hacer click fuera
  useEffect(() => {
    function handleClick(e) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target)) {
        setOpen(false);
        // Restaurar texto del seleccionado si el input queda a medias
        if (selected) setQuery(`${selected.nombre} ${selected.apellidos}`);
        else setQuery('');
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [selected]);

  const filtered = query.trim() === ''
    ? users
    : users.filter(u => {
        const haystack = `${u.nombre} ${u.apellidos} ${u.username}`.toLowerCase();
        return haystack.includes(query.toLowerCase());
      });

  const handleSelect = (u) => {
    setSelected(u);
    setQuery(`${u.nombre} ${u.apellidos}`);
    setOpen(false);
    onChange(u.id);
  };

  const handleInputChange = (e) => {
    setQuery(e.target.value);
    setOpen(true);
    // Si el usuario borra el texto, limpiar selección
    if (!e.target.value.trim()) {
      setSelected(null);
      onChange('');
    }
  };

  const handleClear = () => {
    setSelected(null);
    setQuery('');
    onChange('');
    setOpen(false);
  };

  return (
    <div ref={wrapperRef} className="relative">
      <div className={`flex items-center input p-0 overflow-hidden ${error ? 'input-error' : ''}`}>
        <input
          type="text"
          className="flex-1 px-3 py-2 bg-transparent outline-none text-sm placeholder-neutral-400"
          placeholder="Buscar por nombre o usuario…"
          value={query}
          onChange={handleInputChange}
          onFocus={() => setOpen(true)}
          autoComplete="off"
        />
        {selected ? (
          <button
            type="button"
            onClick={handleClear}
            className="px-2 text-neutral-400 hover:text-neutral-600 shrink-0"
            tabIndex={-1}
          >
            ✕
          </button>
        ) : (
          <span className="px-2 text-neutral-400 shrink-0 text-xs">▾</span>
        )}
      </div>

      {open && (
        <ul className="absolute z-50 mt-1 w-full bg-white border border-neutral-200 rounded-xl shadow-lg max-h-56 overflow-y-auto">
          {filtered.length === 0 ? (
            <li className="px-3 py-2 text-sm text-neutral-400 text-center">Sin resultados</li>
          ) : (
            filtered.slice(0, 50).map(u => (
              <li
                key={u.id}
                className={`px-3 py-2 cursor-pointer text-sm flex items-center justify-between hover:bg-primary-50
                  ${selected?.id === u.id ? 'bg-primary-50 font-medium text-primary-700' : 'text-neutral-700'}`}
                onMouseDown={() => handleSelect(u)}
              >
                <span>{u.nombre} {u.apellidos}</span>
                <span className="text-xs text-neutral-400 ml-2">@{u.username}</span>
              </li>
            ))
          )}
          {filtered.length > 50 && (
            <li className="px-3 py-1.5 text-xs text-neutral-400 text-center border-t border-neutral-100">
              Mostrando 50 de {filtered.length} — refina la búsqueda
            </li>
          )}
        </ul>
      )}
    </div>
  );
}

// ── Lista de personas ────────────────────────────────────────────────────────
// Una fila por persona, con «Añadir…» debajo. Cada combobox ofrece solo a
// quien no esté ya en `ocupados`: la misma persona no puede figurar dos veces
// (el backend lo rechaza igualmente). La usan AsignacionForm (responsables y
// personal) y TrabajoForm (responsables de cada vehículo).
export default function ListaMiembros({ users, lista, ocupados, onChange, minimo, textoAnadir, error }) {
  const cambiar = (i, id) => onChange(lista.map((v, j) => (j === i ? id : v)));
  const quitar  = i => onChange(lista.filter((_, j) => j !== i));
  return (
    <div className="space-y-2">
      {lista.map((valor, i) => (
        <div key={i} className="flex items-start gap-2">
          <div className="flex-1">
            <UserCombobox
              users={usuariosDisponibles(users, ocupados, valor)}
              value={valor}
              onChange={id => cambiar(i, id)}
              error={error && !valor}
            />
          </div>
          {lista.length > minimo && (
            <button
              type="button"
              onClick={() => quitar(i)}
              className="btn-ghost btn-sm text-neutral-500 shrink-0 mt-1"
              aria-label="Quitar"
            >
              Quitar
            </button>
          )}
        </div>
      ))}
      <button
        type="button"
        onClick={() => onChange([...lista, ''])}
        disabled={!puedeAnadir(lista)}
        className="btn-secondary btn-sm"
      >
        + {textoAnadir}
      </button>
    </div>
  );
}
