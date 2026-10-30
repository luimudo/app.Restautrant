import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Plus, Search, Download, ArrowDownToLine, ArrowUpFromLine, SlidersHorizontal, Trash2, X, RefreshCw } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { Modal, Field, ErrorBox } from '../billing/billingShared';
import { money, readJson } from '../billing/billingUtils';
import { formatDateTime, startOfMonthYmd, toPeruYmd } from '../../utils/dateTime';
import { descargarMovimientos } from '../../utils/exportInventario';
import { useUnidades, unidadesConvertibles } from '../../hooks/useUnidades';

const TIPOS_MOVIMIENTO = {
    ingreso_manual: ['ENTRADA', 'bg-emerald-50 text-emerald-700 border-emerald-200'],
    compra: ['COMPRA', 'bg-indigo-50 text-indigo-700 border-indigo-200'],
    egreso_manual: ['SALIDA', 'bg-orange-50 text-orange-700 border-orange-200'],
    ajuste_manual: ['AJUSTE', 'bg-blue-50 text-blue-700 border-blue-200'],
    venta: ['VENTA', 'bg-violet-50 text-violet-700 border-violet-200'],
    anulacion_venta: ['ANULACIÓN DE VENTA', 'bg-teal-50 text-teal-700 border-teal-200'],
    transferencia_salida: ['TRANSFERENCIA (SALIDA)', 'bg-amber-50 text-amber-700 border-amber-200'],
    transferencia_entrada: ['TRANSFERENCIA (ENTRADA)', 'bg-sky-50 text-sky-700 border-sky-200'],
    merma_transferencia: ['MERMA', 'bg-gray-100 text-gray-600 border-gray-200']
};

const MOTIVOS = {
    entrada: [['stock_inicial', 'Stock inicial'], ['ajuste_inventario', 'Ajuste de inventario'], ['donacion', 'Donación / obsequio'], ['devolucion', 'Devolución'], ['otro', 'Otro']],
    salida: [['merma', 'Merma'], ['consumo_interno', 'Consumo interno'], ['vencimiento', 'Vencimiento / deterioro'], ['ajuste_inventario', 'Ajuste de inventario'], ['otro', 'Otro']]
};

const TIPOS_REGISTRO = {
    entrada: { label: 'Entrada', icon: <ArrowDownToLine size={16} />, activo: 'bg-emerald-600 text-white shadow-lg shadow-emerald-500/30', boton: 'bg-emerald-600 hover:bg-emerald-700' },
    salida: { label: 'Salida', icon: <ArrowUpFromLine size={16} />, activo: 'bg-orange-600 text-white shadow-lg shadow-orange-500/30', boton: 'bg-orange-600 hover:bg-orange-700' },
    ajuste: { label: 'Ajuste', icon: <SlidersHorizontal size={16} />, activo: 'bg-blue-600 text-white shadow-lg shadow-blue-500/30', boton: 'bg-blue-600 hover:bg-blue-700' }
};

const cantidadTexto = (n) => Number(n).toLocaleString('es-PE', { maximumFractionDigits: 3 });

/** Entradas, salidas y ajustes de insumos y bebidas por almacén, con su historial (kardex). */
const MovimientosInventario = ({ insumos, productos, onChanged }) => {
    const { isSuperadmin, activeSede, activeSedeId } = useAuth();
    const hoy = toPeruYmd();
    const [filtros, setFiltros] = useState({ desde: startOfMonthYmd(hoy), hasta: hoy, almacen_id: '', motivo: '' });
    const [almacenes, setAlmacenes] = useState([]);
    const [movimientos, setMovimientos] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [mensaje, setMensaje] = useState('');
    const [registrando, setRegistrando] = useState(null); // 'entrada' | 'salida' | 'ajuste'

    const cargar = useCallback(async (actuales) => {
        setLoading(true);
        try {
            const params = new URLSearchParams({ desde: actuales.desde, hasta: actuales.hasta });
            if (actuales.almacen_id) params.set('almacen_id', actuales.almacen_id);
            if (actuales.motivo) params.set('motivo', actuales.motivo);
            if (isSuperadmin) params.set('sede_id', activeSedeId);
            setMovimientos(await readJson(await fetch(`/api/inventario/movimientos?${params}`), 'No se pudo cargar los movimientos.'));
            setError('');
        } catch (e) {
            setError(e.message);
        } finally {
            setLoading(false);
        }
    }, [isSuperadmin, activeSedeId]);

    useEffect(() => {
        fetch(`/api/almacenes${isSuperadmin ? `?sede_id=${activeSedeId}` : ''}`).then((r) => readJson(r, 'No se pudo cargar los almacenes.'))
            .then((rows) => setAlmacenes(rows.filter((a) => Number(a.activo)))).catch((e) => setError(e.message));
        cargar(filtros);
        // The first load only; later searches use the Buscar button.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const resumen = useMemo(() => movimientos.reduce((acc, m) => {
        if (m.motivo === 'ingreso_manual' || m.motivo === 'compra') acc.entradas += 1;
        else if (m.motivo === 'egreso_manual') acc.salidas += 1;
        else if (m.motivo === 'ajuste_manual') acc.ajustes += 1;
        return acc;
    }, { entradas: 0, salidas: 0, ajustes: 0 }), [movimientos]);

    const exportar = async () => {
        if (movimientos.length === 0) { setError('No hay movimientos en el rango seleccionado.'); return; }
        try {
            await descargarMovimientos({ periodo: { desde: filtros.desde, hasta: filtros.hasta }, sedeNombre: activeSede?.nombre || 'Sede', movimientos });
        } catch (e) {
            setError('No se pudo generar el Excel de movimientos.');
        }
    };

    return (
        <div className="space-y-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                    <h3 className="text-xl font-display font-black">Movimientos de inventario</h3>
                    <p className="text-sm text-[var(--text-secondary)]">Registra entradas, salidas y ajustes de insumos y bebidas, y revisa el historial.</p>
                </div>
                <div className="flex flex-wrap gap-2">
                    {Object.entries(TIPOS_REGISTRO).map(([tipo, cfg]) => (
                        <button key={tipo} type="button" onClick={() => setRegistrando(tipo)} className={`btn text-white flex items-center gap-2 ${cfg.boton}`}>
                            {cfg.icon} {cfg.label}
                        </button>
                    ))}
                </div>
            </div>

            {mensaje && <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-700 font-semibold">{mensaje}</div>}
            {error && <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 font-semibold">{error}</div>}

            <form onSubmit={(e) => { e.preventDefault(); cargar(filtros); }} className="card bg-white p-5 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_1.3fr_1.3fr_auto_auto] gap-3 items-end">
                <Field label="Desde"><input type="date" className="input" value={filtros.desde} max={filtros.hasta} onChange={(e) => setFiltros({ ...filtros, desde: e.target.value })} required /></Field>
                <Field label="Hasta"><input type="date" className="input" value={filtros.hasta} min={filtros.desde} onChange={(e) => setFiltros({ ...filtros, hasta: e.target.value })} required /></Field>
                <Field label="Almacén">
                    <select className="input" value={filtros.almacen_id} onChange={(e) => setFiltros({ ...filtros, almacen_id: e.target.value })}>
                        <option value="">Todos</option>
                        {almacenes.map((a) => <option key={a.id} value={a.id}>{a.nombre}</option>)}
                    </select>
                </Field>
                <Field label="Tipo de movimiento">
                    <select className="input" value={filtros.motivo} onChange={(e) => setFiltros({ ...filtros, motivo: e.target.value })}>
                        <option value="">Todos</option>
                        {Object.entries(TIPOS_MOVIMIENTO).map(([valor, [etiqueta]]) => <option key={valor} value={valor}>{etiqueta}</option>)}
                    </select>
                </Field>
                <button type="submit" className="btn btn-secondary"><Search size={16} /> Buscar</button>
                <button type="button" className="btn btn-secondary" onClick={exportar}><Download size={16} /> Excel</button>
            </form>

            <div className="grid grid-cols-3 gap-4">
                <div className="card bg-white p-4"><p className="text-[10px] font-black uppercase tracking-widest text-gray-400">Entradas</p><p className="text-2xl font-display font-black text-emerald-600">{resumen.entradas}</p></div>
                <div className="card bg-white p-4"><p className="text-[10px] font-black uppercase tracking-widest text-gray-400">Salidas</p><p className="text-2xl font-display font-black text-orange-600">{resumen.salidas}</p></div>
                <div className="card bg-white p-4"><p className="text-[10px] font-black uppercase tracking-widest text-gray-400">Ajustes</p><p className="text-2xl font-display font-black text-blue-600">{resumen.ajustes}</p></div>
            </div>

            <div className="card bg-white p-0 overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="w-full min-w-[960px]">
                        <thead>
                            <tr className="text-left text-xs uppercase text-gray-500 border-b bg-gray-50/60">
                                <th className="px-5 py-3">Fecha</th>
                                <th className="px-5 py-3">Tipo</th>
                                <th className="px-5 py-3">Almacén</th>
                                <th className="px-5 py-3">Producto / Insumo</th>
                                <th className="px-5 py-3 text-right">Cantidad</th>
                                <th className="px-5 py-3 text-right">Costo unit.</th>
                                <th className="px-5 py-3 text-right">Costo total</th>
                                <th className="px-5 py-3">Referencia / Motivo</th>
                                <th className="px-5 py-3">Operador</th>
                            </tr>
                        </thead>
                        <tbody>
                            {loading && <tr><td colSpan={9} className="py-10 text-center font-bold text-gray-500">Cargando movimientos...</td></tr>}
                            {!loading && movimientos.map((m) => {
                                const [etiqueta, estilo] = TIPOS_MOVIMIENTO[m.motivo] || [m.motivo, 'bg-gray-100 text-gray-600 border-gray-200'];
                                return (
                                    <tr key={m.id} className="border-b border-gray-100 align-top">
                                        <td className="px-5 py-3 text-xs text-gray-600 whitespace-nowrap">{formatDateTime(m.fecha)}</td>
                                        <td className="px-5 py-3"><span className={`inline-block px-2 py-1 rounded-lg border text-[10px] font-black uppercase tracking-widest whitespace-nowrap ${estilo}`}>{etiqueta}</span></td>
                                        <td className="px-5 py-3 text-sm"><p className="font-semibold">{m.almacen_nombre}</p><p className="text-xs text-gray-500">{m.sede_nombre}</p></td>
                                        <td className="px-5 py-3 text-sm"><p className="font-semibold">{m.item_nombre}</p><p className="text-[10px] font-black uppercase text-gray-400">{m.tipo_item === 'insumo' ? 'Insumo' : m.tipo_item === 'producto' ? 'Bebida / producto' : 'Equipo'}</p></td>
                                        <td className={`px-5 py-3 text-right font-black tabular-nums ${m.cantidad < 0 ? 'text-rose-600' : 'text-emerald-600'}`}>
                                            {m.cantidad > 0 ? '+' : ''}{cantidadTexto(m.cantidad)} <span className="text-[10px] font-normal text-gray-500">{m.unidad}</span>
                                        </td>
                                        <td className="px-5 py-3 text-right tabular-nums text-sm">{m.costo_unitario > 0 ? money(m.costo_unitario) : '—'}</td>
                                        <td className="px-5 py-3 text-right tabular-nums text-sm font-semibold">{m.costo_total > 0 ? money(m.costo_total) : '—'}</td>
                                        <td className="px-5 py-3 text-sm text-gray-600 max-w-[260px]">
                                            {m.referencia && <p className="font-semibold text-gray-800 truncate" title={m.referencia}>{m.referencia}</p>}
                                            <p className="text-xs text-gray-500 truncate" title={m.detalle || ''}>{m.detalle || (m.referencia ? '' : '—')}</p>
                                        </td>
                                        <td className="px-5 py-3 text-xs font-bold text-gray-500">{m.usuario_nombre || 'SISTEMA'}</td>
                                    </tr>
                                );
                            })}
                            {!loading && movimientos.length === 0 && <tr><td colSpan={9} className="py-12 text-center text-gray-500">No hay movimientos en ese rango. Usa Entrada, Salida o Ajuste para registrar el primero.</td></tr>}
                        </tbody>
                    </table>
                </div>
            </div>

            {registrando && (
                <RegistrarMovimientoModal
                    tipoInicial={registrando}
                    almacenes={almacenes}
                    insumos={insumos}
                    productos={productos}
                    onClose={() => setRegistrando(null)}
                    onSaved={(body) => {
                        setRegistrando(null);
                        setMensaje(`${body.message}: ${body.items} item(s).`);
                        cargar(filtros);
                        onChanged?.();
                    }}
                />
            )}
        </div>
    );
};

/** Product search with autocomplete (insumos and finished drinks/products). */
const BuscadorItem = ({ valor, opciones, onSeleccion }) => {
    const [texto, setTexto] = useState(valor?.nombre || '');
    const [abierto, setAbierto] = useState(false);
    const ref = useRef(null);

    useEffect(() => { setTexto(valor?.nombre || ''); }, [valor]);
    useEffect(() => {
        const cerrar = (e) => { if (ref.current && !ref.current.contains(e.target)) setAbierto(false); };
        document.addEventListener('mousedown', cerrar);
        return () => document.removeEventListener('mousedown', cerrar);
    }, []);

    const filtradas = opciones.filter((o) => !texto.trim() || o.nombre.toLowerCase().includes(texto.trim().toLowerCase())).slice(0, 15);

    return (
        <div ref={ref} className="relative">
            <div className="relative">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                <input
                    className="input pl-9 pr-8"
                    value={texto}
                    onChange={(e) => { setTexto(e.target.value); setAbierto(true); if (valor) onSeleccion(null); }}
                    onFocus={() => setAbierto(true)}
                    placeholder="Buscar insumo o bebida..."
                    aria-label="Buscar producto o insumo"
                />
                {valor && (
                    <button type="button" className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-rose-500" aria-label="Quitar selección" onClick={() => { setTexto(''); onSeleccion(null); }}>
                        <X size={14} />
                    </button>
                )}
            </div>
            {abierto && !valor && (
                <div className="absolute z-[70] mt-1 w-full bg-white rounded-2xl shadow-2xl border border-gray-100 max-h-56 overflow-y-auto">
                    {filtradas.length === 0 && <p className="px-4 py-3 text-xs italic text-gray-500 text-center">No se encontró "{texto}"</p>}
                    {filtradas.map((o) => (
                        <button key={`${o.tipo_item}-${o.id}`} type="button" onMouseDown={() => { onSeleccion(o); setAbierto(false); }}
                            className="w-full text-left px-4 py-2.5 hover:bg-gray-50 flex items-center justify-between gap-2 border-b border-gray-50 last:border-0">
                            <span><span className="block text-sm font-bold">{o.nombre}</span><span className="block text-[10px] text-gray-500">{o.unidad}</span></span>
                            <span className={`text-[9px] font-black px-1.5 py-0.5 rounded-full shrink-0 ${o.tipo_item === 'insumo' ? 'bg-amber-100 text-amber-700' : 'bg-blue-100 text-blue-700'}`}>{o.tipo_item === 'insumo' ? 'INSUMO' : 'BEBIDA'}</span>
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
};

const FILA_VACIA = () => ({ clave: `${Date.now()}-${Math.random()}`, opcion: null, cantidad: '', costo: '', fisico: '' });

const RegistrarMovimientoModal = ({ tipoInicial, almacenes, insumos, productos, onClose, onSaved }) => {
    const [tipo, setTipo] = useState(tipoInicial);
    const principal = almacenes.find((a) => Number(a.para_compras)) || almacenes[0];
    const [almacenId, setAlmacenId] = useState(principal ? String(principal.id) : '');
    const [referencia, setReferencia] = useState('');
    const [motivo, setMotivo] = useState('');
    const [filas, setFilas] = useState([FILA_VACIA()]);
    const [stock, setStock] = useState({});
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');
    const cfg = TIPOS_REGISTRO[tipo];

    const opciones = useMemo(() => [
        ...insumos.map((i) => ({ tipo_item: 'insumo', id: i.id, nombre: i.nombre, unidad: i.unidad_medida || 'Unidad', unidad_id: i.unidad_id || null, costo: Number(i.costo_unitario) || 0 })),
        ...productos.map((p) => ({ tipo_item: 'producto', id: p.id, nombre: p.nombre, unidad: p.unidad_medida || 'Unidad', unidad_id: null, costo: 0, decimales: Number(p.unidad_decimales) === 1 }))
    ], [insumos, productos]);
    // Un producto se cuenta en enteros salvo que su unidad admita decimales (p. ej. cerveza por Litro).
    const soloEnteros = (opcion) => opcion?.tipo_item === 'producto' && !opcion.decimales;
    const { activas: unidadesActivas, conversiones } = useUnidades(true);
    // Units a supply line can be typed in (its own plus the ones that convert to it); other items only have their own.
    const unidadesDeFila = (opcion) => (opcion?.tipo_item === 'insumo' ? unidadesConvertibles(unidadesActivas, conversiones, opcion.unidad_id) : []);

    // Current stock of the warehouse: shown as "Sistema" in adjustments and as availability in exits.
    useEffect(() => {
        setStock({});
        if (!almacenId) return;
        fetch(`/api/almacenes/${almacenId}/stock`).then((r) => readJson(r, 'No se pudo cargar el stock.'))
            .then((body) => setStock(Object.fromEntries(body.items.filter((i) => i.tipo_item !== 'equipo').map((i) => [`${i.tipo_item}-${i.item_id}`, i.stock]))))
            .catch((e) => setError(e.message));
    }, [almacenId]);

    const stockDe = (opcion) => (opcion ? Number(stock[`${opcion.tipo_item}-${opcion.id}`] || 0) : 0);
    const actualizar = (clave, parche) => setFilas((prev) => prev.map((f) => (f.clave === clave ? { ...f, ...parche } : f)));
    const cambiarTipo = (nuevo) => { setTipo(nuevo); setMotivo(''); setError(''); };

    const guardar = async (event) => {
        event.preventDefault();
        setError('');
        const completas = filas.filter((f) => f.opcion);
        if (completas.length === 0) { setError('Agrega al menos un insumo o bebida al movimiento.'); return; }
        if (completas.length !== filas.length) { setError('Hay filas sin producto: selecciónalo o elimina la fila.'); return; }
        setSaving(true);
        try {
            const body = await readJson(await fetch('/api/inventario/movimientos/lote', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    tipo, almacen_id: Number(almacenId), referencia, motivo,
                    items: completas.map((f) => ({
                        tipo_item: f.opcion.tipo_item,
                        item_id: f.opcion.id,
                        ...(tipo === 'ajuste' ? { cantidad_fisica: Number(f.fisico) } : { cantidad: Number(f.cantidad) }),
                        ...(tipo !== 'ajuste' && f.opcion.tipo_item === 'insumo' && f.unidad_id ? { unidad_id: Number(f.unidad_id) } : {}),
                        ...(tipo === 'entrada' && f.opcion.tipo_item === 'insumo' && f.costo !== '' ? { costo_unitario: Number(f.costo) } : {})
                    }))
                })
            }), 'No se pudo registrar el movimiento.');
            onSaved(body);
        } catch (e) {
            setError(e.message);
        } finally {
            setSaving(false);
        }
    };

    return (
        <Modal title="Registrar movimiento de inventario" subtitle="Entradas, salidas y ajustes de insumos y bebidas por almacén." wide onClose={onClose}>
            <ErrorBox text={error} />
            <form onSubmit={guardar} className="space-y-5">
                <div className="grid grid-cols-3 gap-2 p-1 bg-gray-50 rounded-2xl border border-gray-100">
                    {Object.entries(TIPOS_REGISTRO).map(([valor, c]) => (
                        <button key={valor} type="button" onClick={() => cambiarTipo(valor)} aria-pressed={tipo === valor}
                            className={`flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-bold transition-all ${tipo === valor ? c.activo : 'text-gray-500 hover:bg-white'}`}>
                            {c.icon}{c.label.toUpperCase()}
                        </button>
                    ))}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <Field label={`Almacén ${tipo === 'entrada' ? 'destino' : tipo === 'salida' ? 'origen' : 'a ajustar'}`}>
                        <select className="input" value={almacenId} onChange={(e) => setAlmacenId(e.target.value)} required>
                            <option value="">Seleccione almacén...</option>
                            {almacenes.map((a) => <option key={a.id} value={a.id}>{a.nombre}</option>)}
                        </select>
                    </Field>
                    <Field label="Referencia (opcional)">
                        <input className="input" value={referencia} onChange={(e) => setReferencia(e.target.value)} placeholder="Ej. Guía F001-1234" maxLength={100} />
                    </Field>
                </div>

                {tipo !== 'ajuste' && (
                    <Field label="Motivo">
                        <select className="input" value={motivo} onChange={(e) => setMotivo(e.target.value)} required>
                            <option value="">Seleccione...</option>
                            {MOTIVOS[tipo].map(([valor, etiqueta]) => <option key={valor} value={valor}>{etiqueta}</option>)}
                        </select>
                    </Field>
                )}

                <div className="space-y-3">
                    <div className="flex items-center justify-between border-b border-gray-100 pb-2">
                        <span className="text-xs font-black uppercase tracking-widest text-gray-500">Detalle de insumos / bebidas</span>
                        <button type="button" onClick={() => setFilas((prev) => [...prev, FILA_VACIA()])} className="flex items-center gap-1 px-3 py-1.5 rounded-xl text-sm font-bold text-brand-600 bg-brand-50 border border-brand-100 hover:bg-brand-100">
                            <Plus size={14} /> Agregar fila
                        </button>
                    </div>

                    {filas.map((fila) => {
                        const sistema = stockDe(fila.opcion);
                        const diferencia = (Number(fila.fisico) || 0) - sistema;
                        return (
                            <div key={fila.clave} className="grid grid-cols-12 gap-3 items-end p-3 rounded-2xl bg-gray-50 border border-gray-100">
                                <div className={`col-span-12 ${tipo === 'ajuste' ? 'md:col-span-5' : tipo === 'entrada' ? 'md:col-span-4' : 'md:col-span-6'}`}>
                                    <span className="text-[10px] font-black uppercase text-gray-400">Producto / insumo</span>
                                    <BuscadorItem valor={fila.opcion} opciones={opciones} onSeleccion={(opcion) => actualizar(fila.clave, { opcion, costo: opcion?.costo ? String(opcion.costo) : '', unidad_id: opcion?.unidad_id ? String(opcion.unidad_id) : '' })} />
                                </div>

                                {tipo === 'ajuste' ? (
                                    <>
                                        <div className="col-span-4 md:col-span-2">
                                            <span className="text-[10px] font-black uppercase text-gray-400">Sistema</span>
                                            <input className="input bg-gray-100 text-gray-500 font-mono" disabled value={fila.opcion ? cantidadTexto(sistema) : '—'} aria-label="Stock del sistema" />
                                        </div>
                                        <div className="col-span-4 md:col-span-2">
                                            <span className="text-[10px] font-black uppercase text-gray-400">Físico real</span>
                                            <input type="number" min="0" step={soloEnteros(fila.opcion) ? 1 : 0.001} className="input font-mono" value={fila.fisico} onChange={(e) => actualizar(fila.clave, { fisico: e.target.value })} required aria-label="Conteo físico" />
                                        </div>
                                        <div className="col-span-3 md:col-span-2">
                                            <span className="text-[10px] font-black uppercase text-gray-400">Diferencia</span>
                                            <div className={`input font-mono font-bold ${fila.fisico === '' || diferencia === 0 ? 'text-gray-500' : diferencia > 0 ? 'text-emerald-600 bg-emerald-50' : 'text-rose-600 bg-rose-50'}`}>
                                                {fila.fisico === '' ? '—' : `${diferencia > 0 ? '+' : ''}${cantidadTexto(diferencia)}`}
                                            </div>
                                        </div>
                                    </>
                                ) : (
                                    <>
                                        <div className={`col-span-5 ${tipo === 'entrada' ? 'md:col-span-2' : 'md:col-span-3'}`}>
                                            <span className="text-[10px] font-black uppercase text-gray-400">Cantidad{tipo === 'salida' && fila.opcion ? ` (disp. ${cantidadTexto(sistema)} ${fila.opcion.unidad})` : ''}</span>
                                            <input type="number" min={soloEnteros(fila.opcion) ? 1 : 0.001} step={soloEnteros(fila.opcion) ? 1 : 0.001}
                                                max={tipo === 'salida' && fila.opcion && String(fila.unidad_id || '') === String(fila.opcion.unidad_id || '') ? sistema : undefined}
                                                className="input font-mono" value={fila.cantidad} onChange={(e) => actualizar(fila.clave, { cantidad: e.target.value })} required aria-label="Cantidad" />
                                        </div>
                                        <div className="col-span-6 md:col-span-2">
                                            <span className="text-[10px] font-black uppercase text-gray-400">Unidad</span>
                                            {unidadesDeFila(fila.opcion).length > 1 ? (
                                                <select className="input" value={fila.unidad_id || ''} onChange={(e) => actualizar(fila.clave, { unidad_id: e.target.value })} aria-label="Unidad del movimiento">
                                                    {unidadesDeFila(fila.opcion).map((u) => <option key={u.id} value={u.id}>{u.abreviatura}</option>)}
                                                </select>
                                            ) : (
                                                <div className="input bg-gray-100 text-gray-500">{fila.opcion?.unidad || '—'}</div>
                                            )}
                                        </div>
                                        {tipo === 'entrada' && (
                                            <div className="col-span-6 md:col-span-3">
                                                <span className="text-[10px] font-black uppercase text-gray-400">Costo unit. (S/) <span className="font-normal lowercase">(opcional)</span></span>
                                                <input type="number" min="0" step="0.01" className="input font-mono" value={fila.costo} onChange={(e) => actualizar(fila.clave, { costo: e.target.value })} disabled={fila.opcion?.tipo_item === 'producto'}
                                                    placeholder={fila.opcion?.tipo_item === 'producto' ? 'No aplica' : '0.00'} aria-label="Costo unitario" />
                                            </div>
                                        )}
                                    </>
                                )}

                                <div className="col-span-1 flex justify-end pb-1">
                                    {filas.length > 1 && (
                                        <button type="button" className="p-2 text-rose-400 hover:text-rose-600 hover:bg-rose-50 rounded-xl" onClick={() => setFilas((prev) => prev.filter((f) => f.clave !== fila.clave))} aria-label="Eliminar fila"><Trash2 size={16} /></button>
                                    )}
                                </div>
                            </div>
                        );
                    })}
                    {tipo === 'entrada' && <p className="text-xs text-gray-500"><RefreshCw size={11} className="inline mr-1" />Con costo, el costo del insumo se recalcula como promedio ponderado con el stock actual.</p>}
                    {tipo === 'ajuste' && <p className="text-xs text-gray-500">El ajuste registra la diferencia entre el conteo físico y el stock del sistema; las filas sin diferencia no generan movimiento.</p>}
                </div>

                <div className="flex gap-3 pt-1">
                    <button type="button" className="btn btn-secondary flex-1" onClick={onClose}>Cancelar</button>
                    <button type="submit" className={`btn text-white flex-1 flex items-center justify-center gap-2 ${cfg.boton}`} disabled={saving || !almacenId}>
                        {cfg.icon} {saving ? 'Procesando...' : `Confirmar ${cfg.label.toLowerCase()}`}
                    </button>
                </div>
            </form>
        </Modal>
    );
};

export default MovimientosInventario;
