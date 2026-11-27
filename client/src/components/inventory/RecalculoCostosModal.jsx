import React, { useEffect, useState } from 'react';
import { Modal, ErrorBox } from '../billing/billingShared';
import { readJson } from '../billing/billingUtils';

const soles = (v) => `S/ ${Number(v || 0).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`;

/**
 * Recalcula el costo promedio de insumos y bebidas desde el kardex (compras y entradas con costo) y corrige los que
 * quedaron mal guardados. Muestra primero la vista previa: costo actual vs. recalculado; solo se cambian los marcados.
 */
const RecalculoCostosModal = ({ onClose, onDone }) => {
    const [filas, setFilas] = useState(null);
    const [marcados, setMarcados] = useState(new Set());
    const [error, setError] = useState('');
    const [guardando, setGuardando] = useState(false);
    const clave = (f) => `${f.tipo_item}:${f.item_id}`;

    useEffect(() => {
        fetch('/api/inventario/recalculo-costos')
            .then((res) => readJson(res, 'No se pudo recalcular los costos.'))
            .then((data) => { setFilas(data); setMarcados(new Set(data.map(clave))); })
            .catch((e) => { setError(e.message); setFilas([]); });
    }, []);

    const alternar = (k) => setMarcados((prev) => {
        const nuevo = new Set(prev);
        if (nuevo.has(k)) nuevo.delete(k); else nuevo.add(k);
        return nuevo;
    });

    const aplicar = async () => {
        setGuardando(true);
        setError('');
        try {
            const items = filas.filter((f) => marcados.has(clave(f))).map((f) => ({ tipo_item: f.tipo_item, item_id: f.item_id }));
            const r = await readJson(await fetch('/api/inventario/recalculo-costos', {
                method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ items })
            }), 'No se pudo corregir los costos.');
            onDone(r.message);
        } catch (e) {
            setError(e.message);
        } finally {
            setGuardando(false);
        }
    };

    return (
        <Modal title="Recalcular costo promedio" subtitle="Desde el kardex: compras y entradas con costo, en orden, sobre el stock de todos los almacenes." xl onClose={onClose}>
            <ErrorBox text={error} />
            {filas === null && <p className="py-10 text-center text-gray-500">Recalculando...</p>}
            {filas?.length === 0 && !error && <p className="py-10 text-center text-emerald-700 font-semibold">Todos los costos coinciden con el kardex. No hay nada que corregir.</p>}
            {filas?.length > 0 && (
                <>
                    <p className="text-sm text-gray-600 mb-3">{filas.length} ítem(s) tienen un costo distinto al que resulta de sus compras y entradas. Revise y aplique los marcados.</p>
                    <div className="overflow-x-auto border rounded-2xl">
                        <table className="w-full text-sm" style={{ minWidth: 720 }}>
                            <thead>
                                <tr className="text-left text-xs uppercase text-gray-500 border-b bg-gray-50/60">
                                    <th className="px-3 py-3 w-10">
                                        <input type="checkbox" aria-label="Marcar todos" checked={marcados.size === filas.length}
                                            onChange={(e) => setMarcados(e.target.checked ? new Set(filas.map(clave)) : new Set())} />
                                    </th>
                                    <th className="px-3 py-3">Ítem</th>
                                    <th className="px-3 py-3 text-right">Costo actual</th>
                                    <th className="px-3 py-3 text-right">Costo recalculado</th>
                                    <th className="px-3 py-3 text-right">Entradas con costo</th>
                                </tr>
                            </thead>
                            <tbody>
                                {filas.map((f) => (
                                    <tr key={clave(f)} className="border-b border-gray-100 align-top">
                                        <td className="px-3 py-3"><input type="checkbox" aria-label={`Corregir ${f.nombre}`} checked={marcados.has(clave(f))} onChange={() => alternar(clave(f))} /></td>
                                        <td className="px-3 py-3">
                                            <p className="font-bold">{f.nombre}</p>
                                            <p className="text-xs text-gray-500">{f.tipo_item === 'insumo' ? 'Insumo' : 'Bebida / producto'} · por {f.unidad}</p>
                                            {f.stock_inicial_sin_costo > 0 && (
                                                <p className="text-[11px] text-amber-700 font-semibold">Tenía {f.stock_inicial_sin_costo} {f.unidad} cargado a mano, sin costo en el kardex: no pesa en el promedio.</p>
                                            )}
                                        </td>
                                        <td className="px-3 py-3 text-right tabular-nums text-rose-700">{soles(f.costo_actual)}</td>
                                        <td className="px-3 py-3 text-right tabular-nums font-black text-emerald-700">{soles(f.costo_recalculado)}</td>
                                        <td className="px-3 py-3 text-right tabular-nums">{f.entradas}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </>
            )}
            <div className="flex gap-3 pt-6">
                <button type="button" onClick={onClose} className="flex-1 btn btn-secondary">Cerrar</button>
                {filas?.length > 0 && (
                    <button type="button" onClick={aplicar} disabled={guardando || marcados.size === 0} className="flex-1 btn btn-primary">
                        {guardando ? 'Corrigiendo...' : `Corregir ${marcados.size} costo(s)`}
                    </button>
                )}
            </div>
        </Modal>
    );
};

export default RecalculoCostosModal;
