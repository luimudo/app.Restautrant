import React, { useCallback, useEffect, useState } from 'react';
import { Banknote, Download, Eye, HandCoins, RefreshCw, Search, XCircle, X, AlertTriangle, Clock, Wallet } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { SUPERADMIN } from '../security/accessControl';
import { addDaysYmd, formatDateTime, toPeruYmd } from '../utils/dateTime';
import { descargarCuentasPorCobrar } from '../utils/exportCuentas';
import { CobroBadge, Modal, Field, ErrorBox } from '../components/billing/billingShared';
import { CobroModal, AnularCobroModal } from '../components/billing/ComprobantesPanel';
import { TIPO_LABEL, METODO_LABEL, money, readJson } from '../components/billing/billingUtils';

const ESTADOS = [
    { value: 'abiertas', label: 'Por cobrar (pendiente + parcial + vencido)' },
    { value: 'todos', label: 'Todos (ventas al crédito)' },
    { value: 'pendiente', label: 'Pendiente' },
    { value: 'parcial', label: 'Parcial' },
    { value: 'vencido', label: 'Vencido' },
    { value: 'cobrado', label: 'Cobrado' }
];

const formatFecha = (ymd) => (ymd ? new Date(`${ymd}T00:00:00`).toLocaleDateString('es-PE', { day: '2-digit', month: 'short', year: 'numeric' }) : '-');
const diasAtraso = (ymd, hoy) => Math.max(0, Math.round((new Date(`${hoy}T00:00:00`) - new Date(`${ymd}T00:00:00`)) / 86400000));

const Kpi = ({ icon, label, value, hint, tone = 'text-gray-900' }) => (
    <div className="card p-5 flex items-start gap-4">
        <div className="p-3 rounded-xl bg-gray-50 text-gray-500">{icon}</div>
        <div className="min-w-0">
            <p className="text-[11px] font-black uppercase tracking-widest text-gray-500">{label}</p>
            <p className={`text-2xl font-black tabular-nums ${tone}`}>{value}</p>
            {hint && <p className="text-xs text-gray-500">{hint}</p>}
        </div>
    </div>
);

/** Receivables of credit sales: balances, due dates, collection registration and history. */
const CuentasPorCobrar = () => {
    const { isSuperadmin, activeProfile, baseProfile, sedes, activeSedeId } = useAuth();
    const isAdmin = baseProfile === 'administrador' || activeProfile === SUPERADMIN;
    const hoy = toPeruYmd();
    const vacios = { q: '', estado: 'abiertas', venc_desde: '', venc_hasta: '', emi_desde: '', emi_hasta: '', sede: activeSedeId ? String(activeSedeId) : 'todas' };

    const [filtros, setFiltros] = useState(vacios);
    const [data, setData] = useState({ facturas: [], resumen: null });
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [message, setMessage] = useState('');
    const [cobroTarget, setCobroTarget] = useState(null);
    const [anularCobro, setAnularCobro] = useState(null);
    const [detalle, setDetalle] = useState(null);
    const [exportando, setExportando] = useState(false);

    const cargar = useCallback(async (actuales) => {
        setLoading(true);
        try {
            const params = new URLSearchParams({ estado: actuales.estado });
            if (isSuperadmin) params.set('sede_id', actuales.sede);
            ['q', 'venc_desde', 'venc_hasta', 'emi_desde', 'emi_hasta'].forEach((k) => { if (actuales[k]) params.set(k, actuales[k]); });
            const body = await readJson(await fetch(`/api/cuentas-por-cobrar?${params}`), 'No se pudo cargar las cuentas por cobrar.');
            setData({ facturas: body.facturas || [], resumen: body.resumen || null });
            setError('');
        } catch (e) {
            setError(e.message);
        } finally {
            setLoading(false);
        }
    }, [isSuperadmin]);

    useEffect(() => { cargar(filtros); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

    const buscar = (e) => { e?.preventDefault(); cargar(filtros); };
    const limpiar = () => { setFiltros(vacios); cargar(vacios); };

    const abrirDetalle = async (id) => {
        try {
            setDetalle(await readJson(await fetch(`/api/facturas/${id}`), 'No se pudo cargar el comprobante.'));
        } catch (e) {
            setError(e.message);
        }
    };

    // Reporte en el formato de la empresa: ventas al crédito emitidas en el rango (por defecto, los últimos 90 días).
    const exportar = async () => {
        const desde = filtros.emi_desde || addDaysYmd(hoy, -90);
        const hasta = filtros.emi_hasta || hoy;
        if (desde > hasta) { setError('La fecha de emisión inicial no puede ser posterior a la final.'); return; }
        setExportando(true);
        try {
            const params = new URLSearchParams({ desde, hasta });
            if (isSuperadmin) params.set('sede_id', filtros.sede);
            const body = await readJson(await fetch(`/api/cuentas-por-cobrar/reporte?${params}`), 'No se pudo generar el reporte.');
            if (body.facturas.length === 0) { setError('No hay ventas al crédito emitidas en ese periodo.'); return; }
            const sedeNombre = isSuperadmin && filtros.sede === 'todas'
                ? 'Todas las sedes'
                : (sedes.find((s) => String(s.id) === String(isSuperadmin ? filtros.sede : activeSedeId))?.nombre || 'Sede');
            await descargarCuentasPorCobrar({ empresa: body.empresa, periodo: body.periodo, sedeNombre, facturas: body.facturas });
            setError('');
        } catch (e) {
            setError(e.message);
        } finally {
            setExportando(false);
        }
    };

    const refrescar = (id) => { cargar(filtros); if (id && detalle?.id === id) abrirDetalle(id); };
    const r = data.resumen;

    return (
        <div className="space-y-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                    <h1 className="text-3xl font-black tracking-tight flex items-center gap-3"><HandCoins size={28} /> Cuentas por cobrar</h1>
                    <p className="text-gray-500 font-medium">Ventas al crédito: saldos, vencimientos y registro de cobros.</p>
                </div>
                <div className="flex gap-2">
                    <button className="btn btn-secondary" onClick={() => cargar(filtros)}><RefreshCw size={16} /> Actualizar</button>
                    <button className="btn btn-secondary" onClick={exportar} disabled={exportando}><Download size={16} /> {exportando ? 'Generando...' : 'Excel'}</button>
                </div>
            </div>

            <ErrorBox text={error} />
            {message && <p className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-700 text-sm font-bold">{message}</p>}

            {r && (
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
                    <Kpi icon={<Wallet size={22} />} label="Saldo por cobrar" value={money(r.saldo_total)} hint={`${r.cantidad} documento(s) · cobrado ${money(r.cobrado)}`} tone="text-amber-600" />
                    <Kpi icon={<AlertTriangle size={22} />} label="Vencido" value={money(r.vencido)} hint={`${r.cantidad_vencidos} documento(s) vencido(s)`} tone="text-rose-600" />
                    <Kpi icon={<Clock size={22} />} label="Por vencer (7 días)" value={money(r.por_vencer)} hint="Vence en la próxima semana" tone="text-sky-600" />
                    <Kpi icon={<Banknote size={22} />} label="Total facturado" value={money(r.total)} hint="Importe vigente de los documentos listados" />
                </div>
            )}

            <form onSubmit={buscar} className="card p-5 space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
                    <Field label="Cliente o documento"><input className="input" placeholder="Nombre, RUC/DNI o N° de comprobante" value={filtros.q} onChange={(e) => setFiltros({ ...filtros, q: e.target.value })} /></Field>
                    <Field label="Estado">
                        <select className="input" value={filtros.estado} onChange={(e) => setFiltros({ ...filtros, estado: e.target.value })}>
                            {ESTADOS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                        </select>
                    </Field>
                    <Field label="Vencimiento desde"><input type="date" className="input" value={filtros.venc_desde} max={filtros.venc_hasta || undefined} onChange={(e) => setFiltros({ ...filtros, venc_desde: e.target.value })} /></Field>
                    <Field label="Vencimiento hasta"><input type="date" className="input" value={filtros.venc_hasta} min={filtros.venc_desde || undefined} onChange={(e) => setFiltros({ ...filtros, venc_hasta: e.target.value })} /></Field>
                    <Field label="Emisión desde"><input type="date" className="input" value={filtros.emi_desde} max={filtros.emi_hasta || undefined} onChange={(e) => setFiltros({ ...filtros, emi_desde: e.target.value })} /></Field>
                    <Field label="Emisión hasta"><input type="date" className="input" value={filtros.emi_hasta} min={filtros.emi_desde || undefined} onChange={(e) => setFiltros({ ...filtros, emi_hasta: e.target.value })} /></Field>
                    {isSuperadmin && (
                        <Field label="Sede">
                            <select className="input" value={filtros.sede} onChange={(e) => setFiltros({ ...filtros, sede: e.target.value })}>
                                <option value="todas">Todas</option>
                                {sedes.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
                            </select>
                        </Field>
                    )}
                    <div className="flex items-end gap-2">
                        <button type="submit" className="btn btn-primary"><Search size={16} /> Buscar</button>
                        <button type="button" className="btn btn-secondary" onClick={limpiar}><X size={16} /> Limpiar</button>
                    </div>
                </div>
                <p className="text-xs text-gray-500">El Excel usa el rango de emisión indicado (por defecto, los últimos 90 días) y lista cada venta al crédito con sus cobros.</p>
            </form>

            <div className="card p-0 overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="w-full min-w-[900px]">
                        <thead>
                            <tr className="text-left text-xs uppercase text-gray-500 border-b bg-gray-50/60">
                                <th className="px-5 py-3">Comprobante</th>
                                <th className="px-5 py-3">Cliente</th>
                                <th className="px-5 py-3">Emisión</th>
                                <th className="px-5 py-3">Vencimiento</th>
                                <th className="px-5 py-3 text-right">Total</th>
                                <th className="px-5 py-3 text-right">Cobrado</th>
                                <th className="px-5 py-3 text-right">Saldo</th>
                                <th className="px-5 py-3">Estado</th>
                                <th className="px-5 py-3 text-right">Acciones</th>
                            </tr>
                        </thead>
                        <tbody>
                            {loading && <tr><td colSpan={9} className="py-10 text-center font-bold text-gray-500">Cargando...</td></tr>}
                            {!loading && data.facturas.map((f) => {
                                const vencido = f.estado_cobro === 'vencido';
                                return (
                                    <tr key={f.id} className="border-b border-gray-100 align-top">
                                        <td className="px-5 py-3">
                                            <p className="font-black font-mono text-sm">{f.numero_comprobante}</p>
                                            <p className="text-[11px] text-gray-500">{TIPO_LABEL[f.tipo_comprobante]}{isSuperadmin ? ` · ${f.sede_nombre}` : ''}</p>
                                        </td>
                                        <td className="px-5 py-3 text-sm">
                                            <p className="font-semibold">{f.cliente_nombre}</p>
                                            {f.cliente_num_doc && <p className="text-[11px] text-gray-500">{f.cliente_tipo_doc} {f.cliente_num_doc}</p>}
                                        </td>
                                        <td className="px-5 py-3 text-sm">{formatFecha(f.fecha)}</td>
                                        <td className={`px-5 py-3 text-sm ${vencido ? 'text-rose-600 font-bold' : ''}`}>
                                            {formatFecha(f.fecha_vencimiento)}
                                            {vencido && <p className="text-[11px]">{diasAtraso(f.fecha_vencimiento, hoy)} día(s) de atraso</p>}
                                        </td>
                                        <td className="px-5 py-3 text-right tabular-nums">{money(f.total_vigente)}</td>
                                        <td className="px-5 py-3 text-right tabular-nums">{money(f.monto_cobrado)}</td>
                                        <td className="px-5 py-3 text-right font-black tabular-nums">{money(f.saldo)}</td>
                                        <td className="px-5 py-3"><CobroBadge estado={f.estado_cobro} /></td>
                                        <td className="px-5 py-3">
                                            <div className="flex items-center justify-end gap-1">
                                                {Number(f.saldo) > 0 && (
                                                    <button className="btn btn-primary text-xs px-3 py-2" onClick={() => setCobroTarget(f)}><Banknote size={14} /> Cobrar</button>
                                                )}
                                                <button className="p-2 text-gray-500 hover:text-brand-600" aria-label={`Ver cobros de ${f.numero_comprobante}`} title="Historial de cobros" onClick={() => abrirDetalle(f.id)}><Eye size={16} /></button>
                                            </div>
                                        </td>
                                    </tr>
                                );
                            })}
                            {!loading && data.facturas.length === 0 && (
                                <tr><td colSpan={9} className="py-10 text-center text-gray-500">No hay cuentas que coincidan con los filtros.</td></tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            {detalle && (
                <Modal title={`Cobros de ${detalle.numero_comprobante}`} subtitle={`${detalle.cliente_nombre} · vence ${formatFecha(detalle.fecha_vencimiento)}`} onClose={() => setDetalle(null)}>
                    <div className="grid grid-cols-3 gap-3 mb-4 text-center">
                        <div className="p-3 rounded-xl bg-gray-50"><p className="text-[10px] font-black uppercase text-gray-500">Total</p><p className="font-black tabular-nums">{money(detalle.total_vigente)}</p></div>
                        <div className="p-3 rounded-xl bg-gray-50"><p className="text-[10px] font-black uppercase text-gray-500">Cobrado</p><p className="font-black tabular-nums">{money(detalle.monto_cobrado)}</p></div>
                        <div className="p-3 rounded-xl bg-amber-50"><p className="text-[10px] font-black uppercase text-amber-700">Saldo</p><p className="font-black tabular-nums text-amber-700">{money(detalle.saldo)}</p></div>
                    </div>
                    <div className="space-y-2 mb-4 max-h-[40vh] overflow-auto">
                        {detalle.cobros.map((c) => (
                            <div key={c.id} className={`flex items-center justify-between gap-3 p-3 rounded-xl border ${c.estado === 'anulado' ? 'bg-gray-50 opacity-60' : 'border-gray-100'}`}>
                                <div className="min-w-0 text-sm">
                                    <p className="font-bold">{c.tipo === 'devolucion' ? 'Devolución · ' : ''}{METODO_LABEL[c.metodo_pago]}{c.referencia ? ` · ${c.referencia}` : ''}</p>
                                    <p className="text-xs text-gray-500">{formatDateTime(c.fecha)} · {c.usuario_nombre || '-'}{c.estado === 'anulado' ? ` · ANULADO: ${c.motivo_anulacion}` : ''}</p>
                                </div>
                                <div className="flex items-center gap-2">
                                    <span className={`font-black tabular-nums ${c.tipo === 'devolucion' ? 'text-rose-600' : ''}`}>{c.tipo === 'devolucion' ? '- ' : ''}{money(c.monto)}</span>
                                    {isAdmin && c.estado === 'activo' && c.tipo === 'cobro' && (
                                        <button className="p-1.5 text-gray-400 hover:text-rose-600" aria-label={`Anular cobro ${c.id}`} onClick={() => setAnularCobro(c)}><XCircle size={16} /></button>
                                    )}
                                </div>
                            </div>
                        ))}
                        {detalle.cobros.length === 0 && <p className="text-sm text-gray-500">Sin cobros registrados.</p>}
                    </div>
                    <div className="flex gap-3">
                        <button className="btn btn-secondary flex-1" onClick={() => setDetalle(null)}>Cerrar</button>
                        {Number(detalle.saldo) > 0 && <button className="btn btn-primary flex-1" onClick={() => { setCobroTarget(detalle); setDetalle(null); }}><Banknote size={16} /> Registrar cobro</button>}
                    </div>
                </Modal>
            )}

            {cobroTarget && (
                <CobroModal
                    factura={cobroTarget}
                    onClose={() => setCobroTarget(null)}
                    onSaved={({ factura }) => {
                        setCobroTarget(null);
                        setMessage(`Cobro registrado en ${factura.numero_comprobante}. Saldo: ${money(factura.saldo)}.`);
                        refrescar(factura.id);
                    }}
                />
            )}

            {anularCobro && (
                <AnularCobroModal
                    cobro={anularCobro}
                    onClose={() => setAnularCobro(null)}
                    onDone={({ factura }) => {
                        setAnularCobro(null);
                        setMessage(`Cobro anulado. Saldo de ${factura.numero_comprobante}: ${money(factura.saldo)}.`);
                        refrescar(factura.id);
                    }}
                />
            )}
        </div>
    );
};

export default CuentasPorCobrar;
