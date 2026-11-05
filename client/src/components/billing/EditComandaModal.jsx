import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { Minus, Plus, Save, Trash2, X } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { canAccessModule } from '../../security/accessControl';

// Porcentaje escrito: vacio mientras se teclea, de 0 a 100 con hasta 2 decimales.
const limpiarPct = (texto) => {
    const limpio = String(texto).replace(/[^\d.]/g, '');
    const [entero = '', ...resto] = limpio.split('.');
    const valor = resto.length ? `${entero}.${resto.join('').slice(0, 2)}` : entero;
    return Number(valor) > 100 ? '100' : valor.slice(0, 6);
};
const pctNum = (valor) => Math.min(100, Math.max(0, Number(valor) || 0));
const importeNeto = (item, global) => Math.round((Math.round(Number(item.precio) * 100) * (Number(item.cantidad) || 0) / 100) * (1 - pctNum(item.descuento_pct) / 100) * (1 - pctNum(global) / 100) * 100) / 100;

const EditComandaModal = ({ pedido, onClose, onSaved }) => {
    const { activeUser } = useAuth();
    const puedeDescontar = canAccessModule(activeUser, 'descuentos');
    const [descuentoGlobal, setDescuentoGlobal] = useState('');
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
                cantidad: Number(item.cantidad),
                descuento_pct: Number(item.descuento_pct) > 0 ? String(Number(item.descuento_pct)) : ''
            })));
            setDescuentoGlobal(Number(orderData.descuento_global_pct) > 0 ? String(Number(orderData.descuento_global_pct)) : '');
            setProductos(Array.isArray(productsData) ? productsData.filter((item) => item.disponible) : []);
        }).catch((loadError) => {
            if (active) setError(loadError.message || 'No se pudo cargar la comanda.');
        }).finally(() => {
            if (active) setLoading(false);
        });
        return () => { active = false; };
    }, [pedido.id]);

    const total = useMemo(() => Math.round(detalles.reduce((sum, item) => sum + importeNeto(item, descuentoGlobal), 0) * 100) / 100, [detalles, descuentoGlobal]);
    const totalLista = useMemo(() => detalles.reduce((sum, item) => sum + Number(item.precio) * (Number(item.cantidad) || 0), 0), [detalles]);

    const agregarProducto = () => {
        const producto = productos.find((item) => String(item.id) === productoId);
        if (!producto) return;
        setDetalles((items) => [...items, {
            key: `new-${Date.now()}-${Math.random()}`,
            detalle_id: null,
            producto_id: Number(producto.id),
            nombre: producto.nombre,
            precio: Number(producto.precio),
            cantidad: 1,
            descuento_pct: ''
        }]);
        setProductoId('');
    };

    const actualizarCantidad = (key, delta) => {
        setDetalles((items) => items.map((item) => item.key === key
            ? { ...item, cantidad: Math.max(1, Number(item.cantidad) + delta) }
            : item));
    };

    // La cantidad se puede escribir (eventos de muchas personas): se admite vacio mientras se teclea y se corrige al salir.
    const escribirCantidad = (key, texto) => {
        const limpio = texto.replace(/\D/g, '').slice(0, 5);
        setDetalles((items) => items.map((item) => (item.key === key ? { ...item, cantidad: limpio === '' ? '' : Number(limpio) } : item)));
    };

    const corregirCantidad = (key) => {
        setDetalles((items) => items.map((item) => (item.key === key ? { ...item, cantidad: Math.max(1, Number(item.cantidad) || 1) } : item)));
    };

    const escribirDescuento = (key, texto) => {
        setDetalles((items) => items.map((item) => (item.key === key ? { ...item, descuento_pct: limpiarPct(texto) } : item)));
    };

    const guardar = async () => {
        if (detalles.some((item) => !(Number(item.cantidad) >= 1))) {
            setError('Indique una cantidad de al menos 1 en cada producto.');
            return;
        }
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
                    // Solo quien tiene el permiso envia descuentos: los ya guardados se conservan sin tocarlos.
                    ...(puedeDescontar ? { descuento_global_pct: pctNum(descuentoGlobal) } : {}),
                    detalles: detalles.map((item) => ({
                        ...(item.detalle_id ? { detalle_id: item.detalle_id } : {}),
                        producto_id: item.producto_id,
                        cantidad: Number(item.cantidad),
                        ...(puedeDescontar ? { descuento_pct: pctNum(item.descuento_pct) } : {})
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
                                    <div key={item.key} className="flex flex-wrap items-center gap-3 rounded-2xl border border-gray-100 bg-gray-50 p-3">
                                        <div className="min-w-0 flex-1">
                                            <p className="truncate font-bold text-gray-900">{item.nombre}</p>
                                            <p className="mt-1 text-xs font-semibold text-gray-500">S/ {Number(item.precio).toFixed(2)} c/u</p>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <button type="button" aria-label={`Reducir ${item.nombre}`} onClick={() => actualizarCantidad(item.key, -1)} className="rounded-lg border border-gray-200 bg-white p-2 text-gray-600 hover:border-brand-300"><Minus size={14} /></button>
                                            <input
                                                type="text"
                                                inputMode="numeric"
                                                aria-label={`Cantidad de ${item.nombre}`}
                                                value={item.cantidad}
                                                onChange={(event) => escribirCantidad(item.key, event.target.value)}
                                                onFocus={(event) => event.target.select()}
                                                onBlur={() => corregirCantidad(item.key)}
                                                className="w-16 rounded-lg border border-gray-200 bg-white py-1.5 text-center text-sm font-black focus:border-brand-400 focus:outline-none"
                                            />
                                            <button type="button" aria-label={`Aumentar ${item.nombre}`} onClick={() => actualizarCantidad(item.key, 1)} className="rounded-lg border border-gray-200 bg-white p-2 text-gray-600 hover:border-brand-300"><Plus size={14} /></button>
                                        </div>
                                        {puedeDescontar && (
                                            <label className="flex items-center gap-1 text-xs font-bold text-gray-500">
                                                Dto.
                                                <input
                                                    type="text"
                                                    inputMode="decimal"
                                                    aria-label={`Descuento % de ${item.nombre}`}
                                                    placeholder="0"
                                                    value={item.descuento_pct}
                                                    onChange={(event) => escribirDescuento(item.key, event.target.value)}
                                                    onFocus={(event) => event.target.select()}
                                                    className="w-14 rounded-lg border border-gray-200 bg-white py-1.5 text-center text-sm font-black focus:border-brand-400 focus:outline-none"
                                                />
                                                %
                                            </label>
                                        )}
                                        <div className="w-24 text-right">
                                            {pctNum(item.descuento_pct) > 0 || pctNum(descuentoGlobal) > 0 ? (
                                                <p className="text-xs font-semibold text-gray-400 line-through">S/ {(Number(item.precio) * (Number(item.cantidad) || 0)).toFixed(2)}</p>
                                            ) : null}
                                            <p className="text-sm font-black">S/ {importeNeto(item, descuentoGlobal).toFixed(2)}</p>
                                        </div>
                                        <button type="button" aria-label={`Eliminar ${item.nombre}`} onClick={() => setDetalles((items) => items.filter((line) => line.key !== item.key))} className="rounded-lg p-2 text-red-500 hover:bg-red-50"><Trash2 size={16} /></button>
                                    </div>
                                ))}
                                {detalles.length === 0 && <p className="rounded-xl border border-dashed border-gray-300 p-6 text-center text-sm text-gray-500">No hay productos. Agrega al menos uno para guardar.</p>}
                            </div>

                            {(puedeDescontar || pctNum(descuentoGlobal) > 0) && (
                                <div className="mt-5 flex items-center justify-between gap-3 rounded-2xl border border-gray-100 bg-gray-50 p-3">
                                    <span className="text-sm font-bold text-gray-700">Descuento global de la cuenta</span>
                                    <label className="flex items-center gap-1 text-sm font-bold text-gray-500">
                                        <input
                                            type="text"
                                            inputMode="decimal"
                                            aria-label="Descuento global %"
                                            placeholder="0"
                                            disabled={!puedeDescontar}
                                            value={descuentoGlobal}
                                            onChange={(event) => setDescuentoGlobal(limpiarPct(event.target.value))}
                                            onFocus={(event) => event.target.select()}
                                            className="w-16 rounded-lg border border-gray-200 bg-white py-1.5 text-center text-sm font-black focus:border-brand-400 focus:outline-none disabled:opacity-60"
                                        />
                                        %
                                    </label>
                                </div>
                            )}
                            {totalLista - total > 0.004 && (
                                <div className="mt-3 flex items-center justify-between text-sm font-semibold text-gray-500">
                                    <span>Descuento aplicado</span>
                                    <span className="text-red-600">- S/ {(totalLista - total).toFixed(2)}</span>
                                </div>
                            )}
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
