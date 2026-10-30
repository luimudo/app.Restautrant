import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
    Warehouse, Plus, Edit2, Eye, ArrowRightLeft, Truck, PackageCheck, XCircle, FileText, Send, RefreshCw, ClipboardSignature, Trash2, Search,
    ClipboardList, ArrowDownToLine, ArrowUpFromLine, Download
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { SUPERADMIN } from '../security/accessControl';
import { formatDateTime, startOfMonthYmd, toPeruYmd } from '../utils/dateTime';
import { abrirPdf } from '../utils/printDocs';
import { descargarMovimientos } from '../utils/exportInventario';
import { Modal, Field, ErrorBox, ToggleGroup, SunatBadge } from '../components/billing/billingShared';
import { readJson } from '../components/billing/billingUtils';
import UbigeoSearchInput from '../components/UbigeoSearchInput';
import { useUnidades } from '../hooks/useUnidades';

const TIPO_ITEM = { insumo: 'Insumo', producto: 'Producto / bebida', equipo: 'Equipo' };
const ESTADO_TRANSFERENCIA = {
    borrador: ['bg-gray-100 text-gray-600 border-gray-200', 'Borrador'],
    en_transito: ['bg-amber-50 text-amber-700 border-amber-200', 'En tránsito'],
    recibida: ['bg-emerald-50 text-emerald-700 border-emerald-200', 'Recibida'],
    anulada: ['bg-gray-100 text-gray-400 border-gray-200', 'Anulada']
};
const ESTADO_GUIA = {
    emitida: ['bg-sky-50 text-sky-700 border-sky-200', 'Emitida'],
    recibida: ['bg-emerald-50 text-emerald-700 border-emerald-200', 'Con cargo'],
    anulada: ['bg-gray-100 text-gray-400 border-gray-200', 'Anulada']
};
const UNIDADES_SUNAT = [['NIU', 'Unidad'], ['KGM', 'Kilogramo'], ['GRM', 'Gramo'], ['LTR', 'Litro'], ['MLT', 'Mililitro'], ['BX', 'Caja'], ['PK', 'Paquete']];

const MOTIVO_MOVIMIENTO = {
    ingreso_manual: ['Ingreso manual', 'bg-emerald-50 text-emerald-700 border-emerald-200'],
    compra: ['Compra', 'bg-indigo-50 text-indigo-700 border-indigo-200'],
    egreso_manual: ['Egreso manual', 'bg-rose-50 text-rose-700 border-rose-200'],
    ajuste_manual: ['Ajuste de inventario', 'bg-blue-50 text-blue-700 border-blue-200'],
    venta: ['Venta', 'bg-violet-50 text-violet-700 border-violet-200'],
    anulacion_venta: ['Anulación de venta', 'bg-teal-50 text-teal-700 border-teal-200'],
    transferencia_salida: ['Salida por transferencia', 'bg-amber-50 text-amber-700 border-amber-200'],
    transferencia_entrada: ['Entrada por transferencia', 'bg-sky-50 text-sky-700 border-sky-200'],
    merma_transferencia: ['Merma en transferencia', 'bg-gray-100 text-gray-600 border-gray-200']
};
const MOTIVOS_MANUALES = {
    ingreso: [['ajuste_inventario', 'Ajuste de inventario'], ['stock_inicial', 'Stock inicial'], ['donacion', 'Donación / obsequio'], ['devolucion', 'Devolución'], ['otro', 'Otro']],
    egreso: [['merma', 'Merma'], ['consumo_interno', 'Consumo interno'], ['vencimiento', 'Vencimiento / deterioro'], ['ajuste_inventario', 'Ajuste de inventario'], ['otro', 'Otro']]
};

const Badge = ({ map, value }) => {
    const [style, label] = map[value] || ['bg-gray-100 text-gray-500 border-gray-200', value];
    return <span className={`inline-block px-2 py-1 rounded-lg border text-[10px] font-black uppercase tracking-widest whitespace-nowrap ${style}`}>{label}</span>;
};
const formatFecha = (ymd) => (ymd ? new Date(`${String(ymd).slice(0, 10)}T00:00:00`).toLocaleDateString('es-PE', { day: '2-digit', month: 'short', year: 'numeric' }) : '-');
const cantidad = (n) => Number(n).toLocaleString('es-PE', { maximumFractionDigits: 3 });
const postJson = async (url, body, fallback, method = 'POST') => readJson(await fetch(url, {
    method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {})
}), fallback);

const Almacenes = () => {
    const { isSuperadmin, activeProfile, baseProfile, sedes, activeSedeId } = useAuth();
    const isAdmin = baseProfile === 'administrador' || activeProfile === SUPERADMIN;
    const [tab, setTab] = useState('almacenes');
    const [message, setMessage] = useState('');
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);

    const [sedeFiltro, setSedeFiltro] = useState(activeSedeId ? String(activeSedeId) : 'todas');
    const [almacenes, setAlmacenes] = useState([]);
    const [transferencias, setTransferencias] = useState({ transferencias: [], resumen: null });
    const [estadoTr, setEstadoTr] = useState('');
    const [guias, setGuias] = useState([]);
    const [guiaFiltros, setGuiaFiltros] = useState({ tipo: '', desde: startOfMonthYmd(toPeruYmd()), hasta: toPeruYmd() });

    const [movimientos, setMovimientos] = useState([]);
    const [movPeriodo, setMovPeriodo] = useState(null); // periodo de lo que muestra la grilla (el Excel descarga lo mismo)
    const [exportando, setExportando] = useState(false);
    const [movFiltros, setMovFiltros] = useState({ motivo: '', desde: startOfMonthYmd(toPeruYmd()), hasta: toPeruYmd() });
    const [movimientoForm, setMovimientoForm] = useState(null); // { tipo: 'ingreso' | 'egreso' }

    const [almacenForm, setAlmacenForm] = useState(null);
    const [stockView, setStockView] = useState(null);
    const [nuevaTransferencia, setNuevaTransferencia] = useState(false);
    const [transferencia, setTransferencia] = useState(null);
    const [guiaInterna, setGuiaInterna] = useState(false);
    const [guiaRemitente, setGuiaRemitente] = useState(null); // { origen, id }
    const [guia, setGuia] = useState(null);

    const load = useCallback(async (target) => {
        setLoading(true);
        setError('');
        try {
            if (target === 'almacenes') {
                const params = new URLSearchParams();
                if (isSuperadmin) params.set('sede_id', sedeFiltro);
                setAlmacenes(await readJson(await fetch(`/api/almacenes?${params}`), 'No se pudo cargar los almacenes.'));
            } else if (target === 'transferencias') {
                const params = new URLSearchParams();
                if (estadoTr) params.set('estado', estadoTr);
                setTransferencias(await readJson(await fetch(`/api/transferencias?${params}`), 'No se pudo cargar las transferencias.'));
            } else if (target === 'movimientos') {
                const params = new URLSearchParams({ desde: movFiltros.desde, hasta: movFiltros.hasta });
                if (movFiltros.motivo) params.set('motivo', movFiltros.motivo);
                if (isSuperadmin) params.set('sede_id', sedeFiltro);
                setMovimientos(await readJson(await fetch(`/api/inventario/movimientos?${params}`), 'No se pudo cargar los movimientos.'));
                setMovPeriodo({ desde: movFiltros.desde, hasta: movFiltros.hasta });
            } else if (isAdmin) {
                const params = new URLSearchParams({ desde: guiaFiltros.desde, hasta: guiaFiltros.hasta });
                if (guiaFiltros.tipo) params.set('tipo', guiaFiltros.tipo);
                if (isSuperadmin) params.set('sede_id', sedeFiltro);
                setGuias((await readJson(await fetch(`/api/guias?${params}`), 'No se pudo cargar las guías.')).guias);
            }
        } catch (e) {
            setError(e.message);
        } finally {
            setLoading(false);
        }
    }, [isSuperadmin, isAdmin, sedeFiltro, estadoTr, guiaFiltros, movFiltros]);

    const exportarMovimientos = async () => {
        setExportando(true);
        setError('');
        try {
            const sedeNombre = isSuperadmin && sedeFiltro === 'todas'
                ? 'Todas las sedes'
                : (sedes.find((x) => String(x.id) === String(isSuperadmin ? sedeFiltro : activeSedeId))?.nombre || 'Sede');
            await descargarMovimientos({ periodo: movPeriodo || { desde: movFiltros.desde, hasta: movFiltros.hasta }, sedeNombre, movimientos });
        } catch (e) {
            setError('No se pudo generar el Excel de movimientos.');
        } finally {
            setExportando(false);
        }
    };

    useEffect(() => {
        load(tab);
        // Reload when the tab changes; filters apply with their buttons.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [tab]);

    const notify = (text) => { setError(''); setMessage(text); };
    const openTransferencia = async (id) => {
        try {
            setTransferencia(await readJson(await fetch(`/api/transferencias/${id}`), 'No se pudo cargar la transferencia.'));
        } catch (e) {
            setError(e.message);
        }
    };
    const openGuia = async (id) => {
        try {
            setGuia(await readJson(await fetch(`/api/guias/${id}`), 'No se pudo cargar la guía.'));
        } catch (e) {
            setError(e.message);
        }
    };
    const pdfGuia = async (id) => {
        try {
            await abrirPdf(`/api/guias/${id}/formato/a4`);
        } catch (e) {
            setError(e.message);
        }
    };

    const tabs = [
        { key: 'almacenes', label: 'Almacenes', icon: <Warehouse size={16} /> },
        { key: 'transferencias', label: 'Transferencias', icon: <ArrowRightLeft size={16} /> },
        { key: 'movimientos', label: 'Ingresos y egresos', icon: <ClipboardList size={16} /> },
        ...(isAdmin ? [{ key: 'guias', label: 'Guías de remisión', icon: <Truck size={16} /> }] : [])
    ];

    return (
        <div className="space-y-8">
            <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
                <div>
                    <h2 className="text-4xl font-display font-black tracking-tight">Almacenes <span className="text-brand-600">y Guías</span></h2>
                    <p className="text-[var(--text-secondary)] mt-2">Stock por almacén, transferencias de insumos, bebidas y equipos, y guías de remisión.</p>
                </div>
                {isAdmin && (
                    <div className="flex flex-wrap gap-2">
                        {tab === 'almacenes' && <button className="btn btn-primary text-sm" onClick={() => setAlmacenForm({})} disabled={!activeSedeId}><Plus size={16} /> Nuevo almacén</button>}
                        {tab === 'transferencias' && <button className="btn btn-primary text-sm" onClick={() => setNuevaTransferencia(true)} disabled={!activeSedeId}><Plus size={16} /> Nueva transferencia</button>}
                        {tab === 'movimientos' && (
                            <>
                                <button className="btn btn-primary text-sm" onClick={() => setMovimientoForm({ tipo: 'ingreso' })} disabled={!activeSedeId}><ArrowDownToLine size={16} /> Ingreso manual</button>
                                <button className="btn bg-rose-600 hover:bg-rose-700 text-white text-sm" onClick={() => setMovimientoForm({ tipo: 'egreso' })} disabled={!activeSedeId}><ArrowUpFromLine size={16} /> Egreso manual</button>
                            </>
                        )}
                        {tab === 'guias' && (
                            <>
                                <button className="btn btn-secondary text-sm" onClick={() => setGuiaInterna(true)} disabled={!activeSedeId}><FileText size={16} /> Guía interna libre</button>
                                <button className="btn btn-primary text-sm" onClick={() => setGuiaRemitente({ origen: 'transferencia' })} disabled={!activeSedeId}><Truck size={16} /> Guía remitente</button>
                            </>
                        )}
                    </div>
                )}
            </div>

            {message && <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-700 font-semibold">{message}</div>}
            {error && <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 font-semibold">{error}</div>}

            <div className="flex flex-wrap gap-2">
                {tabs.map((t) => (
                    <button key={t.key} onClick={() => { setMessage(''); setTab(t.key); }} aria-pressed={tab === t.key}
                        className={`flex items-center gap-2 px-4 py-2.5 rounded-2xl border font-bold text-sm transition-all ${tab === t.key ? 'bg-brand-600 border-brand-600 text-white' : 'bg-white border-gray-200 text-gray-600 hover:border-brand-300'}`}>
                        {t.icon}{t.label}
                    </button>
                ))}
            </div>

            {tab === 'almacenes' && (
                <>
                    {isSuperadmin && (
                        <div className="card p-5 flex flex-col sm:flex-row gap-3 sm:items-end">
                            <Field label="Sede" className="sm:w-72">
                                <select className="input" value={sedeFiltro} onChange={(e) => setSedeFiltro(e.target.value)}>
                                    <option value="todas">Todas las sedes</option>
                                    {sedes.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
                                </select>
                            </Field>
                            <button className="btn btn-secondary sm:w-fit" onClick={() => load('almacenes')}><Search size={16} /> Buscar</button>
                        </div>
                    )}
                    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                        {loading && <p className="font-bold text-gray-500">Cargando...</p>}
                        {!loading && almacenes.map((a) => (
                            <div key={a.id} className={`card p-5 space-y-3 ${Number(a.activo) ? '' : 'opacity-60'}`}>
                                <div className="flex items-start justify-between gap-3">
                                    <div className="min-w-0">
                                        <p className="font-black text-lg">{a.nombre}</p>
                                        <p className="text-xs text-gray-500 font-mono">{a.codigo} · {a.sede_nombre}</p>
                                    </div>
                                    <Warehouse className="text-brand-600 shrink-0" />
                                </div>
                                <div className="flex flex-wrap gap-1.5">
                                    {Number(a.para_ventas) === 1 && <span className="px-2 py-0.5 rounded-lg bg-brand-50 text-brand-700 text-[10px] font-black uppercase">Ventas</span>}
                                    {Number(a.para_compras) === 1 && <span className="px-2 py-0.5 rounded-lg bg-sky-50 text-sky-700 text-[10px] font-black uppercase">Compras</span>}
                                    {!Number(a.activo) && <span className="px-2 py-0.5 rounded-lg bg-gray-100 text-gray-500 text-[10px] font-black uppercase">Inactivo</span>}
                                </div>
                                <p className="text-sm text-gray-600">{a.direccion || 'Sin dirección'}</p>
                                <p className="text-xs text-gray-500">Ubigeo {a.ubigeo || '—'} · Establecimiento SUNAT {a.cod_establecimiento || '—'}</p>
                                <div className="grid grid-cols-3 gap-2 text-center text-xs">
                                    <div className="p-2 rounded-xl bg-gray-50"><p className="font-black text-base">{a.insumos_con_stock}</p>insumos</div>
                                    <div className="p-2 rounded-xl bg-gray-50"><p className="font-black text-base">{a.productos_con_stock}</p>productos</div>
                                    <div className="p-2 rounded-xl bg-gray-50"><p className="font-black text-base">{a.equipos}</p>equipos</div>
                                </div>
                                <div className="flex gap-2">
                                    <button className="btn btn-secondary text-xs px-3 py-2 flex-1" onClick={() => setStockView(a)}><Eye size={14} /> Ver stock</button>
                                    {isAdmin && <button className="btn btn-secondary text-xs px-3 py-2" onClick={() => setAlmacenForm(a)} aria-label={`Editar ${a.nombre}`}><Edit2 size={14} /></button>}
                                </div>
                            </div>
                        ))}
                    </div>
                    <p className="text-xs text-gray-500">Las compras entran al almacén marcado como <b>Compras</b> y las ventas descuentan del marcado como <b>Ventas</b>. Los demás reciben stock por transferencias.</p>
                </>
            )}

            {tab === 'transferencias' && (
                <>
                    <div className="card p-5 flex flex-col sm:flex-row gap-3 sm:items-end">
                        <Field label="Estado" className="sm:w-60">
                            <select className="input" value={estadoTr} onChange={(e) => setEstadoTr(e.target.value)}>
                                <option value="">Todos</option>
                                <option value="borrador">Borrador</option>
                                <option value="en_transito">En tránsito</option>
                                <option value="recibida">Recibida</option>
                                <option value="anulada">Anulada</option>
                            </select>
                        </Field>
                        <button className="btn btn-secondary sm:w-fit" onClick={() => load('transferencias')}><Search size={16} /> Buscar</button>
                    </div>
                    {transferencias.resumen && (
                        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                            <Tile label="Borradores" value={transferencias.resumen.borrador} />
                            <Tile label="En tránsito" value={transferencias.resumen.en_transito} tone="text-amber-600" />
                            <Tile label="Recibidas" value={transferencias.resumen.recibida} tone="text-emerald-600" />
                            <Tile label="Anuladas" value={transferencias.resumen.anulada} />
                        </div>
                    )}
                    <div className="card p-0 overflow-hidden">
                        <div className="overflow-x-auto">
                            <table className="w-full">
                                <thead>
                                    <tr className="text-left text-xs uppercase text-gray-500 border-b bg-gray-50/60">
                                        <th className="px-5 py-3">Transferencia</th>
                                        <th className="px-5 py-3">Origen</th>
                                        <th className="px-5 py-3">Destino</th>
                                        <th className="px-5 py-3">Ítems</th>
                                        <th className="px-5 py-3">Estado</th>
                                        <th className="px-5 py-3 text-right">Acciones</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {loading && <tr><td colSpan={6} className="py-10 text-center font-bold text-gray-500">Cargando...</td></tr>}
                                    {!loading && transferencias.transferencias.map((t) => (
                                        <tr key={t.id} className="border-b border-gray-100 align-top">
                                            <td className="px-5 py-4">
                                                <p className="font-black font-mono text-sm">{t.codigo}</p>
                                                <p className="text-xs text-gray-500">{formatDateTime(t.creado_en)} · {Number(t.interna) ? 'Interna' : 'Entre sedes'}</p>
                                            </td>
                                            <td className="px-5 py-4 text-sm"><p className="font-semibold">{t.almacen_origen_nombre}</p><p className="text-xs text-gray-500">{t.sede_origen_nombre}</p></td>
                                            <td className="px-5 py-4 text-sm"><p className="font-semibold">{t.almacen_destino_nombre}</p><p className="text-xs text-gray-500">{t.sede_destino_nombre}</p></td>
                                            <td className="px-5 py-4 text-sm">{t.lineas}{Number(t.lineas_con_diferencia) > 0 && <p className="text-[10px] font-black text-rose-600 uppercase">{t.lineas_con_diferencia} con diferencia</p>}</td>
                                            <td className="px-5 py-4"><Badge map={ESTADO_TRANSFERENCIA} value={t.estado} /></td>
                                            <td className="px-5 py-4 text-right"><button className="btn btn-secondary text-xs px-3 py-2" onClick={() => openTransferencia(t.id)}><Eye size={14} /> Ver</button></td>
                                        </tr>
                                    ))}
                                    {!loading && transferencias.transferencias.length === 0 && <tr><td colSpan={6} className="py-12 text-center text-gray-500">No hay transferencias.</td></tr>}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </>
            )}

            {tab === 'movimientos' && (
                <>
                    <form onSubmit={(e) => { e.preventDefault(); load('movimientos'); }} className="card p-5 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_1fr_auto] gap-3 items-end">
                        <Field label="Desde"><input type="date" className="input" value={movFiltros.desde} onChange={(e) => setMovFiltros({ ...movFiltros, desde: e.target.value })} /></Field>
                        <Field label="Hasta"><input type="date" className="input" value={movFiltros.hasta} onChange={(e) => setMovFiltros({ ...movFiltros, hasta: e.target.value })} /></Field>
                        <Field label="Tipo de movimiento">
                            <select className="input" value={movFiltros.motivo} onChange={(e) => setMovFiltros({ ...movFiltros, motivo: e.target.value })}>
                                <option value="">Todos</option>
                                {Object.entries(MOTIVO_MOVIMIENTO).map(([v, [label]]) => <option key={v} value={v}>{label}</option>)}
                            </select>
                        </Field>
                        <div className="flex gap-2">
                            <button type="submit" className="btn btn-secondary"><Search size={16} /> Buscar</button>
                            <button type="button" className="btn btn-secondary" onClick={exportarMovimientos} disabled={exportando || loading || movimientos.length === 0}>
                                <Download size={16} /> {exportando ? 'Generando...' : 'Excel'}
                            </button>
                        </div>
                    </form>
                    <div className="card p-0 overflow-hidden">
                        <div className="overflow-x-auto">
                            <table className="w-full">
                                <thead>
                                    <tr className="text-left text-xs uppercase text-gray-500 border-b bg-gray-50/60">
                                        <th className="px-5 py-3">Fecha</th>
                                        <th className="px-5 py-3">Almacén</th>
                                        <th className="px-5 py-3">Ítem</th>
                                        <th className="px-5 py-3">Movimiento</th>
                                        <th className="px-5 py-3 text-right">Cantidad</th>
                                        <th className="px-5 py-3">Detalle</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {loading && <tr><td colSpan={6} className="py-10 text-center font-bold text-gray-500">Cargando...</td></tr>}
                                    {!loading && movimientos.map((m) => (
                                        <tr key={m.id} className="border-b border-gray-100 align-top">
                                            <td className="px-5 py-4 text-sm whitespace-nowrap">{formatDateTime(m.fecha)}<p className="text-xs text-gray-500">{m.usuario_nombre || '—'}</p></td>
                                            <td className="px-5 py-4 text-sm"><p className="font-semibold">{m.almacen_nombre}</p><p className="text-xs text-gray-500">{m.sede_nombre}</p></td>
                                            <td className="px-5 py-4 text-sm"><p className="font-semibold">{m.item_nombre}</p><p className="text-xs text-gray-500">{TIPO_ITEM[m.tipo_item]}</p></td>
                                            <td className="px-5 py-4"><Badge map={Object.fromEntries(Object.entries(MOTIVO_MOVIMIENTO).map(([k, [l, s]]) => [k, [s, l]]))} value={m.motivo} /></td>
                                            <td className={`px-5 py-4 text-right font-black tabular-nums ${m.cantidad < 0 ? 'text-rose-600' : 'text-emerald-600'}`}>{m.cantidad > 0 ? '+' : ''}{cantidad(m.cantidad)} <span className="text-xs font-normal text-gray-500">{m.unidad}</span></td>
                                            <td className="px-5 py-4 text-sm text-gray-600 max-w-[280px]">{m.detalle || '—'}</td>
                                        </tr>
                                    ))}
                                    {!loading && movimientos.length === 0 && <tr><td colSpan={6} className="py-12 text-center text-gray-500">No hay movimientos en ese rango.</td></tr>}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </>
            )}

            {tab === 'guias' && isAdmin && (
                <>
                    <form onSubmit={(e) => { e.preventDefault(); load('guias'); }} className="card p-5 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_1fr_auto] gap-3 items-end">
                        <Field label="Desde"><input type="date" className="input" value={guiaFiltros.desde} onChange={(e) => setGuiaFiltros({ ...guiaFiltros, desde: e.target.value })} /></Field>
                        <Field label="Hasta"><input type="date" className="input" value={guiaFiltros.hasta} onChange={(e) => setGuiaFiltros({ ...guiaFiltros, hasta: e.target.value })} /></Field>
                        <Field label="Tipo">
                            <select className="input" value={guiaFiltros.tipo} onChange={(e) => setGuiaFiltros({ ...guiaFiltros, tipo: e.target.value })}>
                                <option value="">Todas</option>
                                <option value="remitente">Remitente electrónica</option>
                                <option value="interna">Internas</option>
                            </select>
                        </Field>
                        <button type="submit" className="btn btn-secondary"><Search size={16} /> Buscar</button>
                    </form>
                    <div className="card p-0 overflow-hidden">
                        <div className="overflow-x-auto">
                            <table className="w-full">
                                <thead>
                                    <tr className="text-left text-xs uppercase text-gray-500 border-b bg-gray-50/60">
                                        <th className="px-5 py-3">Guía</th>
                                        <th className="px-5 py-3">Origen</th>
                                        <th className="px-5 py-3">Destinatario / llegada</th>
                                        <th className="px-5 py-3">Estado</th>
                                        <th className="px-5 py-3 text-right">Acciones</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {loading && <tr><td colSpan={5} className="py-10 text-center font-bold text-gray-500">Cargando...</td></tr>}
                                    {!loading && guias.map((g) => (
                                        <tr key={g.id} className="border-b border-gray-100 align-top">
                                            <td className="px-5 py-4">
                                                <p className="font-black font-mono text-sm">{g.numero_guia}</p>
                                                <p className="text-xs text-gray-500">{g.tipo === 'remitente' ? 'Remitente electrónica' : 'Interna'} · {formatFecha(g.fecha_emision)}</p>
                                            </td>
                                            <td className="px-5 py-4 text-sm">{g.transferencia_codigo || (g.factura_numero ? `${g.factura_tipo === 'factura' ? 'Factura' : 'Boleta'} ${g.factura_numero}` : 'Libre')}</td>
                                            <td className="px-5 py-4 text-sm max-w-[280px]"><p className="font-semibold truncate">{g.destinatario_nombre}</p><p className="text-xs text-gray-500 truncate">{g.llegada_direccion}</p></td>
                                            <td className="px-5 py-4 space-y-1">
                                                <Badge map={ESTADO_GUIA} value={g.estado} />
                                                {g.tipo === 'remitente' && <div><SunatBadge estado={g.estado_sunat} /></div>}
                                            </td>
                                            <td className="px-5 py-4">
                                                <div className="flex justify-end gap-1">
                                                    <button className="p-2 text-gray-500 hover:text-brand-600" title="PDF" aria-label={`PDF ${g.numero_guia}`} onClick={() => pdfGuia(g.id)}><FileText size={16} /></button>
                                                    <button className="p-2 text-gray-500 hover:text-brand-600" title="Ver" aria-label={`Ver ${g.numero_guia}`} onClick={() => openGuia(g.id)}><Eye size={16} /></button>
                                                </div>
                                            </td>
                                        </tr>
                                    ))}
                                    {!loading && guias.length === 0 && <tr><td colSpan={5} className="py-12 text-center text-gray-500">No hay guías en ese rango.</td></tr>}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </>
            )}

            {almacenForm && (
                <AlmacenModal initial={almacenForm} onClose={() => setAlmacenForm(null)}
                    onSaved={(a) => { setAlmacenForm(null); notify(`Almacén ${a.nombre} guardado.`); load('almacenes'); }} />
            )}
            {stockView && <StockModal almacen={stockView} onClose={() => setStockView(null)} />}
            {movimientoForm && (
                <MovimientoModal sedeId={activeSedeId} inicial={movimientoForm} onClose={() => setMovimientoForm(null)}
                    onSaved={(r) => { setMovimientoForm(null); notify(`${r.message}: ${r.item} (${r.cantidad > 0 ? '+' : ''}${cantidad(r.cantidad)}).`); load('movimientos'); }} />
            )}
            {nuevaTransferencia && (
                <TransferenciaModal sedeId={activeSedeId} onClose={() => setNuevaTransferencia(false)}
                    onSaved={(t) => { setNuevaTransferencia(false); notify(`Transferencia ${t.codigo} creada en borrador. Despáchela para sacar el stock.`); load('transferencias'); setTransferencia(t); }} />
            )}
            {transferencia && (
                <TransferenciaDetalle transferencia={transferencia} isAdmin={isAdmin} isSuperadmin={isSuperadmin}
                    onClose={() => setTransferencia(null)}
                    onChanged={(t, text) => { notify(text); setTransferencia(t); load('transferencias'); }}
                    onPdfGuia={pdfGuia}
                    onGuiaRemitente={() => { setGuiaRemitente({ origen: 'transferencia', id: transferencia.id }); setTransferencia(null); }} />
            )}
            {guiaInterna && (
                <GuiaInternaModal sedeId={activeSedeId} onClose={() => setGuiaInterna(false)}
                    onSaved={(g) => { setGuiaInterna(false); notify(`Guía interna ${g.numero_guia} emitida.`); setTab('guias'); load('guias'); setGuia(g); }} />
            )}
            {guiaRemitente && (
                <GuiaRemitenteModal inicial={guiaRemitente} onClose={() => setGuiaRemitente(null)}
                    onSaved={(g) => { setGuiaRemitente(null); notify(`Guía remitente ${g.numero_guia}: ${g.envio_error || g.sunat_descripcion || g.estado_sunat}`); setTab('guias'); load('guias'); setGuia(g); }} />
            )}
            {guia && (
                <GuiaDetalle guia={guia} onClose={() => setGuia(null)} onPdf={pdfGuia}
                    onChanged={(g, text) => { notify(text); setGuia(g); load('guias'); }} />
            )}
        </div>
    );
};

const AlmacenModal = ({ initial, onClose, onSaved }) => {
    const editing = Boolean(initial.id);
    const [form, setForm] = useState({
        nombre: initial.nombre || '', codigo: initial.codigo || '', direccion: initial.direccion || '', ubigeo: initial.ubigeo || '',
        cod_establecimiento: initial.cod_establecimiento || '', para_ventas: Boolean(Number(initial.para_ventas)), para_compras: Boolean(Number(initial.para_compras)),
        activo: initial.activo === undefined ? true : Boolean(Number(initial.activo))
    });
    const [saving, setSaving] = useState(false);
    const [formError, setFormError] = useState('');
    const set = (patch) => setForm((prev) => ({ ...prev, ...patch }));
    const save = async (event) => {
        event.preventDefault();
        setSaving(true);
        setFormError('');
        try {
            onSaved(await postJson(editing ? `/api/almacenes/${initial.id}` : '/api/almacenes', form, 'No se pudo guardar el almacén.', editing ? 'PUT' : 'POST'));
        } catch (e) {
            setFormError(e.message);
        } finally {
            setSaving(false);
        }
    };
    return (
        <Modal title={editing ? `Editar ${initial.nombre}` : 'Nuevo almacén'} subtitle={editing ? initial.sede_nombre : 'Se crea en la sede activa'} onClose={onClose}>
            <ErrorBox text={formError} />
            <form onSubmit={save} className="space-y-4">
                <div className="grid grid-cols-[2fr_1fr] gap-3">
                    <Field label="Nombre"><input className="input" placeholder="Ej. Bar, Cocina, Almacén seco" value={form.nombre} onChange={(e) => set({ nombre: e.target.value })} required minLength={3} maxLength={120} /></Field>
                    <Field label="Código"><input className="input font-mono" placeholder="Automático" value={form.codigo} onChange={(e) => set({ codigo: e.target.value.toUpperCase() })} maxLength={20} /></Field>
                </div>
                <Field label="Dirección"><input className="input" value={form.direccion} onChange={(e) => set({ direccion: e.target.value })} maxLength={255} /></Field>
                <Field label="Ubigeo (distrito, provincia, departamento)">
                    <UbigeoSearchInput value={form.ubigeo} onSelect={(u) => set({ ubigeo: u ? u.codigo : '' })} ariaLabel="Ubigeo del almacén" />
                </Field>
                <Field label="Establecimiento SUNAT"><input className="input font-mono" inputMode="numeric" maxLength={4} placeholder="0000 = domicilio fiscal" value={form.cod_establecimiento} onChange={(e) => set({ cod_establecimiento: e.target.value.replace(/\D/g, '') })} /></Field>
                <p className="text-xs text-gray-500">El ubigeo y el código de establecimiento (registrado en SUNAT) se usan en las guías de remisión electrónicas.</p>
                <div className="space-y-2 text-sm font-semibold">
                    <label className="flex items-center gap-2"><input type="checkbox" checked={form.para_ventas} onChange={(e) => set({ para_ventas: e.target.checked })} /> Las ventas descuentan de este almacén</label>
                    <label className="flex items-center gap-2"><input type="checkbox" checked={form.para_compras} onChange={(e) => set({ para_compras: e.target.checked })} /> Las compras entran a este almacén</label>
                    {editing && <label className="flex items-center gap-2"><input type="checkbox" checked={form.activo} onChange={(e) => set({ activo: e.target.checked })} /> Activo</label>}
                </div>
                <div className="flex gap-3 pt-2">
                    <button type="button" className="btn btn-secondary flex-1" onClick={onClose}>Cancelar</button>
                    <button type="submit" className="btn btn-primary flex-1" disabled={saving}>{saving ? 'Guardando...' : 'Guardar'}</button>
                </div>
            </form>
        </Modal>
    );
};

const StockModal = ({ almacen, onClose }) => {
    const [items, setItems] = useState(null);
    const [error, setError] = useState('');
    useEffect(() => {
        fetch(`/api/almacenes/${almacen.id}/stock`).then((r) => readJson(r, 'No se pudo cargar el stock.')).then((b) => setItems(b.items)).catch((e) => setError(e.message));
    }, [almacen.id]);
    return (
        <Modal title={`Stock de ${almacen.nombre}`} subtitle={almacen.sede_nombre} wide onClose={onClose}>
            <ErrorBox text={error} />
            {!items && !error && <p className="py-6 text-center font-bold text-gray-500">Cargando...</p>}
            {items && (
                <table className="w-full text-sm">
                    <thead><tr className="text-left text-[10px] uppercase text-gray-500 border-b"><th className="py-2">Tipo</th><th className="py-2">Descripción</th><th className="py-2 text-right">Stock</th></tr></thead>
                    <tbody>
                        {items.map((i) => (
                            <tr key={`${i.tipo_item}-${i.item_id}`} className="border-b border-gray-50">
                                <td className="py-2 text-xs text-gray-500">{TIPO_ITEM[i.tipo_item]}</td>
                                <td className="py-2">{i.descripcion}{i.estado && i.estado !== 'operativo' ? <span className="text-xs text-amber-600"> · {i.estado.replace('_', ' ')}</span> : null}</td>
                                <td className={`py-2 text-right font-black tabular-nums ${i.stock < 0 ? 'text-rose-600' : ''}`}>{cantidad(i.stock)} <span className="text-xs font-normal text-gray-500">{i.unidad}</span></td>
                            </tr>
                        ))}
                        {items.length === 0 && <tr><td colSpan={3} className="py-6 text-center text-gray-500">Sin stock en este almacén.</td></tr>}
                    </tbody>
                </table>
            )}
            <button className="btn btn-secondary w-full mt-4" onClick={onClose}>Cerrar</button>
        </Modal>
    );
};

const MovimientoModal = ({ sedeId, inicial, onClose, onSaved }) => {
    const [almacenes, setAlmacenes] = useState([]);
    const [catalogo, setCatalogo] = useState({ insumo: [], producto: [] });
    const [stock, setStock] = useState([]);
    const [form, setForm] = useState({ tipo: inicial.tipo, almacen_id: '', tipo_item: 'insumo', item_id: '', cantidad: '', motivo: '', observacion: '' });
    const [saving, setSaving] = useState(false);
    const [formError, setFormError] = useState('');
    const set = (patch) => setForm((prev) => ({ ...prev, ...patch }));
    const esEgreso = form.tipo === 'egreso';

    useEffect(() => {
        fetch(`/api/almacenes?sede_id=${sedeId}`).then((r) => readJson(r, 'No se pudo cargar los almacenes.'))
            .then((rows) => {
                const activos = rows.filter((a) => Number(a.activo) && Number(a.sede_id) === Number(sedeId));
                setAlmacenes(activos);
                const principal = activos.find((a) => Number(a.para_compras)) || activos[0];
                if (principal) set({ almacen_id: String(principal.id) });
            }).catch((e) => setFormError(e.message));
        Promise.all([
            fetch('/api/insumos').then((r) => readJson(r, 'No se pudo cargar los insumos.')),
            fetch('/api/productos').then((r) => readJson(r, 'No se pudo cargar los productos.'))
        ]).then(([insumo, producto]) => setCatalogo({ insumo, producto })).catch((e) => setFormError(e.message));
    }, [sedeId]);

    // An exit can only take what the warehouse holds, so it lists the warehouse stock.
    useEffect(() => {
        if (!esEgreso || !form.almacen_id) { setStock([]); return; }
        fetch(`/api/almacenes/${form.almacen_id}/stock?disponibles=1`).then((r) => readJson(r, 'No se pudo cargar el stock.'))
            .then((b) => setStock(b.items.filter((i) => i.tipo_item !== 'equipo'))).catch((e) => setFormError(e.message));
    }, [esEgreso, form.almacen_id]);

    const opciones = esEgreso
        ? stock.filter((i) => i.tipo_item === form.tipo_item).map((i) => ({ id: i.item_id, label: `${i.descripcion} (disp. ${cantidad(i.stock)} ${i.unidad})` }))
        : (catalogo[form.tipo_item] || []).map((i) => ({ id: i.id, label: i.nombre }));
    const seleccionado = esEgreso ? stock.find((i) => i.tipo_item === form.tipo_item && String(i.item_id) === String(form.item_id)) : null;
    // A product is counted in whole numbers unless its unit allows decimals (e.g. beer by Litro).
    const productoConDecimales = form.tipo_item === 'producto' && (esEgreso
        ? Number(seleccionado?.decimales) === 1
        : Number((catalogo.producto || []).find((p) => String(p.id) === String(form.item_id))?.unidad_decimales) === 1);
    const soloEnteros = form.tipo_item === 'producto' && !productoConDecimales;

    const save = async (event) => {
        event.preventDefault();
        setSaving(true);
        setFormError('');
        try {
            onSaved(await postJson('/api/inventario/movimientos', { ...form, cantidad: Number(form.cantidad) }, 'No se pudo registrar el movimiento.'));
        } catch (e) {
            setFormError(e.message);
        } finally {
            setSaving(false);
        }
    };

    return (
        <Modal title={esEgreso ? 'Egreso manual de almacén' : 'Ingreso manual de almacén'} subtitle="Queda registrado en el historial con usuario, fecha y motivo." onClose={onClose}>
            <ErrorBox text={formError} />
            <form onSubmit={save} className="space-y-4">
                <ToggleGroup value={form.tipo} onChange={(tipo) => set({ tipo, motivo: '', item_id: '' })} options={[{ value: 'ingreso', label: 'Ingreso' }, { value: 'egreso', label: 'Egreso' }]} />
                <Field label="Almacén">
                    <select className="input" value={form.almacen_id} onChange={(e) => set({ almacen_id: e.target.value, item_id: '' })} required>
                        <option value="">Seleccione...</option>
                        {almacenes.map((a) => <option key={a.id} value={a.id}>{a.nombre}</option>)}
                    </select>
                </Field>
                <div className="grid grid-cols-[1fr_2fr] gap-3">
                    <Field label="Tipo">
                        <select className="input" value={form.tipo_item} onChange={(e) => set({ tipo_item: e.target.value, item_id: '' })}>
                            <option value="insumo">Insumo</option>
                            <option value="producto">Producto / bebida</option>
                        </select>
                    </Field>
                    <Field label="Ítem">
                        <select className="input" value={form.item_id} onChange={(e) => set({ item_id: e.target.value })} required>
                            <option value="">Seleccione...</option>
                            {opciones.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
                        </select>
                    </Field>
                </div>
                {esEgreso && form.almacen_id && opciones.length === 0 && <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-xl p-3">El almacén no tiene stock de este tipo.</p>}
                <div className="grid grid-cols-2 gap-3">
                    <Field label="Cantidad">
                        <input type="number" className="input text-right" min={soloEnteros ? 1 : 0.001} step={soloEnteros ? 1 : 0.001}
                            max={seleccionado ? seleccionado.stock : undefined} value={form.cantidad} onChange={(e) => set({ cantidad: e.target.value })} required />
                    </Field>
                    <Field label="Motivo">
                        <select className="input" value={form.motivo} onChange={(e) => set({ motivo: e.target.value })} required>
                            <option value="">Seleccione...</option>
                            {MOTIVOS_MANUALES[form.tipo].map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                        </select>
                    </Field>
                </div>
                <Field label="Observación / referencia (opcional)">
                    <input className="input" value={form.observacion} onChange={(e) => set({ observacion: e.target.value })} maxLength={200} />
                </Field>
                <div className="flex gap-3 pt-1">
                    <button type="button" className="btn btn-secondary flex-1" onClick={onClose}>Cancelar</button>
                    <button type="submit" className={`btn flex-1 ${esEgreso ? 'bg-rose-600 hover:bg-rose-700 text-white' : 'btn-primary'}`} disabled={saving}>
                        {saving ? 'Guardando...' : esEgreso ? 'Registrar egreso' : 'Registrar ingreso'}
                    </button>
                </div>
            </form>
        </Modal>
    );
};

const TransferenciaModal = ({ sedeId, onClose, onSaved }) => {
    const [origenes, setOrigenes] = useState([]);
    const [destinos, setDestinos] = useState([]);
    const [form, setForm] = useState({ almacen_origen_id: '', almacen_destino_id: '', observacion: '' });
    const [disponibles, setDisponibles] = useState([]);
    const [cantidades, setCantidades] = useState({});
    const [loadingOrigenes, setLoadingOrigenes] = useState(true);
    const [loadingStock, setLoadingStock] = useState(false);
    const [saving, setSaving] = useState(false);
    const [formError, setFormError] = useState('');

    useEffect(() => {
        setLoadingOrigenes(true);
        fetch(`/api/almacenes?sede_id=${sedeId}`).then((r) => readJson(r, 'Error')).then((rows) => setOrigenes(rows.filter((a) => Number(a.activo) && Number(a.sede_id) === Number(sedeId)))).catch((e) => setFormError(e.message)).finally(() => setLoadingOrigenes(false));
        fetch('/api/almacenes/destinos').then((r) => readJson(r, 'Error')).then(setDestinos).catch((e) => setFormError(e.message));
    }, [sedeId]);

    useEffect(() => {
        setCantidades({});
        if (!form.almacen_origen_id) { setDisponibles([]); setLoadingStock(false); return; }
        setDisponibles([]);
        setLoadingStock(true);
        fetch(`/api/almacenes/${form.almacen_origen_id}/stock?disponibles=1`).then((r) => readJson(r, 'Error')).then((b) => setDisponibles(b.items)).catch((e) => setFormError(e.message)).finally(() => setLoadingStock(false));
    }, [form.almacen_origen_id]);

    const key = (i) => `${i.tipo_item}-${i.item_id}`;
    const seleccion = disponibles.filter((i) => Number(cantidades[key(i)]) > 0);

    const save = async (event) => {
        event.preventDefault();
        setFormError('');
        if (seleccion.length === 0) { setFormError('Indique la cantidad de al menos un ítem.'); return; }
        setSaving(true);
        try {
            onSaved(await postJson('/api/transferencias', {
                ...form,
                items: seleccion.map((i) => ({ tipo_item: i.tipo_item, item_id: i.item_id, cantidad: Number(cantidades[key(i)]) }))
            }, 'No se pudo crear la transferencia.'));
        } catch (e) {
            setFormError(e.message);
        } finally {
            setSaving(false);
        }
    };

    return (
        <Modal title="Nueva transferencia" subtitle="Se crea en borrador; el stock sale del origen al despacharla." xl onClose={onClose}>
            <ErrorBox text={formError} />
            <form onSubmit={save} className="space-y-4">
                {loadingOrigenes && <p className="text-sm text-gray-500">Cargando almacenes de origen...</p>}
                {!loadingOrigenes && origenes.length === 0 && <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-xl p-3">No hay almacenes activos en esta sede para iniciar la transferencia.</p>}
                {!form.almacen_origen_id && !loadingOrigenes && origenes.length > 0 && <p className="text-sm text-gray-500">Seleccione primero el almacén de origen para consultar su stock y elegir los productos.</p>}
                {seleccion.length > 0 && <p className="text-sm font-semibold text-gray-600">{seleccion.length} ítem(s) seleccionado(s). Revise las cantidades antes de crear el borrador.</p>}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <Field label="Almacén de origen">
                        <select className="input" value={form.almacen_origen_id} onChange={(e) => setForm({ ...form, almacen_origen_id: e.target.value })} required disabled={loadingOrigenes || origenes.length === 0}>
                            <option value="">Seleccione...</option>
                            {origenes.map((a) => <option key={a.id} value={a.id}>{a.nombre}</option>)}
                        </select>
                    </Field>
                    <Field label="Almacén de destino">
                        <select className="input" value={form.almacen_destino_id} onChange={(e) => setForm({ ...form, almacen_destino_id: e.target.value })} required disabled={!form.almacen_origen_id}>
                            <option value="">Seleccione...</option>
                            {destinos.filter((a) => String(a.id) !== String(form.almacen_origen_id)).map((a) => <option key={a.id} value={a.id}>{a.sede_nombre} · {a.nombre}</option>)}
                        </select>
                    </Field>
                </div>
                {form.almacen_origen_id && (
                    <div className="space-y-2 max-h-[40vh] overflow-y-auto pr-1">
                        <span className="text-xs font-bold text-gray-500 uppercase tracking-widest">Ítems disponibles</span>
                        {loadingStock && <p className="text-sm text-gray-500 py-3">Cargando stock del almacén...</p>}
                        {!loadingStock && disponibles.map((i) => (
                            <div key={key(i)} className="grid grid-cols-[1fr_110px] gap-3 items-center p-3 rounded-xl border border-gray-100">
                                <div className="min-w-0">
                                    <p className="font-semibold text-sm truncate">{i.descripcion}</p>
                                    <p className="text-xs text-gray-500">{TIPO_ITEM[i.tipo_item]} · disponible {cantidad(i.stock)} {i.unidad}</p>
                                </div>
                                {i.tipo_item === 'equipo' ? (
                                    <label className="flex items-center justify-end gap-2 text-sm font-semibold">
                                        <input type="checkbox" checked={Number(cantidades[key(i)]) === 1} onChange={(e) => setCantidades({ ...cantidades, [key(i)]: e.target.checked ? 1 : 0 })} /> Trasladar
                                    </label>
                                ) : (
                                    <input type="number" min={0} max={i.stock} step={i.tipo_item === 'producto' && !i.decimales ? 1 : 0.001} className="input text-right" aria-label={`Cantidad de ${i.descripcion}`}
                                        value={cantidades[key(i)] ?? ''} onChange={(e) => setCantidades({ ...cantidades, [key(i)]: e.target.value })} />
                                )}
                            </div>
                        ))}
                        {!loadingStock && disponibles.length === 0 && <p className="text-sm text-gray-500">El almacén no tiene stock disponible.</p>}
                    </div>
                )}
                <Field label="Observación (opcional)"><input className="input" value={form.observacion} onChange={(e) => setForm({ ...form, observacion: e.target.value })} maxLength={500} /></Field>
                <div className="flex gap-3 pt-1">
                    <button type="button" className="btn btn-secondary flex-1" onClick={onClose}>Cancelar</button>
                    <button type="submit" className="btn btn-primary flex-1" disabled={saving || loadingStock || !form.almacen_origen_id || !form.almacen_destino_id || seleccion.length === 0}>{saving ? 'Guardando...' : seleccion.length === 0 ? 'Seleccione ítems para continuar' : `Crear transferencia (${seleccion.length} ítems)`}</button>
                </div>
            </form>
        </Modal>
    );
};

const TransferenciaDetalle = ({ transferencia: t, isAdmin, isSuperadmin, onClose, onChanged, onPdfGuia, onGuiaRemitente }) => {
    const { activeUser } = useAuth();
    const [recibido, setRecibido] = useState({});
    const [motivos, setMotivos] = useState({});
    const [observacion, setObservacion] = useState('');
    const [motivoAnulacion, setMotivoAnulacion] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const sedeUsuario = activeUser?.sede_id;
    const esOrigen = isSuperadmin || Number(sedeUsuario) === Number(t.sede_origen_id);
    const esDestino = isSuperadmin || Number(sedeUsuario) === Number(t.sede_destino_id);
    const tieneGre = (t.guias || []).some((g) => g.tipo === 'remitente' && g.estado !== 'anulada');

    const run = async (fn, text) => {
        setBusy(true);
        setError('');
        try {
            const updated = await fn();
            onChanged({ ...t, ...updated, guias: updated.guias || t.guias }, text);
        } catch (e) {
            setError(e.message);
        } finally {
            setBusy(false);
        }
    };
    const recibir = () => run(() => postJson(`/api/transferencias/${t.id}/recibir`, {
        observacion,
        lineas: t.detalle.map((l) => ({ detalle_id: l.id, cantidad_recibida: recibido[l.id] ?? l.cantidad, motivo_diferencia: motivos[l.id] || '' }))
    }, 'No se pudo recibir.'), `Transferencia ${t.codigo} recibida.`);

    return (
        <Modal title={`Transferencia ${t.codigo}`} subtitle={`${t.almacen_origen_nombre} (${t.sede_origen_nombre}) → ${t.almacen_destino_nombre} (${t.sede_destino_nombre})`} wide onClose={onClose}>
            <ErrorBox text={error} />
            <div className="flex flex-wrap items-center gap-2 mb-4">
                <Badge map={ESTADO_TRANSFERENCIA} value={t.estado} />
                <span className="text-xs text-gray-500">{Number(t.interna) ? 'Transferencia interna' : 'Entre sedes'} · creada por {t.usuario_nombre}</span>
            </div>
            {t.observacion && <p className="text-sm text-gray-600 mb-3">{t.observacion}</p>}
            {t.fecha_despacho && <p className="text-xs text-gray-500">Despachada {formatDateTime(t.fecha_despacho)} por {t.despachado_por_nombre}</p>}
            {t.fecha_recepcion && <p className="text-xs text-gray-500 mb-3">Recibida {formatDateTime(t.fecha_recepcion)} por {t.recibido_por_nombre}{t.observacion_recepcion ? ` · ${t.observacion_recepcion}` : ''}</p>}

            <table className="w-full text-sm my-3">
                <thead><tr className="text-left text-[10px] uppercase text-gray-500 border-b"><th className="py-2">Ítem</th><th className="py-2 text-right">Enviado</th><th className="py-2 text-right">Recibido</th></tr></thead>
                <tbody>
                    {t.detalle.map((l) => (
                        <tr key={l.id} className="border-b border-gray-50 align-top">
                            <td className="py-2"><p className="font-semibold">{l.descripcion}</p><p className="text-xs text-gray-500">{TIPO_ITEM[l.tipo_item]}</p>
                                {l.motivo_diferencia && <p className="text-xs text-rose-600">Diferencia: {l.motivo_diferencia}</p>}
                                {t.estado === 'en_transito' && esDestino && Number(recibido[l.id] ?? l.cantidad) < l.cantidad && (
                                    <input className="input mt-1 text-xs" placeholder="Motivo de la diferencia" value={motivos[l.id] || ''} onChange={(e) => setMotivos({ ...motivos, [l.id]: e.target.value })} aria-label={`Motivo de diferencia de ${l.descripcion}`} />
                                )}
                            </td>
                            <td className="py-2 text-right tabular-nums">{cantidad(l.cantidad)} <span className="text-xs text-gray-500">{l.unidad}</span></td>
                            <td className="py-2 text-right w-28">
                                {t.estado === 'en_transito' && esDestino ? (
                                    <input type="number" min={0} max={l.cantidad} step={l.tipo_item === 'insumo' || l.decimales ? 0.001 : 1} className="input text-right" aria-label={`Recibido de ${l.descripcion}`}
                                        value={recibido[l.id] ?? l.cantidad} onChange={(e) => setRecibido({ ...recibido, [l.id]: e.target.value })} />
                                ) : l.cantidad_recibida === null ? '—' : <span className={`font-black ${l.cantidad_recibida < l.cantidad ? 'text-rose-600' : ''}`}>{cantidad(l.cantidad_recibida)}</span>}
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>

            {(t.guias || []).length > 0 && (
                <div className="mb-4 space-y-1">
                    <p className="text-[10px] font-black uppercase tracking-widest text-gray-500">Guías</p>
                    {t.guias.map((g) => (
                        <button key={g.id} className="w-full flex items-center justify-between p-2 rounded-xl border border-gray-100 text-sm hover:border-brand-200" onClick={() => onPdfGuia(g.id)}>
                            <span><span className="font-mono font-bold">{g.numero_guia}</span> · {g.tipo === 'remitente' ? 'Remitente electrónica' : 'Interna'}</span>
                            <span className="flex items-center gap-2">{g.tipo === 'remitente' && <SunatBadge estado={g.estado_sunat} />}<FileText size={14} /></span>
                        </button>
                    ))}
                </div>
            )}

            {t.estado === 'en_transito' && esDestino && (
                <Field label="Observación de recepción (opcional)"><input className="input" value={observacion} onChange={(e) => setObservacion(e.target.value)} maxLength={500} /></Field>
            )}
            {t.estado === 'borrador' && isAdmin && esOrigen && (
                <Field label="Motivo (solo para anular)" className="mt-2"><input className="input" value={motivoAnulacion} onChange={(e) => setMotivoAnulacion(e.target.value)} maxLength={200} /></Field>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-5">
                {t.estado === 'borrador' && isAdmin && esOrigen && (
                    <>
                        <button className="btn btn-primary" disabled={busy} onClick={() => run(() => postJson(`/api/transferencias/${t.id}/despachar`, {}, 'No se pudo despachar.'), `Transferencia ${t.codigo} despachada: stock en tránsito y guía interna emitida.`)}>
                            <Truck size={16} /> Despachar
                        </button>
                        <button className="btn bg-rose-600 hover:bg-rose-700 text-white" disabled={busy || motivoAnulacion.trim().length < 3}
                            onClick={() => run(() => postJson(`/api/transferencias/${t.id}/anular`, { motivo: motivoAnulacion }, 'No se pudo anular.'), `Transferencia ${t.codigo} anulada.`)}>
                            <XCircle size={16} /> Anular borrador
                        </button>
                    </>
                )}
                {t.estado === 'en_transito' && esDestino && (
                    <button className="btn btn-primary sm:col-span-2" disabled={busy} onClick={recibir}><PackageCheck size={16} /> Confirmar recepción</button>
                )}
                {['en_transito', 'recibida'].includes(t.estado) && isAdmin && esOrigen && !tieneGre && (
                    <button className="btn btn-secondary sm:col-span-2" onClick={onGuiaRemitente}><Truck size={16} /> Emitir guía de remisión remitente (SUNAT)</button>
                )}
            </div>
            <button className="btn btn-secondary w-full mt-3" onClick={onClose}>Cerrar</button>
        </Modal>
    );
};

const GuiaInternaModal = ({ sedeId, onClose, onSaved }) => {
    const [almacenes, setAlmacenes] = useState([]);
    const [form, setForm] = useState({ almacen_id: '', fecha_traslado: toPeruYmd(), partida_direccion: '', llegada_direccion: '', destinatario_nombre: '', comentario: '' });
    const [items, setItems] = useState([{ descripcion: '', cantidad: 1, unidad_medida: 'NIU' }]);
    const [saving, setSaving] = useState(false);
    const [formError, setFormError] = useState('');
    const { activas: unidadesActivas } = useUnidades(true);
    // The guide carries the SUNAT code: one option per code, named after the catalog unit that uses it.
    const opcionesUnidad = unidadesActivas.length > 0
        ? [...new Map(unidadesActivas.map((u) => [u.codigo_sunat, u.nombre])).entries()]
        : UNIDADES_SUNAT;
    useEffect(() => {
        fetch(`/api/almacenes?sede_id=${sedeId}`).then((r) => readJson(r, 'Error')).then((rows) => setAlmacenes(rows.filter((a) => Number(a.activo)))).catch(() => {});
    }, [sedeId]);
    const setItem = (index, patch) => setItems(items.map((it, i) => (i === index ? { ...it, ...patch } : it)));
    const save = async (event) => {
        event.preventDefault();
        setSaving(true);
        setFormError('');
        try {
            onSaved(await postJson('/api/guias/interna', { ...form, items: items.map((i) => ({ ...i, cantidad: Number(i.cantidad) })) }, 'No se pudo emitir la guía.'));
        } catch (e) {
            setFormError(e.message);
        } finally {
            setSaving(false);
        }
    };
    return (
        <Modal title="Guía interna libre" subtitle="Documento interno de control: no se envía a SUNAT ni mueve stock." xl onClose={onClose}>
            <ErrorBox text={formError} />
            <form onSubmit={save} className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <Field label="Almacén responsable (opcional)">
                        <select className="input" value={form.almacen_id} onChange={(e) => {
                            const a = almacenes.find((x) => String(x.id) === e.target.value);
                            setForm({ ...form, almacen_id: e.target.value, partida_direccion: form.partida_direccion || (a ? `${a.nombre} - ${a.direccion || ''}` : '') });
                        }}>
                            <option value="">—</option>
                            {almacenes.map((a) => <option key={a.id} value={a.id}>{a.nombre}</option>)}
                        </select>
                    </Field>
                    <Field label="Fecha de traslado"><input type="date" className="input" value={form.fecha_traslado} onChange={(e) => setForm({ ...form, fecha_traslado: e.target.value })} required /></Field>
                    <Field label="Punto de partida"><input className="input" value={form.partida_direccion} onChange={(e) => setForm({ ...form, partida_direccion: e.target.value })} required maxLength={255} /></Field>
                    <Field label="Punto de llegada"><input className="input" value={form.llegada_direccion} onChange={(e) => setForm({ ...form, llegada_direccion: e.target.value })} required maxLength={255} /></Field>
                </div>
                <Field label="Recibe"><input className="input" placeholder="Nombre o área que recibe" value={form.destinatario_nombre} onChange={(e) => setForm({ ...form, destinatario_nombre: e.target.value })} required maxLength={200} /></Field>
                <div className="space-y-2">
                    <span className="text-xs font-bold text-gray-500 uppercase tracking-widest">Bienes</span>
                    {items.map((item, index) => (
                        <div key={index} className="grid grid-cols-[1fr_90px_120px_auto] gap-2 items-center">
                            <input className="input" placeholder="Descripción" value={item.descripcion} onChange={(e) => setItem(index, { descripcion: e.target.value })} required maxLength={250} aria-label={`Descripción del bien ${index + 1}`} />
                            <input type="number" min="0.001" step="0.001" className="input text-right" value={item.cantidad} onChange={(e) => setItem(index, { cantidad: e.target.value })} required aria-label={`Cantidad del bien ${index + 1}`} />
                            <select className="input" value={item.unidad_medida} onChange={(e) => setItem(index, { unidad_medida: e.target.value })} aria-label={`Unidad del bien ${index + 1}`}>
                                {opcionesUnidad.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                            </select>
                            <button type="button" className="p-2 text-gray-400 hover:text-rose-600" onClick={() => setItems(items.filter((_, i) => i !== index))} disabled={items.length === 1} aria-label={`Quitar bien ${index + 1}`}><Trash2 size={16} /></button>
                        </div>
                    ))}
                    <button type="button" className="text-sm font-bold text-brand-600" onClick={() => setItems([...items, { descripcion: '', cantidad: 1, unidad_medida: 'NIU' }])}>+ Agregar bien</button>
                </div>
                <Field label="Comentario (se imprime)"><textarea className="input min-h-[70px]" value={form.comentario} onChange={(e) => setForm({ ...form, comentario: e.target.value })} maxLength={2000} /></Field>
                <div className="flex gap-3 pt-1">
                    <button type="button" className="btn btn-secondary flex-1" onClick={onClose}>Cancelar</button>
                    <button type="submit" className="btn btn-primary flex-1" disabled={saving}>{saving ? 'Emitiendo...' : 'Emitir guía interna'}</button>
                </div>
            </form>
        </Modal>
    );
};

const GuiaRemitenteModal = ({ inicial, onClose, onSaved }) => {
    const [opciones, setOpciones] = useState(null);
    const [items, setItems] = useState([]);
    const [itemsLoading, setItemsLoading] = useState(false);
    const [origen, setOrigen] = useState(inicial.origen || 'transferencia');
    const [origenId, setOrigenId] = useState(inicial.id ? String(inicial.id) : '');
    const [form, setForm] = useState({
        fecha_traslado: toPeruYmd(), partida: { direccion: '', ubigeo: '', establecimiento: '' }, llegada: { direccion: '', ubigeo: '', establecimiento: '' },
        peso_bruto: '', unidad_peso: 'KGM', bultos: 1, modalidad: '02', placa: '', conductor_dni: '', conductor_nombres: '', conductor_apellidos: '',
        conductor_licencia: '', transportista_ruc: '', transportista_nombre: '', transportista_mtc: '', motivo_descripcion: '', observaciones: '',
        motivo: '', destinatario_tipo: '6', destinatario_numero: '', destinatario_nombre: ''
    });
    // Free guide: the goods are typed here instead of coming from a sale or a transfer.
    const [itemsLibres, setItemsLibres] = useState([{ descripcion: '', cantidad: 1, unidad_medida: 'NIU' }]);
    const [codigosUnidad, setCodigosUnidad] = useState([]);
    const [saving, setSaving] = useState(false);
    const [formError, setFormError] = useState('');
    const set = (patch) => setForm((prev) => ({ ...prev, ...patch }));
    const esLibre = origen === 'libre';
    const setItemLibre = (index, patch) => setItemsLibres((prev) => prev.map((it, i) => (i === index ? { ...it, ...patch } : it)));
    const setPunto = (punto, patch) => setForm((prev) => ({ ...prev, [punto]: { ...prev[punto], ...patch } }));

    useEffect(() => {
        fetch('/api/guias/opciones').then((r) => readJson(r, 'No se pudo cargar las opciones.')).then(setOpciones).catch((e) => setFormError(e.message));
        fetch('/api/unidades-codigos-sunat').then((r) => (r.ok ? r.json() : [])).then((rows) => setCodigosUnidad(Array.isArray(rows) ? rows : [])).catch(() => {});
    }, []);

    const seleccion = useMemo(() => {
        if (!opciones || !origenId) return null;
        return origen === 'transferencia' ? opciones.transferencias.find((t) => String(t.id) === origenId) : opciones.facturas.find((f) => String(f.id) === origenId);
    }, [opciones, origen, origenId]);

    useEffect(() => {
        if (!origenId || esLibre) {
            setItems([]);
            setItemsLoading(false);
            return undefined;
        }
        let active = true;
        setItems([]);
        setItemsLoading(true);
        setFormError('');
        fetch(`/api/guias/remitente/${origen}/${origenId}/items`)
            .then((response) => readJson(response, 'No se pudieron cargar los productos del traslado.'))
            .then((result) => { if (active) setItems(Array.isArray(result.items) ? result.items : []); })
            .catch((error) => { if (active) setFormError(error.message); })
            .finally(() => { if (active) setItemsLoading(false); });
        return () => { active = false; };
    }, [origen, origenId]);

    // Departure and arrival are suggested from the warehouses (transfer) or the customer address (sale).
    useEffect(() => {
        if (!seleccion || !opciones) return;
        if (origen === 'transferencia') {
            setForm((prev) => ({
                ...prev,
                partida: { direccion: seleccion.origen?.direccion || '', ubigeo: seleccion.origen?.ubigeo || '', establecimiento: seleccion.origen?.cod_establecimiento || '' },
                llegada: { direccion: seleccion.destino?.direccion || '', ubigeo: seleccion.destino?.ubigeo || '', establecimiento: seleccion.destino?.cod_establecimiento || '' }
            }));
        } else {
            const ventas = opciones.almacenes.find((a) => Number(a.para_ventas)) || opciones.almacenes[0];
            setForm((prev) => ({
                ...prev,
                partida: { direccion: ventas?.direccion || '', ubigeo: ventas?.ubigeo || '', establecimiento: ventas?.cod_establecimiento || '' },
                llegada: { direccion: seleccion.cliente_direccion || '', ubigeo: '', establecimiento: '' }
            }));
        }
    }, [seleccion, origen, opciones]);

    const save = async (event) => {
        event.preventDefault();
        setSaving(true);
        setFormError('');
        try {
            onSaved(await postJson('/api/guias/remitente', {
                ...form, origen, peso_bruto: Number(form.peso_bruto), bultos: Number(form.bultos),
                items: esLibre
                    ? itemsLibres.map((item) => ({ descripcion: item.descripcion, cantidad: Number(item.cantidad), unidad_medida: item.unidad_medida, codigo: item.codigo || undefined }))
                    : items.map((item) => ({ descripcion: item.descripcion })),
                transferencia_id: origen === 'transferencia' ? Number(origenId) : undefined,
                factura_id: origen === 'venta' ? Number(origenId) : undefined
            }, 'No se pudo emitir la guía.'));
        } catch (e) {
            setFormError(e.message);
        } finally {
            setSaving(false);
        }
    };

    const Punto = ({ punto, titulo }) => (
        <div className="p-3 rounded-2xl bg-gray-50 border border-gray-100 space-y-2">
            <span className="text-xs font-black uppercase tracking-widest text-gray-500">{titulo}</span>
            <input className="input" placeholder="Dirección" value={form[punto].direccion} onChange={(e) => setPunto(punto, { direccion: e.target.value })} required minLength={5} maxLength={255} aria-label={`Dirección de ${titulo}`} />
            <UbigeoSearchInput value={form[punto].ubigeo} onSelect={(u) => setPunto(punto, { ubigeo: u ? u.codigo : '' })} required ariaLabel={`Ubigeo de ${titulo}`} />
            <div className="grid grid-cols-2 gap-2">
                <input className="input font-mono" placeholder="Establec. SUNAT" inputMode="numeric" maxLength={4} value={form[punto].establecimiento} onChange={(e) => setPunto(punto, { establecimiento: e.target.value.replace(/\D/g, '') })} required={origen === 'transferencia' || (esLibre && form.motivo === '04')} aria-label={`Establecimiento de ${titulo}`} />
            </div>
        </div>
    );

    return (
        <Modal title="Guía de remisión remitente" subtitle={`Electrónica · se envía a SUNAT por la API de facturación${opciones?.ambiente === 'PRUEBAS' ? ' (ambiente de PRUEBAS)' : ''}`} xl onClose={onClose}>
            <ErrorBox text={formError} />
            {!opciones && !formError && <p className="py-6 text-center font-bold text-gray-500">Cargando...</p>}
            {opciones && (
                <form onSubmit={save} className="space-y-4">
                    <Field label="Origen del traslado">
                        <ToggleGroup options={[{ value: 'transferencia', label: 'Transferencia (motivo 04)' }, { value: 'venta', label: 'Venta: boleta/factura (motivo 01)' }, { value: 'libre', label: 'Libre (otro motivo)' }]} value={origen}
                            onChange={(v) => {
                                setOrigen(v);
                                setOrigenId('');
                                // Addresses suggested for a sale or a transfer do not apply to a free guide.
                                if (v === 'libre') setForm((prev) => ({ ...prev, partida: { direccion: '', ubigeo: '', establecimiento: '' }, llegada: { direccion: '', ubigeo: '', establecimiento: '' } }));
                            }} />
                    </Field>
                    {esLibre && (
                        <section className="rounded-2xl border border-gray-200 bg-gray-50 p-4 space-y-3">
                            <h4 className="text-sm font-black text-gray-800">Motivo y destinatario</h4>
                            <Field label="Motivo del traslado (SUNAT)">
                                <select className="input" value={form.motivo} onChange={(e) => set({ motivo: e.target.value })} required>
                                    <option value="">Seleccione...</option>
                                    {(opciones.motivos_libres || []).map((m) => <option key={m.codigo} value={m.codigo}>{m.codigo} - {m.nombre}</option>)}
                                </select>
                                {form.motivo === '04' && <p className="text-xs text-gray-500 mt-1">Requiere el código SUNAT de establecimiento de partida y de llegada.</p>}
                            </Field>
                            <div className="grid grid-cols-1 sm:grid-cols-[150px_200px_minmax(0,1fr)] gap-3">
                                <Field label="Documento">
                                    <select className="input" value={form.destinatario_tipo} onChange={(e) => set({ destinatario_tipo: e.target.value })} required>
                                        {(opciones.documentos_destinatario || []).map((d) => <option key={d.codigo} value={d.codigo}>{d.nombre}</option>)}
                                    </select>
                                </Field>
                                <Field label="N° de documento"><input className="input font-mono" value={form.destinatario_numero} onChange={(e) => set({ destinatario_numero: e.target.value.trim() })} required maxLength={15} /></Field>
                                <Field label="Nombre / razón social del destinatario"><input className="input" value={form.destinatario_nombre} onChange={(e) => set({ destinatario_nombre: e.target.value })} required maxLength={200} /></Field>
                            </div>
                        </section>
                    )}
                    {!esLibre && (<Field label={origen === 'transferencia' ? 'Transferencia despachada' : 'Comprobante electrónico'}>
                        <select className="input" value={origenId} onChange={(e) => setOrigenId(e.target.value)} required>
                            <option value="">Seleccione...</option>
                            {origen === 'transferencia'
                                ? opciones.transferencias.map((t) => <option key={t.id} value={t.id}>{t.codigo} · {t.almacen_origen_nombre} → {t.almacen_destino_nombre} ({t.sede_destino_nombre})</option>)
                                : opciones.facturas.map((f) => <option key={f.id} value={f.id}>{f.numero_comprobante} · {f.cliente_nombre} · S/ {Number(f.total_venta).toFixed(2)}</option>)}
                        </select>
                        {origen === 'venta' && <p className="text-xs text-gray-500 mt-1">Boletas y facturas vigentes, enviadas a SUNAT, con cliente identificado (DNI o RUC). La guía se vincula al comprobante.</p>}
                    </Field>)}
                    {esLibre && (
                        <section className="rounded-2xl border border-gray-200 bg-gray-50 p-4 space-y-3">
                            <div>
                                <h4 className="text-sm font-black text-gray-800">Bienes a trasladar</h4>
                                <p className="mt-1 text-xs text-gray-500">Se escriben aquí: la guía libre no descuenta stock ni se vincula a una venta o transferencia.</p>
                            </div>
                            {itemsLibres.map((item, index) => (
                                <div key={index} className="grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_110px_170px_auto] gap-2 items-end rounded-xl border border-gray-200 bg-white p-3">
                                    <Field label={`Descripción ${index + 1}`}><input className="input" value={item.descripcion} onChange={(e) => setItemLibre(index, { descripcion: e.target.value })} required maxLength={250} placeholder="Describe el bien" /></Field>
                                    <Field label="Cantidad"><input type="number" min="0.001" step="0.001" className="input text-right" value={item.cantidad} onChange={(e) => setItemLibre(index, { cantidad: e.target.value })} required /></Field>
                                    <Field label="Unidad">
                                        <select className="input" value={item.unidad_medida} onChange={(e) => setItemLibre(index, { unidad_medida: e.target.value })}>
                                            {(codigosUnidad.length ? codigosUnidad : [{ codigo: 'NIU', nombre: 'Unidad (bienes)' }]).map((c) => <option key={c.codigo} value={c.codigo}>{c.nombre}</option>)}
                                        </select>
                                    </Field>
                                    <button type="button" className="p-2 mb-1 text-gray-400 hover:text-rose-600" onClick={() => setItemsLibres((prev) => prev.filter((_, i) => i !== index))} disabled={itemsLibres.length === 1} aria-label={`Quitar bien ${index + 1}`}><Trash2 size={16} /></button>
                                </div>
                            ))}
                            <button type="button" className="text-sm font-bold text-brand-600" onClick={() => setItemsLibres((prev) => [...prev, { descripcion: '', cantidad: 1, unidad_medida: 'NIU' }])}>+ Agregar bien</button>
                        </section>
                    )}
                    {!esLibre && <section className="rounded-2xl border border-gray-200 bg-gray-50 p-4 space-y-3">
                        <div>
                            <h4 className="text-sm font-black text-gray-800">Productos a trasladar</h4>
                            <p className="mt-1 text-xs text-gray-500">Revisa y describe cada producto. Las cantidades provienen del documento de origen.</p>
                        </div>
                        {itemsLoading ? (
                            <div className="flex items-center justify-center gap-2 py-5 text-sm font-semibold text-gray-500"><RefreshCw size={16} className="animate-spin" /> Cargando productos...</div>
                        ) : items.length > 0 ? (
                            <div className="space-y-3">
                                {items.map((item, index) => (
                                    <div key={`${item.codigo}-${index}`} className="grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_150px] gap-3 rounded-xl border border-gray-200 bg-white p-3">
                                        <Field label={`Descripción ${index + 1}`}>
                                            <input
                                                className="input"
                                                value={item.descripcion || ''}
                                                onChange={(event) => setItems((current) => current.map((line, lineIndex) => lineIndex === index ? { ...line, descripcion: event.target.value } : line))}
                                                required maxLength={250}
                                                placeholder="Describe el producto trasladado"
                                            />
                                            <span className="mt-1 block text-[10px] text-gray-400">Código: {item.codigo || '-'} · Unidad: {item.unidad_medida}</span>
                                        </Field>
                                        <Field label="Cantidad"><input className="input bg-gray-100" value={`${cantidad(item.cantidad)} ${item.unidad_medida}`} readOnly /></Field>
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <p className="rounded-xl border border-dashed border-gray-300 bg-white p-4 text-center text-sm text-gray-500">Selecciona una transferencia o comprobante con productos para mostrar las descripciones.</p>
                        )}
                    </section>}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        {Punto({ punto: 'partida', titulo: 'Partida' })}
                        {Punto({ punto: 'llegada', titulo: 'Llegada' })}
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                        <Field label="Inicio traslado"><input type="date" className="input" min={toPeruYmd()} value={form.fecha_traslado} onChange={(e) => set({ fecha_traslado: e.target.value })} required /></Field>
                        <Field label="Peso bruto"><input type="number" min="0.001" step="0.001" className="input" value={form.peso_bruto} onChange={(e) => set({ peso_bruto: e.target.value })} required /></Field>
                        <Field label="Unidad"><select className="input" value={form.unidad_peso} onChange={(e) => set({ unidad_peso: e.target.value })}><option value="KGM">Kilogramos</option><option value="TNE">Toneladas</option></select></Field>
                        <Field label="Bultos"><input type="number" min={1} step={1} className="input" value={form.bultos} onChange={(e) => set({ bultos: e.target.value })} required /></Field>
                    </div>
                    <Field label="Transporte">
                        <ToggleGroup options={[{ value: '02', label: 'Privado (vehículo propio)' }, { value: '01', label: 'Público (empresa de transporte)' }]} value={form.modalidad} onChange={(modalidad) => set({ modalidad })} />
                    </Field>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <Field label="Placa"><input className="input font-mono uppercase" value={form.placa} onChange={(e) => set({ placa: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '') })} required maxLength={8} /></Field>
                        {form.modalidad === '02' ? (
                            <>
                                <Field label="DNI del conductor"><input className="input font-mono" inputMode="numeric" maxLength={8} value={form.conductor_dni} onChange={(e) => set({ conductor_dni: e.target.value.replace(/\D/g, '') })} required /></Field>
                                <Field label="Nombres del conductor"><input className="input" value={form.conductor_nombres} onChange={(e) => set({ conductor_nombres: e.target.value })} required maxLength={100} /></Field>
                                <Field label="Apellidos del conductor"><input className="input" value={form.conductor_apellidos} onChange={(e) => set({ conductor_apellidos: e.target.value })} required maxLength={100} /></Field>
                                <Field label="Licencia de conducir"><input className="input font-mono uppercase" value={form.conductor_licencia} onChange={(e) => set({ conductor_licencia: e.target.value.toUpperCase() })} required maxLength={10} /></Field>
                            </>
                        ) : (
                            <>
                                <Field label="RUC del transportista"><input className="input font-mono" inputMode="numeric" maxLength={11} value={form.transportista_ruc} onChange={(e) => set({ transportista_ruc: e.target.value.replace(/\D/g, '') })} required /></Field>
                                <Field label="Razón social del transportista"><input className="input" value={form.transportista_nombre} onChange={(e) => set({ transportista_nombre: e.target.value })} required maxLength={200} /></Field>
                                <Field label="Registro MTC (opcional)"><input className="input" value={form.transportista_mtc} onChange={(e) => set({ transportista_mtc: e.target.value })} maxLength={20} /></Field>
                            </>
                        )}
                    </div>
                    <Field label={esLibre && form.motivo === '13' ? 'Descripción del motivo del traslado (obligatoria)' : 'Descripción del motivo del traslado'}>
                        <input className="input" value={form.motivo_descripcion} onChange={(e) => set({ motivo_descripcion: e.target.value })} maxLength={200} required={esLibre && form.motivo === '13'}
                            placeholder={origen === 'transferencia' ? 'Ej. Reposición de insumos para el local de la sede norte' : origen === 'libre' ? 'Ej. Devolución de mercadería al proveedor' : 'Ej. Entrega de pedido al cliente'} />
                        <span className="mt-1 block text-[10px] text-gray-400">Se imprime en la guía junto al motivo SUNAT ({esLibre ? (form.motivo ? `${form.motivo} - ${(opciones.motivos || {})[form.motivo] || ''}` : 'el que selecciones arriba') : origen === 'transferencia' ? '04 - Traslado entre establecimientos' : '01 - Venta'}).</span>
                    </Field>
                    <Field label="Observaciones (opcional)"><input className="input" value={form.observaciones} onChange={(e) => set({ observaciones: e.target.value })} maxLength={300} /></Field>
                    <div className="flex gap-3 pt-1">
                        <button type="button" className="btn btn-secondary flex-1" onClick={onClose}>Cancelar</button>
                        <button type="submit" className="btn btn-primary flex-1" disabled={saving || (esLibre ? itemsLibres.length === 0 : itemsLoading || items.length === 0)}>{saving ? 'Emitiendo...' : 'Emitir y enviar a SUNAT'}</button>
                    </div>
                </form>
            )}
        </Modal>
    );
};

const GuiaDetalle = ({ guia: g, onClose, onPdf, onChanged }) => {
    const [cargo, setCargo] = useState('');
    const [motivo, setMotivo] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const run = async (url, body, text) => {
        setBusy(true);
        setError('');
        try {
            const updated = await postJson(url, body, 'No se pudo completar la acción.');
            onChanged(updated, text(updated));
        } catch (e) {
            setError(e.message);
        } finally {
            setBusy(false);
        }
    };
    const remitente = g.tipo === 'remitente';
    return (
        <Modal title={`${remitente ? 'Guía remitente' : 'Guía interna'} ${g.numero_guia}`} subtitle={`${g.sede_nombre} · ${formatFecha(g.fecha_emision)} · ${g.usuario_nombre || ''}`} wide onClose={onClose}>
            <ErrorBox text={error} />
            <div className="flex flex-wrap items-center gap-2 mb-3">
                <Badge map={ESTADO_GUIA} value={g.estado} />
                {remitente && <SunatBadge estado={g.estado_sunat} />}
                {remitente && g.ambiente === 'PRUEBAS' && <span className="text-[10px] font-black text-rose-600 uppercase tracking-widest">Pruebas</span>}
            </div>
            {remitente && g.sunat_descripcion && <p className="text-sm text-gray-600 mb-3 break-words">{g.sunat_descripcion}</p>}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                <p><span className="text-xs font-black uppercase text-gray-500">Origen:</span> {g.transferencia_codigo || (g.factura_numero ? `${g.factura_tipo === 'factura' ? 'Factura' : 'Boleta'} ${g.factura_numero}` : 'Libre')}</p>
                <p><span className="text-xs font-black uppercase text-gray-500">Traslado:</span> {formatFecha(g.fecha_traslado)}{g.motivo_traslado ? ` · motivo ${g.motivo_traslado}` : ''}</p>
                <p><span className="text-xs font-black uppercase text-gray-500">Partida:</span> {g.partida_direccion}</p>
                <p><span className="text-xs font-black uppercase text-gray-500">Llegada:</span> {g.llegada_direccion}</p>
                <p><span className="text-xs font-black uppercase text-gray-500">Destinatario:</span> {g.destinatario_nombre}{g.destinatario_num_doc ? ` (${g.destinatario_tipo_doc} ${g.destinatario_num_doc})` : ''}</p>
                {remitente && <p><span className="text-xs font-black uppercase text-gray-500">Transporte:</span> {g.placa} · {g.modalidad === '02' ? `${g.conductor_nombres} ${g.conductor_apellidos}` : g.transportista_nombre}</p>}
            </div>
            <table className="w-full text-sm my-4">
                <thead><tr className="text-left text-[10px] uppercase text-gray-500 border-b"><th className="py-2">Código</th><th className="py-2">Descripción</th><th className="py-2 text-right">Cantidad</th></tr></thead>
                <tbody>{g.items.map((i, n) => <tr key={n} className="border-b border-gray-50"><td className="py-1.5 font-mono text-xs">{i.codigo}</td><td className="py-1.5">{i.descripcion}</td><td className="py-1.5 text-right">{cantidad(i.cantidad)} {i.unidad_medida}</td></tr>)}</tbody>
            </table>
            {g.comentario && <p className="text-sm text-gray-600 mb-2">Comentario: {g.comentario}</p>}
            {g.cargo && <p className="text-sm text-emerald-700 mb-2">Cargo: {g.cargo} ({g.cargo_por_nombre}, {formatDateTime(g.cargo_fecha)})</p>}
            {g.estado === 'anulada' && <p className="text-sm text-rose-600 mb-2">Anulada: {g.motivo_anulacion}</p>}

            {!remitente && g.estado === 'emitida' && (
                <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-2 mt-3">
                    <input className="input" placeholder="Cargo: quién recibió y observaciones" value={cargo} onChange={(e) => setCargo(e.target.value)} />
                    <button className="btn btn-primary" disabled={busy || cargo.trim().length < 3} onClick={() => run(`/api/guias/${g.id}/recibir`, { cargo }, () => 'Cargo registrado.')}><ClipboardSignature size={16} /> Registrar cargo</button>
                </div>
            )}
            {g.estado === 'emitida' && g.origen === 'libre' && (
                <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-2 mt-2">
                    <input className="input" placeholder="Motivo para anular" value={motivo} onChange={(e) => setMotivo(e.target.value)} />
                    <button className="btn bg-rose-600 hover:bg-rose-700 text-white" disabled={busy || motivo.trim().length < 3} onClick={() => run(`/api/guias/${g.id}/anular`, { motivo }, () => 'Guía anulada.')}><XCircle size={16} /> Anular</button>
                </div>
            )}
            <div className="grid grid-cols-2 gap-3 mt-4">
                <button className="btn btn-primary" onClick={() => onPdf(g.id)}><FileText size={16} /> PDF A4</button>
                {remitente && ['pendiente', 'error'].includes(g.estado_sunat) && <button className="btn btn-secondary" disabled={busy} onClick={() => run(`/api/guias/${g.id}/enviar`, {}, (u) => `SUNAT: ${u.sunat_descripcion || u.estado_sunat}`)}><Send size={16} /> Enviar a SUNAT</button>}
                {remitente && g.estado_sunat !== 'no_aplica' && <button className="btn btn-secondary" disabled={busy} onClick={() => run(`/api/guias/${g.id}/consultar`, {}, (u) => `SUNAT: ${u.sunat_descripcion || u.estado_sunat}`)}><RefreshCw size={16} /> Consultar SUNAT</button>}
            </div>
            {remitente && (g.enlace_pdf || g.enlace_xml || g.enlace_cdr) && (
                <div className="flex gap-3 mt-3 text-xs font-bold">
                    {g.enlace_pdf && <a className="text-brand-600" href={g.enlace_pdf} target="_blank" rel="noreferrer">PDF</a>}
                    {g.enlace_xml && <a className="text-brand-600" href={g.enlace_xml} target="_blank" rel="noreferrer">XML</a>}
                    {g.enlace_cdr && <a className="text-brand-600" href={g.enlace_cdr} target="_blank" rel="noreferrer">CDR</a>}
                </div>
            )}
            <button className="btn btn-secondary w-full mt-3" onClick={onClose}>Cerrar</button>
        </Modal>
    );
};

const Tile = ({ label, value, tone = 'text-[var(--text-primary)]' }) => (
    <div className="card p-5">
        <p className="text-[10px] font-black uppercase tracking-widest text-gray-500">{label}</p>
        <p className={`text-2xl font-display font-black mt-1 tabular-nums ${tone}`}>{value ?? 0}</p>
    </div>
);

export default Almacenes;
