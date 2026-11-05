import React, { useState, useEffect } from 'react';
import { ChefHat, Clock, MessageSquare, ArrowRight, Bell, Play, CheckCircle2, GripVertical } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

const KitchenPage = () => {
    const [pedidos, setPedidos] = useState([]);
    const [loading, setLoading] = useState(true);
    const [notasVistas, setNotasVistas] = useState({}); // observaciones de plato desplegadas por el cocinero

    useEffect(() => {
        fetchPedidos();
        const interval = setInterval(fetchPedidos, 5000);
        return () => clearInterval(interval);
    }, []);

    const fetchPedidos = async () => {
        try {
            const res = await fetch('/api/pedidos/cocina');
            if (res.ok) {
                const data = await res.json();
                setPedidos(Array.isArray(data) ? data : []);
            }
        } catch (error) {
            console.error('Error fetching kitchen orders:', error);
        } finally {
            setLoading(false);
        }
    };

    const onDragStart = (e, item) => {
        e.dataTransfer.setData("itemId", item.detalle_id);
    };

    // Cambia el estado de una linea. Lo usan el arrastre (escritorio) y los botones (celular/tablet, donde no hay arrastre).
    const moverItem = async (itemId, nuevoEstado) => {
        if (!itemId) return;
        try {
            const res = await fetch(`/api/pedidos/detalle/${itemId}/estado`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ estado: nuevoEstado })
            });
            if (!res.ok) {
                const body = await res.json().catch(() => ({}));
                alert(body.error || 'No se pudo cambiar el estado.');
            }
            fetchPedidos();
        } catch (error) {
            console.error('Error al mover item:', error);
        }
    };

    const onDrop = (e, nuevoEstado) => moverItem(e.dataTransfer.getData("itemId"), nuevoEstado);

    const allowDrop = (e) => e.preventDefault();

    const getAllItems = () => {
        const items = [];
        pedidos.forEach(p => {
            if (p.detalles) {
                p.detalles.forEach(d => {
                    items.push({ ...d, mesa_numero: p.mesa_numero, es_delivery: p.es_delivery, pedido_id: p.id });
                });
            }
        });
        return items;
    };

    const renderColumn = (titulo, estado, color, icon) => {
        const items = getAllItems().filter(i => {
            const currentStatus = i.estado_comanda || 'pendiente';
            if (estado === 'pendiente') return currentStatus === 'pendiente';
            if (estado === 'preparacion') return currentStatus === 'preparacion' || currentStatus === 'en_cocina';
            if (estado === 'listo') return currentStatus === 'listo';
            return false;
        });
        
        return (
            <div 
                onDragOver={allowDrop} 
                onDrop={(e) => onDrop(e, estado)}
                className="flex-1 min-w-0 lg:min-w-[300px] bg-gray-50/50 rounded-[2.5rem] p-6 border-2 border-dashed border-gray-200 flex flex-col lg:h-full lg:overflow-hidden"
            >
                <div className="flex items-center justify-between mb-6 px-2 shrink-0">
                    <div className="flex items-center gap-3">
                        <div className={`p-2 rounded-xl ${color} bg-white shadow-sm`}>{icon}</div>
                        <h3 className="font-display font-black uppercase tracking-widest text-sm">{titulo}</h3>
                    </div>
                    <span className="bg-white px-3 py-1 rounded-lg text-xs font-black shadow-sm border border-gray-100">{items.length}</span>
                </div>

                <div className="space-y-4 lg:overflow-y-auto lg:flex-1 pr-2 custom-scrollbar">
                    <AnimatePresence>
                        {items.map((item) => (
                            <motion.div
                                key={item.detalle_id}
                                layout
                                draggable
                                onDragStart={(e) => onDragStart(e, item)}
                                initial={{ opacity: 0, y: 10 }}
                                animate={{ opacity: 1, y: 0 }}
                                className="bg-white p-5 rounded-3xl shadow-sm border border-gray-100 cursor-grab active:cursor-grabbing hover:shadow-md transition-all group relative border-l-8"
                                style={{ borderLeftColor: estado === 'pendiente' ? '#ef4444' : estado === 'preparacion' ? '#f97316' : '#10b981' }}
                            >
                                <div className="absolute right-4 top-4 text-gray-200 group-hover:text-gray-400 transition-colors">
                                    <GripVertical size={20} />
                                </div>
                                
                                <div className="mb-3 flex gap-2">
                                    <span className="text-[10px] font-black uppercase bg-gray-100 px-2 py-0.5 rounded text-gray-500">{item.es_delivery ? 'Delivery' : `Mesa ${item.mesa_numero}`}</span>
                                    <span className="text-[10px] font-black uppercase bg-brand-50 px-2 py-0.5 rounded text-brand-600">ID {item.pedido_id}</span>
                                </div>
                                
                                <p className="font-bold text-gray-900 leading-tight pr-6">
                                    <span className="text-brand-600 font-black mr-1">{item.cantidad}x</span> {item.producto_nombre}
                                </p>

                                {item.notas && (
                                    <div className="mt-3">
                                        <button
                                            type="button"
                                            onClick={() => setNotasVistas((current) => ({ ...current, [item.detalle_id]: !current[item.detalle_id] }))}
                                            aria-expanded={Boolean(notasVistas[item.detalle_id])}
                                            className="flex items-center gap-1.5 rounded-xl border border-red-200 bg-red-50 px-3 py-1.5 text-[10px] font-black uppercase tracking-widest text-red-600 hover:bg-red-100"
                                        >
                                            <MessageSquare size={12} /> {notasVistas[item.detalle_id] ? 'Ocultar observación' : 'Ver observación'}
                                        </button>
                                        {notasVistas[item.detalle_id] && (
                                            <p className="mt-2 rounded-xl border border-red-100 bg-red-50/60 p-3 text-xs font-bold text-red-600 break-words">{item.notas}</p>
                                        )}
                                    </div>
                                )}

                                <div className="mt-4 flex gap-2">
                                    {estado !== 'pendiente' && (
                                        <button
                                            type="button"
                                            onClick={() => moverItem(item.detalle_id, estado === 'listo' ? 'preparacion' : 'pendiente')}
                                            className="flex-1 rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-[11px] font-black uppercase tracking-widest text-gray-600 active:bg-gray-100"
                                        >
                                            ← {estado === 'listo' ? 'A preparación' : 'A recepción'}
                                        </button>
                                    )}
                                    {estado !== 'listo' && (
                                        <button
                                            type="button"
                                            onClick={() => moverItem(item.detalle_id, estado === 'pendiente' ? 'preparacion' : 'listo')}
                                            className={`flex-1 rounded-xl px-3 py-2.5 text-[11px] font-black uppercase tracking-widest text-white active:opacity-80 ${estado === 'pendiente' ? 'bg-orange-500' : 'bg-emerald-500'}`}
                                        >
                                            {estado === 'pendiente' ? 'Preparar' : 'Listo'} →
                                        </button>
                                    )}
                                </div>
                            </motion.div>
                        ))}
                    </AnimatePresence>
                    {items.length === 0 && (
                        <div className="h-32 flex items-center justify-center border-2 border-dashed border-gray-100 rounded-[2rem]">
                            <p className="text-[10px] font-black uppercase text-gray-300 tracking-widest">Vacío</p>
                        </div>
                    )}
                </div>
            </div>
        );
    };

    if (loading) return (
        <div className="flex flex-col items-center justify-center min-h-[400px]">
            <div className="w-16 h-16 border-4 border-brand-100 border-t-brand-600 rounded-full animate-spin"></div>
            <p className="mt-4 font-display font-bold text-brand-900 uppercase tracking-widest text-xs">Cargando Tablero...</p>
        </div>
    );

    return (
        <div className="lg:h-[calc(100vh-140px)] flex flex-col space-y-6 lg:space-y-8 animate-fade-in">
            <div className="flex justify-between items-end shrink-0 gap-3">
                <div>
                    <h2 className="text-2xl sm:text-4xl font-display font-black tracking-tight uppercase">Monitor de <span className="text-brand-600">Cocina</span></h2>
                    <p className="text-[var(--text-secondary)] mt-1.5 font-medium">Arrastra las tarjetas o usa los botones para cambiar su estado.</p>
                </div>
                <div className="flex gap-2">
                    <div className="flex items-center gap-2 bg-white px-4 py-2 rounded-2xl border border-gray-100 shadow-sm text-[10px] font-black uppercase">
                        <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div> En Línea
                    </div>
                </div>
            </div>

            <div className="flex-1 flex flex-col lg:flex-row gap-6 lg:overflow-x-auto pb-4 custom-scrollbar items-stretch">
                {renderColumn("Recepción", "pendiente", "text-red-500", <Bell size={18} />)}
                {renderColumn("En Preparación", "preparacion", "text-orange-500", <Play size={18} />)}
                {renderColumn("Listo para Servir", "listo", "text-emerald-500", <CheckCircle2 size={18} />)}
            </div>
        </div>
    );
};

export default KitchenPage;
