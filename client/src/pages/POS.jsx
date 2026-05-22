import React, { useState, useEffect } from 'react';
import { ShoppingCart, Utensils, User, CheckCircle, XCircle, Plus, Search, ChevronLeft, Trash2, ArrowRight, Printer as PrinterIcon } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { useAuth } from '../context/AuthContext';

const POS = () => {
    const { activeUser } = useAuth();
    const [mesas, setMesas] = useState([]);
    const [zonas, setZonas] = useState([]);
    const [productos, setProductos] = useState([]);
    const [selectedMesa, setSelectedMesa] = useState(null);
    const [cart, setCart] = useState([]);
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');
    const [activeOrder, setActiveOrder] = useState(null);

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
        }
    }, [selectedMesa]);

    const fetchActiveOrder = async (mesaId) => {
        try {
            const res = await fetch(`http://localhost:3000/api/pedidos/mesa/${mesaId}/activo`);
            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                throw new Error(err.error || 'No se pudo obtener la comanda activa');
            }
            const data = await res.json();
            if (data && Array.isArray(data.detalles)) {
                setActiveOrder(data);
                const itemsForCart = data.detalles.map(d => ({
                    id: d.producto_id,
                    detalle_id: d.id, // ID único de la línea de pedido
                    nombre: d.producto_nombre ?? d.nombre ?? 'Producto',
                    precio: d.precio,
                    cantidad: d.cantidad,
                    isExisting: true,
                    estado_comanda: d.estado_comanda,
                    es_barra: d.es_barra
                }));
                setCart(itemsForCart);
            } else {
                setCart([]);
                setActiveOrder(null);
            }
        } catch (error) {
            console.error("Error fetching active order:", error);
            setCart([]);
            setActiveOrder(null);
        }
    };

    const fetchData = async () => {
        try {
            const [mesasRes, zonasRes, productosRes] = await Promise.all([
                fetch('http://localhost:3000/api/mesas'),
                fetch('http://localhost:3000/api/zonas'),
                fetch('http://localhost:3000/api/productos')
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

    const addToCart = (producto) => {
        // Para items nuevos, permitimos agrupar si aún no se han enviado
        const existing = cart.find(item => item.id === producto.id && !item.isExisting);
        if (existing) {
            setCart(cart.map(item => (item.id === producto.id && !item.isExisting) ? { ...item, cantidad: item.cantidad + 1 } : item));
        } else {
            setCart([...cart, { ...producto, cantidad: 1, isExisting: false }]);
        }
    };

    const removeFromCart = (id) => {
        setCart(cart.filter(item => !(item.id === id && !item.isExisting)));
    };

    const updateCantidad = (id, delta) => {
        setCart(cart.map(item => {
            if (item.id === id && !item.isExisting) {
                const newCantidad = Math.max(1, item.cantidad + delta);
                return { ...item, cantidad: newCantidad };
            }
            return item;
        }));
    };

    const total = cart.reduce((acc, curr) => acc + (curr.precio * curr.cantidad), 0);

    const generatePreCuenta = () => {
        if (!selectedMesa || cart.length === 0) return;

        const doc = new jsPDF({
            unit: 'mm',
            format: [80, 150] // Formato ticket de 80mm
        });

        // Estilos de Ticket
        doc.setFont("helvetica", "bold");
        doc.setFontSize(14);
        doc.text("GOURMET OS", 40, 10, { align: "center" });
        
        doc.setFontSize(8);
        doc.setFont("helvetica", "normal");
        doc.text("Restaurante & Bar", 40, 15, { align: "center" });
        doc.text("------------------------------------------", 40, 18, { align: "center" });
        
        doc.setFont("helvetica", "bold");
        doc.text(`PRE-CUENTA: MESA ${selectedMesa.numero}`, 10, 23);
        doc.setFont("helvetica", "normal");
        doc.text(`Fecha: ${new Date().toLocaleDateString()} ${new Date().toLocaleTimeString()}`, 10, 27);
        doc.text("------------------------------------------", 40, 31, { align: "center" });

        // Tabla de Productos
        const tableBody = cart.map((item, index) => {
            const safeName = String(item?.nombre ?? `Producto ${index + 1}`);
            const cantidad = Number(item?.cantidad) || 0;
            const precio = Number(item?.precio) || 0;
            return [
                `${cantidad} x ${safeName.slice(0, 20)}`,
                `S/ ${(cantidad * precio).toFixed(2)}`
            ];
        });

        autoTable(doc, {
            startY: 33,
            body: tableBody,
            theme: 'plain',
            styles: { fontSize: 7, cellPadding: 1 },
            columnStyles: {
                0: { cellWidth: 45 },
                1: { cellWidth: 15, halign: 'right' }
            }
        });

        const finalY = doc.lastAutoTable.finalY + 5;
        doc.text("------------------------------------------", 40, finalY, { align: "center" });
        
        doc.setFontSize(10);
        doc.setFont("helvetica", "bold");
        doc.text(`TOTAL A PAGAR: S/ ${total.toFixed(2)}`, 10, finalY + 6);
        
        doc.setFontSize(7);
        doc.setFont("helvetica", "italic");
        doc.text("Gracias por su visita", 40, finalY + 12, { align: "center" });
        doc.text("Este no es un comprobante de pago", 40, finalY + 15, { align: "center" });

        doc.save(`PreCuenta_Mesa_${selectedMesa.numero}.pdf`);
    };

    const submitOrder = async () => {
        if (!selectedMesa || cart.length === 0) return;
        if (!activeUser?.id) {
            alert('Selecciona un usuario activo para registrar el pedido.');
            return;
        }

        const newItems = cart.filter(item => !item.isExisting);
        
        if (activeOrder && newItems.length === 0) {
            alert('No hay nuevos productos para añadir.');
            return;
        }

        try {
            const url = activeOrder 
                ? `http://localhost:3000/api/pedidos/${activeOrder.id}/items` 
                : 'http://localhost:3000/api/pedidos';
            
            const method = activeOrder ? 'PUT' : 'POST';

            const orderPayload = activeOrder ? {
                detalles: newItems.map(item => ({
                    producto_id: item.id,
                    cantidad: item.cantidad,
                    notas: ''
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

            if (response.ok) {
                alert(activeOrder ? 'Pedido actualizado' : 'Pedido enviado exitosamente');
                setCart([]);
                setSelectedMesa(null);
                fetchData();
            }
        } catch (error) {
            alert('Error de conexión.');
        }
    };

    if (loading) return (
        <div className="flex flex-col items-center justify-center min-h-[400px]">
            <div className="w-16 h-16 border-4 border-brand-200 border-t-brand-600 rounded-full animate-spin"></div>
            <p className="mt-4 font-bold text-brand-900 animate-pulse">Cargando POS...</p>
        </div>
    );

    const filteredProductos = productos.filter(p =>
        p.nombre.toLowerCase().includes(searchTerm.toLowerCase())
    );

    return (
        <div className="flex flex-col lg:flex-row gap-8 h-[calc(100vh-160px)]">
            <div className="flex-1 flex flex-col min-w-0">
                <AnimatePresence mode="wait">
                    {!selectedMesa ? (
                        <motion.section key="mesas" className="flex-1 flex flex-col">
                            <div className="flex justify-between items-center mb-8">
                                <h2 className="text-3xl font-display font-black">Seleccionar Mesa</h2>
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
                                                    <button key={mesa.id} onClick={() => setSelectedMesa(mesa)} className={`card p-6 flex flex-col items-center gap-4 ${isOcupada ? 'bg-red-50/30' : ''}`}>
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
                                <button onClick={() => setSelectedMesa(null)} className="p-3 bg-white border rounded-2xl"><ChevronLeft size={24} /></button>
                                <h2 className="text-3xl font-display font-black">Mesa {selectedMesa.numero}</h2>
                            </div>
                            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-6 overflow-y-auto pr-2">
                                {filteredProductos.map(producto => (
                                    <div key={producto.id} className="card p-5 bg-white flex flex-col">
                                        <h4 className="font-bold text-lg">{producto.nombre}</h4>
                                        <p className="text-brand-600 font-black">S/ {Number(producto.precio).toFixed(2)}</p>
                                        <button onClick={() => addToCart(producto)} className="mt-4 py-2 bg-gray-900 text-white rounded-xl font-bold text-sm">Agregar</button>
                                    </div>
                                ))}
                            </div>
                        </motion.section>
                    )}
                </AnimatePresence>
            </div>

            <div className="w-full lg:w-[400px] flex flex-col">
                <div className="card flex-1 flex flex-col bg-white border-2 border-brand-100 shadow-xl overflow-hidden">
                    <div className="p-6 border-b">
                        <h3 className="font-display font-black text-xl">Comanda</h3>
                    </div>

                    <div className="flex-1 overflow-y-auto p-4 space-y-4">
                        {cart.map((item, idx) => (
                            <div key={item.detalle_id || `new-${idx}`} className="p-4 rounded-2xl bg-gray-50 border">
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
                                    {!item.isExisting && <button onClick={() => removeFromCart(item.id)} className="text-red-500"><Trash2 size={16} /></button>}
                                </div>
                                <div className="flex justify-between items-center mt-2">
                                    <p className="text-xs font-bold">Cant: {item.cantidad}</p>
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
                                disabled={cart.length === 0}
                                className="py-3 bg-white border border-brand-200 text-brand-600 rounded-xl font-bold text-xs uppercase tracking-widest hover:bg-brand-50 transition-all flex items-center justify-center gap-2 shadow-sm"
                            >
                                <PrinterIcon size={16} /> Pre-Cuenta
                            </button>
                            <button 
                                disabled={!selectedMesa || cart.filter(i => !i.isExisting).length === 0} 
                                onClick={submitOrder} 
                                className="py-3 bg-gray-900 text-white rounded-xl font-black text-xs uppercase tracking-widest hover:bg-brand-600 transition-all shadow-lg"
                            >
                                {activeOrder ? 'Actualizar' : 'Enviar'}
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default POS;
