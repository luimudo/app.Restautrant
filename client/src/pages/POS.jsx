import React, { useState, useEffect } from 'react';
import { ShoppingCart, Utensils, User, CheckCircle, XCircle, Plus, Minus, Search, ChevronLeft, Trash2, ArrowRight, LoaderCircle, Printer as PrinterIcon, Merge } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAuth } from '../context/AuthContext';
import { imprimirPreCuenta } from '../utils/printDocs';
import { Modal, Field, ErrorBox } from '../components/billing/billingShared';

const POS = () => {
    const { activeUser } = useAuth();
    const [mesas, setMesas] = useState([]);
    const [zonas, setZonas] = useState([]);
    const [productos, setProductos] = useState([]);
    const [selectedMesa, setSelectedMesa] = useState(null);
    const [cart, setCart] = useState([]);
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');
    const [selectedCategory, setSelectedCategory] = useState('all');
    const [activeOrder, setActiveOrder] = useState(null);
    const [savingOrder, setSavingOrder] = useState(false);
    const [saveError, setSaveError] = useState('');
    const [juntarOpen, setJuntarOpen] = useState(false);

    // A table can be merged when it has an open order (pending, preparing or ready).
    const tieneComanda = (mesa) => ['pendiente', 'en_proceso', 'listo'].includes(mesa.ultimo_estado_pedido);

    useEffect(() => {
        if (!activeUser) return;
        fetchData();
        const interval = setInterval(fetchData, 10000); 
        return () => clearInterval(interval);
    }, [activeUser]);

    useEffect(() => {
        if (selectedMesa) {
            fetchActiveOrder(selectedMesa.id);
        } else {
            setCart([]);
            setActiveOrder(null);
            setSaveError('');
        }
    }, [selectedMesa]);

    const fetchActiveOrder = async (mesaId) => {
        try {
            const res = await fetch(`/api/pedidos/mesa/${mesaId}/activo`);
            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                throw new Error(err.error || 'No se pudo obtener la comanda activa');
            }
            const data = await res.json();
            if (data && Array.isArray(data.detalles)) {
                setSaveError('');
                setActiveOrder(data);
                const itemsForCart = data.detalles.map(d => ({
                    id: d.producto_id,
                    cart_key: `existing-${d.id}`,
                    detalle_id: d.id, // ID único de la línea de pedido
                    nombre: d.producto_nombre ?? d.nombre ?? 'Producto',
                    precio: d.precio_unitario ?? d.precio,
                    cantidad: d.cantidad,
                    isExisting: true,
                    estado_comanda: d.estado_comanda,
                    es_barra: d.es_barra
                }));
                setCart(itemsForCart);
            } else {
                setCart([]);
                setActiveOrder(null);
                setSaveError('');
            }
        } catch (error) {
            console.error("Error fetching active order:", error);
            setCart([]);
            setActiveOrder(null);
            setSaveError('');
        }
    };

    const fetchData = async () => {
        try {
            const [mesasRes, zonasRes, productosRes] = await Promise.all([
                fetch('/api/mesas'),
                fetch('/api/zonas'),
                fetch('/api/productos')
            ]);

            if (!mesasRes.ok || !zonasRes.ok || !productosRes.ok) {
                if (mesasRes.status === 401 || zonasRes.status === 401 || productosRes.status === 401) {
                    console.warn('Sesión expirada o no autorizada');
                    return;
                }
            }

            const mesasData = await mesasRes.json();
            const zonasData = await zonasRes.json();
            const productosData = await productosRes.json();

            setMesas(Array.isArray(mesasData) ? mesasData : []);
            setZonas(Array.isArray(zonasData) ? zonasData : []);
            setProductos(Array.isArray(productosData) ? productosData : []);
        } catch (error) {
            console.error("Error fetching data:", error);
        } finally {
            setLoading(false);
        }
    };

    const getStatusDisplay = (estado) => {
        switch (estado) {
            case 'pendiente': return { label: 'Pendiente', color: 'bg-red-500', text: 'text-red-600' };
            case 'en_proceso': return { label: 'Preparando', color: 'bg-orange-500', text: 'text-orange-600' };
            case 'listo': return { label: '¡Listo!', color: 'bg-emerald-500', text: 'text-emerald-600' };
            default: return null;
        }
    };

    const saveActiveOrder = async (nextCart) => {
        if (!activeOrder || nextCart.length === 0) return;
        setSavingOrder(true);
        setSaveError('');
        try {
            const response = await fetch(`/api/pedidos/${activeOrder.id}/detalles`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    detalles: nextCart.map((item) => ({
                        ...(item.isExisting ? { detalle_id: item.detalle_id } : {}),
                        producto_id: item.id,
                        cantidad: Number(item.cantidad)
                    }))
                })
            });
            const result = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(result.error || 'No se pudo actualizar la comanda.');

            const savedDetails = Array.isArray(result.detalles) ? result.detalles : [];
            const usedIds = new Set();
            const savedCart = nextCart.map((item) => {
                const saved = item.isExisting
                    ? savedDetails.find((line) => Number(line.id) === Number(item.detalle_id))
                    : savedDetails.find((line) => Number(line.producto_id) === Number(item.id) && !usedIds.has(Number(line.id)));
                if (!saved) return item;
                usedIds.add(Number(saved.id));
                return {
                    ...item,
                    detalle_id: Number(saved.id),
                    cart_key: `existing-${saved.id}`,
                    precio: Number(saved.precio_unitario),
                    cantidad: Number(saved.cantidad),
                    isExisting: true,
                    estado_comanda: saved.estado_comanda
                };
            });
            setCart(savedCart);
            setActiveOrder((current) => current ? { ...current, total: result.total, detalles: savedDetails } : current);
        } catch (error) {
            setSaveError(error.message || 'No se pudo actualizar la comanda.');
        } finally {
            setSavingOrder(false);
        }
    };

    const addToCart = (producto) => {
        if (savingOrder) return;
        // Para items nuevos, permitimos agrupar si aún no se han enviado
        const cartKey = `new-${producto.id}`;
        const existing = cart.find(item => item.cart_key === cartKey);
        let nextCart;
        if (existing) {
            nextCart = cart.map((item) => item.cart_key === cartKey ? { ...item, cantidad: item.cantidad + 1 } : item);
        } else {
            nextCart = [...cart, { ...producto, cart_key: cartKey, cantidad: 1, isExisting: false }];
        }
        setCart(nextCart);
        if (activeOrder) saveActiveOrder(nextCart);
    };

    const removeFromCart = (cartKey) => {
        if (savingOrder) return;
        const nextCart = cart.filter((item) => item.cart_key !== cartKey);
        if (activeOrder && nextCart.length === 0) {
            alert('La comanda debe conservar al menos un producto.');
            return;
        }
        setCart(nextCart);
        if (activeOrder && nextCart.length > 0) saveActiveOrder(nextCart);
    };

    const updateCantidad = (cartKey, delta) => {
        if (savingOrder) return;
        const nextCart = cart.map(item => {
            if (item.cart_key === cartKey) {
                const newCantidad = Math.max(1, item.cantidad + delta);
                return { ...item, cantidad: newCantidad };
            }
            return item;
        });
        setCart(nextCart);
        if (activeOrder) saveActiveOrder(nextCart);
    };

    const total = cart.reduce((acc, curr) => acc + (curr.precio * curr.cantidad), 0);
    const activeDetailsById = new Map((activeOrder?.detalles || []).map((item) => [Number(item.id), item]));
    const orderHasChanges = !activeOrder || cart.some((item) => !item.isExisting)
        || cart.filter((item) => item.isExisting).length !== (activeOrder.detalles || []).length
        || cart.some((item) => item.isExisting && Number(item.cantidad) !== Number(activeDetailsById.get(Number(item.detalle_id))?.cantidad));

    const generatePreCuenta = async () => {
        if (!selectedMesa || cart.length === 0) return;
        try {
            await imprimirPreCuenta(selectedMesa.numero, cart.map((item, index) => ({
                descripcion: String(item?.nombre ?? `Producto ${index + 1}`),
                cantidad: Number(item?.cantidad) || 0,
                precio: Number(item?.precio) || 0
            })));
        } catch (error) {
            alert(error.message);
        }
    };

    const submitOrder = async () => {
        if (!selectedMesa || cart.length === 0) return;
        if (!activeUser?.id) {
            alert('Selecciona un usuario activo para registrar el pedido.');
            return;
        }

        if (activeOrder && !orderHasChanges) {
            alert('No hay cambios para guardar en la comanda.');
            return;
        }

        try {
            const url = activeOrder 
                ? `/api/pedidos/${activeOrder.id}/detalles`
                : '/api/pedidos';
            
            const method = activeOrder ? 'PUT' : 'POST';

            const orderPayload = activeOrder ? {
                detalles: cart.map(item => ({
                    ...(item.isExisting ? { detalle_id: item.detalle_id } : {}),
                    producto_id: item.id,
                    cantidad: Number(item.cantidad)
                }))
            } : {
                mesa_id: selectedMesa.id,
                usuario_id: Number(activeUser.id),
                detalles: cart.map(item => ({
                    producto_id: item.id,
                    cantidad: item.cantidad,
                    notas: ''
                }))
            };

            const response = await fetch(url, {
                method,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(orderPayload)
            });

            const result = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(result.error || 'No se pudo guardar el pedido.');
            alert(activeOrder ? 'Comanda actualizada' : 'Pedido enviado exitosamente');
            setCart([]);
            setSelectedMesa(null);
            fetchData();
        } catch (error) {
            alert(error.message || 'Error de conexión.');
        }
    };

    if (loading) return (
        <div className="flex flex-col items-center justify-center min-h-[400px]">
            <div className="w-16 h-16 border-4 border-brand-200 border-t-brand-600 rounded-full animate-spin"></div>
            <p className="mt-4 font-bold text-brand-900 animate-pulse">Cargando POS...</p>
        </div>
    );

    const categoriasPOS = [...new Map(productos
        .filter((producto) => producto.tipo_id && producto.tipo_nombre)
        .map((producto) => [String(producto.tipo_id), { id: producto.tipo_id, nombre: producto.tipo_nombre }])
    ).values()].sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
    const filteredProductos = productos.filter((producto) => {
        const matchesName = String(producto.nombre || '').toLowerCase().includes(searchTerm.trim().toLowerCase());
        const matchesCategory = selectedCategory === 'all' || String(producto.tipo_id) === selectedCategory;
        return matchesName && matchesCategory;
    });

    return (
        <div className="flex flex-col lg:flex-row gap-8 lg:h-[calc(100vh-160px)]">
            <div className="flex-1 flex flex-col min-w-0">
                <AnimatePresence mode="wait">
                    {!selectedMesa ? (
                        <motion.section key="mesas" className="flex-1 flex flex-col">
                            <div className="flex justify-between items-center mb-8 gap-3">
                                <h2 className="text-3xl font-display font-black">Seleccionar Mesa</h2>
                                <button onClick={() => setJuntarOpen(true)} disabled={savingOrder || mesas.filter(tieneComanda).length === 0} className="btn btn-secondary text-sm flex items-center gap-2 disabled:opacity-50">
                                    <Merge size={16} /> Juntar mesas
                                </button>
                            </div>
                            <div className="flex-1 overflow-y-auto space-y-10 pr-2 custom-scrollbar">
                                {zonas.map(zona => (
                                    <div key={zona.id} className="space-y-4">
                                        <h3 className="text-sm font-bold uppercase tracking-[0.2em] text-[var(--text-muted)] border-l-4 border-brand-500 pl-3">{zona.nombre}</h3>
                                        <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-5 gap-6">
                                            {mesas.filter(m => m.zona_id === zona.id).map(mesa => {
                                                const statusInfo = getStatusDisplay(mesa.ultimo_estado_pedido);
                                                const isOcupada = mesa.estado === 'ocupada' || (mesa.ultimo_estado_pedido && !['entregado', 'pagado'].includes(mesa.ultimo_estado_pedido));
                                                return (
                                                    <button key={mesa.id} disabled={savingOrder} onClick={() => setSelectedMesa(mesa)} className={`card p-6 flex flex-col items-center gap-4 disabled:opacity-50 ${isOcupada ? 'bg-red-50/30' : ''}`}>
                                                        <Utensils size={32} className={isOcupada ? 'text-red-600' : 'text-brand-600'} />
                                                        <span className="text-xl font-display font-black">Mesa {mesa.numero}</span>
                                                        {statusInfo && <span className={`text-[10px] font-black uppercase ${statusInfo.text}`}>{statusInfo.label}</span>}
                                                    </button>
                                                );
                                            })}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </motion.section>
                    ) : (
                        <motion.section key="menu" className="flex-1 flex flex-col">
                            <div className="flex items-center gap-4 mb-8">
                                <button disabled={savingOrder} onClick={() => setSelectedMesa(null)} className="p-3 bg-white border rounded-2xl disabled:opacity-40"><ChevronLeft size={24} /></button>
                                <h2 className="text-3xl font-display font-black">Mesa {selectedMesa.numero}</h2>
                            </div>
                            <div className="grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_240px] gap-3 mb-5">
                                <label className="relative block">
                                    <Search size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" />
                                    <input
                                        className="input pl-11"
                                        type="search"
                                        placeholder="Buscar producto (opcional)"
                                        aria-label="Buscar producto"
                                        value={searchTerm}
                                        onChange={(event) => setSearchTerm(event.target.value)}
                                    />
                                </label>
                                <select
                                    className="input"
                                    aria-label="Filtrar por categoría"
                                    value={selectedCategory}
                                    onChange={(event) => setSelectedCategory(event.target.value)}
                                >
                                    <option value="all">Todas las categorías</option>
                                    {categoriasPOS.map((categoria) => (
                                        <option key={categoria.id} value={String(categoria.id)}>{categoria.nombre}</option>
                                    ))}
                                </select>
                            </div>
                            {filteredProductos.length === 0 ? (
                                <div className="card p-8 text-center text-sm font-semibold text-gray-500">No hay productos que coincidan con esos filtros.</div>
                            ) : (
                                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-3 sm:gap-4 content-start flex-1 min-h-0 overflow-y-auto pr-1 pb-2 custom-scrollbar">
                                    {filteredProductos.map(producto => (
                                        <button
                                            type="button"
                                            key={producto.id}
                                            onClick={() => addToCart(producto)}
                                            disabled={savingOrder}
                                            aria-label={`Agregar ${producto.nombre}`}
                                            className="card p-2.5 bg-white flex flex-col text-left overflow-hidden active:scale-[0.98] transition-transform disabled:opacity-50"
                                        >
                                            <div className="aspect-square w-full rounded-xl bg-gray-50 border border-gray-100 mb-2.5 overflow-hidden flex items-center justify-center">
                                                {producto.imagen_url ? (
                                                    <img src={producto.imagen_url} alt="" loading="lazy" className="h-full w-full object-cover object-center" />
                                                ) : (
                                                    <Utensils size={28} className="text-gray-300" aria-hidden="true" />
                                                )}
                                            </div>
                                            <span className="text-[9px] font-black uppercase tracking-widest text-brand-600 truncate">{producto.tipo_nombre || 'Sin categoría'}</span>
                                            <h4 className="font-bold text-sm leading-tight line-clamp-2 min-h-[2.25rem] mt-0.5">{producto.nombre}</h4>
                                            {!producto.es_receta && (
                                                <span className={`mt-1 text-[11px] font-bold ${Number(producto.stock) <= 0 ? 'text-red-600' : Number(producto.stock) <= 5 ? 'text-amber-600' : 'text-gray-500'}`}>
                                                    Stock: {Number(producto.stock)}
                                                </span>
                                            )}
                                            <div className="mt-2 flex items-center justify-between gap-2">
                                                <p className="text-brand-600 font-black text-sm">S/ {Number(producto.precio).toFixed(2)}</p>
                                                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gray-900 text-white" aria-hidden="true"><Plus size={16} /></span>
                                            </div>
                                        </button>
                                    ))}
                                </div>
                            )}
                        </motion.section>
                    )}
                </AnimatePresence>
            </div>

            {juntarOpen && (
                <JuntarMesasModal
                    mesas={mesas}
                    tieneComanda={tieneComanda}
                    onClose={() => setJuntarOpen(false)}
                    onDone={(result) => {
                        setJuntarOpen(false);
                        alert(`Mesas juntadas en la Mesa ${result.mesa_numero}: ${result.comandas_unidas} comandas unidas, total S/ ${Number(result.total).toFixed(2)}.`);
                        fetchData();
                    }}
                />
            )}

            <div className="w-full lg:w-[400px] flex flex-col">
                <div className="card flex-1 flex flex-col bg-white border-2 border-brand-100 shadow-xl overflow-hidden">
                    <div className="p-6 border-b">
                        <div className="flex items-center justify-between gap-3">
                            <h3 className="font-display font-black text-xl">Comanda</h3>
                            {activeOrder && (
                                <span className={`inline-flex items-center gap-1.5 text-xs font-bold ${saveError ? 'text-red-600' : 'text-brand-600'}`}>
                                    {savingOrder ? <><LoaderCircle size={14} className="animate-spin" /> Recalculando...</> : saveError ? 'Error al guardar' : 'Guardado automático'}
                                </span>
                            )}
                        </div>
                    </div>

                    <div className="flex-1 overflow-y-auto p-4 space-y-4">
                        {cart.map((item, idx) => (
                            <div key={item.cart_key || item.detalle_id || `cart-${idx}`} className="p-4 rounded-2xl bg-gray-50 border">
                                <div className="flex justify-between items-start">
                                    <div>
                                        <div className="flex items-center gap-2">
                                            <p className="font-bold text-sm">{item.nombre}</p>
                                            {item.isExisting && (
                                                <span className={`px-2 py-0.5 text-[8px] font-black uppercase rounded-md ${
                                                    item.estado_comanda === 'listo' ? 'bg-emerald-100 text-emerald-600' : 
                                                    (item.estado_comanda === 'en_cocina' || item.estado_comanda === 'preparacion') ? 'bg-orange-100 text-orange-600' : 'bg-gray-200 text-gray-500'
                                                }`}>
                                                    {item.estado_comanda === 'listo' ? (item.es_barra ? 'Despachado' : 'Servir') : 
                                                     (item.estado_comanda === 'en_cocina' || item.estado_comanda === 'preparacion') ? 'En Cocina' : 'Recibido'}
                                                </span>
                                            )}
                                        </div>
                                        <p className="text-[10px] font-black text-brand-600">S/ {Number(item.precio).toFixed(2)}</p>
                                    </div>
                                    <button disabled={savingOrder} onClick={() => removeFromCart(item.cart_key)} aria-label={`Eliminar ${item.nombre}`} className="rounded-lg p-1.5 text-red-500 hover:bg-red-50 disabled:opacity-40"><Trash2 size={16} /></button>
                                </div>
                                <div className="flex justify-between items-center mt-2">
                                    <div className="flex items-center gap-2">
                                        <button disabled={savingOrder} onClick={() => updateCantidad(item.cart_key, -1)} aria-label={`Reducir ${item.nombre}`} className="rounded-md border border-gray-200 bg-white p-1.5 text-gray-600 hover:border-brand-300 disabled:opacity-40"><Minus size={12} /></button>
                                        <p className="min-w-14 text-center text-xs font-bold">Cant: {item.cantidad}</p>
                                        <button disabled={savingOrder} onClick={() => updateCantidad(item.cart_key, 1)} aria-label={`Aumentar ${item.nombre}`} className="rounded-md border border-gray-200 bg-white p-1.5 text-gray-600 hover:border-brand-300 disabled:opacity-40"><Plus size={12} /></button>
                                    </div>
                                    <p className="font-black">S/ {(item.cantidad * item.precio).toFixed(2)}</p>
                                </div>
                            </div>
                        ))}
                    </div>

                    <div className="p-6 border-t bg-gray-50 space-y-3">
                        <div className="flex justify-between items-center mb-2">
                            <span className="font-bold text-lg">Total</span>
                            <span className="font-black text-2xl text-brand-600">S/ {total.toFixed(2)}</span>
                        </div>
                        
                        <div className="grid grid-cols-2 gap-3">
                            <button 
                                onClick={generatePreCuenta}
                                disabled={cart.length === 0 || savingOrder}
                                className="py-3 bg-white border border-brand-200 text-brand-600 rounded-xl font-bold text-xs uppercase tracking-widest hover:bg-brand-50 transition-all flex items-center justify-center gap-2 shadow-sm"
                            >
                                <PrinterIcon size={16} /> Pre-Cuenta
                            </button>
                            {activeOrder ? (
                                <div className="flex flex-col justify-center gap-1">
                                    {saveError ? (
                                        <button disabled={savingOrder} onClick={() => saveActiveOrder(cart)} className="py-3 bg-red-600 text-white rounded-xl font-black text-xs uppercase tracking-widest disabled:opacity-50">Reintentar guardado</button>
                                    ) : (
                                        <div className="flex items-center justify-center gap-2 py-3 text-xs font-bold text-emerald-700">
                                            {savingOrder ? <LoaderCircle size={16} className="animate-spin" /> : <CheckCircle size={16} />}
                                            {savingOrder ? 'Guardando cambios...' : 'Actualizada automáticamente'}
                                        </div>
                                    )}
                                    {saveError && <p role="alert" className="text-center text-[10px] font-medium text-red-600">{saveError}</p>}
                                </div>
                            ) : (
                                <button
                                    disabled={!selectedMesa || cart.length === 0 || savingOrder}
                                    onClick={submitOrder}
                                    className="py-3 bg-gray-900 text-white rounded-xl font-black text-xs uppercase tracking-widest hover:bg-brand-600 transition-all shadow-lg disabled:opacity-50"
                                >Enviar</button>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

/** Merges the open orders of several tables into one order on the destination table. */
const JuntarMesasModal = ({ mesas, tieneComanda, onClose, onDone }) => {
    const [destinoId, setDestinoId] = useState('');
    const [origenIds, setOrigenIds] = useState([]);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');

    const ordenadas = [...mesas].sort((a, b) => String(a.numero).localeCompare(String(b.numero), 'es', { numeric: true }));
    const destino = ordenadas.find((m) => String(m.id) === destinoId);
    const candidatas = ordenadas.filter((m) => tieneComanda(m) && String(m.id) !== destinoId);
    const toggle = (id) => setOrigenIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

    const juntar = async (event) => {
        event.preventDefault();
        setSaving(true);
        setError('');
        try {
            const res = await fetch('/api/pedidos/juntar-mesas', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ mesa_destino_id: Number(destinoId), mesas_origen_ids: origenIds })
            });
            const body = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(body.error || 'No se pudo juntar las mesas.');
            onDone(body);
        } catch (e) {
            setError(e.message);
        } finally {
            setSaving(false);
        }
    };

    return (
        <Modal title="Juntar mesas" subtitle="Las comandas abiertas pasan a una sola cuenta en la mesa de destino." onClose={onClose}>
            <ErrorBox text={error} />
            <form onSubmit={juntar} className="space-y-4">
                <Field label="Mesa de destino (queda con la cuenta)">
                    <select className="input" value={destinoId} onChange={(e) => { setDestinoId(e.target.value); setOrigenIds((prev) => prev.filter((id) => String(id) !== e.target.value)); }} required>
                        <option value="">Seleccione...</option>
                        {ordenadas.map((m) => <option key={m.id} value={m.id}>Mesa {m.numero}{m.zona_nombre ? ` · ${m.zona_nombre}` : ''}{tieneComanda(m) ? ' · con comanda' : ' · libre'}</option>)}
                    </select>
                </Field>
                <div className="space-y-2">
                    <span className="text-xs font-bold text-gray-500 uppercase tracking-widest">Mesas que se juntan</span>
                    {!destino && <p className="text-sm text-gray-500">Elija primero la mesa de destino.</p>}
                    {destino && candidatas.length === 0 && <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-xl p-3">No hay otras mesas con comanda abierta.</p>}
                    <div className="max-h-[40vh] overflow-y-auto space-y-2 pr-1">
                        {destino && candidatas.map((m) => (
                            <label key={m.id} className={`flex items-center justify-between gap-3 p-3 rounded-xl border cursor-pointer ${origenIds.includes(m.id) ? 'border-brand-400 bg-brand-50/50' : 'border-gray-100'}`}>
                                <span className="flex items-center gap-3">
                                    <input type="checkbox" checked={origenIds.includes(m.id)} onChange={() => toggle(m.id)} />
                                    <span className="font-semibold text-sm">Mesa {m.numero}</span>
                                    {m.zona_nombre && <span className="text-xs text-gray-500">{m.zona_nombre}</span>}
                                </span>
                                <span className="text-[10px] font-black uppercase text-gray-500">{m.ultimo_estado_pedido === 'en_proceso' ? 'Preparando' : m.ultimo_estado_pedido === 'listo' ? 'Listo' : 'Pendiente'}</span>
                            </label>
                        ))}
                    </div>
                </div>
                {destino && !tieneComanda(destino) && origenIds.length > 0 && (
                    <p className="text-xs text-gray-500">La Mesa {destino.numero} está libre: la comanda de la primera mesa elegida se muda allí y recibe las demás.</p>
                )}
                <div className="flex gap-3 pt-1">
                    <button type="button" className="btn btn-secondary flex-1" onClick={onClose}>Cancelar</button>
                    <button type="submit" className="btn btn-primary flex-1" disabled={saving || !destino || origenIds.length === 0}>
                        {saving ? 'Juntando...' : `Juntar ${origenIds.length || ''} mesa${origenIds.length === 1 ? '' : 's'}`}
                    </button>
                </div>
            </form>
        </Modal>
    );
};

export default POS;
