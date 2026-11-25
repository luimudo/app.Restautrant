import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell, AlertTriangle, Clock, Wrench } from 'lucide-react';
import { money, readJson } from './billing/billingUtils';

const REFRESH_MS = 5 * 60 * 1000;
const EMPTY = { total: 0, vencidos: [], por_vencer: [] };
const SIN_FALLAS = { total: 0, fallas: [] };

/** Header bell: overdue and soon-to-expire reminders of the active sede, and equipment failures reported and still open. */
const RecordatoriosBell = ({ recordatorios = true, fallas: conFallas = false }) => {
    const navigate = useNavigate();
    const [alertas, setAlertas] = useState(EMPTY);
    const [fallas, setFallas] = useState(SIN_FALLAS);
    const [open, setOpen] = useState(false);
    const ref = useRef(null);

    const load = useCallback(async () => {
        // The bell never interrupts the page: without data it just shows no alerts.
        if (recordatorios) {
            try {
                setAlertas(await readJson(await fetch('/api/recordatorios/alertas'), 'Sin alertas'));
            } catch {
                setAlertas(EMPTY);
            }
        }
        if (conFallas) {
            try {
                setFallas(await readJson(await fetch('/api/mantenimientos/fallas-abiertas'), 'Sin fallas'));
            } catch {
                setFallas(SIN_FALLAS);
            }
        }
    }, [recordatorios, conFallas]);
    const total = alertas.total + fallas.total;

    useEffect(() => {
        load();
        const timer = setInterval(load, REFRESH_MS);
        window.addEventListener('focus', load);
        return () => { clearInterval(timer); window.removeEventListener('focus', load); };
    }, [load]);

    useEffect(() => {
        if (!open) return undefined;
        const onClick = (event) => { if (ref.current && !ref.current.contains(event.target)) setOpen(false); };
        const onKey = (event) => { if (event.key === 'Escape') setOpen(false); };
        document.addEventListener('mousedown', onClick);
        document.addEventListener('keydown', onKey);
        return () => { document.removeEventListener('mousedown', onClick); document.removeEventListener('keydown', onKey); };
    }, [open]);

    const linea = (r, vencido) => (
        <div key={r.id} className={`flex items-start gap-3 p-3 rounded-2xl mb-2 ${vencido ? 'bg-rose-50' : 'bg-amber-50'}`}>
            {vencido ? <AlertTriangle size={18} className="text-rose-500 shrink-0 mt-0.5" /> : <Clock size={18} className="text-amber-500 shrink-0 mt-0.5" />}
            <div className="min-w-0 flex-1">
                <p className={`text-sm font-bold truncate ${vencido ? 'text-rose-800' : 'text-amber-800'}`}>{r.nombre}</p>
                <p className={`text-xs ${vencido ? 'text-rose-600' : 'text-amber-700'}`}>
                    {r.categoria === 'pago' ? `${money(r.monto)} — ` : ''}
                    {vencido ? `Vencido hace ${Math.abs(r.dias_restantes)} día(s)` : r.dias_restantes === 0 ? 'Vence hoy' : `Vence en ${r.dias_restantes} día(s)`}
                </p>
            </div>
        </div>
    );

    return (
        <div ref={ref} className="relative">
            <button type="button" onClick={() => { setOpen((v) => !v); if (!open) load(); }}
                className="inline-flex p-2.5 rounded-2xl text-gray-500 hover:bg-gray-100 transition-all relative group"
                aria-label={total > 0 ? `Notificaciones: ${alertas.total} recordatorios, ${fallas.total} fallas reportadas` : 'Notificaciones'} aria-expanded={open}>
                <Bell size={20} className="group-hover:rotate-12 transition-transform" />
                {total > 0 && (
                    <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 bg-rose-500 text-white text-[10px] font-black rounded-full border-2 border-white flex items-center justify-center">
                        {total > 9 ? '9+' : total}
                    </span>
                )}
            </button>

            {open && (
                <div className="absolute right-0 top-12 w-[min(24rem,calc(100vw-2rem))] bg-white rounded-3xl shadow-2xl border border-gray-100 overflow-hidden z-50">
                    <div className="p-4 border-b border-gray-100">
                        <h3 className="font-black text-gray-900">Notificaciones</h3>
                    </div>
                    <div className="max-h-96 overflow-y-auto p-3">
                        {total === 0 && <p className="p-6 text-center text-sm text-gray-500">No hay vencimientos ni fallas pendientes.</p>}
                        {fallas.fallas.length > 0 && (
                            <>
                                <p className="text-[10px] font-black text-rose-500 uppercase tracking-widest px-2 mb-2">Fallas de equipos reportadas</p>
                                {fallas.fallas.map((m) => (
                                    <button key={`f${m.id}`} type="button" onClick={() => { setOpen(false); navigate('/equipos?tab=pendientes'); }}
                                        className="w-full text-left flex items-start gap-3 p-3 rounded-2xl mb-2 bg-rose-50 hover:bg-rose-100 transition-all">
                                        <Wrench size={18} className="text-rose-500 shrink-0 mt-0.5" />
                                        <div className="min-w-0 flex-1">
                                            <p className="text-sm font-bold truncate text-rose-800">{m.equipo_nombre} · prioridad {m.prioridad}</p>
                                            <p className="text-xs text-rose-600 line-clamp-2">{String(m.descripcion || '').replace(/^Falla reportada:\s*/, '')}</p>
                                            {m.reportado_por_nombre && <p className="text-[11px] text-rose-500">Reportó {m.reportado_por_nombre}</p>}
                                        </div>
                                    </button>
                                ))}
                            </>
                        )}
                        {alertas.vencidos.length > 0 && (
                            <>
                                <p className="text-[10px] font-black text-rose-500 uppercase tracking-widest px-2 mb-2">Vencidos</p>
                                {alertas.vencidos.map((r) => linea(r, true))}
                            </>
                        )}
                        {alertas.por_vencer.length > 0 && (
                            <>
                                <p className="text-[10px] font-black text-amber-500 uppercase tracking-widest px-2 mb-2 mt-1">Próximos a vencer</p>
                                {alertas.por_vencer.map((r) => linea(r, false))}
                            </>
                        )}
                    </div>
                    {recordatorios && (
                        <div className="p-3 border-t border-gray-100">
                            <button type="button" onClick={() => { setOpen(false); navigate('/recordatorios'); }}
                                className="w-full py-3 bg-gray-50 rounded-xl text-sm font-bold text-gray-800 hover:bg-gray-100 transition-all">
                                Ir a Recordatorios
                            </button>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};

export default RecordatoriosBell;
