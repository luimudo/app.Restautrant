import React, { useState, useEffect } from 'react';
import { Package, Search, AlertTriangle, ArrowUpRight, Coffee, Beer, Database, Plus, Edit2, Trash2, X, Save } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

const Inventory = () => {
    const navigate = useNavigate();
    const { activeUser } = useAuth();
    const [insumos, setInsumos] = useState([]);
    const [productosBar, setProductosBar] = useState([]);
    const [loading, setLoading] = useState(true);
    const [tab, setTab] = useState('insumos'); // 'insumos' or 'bar'
    const [searchTerm, setSearchTerm] = useState('');

    // Modal & Form State
    const [showModal, setShowModal] = useState(false);
    const [currentItem, setCurrentItem] = useState({ id: null, nombre: '', unidad_medida: 'Unidad', costo_unitario: 0, stock_actual: 0 });

    useEffect(() => {
        if (!activeUser) return;
        fetchData();
    }, [activeUser]);

    const fetchData = async () => {
        try {
            const [insRes, prodRes] = await Promise.all([
                fetch('http://localhost:3000/api/insumos'),
                fetch('http://localhost:3000/api/productos')
            ]);
            
            if (!insRes.ok || !prodRes.ok) {
                if (insRes.status === 401 || prodRes.status === 401) {
                    console.warn('Sesión expirada o no autorizada');
                    setLoading(false);
                    return;
                }
            }
            
            const insData = await insRes.json();
            const prodData = await prodRes.json();
            setInsumos(Array.isArray(insData) ? insData : []);
            setProductosBar((Array.isArray(prodData) ? prodData : []).filter(p =>
                p.es_barra === 1 || p.es_barra === true
            ));
        } catch (error) {
            console.error('Error fetching inventory:', error);
        } finally {
            setLoading(false);
        }
    };

    const handleSave = async (e) => {
        e.preventDefault();
        const method = currentItem.id ? 'PUT' : 'POST';
        const url = currentItem.id
            ? `http://localhost:3000/api/insumos/${currentItem.id}`
            : 'http://localhost:3000/api/insumos';

        try {
            const res = await fetch(url, {
                method,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(currentItem)
            });
            if (res.ok) {
                setShowModal(false);
                fetchData();
            }
        } catch (error) {
            console.error('Error saving insumo:', error);
        }
    };

    const handleDelete = async (id) => {
        if (!confirm('¿Estás seguro de eliminar este insumo?')) return;
        try {
            const res = await fetch(`http://localhost:3000/api/insumos/${id}`, { method: 'DELETE' });
            if (res.ok) fetchData();
        } catch (error) {
            console.error('Error deleting insumo:', error);
        }
    };

    if (loading) return (
        <div className="flex flex-col items-center justify-center min-h-[400px]">
            <div className="w-16 h-16 border-4 border-brand-100 border-t-brand-600 rounded-full animate-spin"></div>
            <p className="mt-4 font-display font-bold text-brand-900 uppercase tracking-widest text-xs">Cargando Inventario...</p>
        </div>
    );

    const currentData = tab === 'insumos' ? insumos : productosBar;
    const filteredData = currentData.filter(item =>
        item.nombre.toLowerCase().includes(searchTerm.toLowerCase())
    );

    return (
        <div className="space-y-10 animate-fade-in">
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
                <div>
                    <h2 className="text-4xl font-display font-black uppercase tracking-tight">Inventario <span className="text-brand-600">Central</span></h2>
                    <p className="text-[var(--text-secondary)] mt-1.5 font-medium">Control total de materias primas y productos finalizados.</p>
                </div>

                <div className="flex gap-4">
                    <div className="flex bg-white p-1.5 rounded-2xl shadow-sm border border-gray-100">
                        <button
                            onClick={() => setTab('insumos')}
                            className={`px-6 py-2.5 rounded-xl text-xs font-black uppercase tracking-widest transition-all ${tab === 'insumos' ? 'bg-brand-600 text-white shadow-lg shadow-brand-500/30' : 'text-gray-400 hover:text-gray-600'}`}
                        >
                            Insumos / Cocina
                        </button>
                        <button
                            onClick={() => setTab('bar')}
                            className={`px-6 py-2.5 rounded-xl text-xs font-black uppercase tracking-widest transition-all ${tab === 'bar' ? 'bg-blue-600 text-white shadow-lg shadow-blue-500/30' : 'text-gray-400 hover:text-gray-600'}`}
                        >
                            Barra / Bebidas
                        </button>
                    </div>
                </div>
            </div>

            {/* Stats Summary */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="card bg-white p-6 flex items-center gap-6">
                    <div className={`w-14 h-14 rounded-2xl flex items-center justify-center ${tab === 'insumos' ? 'bg-brand-50 text-brand-600' : 'bg-blue-50 text-blue-600'}`}>
                        <Database size={28} />
                    </div>
                    <div>
                        <p className="text-[10px] font-black uppercase tracking-widest text-gray-400 leading-none mb-1">Total {tab === 'insumos' ? 'Insumos' : 'Bebidas'}</p>
                        <p className="text-2xl font-display font-black">{filteredData.length}</p>
                    </div>
                </div>
                <div className="card bg-white p-6 flex items-center gap-6">
                    <div className="w-14 h-14 bg-red-50 text-red-600 rounded-2xl flex items-center justify-center">
                        <AlertTriangle size={28} />
                    </div>
                    <div>
                        <p className="text-[10px] font-black uppercase tracking-widest text-gray-400 leading-none mb-1">Stock Bajo</p>
                        <p className="text-2xl font-display font-black text-red-600">
                            {filteredData.filter(i => (i.stock_actual || i.stock) < 5).length}
                        </p>
                    </div>
                </div>
                <div className="card bg-white p-6 flex items-center gap-6">
                    <div className="w-14 h-14 bg-emerald-50 text-emerald-600 rounded-2xl flex items-center justify-center">
                        <ArrowUpRight size={28} />
                    </div>
                    <div>
                        <p className="text-[10px] font-black uppercase tracking-widest text-gray-400 leading-none mb-1">Inversión Aprox.</p>
                        <p className="text-2xl font-display font-black text-emerald-600">
                            S/ {filteredData.reduce((acc, curr) => acc + ((curr.costo_unitario || curr.precio * 0.4) * (curr.stock_actual || curr.stock || 0)), 0).toLocaleString()}
                        </p>
                    </div>
                </div>
            </div>

            {/* List and Filters */}
            <div className="card bg-white p-0 overflow-hidden">
                <div className="p-6 border-b border-gray-100 flex flex-col md:flex-row gap-4 items-center justify-between">
                    <div className="relative w-full md:w-96 group">
                        <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 group-focus-within:text-brand-600 transition-colors" size={18} />
                        <input
                            type="text"
                            placeholder={`Buscar ${tab === 'insumos' ? 'insumo' : 'bebida'}...`}
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            className="w-full pl-12 pr-4 py-3 bg-gray-50 border-transparent rounded-2xl text-sm focus:bg-white focus:ring-4 focus:ring-brand-500/10 transition-all outline-none"
                        />
                    </div>
                    <div className="flex gap-2">
                        {tab === 'insumos' ? (
                            <button
                                onClick={() => {
                                    setCurrentItem({ id: null, nombre: '', unidad_medida: 'Unidad', costo_unitario: 0, stock_actual: 0 });
                                    setShowModal(true);
                                }}
                                className="btn btn-primary flex items-center gap-2"
                            >
                                <Plus size={18} /> Nuevo Insumo
                            </button>
                        ) : (
                            <button
                                onClick={() => navigate('/menu')}
                                className="btn bg-blue-600 hover:bg-blue-700 text-white flex items-center gap-2 shadow-lg shadow-blue-500/20"
                            >
                                <Plus size={18} /> Gestionar Bebidas
                            </button>
                        )}
                    </div>
                </div>

                <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                        <thead>
                            <tr className="bg-gray-50/50">
                                <th className="px-8 py-5 text-[10px] font-black uppercase tracking-widest text-gray-400 border-b border-gray-100">Item / Nombre</th>
                                <th className="px-8 py-5 text-[10px] font-black uppercase tracking-widest text-gray-400 border-b border-gray-100 text-center">Unidad</th>
                                <th className="px-8 py-5 text-[10px] font-black uppercase tracking-widest text-gray-400 border-b border-gray-100 text-center">Stock Actual</th>
                                <th className="px-8 py-5 text-[10px] font-black uppercase tracking-widest text-gray-400 border-b border-gray-100 text-right">Costo / Precio</th>
                                <th className="px-8 py-5 text-[10px] font-black uppercase tracking-widest text-gray-400 border-b border-gray-100 text-center">Estado</th>
                                <th className="px-8 py-5 text-[10px] font-black uppercase tracking-widest text-gray-400 border-b border-gray-100 text-right">Acciones</th>
                            </tr>
                        </thead>
                        <tbody>
                            {filteredData.map(item => {
                                const stock = tab === 'insumos' ? item.stock_actual : item.stock;
                                const isLow = stock < 5;

                                return (
                                    <tr key={item.id} className="group hover:bg-gray-50/80 transition-colors">
                                        <td className="px-8 py-6 border-b border-gray-50">
                                            <div className="flex items-center gap-4">
                                                <div className={`p-3 rounded-2xl ${tab === 'insumos' ? 'bg-brand-50 text-brand-600' : 'bg-blue-50 text-blue-600'}`}>
                                                    {tab === 'insumos' ? <Coffee size={18} /> : <Beer size={18} />}
                                                </div>
                                                <span className="font-bold text-gray-900">{item.nombre}</span>
                                            </div>
                                        </td>
                                        <td className="px-8 py-6 border-b border-gray-50 text-center">
                                            <span className="text-xs font-bold text-gray-500 bg-gray-100 px-3 py-1 rounded-lg">
                                                {item.unidad_medida || 'Unidad'}
                                            </span>
                                        </td>
                                        <td className="px-8 py-6 border-b border-gray-50 text-center">
                                            <span className={`text-lg font-display font-black ${isLow ? 'text-red-500' : 'text-gray-900'}`}>
                                                {stock}
                                            </span>
                                        </td>
                                        <td className="px-8 py-6 border-b border-gray-50 text-right">
                                            <span className="font-black text-gray-900">S/ {(Number(item.costo_unitario) || Number(item.precio)).toFixed(2)}</span>
                                        </td>
                                        <td className="px-8 py-6 border-b border-gray-50 text-center">
                                            {isLow ? (
                                                <span className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-red-100 text-red-600 rounded-xl text-[10px] font-black uppercase tracking-wider">
                                                    <AlertTriangle size={12} /> Crítico
                                                </span>
                                            ) : (
                                                <span className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-emerald-100 text-emerald-600 rounded-xl text-[10px] font-black uppercase tracking-wider">
                                                    Saludable
                                                </span>
                                            )}
                                        </td>
                                        <td className="px-8 py-6 border-b border-gray-50 text-right">
                                            {tab === 'insumos' ? (
                                                <div className="flex justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                                    <button
                                                        onClick={() => {
                                                            setCurrentItem(item);
                                                            setShowModal(true);
                                                        }}
                                                        className="p-2 text-gray-400 hover:text-brand-600 hover:bg-brand-50 rounded-xl transition-all"
                                                    >
                                                        <Edit2 size={16} />
                                                    </button>
                                                    <button
                                                        onClick={() => handleDelete(item.id)}
                                                        className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-xl transition-all"
                                                    >
                                                        <Trash2 size={16} />
                                                    </button>
                                                </div>
                                            ) : (
                                                <button
                                                    onClick={() => navigate('/menu')}
                                                    className="text-[10px] font-black uppercase text-blue-600 hover:underline"
                                                >
                                                    Gestionar en Carta
                                                </button>
                                            )}
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* Modal Insumos */}
            <AnimatePresence>
                {showModal && (
                    <div className="fixed inset-0 bg-black/60 backdrop-blur-md z-50 flex items-center justify-center p-4">
                        <motion.div
                            initial={{ scale: 0.9, opacity: 0 }}
                            animate={{ scale: 1, opacity: 1 }}
                            className="bg-white rounded-[2.5rem] p-10 max-w-lg w-full shadow-2xl relative overflow-hidden"
                        >
                            <div className="absolute top-0 left-0 w-full h-2 bg-brand-600"></div>
                            <div className="flex justify-between items-center mb-8">
                                <h3 className="text-3xl font-display font-black">{currentItem.id ? 'Editar' : 'Nuevo'} Insumo</h3>
                                <button onClick={() => setShowModal(false)} className="p-2 hover:bg-gray-100 rounded-full transition-colors">
                                    <X size={24} />
                                </button>
                            </div>

                            <form onSubmit={handleSave} className="space-y-6">
                                <div className="space-y-2">
                                    <label className="text-[10px] font-black uppercase tracking-widest text-[var(--text-muted)] ml-1">Nombre del Insumo</label>
                                    <input
                                        type="text"
                                        className="input"
                                        value={currentItem.nombre}
                                        onChange={(e) => setCurrentItem({ ...currentItem, nombre: e.target.value })}
                                        placeholder="Ej: Carne de Res, Tomate, etc."
                                        required
                                    />
                                </div>

                                <div className="grid grid-cols-2 gap-4">
                                    <div className="space-y-2">
                                        <label className="text-[10px] font-black uppercase tracking-widest text-[var(--text-muted)] ml-1">Unidad de Medida</label>
                                        <select
                                            className="input appearance-none"
                                            value={currentItem.unidad_medida}
                                            onChange={(e) => setCurrentItem({ ...currentItem, unidad_medida: e.target.value })}
                                        >
                                            <option value="Unidad">Unidad</option>
                                            <option value="Kg">Kilogramos (Kg)</option>
                                            <option value="Gr">Gramos (Gr)</option>
                                            <option value="Lt">Litros (Lt)</option>
                                            <option value="Ml">Mililitros (Ml)</option>
                                            <option value="Paquete">Paquete</option>
                                        </select>
                                    </div>
                                    <div className="space-y-2">
                                        <label className="text-[10px] font-black uppercase tracking-widest text-[var(--text-muted)] ml-1">Costo Unitario (S/)</label>
                                        <input
                                            type="number"
                                            step="0.01"
                                            className="input"
                                            value={currentItem.costo_unitario}
                                            onChange={(e) => setCurrentItem({ ...currentItem, costo_unitario: e.target.value })}
                                            required
                                        />
                                    </div>
                                </div>

                                <div className="space-y-2">
                                    <label className="text-[10px] font-black uppercase tracking-widest text-[var(--text-muted)] ml-1">Stock Inicial</label>
                                    <input
                                        type="number"
                                        className="input"
                                        value={currentItem.stock_actual}
                                        onChange={(e) => setCurrentItem({ ...currentItem, stock_actual: e.target.value })}
                                        required
                                    />
                                </div>

                                <div className="flex gap-4 pt-6">
                                    <button type="button" onClick={() => setShowModal(false)} className="flex-1 btn btn-secondary px-8 py-4 rounded-2xl font-black uppercase tracking-widest">Cancelar</button>
                                    <button type="submit" className="flex-1 btn btn-primary flex items-center justify-center gap-2 px-8 py-4 rounded-2xl font-black uppercase tracking-widest shadow-lg shadow-brand-500/30">
                                        <Save size={18} /> Guardar Insumo
                                    </button>
                                </div>
                            </form>
                        </motion.div>
                    </div>
                )}
            </AnimatePresence>
        </div>
    );
};

export default Inventory;
