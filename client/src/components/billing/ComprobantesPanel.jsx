import React, { useCallback, useEffect, useState } from 'react';
import { Search, Printer, FileText, Download, Send, RefreshCw, Eye, Banknote, XCircle, Receipt, Clock, ExternalLink, FileMinus } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { SUPERADMIN } from '../../security/accessControl';
import { addDaysYmd, formatDateTime, toPeruYmd } from '../../utils/dateTime';
import { descargarCuentasPorCobrar } from '../../utils/exportCuentas';
import { abrirPdf, descargarPdf, imprimirTicket, a4Path, ticketPath } from '../../utils/printDocs';
import { SunatBadge, CobroBadge, Modal, Field, ErrorBox } from './billingShared';
import NotaModal from './NotaModal';
import { TIPO_LABEL, METODOS_COBRO, METODO_LABEL, money, readJson, puedeEnviar, puedeConsultar } from './billingUtils';

const formatFecha = (ymd) => (ymd ? new Date(`${ymd}T00:00:00`).toLocaleDateString('es-PE', { day: '2-digit', month: 'short', year: 'numeric' }) : '-');

/** Issued receipts (with their SUNAT status and print formats) and the receivables of credit sales. */
const ComprobantesPanel = ({ refreshKey, onChanged }) => {
    const { isSuperadmin, activeProfile, baseProfile, sedes, activeSedeId } = useAuth();
    const isAdmin = baseProfile === 'administrador' || activeProfile === SUPERADMIN;
    const today = toPeruYmd();

    const [tab, setTab] = useState('comprobantes');
    const [filters, setFilters] = useState({ desde: today, hasta: today, sede: activeSedeId ? String(activeSedeId) : 'todas', tipo: '', estado: '', q: '' });
    const [data, setData] = useState({ facturas: [], resumen: null });
    const [cxc, setCxc] = useState({ facturas: [], resumen: null });
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [message, setMessage] = useState('');
    const [busy, setBusy] = useState('');
    const [detalle, setDetalle] = useState(null);
    const [cobroTarget, setCobroTarget] = useState(null);
    const [anularCobro, setAnularCobro] = useState(null);
    const [notaTarget, setNotaTarget] = useState(null);
    const [buscarNota, setBuscarNota] = useState(false);
    const [cxcPeriodo, setCxcPeriodo] = useState({ desde: addDaysYmd(today, -90), hasta: today });
    const [exportingCxc, setExportingCxc] = useState(false);
    const [anularNota, setAnularNota] = useState(null);

    const loadComprobantes = useCallback(async (current) => {
        setLoading(true);
        setError('');
        try {
            const params = new URLSearchParams({ desde: current.desde, hasta: current.hasta });
            if (isSuperadmin) params.set('sede_id', current.sede);
            if (current.tipo) params.set('tipo', current.tipo);
            if (current.estado) params.set('estado_sunat', current.estado);
            if (current.q.trim()) params.set('q', current.q.trim());
            const body = await readJson(await fetch(`/api/facturas?${params}`), 'No se pudo cargar los comprobantes.');
            setData({ facturas: body.facturas || [], resumen: body.resumen || null });
        } catch (e) {
            setError(e.message);
        } finally {
            setLoading(false);
        }
    }, [isSuperadmin]);

    const loadCxc = useCallback(async (sede) => {
        setLoading(true);
        setError('');
        try {
            const params = new URLSearchParams();
            if (isSuperadmin) params.set('sede_id', sede);
            const body = await readJson(await fetch(`/api/cuentas-por-cobrar?${params}`), 'No se pudo cargar las cuentas por cobrar.');
            setCxc({ facturas: body.facturas || [], resumen: body.resumen || null });
        } catch (e) {
            setError(e.message);
        } finally {
            setLoading(false);
        }
    }, [isSuperadmin]);

    const refresh = () => {
        if (tab === 'comprobantes') loadComprobantes(filters);
        else loadCxc(filters.sede);
    };

    useEffect(() => {
        refresh();
        // Reload on tab change or when the parent issues a new receipt.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [tab, refreshKey]);

    // Control de cuentas por cobrar: ventas al credito del periodo con sus cobros, en el formato de la empresa.
    const exportarCxc = async () => {
        if (cxcPeriodo.desde > cxcPeriodo.hasta) { setError('La fecha inicial no puede ser posterior a la final.'); return; }
        setExportingCxc(true);
        setError('');
        try {
            const params = new URLSearchParams({ desde: cxcPeriodo.desde, hasta: cxcPeriodo.hasta });
            if (isSuperadmin) params.set('sede_id', filters.sede);
            const body = await readJson(await fetch(`/api/cuentas-por-cobrar/reporte?${params}`), 'No se pudo generar el reporte.');
            if (body.facturas.length === 0) { setError('No hay ventas al crédito en el periodo seleccionado.'); return; }
            const sedeNombre = isSuperadmin && filters.sede === 'todas'
                ? 'Todas las sedes'
                : (sedes.find((s) => String(s.id) === String(isSuperadmin ? filters.sede : activeSedeId))?.nombre || 'Sede');
            await descargarCuentasPorCobrar({ empresa: body.empresa, periodo: body.periodo, sedeNombre, facturas: body.facturas });
        } catch (e) {
            setError(e.message);
        } finally {
            setExportingCxc(false);
        }
    };

    const openDetalle = async (id) => {
        setError('');
        try {
            setDetalle(await readJson(await fetch(`/api/facturas/${id}`), 'No se pudo cargar el comprobante.'));
        } catch (e) {
            setError(e.message);
        }
    };

    const run = async (key, action) => {
        setBusy(key);
        setError('');
        setMessage('');
        try {
            await action();
        } catch (e) {
            setError(e.message);
        } finally {
            setBusy('');
        }
    };

    const sunatAccion = (f, accion) => run(`${accion}-${f.id}`, async () => {
        const updated = await readJson(await fetch(`/api/facturas/${f.id}/${accion}`, { method: 'POST' }), `No se pudo ${accion} el comprobante.`);
        setMessage(`${updated.numero_comprobante}: ${updated.sunat_descripcion || updated.estado_sunat}`);
        if (detalle?.id === f.id) setDetalle(updated);
        refresh();
    });

    const acciones = (f) => (
        <div className="flex items-center justify-end gap-1">
            <button className="p-2 text-gray-500 hover:text-brand-600" title="Imprimir ticket" aria-label={`Imprimir ticket ${f.numero_comprobante}`}
                onClick={() => run(`t-${f.id}`, () => imprimirTicket(ticketPath(f.id)))} disabled={Boolean(busy)}>
                <Printer size={16} />
            </button>
            <button className="p-2 text-gray-500 hover:text-brand-600" title="PDF A4" aria-label={`PDF A4 ${f.numero_comprobante}`}
                onClick={() => run(`a-${f.id}`, () => abrirPdf(a4Path(f.id)))} disabled={Boolean(busy)}>
                <FileText size={16} />
            </button>
            <button className="p-2 text-gray-500 hover:text-brand-600" title={`Descargar ${f.numero_comprobante}`} aria-label={`Descargar ${f.numero_comprobante}`}
                onClick={() => run(`d-${f.id}`, () => descargarPdf(a4Path(f.id)))} disabled={Boolean(busy)}>
                <Download size={16} />
            </button>
            {puedeEnviar(f) && (
                <button className="p-2 text-gray-500 hover:text-brand-600" title="Enviar a SUNAT" aria-label={`Enviar ${f.numero_comprobante}`}
                    onClick={() => sunatAccion(f, 'enviar')} disabled={Boolean(busy)}>
                    <Send size={16} className={busy === `enviar-${f.id}` ? 'animate-pulse' : ''} />
                </button>
            )}
            {puedeConsultar(f) && (
                <button className="p-2 text-gray-500 hover:text-brand-600" title="Consultar estado en SUNAT" aria-label={`Consultar ${f.numero_comprobante}`}
                    onClick={() => sunatAccion(f, 'consultar')} disabled={Boolean(busy)}>
                    <RefreshCw size={16} className={busy === `consultar-${f.id}` ? 'animate-spin' : ''} />
                </button>
            )}
            <button className="p-2 text-gray-500 hover:text-brand-600" title="Ver detalle" aria-label={`Ver ${f.numero_comprobante}`} onClick={() => openDetalle(f.id)}>
                <Eye size={16} />
            </button>
        </div>
    );

    const showSede = isSuperadmin && filters.sede === 'todas';
    const admiteNota = (f) => isAdmin && ['boleta', 'factura'].includes(f.tipo_comprobante) && f.estado_comercial === 'vigente'
        && ['aceptado', 'observado', 'enviado'].includes(f.estado_sunat);
    const esNota = (f) => ['nota_credito', 'nota_debito'].includes(f.tipo_comprobante);

    return (
        <div className="card shadow-2xl relative overflow-hidden p-0 border-none">
            <div className="absolute top-0 left-0 w-full h-1.5 bg-gray-900"></div>
            <div className="p-6 sm:p-8 border-b border-gray-100 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                <div className="flex items-center gap-4">
                    <div className="w-12 h-12 bg-white rounded-2xl flex items-center justify-center text-gray-900 shadow-sm border border-gray-100">
                        <Receipt size={22} />
                    </div>
                    <div>
                        <h3 className="text-xl font-display font-black tracking-tight">Comprobantes</h3>
                        <p className="text-[10px] font-black text-gray-500 uppercase tracking-widest">Boletas, facturas, notas de venta y creditos</p>
                    </div>
                </div>
                <div className="flex flex-wrap gap-2">
                    {isAdmin && (
                        <button onClick={() => setBuscarNota(true)} className="flex items-center gap-2 px-4 py-2 rounded-2xl border font-bold text-sm bg-brand-600 border-brand-600 text-white hover:bg-brand-700">
                            <FileMinus size={14} /> Nueva nota de crédito / débito
                        </button>
                    )}
                    {[{ key: 'comprobantes', label: 'Emitidos', icon: <Receipt size={14} /> }, { key: 'cxc', label: 'Cuentas por cobrar', icon: <Clock size={14} /> }].map((t) => (
                        <button key={t.key} onClick={() => { setMessage(''); setTab(t.key); }} aria-pressed={tab === t.key}
                            className={`flex items-center gap-2 px-4 py-2 rounded-2xl border font-bold text-sm transition-all ${tab === t.key ? 'bg-gray-900 border-gray-900 text-white' : 'bg-white border-gray-200 text-gray-600 hover:border-gray-400'}`}>
                            {t.icon}{t.label}
                        </button>
                    ))}
                </div>
            </div>

            <div className="p-6 sm:p-8 space-y-5">
                {message && <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-700 font-semibold text-sm">{message}</div>}
                {error && <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 font-semibold text-sm">{error}</div>}

                {tab === 'comprobantes' && (
                    <>
                        <form onSubmit={(e) => { e.preventDefault(); loadComprobantes(filters); }}
                            className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-[1fr_1fr_1.2fr_1fr_1.1fr_1.3fr_auto] gap-3 items-end">
                            <Field label="Desde"><input type="date" className="input" value={filters.desde} onChange={(e) => setFilters({ ...filters, desde: e.target.value })} required /></Field>
                            <Field label="Hasta"><input type="date" className="input" value={filters.hasta} min={filters.desde} onChange={(e) => setFilters({ ...filters, hasta: e.target.value })} required /></Field>
                            <Field label="Sede">
                                {isSuperadmin ? (
                                    <select className="input" value={filters.sede} onChange={(e) => setFilters({ ...filters, sede: e.target.value })}>
                                        <option value="todas">Todas</option>
                                        {sedes.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
                                    </select>
                                ) : <input className="input" value="Mi sede" disabled />}
                            </Field>
                            <Field label="Tipo">
                                <select className="input" value={filters.tipo} onChange={(e) => setFilters({ ...filters, tipo: e.target.value })}>
                                    <option value="">Todos</option>
                                    <option value="boleta">Boletas</option>
                                    <option value="factura">Facturas</option>
                                    <option value="nota_venta">Notas de venta</option>
                                    <option value="nota_credito">Notas de crédito</option>
                                    <option value="nota_debito">Notas de débito</option>
                                </select>
                            </Field>
                            <Field label="Estado SUNAT">
                                <select className="input" value={filters.estado} onChange={(e) => setFilters({ ...filters, estado: e.target.value })}>
                                    <option value="">Todos</option>
                                    <option value="aceptado">Aceptado</option>
                                    <option value="enviado">Enviado</option>
                                    <option value="pendiente">Pendiente</option>
                                    <option value="error">Error</option>
                                    <option value="incierto">Por confirmar</option>
                                    <option value="rechazado">Rechazado</option>
                                    <option value="no_aplica">Interno (nota de venta)</option>
                                </select>
                            </Field>
                            <Field label="Buscar"><input className="input" placeholder="N°, cliente, documento" value={filters.q} onChange={(e) => setFilters({ ...filters, q: e.target.value })} /></Field>
                            <button type="submit" className="btn btn-secondary"><Search size={16} /> Buscar</button>
                        </form>

                        {data.resumen && (
                            <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
                                <Tile label={`Comprobantes (${data.resumen.cantidad})`} value={money(data.resumen.total)} />
                                <Tile label="Boletas" value={money(data.resumen.boleta)} />
                                <Tile label="Facturas" value={money(data.resumen.factura)} />
                                <Tile label="Notas de venta" value={money(data.resumen.nota_venta)} />
                                <Tile label="Por revisar en SUNAT" value={data.resumen.por_revisar} tone={data.resumen.por_revisar ? 'text-rose-600' : ''} />
                            </div>
                        )}

                        <div className="overflow-x-auto -mx-6 sm:-mx-8">
                            <table className="w-full">
                                <thead>
                                    <tr className="text-left text-xs uppercase text-gray-500 border-y bg-gray-50/60">
                                        <th className="px-5 py-3">Fecha</th>
                                        <th className="px-5 py-3">Comprobante</th>
                                        <th className="px-5 py-3">Cliente</th>
                                        {showSede && <th className="px-5 py-3">Sede</th>}
                                        <th className="px-5 py-3 text-right">Total</th>
                                        <th className="px-5 py-3">Pago</th>
                                        <th className="px-5 py-3">SUNAT</th>
                                        <th className="px-5 py-3 text-right">Acciones</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {loading && <tr><td colSpan={8} className="py-10 text-center font-bold text-gray-500">Cargando...</td></tr>}
                                    {!loading && data.facturas.map((f) => (
                                        <tr key={f.id} className="border-b border-gray-100 align-top">
                                            <td className="px-5 py-3 text-sm whitespace-nowrap">{formatDateTime(f.fecha_emision)}</td>
                                            <td className="px-5 py-3">
                                                <p className="font-black font-mono text-sm">{f.numero_comprobante}</p>
                                                <p className="text-[11px] text-gray-500">{TIPO_LABEL[f.tipo_comprobante]}{f.mesa_numero ? ` · Mesa ${f.mesa_numero}` : ''}</p>
                                                {esNota(f) && <p className="text-[11px] text-gray-500">Modifica {f.origen_numero}</p>}
                                                {f.estado_comercial === 'anulado' && <p className="text-[10px] font-black text-rose-600 uppercase">Anulado por nota de crédito</p>}
                                            </td>
                                            <td className="px-5 py-3 text-sm">
                                                <p className="font-semibold">{f.cliente_nombre}</p>
                                                {f.cliente_num_doc && <p className="text-[11px] text-gray-500">{f.cliente_tipo_doc} {f.cliente_num_doc}</p>}
                                            </td>
                                            {showSede && <td className="px-5 py-3 text-sm">{f.sede_nombre}</td>}
                                            <td className={`px-5 py-3 text-right font-black tabular-nums ${f.tipo_comprobante === 'nota_credito' ? 'text-rose-600' : ''}`}>
                                                {f.tipo_comprobante === 'nota_credito' ? `- ${money(f.total_venta)}` : money(f.total_venta)}
                                            </td>
                                            <td className="px-5 py-3">
                                                {esNota(f) ? <p className="text-xs text-gray-500">{f.motivo_descripcion}</p> : f.condicion_pago === 'credito'
                                                    ? <><p className="text-xs font-bold">Credito</p><CobroBadge estado={f.estado_cobro} /></>
                                                    : <p className="text-xs font-bold">Contado</p>}
                                            </td>
                                            <td className="px-5 py-3">
                                                <SunatBadge estado={f.estado_sunat} />
                                                {['error', 'rechazado', 'incierto'].includes(f.estado_sunat) && f.sunat_descripcion && (
                                                    <p className="text-[10px] text-rose-600 mt-1 max-w-[220px] line-clamp-2" title={f.sunat_descripcion}>{f.sunat_descripcion}</p>
                                                )}
                                            </td>
                                            <td className="px-5 py-3">{acciones(f)}</td>
                                        </tr>
                                    ))}
                                    {!loading && data.facturas.length === 0 && (
                                        <tr><td colSpan={8} className="py-10 text-center text-gray-500">No hay comprobantes en ese rango.</td></tr>
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </>
                )}

                {tab === 'cxc' && (
                    <>
                        <div className="flex flex-col sm:flex-row gap-3 sm:items-end">
                            {isSuperadmin && (
                                <Field label="Sede" className="sm:w-72">
                                    <select className="input" value={filters.sede} onChange={(e) => setFilters({ ...filters, sede: e.target.value })}>
                                        <option value="todas">Todas</option>
                                        {sedes.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
                                    </select>
                                </Field>
                            )}
                            <button className="btn btn-secondary sm:w-fit" onClick={() => loadCxc(filters.sede)}><RefreshCw size={16} /> Actualizar</button>
                            <div className="flex flex-wrap items-end gap-3 sm:ml-auto">
                                <Field label="Reporte desde"><input type="date" className="input" value={cxcPeriodo.desde} max={cxcPeriodo.hasta} onChange={(e) => setCxcPeriodo({ ...cxcPeriodo, desde: e.target.value })} /></Field>
                                <Field label="Hasta"><input type="date" className="input" value={cxcPeriodo.hasta} min={cxcPeriodo.desde} onChange={(e) => setCxcPeriodo({ ...cxcPeriodo, hasta: e.target.value })} /></Field>
                                <button className="btn btn-secondary" onClick={exportarCxc} disabled={exportingCxc || !cxcPeriodo.desde || !cxcPeriodo.hasta}>
                                    <Download size={16} /> {exportingCxc ? 'Generando...' : 'Excel'}
                                </button>
                            </div>
                        </div>
                        {cxc.resumen && (
                            <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
                                <Tile label="Documentos" value={cxc.resumen.cantidad} />
                                <Tile label="Saldo por cobrar" value={money(cxc.resumen.saldo_total)} tone="text-amber-600" />
                                <Tile label="Vencido" value={money(cxc.resumen.vencido)} tone="text-rose-600" />
                            </div>
                        )}
                        <div className="overflow-x-auto -mx-6 sm:-mx-8">
                            <table className="w-full">
                                <thead>
                                    <tr className="text-left text-xs uppercase text-gray-500 border-y bg-gray-50/60">
                                        <th className="px-5 py-3">Vencimiento</th>
                                        <th className="px-5 py-3">Comprobante</th>
                                        <th className="px-5 py-3">Cliente</th>
                                        <th className="px-5 py-3 text-right">Total</th>
                                        <th className="px-5 py-3 text-right">Cobrado</th>
                                        <th className="px-5 py-3 text-right">Saldo</th>
                                        <th className="px-5 py-3">Estado</th>
                                        <th className="px-5 py-3 text-right">Acciones</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {loading && <tr><td colSpan={8} className="py-10 text-center font-bold text-gray-500">Cargando...</td></tr>}
                                    {!loading && cxc.facturas.map((f) => (
                                        <tr key={f.id} className="border-b border-gray-100 align-top">
                                            <td className={`px-5 py-3 text-sm font-bold ${f.estado_cobro === 'vencido' ? 'text-rose-600' : ''}`}>{formatFecha(f.fecha_vencimiento)}</td>
                                            <td className="px-5 py-3">
                                                <p className="font-black font-mono text-sm">{f.numero_comprobante}</p>
                                                <p className="text-[11px] text-gray-500">{TIPO_LABEL[f.tipo_comprobante]} · {formatFecha(f.fecha)}</p>
                                            </td>
                                            <td className="px-5 py-3 text-sm">
                                                <p className="font-semibold">{f.cliente_nombre}</p>
                                                {f.cliente_num_doc && <p className="text-[11px] text-gray-500">{f.cliente_tipo_doc} {f.cliente_num_doc}</p>}
                                            </td>
                                            <td className="px-5 py-3 text-right tabular-nums">{money(f.total_venta)}</td>
                                            <td className="px-5 py-3 text-right tabular-nums">{money(f.monto_cobrado)}</td>
                                            <td className="px-5 py-3 text-right font-black tabular-nums">{money(f.saldo)}</td>
                                            <td className="px-5 py-3"><CobroBadge estado={f.estado_cobro} /></td>
                                            <td className="px-5 py-3">
                                                <div className="flex items-center justify-end gap-1">
                                                    <button className="btn btn-primary text-xs px-3 py-2" onClick={() => setCobroTarget(f)}><Banknote size={14} /> Cobrar</button>
                                                    <button className="p-2 text-gray-500 hover:text-brand-600" aria-label={`Ver ${f.numero_comprobante}`} onClick={() => openDetalle(f.id)}><Eye size={16} /></button>
                                                </div>
                                            </td>
                                        </tr>
                                    ))}
                                    {!loading && cxc.facturas.length === 0 && (
                                        <tr><td colSpan={8} className="py-10 text-center text-gray-500">No hay ventas pendientes de cobro.</td></tr>
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </>
                )}
            </div>

            {detalle && (
                <Modal title={`${TIPO_LABEL[detalle.tipo_comprobante]} ${detalle.numero_comprobante}`} subtitle={`${detalle.sede_nombre} · ${formatDateTime(detalle.fecha_emision)} · emitido por ${detalle.usuario_nombre || '-'}`} wide onClose={() => setDetalle(null)}>
                    <div className="flex flex-wrap items-center gap-2 mb-4">
                        <SunatBadge estado={detalle.estado_sunat} />
                        {detalle.ambiente === 'PRUEBAS' && <span className="text-[10px] font-black text-rose-600 uppercase tracking-widest">Ambiente de pruebas</span>}
                        {detalle.condicion_pago === 'credito' && <CobroBadge estado={detalle.estado_cobro} />}
                    </div>
                    {detalle.sunat_descripcion && <p className="text-sm text-gray-600 mb-4 break-words">{detalle.sunat_descripcion}</p>}
                    {esNota(detalle) && (
                        <div className="mb-4 p-3 rounded-xl bg-gray-50 border border-gray-100 text-sm">
                            <p>Modifica: <button className="font-black text-brand-600 font-mono" onClick={() => openDetalle(detalle.documento_origen_id)}>{detalle.origen_numero}</button></p>
                            <p className="text-gray-600">Motivo: {detalle.motivo_descripcion} · {detalle.observacion}</p>
                        </div>
                    )}
                    {detalle.estado_comercial === 'anulado' && (detalle.tipo_comprobante === 'nota_venta'
                        ? (
                            <div className="mb-4 p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-sm">
                                <p className="font-bold">Nota de venta anulada{detalle.fecha_anulacion ? ` el ${formatDateTime(detalle.fecha_anulacion)}` : ''}{detalle.anulado_por_nombre ? ` por ${detalle.anulado_por_nombre}` : ''}.</p>
                                {detalle.motivo_anulacion && <p className="mt-0.5">Motivo: {detalle.motivo_anulacion}</p>}
                            </div>
                        )
                        : <p className="mb-4 p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-sm font-bold">Comprobante anulado por nota de crédito.</p>)}
                    <div className="grid grid-cols-2 gap-3 text-sm mb-4">
                        <div><p className="text-[10px] font-black uppercase tracking-widest text-gray-500">Cliente</p><p className="font-semibold">{detalle.cliente_nombre}</p>{detalle.cliente_num_doc && <p className="text-xs text-gray-500">{detalle.cliente_tipo_doc} {detalle.cliente_num_doc}</p>}</div>
                        <div><p className="text-[10px] font-black uppercase tracking-widest text-gray-500">Pago</p><p className="font-semibold">{detalle.condicion_pago === 'credito' ? `Credito · vence ${formatFecha(detalle.fecha_vencimiento)}` : 'Contado'}</p></div>
                    </div>
                    <table className="w-full text-sm mb-3">
                        <thead><tr className="text-left text-[10px] uppercase text-gray-500 border-b"><th className="py-2">Cant.</th><th className="py-2">Descripcion</th><th className="py-2 text-right">P. Unit.</th><th className="py-2 text-right">Importe</th></tr></thead>
                        <tbody>
                            {detalle.items.map((item, index) => (
                                <tr key={index} className="border-b border-gray-50"><td className="py-1.5">{item.cantidad}</td><td className="py-1.5">{item.descripcion}</td><td className="py-1.5 text-right tabular-nums">{Number(item.precio_unitario).toFixed(2)}</td><td className="py-1.5 text-right tabular-nums">{Number(item.total).toFixed(2)}</td></tr>
                            ))}
                        </tbody>
                    </table>
                    <div className="text-sm text-right space-y-0.5 mb-4">
                        <p>Op. gravada: <span className="font-semibold tabular-nums">{money(detalle.subtotal)}</span></p>
                        <p>IGV ({Number(detalle.igv_porcentaje)}%): <span className="font-semibold tabular-nums">{money(detalle.impuesto)}</span></p>
                        <p className="text-lg font-black">Total: {money(detalle.total_venta)}</p>
                    </div>

                    {detalle.notas?.length > 0 && (
                        <>
                            <p className="text-[10px] font-black uppercase tracking-widest text-gray-500 mb-2">Notas vinculadas</p>
                            <div className="space-y-2 mb-4">
                                {detalle.notas.map((n) => (
                                    <button key={n.id} type="button" onClick={() => openDetalle(n.id)}
                                        className="w-full flex items-center justify-between gap-3 p-3 rounded-xl border border-gray-100 text-left hover:border-brand-200">
                                        <div className="min-w-0 text-sm">
                                            <p className="font-bold">{TIPO_LABEL[n.tipo_comprobante]} <span className="font-mono">{n.numero_comprobante}</span></p>
                                            <p className="text-xs text-gray-500">{n.motivo_descripcion} · {n.observacion}</p>
                                        </div>
                                        <div className="text-right shrink-0">
                                            <p className={`font-black tabular-nums ${n.tipo_comprobante === 'nota_credito' ? 'text-rose-600' : ''}`}>{n.tipo_comprobante === 'nota_credito' ? '- ' : '+ '}{money(n.total_venta)}</p>
                                            <SunatBadge estado={n.estado_sunat} />
                                        </div>
                                    </button>
                                ))}
                            </div>
                            <p className="text-sm text-right mb-4">Importe vigente: <span className="font-black">{money(detalle.total_vigente)}</span></p>
                        </>
                    )}

                    {!esNota(detalle) && <p className="text-[10px] font-black uppercase tracking-widest text-gray-500 mb-2">Cobros</p>}
                    <div className={`space-y-2 mb-4 ${esNota(detalle) ? 'hidden' : ''}`}>
                        {detalle.cobros.map((c) => (
                            <div key={c.id} className={`flex items-center justify-between gap-3 p-3 rounded-xl border ${c.estado === 'anulado' ? 'bg-gray-50 opacity-60' : 'border-gray-100'}`}>
                                <div className="min-w-0 text-sm">
                                    <p className="font-bold">{c.tipo === 'devolucion' ? 'Devolución · ' : ''}{METODO_LABEL[c.metodo_pago]}{c.referencia ? ` · ${c.referencia}` : ''}</p>
                                    <p className="text-xs text-gray-500">{formatDateTime(c.fecha)} · {c.usuario_nombre || '-'}{c.estado === 'anulado' ? ` · ANULADO: ${c.motivo_anulacion}` : ''}</p>
                                </div>
                                <div className="flex items-center gap-2">
                                    <span className={`font-black tabular-nums ${c.tipo === 'devolucion' ? 'text-rose-600' : ''}`}>{c.tipo === 'devolucion' ? '- ' : ''}{money(c.monto)}</span>
                                    {isAdmin && c.estado === 'activo' && (
                                        <button className="p-1.5 text-gray-400 hover:text-rose-600" aria-label={`Anular cobro ${c.id}`} onClick={() => setAnularCobro(c)}><XCircle size={16} /></button>
                                    )}
                                </div>
                            </div>
                        ))}
                        {detalle.cobros.length === 0 && <p className="text-sm text-gray-500">Sin cobros registrados.</p>}
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                        <button className="btn btn-primary" onClick={() => run('dt', () => imprimirTicket(ticketPath(detalle.id)))} disabled={Boolean(busy)}><Printer size={16} /> Ticket</button>
                        <button className="btn btn-secondary" onClick={() => run('da', () => abrirPdf(a4Path(detalle.id)))} disabled={Boolean(busy)}><FileText size={16} /> PDF A4</button>
                        <button className="btn btn-secondary" onClick={() => run('dd', () => descargarPdf(a4Path(detalle.id)))} disabled={Boolean(busy)}><Download size={16} /> Descargar PDF</button>
                        {puedeEnviar(detalle) && <button className="btn btn-secondary" onClick={() => sunatAccion(detalle, 'enviar')} disabled={Boolean(busy)}><Send size={16} /> Enviar a SUNAT</button>}
                        {puedeConsultar(detalle) && <button className="btn btn-secondary" onClick={() => sunatAccion(detalle, 'consultar')} disabled={Boolean(busy)}><RefreshCw size={16} /> Consultar SUNAT</button>}
                        {Number(detalle.saldo) > 0 && detalle.estado_comercial !== 'anulado' && <button className="btn btn-secondary" onClick={() => setCobroTarget(detalle)}><Banknote size={16} /> Registrar cobro</button>}
                        {isAdmin && detalle.tipo_comprobante === 'nota_venta' && detalle.estado_comercial === 'vigente' && (
                            <button className="btn bg-rose-600 hover:bg-rose-700 text-white col-span-2" onClick={() => setAnularNota(detalle)}><XCircle size={16} /> Anular nota de venta</button>
                        )}
                        {admiteNota(detalle) && <button className="btn btn-secondary col-span-2" onClick={() => setNotaTarget(detalle)}><FileMinus size={16} /> Nota de crédito / débito (modificar o anular)</button>}
                    </div>
                    {(detalle.enlace_xml || detalle.enlace_cdr || detalle.enlace_pdf) && (
                        <div className="flex flex-wrap gap-3 mt-4 text-xs font-bold">
                            {detalle.enlace_pdf && <a className="text-brand-600 inline-flex items-center gap-1" href={detalle.enlace_pdf} target="_blank" rel="noreferrer">PDF <ExternalLink size={12} /></a>}
                            {detalle.enlace_xml && <a className="text-brand-600 inline-flex items-center gap-1" href={detalle.enlace_xml} target="_blank" rel="noreferrer">XML <ExternalLink size={12} /></a>}
                            {detalle.enlace_cdr && <a className="text-brand-600 inline-flex items-center gap-1" href={detalle.enlace_cdr} target="_blank" rel="noreferrer">CDR <ExternalLink size={12} /></a>}
                        </div>
                    )}
                    <button className="btn btn-secondary w-full mt-4" onClick={() => setDetalle(null)}>Cerrar</button>
                </Modal>
            )}

            {cobroTarget && (
                <CobroModal
                    factura={cobroTarget}
                    onClose={() => setCobroTarget(null)}
                    onSaved={({ factura }) => {
                        setCobroTarget(null);
                        setMessage(`Cobro registrado en ${factura.numero_comprobante}. Saldo: ${money(factura.saldo)}.`);
                        if (detalle?.id === factura.id) openDetalle(factura.id);
                        refresh();
                        onChanged?.();
                    }}
                />
            )}

            {buscarNota && (
                <BuscarComprobanteNotaModal
                    isSuperadmin={isSuperadmin}
                    admiteNota={admiteNota}
                    onClose={() => setBuscarNota(false)}
                    onFound={(factura) => { setBuscarNota(false); setNotaTarget(factura); }}
                />
            )}

            {notaTarget && (
                <NotaModal
                    factura={notaTarget}
                    onClose={() => setNotaTarget(null)}
                    onEmitida={(nota) => {
                        setMessage(`${TIPO_LABEL[nota.tipo_comprobante]} ${nota.numero_comprobante} emitida sobre ${nota.origen_numero}.`);
                        openDetalle(nota.documento_origen_id);
                        refresh();
                        onChanged?.();
                    }}
                />
            )}

            {anularNota && (
                <AnularNotaVentaModal
                    factura={anularNota}
                    onClose={() => setAnularNota(null)}
                    onDone={(factura) => {
                        setAnularNota(null);
                        setMessage(`Nota de venta ${factura.numero_comprobante} anulada. Se devolvió el stock de los productos terminados.`);
                        setDetalle(factura);
                        refresh();
                        onChanged?.();
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
                        openDetalle(factura.id);
                        refresh();
                        onChanged?.();
                    }}
                />
            )}
        </div>
    );
};

export const CobroModal = ({ factura, onClose, onSaved }) => {
    const [form, setForm] = useState({ monto: Number(factura.saldo).toFixed(2), metodo: 'efectivo', referencia: '' });
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');
    const save = async (event) => {
        event.preventDefault();
        setSaving(true);
        setError('');
        try {
            const res = await fetch('/api/cobros', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ factura_id: factura.id, monto: Number(form.monto), metodo_pago: form.metodo, referencia: form.referencia })
            });
            onSaved(await readJson(res, 'No se pudo registrar el cobro.'));
        } catch (e) {
            setError(e.message);
        } finally {
            setSaving(false);
        }
    };
    return (
        <Modal title={`Cobrar ${factura.numero_comprobante}`} subtitle={`${factura.cliente_nombre} · Saldo ${money(factura.saldo)}`} onClose={onClose}>
            <ErrorBox text={error} />
            <form onSubmit={save} className="space-y-4">
                <Field label="Monto (S/)"><input type="number" min="0.01" max={factura.saldo} step="0.01" className="input" value={form.monto} onChange={(e) => setForm({ ...form, monto: e.target.value })} required /></Field>
                <Field label="Metodo de pago">
                    <select className="input" value={form.metodo} onChange={(e) => setForm({ ...form, metodo: e.target.value })}>
                        {METODOS_COBRO.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
                    </select>
                </Field>
                {form.metodo === 'efectivo'
                    ? <p className="text-xs text-gray-500">La cobranza no se vincula a ninguna caja.</p>
                    : <Field label="N° de operacion (opcional)"><input className="input" value={form.referencia} onChange={(e) => setForm({ ...form, referencia: e.target.value })} maxLength={100} /></Field>}
                <div className="flex gap-3 pt-2">
                    <button type="button" className="btn btn-secondary flex-1" onClick={onClose}>Cancelar</button>
                    <button type="submit" className="btn btn-primary flex-1" disabled={saving}>{saving ? 'Registrando...' : 'Registrar cobro'}</button>
                </div>
            </form>
        </Modal>
    );
};

const AnularNotaVentaModal = ({ factura, onClose, onDone }) => {
    const [motivo, setMotivo] = useState('');
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');
    const save = async (event) => {
        event.preventDefault();
        setSaving(true);
        setError('');
        try {
            const res = await fetch(`/api/facturas/${factura.id}/anular`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ motivo })
            });
            onDone(await readJson(res, 'No se pudo anular la nota de venta.'));
        } catch (e) {
            setError(e.message);
        } finally {
            setSaving(false);
        }
    };
    return (
        <Modal title={`Anular ${factura.numero_comprobante}`} subtitle={`${factura.cliente_nombre} · ${money(factura.total_venta)}`} onClose={onClose}>
            <ErrorBox text={error} />
            <div className="mb-4 p-3 rounded-xl bg-amber-50 border border-amber-200 text-amber-800 text-sm space-y-1">
                <p>La nota de venta deja de contar como venta y el pedido queda cancelado.</p>
                <p>Se anulan sus cobros y vuelve el stock de los productos terminados.</p>
            </div>
            <form onSubmit={save} className="space-y-4">
                <Field label="Motivo de la anulación"><input className="input" value={motivo} onChange={(e) => setMotivo(e.target.value)} required minLength={3} maxLength={200} autoFocus /></Field>
                <div className="flex gap-3 pt-2">
                    <button type="button" className="btn btn-secondary flex-1" onClick={onClose}>Volver</button>
                    <button type="submit" className="btn flex-1 bg-rose-600 hover:bg-rose-700 text-white" disabled={saving || motivo.trim().length < 3}>{saving ? 'Anulando...' : 'Anular nota de venta'}</button>
                </div>
            </form>
        </Modal>
    );
};

export const AnularCobroModal = ({ cobro, onClose, onDone }) => {
    const [motivo, setMotivo] = useState('');
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');
    const save = async (event) => {
        event.preventDefault();
        setSaving(true);
        setError('');
        try {
            const res = await fetch(`/api/cobros/${cobro.id}/anular`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ motivo })
            });
            onDone(await readJson(res, 'No se pudo anular el cobro.'));
        } catch (e) {
            setError(e.message);
        } finally {
            setSaving(false);
        }
    };
    return (
        <Modal title={`Anular cobro de ${money(cobro.monto)}`} subtitle="El saldo vuelve a quedar pendiente. Si el cobro se registró en una caja (venta al contado), esa caja debe seguir abierta." onClose={onClose}>
            <ErrorBox text={error} />
            <form onSubmit={save} className="space-y-4">
                <Field label="Motivo"><input className="input" value={motivo} onChange={(e) => setMotivo(e.target.value)} required minLength={3} maxLength={200} /></Field>
                <div className="flex gap-3 pt-2">
                    <button type="button" className="btn btn-secondary flex-1" onClick={onClose}>Volver</button>
                    <button type="submit" className="btn flex-1 bg-rose-600 hover:bg-rose-700 text-white" disabled={saving}>{saving ? 'Anulando...' : 'Anular cobro'}</button>
                </div>
            </form>
        </Modal>
    );
};

/** Finds the receipt to modify by its series and number, like the "Nueva nota" flow of the reference system. */
const BuscarComprobanteNotaModal = ({ isSuperadmin, admiteNota, onClose, onFound }) => {
    const [form, setForm] = useState({ tipo: 'factura', serie: '', numero: '' });
    const [searching, setSearching] = useState(false);
    const [error, setError] = useState('');

    const buscar = async (event) => {
        event.preventDefault();
        setError('');
        const serie = form.serie.trim().toUpperCase();
        const numero = String(Number(form.numero));
        if (!/^[A-Z0-9]{4}$/.test(serie) || !(Number(form.numero) > 0)) {
            setError('Ingrese la serie (4 caracteres) y el número del comprobante.');
            return;
        }
        const numeroComprobante = `${serie}-${numero.padStart(8, '0')}`;
        setSearching(true);
        try {
            const params = new URLSearchParams({ desde: '2000-01-01', hasta: toPeruYmd(), q: numeroComprobante });
            if (isSuperadmin) params.set('sede_id', 'todas');
            const body = await readJson(await fetch(`/api/facturas?${params}`), 'No se pudo buscar el comprobante.');
            const factura = (body.facturas || []).find((f) => f.numero_comprobante === numeroComprobante && f.tipo_comprobante === form.tipo);
            if (!factura) throw new Error(`No se encontró la ${TIPO_LABEL[form.tipo].toLowerCase()} ${numeroComprobante}.`);
            if (!['boleta', 'factura'].includes(factura.tipo_comprobante)) throw new Error('Solo se emiten notas sobre boletas y facturas electrónicas.');
            if (factura.estado_comercial === 'anulado') throw new Error(`${numeroComprobante} ya está anulado.`);
            if (!admiteNota(factura)) throw new Error(`${numeroComprobante} debe estar enviado o aceptado por SUNAT antes de emitirle una nota.`);
            onFound(factura);
        } catch (e) {
            setError(e.message);
        } finally {
            setSearching(false);
        }
    };

    return (
        <Modal title="Nueva nota de crédito / débito" subtitle="Indique el comprobante que se modifica" onClose={onClose}>
            <ErrorBox text={error} />
            <form onSubmit={buscar} className="space-y-4">
                <Field label="Comprobante">
                    <select className="input" value={form.tipo} onChange={(e) => setForm({ ...form, tipo: e.target.value })}>
                        <option value="factura">Factura</option>
                        <option value="boleta">Boleta</option>
                    </select>
                </Field>
                <div className="grid grid-cols-[1fr_2fr] gap-3">
                    <Field label="Serie"><input className="input font-mono uppercase" placeholder={form.tipo === 'factura' ? 'F001' : 'B001'} maxLength={4} value={form.serie} onChange={(e) => setForm({ ...form, serie: e.target.value.toUpperCase() })} required /></Field>
                    <Field label="Número"><input className="input font-mono" inputMode="numeric" placeholder="00000001" value={form.numero} onChange={(e) => setForm({ ...form, numero: e.target.value.replace(/\D/g, '').slice(0, 8) })} required /></Field>
                </div>
                <div className="flex gap-3 pt-1">
                    <button type="button" className="btn btn-secondary flex-1" onClick={onClose}>Cancelar</button>
                    <button type="submit" className="btn btn-primary flex-1" disabled={searching}><Search size={16} /> {searching ? 'Buscando...' : 'Buscar y continuar'}</button>
                </div>
            </form>
        </Modal>
    );
};

const Tile = ({ label, value, tone = 'text-gray-900' }) => (
    <div className="p-4 rounded-2xl bg-gray-50 border border-gray-100">
        <p className="text-[10px] font-black uppercase tracking-widest text-gray-500">{label}</p>
        <p className={`text-xl font-display font-black mt-1 tabular-nums ${tone}`}>{value ?? 0}</p>
    </div>
);

export default ComprobantesPanel;
