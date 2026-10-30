import React, { useState, useEffect } from 'react';
import { ShoppingCart, Plus, Trash2, Save, Package, Calendar, FileText, Download } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAuth } from '../context/AuthContext';
import { formatDate, toPeruYmd, startOfMonthYmd } from '../utils/dateTime';
import { descargarReporteCompras } from '../utils/exportCompras';
import SolesSymbol from '../components/SolesSymbol';
import { useUnidades, unidadesConvertibles } from '../hooks/useUnidades';

const Purchases = () => {
    const { activeUser, activeSede } = useAuth();
    const { activas: unidadesActivas, conversiones } = useUnidades(!!activeUser);
    const [periodo, setPeriodo] = useState(() => {
        const hoy = toPeruYmd();
        return { desde: startOfMonthYmd(hoy), hasta: hoy };
    });
    const [exporting, setExporting] = useState(false);
    const [insumos, setInsumos] = useState([]);
    const [productos, setProductos] = useState([]);
    const [proveedores, setProveedores] = useState([]);
    const [detalles, setDetalles] = useState([]);
    const [proveedorId, setProveedorId] = useState('');
    const [almacenes, setAlmacenes] = useState([]);
    const [almacenId, setAlmacenId] = useState('');
    const [numFactura, setNumFactura] = useState('');
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (!activeUser) return;
        fetchData();
    }, [activeUser]);

    const fetchData = async () => {
        try {
            const [insRes, prodRes, provRes] = await Promise.all([
                fetch('/api/insumos'),
                fetch('/api/productos'),
                fetch('/api/proveedores')
            ]);
            
            if (!insRes.ok || !prodRes.ok || !provRes.ok) {
                if (insRes.status === 401 || prodRes.status === 401 || provRes.status === 401) {
                    console.warn('Sesión expirada o no autorizada');
                    setLoading(false);
                    return;
                }
            }
            
            const insData = await insRes.json();
            const prodData = await prodRes.json();
            const provData = await provRes.json();
            // Warehouses of the sede: the purchase enters the "compras" one unless another is chosen.
            const almRes = await fetch('/api/almacenes');
            const almData = almRes.ok ? (await almRes.json()).filter((a) => Number(a.activo)) : [];
            setAlmacenes(almData);
            const porDefecto = almData.find((a) => Number(a.para_compras)) || almData[0];
            if (porDefecto) setAlmacenId(String(porDefecto.id));

            setInsumos(insData);
            setProductos(prodData.filter(p => !Number(p.es_receta)));
            setProveedores(provData);
            if (provData.length > 0) setProveedorId(provData[0].id);
        } catch (error) {
            console.error('Error fetching data:', error);
        } finally {
            setLoading(false);
        }
    };

    const addDetail = (type) => {
        setDetalles([...detalles, {
            type,
            id: '',
            cantidad: 1,
            precio_unitario: 0
        }]);
    };

    const updateDetail = (index, field, value) => {
        const newDetalles = [...detalles];
        newDetalles[index][field] = value;
        setDetalles(newDetalles);
    };

    // Units a supply can be bought in: its own plus the ones that convert to it.
    const unidadesDeInsumo = (insumoId) => {
        const insumo = insumos.find((i) => String(i.id) === String(insumoId));
        const lista = unidadesConvertibles(unidadesActivas, conversiones, insumo?.unidad_id);
        return lista.length > 0 ? lista : [{ id: '', abreviatura: insumo?.unidad_medida || 'Unidad' }];
    };

    const removeDetail = (index) => {
        setDetalles(detalles.filter((_, i) => i !== index));
    };

    const total = detalles.reduce((acc, curr) => acc + (curr.cantidad * curr.precio_unitario), 0);

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (detalles.length === 0) return alert('Agregue al menos un producto');

        const payload = {
            proveedor_id: proveedorId || 1, // Default for now
            numero_factura_proveedor: numFactura,
            almacen_id: almacenId ? Number(almacenId) : undefined,
            detalles: detalles.map(d => ({
                [d.type === 'insumo' ? 'insumo_id' : 'producto_id']: d.id,
                ...(d.type === 'insumo' && d.unidad_id ? { unidad_id: Number(d.unidad_id) } : {}),
                cantidad: parseFloat(d.cantidad),
                precio_unitario: parseFloat(d.precio_unitario)
            }))
        };

        try {
            const res = await fetch('/api/compras', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            if (res.ok) {
                alert('Compra registrada correctamente');
                setDetalles([]);
                setNumFactura('');
                fetchData();
            } else {
                alert('Error al registrar la compra');
            }
        } catch (error) {
            console.error('Error submitting purchase:', error);
        }
    };

    const exportarReporte = async () => {
        if (periodo.desde > periodo.hasta) return alert('La fecha inicial no puede ser posterior a la final');
        setExporting(true);
        try {
            const res = await fetch(`/api/compras?desde=${periodo.desde}&hasta=${periodo.hasta}`);
            if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Error al consultar las compras');
            const rows = await res.json();
            if (rows.length === 0) return alert('No hay compras en el periodo seleccionado');
            await descargarReporteCompras({ periodo, sedeNombre: activeSede?.nombre || 'Sede', rows });
        } catch (error) {
            console.error('Error exporting purchases:', error);
            alert(error.message || 'No se pudo generar el reporte de compras.');
        } finally {
            setExporting(false);
        }
    };

    if (loading) return <div>Cargando...</div>;

    return (
        <div className="space-y-8 animate-fade-in">
            <div className="flex justify-between items-center">
                <div>
                    <h2 className="text-4xl font-display font-black uppercase">Gestión de <span className="text-brand-600">Compras</span></h2>
                    <p className="text-[var(--text-secondary)] mt-1.5 font-medium">Registro de abastecimiento para insumos y productos de bar.</p>
                </div>
                <div className="flex flex-wrap items-end gap-2">
                    <label className="text-[10px] font-black uppercase text-gray-400">Desde
                        <input type="date" value={periodo.desde} max={periodo.hasta} onChange={(e) => setPeriodo({ ...periodo, desde: e.target.value })}
                            className="block mt-1 px-3 py-2 bg-gray-50 rounded-xl text-sm outline-none" />
                    </label>
                    <label className="text-[10px] font-black uppercase text-gray-400">Hasta
                        <input type="date" value={periodo.hasta} min={periodo.desde} onChange={(e) => setPeriodo({ ...periodo, hasta: e.target.value })}
                            className="block mt-1 px-3 py-2 bg-gray-50 rounded-xl text-sm outline-none" />
                    </label>
                    <button type="button" className="btn btn-secondary flex items-center gap-2" onClick={exportarReporte} disabled={exporting || !periodo.desde || !periodo.hasta}>
                        <Download size={18} /> {exporting ? 'Generando...' : 'Excel'}
                    </button>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                {/* Purchase Form */}
                <div className="lg:col-span-2 space-y-6">
                    <form onSubmit={handleSubmit} className="card p-8 space-y-6">
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                            <div className="space-y-2">
                                <label className="text-xs font-black uppercase tracking-widest text-[var(--text-muted)]">N° Factura / Boleta</label>
                                <div className="relative">
                                    <FileText className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
                                    <input
                                        type="text"
                                        value={numFactura}
                                        onChange={(e) => setNumFactura(e.target.value)}
                                        className="w-full pl-12 pr-4 py-3 bg-gray-50 border-transparent rounded-2xl text-sm focus:bg-white focus:ring-4 focus:ring-brand-500/10 transition-all outline-none"
                                        placeholder="Ejem: F001-000123"
                                        required
                                    />
                                </div>
                            </div>
                            <div className="space-y-2">
                                <label className="text-xs font-black uppercase tracking-widest text-[var(--text-muted)]">Proveedor</label>
                                <select
                                    className="w-full px-4 py-3 bg-gray-50 border-transparent rounded-2xl text-sm outline-none"
                                    value={proveedorId}
                                    onChange={(e) => setProveedorId(e.target.value)}
                                    required
                                >
                                    {proveedores.map(prov => (
                                        <option key={prov.id} value={prov.id}>{prov.razon_social || prov.nombre}</option>
                                    ))}
                                </select>
                            </div>
                            <div className="space-y-2">
                                <label className="text-xs font-black uppercase tracking-widest text-[var(--text-muted)]">Almacén de ingreso</label>
                                <select
                                    className="w-full px-4 py-3 bg-gray-50 border-transparent rounded-2xl text-sm outline-none"
                                    value={almacenId}
                                    onChange={(e) => setAlmacenId(e.target.value)}
                                    aria-label="Almacén de ingreso"
                                >
                                    {almacenes.map((a) => (
                                        <option key={a.id} value={a.id}>{a.nombre}{Number(a.para_compras) ? ' (compras)' : ''}</option>
                                    ))}
                                </select>
                            </div>
                            <div className="space-y-2">
                                <label className="text-xs font-black uppercase tracking-widest text-[var(--text-muted)]">Fecha de Registro</label>
                                <div className="relative">
                                    <Calendar className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
                                    <input
                                        type="text"
                                        value={formatDate(new Date())}
                                        disabled
                                        className="w-full pl-12 pr-4 py-3 bg-gray-100 border-transparent rounded-2xl text-sm outline-none"
                                    />
                                </div>
                            </div>
                        </div>

                        <div className="space-y-4">
                            <div className="flex justify-between items-center">
                                <h3 className="font-bold text-lg">Detalle de Productos</h3>
                                <div className="flex gap-2">
                                    <button
                                        type="button"
                                        onClick={() => addDetail('insumo')}
                                        className="btn bg-gray-100 text-gray-700 hover:bg-gray-200 py-2 px-4 rounded-xl text-xs font-bold flex items-center gap-2"
                                    >
                                        <Plus size={14} /> + Insumo
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => addDetail('producto')}
                                        className="btn bg-brand-50 text-brand-700 hover:bg-brand-100 py-2 px-4 rounded-xl text-xs font-bold flex items-center gap-2"
                                    >
                                        <Plus size={14} /> + Bebida/Bar
                                    </button>
                                </div>
                            </div>

                            <div className="space-y-4 max-h-[400px] overflow-y-auto pr-2 custom-scrollbar">
                                <AnimatePresence>
                                    {detalles.map((detalle, index) => (
                                        <motion.div
                                            key={index}
                                            initial={{ opacity: 0, x: -20 }}
                                            animate={{ opacity: 1, x: 0 }}
                                            exit={{ opacity: 0, x: 20 }}
                                            className="grid grid-cols-1 md:grid-cols-12 gap-4 items-end bg-gray-50 p-4 rounded-2xl relative group"
                                        >
                                            <div className="md:col-span-4 space-y-1">
                                                <label className="text-[10px] font-black uppercase text-gray-400">
                                                    {detalle.type === 'insumo' ? 'Insumo (Materia Prima)' : 'Producto Terminado (Bar)'}
                                                </label>
                                                <select
                                                    value={detalle.id}
                                                    onChange={(e) => {
                                                        const insumo = detalle.type === 'insumo' ? insumos.find((i) => String(i.id) === e.target.value) : null;
                                                        const nuevos = [...detalles];
                                                        nuevos[index] = { ...nuevos[index], id: e.target.value, unidad_id: insumo?.unidad_id ? String(insumo.unidad_id) : '' };
                                                        setDetalles(nuevos);
                                                    }}
                                                    className="w-full px-4 py-2 bg-white rounded-xl text-sm border-transparent focus:ring-2 focus:ring-brand-500 outline-none"
                                                    required
                                                >
                                                    <option value="">Seleccionar...</option>
                                                    {detalle.type === 'insumo'
                                                        ? insumos.map(i => <option key={i.id} value={i.id}>{i.nombre}</option>)
                                                        : productos.map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)
                                                    }
                                                </select>
                                            </div>
                                            <div className="md:col-span-2 space-y-1">
                                                <label className="text-[10px] font-black uppercase text-gray-400">Cantidad</label>
                                                <input
                                                    type="number"
                                                    value={detalle.cantidad}
                                                    onChange={(e) => updateDetail(index, 'cantidad', e.target.value)}
                                                    className="w-full px-4 py-2 bg-white rounded-xl text-sm border-transparent"
                                                    min="0.001"
                                                    step="0.001"
                                                    required
                                                />
                                            </div>
                                            <div className="md:col-span-2 space-y-1">
                                                <label className="text-[10px] font-black uppercase text-gray-400">Unidad</label>
                                                {detalle.type === 'insumo' && detalle.id ? (
                                                    <select
                                                        value={detalle.unidad_id || ''}
                                                        onChange={(e) => updateDetail(index, 'unidad_id', e.target.value)}
                                                        className="w-full px-3 py-2 bg-white rounded-xl text-sm border-transparent outline-none"
                                                        aria-label="Unidad de compra"
                                                    >
                                                        {unidadesDeInsumo(detalle.id).map((u) => <option key={u.id} value={u.id}>{u.abreviatura}</option>)}
                                                    </select>
                                                ) : (
                                                    <div className="px-3 py-2 bg-gray-100 rounded-xl text-sm text-gray-500">
                                                        {detalle.type === 'insumo' ? '—' : (productos.find((p) => String(p.id) === String(detalle.id))?.unidad_medida || 'Unidad')}
                                                    </div>
                                                )}
                                            </div>
                                            <div className="md:col-span-2 space-y-1">
                                                <label className="text-[10px] font-black uppercase text-gray-400">P. Unitario</label>
                                                <div className="relative">
                                                    <SolesSymbol className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
                                                    <input
                                                        type="number"
                                                        value={detalle.precio_unitario}
                                                        onChange={(e) => updateDetail(index, 'precio_unitario', e.target.value)}
                                                        className="w-full pl-8 pr-4 py-2 bg-white rounded-xl text-sm border-transparent"
                                                        min="0"
                                                        step="0.01"
                                                        required
                                                    />
                                                </div>
                                            </div>
                                            <div className="md:col-span-2 flex justify-center pb-1">
                                                <button
                                                    type="button"
                                                    onClick={() => removeDetail(index)}
                                                    className="p-2 text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                                                >
                                                    <Trash2 size={18} />
                                                </button>
                                            </div>
                                        </motion.div>
                                    ))}
                                </AnimatePresence>

                                {detalles.length === 0 && (
                                    <div className="text-center py-12 bg-gray-50 rounded-3xl border-2 border-dashed border-gray-200">
                                        <Package className="mx-auto text-gray-300 mb-4" size={48} />
                                        <p className="text-gray-400 font-bold uppercase tracking-widest text-xs">No hay productos en la lista</p>
                                    </div>
                                )}
                            </div>
                        </div>

                        <div className="flex justify-between items-center pt-6 border-t border-gray-100">
                            <div className="text-right">
                                <p className="text-xs font-black uppercase text-gray-400 tracking-widest">Total de Compra</p>
                                <p className="text-3xl font-display font-black text-brand-600">S/ {total.toFixed(2)}</p>
                            </div>
                            <button
                                type="submit"
                                className="btn btn-primary px-10 py-4 rounded-2xl font-black uppercase tracking-widest flex items-center gap-3 shadow-lg shadow-brand-500/30"
                            >
                                <Save size={20} /> Guardar Compra
                            </button>
                        </div>
                    </form>
                </div>

                {/* Info Column */}
                <div className="space-y-6">
                    <div className="card p-8 bg-brand-600 text-white">
                        <h3 className="text-xl font-display font-black mb-4 uppercase">Stock Inteligente</h3>
                        <p className="text-brand-100 text-sm leading-relaxed mb-6">
                            Al registrar una compra, el stock de insumos o productos se actualiza automáticamente en sus respectivos módulos.
                        </p>
                        <div className="space-y-4">
                            <div className="flex items-center gap-3 bg-white/10 p-3 rounded-2xl">
                                <Package className="text-white" size={20} />
                                <div>
                                    <p className="text-[10px] font-black uppercase opacity-60 leading-none mb-1">Insumos</p>
                                    <p className="font-bold text-sm">Actualiza costo promedio</p>
                                </div>
                            </div>
                            <div className="flex items-center gap-3 bg-white/10 p-3 rounded-2xl">
                                <SolesSymbol className="text-white" size={20} />
                                <div>
                                    <p className="text-[10px] font-black uppercase opacity-60 leading-none mb-1">Productos Bar</p>
                                    <p className="font-bold text-sm">Incrementa stock directo</p>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default Purchases;
