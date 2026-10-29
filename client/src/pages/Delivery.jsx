import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Bike, Plus, Search, Eye, Download, Truck, FileText, PackageCheck, XCircle, Phone, MapPin, Pencil, ListPlus, Minus, Trash2 } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { Modal, Field, ErrorBox } from '../components/billing/billingShared';
import { money, readJson } from '../components/billing/billingUtils';
import { addDaysYmd, formatDateTime, toPeruYmd } from '../utils/dateTime';
import EmitirComprobanteModal from '../components/billing/EmitirComprobanteModal';
import EditComandaModal from '../components/billing/EditComandaModal';
import { descargarReporteDelivery } from '../utils/exportDelivery';

const ETAPAS = {
    solicitado: ['Solicitado', 'bg-amber-50 text-amber-700 border-amber-200'],
    enviado: ['Enviado', 'bg-sky-50 text-sky-700 border-sky-200'],
    facturado: ['Facturado', 'bg-violet-50 text-violet-700 border-violet-200'],
    entregado: ['Entregado', 'bg-emerald-50 text-emerald-700 border-emerald-200'],
    rechazado: ['Rechazado', 'bg-rose-50 text-rose-700 border-rose-200'],
    anulado: ['Anulado', 'bg-rose-50 text-rose-700 border-rose-200']
};
const ORDEN_ETAPAS = ['solicitado', 'enviado', 'facturado', 'entregado'];

const Etapa = ({ estado }) => {
    const [label, style] = ETAPAS[estado] || ETAPAS.solicitado;
    return <span className={`inline-block px-2 py-1 rounded-lg border text-[10px] font-black uppercase tracking-widest whitespace-nowrap ${style}`}>{label}</span>;
};

const facturado = (p) => Boolean(p.factura_id) && p.factura_estado !== 'anulado';
// A receipt voided with a credit note leaves the order as "entregado"/"facturado": show it as annulled instead.
const estadoVisible = (p) => (p.factura_id && p.factura_estado === 'anulado' && p.estado !== 'rechazado' ? 'anulado' : p.estado);
const aFacturable = (p) => ({ id: p.pedido_id, total: p.total, cliente_id: p.cliente_id, es_delivery: true, delivery_cliente: p.cliente_nombre });

const Delivery = () => {
    const { activeSede } = useAuth();
    const today = toPeruYmd();
    const [filtros, setFiltros] = useState({ desde: addDaysYmd(today, -7), hasta: today, q: '' });
    const [tab, setTab] = useState('activos');
    const [data, setData] = useState({ pedidos: [], resumen: null });
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [message, setMessage] = useState('');
    const [nuevo, setNuevo] = useState(false);
    const [detalleId, setDetalleId] = useState(null);
    const [facturando, setFacturando] = useState(null);
    const [editandoProductos, setEditandoProductos] = useState(null);
    const [exportando, setExportando] = useState(false);

    const load = useCallback(async (current) => {
        setLoading(true);
        try {
            const params = new URLSearchParams({ desde: current.desde, hasta: current.hasta });
            if (current.q.trim()) params.set('q', current.q.trim());
            setData(await readJson(await fetch(`/api/delivery?${params}`), 'No se pudo cargar los pedidos delivery.'));
            setError('');
        } catch (e) {
            setError(e.message);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { load(filtros); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

    // Orders in progress change from several screens (kitchen, billing): refresh them from time to time.
    useEffect(() => {
        const timer = setInterval(() => load(filtros), 30000);
        return () => clearInterval(timer);
    }, [load, filtros]);

    const lista = useMemo(() => {
        if (tab === 'todos') return data.pedidos;
        if (tab === 'activos') return data.pedidos.filter((p) => ['solicitado', 'enviado', 'facturado'].includes(p.estado));
        return data.pedidos.filter((p) => p.estado === tab);
    }, [data, tab]);

    // Excel of the orders requested inside the date range (only that range, with their product lines).
    const exportarExcel = async () => {
        if (filtros.desde > filtros.hasta) { setError('La fecha inicial no puede ser posterior a la final.'); return; }
        setExportando(true);
        setError('');
        try {
            const params = new URLSearchParams({ desde: filtros.desde, hasta: filtros.hasta, estricto: '1', detalle: '1' });
            if (filtros.q.trim()) params.set('q', filtros.q.trim());
            const body = await readJson(await fetch(`/api/delivery?${params}`), 'No se pudo generar el reporte.');
            if (body.pedidos.length === 0) { setError('No hay pedidos delivery en el rango seleccionado.'); return; }
            await descargarReporteDelivery({ periodo: body.periodo, sedeNombre: activeSede?.nombre || 'Sede', pedidos: body.pedidos });
        } catch (e) {
            setError(e.message);
        } finally {
            setExportando(false);
        }
    };

    const resumen = data.resumen;
    const activos = resumen ? resumen.solicitado + resumen.enviado + resumen.facturado : 0;
    const refrescar = () => load(filtros);

    return (
        <div className="space-y-8">
            <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
                <div>
                    <h2 className="text-4xl font-display font-black tracking-tight">Pedidos <span className="text-brand-600">Delivery</span></h2>
                    <p className="text-[var(--text-secondary)] mt-2">Pedidos para entrega a domicilio de {activeSede?.nombre || 'la sede'}: solicitado, enviado, facturado y entregado.</p>
                </div>
                <button className="btn btn-primary text-sm" onClick={() => setNuevo(true)}><Plus size={16} /> Nuevo pedido</button>
            </div>

            {message && <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-700 font-semibold">{message}</div>}
            {error && <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 font-semibold">{error}</div>}

            <form onSubmit={(e) => { e.preventDefault(); refrescar(); }} className="card p-5 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_2fr_auto] gap-3 items-end">
                <Field label="Desde"><input type="date" className="input" value={filtros.desde} max={filtros.hasta} onChange={(e) => setFiltros({ ...filtros, desde: e.target.value })} required /></Field>
                <Field label="Hasta"><input type="date" className="input" value={filtros.hasta} min={filtros.desde} onChange={(e) => setFiltros({ ...filtros, hasta: e.target.value })} required /></Field>
                <Field label="Buscar"><input className="input" placeholder="Cliente, teléfono, dirección o N° de pedido" value={filtros.q} onChange={(e) => setFiltros({ ...filtros, q: e.target.value })} /></Field>
                <div className="flex gap-2">
                    <button type="submit" className="btn btn-secondary"><Search size={16} /> Buscar</button>
                    <button type="button" className="btn btn-secondary" onClick={exportarExcel} disabled={exportando}><Download size={16} /> {exportando ? 'Generando...' : 'Excel'}</button>
                </div>
            </form>

            <div className="flex gap-2 overflow-x-auto pb-1">
                {[['activos', 'En curso', activos], ['solicitado', 'Solicitados', resumen?.solicitado], ['enviado', 'Enviados', resumen?.enviado], ['facturado', 'Facturados', resumen?.facturado],
                    ['entregado', 'Entregados', resumen?.entregado], ['rechazado', 'Rechazados', resumen?.rechazado], ['todos', 'Todos', data.pedidos.length]].map(([value, label, count]) => (
                    <button key={value} onClick={() => setTab(value)} aria-pressed={tab === value}
                        className={`shrink-0 flex items-center gap-2 px-4 py-2 rounded-2xl border font-bold text-sm transition-all ${tab === value ? 'bg-brand-600 border-brand-600 text-white' : 'bg-white border-gray-200 text-gray-600 hover:border-brand-300'}`}>
                        {label}
                        <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${tab === value ? 'bg-white/25' : 'bg-gray-100'}`}>{count ?? 0}</span>
                    </button>
                ))}
            </div>

            <div className="card p-0 overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="w-full min-w-[900px]">
                        <thead>
                            <tr className="text-left text-xs uppercase text-gray-500 border-b bg-gray-50/60">
                                <th className="px-5 py-3">Pedido</th>
                                <th className="px-5 py-3">Cliente</th>
                                <th className="px-5 py-3">Entrega</th>
                                <th className="px-5 py-3 text-right">Total</th>
                                <th className="px-5 py-3">Estado</th>
                                <th className="px-5 py-3 text-right">Acciones</th>
                            </tr>
                        </thead>
                        <tbody>
                            {loading && data.pedidos.length === 0 && <tr><td colSpan={6} className="py-10 text-center font-bold text-gray-500">Cargando pedidos...</td></tr>}
                            {lista.map((p) => (
                                <tr key={p.id} className="border-b border-gray-100 align-top">
                                    <td className="px-5 py-4">
                                        <p className="font-black font-mono">#{p.pedido_id}</p>
                                        <p className="text-xs text-gray-500">{formatDateTime(p.fecha_solicitado)}</p>
                                    </td>
                                    <td className="px-5 py-4">
                                        <p className="font-semibold">{p.cliente_nombre}</p>
                                        <p className="text-xs text-gray-500 flex items-center gap-1"><Phone size={11} />{p.telefono}</p>
                                    </td>
                                    <td className="px-5 py-4 text-sm max-w-[280px]">
                                        <p className="flex items-start gap-1"><MapPin size={13} className="text-brand-600 shrink-0 mt-0.5" />{p.direccion}</p>
                                        {p.referencia && <p className="text-xs text-gray-500 mt-0.5">Ref: {p.referencia}</p>}
                                        {p.repartidor && <p className="text-xs text-sky-700 mt-0.5 flex items-center gap-1"><Truck size={11} />{p.repartidor}</p>}
                                    </td>
                                    <td className="px-5 py-4 text-right">
                                        <p className="font-black tabular-nums">{money(p.total)}</p>
                                        <p className="text-xs text-gray-500">{p.lineas} producto(s)</p>
                                    </td>
                                    <td className="px-5 py-4 space-y-1">
                                        <Etapa estado={estadoVisible(p)} />
                                        {facturado(p) && <p className="text-[11px] font-mono text-violet-700">{p.numero_comprobante}</p>}
                                    </td>
                                    <td className="px-5 py-4 text-right">
                                        <button className="btn btn-secondary text-xs px-3 py-2" onClick={() => setDetalleId(p.pedido_id)}><Eye size={14} /> Ver</button>
                                    </td>
                                </tr>
                            ))}
                            {!loading && lista.length === 0 && (
                                <tr>
                                    <td colSpan={6} className="py-12 text-center text-gray-500">
                                        <Bike className="mx-auto mb-2 text-gray-300" size={32} />
                                        {data.pedidos.length === 0 ? 'Aún no hay pedidos delivery. Registra el primero con "Nuevo pedido".' : 'No hay pedidos en esta etapa.'}
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            {nuevo && <NuevoPedidoModal onClose={() => setNuevo(false)} onSaved={(p) => { setNuevo(false); setMessage(`Pedido #${p.pedido_id} registrado para ${p.cliente_nombre}. Ya aparece en cocina y en facturación.`); refrescar(); setDetalleId(p.pedido_id); }} />}

            {detalleId && (
                <DetalleModal
                    id={detalleId}
                    onClose={() => setDetalleId(null)}
                    onChanged={(texto) => { if (texto) setMessage(texto); refrescar(); }}
                    onFacturar={(p) => { setEditandoProductos(null); setFacturando(p); }}
                    onEditarProductos={(p) => { setFacturando(null); setEditandoProductos(p); }}
                    reloadKey={`${facturando ? 1 : 0}${editandoProductos ? 1 : 0}`}
                />
            )}

            {facturando && (
                <EmitirComprobanteModal
                    pedido={aFacturable(facturando)}
                    onClose={() => { setFacturando(null); refrescar(); }}
                    onEmitido={(factura) => { setEditandoProductos(null); setMessage(`Pedido #${facturando.pedido_id} facturado: ${factura.numero_comprobante}.`); refrescar(); }}
                />
            )}

            {editandoProductos && (
                <EditComandaModal
                    pedido={{ id: editandoProductos.pedido_id }}
                    onClose={() => setEditandoProductos(null)}
                    onSaved={() => { setMessage(`Productos del pedido #${editandoProductos.pedido_id} actualizados.`); refrescar(); }}
                />
            )}
        </div>
    );
};

const DatosCliente = ({ form, set, clientes, conClientes }) => (
    <div className="space-y-3">
        {conClientes && (
            <Field label="Cliente registrado (opcional)">
                <select className="input" value={form.cliente_id || ''} onChange={(e) => {
                    const c = clientes.find((x) => String(x.id) === e.target.value);
                    set(c ? { cliente_id: c.id, cliente_nombre: c.nombre, telefono: c.telefono || form.telefono, direccion: c.direccion || form.direccion } : { cliente_id: null });
                }}>
                    <option value="">Cliente nuevo / sin registrar</option>
                    {clientes.map((c) => <option key={c.id} value={c.id}>{c.nombre}{c.documento ? ` · ${c.documento}` : ''}</option>)}
                </select>
            </Field>
        )}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Nombre del cliente"><input className="input" value={form.cliente_nombre} onChange={(e) => set({ cliente_nombre: e.target.value })} required minLength={3} maxLength={150} /></Field>
            <Field label="Teléfono"><input className="input" inputMode="tel" value={form.telefono} onChange={(e) => set({ telefono: e.target.value })} required maxLength={30} /></Field>
        </div>
        <Field label="Dirección de entrega"><input className="input" value={form.direccion} onChange={(e) => set({ direccion: e.target.value })} required minLength={5} maxLength={255} /></Field>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Referencia (opcional)"><input className="input" placeholder="Frente al parque, puerta azul..." value={form.referencia} onChange={(e) => set({ referencia: e.target.value })} maxLength={255} /></Field>
            <Field label="Observación (opcional)"><input className="input" placeholder="Sin ají, tocar el timbre..." value={form.observacion} onChange={(e) => set({ observacion: e.target.value })} maxLength={255} /></Field>
        </div>
    </div>
);

const EMPTY_PEDIDO = { cliente_id: null, cliente_nombre: '', telefono: '', direccion: '', referencia: '', observacion: '' };

const NuevoPedidoModal = ({ onClose, onSaved }) => {
    const [form, setForm] = useState(EMPTY_PEDIDO);
    const [clientes, setClientes] = useState([]);
    const [productos, setProductos] = useState([]);
    const [busqueda, setBusqueda] = useState('');
    const [carrito, setCarrito] = useState({});
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');
    const set = (patch) => setForm((prev) => ({ ...prev, ...patch }));

    useEffect(() => {
        fetch('/api/clientes').then((r) => (r.ok ? r.json() : [])).then((rows) => setClientes(Array.isArray(rows) ? rows : [])).catch(() => {});
        fetch('/api/productos').then((r) => readJson(r, 'No se pudo cargar la carta.')).then((rows) => setProductos((Array.isArray(rows) ? rows : []).filter((p) => Number(p.disponible)))).catch((e) => setError(e.message));
    }, []);

    const filtrados = useMemo(() => productos.filter((p) => p.nombre.toLowerCase().includes(busqueda.trim().toLowerCase())), [productos, busqueda]);
    const lineas = productos.filter((p) => carrito[p.id] > 0);
    const total = lineas.reduce((acc, p) => acc + Number(p.precio) * carrito[p.id], 0);
    const cambiar = (id, delta) => setCarrito((prev) => {
        const cantidad = Math.max(0, Math.min(999, (prev[id] || 0) + delta));
        const { [id]: _omit, ...resto } = prev;
        return cantidad > 0 ? { ...resto, [id]: cantidad } : resto;
    });

    const guardar = async (event) => {
        event.preventDefault();
        if (lineas.length === 0) { setError('Agrega al menos un producto al pedido.'); return; }
        setSaving(true);
        setError('');
        try {
            const body = await readJson(await fetch('/api/delivery', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ...form, detalles: lineas.map((p) => ({ producto_id: p.id, cantidad: carrito[p.id] })) })
            }), 'No se pudo registrar el pedido.');
            onSaved(body);
        } catch (e) {
            setError(e.message);
        } finally {
            setSaving(false);
        }
    };

    return (
        <Modal title="Nuevo pedido delivery" subtitle="Datos de entrega y productos. El pedido pasa a cocina y queda disponible para facturar." wide onClose={onClose}>
            <ErrorBox text={error} />
            <form onSubmit={guardar} className="space-y-5">
                <DatosCliente form={form} set={set} clientes={clientes} conClientes />

                <div className="space-y-2">
                    <span className="text-xs font-bold text-gray-500 uppercase tracking-widest">Productos</span>
                    <input className="input" type="search" placeholder="Buscar en la carta..." value={busqueda} onChange={(e) => setBusqueda(e.target.value)} />
                    <div className="max-h-48 overflow-y-auto space-y-1 pr-1">
                        {filtrados.map((p) => (
                            <div key={p.id} className="flex items-center justify-between gap-3 p-2 rounded-xl border border-gray-100">
                                <div className="min-w-0">
                                    <p className="text-sm font-semibold truncate">{p.nombre}</p>
                                    <p className="text-xs text-gray-500">{money(p.precio)}</p>
                                </div>
                                <button type="button" className="btn btn-secondary text-xs px-3 py-1.5" onClick={() => cambiar(p.id, 1)}><ListPlus size={14} /> Agregar</button>
                            </div>
                        ))}
                        {filtrados.length === 0 && <p className="text-sm text-gray-500 p-3">No hay productos que coincidan.</p>}
                    </div>
                </div>

                {lineas.length > 0 && (
                    <div className="rounded-2xl border border-gray-100 divide-y divide-gray-100">
                        {lineas.map((p) => (
                            <div key={p.id} className="flex items-center justify-between gap-3 p-3">
                                <p className="text-sm font-semibold truncate flex-1">{p.nombre}</p>
                                <div className="flex items-center gap-2">
                                    <button type="button" className="p-1.5 rounded-md border border-gray-200" aria-label={`Quitar uno de ${p.nombre}`} onClick={() => cambiar(p.id, -1)}><Minus size={12} /></button>
                                    <span className="w-8 text-center text-sm font-black">{carrito[p.id]}</span>
                                    <button type="button" className="p-1.5 rounded-md border border-gray-200" aria-label={`Agregar uno de ${p.nombre}`} onClick={() => cambiar(p.id, 1)}><Plus size={12} /></button>
                                </div>
                                <p className="w-24 text-right text-sm font-black tabular-nums">{money(Number(p.precio) * carrito[p.id])}</p>
                                <button type="button" className="p-1.5 text-gray-400 hover:text-rose-600" aria-label={`Eliminar ${p.nombre}`} onClick={() => cambiar(p.id, -carrito[p.id])}><Trash2 size={14} /></button>
                            </div>
                        ))}
                        <div className="flex justify-between p-3 bg-gray-50 rounded-b-2xl"><span className="font-bold">Total (incluye IGV)</span><span className="font-black text-brand-700 tabular-nums">{money(total)}</span></div>
                    </div>
                )}

                <div className="flex gap-3 pt-1">
                    <button type="button" className="btn btn-secondary flex-1" onClick={onClose}>Cancelar</button>
                    <button type="submit" className="btn btn-primary flex-1" disabled={saving || lineas.length === 0}>{saving ? 'Registrando...' : `Registrar pedido · ${money(total)}`}</button>
                </div>
            </form>
        </Modal>
    );
};

const DetalleModal = ({ id, onClose, onChanged, onFacturar, onEditarProductos, reloadKey }) => {
    const [pedido, setPedido] = useState(null);
    const [error, setError] = useState('');
    const [busy, setBusy] = useState(false);
    const [accion, setAccion] = useState(null); // 'enviado' | 'rechazado' | 'datos'
    const [repartidor, setRepartidor] = useState('');
    const [motivo, setMotivo] = useState('');
    const [datos, setDatos] = useState(EMPTY_PEDIDO);

    const cargar = useCallback(async () => {
        try {
            setPedido(await readJson(await fetch(`/api/delivery/${id}`), 'No se pudo cargar el pedido.'));
            setError('');
        } catch (e) {
            setError(e.message);
        }
    }, [id]);

    useEffect(() => { cargar(); }, [cargar, reloadKey]);

    const cambiarEstado = async (estado, texto, extra = {}) => {
        setBusy(true);
        setError('');
        try {
            setPedido(await readJson(await fetch(`/api/delivery/${id}/estado`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ estado, ...extra })
            }), 'No se pudo cambiar la etapa.'));
            setAccion(null);
            setRepartidor('');
            setMotivo('');
            onChanged(texto);
        } catch (e) {
            setError(e.message);
        } finally {
            setBusy(false);
        }
    };

    const guardarDatos = async (event) => {
        event.preventDefault();
        setBusy(true);
        setError('');
        try {
            setPedido(await readJson(await fetch(`/api/delivery/${id}`, {
                method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(datos)
            }), 'No se pudo actualizar el pedido.'));
            setAccion(null);
            onChanged(`Datos del pedido #${id} actualizados.`);
        } catch (e) {
            setError(e.message);
        } finally {
            setBusy(false);
        }
    };

    if (!pedido) {
        return <Modal title={`Pedido #${id}`} onClose={onClose}><ErrorBox text={error} />{!error && <p className="py-6 text-center font-bold text-gray-500">Cargando...</p>}</Modal>;
    }

    const conComprobante = facturado(pedido);
    const abierto = !['entregado', 'rechazado'].includes(pedido.estado) && estadoVisible(pedido) !== 'anulado';
    const editable = ['solicitado', 'enviado'].includes(pedido.estado) && !pedido.factura_id;
    const indice = ORDEN_ETAPAS.indexOf(pedido.estado);

    return (
        <Modal title={`Pedido delivery #${pedido.pedido_id}`} subtitle={`${pedido.cliente_nombre} · ${pedido.telefono}`} wide onClose={onClose}>
            <ErrorBox text={error} />

            {estadoVisible(pedido) === 'anulado' ? (
                <div className="mb-5 p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-sm"><p className="font-bold">Pedido anulado</p><p>Comprobante {pedido.numero_comprobante} anulado con nota de crédito.</p></div>
            ) : pedido.estado !== 'rechazado' ? (
                <ol className="flex items-center gap-1 mb-5 text-[10px] font-black uppercase tracking-widest">
                    {ORDEN_ETAPAS.map((etapa, i) => {
                        const hecho = etapa === 'facturado' ? conComprobante || indice > 2 : (etapa === 'enviado' ? Boolean(pedido.fecha_enviado) || indice >= 1 : i <= indice);
                        return (
                            <li key={etapa} className={`flex-1 text-center py-2 rounded-xl border ${hecho ? 'bg-brand-600 border-brand-600 text-white' : 'bg-gray-50 border-gray-100 text-gray-400'}`}>{ETAPAS[etapa][0]}</li>
                        );
                    })}
                </ol>
            ) : (
                <div className="mb-5 p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-sm"><p className="font-bold">Pedido rechazado</p><p>{pedido.motivo_rechazo}</p></div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm mb-4">
                <div className="p-3 rounded-xl bg-gray-50 border border-gray-100">
                    <p className="text-[10px] font-black uppercase tracking-widest text-gray-500 mb-1">Entrega</p>
                    <p className="font-semibold flex items-start gap-1"><MapPin size={14} className="text-brand-600 shrink-0 mt-0.5" />{pedido.direccion}</p>
                    {pedido.referencia && <p className="text-xs text-gray-500 mt-1">Ref: {pedido.referencia}</p>}
                    {pedido.observacion && <p className="text-xs text-gray-500 mt-1">Obs: {pedido.observacion}</p>}
                </div>
                <div className="p-3 rounded-xl bg-gray-50 border border-gray-100">
                    <p className="text-[10px] font-black uppercase tracking-widest text-gray-500 mb-1">Seguimiento</p>
                    <p>Estado: <Etapa estado={estadoVisible(pedido)} /></p>
                    {pedido.repartidor && <p className="mt-1 flex items-center gap-1"><Truck size={13} className="text-sky-600" />{pedido.repartidor}</p>}
                    {conComprobante && <p className="mt-1 font-mono text-violet-700">{pedido.numero_comprobante}</p>}
                    <p className="text-xs text-gray-500 mt-1">Registrado por {pedido.usuario_nombre || '-'}</p>
                </div>
            </div>

            <table className="w-full text-sm mb-2">
                <thead><tr className="text-left text-[10px] uppercase text-gray-500 border-b"><th className="py-2">Producto</th><th className="py-2 text-right">Cant.</th><th className="py-2 text-right">P. unit.</th><th className="py-2 text-right">Subtotal</th></tr></thead>
                <tbody>
                    {pedido.detalles.map((d) => (
                        <tr key={d.id} className="border-b border-gray-50">
                            <td className="py-2">{d.producto_nombre}{d.notas ? <span className="text-xs text-gray-500"> · {d.notas}</span> : null}</td>
                            <td className="py-2 text-right tabular-nums">{d.cantidad}</td>
                            <td className="py-2 text-right tabular-nums">{money(d.precio_unitario)}</td>
                            <td className="py-2 text-right tabular-nums font-semibold">{money(d.subtotal)}</td>
                        </tr>
                    ))}
                </tbody>
                <tfoot><tr><td colSpan={3} className="pt-2 text-right font-bold">Total</td><td className="pt-2 text-right font-black text-brand-700 tabular-nums">{money(pedido.total)}</td></tr></tfoot>
            </table>

            {accion === 'enviado' && (
                <div className="p-4 rounded-2xl bg-sky-50 border border-sky-100 space-y-3 mb-3">
                    <Field label="Repartidor / motorizado (opcional)"><input className="input" value={repartidor} onChange={(e) => setRepartidor(e.target.value)} maxLength={100} autoFocus /></Field>
                    <div className="flex gap-2">
                        <button type="button" className="btn btn-secondary flex-1" onClick={() => setAccion(null)}>Volver</button>
                        <button type="button" className="btn btn-primary flex-1" disabled={busy} onClick={() => cambiarEstado('enviado', `Pedido #${id} enviado.`, { repartidor })}><Truck size={16} /> Confirmar envío</button>
                    </div>
                </div>
            )}
            {accion === 'rechazado' && (
                <div className="p-4 rounded-2xl bg-rose-50 border border-rose-100 space-y-3 mb-3">
                    <Field label="Motivo del rechazo"><input className="input" value={motivo} onChange={(e) => setMotivo(e.target.value)} minLength={3} maxLength={200} placeholder="Ej. el cliente canceló, dirección fuera de zona" autoFocus /></Field>
                    <div className="flex gap-2">
                        <button type="button" className="btn btn-secondary flex-1" onClick={() => setAccion(null)}>Volver</button>
                        <button type="button" className="btn bg-rose-600 hover:bg-rose-700 text-white flex-1" disabled={busy || motivo.trim().length < 3} onClick={() => cambiarEstado('rechazado', `Pedido #${id} rechazado.`, { motivo })}><XCircle size={16} /> Rechazar pedido</button>
                    </div>
                </div>
            )}
            {accion === 'datos' && (
                <form onSubmit={guardarDatos} className="p-4 rounded-2xl bg-gray-50 border border-gray-100 space-y-3 mb-3">
                    <DatosCliente form={datos} set={(patch) => setDatos((prev) => ({ ...prev, ...patch }))} clientes={[]} conClientes={false} />
                    <div className="flex gap-2">
                        <button type="button" className="btn btn-secondary flex-1" onClick={() => setAccion(null)}>Volver</button>
                        <button type="submit" className="btn btn-primary flex-1" disabled={busy}>Guardar datos</button>
                    </div>
                </form>
            )}

            {abierto && !accion && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-4">
                    {pedido.estado === 'solicitado' && <button className="btn btn-primary" disabled={busy} onClick={() => setAccion('enviado')}><Truck size={16} /> Marcar enviado</button>}
                    {!pedido.factura_id && <button className="btn btn-primary" disabled={busy} onClick={() => onFacturar(pedido)}><FileText size={16} /> Facturar</button>}
                    {pedido.estado === 'facturado' && <button className="btn btn-secondary" disabled={busy} onClick={() => setAccion('enviado')}><Truck size={16} /> Marcar enviado</button>}
                    {conComprobante && <button className="btn btn-primary" disabled={busy} onClick={() => cambiarEstado('entregado', `Pedido #${id} entregado.`)}><PackageCheck size={16} /> Marcar entregado</button>}
                    {editable && <button className="btn btn-secondary" disabled={busy} onClick={() => onEditarProductos(pedido)}><ListPlus size={16} /> Editar productos</button>}
                    <button className="btn btn-secondary" disabled={busy} onClick={() => { setDatos({ cliente_id: pedido.cliente_id, cliente_nombre: pedido.cliente_nombre, telefono: pedido.telefono, direccion: pedido.direccion, referencia: pedido.referencia || '', observacion: pedido.observacion || '' }); setAccion('datos'); }}><Pencil size={16} /> Editar datos</button>
                    {!pedido.factura_id && <button className="btn bg-rose-600 hover:bg-rose-700 text-white" disabled={busy} onClick={() => setAccion('rechazado')}><XCircle size={16} /> Rechazar</button>}
                </div>
            )}

            {pedido.historial.length > 0 && (
                <div className="mt-6">
                    <p className="text-[10px] font-black uppercase tracking-widest text-gray-500 mb-2">Historial</p>
                    <ul className="space-y-1.5">
                        {pedido.historial.map((h) => (
                            <li key={h.id} className="flex items-start gap-2 text-xs">
                                <span className="mt-0.5"><Etapa estado={h.estado} /></span>
                                <span className="text-gray-600">{formatDateTime(h.fecha)} · {h.usuario_nombre || '-'}{h.nota ? ` · ${h.nota}` : ''}</span>
                            </li>
                        ))}
                    </ul>
                </div>
            )}

            <button className="btn btn-secondary w-full mt-5" onClick={onClose}>Cerrar</button>
        </Modal>
    );
};

export default Delivery;
