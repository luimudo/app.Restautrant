import React, { useCallback, useEffect, useState } from 'react';
import { Download, Beer } from 'lucide-react';
import writeXlsxFile from 'write-excel-file/browser';
import { Modal, Field, ErrorBox } from '../billing/billingShared';
import { readJson, money } from '../billing/billingUtils';
import { toPeruYmd, startOfMonthYmd } from '../../utils/dateTime';

const litros = (v) => Number(v || 0).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 3 });
const HEADER = { fontWeight: 'bold', backgroundColor: '#F3F4F6' };

/** R-03: consumo en litros por producto base (barril) y presentacion, de los comprobantes no anulados del periodo. */
const ConsumoLitrosModal = ({ sedeNombre, onClose }) => {
    const [filtro, setFiltro] = useState({ desde: startOfMonthYmd(toPeruYmd()), hasta: toPeruYmd() });
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    const cargar = useCallback(async (f) => {
        setLoading(true);
        setError('');
        try {
            setData(await readJson(await fetch(`/api/reportes/consumo-litros?desde=${f.desde}&hasta=${f.hasta}`), 'No se pudo cargar el consumo.'));
        } catch (e) {
            setError(e.message);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { cargar(filtro); }, []); // eslint-disable-line react-hooks/exhaustive-deps

    const exportar = async () => {
        const cols = ['Producto base', 'Presentación', 'Litros por unidad', 'Unidades vendidas', 'Litros', 'Importe (S/)'];
        const filas = (data?.filas || []).map((f) => [
            { type: String, value: f.base_nombre }, { type: String, value: f.presentacion_nombre },
            { type: Number, value: f.litros_por_unidad, format: '0.000' }, { type: Number, value: f.unidades },
            { type: Number, value: f.litros, format: '0.000' }, { type: Number, value: f.importe, format: '#,##0.00' }
        ]);
        const totales = (data?.totales || []).map((t) => [
            { type: String, value: t.base_nombre, fontWeight: 'bold' }, { type: String, value: 'TOTAL', fontWeight: 'bold' }, null,
            { type: Number, value: t.unidades, fontWeight: 'bold' }, { type: Number, value: t.litros, format: '0.000', fontWeight: 'bold' },
            { type: Number, value: t.importe, format: '#,##0.00', fontWeight: 'bold' }
        ]);
        const sede = String(sedeNombre || 'Sede').normalize('NFD').replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '_');
        await writeXlsxFile([cols.map((value) => ({ value, ...HEADER })), ...filas, [null], ...totales], {
            columns: [{ width: 32 }, { width: 28 }, { width: 16 }, { width: 18 }, { width: 12 }, { width: 14 }]
        }).toFile(`Consumo_litros_${sede}_${data.periodo.desde}_${data.periodo.hasta}.xlsx`);
    };

    return (
        <Modal title="Consumo por litros" subtitle="Cerveza de barril y otros productos vendidos por presentación." wide onClose={onClose}>
            <ErrorBox text={error} />
            <form className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_auto_auto] gap-3 items-end" onSubmit={(e) => { e.preventDefault(); cargar(filtro); }}>
                <Field label="Desde"><input type="date" className="input" value={filtro.desde} max={filtro.hasta} onChange={(e) => setFiltro({ ...filtro, desde: e.target.value })} required /></Field>
                <Field label="Hasta"><input type="date" className="input" value={filtro.hasta} min={filtro.desde} max={toPeruYmd()} onChange={(e) => setFiltro({ ...filtro, hasta: e.target.value })} required /></Field>
                <button type="submit" className="btn btn-primary" disabled={loading}>{loading ? 'Cargando...' : 'Consultar'}</button>
                <button type="button" className="btn btn-secondary" disabled={!data?.filas?.length} onClick={exportar}><Download size={16} /> Excel</button>
            </form>

            <div className="mt-5 grid grid-cols-1 sm:grid-cols-2 gap-3">
                {(data?.totales || []).map((t) => (
                    <div key={t.base_id} className="card p-4">
                        <p className="text-[10px] font-black uppercase tracking-widest text-gray-500 flex items-center gap-1.5"><Beer size={14} />{t.base_nombre}</p>
                        <p className="text-2xl font-display font-black text-brand-600 tabular-nums">{litros(t.litros)} {t.unidad}</p>
                        <p className="text-xs text-gray-500">{t.unidades} unidades · {money(t.importe)}</p>
                    </div>
                ))}
            </div>

            <div className="mt-4 overflow-x-auto">
                <table className="w-full min-w-[620px] text-sm">
                    <thead>
                        <tr className="text-left text-xs uppercase text-gray-500 border-b">
                            <th className="py-2 pr-3">Producto base</th>
                            <th className="py-2 pr-3">Presentación</th>
                            <th className="py-2 pr-3 text-right">L / unidad</th>
                            <th className="py-2 pr-3 text-right">Unidades</th>
                            <th className="py-2 pr-3 text-right">Litros</th>
                            <th className="py-2 text-right">Importe</th>
                        </tr>
                    </thead>
                    <tbody>
                        {(data?.filas || []).map((f) => (
                            <tr key={f.presentacion_id} className="border-b border-gray-100">
                                <td className="py-2 pr-3 font-semibold">{f.base_nombre}</td>
                                <td className="py-2 pr-3">{f.presentacion_nombre}</td>
                                <td className="py-2 pr-3 text-right tabular-nums">{litros(f.litros_por_unidad)}</td>
                                <td className="py-2 pr-3 text-right tabular-nums">{f.unidades}</td>
                                <td className="py-2 pr-3 text-right tabular-nums font-bold">{litros(f.litros)}</td>
                                <td className="py-2 text-right tabular-nums">{money(f.importe)}</td>
                            </tr>
                        ))}
                        {!loading && data && data.filas.length === 0 && (
                            <tr><td colSpan={6} className="py-8 text-center text-gray-500">No hay ventas de presentaciones por litros en el periodo.</td></tr>
                        )}
                    </tbody>
                </table>
            </div>
        </Modal>
    );
};

export default ConsumoLitrosModal;
