import React, { useCallback, useEffect, useState } from 'react';
import {
    Wallet, Plus, Search, Download, XCircle, Eye, CreditCard, Receipt, Tags, Clock, AlertCircle, Edit2, Banknote
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { SUPERADMIN } from '../security/accessControl';
import { addDaysYmd, formatDateTime, startOfMonthYmd, toPeruYmd } from '../utils/dateTime';
import { descargarReporteGastos } from '../utils/exportGastos';
import { descargarCuentasPorPagar } from '../utils/exportCuentas';

const TIPOS_DOCUMENTO = [
    { value: 'factura', label: 'Factura' },
    { value: 'boleta', label: 'Boleta' },
    { value: 'ticket', label: 'Ticket' },
    { value: 'recibo_servicios', label: 'Recibo de servicios' },
    { value: 'recibo_honorarios', label: 'Recibo por honorarios' },
    { value: 'tributo', label: 'Tributo / licencia' },
    { value: 'sin_comprobante', label: 'Sin comprobante' }
];
const TIPO_LABEL = Object.fromEntries(TIPOS_DOCUMENTO.map((t) => [t.value, t.label]));
const DOCUMENTOS_CON_NUMERO = ['factura', 'boleta', 'recibo_servicios', 'recibo_honorarios'];
const DOCUMENTOS_SIN_IGV = ['recibo_honorarios', 'tributo'];

const AFECTACIONES = [
    { value: 'gravado', label: 'Gravado (con IGV)' },
    { value: 'inafecto', label: 'Inafecto' },
    { value: 'exonerado', label: 'Exonerado' }
];

const METODOS = [
    { value: 'efectivo', label: 'Efectivo' },
    { value: 'yape', label: 'Yape' },
    { value: 'plin', label: 'Plin' },
    { value: 'tarjeta', label: 'Tarjeta' },
    { value: 'transferencia', label: 'Transferencia' },
    { value: 'deposito', label: 'Deposito' }
];
const METODO_LABEL = Object.fromEntries(METODOS.map((m) => [m.value, m.label]));

const ESTADO_PAGO_STYLES = {
    pendiente: 'bg-amber-50 text-amber-700 border-amber-200',
    parcial: 'bg-sky-50 text-sky-700 border-sky-200',
    pagado: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    vencido: 'bg-rose-50 text-rose-700 border-rose-200',
    anulado: 'bg-gray-100 text-gray-500 border-gray-200'
};

const TABS = [
    { key: 'gastos', label: 'Gastos', icon: <Receipt size={16} /> },
    { key: 'porPagar', label: 'Por pagar', icon: <Clock size={16} /> },
    { key: 'pagos', label: 'Pagos', icon: <CreditCard size={16} /> },
    { key: 'categorias', label: 'Categorias', icon: <Tags size={16} />, adminOnly: true }
];

const money = (value) => `S/ ${Number(value || 0).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const formatFecha = (ymd) => (ymd ? new Date(`${ymd}T00:00:00`).toLocaleDateString('es-PE', { day: '2-digit', month: 'short', year: 'numeric' }) : '-');
const comprobante = (g) => (g.tipo_documento === 'sin_comprobante'
    ? 'Sin comprobante'
    : `${TIPO_LABEL[g.tipo_documento]}${g.numero ? ` ${g.serie ? `${g.serie}-` : ''}${g.numero}` : ''}`);

const readJson = async (res, fallback) => {
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || fallback);
    return body;
};

const emptyGastoForm = (today) => ({
    proveedor_id: '',
    beneficiario: '',
    documento_identidad: '',
    categoria_id: '',
    fecha: today,
    tipo_documento: 'boleta',
    serie: '',
    numero: '',
    descripcion: '',
    afectacion: 'gravado',
    tasa_igv: 18,
    importe: '',
    condicion_pago: 'contado',
    fecha_vencimiento: '',
    metodo_pago: 'efectivo',
    referencia: '',
    observacion: ''
});

const Gastos = () => {
    const { isSuperadmin, activeProfile, baseProfile, sedes, activeSede, activeSedeId } = useAuth();
    const isAdmin = baseProfile === 'administrador' || activeProfile === SUPERADMIN;
    const today = toPeruYmd();
    const defaultSede = activeSedeId ? String(activeSedeId) : 'todas';

    const [tab, setTab] = useState('gastos');
    const [message, setMessage] = useState('');
    const [error, setError] = useState('');

    const [opciones, setOpciones] = useState({ categorias: [], proveedores: [], igv_default: 18 });

    const [gastoFilters, setGastoFilters] = useState({ desde: startOfMonthYmd(today), hasta: today, sede: defaultSede, categoria: '', estado: '', q: '' });
    const [gastosData, setGastosData] = useState({ gastos: [], resumen: null });
    const [porPagarSede, setPorPagarSede] = useState(defaultSede);
    const [porPagarPeriodo, setPorPagarPeriodo] = useState({ desde: addDaysYmd(today, -90), hasta: today });
    const [porPagarData, setPorPagarData] = useState({ gastos: [], resumen: null });
    const [pagoFilters, setPagoFilters] = useState({ desde: startOfMonthYmd(today), hasta: today, sede: defaultSede, metodo: '', estado: '' });
    const [pagosData, setPagosData] = useState({ pagos: [], resumen: null });
    const [categorias, setCategorias] = useState([]);
    const [loading, setLoading] = useState(false);
    const [exporting, setExporting] = useState(false);

    const [gastoForm, setGastoForm] = useState(null);
    const [pagoTarget, setPagoTarget] = useState(null);
    const [detalle, setDetalle] = useState(null);
    const [anular, setAnular] = useState(null); // { tipo: 'gasto'|'pago', id, titulo }
    const [categoriaForm, setCategoriaForm] = useState(null);

    const sedeParam = useCallback((params, sede) => {
        if (isSuperadmin) params.set('sede_id', sede);
    }, [isSuperadmin]);

    const loadOpciones = useCallback(async () => {
        try {
            setOpciones(await readJson(await fetch('/api/gastos/opciones'), 'No se pudo cargar las opciones.'));
        } catch (e) {
            setError(e.message);
        }
    }, []);

    const loadGastos = useCallback(async (filters) => {
        setLoading(true);
        setError('');
        try {
            const params = new URLSearchParams({ desde: filters.desde, hasta: filters.hasta });
            sedeParam(params, filters.sede);
            if (filters.categoria) params.set('categoria_id', filters.categoria);
            if (filters.estado) params.set('estado_pago', filters.estado);
            if (filters.q.trim()) params.set('q', filters.q.trim());
            const body = await readJson(await fetch(`/api/gastos?${params}`), 'No se pudo cargar los gastos.');
            setGastosData({ gastos: body.gastos || [], resumen: body.resumen || null });
        } catch (e) {
            setError(e.message);
            setGastosData({ gastos: [], resumen: null });
        } finally {
            setLoading(false);
        }
    }, [sedeParam]);

    const loadPorPagar = useCallback(async (sede) => {
        setLoading(true);
        setError('');
        try {
            const params = new URLSearchParams();
            sedeParam(params, sede);
            const body = await readJson(await fetch(`/api/gastos/por-pagar?${params}`), 'No se pudo cargar las cuentas por pagar.');
            setPorPagarData({ gastos: body.gastos || [], resumen: body.resumen || null });
        } catch (e) {
            setError(e.message);
            setPorPagarData({ gastos: [], resumen: null });
        } finally {
            setLoading(false);
        }
    }, [sedeParam]);

    const loadPagos = useCallback(async (filters) => {
        setLoading(true);
        setError('');
        try {
            const params = new URLSearchParams({ desde: filters.desde, hasta: filters.hasta });
            sedeParam(params, filters.sede);
            if (filters.metodo) params.set('metodo_pago', filters.metodo);
            if (filters.estado) params.set('estado', filters.estado);
            const body = await readJson(await fetch(`/api/pagos-gastos?${params}`), 'No se pudo cargar los pagos.');
            setPagosData({ pagos: body.pagos || [], resumen: body.resumen || null });
        } catch (e) {
            setError(e.message);
            setPagosData({ pagos: [], resumen: null });
        } finally {
            setLoading(false);
        }
    }, [sedeParam]);

    // Reporte completo del periodo y la sede elegidos (sin los demas filtros) para analizarlo en Excel.
    const exportarReporte = async (filters) => {
        setExporting(true);
        setError('');
        try {
            const params = new URLSearchParams({ desde: filters.desde, hasta: filters.hasta });
            sedeParam(params, filters.sede);
            const [gastos, pagos] = await Promise.all([
                fetch(`/api/gastos?${params}`).then((r) => readJson(r, 'No se pudo cargar los gastos.')),
                fetch(`/api/pagos-gastos?${params}`).then((r) => readJson(r, 'No se pudo cargar los pagos.'))
            ]);
            const sedeNombre = isSuperadmin && filters.sede === 'todas'
                ? 'Todas las sedes'
                : (sedes.find((s) => String(s.id) === String(isSuperadmin ? filters.sede : activeSedeId))?.nombre || activeSede?.nombre || 'Sede');
            await descargarReporteGastos({ periodo: { desde: filters.desde, hasta: filters.hasta }, sedeNombre, gastos, pagos });
        } catch (e) {
            setError(e.message);
        } finally {
            setExporting(false);
        }
    };

    // Control de cuentas por pagar: gastos al credito del periodo con sus pagos, en el formato de la empresa.
    const exportarPorPagar = async () => {
        if (porPagarPeriodo.desde > porPagarPeriodo.hasta) { setError('La fecha inicial no puede ser posterior a la final.'); return; }
        setExporting(true);
        setError('');
        try {
            const params = new URLSearchParams({ desde: porPagarPeriodo.desde, hasta: porPagarPeriodo.hasta });
            sedeParam(params, porPagarSede);
            const body = await readJson(await fetch(`/api/gastos/por-pagar/reporte?${params}`), 'No se pudo generar el reporte.');
            if (body.gastos.length === 0) { setError('No hay gastos al crédito en el periodo seleccionado.'); return; }
            const sedeNombre = isSuperadmin && porPagarSede === 'todas'
                ? 'Todas las sedes'
                : (sedes.find((s) => String(s.id) === String(isSuperadmin ? porPagarSede : activeSedeId))?.nombre || activeSede?.nombre || 'Sede');
            await descargarCuentasPorPagar({ empresa: body.empresa, periodo: body.periodo, sedeNombre, gastos: body.gastos });
        } catch (e) {
            setError(e.message);
        } finally {
            setExporting(false);
        }
    };

    const loadCategorias = useCallback(async () => {
        setLoading(true);
        setError('');
        try {
            setCategorias(await readJson(await fetch('/api/categorias-gasto'), 'No se pudo cargar las categorias.'));
        } catch (e) {
            setError(e.message);
        } finally {
            setLoading(false);
        }
    }, []);

    // Reloads the visible tab with its current filters (after a search or a change).
    const refresh = (target = tab) => {
        if (target === 'gastos') loadGastos(gastoFilters);
        if (target === 'porPagar') loadPorPagar(porPagarSede);
        if (target === 'pagos') loadPagos(pagoFilters);
        if (target === 'categorias') loadCategorias();
    };

    useEffect(() => {
        loadOpciones();
    }, [loadOpciones]);

    useEffect(() => {
        refresh(tab);
        // Only when the tab changes; filters are applied with the Buscar button.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [tab]);

    const notify = (text) => {
        setError('');
        setMessage(text);
    };

    const openDetalle = async (gastoId) => {
        setError('');
        try {
            setDetalle(await readJson(await fetch(`/api/gastos/${gastoId}`), 'No se pudo cargar el gasto.'));
        } catch (e) {
            setError(e.message);
        }
    };

    const visibleTabs = TABS.filter((t) => !t.adminOnly || isAdmin);
    const showSedeColumn = (sede) => isSuperadmin && sede === 'todas';

    const sedeSelect = (value, onChange) => (
        <label className="block">
            <span className="text-xs font-bold text-gray-500 uppercase tracking-widest">Sede</span>
            {isSuperadmin ? (
                <select className="input mt-1.5" value={value} onChange={(e) => onChange(e.target.value)}>
                    <option value="todas">Todas las sedes</option>
                    {sedes.map((sede) => <option key={sede.id} value={sede.id}>{sede.nombre}</option>)}
                </select>
            ) : (
                <input className="input mt-1.5" value={activeSede?.nombre || ''} disabled />
            )}
        </label>
    );

    const gastoActions = (g) => (
        <div className="flex items-center justify-end gap-1">
            {g.estado === 'registrado' && Number(g.saldo) > 0 && (
                <button className="btn btn-primary text-xs px-3 py-2" onClick={() => setPagoTarget(g)}>
                    <Banknote size={14} /> Pagar
                </button>
            )}
            <button className="p-2 text-gray-500 hover:text-brand-600" onClick={() => openDetalle(g.id)} aria-label={`Ver gasto ${g.codigo}`}>
                <Eye size={16} />
            </button>
            {isAdmin && g.estado === 'registrado' && (
                <button
                    className="p-2 text-gray-500 hover:text-rose-600"
                    onClick={() => setAnular({ tipo: 'gasto', id: g.id, titulo: `Anular gasto ${g.codigo}` })}
                    aria-label={`Anular gasto ${g.codigo}`}
                >
                    <XCircle size={16} />
                </button>
            )}
        </div>
    );

    return (
        <div className="space-y-8">
            <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
                <div>
                    <h2 className="text-4xl font-display font-black tracking-tight">Gastos <span className="text-brand-600">y Pagos</span></h2>
                    <p className="text-[var(--text-secondary)] mt-2">
                        Registra los gastos del local, sus cuentas por pagar y cada pago realizado.
                    </p>
                </div>
                <button className="btn btn-primary text-sm" onClick={() => setGastoForm(emptyGastoForm(today))} disabled={!activeSedeId}>
                    <Plus size={16} /> Nuevo Gasto
                </button>
            </div>

            {message && <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-700 font-semibold">{message}</div>}
            {error && <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 font-semibold">{error}</div>}

            <div className="flex flex-wrap gap-2">
                {visibleTabs.map((t) => (
                    <button
                        key={t.key}
                        onClick={() => { setMessage(''); setTab(t.key); }}
                        aria-pressed={tab === t.key}
                        className={`flex items-center gap-2 px-4 py-2.5 rounded-2xl border font-bold text-sm transition-all ${tab === t.key
                            ? 'bg-brand-600 border-brand-600 text-white'
                            : 'bg-white border-gray-200 text-gray-600 hover:border-brand-300'}`}
                    >
                        {t.icon}{t.label}
                    </button>
                ))}
            </div>

            {tab === 'gastos' && (
                <>
                    <form
                        onSubmit={(e) => { e.preventDefault(); refresh('gastos'); }}
                        className="card p-5 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-[1fr_1fr_1.2fr_1.2fr_1fr_1.3fr_auto_auto] gap-3 items-end"
                    >
                        <label className="block">
                            <span className="text-xs font-bold text-gray-500 uppercase tracking-widest">Desde</span>
                            <input type="date" className="input mt-1.5" value={gastoFilters.desde} onChange={(e) => setGastoFilters({ ...gastoFilters, desde: e.target.value })} required />
                        </label>
                        <label className="block">
                            <span className="text-xs font-bold text-gray-500 uppercase tracking-widest">Hasta</span>
                            <input type="date" className="input mt-1.5" value={gastoFilters.hasta} min={gastoFilters.desde} onChange={(e) => setGastoFilters({ ...gastoFilters, hasta: e.target.value })} required />
                        </label>
                        {sedeSelect(gastoFilters.sede, (sede) => setGastoFilters({ ...gastoFilters, sede }))}
                        <label className="block">
                            <span className="text-xs font-bold text-gray-500 uppercase tracking-widest">Categoria</span>
                            <select className="input mt-1.5" value={gastoFilters.categoria} onChange={(e) => setGastoFilters({ ...gastoFilters, categoria: e.target.value })}>
                                <option value="">Todas</option>
                                {opciones.categorias.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
                            </select>
                        </label>
                        <label className="block">
                            <span className="text-xs font-bold text-gray-500 uppercase tracking-widest">Estado</span>
                            <select className="input mt-1.5" value={gastoFilters.estado} onChange={(e) => setGastoFilters({ ...gastoFilters, estado: e.target.value })}>
                                <option value="">Todos</option>
                                <option value="pendiente">Pendiente</option>
                                <option value="parcial">Parcial</option>
                                <option value="pagado">Pagado</option>
                                <option value="vencido">Vencido</option>
                                <option value="anulado">Anulado</option>
                            </select>
                        </label>
                        <label className="block">
                            <span className="text-xs font-bold text-gray-500 uppercase tracking-widest">Buscar</span>
                            <input className="input mt-1.5" placeholder="Beneficiario, detalle, N°" value={gastoFilters.q} onChange={(e) => setGastoFilters({ ...gastoFilters, q: e.target.value })} />
                        </label>
                        <button type="submit" className="btn btn-secondary"><Search size={16} /> Buscar</button>
                        <button type="button" className="btn btn-secondary" onClick={() => exportarReporte(gastoFilters)} disabled={exporting}><Download size={16} /> {exporting ? 'Generando...' : 'Excel'}</button>
                    </form>

                    {gastosData.resumen && (
                        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                            <SummaryTile label={`Gastos (${gastosData.resumen.cantidad})`} value={money(gastosData.resumen.importe_total)} />
                            <SummaryTile label="Pagado" value={money(gastosData.resumen.pagado)} tone="text-emerald-600" />
                            <SummaryTile label="Saldo pendiente" value={money(gastosData.resumen.saldo_pendiente)} tone="text-amber-600" />
                            <SummaryTile label="Vencido" value={money(gastosData.resumen.vencido)} tone="text-rose-600" />
                        </div>
                    )}

                    {gastosData.resumen?.por_categoria?.length > 0 && (
                        <div className="card p-5">
                            <p className="text-[10px] font-black uppercase tracking-widest text-gray-500 mb-3">Gasto por categoria</p>
                            <div className="space-y-2">
                                {gastosData.resumen.por_categoria.map((item) => (
                                    <div key={item.categoria} className="grid grid-cols-[minmax(0,160px)_1fr_auto] items-center gap-3 text-sm">
                                        <span className="font-semibold truncate" title={item.categoria}>{item.categoria}</span>
                                        <div className="h-2 rounded-full bg-gray-100 overflow-hidden">
                                            <div
                                                className="h-full bg-brand-600 rounded-full"
                                                style={{ width: `${Math.max(2, (item.importe / gastosData.resumen.importe_total) * 100)}%` }}
                                            />
                                        </div>
                                        <span className="font-black tabular-nums">{money(item.importe)}</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    <div className="card p-0 overflow-hidden">
                        <div className="overflow-x-auto">
                            <table className="w-full">
                                <thead>
                                    <tr className="text-left text-xs uppercase text-gray-500 border-b bg-gray-50/60">
                                        <th className="px-5 py-3">Fecha</th>
                                        <th className="px-5 py-3">Beneficiario / Comprobante</th>
                                        <th className="px-5 py-3">Categoria</th>
                                        {showSedeColumn(gastoFilters.sede) && <th className="px-5 py-3">Sede</th>}
                                        <th className="px-5 py-3 text-right">Importe</th>
                                        <th className="px-5 py-3 text-right">Saldo</th>
                                        <th className="px-5 py-3">Estado</th>
                                        <th className="px-5 py-3 text-right">Acciones</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {loading && <LoadingRow colSpan={8} text="Cargando gastos..." />}
                                    {!loading && gastosData.gastos.map((g) => (
                                        <tr key={g.id} className={`border-b border-gray-100 align-top ${g.estado === 'anulado' ? 'opacity-60' : ''}`}>
                                            <td className="px-5 py-4">
                                                <p className="font-bold text-sm">{formatFecha(g.fecha)}</p>
                                                <p className="text-xs text-gray-500 font-mono">{g.codigo}</p>
                                            </td>
                                            <td className="px-5 py-4">
                                                <p className="font-semibold">{g.beneficiario}</p>
                                                <p className="text-xs text-gray-500">{comprobante(g)} · {g.descripcion}</p>
                                            </td>
                                            <td className="px-5 py-4 text-sm">{g.categoria_nombre}</td>
                                            {showSedeColumn(gastoFilters.sede) && <td className="px-5 py-4 text-sm">{g.sede_nombre}</td>}
                                            <td className="px-5 py-4 text-right font-black tabular-nums">{money(g.importe)}</td>
                                            <td className="px-5 py-4 text-right tabular-nums">{money(g.saldo)}</td>
                                            <td className="px-5 py-4">
                                                <EstadoBadge estado={g.estado_pago} />
                                                <p className="text-[10px] text-gray-400 mt-1 capitalize">{g.condicion_pago}</p>
                                            </td>
                                            <td className="px-5 py-4">{gastoActions(g)}</td>
                                        </tr>
                                    ))}
                                    {!loading && gastosData.gastos.length === 0 && <EmptyRow colSpan={8} text="No hay gastos en ese rango de fechas." />}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </>
            )}

            {tab === 'porPagar' && (
                <>
                    <form onSubmit={(e) => { e.preventDefault(); refresh('porPagar'); }} className="card p-5 grid grid-cols-1 sm:grid-cols-[minmax(0,320px)_auto] gap-3 items-end">
                        {sedeSelect(porPagarSede, setPorPagarSede)}
                        <button type="submit" className="btn btn-secondary sm:w-fit"><Search size={16} /> Buscar</button>
                        <div className="sm:col-span-2 flex flex-wrap items-end gap-3 pt-3 border-t border-gray-100">
                            <label className="block">
                                <span className="text-xs font-bold text-gray-500 uppercase tracking-widest">Reporte desde</span>
                                <input type="date" className="input mt-1.5" value={porPagarPeriodo.desde} max={porPagarPeriodo.hasta} onChange={(e) => setPorPagarPeriodo({ ...porPagarPeriodo, desde: e.target.value })} />
                            </label>
                            <label className="block">
                                <span className="text-xs font-bold text-gray-500 uppercase tracking-widest">Hasta</span>
                                <input type="date" className="input mt-1.5" value={porPagarPeriodo.hasta} min={porPagarPeriodo.desde} onChange={(e) => setPorPagarPeriodo({ ...porPagarPeriodo, hasta: e.target.value })} />
                            </label>
                            <button type="button" className="btn btn-secondary" onClick={exportarPorPagar} disabled={exporting || !porPagarPeriodo.desde || !porPagarPeriodo.hasta}>
                                <Download size={16} /> {exporting ? 'Generando...' : 'Excel'}
                            </button>
                        </div>
                    </form>

                    {porPagarData.resumen && (
                        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                            <SummaryTile label="Documentos" value={porPagarData.resumen.cantidad} />
                            <SummaryTile label="Saldo total" value={money(porPagarData.resumen.saldo_total)} tone="text-amber-600" />
                            <SummaryTile label="Vencido" value={money(porPagarData.resumen.vencido)} tone="text-rose-600" />
                            <SummaryTile label="Vence en 7 dias" value={money(porPagarData.resumen.vence_7_dias)} tone="text-brand-600" />
                        </div>
                    )}

                    <div className="card p-0 overflow-hidden">
                        <div className="overflow-x-auto">
                            <table className="w-full">
                                <thead>
                                    <tr className="text-left text-xs uppercase text-gray-500 border-b bg-gray-50/60">
                                        <th className="px-5 py-3">Vencimiento</th>
                                        <th className="px-5 py-3">Beneficiario / Comprobante</th>
                                        <th className="px-5 py-3">Categoria</th>
                                        {showSedeColumn(porPagarSede) && <th className="px-5 py-3">Sede</th>}
                                        <th className="px-5 py-3 text-right">Importe</th>
                                        <th className="px-5 py-3 text-right">Pagado</th>
                                        <th className="px-5 py-3 text-right">Saldo</th>
                                        <th className="px-5 py-3">Estado</th>
                                        <th className="px-5 py-3 text-right">Acciones</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {loading && <LoadingRow colSpan={9} text="Cargando cuentas por pagar..." />}
                                    {!loading && porPagarData.gastos.map((g) => (
                                        <tr key={g.id} className="border-b border-gray-100 align-top">
                                            <td className="px-5 py-4">
                                                <p className={`font-bold text-sm ${g.estado_pago === 'vencido' ? 'text-rose-600' : ''}`}>{formatFecha(g.fecha_vencimiento)}</p>
                                                <p className="text-xs text-gray-500 font-mono">{g.codigo} · emitido {formatFecha(g.fecha)}</p>
                                            </td>
                                            <td className="px-5 py-4">
                                                <p className="font-semibold">{g.beneficiario}</p>
                                                <p className="text-xs text-gray-500">{comprobante(g)} · {g.descripcion}</p>
                                            </td>
                                            <td className="px-5 py-4 text-sm">{g.categoria_nombre}</td>
                                            {showSedeColumn(porPagarSede) && <td className="px-5 py-4 text-sm">{g.sede_nombre}</td>}
                                            <td className="px-5 py-4 text-right tabular-nums">{money(g.importe)}</td>
                                            <td className="px-5 py-4 text-right tabular-nums">{money(g.monto_pagado)}</td>
                                            <td className="px-5 py-4 text-right font-black tabular-nums">{money(g.saldo)}</td>
                                            <td className="px-5 py-4"><EstadoBadge estado={g.estado_pago} /></td>
                                            <td className="px-5 py-4">{gastoActions(g)}</td>
                                        </tr>
                                    ))}
                                    {!loading && porPagarData.gastos.length === 0 && <EmptyRow colSpan={9} text="No hay gastos pendientes de pago." />}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </>
            )}

            {tab === 'pagos' && (
                <>
                    <form
                        onSubmit={(e) => { e.preventDefault(); refresh('pagos'); }}
                        className="card p-5 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-[1fr_1fr_1.3fr_1fr_1fr_auto_auto] gap-3 items-end"
                    >
                        <label className="block">
                            <span className="text-xs font-bold text-gray-500 uppercase tracking-widest">Desde</span>
                            <input type="date" className="input mt-1.5" value={pagoFilters.desde} onChange={(e) => setPagoFilters({ ...pagoFilters, desde: e.target.value })} required />
                        </label>
                        <label className="block">
                            <span className="text-xs font-bold text-gray-500 uppercase tracking-widest">Hasta</span>
                            <input type="date" className="input mt-1.5" value={pagoFilters.hasta} min={pagoFilters.desde} onChange={(e) => setPagoFilters({ ...pagoFilters, hasta: e.target.value })} required />
                        </label>
                        {sedeSelect(pagoFilters.sede, (sede) => setPagoFilters({ ...pagoFilters, sede }))}
                        <label className="block">
                            <span className="text-xs font-bold text-gray-500 uppercase tracking-widest">Metodo</span>
                            <select className="input mt-1.5" value={pagoFilters.metodo} onChange={(e) => setPagoFilters({ ...pagoFilters, metodo: e.target.value })}>
                                <option value="">Todos</option>
                                {METODOS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
                            </select>
                        </label>
                        <label className="block">
                            <span className="text-xs font-bold text-gray-500 uppercase tracking-widest">Estado</span>
                            <select className="input mt-1.5" value={pagoFilters.estado} onChange={(e) => setPagoFilters({ ...pagoFilters, estado: e.target.value })}>
                                <option value="">Todos</option>
                                <option value="activo">Activos</option>
                                <option value="anulado">Anulados</option>
                            </select>
                        </label>
                        <button type="submit" className="btn btn-secondary"><Search size={16} /> Buscar</button>
                        <button type="button" className="btn btn-secondary" onClick={() => exportarReporte(pagoFilters)} disabled={exporting}><Download size={16} /> {exporting ? 'Generando...' : 'Excel'}</button>
                    </form>

                    {pagosData.resumen && (
                        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                            <SummaryTile label={`Pagos (${pagosData.resumen.cantidad})`} value={money(pagosData.resumen.total)} />
                            <SummaryTile label="Efectivo" value={money(pagosData.resumen.por_metodo.efectivo)} tone="text-brand-600" />
                            <SummaryTile
                                label="Yape / Plin"
                                value={money((pagosData.resumen.por_metodo.yape || 0) + (pagosData.resumen.por_metodo.plin || 0))}
                                tone="text-violet-600"
                            />
                            <SummaryTile
                                label="Banco / Tarjeta"
                                value={money((pagosData.resumen.por_metodo.transferencia || 0) + (pagosData.resumen.por_metodo.deposito || 0) + (pagosData.resumen.por_metodo.tarjeta || 0))}
                                tone="text-sky-600"
                            />
                        </div>
                    )}

                    <div className="card p-0 overflow-hidden">
                        <div className="overflow-x-auto">
                            <table className="w-full">
                                <thead>
                                    <tr className="text-left text-xs uppercase text-gray-500 border-b bg-gray-50/60">
                                        <th className="px-5 py-3">Fecha</th>
                                        <th className="px-5 py-3">Gasto</th>
                                        {showSedeColumn(pagoFilters.sede) && <th className="px-5 py-3">Sede</th>}
                                        <th className="px-5 py-3">Metodo</th>
                                        <th className="px-5 py-3 text-right">Monto</th>
                                        <th className="px-5 py-3">Registrado por</th>
                                        <th className="px-5 py-3">Estado</th>
                                        <th className="px-5 py-3 text-right">Acciones</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {loading && <LoadingRow colSpan={8} text="Cargando pagos..." />}
                                    {!loading && pagosData.pagos.map((p) => (
                                        <tr key={p.id} className={`border-b border-gray-100 align-top ${p.estado === 'anulado' ? 'opacity-60' : ''}`}>
                                            <td className="px-5 py-4 text-sm font-semibold">{formatDateTime(p.fecha)}</td>
                                            <td className="px-5 py-4">
                                                <p className="font-semibold">{p.beneficiario}</p>
                                                <p className="text-xs text-gray-500"><span className="font-mono">{p.gasto_codigo}</span> · {p.categoria_nombre}</p>
                                            </td>
                                            {showSedeColumn(pagoFilters.sede) && <td className="px-5 py-4 text-sm">{p.sede_nombre}</td>}
                                            <td className="px-5 py-4 text-sm">
                                                <p className="font-bold">{METODO_LABEL[p.metodo_pago]}</p>
                                                <p className="text-xs text-gray-500">{p.metodo_pago === 'efectivo' ? (p.caja_descripcion || 'Efectivo') : (p.referencia ? `Op. ${p.referencia}` : 'Sin N° de operación')}</p>
                                            </td>
                                            <td className="px-5 py-4 text-right font-black tabular-nums">{money(p.monto)}</td>
                                            <td className="px-5 py-4 text-sm">{p.usuario_nombre || '-'}</td>
                                            <td className="px-5 py-4">
                                                <span className={`inline-block px-2 py-1 rounded-lg border text-[10px] font-black uppercase tracking-widest ${p.estado === 'activo' ? ESTADO_PAGO_STYLES.pagado : ESTADO_PAGO_STYLES.anulado}`}>
                                                    {p.estado}
                                                </span>
                                                {p.estado === 'anulado' && p.motivo_anulacion && <p className="text-[10px] text-gray-400 mt-1 max-w-[160px]">{p.motivo_anulacion}</p>}
                                            </td>
                                            <td className="px-5 py-4">
                                                <div className="flex items-center justify-end gap-1">
                                                    <button className="p-2 text-gray-500 hover:text-brand-600" onClick={() => openDetalle(p.gasto_id)} aria-label={`Ver gasto ${p.gasto_codigo}`}>
                                                        <Eye size={16} />
                                                    </button>
                                                    {isAdmin && p.estado === 'activo' && (
                                                        <button
                                                            className="p-2 text-gray-500 hover:text-rose-600"
                                                            onClick={() => setAnular({ tipo: 'pago', id: p.id, titulo: `Anular pago #${p.id} de ${p.gasto_codigo}`, efectivo: p.metodo_pago === 'efectivo' })}
                                                            aria-label={`Anular pago ${p.id}`}
                                                        >
                                                            <XCircle size={16} />
                                                        </button>
                                                    )}
                                                </div>
                                            </td>
                                        </tr>
                                    ))}
                                    {!loading && pagosData.pagos.length === 0 && <EmptyRow colSpan={8} text="No hay pagos en ese rango de fechas." />}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </>
            )}

            {tab === 'categorias' && isAdmin && (
                <div className="card p-0 overflow-hidden">
                    <div className="flex items-center justify-between px-5 py-4 border-b">
                        <p className="text-sm text-gray-500">Las categorias son compartidas por todas las sedes.</p>
                        <button className="btn btn-primary text-xs px-3 py-2" onClick={() => setCategoriaForm({ id: null, nombre: '', afectacion: 'gravado', activo: true })}>
                            <Plus size={14} /> Nueva categoria
                        </button>
                    </div>
                    <div className="overflow-x-auto">
                        <table className="w-full">
                            <thead>
                                <tr className="text-left text-xs uppercase text-gray-500 border-b bg-gray-50/60">
                                    <th className="px-5 py-3">Nombre</th>
                                    <th className="px-5 py-3">Afectacion sugerida</th>
                                    <th className="px-5 py-3">Estado</th>
                                    <th className="px-5 py-3 text-right">Acciones</th>
                                </tr>
                            </thead>
                            <tbody>
                                {loading && <LoadingRow colSpan={4} text="Cargando categorias..." />}
                                {!loading && categorias.map((c) => (
                                    <tr key={c.id} className="border-b border-gray-100">
                                        <td className="px-5 py-3 font-semibold">{c.nombre}</td>
                                        <td className="px-5 py-3 text-sm capitalize">{c.afectacion.replace('_', ' ')}</td>
                                        <td className="px-5 py-3">
                                            <span className={`inline-block px-2 py-1 rounded-lg border text-[10px] font-black uppercase tracking-widest ${Number(c.activo) ? ESTADO_PAGO_STYLES.pagado : ESTADO_PAGO_STYLES.anulado}`}>
                                                {Number(c.activo) ? 'Activa' : 'Inactiva'}
                                            </span>
                                        </td>
                                        <td className="px-5 py-3 text-right">
                                            <button
                                                className="p-2 text-gray-500 hover:text-brand-600"
                                                onClick={() => setCategoriaForm({ id: c.id, nombre: c.nombre, afectacion: c.afectacion, activo: Boolean(Number(c.activo)) })}
                                                aria-label={`Editar categoria ${c.nombre}`}
                                            >
                                                <Edit2 size={14} />
                                            </button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {gastoForm && (
                <GastoFormModal
                    initial={gastoForm}
                    opciones={opciones}
                    sedeNombre={activeSede?.nombre}
                    sedes={isSuperadmin ? sedes : null}
                    activeSedeId={activeSedeId}
                    today={today}
                    onClose={() => setGastoForm(null)}
                    onSaved={(gasto) => {
                        setGastoForm(null);
                        notify(gasto.condicion_pago === 'contado'
                            ? `Gasto ${gasto.codigo} registrado y pagado (${money(gasto.importe)}).`
                            : `Gasto ${gasto.codigo} registrado a credito. Vence el ${formatFecha(gasto.fecha_vencimiento)}.`);
                        refresh();
                    }}
                />
            )}

            {pagoTarget && (
                <PagoModal
                    gasto={pagoTarget}
                    onClose={() => setPagoTarget(null)}
                    onSaved={({ pago, gasto }) => {
                        setPagoTarget(null);
                        notify(`Pago de ${money(pago.monto)} registrado para ${gasto.codigo}. Saldo: ${money(gasto.saldo)}.`);
                        refresh();
                        if (detalle?.id === gasto.id) openDetalle(gasto.id);
                    }}
                />
            )}

            {detalle && (
                <DetalleModal
                    gasto={detalle}
                    onClose={() => setDetalle(null)}
                    onPagar={detalle.estado === 'registrado' && Number(detalle.saldo) > 0 ? () => setPagoTarget(detalle) : null}
                />
            )}

            {anular && (
                <AnularModal
                    target={anular}
                    onClose={() => setAnular(null)}
                    onDone={(text) => {
                        setAnular(null);
                        setDetalle(null);
                        notify(text);
                        refresh();
                    }}
                />
            )}

            {categoriaForm && (
                <CategoriaModal
                    initial={categoriaForm}
                    onClose={() => setCategoriaForm(null)}
                    onSaved={(nombre) => {
                        setCategoriaForm(null);
                        notify(`Categoria "${nombre}" guardada.`);
                        loadCategorias();
                        loadOpciones();
                    }}
                />
            )}
        </div>
    );
};

const Modal = ({ title, subtitle, children, wide = false }) => (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
        <div className={`bg-white rounded-3xl p-6 sm:p-8 w-full ${wide ? 'max-w-2xl' : 'max-w-lg'} max-h-[90vh] overflow-y-auto`}>
            <h4 className="text-2xl font-black">{title}</h4>
            {subtitle && <p className="text-sm text-gray-500 mt-1">{subtitle}</p>}
            <div className="mt-5">{children}</div>
        </div>
    </div>
);

const Field = ({ label, children, className = '' }) => (
    <label className={`block ${className}`}>
        <span className="text-xs font-bold text-gray-500 uppercase tracking-widest">{label}</span>
        <div className="mt-1.5">{children}</div>
    </label>
);

const FormError = ({ text }) => (text
    ? <div className="mb-4 p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-sm font-semibold">{text}</div>
    : null);

const MetodoPagoFields = ({ metodo, referencia, onChange }) => (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="Metodo de pago">
            <select className="input" value={metodo} onChange={(e) => onChange({ metodo_pago: e.target.value })}>
                {METODOS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
            </select>
        </Field>
        {metodo === 'efectivo' ? (
            <p className="text-xs text-gray-500 self-end pb-2">El pago no se vincula a ninguna caja.</p>
        ) : (
            <Field label="N° de operacion (opcional)">
                <input className="input" value={referencia} onChange={(e) => onChange({ referencia: e.target.value })} maxLength={100} />
            </Field>
        )}
    </div>
);

const GastoFormModal = ({ initial, opciones, sedeNombre, sedes, activeSedeId, today, onClose, onSaved }) => {
    const [form, setForm] = useState(initial);
    // Solo el superadmin puede elegir la sede; el resto queda fijo en la suya.
    const [sedeId, setSedeId] = useState(activeSedeId ? String(activeSedeId) : '');
    const [saving, setSaving] = useState(false);
    const [formError, setFormError] = useState('');

    const set = (patch) => setForm((prev) => ({ ...prev, ...patch }));
    const sinComprobante = form.tipo_documento === 'sin_comprobante';
    const sinIgv = DOCUMENTOS_SIN_IGV.includes(form.tipo_documento);
    const afectacion = sinComprobante ? 'sin_comprobante' : (sinIgv && form.afectacion === 'gravado' ? 'inafecto' : form.afectacion);
    const importe = Number(form.importe) || 0;
    const tasa = Number(form.tasa_igv) || 0;
    const valor = afectacion === 'gravado' ? Math.round((importe / (1 + tasa / 100)) * 100) / 100 : importe;

    const onCategoria = (categoriaId) => {
        const categoria = opciones.categorias.find((c) => String(c.id) === categoriaId);
        set({ categoria_id: categoriaId, ...(categoria && categoria.afectacion !== 'sin_comprobante' ? { afectacion: categoria.afectacion } : {}) });
    };

    const save = async (event) => {
        event.preventDefault();
        setFormError('');
        setSaving(true);
        try {
            const body = {
                categoria_id: Number(form.categoria_id),
                proveedor_id: form.proveedor_id ? Number(form.proveedor_id) : null,
                beneficiario: form.beneficiario,
                documento_identidad: form.documento_identidad,
                fecha: form.fecha,
                tipo_documento: form.tipo_documento,
                serie: form.serie,
                numero: form.numero,
                descripcion: form.descripcion,
                afectacion,
                tasa_igv: Number(form.tasa_igv),
                importe: Number(form.importe),
                condicion_pago: form.condicion_pago,
                fecha_vencimiento: form.fecha_vencimiento,
                observacion: form.observacion,
                pago: form.condicion_pago === 'contado'
                    ? { metodo_pago: form.metodo_pago, referencia: form.referencia }
                    : undefined
            };
            const res = await fetch('/api/gastos', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', ...(sedes && sedeId ? { 'x-sede-id': sedeId } : {}) },
                body: JSON.stringify(body)
            });
            onSaved(await readJson(res, 'No se pudo registrar el gasto.'));
        } catch (e) {
            setFormError(e.message);
        } finally {
            setSaving(false);
        }
    };

    return (
        <Modal title="Nuevo Gasto" subtitle={sedes ? null : <>Sede: <span className="font-bold text-gray-700">{sedeNombre}</span></>} wide>
            <FormError text={formError} />
            <form onSubmit={save} className="space-y-4">
                {sedes && (
                    <Field label="Sede">
                        <select className="input" value={sedeId} onChange={(e) => setSedeId(e.target.value)} required>
                            <option value="">Seleccione...</option>
                            {sedes.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
                        </select>
                    </Field>
                )}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <Field label="Categoria">
                        <select className="input" value={form.categoria_id} onChange={(e) => onCategoria(e.target.value)} required>
                            <option value="">Seleccione...</option>
                            {opciones.categorias.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
                        </select>
                    </Field>
                    <Field label="Fecha del gasto">
                        <input type="date" className="input" max={today} value={form.fecha} onChange={(e) => set({ fecha: e.target.value })} required />
                    </Field>
                </div>

                <Field label="Proveedor">
                    <select className="input" value={form.proveedor_id} onChange={(e) => set({ proveedor_id: e.target.value })}>
                        <option value="">— Otro beneficiario (ingresar manualmente) —</option>
                        {opciones.proveedores.map((p) => <option key={p.id} value={p.id}>{p.razon_social} · {p.ruc}</option>)}
                    </select>
                </Field>
                {!form.proveedor_id && (
                    <div className="grid grid-cols-1 sm:grid-cols-[2fr_1fr] gap-3">
                        <Field label="Beneficiario">
                            <input className="input" placeholder="Ej. Luz del Sur, Mercado central" value={form.beneficiario} onChange={(e) => set({ beneficiario: e.target.value })} required minLength={3} maxLength={200} />
                        </Field>
                        <Field label="DNI / RUC (opcional)">
                            <input className="input" inputMode="numeric" maxLength={11} value={form.documento_identidad} onChange={(e) => set({ documento_identidad: e.target.value.replace(/\D/g, '').slice(0, 11) })} />
                        </Field>
                    </div>
                )}

                <div className="grid grid-cols-1 sm:grid-cols-[1.4fr_0.8fr_1fr] gap-3">
                    <Field label="Comprobante">
                        <select className="input" value={form.tipo_documento} onChange={(e) => set({ tipo_documento: e.target.value })}>
                            {TIPOS_DOCUMENTO.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                        </select>
                    </Field>
                    {!sinComprobante && (
                        <>
                            <Field label="Serie">
                                <input className="input" value={form.serie} onChange={(e) => set({ serie: e.target.value.toUpperCase() })} maxLength={20} />
                            </Field>
                            <Field label={DOCUMENTOS_CON_NUMERO.includes(form.tipo_documento) ? 'Numero' : 'Numero (opcional)'}>
                                <input className="input" value={form.numero} onChange={(e) => set({ numero: e.target.value })} required={DOCUMENTOS_CON_NUMERO.includes(form.tipo_documento)} maxLength={30} />
                            </Field>
                        </>
                    )}
                </div>

                <Field label="Descripcion">
                    <input className="input" placeholder="Ej. Recibo de luz de setiembre" value={form.descripcion} onChange={(e) => set({ descripcion: e.target.value })} required minLength={3} maxLength={255} />
                </Field>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <Field label="Importe total (S/)">
                        <input type="number" min="0.01" step="0.01" className="input" value={form.importe} onChange={(e) => set({ importe: e.target.value })} required />
                    </Field>
                    {!sinComprobante && (
                        <Field label="Afectacion">
                            <select className="input" value={afectacion} onChange={(e) => set({ afectacion: e.target.value })}>
                                {AFECTACIONES.filter((a) => !(sinIgv && a.value === 'gravado')).map((a) => <option key={a.value} value={a.value}>{a.label}</option>)}
                            </select>
                        </Field>
                    )}
                    {afectacion === 'gravado' && (
                        <Field label="Tasa IGV (%)">
                            <input type="number" min="1" max="100" step="0.01" className="input" value={form.tasa_igv} onChange={(e) => set({ tasa_igv: e.target.value })} required />
                        </Field>
                    )}
                </div>
                {importe > 0 && (
                    <p className="text-xs text-gray-500">
                        Valor {money(valor)} + IGV {money(importe - valor)} = <span className="font-black text-gray-700">{money(importe)}</span>
                    </p>
                )}

                <div>
                    <span className="text-xs font-bold text-gray-500 uppercase tracking-widest">Condicion de pago</span>
                    <div className="grid grid-cols-2 gap-3 mt-1.5">
                        {[
                            { value: 'contado', label: 'Contado (se paga ahora)' },
                            { value: 'credito', label: 'Credito (por pagar)' }
                        ].map((option) => (
                            <button
                                type="button"
                                key={option.value}
                                onClick={() => set({ condicion_pago: option.value })}
                                aria-pressed={form.condicion_pago === option.value}
                                className={`px-4 py-3 rounded-2xl border font-bold text-sm transition-all ${form.condicion_pago === option.value
                                    ? 'bg-brand-600 border-brand-600 text-white'
                                    : 'bg-white border-gray-200 text-gray-600 hover:border-brand-300'}`}
                            >
                                {option.label}
                            </button>
                        ))}
                    </div>
                </div>

                {form.condicion_pago === 'credito' ? (
                    <Field label="Fecha de vencimiento">
                        <input type="date" className="input" min={form.fecha} value={form.fecha_vencimiento} onChange={(e) => set({ fecha_vencimiento: e.target.value })} required />
                    </Field>
                ) : (
                    <MetodoPagoFields metodo={form.metodo_pago} referencia={form.referencia} onChange={set} />
                )}

                <Field label="Observacion (opcional)">
                    <textarea className="input min-h-[70px]" value={form.observacion} onChange={(e) => set({ observacion: e.target.value })} />
                </Field>

                <div className="flex gap-3 pt-2">
                    <button type="button" className="btn btn-secondary flex-1" onClick={onClose}>Cancelar</button>
                    <button type="submit" className="btn btn-primary flex-1" disabled={saving}>{saving ? 'Guardando...' : 'Registrar gasto'}</button>
                </div>
            </form>
        </Modal>
    );
};

const PagoModal = ({ gasto, onClose, onSaved }) => {
    const [form, setForm] = useState({ monto: Number(gasto.saldo).toFixed(2), metodo_pago: 'efectivo', referencia: '', observacion: '' });
    const [saving, setSaving] = useState(false);
    const [formError, setFormError] = useState('');
    const set = (patch) => setForm((prev) => ({ ...prev, ...patch }));

    const save = async (event) => {
        event.preventDefault();
        setFormError('');
        setSaving(true);
        try {
            const res = await fetch('/api/pagos-gastos', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ gasto_id: gasto.id, monto: Number(form.monto), metodo_pago: form.metodo_pago, referencia: form.referencia, observacion: form.observacion })
            });
            onSaved(await readJson(res, 'No se pudo registrar el pago.'));
        } catch (e) {
            setFormError(e.message);
        } finally {
            setSaving(false);
        }
    };

    return (
        <Modal title={`Pagar ${gasto.codigo}`} subtitle={`${gasto.beneficiario} · Saldo pendiente ${money(gasto.saldo)}`}>
            <FormError text={formError} />
            <form onSubmit={save} className="space-y-4">
                <Field label="Monto a pagar (S/)">
                    <input type="number" min="0.01" max={gasto.saldo} step="0.01" className="input" value={form.monto} onChange={(e) => set({ monto: e.target.value })} required />
                </Field>
                <MetodoPagoFields metodo={form.metodo_pago} referencia={form.referencia} onChange={set} />
                <Field label="Observacion (opcional)">
                    <input className="input" value={form.observacion} onChange={(e) => set({ observacion: e.target.value })} maxLength={255} />
                </Field>
                <div className="flex gap-3 pt-2">
                    <button type="button" className="btn btn-secondary flex-1" onClick={onClose}>Cancelar</button>
                    <button type="submit" className="btn btn-primary flex-1" disabled={saving}>{saving ? 'Registrando...' : 'Registrar pago'}</button>
                </div>
            </form>
        </Modal>
    );
};

const DetalleModal = ({ gasto, onClose, onPagar }) => (
    <Modal title={`Gasto ${gasto.codigo}`} subtitle={`${gasto.sede_nombre} · registrado por ${gasto.usuario_nombre || '-'}`} wide>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 text-sm">
            <Info label="Beneficiario" value={`${gasto.beneficiario}${gasto.documento_identidad ? ` (${gasto.documento_identidad})` : ''}`} />
            <Info label="Comprobante" value={comprobante(gasto)} />
            <Info label="Categoria" value={gasto.categoria_nombre} />
            <Info label="Fecha" value={formatFecha(gasto.fecha)} />
            <Info label="Condicion" value={gasto.condicion_pago === 'credito' ? `Credito · vence ${formatFecha(gasto.fecha_vencimiento)}` : 'Contado'} />
            <Info label="Afectacion" value={gasto.afectacion.replace('_', ' ')} />
            <Info label="Valor" value={money(gasto.valor)} />
            <Info label={`IGV (${Number(gasto.tasa_igv)}%)`} value={money(gasto.igv)} />
            <Info label="Importe" value={money(gasto.importe)} strong />
        </div>
        <p className="mt-4 text-sm"><span className="font-bold">Descripcion:</span> {gasto.descripcion}</p>
        {gasto.observacion && <p className="mt-1 text-sm text-gray-600">{gasto.observacion}</p>}
        {gasto.estado === 'anulado' && (
            <div className="mt-4 p-3 rounded-xl bg-gray-100 text-sm flex gap-2">
                <AlertCircle size={18} className="text-gray-500 shrink-0" />
                <span>Anulado por {gasto.anulado_por_nombre}: {gasto.motivo_anulacion}</span>
            </div>
        )}

        <div className="mt-6 flex items-center justify-between">
            <p className="text-xs font-black uppercase tracking-widest text-gray-500">Pagos</p>
            <EstadoBadge estado={gasto.estado_pago} />
        </div>
        <div className="mt-2 space-y-2">
            {gasto.pagos.map((p) => (
                <div key={p.id} className={`flex items-center justify-between gap-3 p-3 rounded-xl border ${p.estado === 'anulado' ? 'bg-gray-50 border-gray-200 opacity-60' : 'border-gray-100'}`}>
                    <div className="min-w-0">
                        <p className="text-sm font-bold">{METODO_LABEL[p.metodo_pago]} {p.referencia ? `· Op. ${p.referencia}` : ''}</p>
                        <p className="text-xs text-gray-500">{formatDateTime(p.fecha)} · {p.usuario_nombre}{p.estado === 'anulado' ? ` · ANULADO: ${p.motivo_anulacion}` : ''}</p>
                    </div>
                    <span className="font-black tabular-nums">{money(p.monto)}</span>
                </div>
            ))}
            {gasto.pagos.length === 0 && <p className="text-sm text-gray-500">Aun no tiene pagos.</p>}
        </div>
        <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
            <Info label="Pagado" value={money(gasto.monto_pagado)} />
            <Info label="Saldo" value={money(gasto.saldo)} strong />
        </div>

        <div className="flex gap-3 pt-6">
            <button type="button" className="btn btn-secondary flex-1" onClick={onClose}>Cerrar</button>
            {onPagar && (
                <button type="button" className="btn btn-primary flex-1" onClick={onPagar}>
                    <Banknote size={16} /> Registrar pago
                </button>
            )}
        </div>
    </Modal>
);

const AnularModal = ({ target, onClose, onDone }) => {
    const [motivo, setMotivo] = useState('');
    const [saving, setSaving] = useState(false);
    const [formError, setFormError] = useState('');

    const save = async (event) => {
        event.preventDefault();
        setFormError('');
        setSaving(true);
        try {
            const url = target.tipo === 'gasto' ? `/api/gastos/${target.id}/anular` : `/api/pagos-gastos/${target.id}/anular`;
            const res = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ motivo })
            });
            await readJson(res, 'No se pudo anular.');
            onDone(target.tipo === 'gasto' ? 'Gasto anulado.' : 'Pago anulado. El saldo del gasto fue restituido.');
        } catch (e) {
            setFormError(e.message);
        } finally {
            setSaving(false);
        }
    };

    return (
        <Modal
            title={target.titulo}
            subtitle={target.tipo === 'gasto'
                ? 'Solo se anulan gastos sin pagos activos. El registro se conserva como anulado.'
                : target.efectivo
                    ? 'Si el pago salió de una caja (registros anteriores), el efectivo vuelve a esa caja y debe seguir abierta.'
                    : 'El pago queda anulado y el saldo vuelve a estar pendiente.'}
        >
            <FormError text={formError} />
            <form onSubmit={save} className="space-y-4">
                <Field label="Motivo">
                    <input className="input" value={motivo} onChange={(e) => setMotivo(e.target.value)} required minLength={3} maxLength={200} autoFocus />
                </Field>
                <div className="flex gap-3 pt-2">
                    <button type="button" className="btn btn-secondary flex-1" onClick={onClose}>Volver</button>
                    <button type="submit" className="btn flex-1 bg-rose-600 hover:bg-rose-700 text-white" disabled={saving}>{saving ? 'Anulando...' : 'Anular'}</button>
                </div>
            </form>
        </Modal>
    );
};

const CategoriaModal = ({ initial, onClose, onSaved }) => {
    const [form, setForm] = useState(initial);
    const [saving, setSaving] = useState(false);
    const [formError, setFormError] = useState('');

    const save = async (event) => {
        event.preventDefault();
        setFormError('');
        setSaving(true);
        try {
            const res = await fetch(form.id ? `/api/categorias-gasto/${form.id}` : '/api/categorias-gasto', {
                method: form.id ? 'PUT' : 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ nombre: form.nombre, afectacion: form.afectacion, activo: form.activo })
            });
            const body = await readJson(res, 'No se pudo guardar la categoria.');
            onSaved(body.nombre);
        } catch (e) {
            setFormError(e.message);
        } finally {
            setSaving(false);
        }
    };

    return (
        <Modal title={form.id ? 'Editar categoria' : 'Nueva categoria'}>
            <FormError text={formError} />
            <form onSubmit={save} className="space-y-4">
                <Field label="Nombre">
                    <input className="input" value={form.nombre} onChange={(e) => setForm({ ...form, nombre: e.target.value })} required minLength={3} maxLength={100} />
                </Field>
                <Field label="Afectacion sugerida">
                    <select className="input" value={form.afectacion} onChange={(e) => setForm({ ...form, afectacion: e.target.value })}>
                        {AFECTACIONES.map((a) => <option key={a.value} value={a.value}>{a.label}</option>)}
                    </select>
                </Field>
                <label className="flex items-center gap-2 text-sm font-semibold">
                    <input type="checkbox" checked={form.activo} onChange={(e) => setForm({ ...form, activo: e.target.checked })} />
                    Activa (disponible al registrar gastos)
                </label>
                <div className="flex gap-3 pt-2">
                    <button type="button" className="btn btn-secondary flex-1" onClick={onClose}>Cancelar</button>
                    <button type="submit" className="btn btn-primary flex-1" disabled={saving}>{saving ? 'Guardando...' : 'Guardar'}</button>
                </div>
            </form>
        </Modal>
    );
};

const Info = ({ label, value, strong = false }) => (
    <div className="min-w-0">
        <p className="text-[10px] font-black uppercase tracking-widest text-gray-500">{label}</p>
        <p className={`mt-0.5 ${strong ? 'font-black text-base' : 'font-semibold'}`}>{value}</p>
    </div>
);

const EstadoBadge = ({ estado }) => (
    <span className={`inline-block px-2 py-1 rounded-lg border text-[10px] font-black uppercase tracking-widest ${ESTADO_PAGO_STYLES[estado] || ESTADO_PAGO_STYLES.pendiente}`}>
        {estado}
    </span>
);

const LoadingRow = ({ colSpan, text }) => (
    <tr><td colSpan={colSpan} className="py-10 text-center font-bold text-gray-500">{text}</td></tr>
);

const EmptyRow = ({ colSpan, text }) => (
    <tr>
        <td colSpan={colSpan} className="py-12 text-center text-gray-500">
            <Wallet className="mx-auto mb-2 text-gray-300" size={32} />
            {text}
        </td>
    </tr>
);

const SummaryTile = ({ label, value, tone = 'text-[var(--text-primary)]' }) => (
    <div className="card p-5">
        <p className="text-[10px] font-black uppercase tracking-widest text-gray-500">{label}</p>
        <p className={`text-2xl font-display font-black mt-1 tabular-nums ${tone}`}>{value ?? 0}</p>
    </div>
);

export default Gastos;
