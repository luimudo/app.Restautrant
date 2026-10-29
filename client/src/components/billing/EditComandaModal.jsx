import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { Minus, Plus, Save, Trash2, X } from 'lucide-react';

const EditComandaModal = ({ pedido, onClose, onSaved }) => {
    const [detalles, setDetalles] = useState([]);
    const [productos, setProductos] = useState([]);
    const [productoId, setProductoId] = useState('');
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');

    useEffect(() => {
        let active = true;
        Promise.all([
            fetch(`/api/pedidos/${pedido.id}/detalle`),
            fetch('/api/productos')
        ]).then(async ([orderResponse, productsResponse]) => {
            const orderData = await orderResponse.json().catch(() => ({}));
            const productsData = await productsResponse.json().catch(() => []);
            if (!orderResponse.ok) throw new Error(orderData.error || 'No se pudo cargar la comanda.');
            if (!productsResponse.ok) throw new Error(productsData.error || 'No se pudo cargar el catálogo.');
            if (!active) return;
            setDetalles((orderData.detalles || []).map((item) => ({
                key: `saved-${item.id}`,
                detalle_id: Number(item.id),
                producto_id: Number(item.producto_id),
                nombre: item.producto_nombre || 'Producto',
                precio: Number(item.precio_unitario),
                cantidad: Number(item.cantidad)
            })));
            setProductos(Array.isArray(productsData) ? productsData.filter((item) => item.disponible) : []);
        }).catch((loadError) => {
            if (active) setError(loadError.message || 'No se pudo cargar la comanda.');
        }).finally(() => {
            if (active) setLoading(false);
        });
        return () => { active = false; };
    }, [pedido.id]);

    const total = useMemo(() => detalles.reduce((sum, item) => sum + Number(item.precio) * Number(item.cantidad), 0), [detalles]);

    const agregarProducto = () => {
        const producto = productos.find((item) => String(item.id) === productoId);
        if (!producto) return;
        setDetalles((items) => [...items, {
            key: `new-${Date.now()}-${Math.random()}`,
            detalle_id: null,
            producto_id: Number(producto.id),
            nombre: producto.nombre,
            precio: Number(producto.precio),
            cantidad: 1
        }]);
        setProductoId('');
    };

    const actualizarCantidad = (key, delta) => {
        setDetalles((items) => items.map((item) => item.key === key
            ? { ...item, cantidad: Math.max(1, Number(item.cantidad) + delta) }
            : item));
    };

    const guardar = async () => {
        if (detalles.length === 0) {
            setError('La comanda debe conservar al menos un producto.');
            return;
        }
        setSaving(true);
        setError('');
        try {
            const response = await fetch(`/api/pedidos/${pedido.id}/detalles`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    detalles: detalles.map((item) => ({
                        ...(item.detalle_id ? { detalle_id: item.detalle_id } : {}),
                        producto_id: item.producto_id,
                        cantidad: Number(item.cantidad)
                    }))
                })
            });
            const result = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(result.error || 'No se pudo guardar la comanda.');
            onSaved?.(result);
            onClose();
        } catch (saveError) {
            setError(saveError.message || 'No se pudo guardar la comanda.');
        } finally {
            setSaving(false);
        }
    };

    return createPortal(
        <AnimatePresence>
            <motion.div
                className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
                initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                onClick={onClose}
            >
                <motion.section
                    role="dialog" aria-modal="true" aria-labelledby="edit-comanda-title"
                    className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-3xl bg-white p-5 shadow-2xl md:p-8"
                    initial={{ opacity: 0, y: 16, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 12 }}
                    onClick={(event) => event.stopPropagation()}
                >
                    <div className="mb-6 flex items-start justify-between gap-4">
                        <div>
                            <h3 id="edit-comanda-title" className="text-2xl font-black text-gray-900">Editar comanda #{pedido.id}</h3>
                            <p className="mt-1 text-sm text-gray-500">Agrega o elimina productos antes de emitir el comprobante.</p>
                        </div>
                        <button type="button" onClick={onClose} aria-label="Cerrar" className="rounded-xl p-2 text-gray-500 hover:bg-gray-100"><X size={20} /></button>
                    </div>

                    {loading ? (
                        <div className="py-12 text-center text-sm font-semibold text-gray-500">Cargando detalle...</div>
                    ) : (
                        <>
                            <div className="mb-5 flex flex-col gap-2 sm:flex-row">
                                <select className="input min-w-0 flex-1" value={productoId} onChange={(event) => setProductoId(event.target.value)}>
                                    <option value="">Seleccionar producto para agregar</option>
                                    {productos.map((producto) => <option key={producto.id} value={producto.id}>{producto.nombre} · S/ {Number(producto.precio).toFixed(2)}</option>)}
                                </select>
                                <button type="button" onClick={agregarProducto} disabled={!productoId} className="inline-flex items-center justify-center gap-2 rounded-xl bg-gray-900 px-4 py-3 text-sm font-bold text-white disabled:opacity-40"><Plus size={16} /> Agregar</button>
                            </div>

                            <div className="space-y-3">
                                {detalles.map((item) => (
                                    <div key={item.key} className="flex items-center gap-3 rounded-2xl border border-gray-100 bg-gray-50 p-3">
                                        <div className="min-w-0 flex-1">
                                            <p className="truncate font-bold text-gray-900">{item.nombre}</p>
                                            <p className="mt-1 text-xs font-semibold text-gray-500">S/ {Number(item.precio).toFixed(2)} c/u</p>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <button type="button" aria-label={`Reducir ${item.nombre}`} onClick={() => actualizarCantidad(item.key, -1)} className="rounded-lg border border-gray-200 bg-white p-2 text-gray-600 hover:border-brand-300"><Minus size={14} /></button>
                                            <span className="w-7 text-center text-sm font-black">{item.cantidad}</span>
                                            <button type="button" aria-label={`Aumentar ${item.nombre}`} onClick={() => actualizarCantidad(item.key, 1)} className="rounded-lg border border-gray-200 bg-white p-2 text-gray-600 hover:border-brand-300"><Plus size={14} /></button>
                                        </div>
                                        <p className="w-24 text-right text-sm font-black">S/ {(Number(item.precio) * Number(item.cantidad)).toFixed(2)}</p>
                                        <button type="button" aria-label={`Eliminar ${item.nombre}`} onClick={() => setDetalles((items) => items.filter((line) => line.key !== item.key))} className="rounded-lg p-2 text-red-500 hover:bg-red-50"><Trash2 size={16} /></button>
                                    </div>
                                ))}
                                {detalles.length === 0 && <p className="rounded-xl border border-dashed border-gray-300 p-6 text-center text-sm text-gray-500">No hay productos. Agrega al menos uno para guardar.</p>}
                            </div>

                            <div className="mt-5 flex items-center justify-between border-t border-gray-100 pt-5">
                                <span className="text-sm font-bold text-gray-500">Nuevo total</span>
                                <span className="text-2xl font-black text-brand-700">S/ {total.toFixed(2)}</span>
                            </div>
                            {error && <p role="alert" className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-700">{error}</p>}
                            <div className="mt-6 flex gap-3">
                                <button type="button" disabled={saving} onClick={onClose} className="flex-1 rounded-xl border border-gray-200 px-4 py-3 text-sm font-bold text-gray-700 disabled:opacity-50">Cancelar</button>
                                <button type="button" disabled={saving || loading} onClick={guardar} className="flex-1 inline-flex items-center justify-center gap-2 rounded-xl bg-brand-600 px-4 py-3 text-sm font-bold text-white disabled:opacity-50"><Save size={16} /> {saving ? 'Guardando...' : 'Guardar comanda'}</button>
                            </div>
                        </>
                    )}
                </motion.section>
            </motion.div>
        </AnimatePresence>,
        document.body
    );
};

export default EditComandaModal;
