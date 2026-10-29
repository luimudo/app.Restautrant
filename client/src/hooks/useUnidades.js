import { useCallback, useEffect, useState } from 'react';

const leer = (url) => fetch(url).then((r) => (r.ok ? r.json() : [])).then((rows) => (Array.isArray(rows) ? rows : [])).catch(() => []);

/** Unit catalog (shared between sedes) and the conversions between units. */
export const useUnidades = (enabled = true) => {
    const [unidades, setUnidades] = useState([]);
    const [conversiones, setConversiones] = useState([]);

    const recargar = useCallback(async () => {
        const [lista, conv] = await Promise.all([leer('/api/unidades-medida'), leer('/api/unidades-conversiones')]);
        setUnidades(lista);
        setConversiones(conv);
        return { unidades: lista, conversiones: conv };
    }, []);

    useEffect(() => {
        if (enabled) recargar();
    }, [enabled, recargar]);

    return { unidades, activas: unidades.filter((u) => Number(u.activo)), conversiones, recargar };
};

/** Units a quantity can be typed in for an item stocked in `baseId`: its own unit plus every unit that converts to it. */
export const unidadesConvertibles = (activas, conversiones, baseId) => {
    if (!baseId) return [];
    const ids = new Set([Number(baseId)]);
    for (const c of conversiones) {
        if (Number(c.unidad_destino_id) === Number(baseId)) ids.add(Number(c.unidad_origen_id));
        if (Number(c.unidad_origen_id) === Number(baseId)) ids.add(Number(c.unidad_destino_id));
    }
    return activas.filter((u) => ids.has(Number(u.id)));
};
