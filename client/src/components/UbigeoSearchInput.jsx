import React, { useEffect, useRef, useState } from 'react';
import { MapPin, X } from 'lucide-react';

const etiqueta = (u) => `${u.codigo} ${u.distrito} - ${u.provincia} - ${u.departamento}`;

/**
 * Ubigeo selector (6-digit INEI/SUNAT code) with autocomplete by district, province, department or code,
 * as in the remission guide of Cealka. `value` is the selected code ('' when none); `onSelect` receives
 * the chosen ubigeo, or null while the user is typing a new search.
 */
const UbigeoSearchInput = ({ value, onSelect, placeholder = 'Buscar distrito, provincia o código', required = false, ariaLabel = 'Ubigeo' }) => {
    const [texto, setTexto] = useState('');
    const [resultados, setResultados] = useState([]);
    const [abierto, setAbierto] = useState(false);
    const [buscando, setBuscando] = useState(false);
    const contenedor = useRef(null);
    const campo = useRef(null);
    const temporizador = useRef(null);
    const escribiendo = useRef(false); // typing clears the selected code: that is not an external reset

    // A code that arrives already saved (edit forms, suggested from a warehouse) is shown with its name.
    useEffect(() => {
        if (!value) {
            if (escribiendo.current) escribiendo.current = false;
            else setTexto('');
            return undefined;
        }
        let activo = true;
        fetch(`/api/ubigeos/${value}`)
            .then((r) => (r.ok ? r.json() : null))
            .then((u) => { if (activo) setTexto(u ? etiqueta(u) : String(value)); })
            .catch(() => { if (activo) setTexto(String(value)); });
        return () => { activo = false; };
    }, [value]);

    useEffect(() => {
        const cerrar = (e) => { if (contenedor.current && !contenedor.current.contains(e.target)) setAbierto(false); };
        document.addEventListener('mousedown', cerrar);
        return () => document.removeEventListener('mousedown', cerrar);
    }, []);

    // The browser's own validation asks to pick from the list when the text is not a chosen ubigeo.
    useEffect(() => {
        campo.current?.setCustomValidity(texto.trim() && !value ? 'Seleccione un ubigeo de la lista' : '');
    }, [texto, value]);

    const cambiar = (e) => {
        const nuevo = e.target.value;
        setTexto(nuevo);
        setAbierto(true);
        if (value) { escribiendo.current = true; onSelect(null); }
        clearTimeout(temporizador.current);
        if (nuevo.trim().length < 2) { setResultados([]); return; }
        temporizador.current = setTimeout(async () => {
            setBuscando(true);
            try {
                const res = await fetch(`/api/ubigeos?q=${encodeURIComponent(nuevo.trim())}`);
                setResultados(res.ok ? await res.json() : []);
            } catch {
                setResultados([]);
            } finally {
                setBuscando(false);
            }
        }, 250);
    };

    const elegir = (u) => {
        setTexto(etiqueta(u));
        setAbierto(false);
        setResultados([]);
        onSelect(u);
    };

    const limpiar = () => {
        setTexto('');
        setResultados([]);
        onSelect(null);
        campo.current?.focus();
    };

    return (
        <div ref={contenedor} className="relative">
            <MapPin size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
            <input
                ref={campo}
                type="text"
                className="input pl-10 pr-9"
                placeholder={placeholder}
                value={texto}
                onChange={cambiar}
                onFocus={() => setAbierto(true)}
                required={required}
                autoComplete="off"
                aria-label={ariaLabel}
            />
            {texto && (
                <button type="button" onClick={limpiar} aria-label="Quitar ubigeo" className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-rose-500">
                    <X size={15} />
                </button>
            )}
            {abierto && !value && texto.trim().length >= 2 && (
                <div className="absolute z-[70] mt-1 w-full max-h-56 overflow-y-auto bg-white border border-gray-100 rounded-2xl shadow-2xl">
                    {buscando && <p className="px-4 py-2 text-xs text-gray-500">Buscando...</p>}
                    {!buscando && resultados.length === 0 && <p className="px-4 py-3 text-xs italic text-gray-500 text-center">Sin resultados para "{texto.trim()}"</p>}
                    {!buscando && resultados.map((u) => (
                        <button type="button" key={u.codigo} onMouseDown={(e) => e.preventDefault()} onClick={() => elegir(u)}
                            className="w-full text-left px-4 py-2 text-sm hover:bg-brand-50 border-b border-gray-50 last:border-0">
                            <span className="font-mono text-xs text-brand-700 mr-2">{u.codigo}</span>
                            <span className="font-semibold">{u.distrito}</span>
                            <span className="text-gray-500"> - {u.provincia} - {u.departamento}</span>
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
};

export default UbigeoSearchInput;
