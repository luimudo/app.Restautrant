import React, { useState, useEffect } from 'react';
import { Beer, MessageSquare, Bell, CheckCircle2, GripVertical, Wine } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

const BarPage = () => {
    const [pedidos, setPedidos] = useState([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        fetchPedidos();
        const interval = setInterval(fetchPedidos, 5000);
        return () => clearInterval(interval);
    }, []);

    const fetchPedidos = async () => {
        try {
            const res = await fetch('http://localhost:3000/api/pedidos/bar');
            if (res.ok) {
                const data = await res.json();
                setPedidos(Array.isArray(data) ? data : []);
            }
        } catch (error) {
            console.error('Error fetching bar orders:', error);
        } finally {
            setLoading(false);
        }
    };

    const onDragStart = (e, item) => {
        e.dataTransfer.setData("itemId", String(item.detalle_id));
        e.dataTransfer.effectAllowed = "move";
    };

    const onDrop = async (e, nuevoEstado) => {
        const itemId = e.dataTransfer.getData("itemId");
        if (!itemId) return;
        
        try {
            await fetch(`http://localhost:3000/api/pedidos/detalle/${itemId}/estado`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ estado: nuevoEstado })
            });
            fetchPedidos();
        } catch (error) {
            console.error('Error al soltar bebida:', error);
        }
    };

    const allowDrop = (e) => e.preventDefault();

    const getAllItems = () => {
        const items = [];
        pedidos.forEach(p => {
            if (p.detalles) {
                p.detalles.forEach(d => {
                    items.push({ ...d, mesa_numero: p.mesa_numero, pedido_id: p.id });
                });
            }
        });
        return items;
    };

    const renderColumn = (titulo, estado, color, icon) => {
        const items = getAllItems().filter(i => {
            const currentStatus = i.estado_comanda || 'pendiente';
            if (estado === 'pendiente') return currentStatus === 'pendiente';
            if (estado === 'despachado') return currentStatus === 'despachado' || currentStatus === 'listo';
            return false;
        });
        
        return (
            <div 
                onDragOver={allowDrop} 
                onDrop={(e) => onDrop(e, estado)}
                className="flex-1 min-w-[350px] bg-blue-50/30 rounded-[2.5rem] p-6 border-2 border-dashed border-blue-100 flex flex-col h-full overflow-hidden"
            >
                <div className="flex items-center justify-between mb-6 px-2 shrink-0">
                    <div className="flex items-center gap-3">
                        <div className={`p-2 rounded-xl ${color} bg-white shadow-sm`}>{icon}</div>
                        <h3 className="font-display font-black uppercase tracking-widest text-sm">{titulo}</h3>
                    </div>
                    <span className="bg-white px-3 py-1 rounded-lg text-xs font-black shadow-sm border border-blue-50">{items.length}</span>
                </div>

                <div className="space-y-4 overflow-y-auto flex-1 pr-2 custom-scrollbar">
                    <AnimatePresence>
                        {items.map((item) => (
                            <motion.div
                                key={item.detalle_id}
                                layout
                                draggable="true"
                                onDragStart={(e) => onDragStart(e, item)}
                                initial={{ opacity: 0, scale: 0.9 }}
                                animate={{ opacity: 1, scale: 1 }}
                                className="bg-white p-6 rounded-3xl shadow-sm border border-blue-50 cursor-move active:cursor-grabbing hover:shadow-md transition-all group relative border-l-8 select-none"
                                style={{ borderLeftColor: (item.estado_comanda === 'despachado' || item.estado_comanda === 'listo') ? '#10b981' : '#3b82f6' }}
                            >
                                <div className="absolute right-4 top-1/2 -translate-y-1/2 text-blue-100 group-hover:text-blue-300 transition-colors">
                                    <GripVertical size={24} />
                                </div>
                                
                                <div className="mb-3 flex gap-2">
                                    <span className="text-[10px] font-black uppercase bg-blue-50 px-2 py-0.5 rounded text-blue-600">Mesa {item.mesa_numero}</span>
                                </div>
                                
                                <p className="font-bold text-gray-900 text-lg leading-tight pr-8">
                                    <span className="text-blue-600 font-black mr-2">{item.cantidad}x</span> {item.producto_nombre}
                                </p>

                                {item.notas && (
                                    <div className="mt-3 text-[10px] font-bold text-blue-500 bg-blue-50/50 p-2 rounded-xl border border-blue-100 flex items-start gap-2">
                                        <MessageSquare size={12} className="shrink-0 mt-0.5" />
                                        <span>{item.notas}</span>
                                    </div>
                                )}
                            </motion.div>
                        ))}
                    </AnimatePresence>
                    {items.length === 0 && (
                        <div className="h-32 flex items-center justify-center border-2 border-dashed border-blue-50 rounded-[2rem]">
                            <p className="text-[10px] font-black uppercase text-blue-200 tracking-widest">Barra Libre</p>
                        </div>
                    )}
                </div>
            </div>
        );
    };

    if (loading) return (
        <div className="flex flex-col items-center justify-center min-h-[400px]">
            <div className="w-16 h-16 border-4 border-blue-100 border-t-blue-600 rounded-full animate-spin"></div>
            <p className="mt-4 font-display font-bold text-blue-900 uppercase tracking-widest text-xs">Abriendo Barra...</p>
        </div>
    );

    return (
        <div className="h-[calc(100vh-140px)] flex flex-col space-y-8 animate-fade-in">
            <div className="flex justify-between items-end shrink-0">
                <div>
                    <h2 className="text-4xl font-display font-black tracking-tight uppercase">Monitor de <span className="text-blue-600">Barra</span></h2>
                    <p className="text-[var(--text-secondary)] mt-1.5 font-medium">Arrastra las bebidas para despacharlas.</p>
                </div>
                <div className="flex gap-2 text-blue-600 font-black text-[10px] uppercase bg-blue-50 px-4 py-2 rounded-2xl border border-blue-100">
                    <div className="w-2 h-2 bg-blue-500 rounded-full animate-pulse mr-2"></div> Barra Operativa
                </div>
            </div>

            <div className="flex-1 flex gap-8 pb-4 items-stretch max-w-5xl">
                {renderColumn("Recepcionado", "pendiente", "text-blue-500", <Bell size={18} />)}
                {renderColumn("Despachado", "despachado", "text-emerald-500", <CheckCircle2 size={18} />)}
            </div>
        </div>
    );
};

export default BarPage;
