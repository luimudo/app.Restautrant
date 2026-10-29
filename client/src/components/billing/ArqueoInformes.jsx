import React, { useCallback, useEffect, useState } from 'react';
import { FileDown, Search } from 'lucide-react';
import { Modal, Field, ErrorBox } from './billingShared';
import { money, readJson } from './billingUtils';
import { addDaysYmd, formatDateTime, toPeruYmd } from '../../utils/dateTime';
import { descargarInformeArqueoExcel, descargarInformeArqueoPdf } from '../../utils/exportArqueo';

/** Excel and PDF buttons of the movements report of one cash session (arqueo). */
export const BotonesInformeArqueo = ({ sesionId, compacto = false, onError }) => {
    const [cargando, setCargando] = useState('');

    const descargar = async (formato) => {
        setCargando(formato);
        try {
            const informe = await readJson(await fetch(`/api/caja/sesiones/${sesionId}/informe`), 'No se pudo generar el informe.');
            if (formato === 'excel') await descargarInformeArqueoExcel(informe);
            else descargarInformeArqueoPdf(informe);
        } catch (e) {
            onError?.(e.message);
        } finally {
            setCargando('');
        }
    };

    const base = compacto ? 'px-2.5 py-1.5 text-[11px]' : 'px-4 py-2.5 text-sm';
    return (
        <div className="flex gap-2">
            <button type="button" onClick={() => descargar('excel')} disabled={Boolean(cargando)} title="Informe de movimientos en Excel"
                className={`flex items-center gap-1.5 ${base} rounded-xl font-bold bg-green-700 text-white hover:bg-green-800 disabled:opacity-50`}>
                <FileDown size={compacto ? 12 : 16} /> {cargando === 'excel' ? '...' : 'Excel'}
            </button>
            <button type="button" onClick={() => descargar('pdf')} disabled={Boolean(cargando)} title="Informe de movimientos en PDF"
                className={`flex items-center gap-1.5 ${base} rounded-xl font-bold bg-red-700 text-white hover:bg-red-800 disabled:opacity-50`}>
                <FileDown size={compacto ? 12 : 16} /> {cargando === 'pdf' ? '...' : 'PDF'}
            </button>
        </div>
    );
};

/** History of cash sessions of the sede, with the movements report of each one. */
export const HistorialArqueos = ({ onClose }) => {
    const hoy = toPeruYmd();
    const [filtros, setFiltros] = useState({ desde: addDaysYmd(hoy, -30), hasta: hoy });
    const [sesiones, setSesiones] = useState([]);
    const [cargando, setCargando] = useState(true);
    const [error, setError] = useState('');

    const cargar = useCallback(async (actuales) => {
        setCargando(true);
        try {
            const cuerpo = await readJson(await fetch(`/api/caja/sesiones?desde=${actuales.desde}&hasta=${actuales.hasta}`), 'No se pudo cargar el historial de arqueos.');
            setSesiones(cuerpo.sesiones);
            setError('');
        } catch (e) {
            setError(e.message);
        } finally {
            setCargando(false);
        }
    }, []);

    useEffect(() => { cargar(filtros); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

    return (
        <Modal title="Historial de arqueos" subtitle="Informe de movimientos de cada sesión de caja (ventas, cobros, ingresos, egresos y devoluciones)." wide onClose={onClose}>
            <ErrorBox text={error} />
            <form onSubmit={(e) => { e.preventDefault(); cargar(filtros); }} className="grid grid-cols-[1fr_1fr_auto] gap-3 items-end mb-4">
                <Field label="Desde"><input type="date" className="input" value={filtros.desde} max={filtros.hasta} onChange={(e) => setFiltros({ ...filtros, desde: e.target.value })} required /></Field>
                <Field label="Hasta"><input type="date" className="input" value={filtros.hasta} min={filtros.desde} onChange={(e) => setFiltros({ ...filtros, hasta: e.target.value })} required /></Field>
                <button type="submit" className="btn btn-secondary"><Search size={16} /> Buscar</button>
            </form>

            <div className="max-h-[55vh] overflow-auto">
                <table className="w-full text-sm min-w-[640px]">
                    <thead>
                        <tr className="text-left text-[10px] uppercase text-gray-500 border-b">
                            <th className="py-2 pr-3">Sesión</th>
                            <th className="py-2 pr-3">Apertura / cierre</th>
                            <th className="py-2 pr-3 text-right">Inicial</th>
                            <th className="py-2 pr-3 text-right">Contado</th>
                            <th className="py-2 pr-3 text-right">Diferencia</th>
                            <th className="py-2 text-right">Informe</th>
                        </tr>
                    </thead>
                    <tbody>
                        {cargando && <tr><td colSpan={6} className="py-8 text-center font-bold text-gray-500">Cargando...</td></tr>}
                        {!cargando && sesiones.map((s) => (
                            <tr key={s.id} className="border-b border-gray-50 align-top">
                                <td className="py-3 pr-3">
                                    <p className="font-black">#{s.id}{s.turno ? <span className="ml-2 text-[10px] font-black uppercase text-sky-700 bg-sky-50 px-1.5 py-0.5 rounded-md">{s.turno}</span> : null}</p>
                                    <p className="text-xs text-gray-500">{s.caja_descripcion}</p>
                                    <span className={`inline-block mt-1 px-2 py-0.5 rounded-md text-[10px] font-black uppercase ${s.estado === 'abierta' ? 'bg-emerald-50 text-emerald-700' : 'bg-gray-100 text-gray-500'}`}>{s.estado}</span>
                                </td>
                                <td className="py-3 pr-3 text-xs text-gray-600">
                                    <p>{formatDateTime(s.fecha_apertura)}</p>
                                    <p>{s.fecha_cierre ? formatDateTime(s.fecha_cierre) : 'Sin cerrar'}</p>
                                    <p className="text-gray-400">{s.usuario_apertura_nombre || '-'}</p>
                                </td>
                                <td className="py-3 pr-3 text-right tabular-nums">{money(s.monto_inicial)}</td>
                                <td className="py-3 pr-3 text-right tabular-nums">{s.monto_contado_cierre === null ? '—' : money(s.monto_contado_cierre)}</td>
                                <td className={`py-3 pr-3 text-right tabular-nums font-bold ${s.diferencia === null || Number(s.diferencia) === 0 ? 'text-gray-500' : Number(s.diferencia) > 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                                    {s.diferencia === null ? '—' : money(s.diferencia)}
                                </td>
                                <td className="py-3 flex justify-end"><BotonesInformeArqueo sesionId={s.id} compacto onError={setError} /></td>
                            </tr>
                        ))}
                        {!cargando && sesiones.length === 0 && <tr><td colSpan={6} className="py-10 text-center text-gray-500">No hay arqueos en ese rango de fechas.</td></tr>}
                    </tbody>
                </table>
            </div>
            <button type="button" className="btn btn-secondary w-full mt-4" onClick={onClose}>Cerrar</button>
        </Modal>
    );
};
