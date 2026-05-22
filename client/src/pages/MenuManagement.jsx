import React, { useState, useEffect } from 'react';
import { ChefHat, Plus, Trash2, Edit2, Search, Filter, UtensilsCrossed, Info, Tag, DollarSign, Check, X } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

const MenuManagement = () => {
    const [productos, setProductos] = useState([]);
    const [categorias, setCategorias] = useState([]);
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');
    const [selectedCategory, setSelectedCategory] = useState('all');

    // Modals
    const [showProductForm, setShowProductForm] = useState(false);
    const [showCategoryForm, setShowCategoryForm] = useState(false);

    // Form states
    const [currentProduct, setCurrentProduct] = useState({
        id: null, nombre: '', descripcion: '', precio: '', tipo_id: '', es_receta: true, disponible: true
    });
    const [currentCategory, setCurrentCategory] = useState({ id: null, nombre: '', descripcion: '', es_barra: false });

    useEffect(() => {
        fetchData();
    }, []);

    const fetchData = async () => {
        setLoading(true);
        try {
            const [prodRes, catRes] = await Promise.all([
                fetch('http://localhost:3000/api/productos'),
                fetch('http://localhost:3000/api/categorias')
            ]);
            setProductos(await prodRes.json());
            setCategorias(await catRes.json());
        } catch (error) {
            console.error('Error fetching menu data:', error);
        } finally {
            setLoading(false);
        }
    };

    const handleSaveProduct = async (e) => {
        e.preventDefault();
        const url = currentProduct.id
            ? `http://localhost:3000/api/productos/${currentProduct.id}`
            : 'http://localhost:3000/api/productos';
        const method = currentProduct.id ? 'PUT' : 'POST';

        try {
            const res = await fetch(url, {
                method,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(currentProduct)
            });
            if (res.ok) {
                setShowProductForm(false);
                setCurrentProduct({ id: null, nombre: '', descripcion: '', precio: '', tipo_id: '', es_receta: true, disponible: true });
                fetchData();
            }
        } catch (error) {
            console.error('Error saving product:', error);
        }
    };

    const handleDeleteProduct = async (id) => {
        if (!confirm('¿Estás seguro de eliminar este plato?')) return;
        try {
            await fetch(`http://localhost:3000/api/productos/${id}`, { method: 'DELETE' });
            fetchData();
        } catch (error) {
            console.error('Error deleting product:', error);
        }
    };

    const handleSaveCategory = async (e) => {
        e.preventDefault();
        const url = currentCategory.id
            ? `http://localhost:3000/api/categorias/${currentCategory.id}`
            : 'http://localhost:3000/api/categorias';
        const method = currentCategory.id ? 'PUT' : 'POST';

        try {
            const res = await fetch(url, {
                method,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(currentCategory)
            });
            if (res.ok) {
                setShowCategoryForm(false);
                setCurrentCategory({ id: null, nombre: '', descripcion: '', es_barra: false });
                fetchData();
            }
        } catch (error) {
            console.error('Error saving category:', error);
        }
    };

    const handleDeleteCategory = async (id) => {
        if (!confirm('¿Estás seguro de eliminar esta categoría?')) return;
        try {
            await fetch(`http://localhost:3000/api/categorias/${id}`, { method: 'DELETE' });
            fetchData();
        } catch (error) {
            console.error('Error deleting category:', error);
        }
    };

    const filteredProductos = productos.filter(p => {
        const matchesSearch = p.nombre.toLowerCase().includes(searchTerm.toLowerCase());
        const matchesCategory = selectedCategory === 'all' || p.tipo_id === parseInt(selectedCategory);
        return matchesSearch && matchesCategory;
    });

    if (loading) return (
        <div className="flex flex-col items-center justify-center min-h-[400px]">
            <div className="w-16 h-16 border-4 border-brand-100 border-t-brand-600 rounded-full animate-spin"></div>
        </div>
    );

    return (
        <div className="space-y-10 animate-fade-in text-[var(--text-primary)]">
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
                <div>
                    <h2 className="text-4xl font-display font-black tracking-tight uppercase leading-none">
                        Gestión de <span className="text-brand-600">Carta</span>
                    </h2>
                    <p className="text-[var(--text-secondary)] mt-1.5 font-medium">Administra tus platos, bebidas y categorías del menú.</p>
                </div>
                <div className="flex gap-4">
                    <button
                        onClick={() => {
                            setCurrentCategory({ id: null, nombre: '', descripcion: '', es_barra: false });
                            setShowCategoryForm(true);
                        }}
                        className="btn btn-secondary border-dashed"
                    >
                        <Tag size={18} /> Categorías
                    </button>
                    <button
                        onClick={() => {
                            setCurrentProduct({ id: null, nombre: '', descripcion: '', precio: '', tipo_id: '', es_receta: true, disponible: true });
                            setShowProductForm(true);
                        }}
                        className="btn btn-primary"
                    >
                        <Plus size={18} /> Nuevo Plato
                    </button>
                </div>
            </div>

            {/* Filters Section */}
            <div className="flex flex-col md:flex-row gap-4 items-center bg-white p-4 rounded-[2rem] border border-[var(--border-color)] shadow-sm">
                <div className="relative flex-1 w-full">
                    <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
                    <input
                        type="text"
                        placeholder="Buscar plato por nombre..."
                        className="input pl-12"
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                    />
                </div>
                <div className="w-full md:w-64">
                    <select
                        className="input appearance-none"
                        value={selectedCategory}
                        onChange={(e) => setSelectedCategory(e.target.value)}
                    >
                        <option value="all">Todas las Categorías</option>
                        {categorias.map(cat => (
                            <option key={cat.id} value={cat.id}>{cat.nombre}</option>
                        ))}
                    </select>
                </div>
            </div>

            {/* Products Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-6">
                {filteredProductos.map(producto => (
                    <motion.div
                        layout
                        key={producto.id}
                        className="card group flex flex-col bg-white hover:border-brand-300 transition-all relative overflow-hidden"
                    >
                        {!producto.disponible && (
                            <div className="absolute inset-0 bg-white/60 backdrop-blur-[2px] z-10 flex items-center justify-center">
                                <span className="bg-red-500 text-white px-4 py-1.5 rounded-full text-[10px] font-black uppercase tracking-widest shadow-lg">Agotado</span>
                            </div>
                        )}
                        <div className="flex justify-between items-start mb-4">
                            <div className="p-3 bg-brand-50 text-brand-600 rounded-2xl border border-brand-100">
                                <ChefHat size={20} />
                            </div>
                            <div className="flex gap-1">
                                <button
                                    onClick={() => {
                                        setCurrentProduct(producto);
                                        setShowProductForm(true);
                                    }}
                                    className="p-2 text-gray-400 hover:text-brand-600 hover:bg-brand-50 rounded-xl transition-all"
                                >
                                    <Edit2 size={16} />
                                </button>
                                <button
                                    onClick={() => handleDeleteProduct(producto.id)}
                                    className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-xl transition-all"
                                >
                                    <Trash2 size={16} />
                                </button>
                            </div>
                        </div>
                        <div className="flex-1">
                            <h4 className="font-display font-black text-xl mb-1 group-hover:text-brand-600 transition-colors">{producto.nombre}</h4>
                            <p className="text-xs text-[var(--text-muted)] line-clamp-2 mb-4 font-medium">{producto.descripcion || 'Sin descripción'}</p>
                            <div className="flex items-center gap-2 mb-6">
                                <span className="px-2.5 py-1 bg-gray-100 text-gray-500 rounded-lg text-[9px] font-black uppercase tracking-widest border border-gray-200">
                                    {producto.tipo_nombre || 'S/C'}
                                </span>
                                {producto.es_receta ? (
                                    <span className="px-2.5 py-1 bg-emerald-50 text-emerald-600 rounded-lg text-[9px] font-black uppercase tracking-widest border border-emerald-100">Receta</span>
                                ) : (
                                    <span className="px-2.5 py-1 bg-blue-50 text-blue-600 rounded-lg text-[9px] font-black uppercase tracking-widest border border-blue-100">Directo</span>
                                )}
                            </div>
                        </div>
                        <div className="pt-6 border-t border-gray-50 flex justify-between items-center">
                            <p className="text-2xl font-display font-black text-brand-900 leading-none">S/ {Number(producto.precio).toFixed(2)}</p>
                            {producto.stock !== undefined && (
                                <div className="text-right">
                                    <p className="text-[9px] font-black uppercase text-gray-400 tracking-widest leading-none mb-1">Stock</p>
                                    <p className={`font-display font-black leading-none ${producto.stock < 5 ? 'text-red-500' : 'text-emerald-500'}`}>{producto.stock}</p>
                                </div>
                            )}
                        </div>
                    </motion.div>
                ))}
            </div>

            {/* Product Modal */}
            <AnimatePresence>
                {showProductForm && (
                    <div className="fixed inset-0 bg-black/60 backdrop-blur-md z-50 flex items-center justify-center p-4">
                        <motion.div
                            initial={{ scale: 0.9, opacity: 0 }}
                            animate={{ scale: 1, opacity: 1 }}
                            className="bg-white rounded-[2.5rem] p-10 max-w-lg w-full shadow-2xl relative overflow-hidden"
                        >
                            <div className="absolute top-0 left-0 w-full h-2 bg-brand-600"></div>
                            <h3 className="text-3xl font-display font-black mb-8">{currentProduct.id ? 'Editar' : 'Nuevo'} Plato</h3>
                            <form onSubmit={handleSaveProduct} className="space-y-6">
                                <div className="space-y-2">
                                    <label className="text-[10px] font-black uppercase tracking-widest text-[var(--text-muted)] ml-1">Nombre</label>
                                    <input
                                        type="text"
                                        className="input"
                                        value={currentProduct.nombre}
                                        onChange={(e) => setCurrentProduct({ ...currentProduct, nombre: e.target.value })}
                                        required
                                    />
                                </div>
                                <div className="grid grid-cols-2 gap-4">
                                    <div className="space-y-2">
                                        <label className="text-[10px] font-black uppercase tracking-widest text-[var(--text-muted)] ml-1">Precio (S/)</label>
                                        <input
                                            type="number"
                                            step="0.01"
                                            className="input"
                                            value={currentProduct.precio}
                                            onChange={(e) => setCurrentProduct({ ...currentProduct, precio: e.target.value })}
                                            required
                                        />
                                    </div>
                                    <div className="space-y-2">
                                        <label className="text-[10px] font-black uppercase tracking-widest text-[var(--text-muted)] ml-1">Categoría</label>
                                        <select
                                            className="input appearance-none"
                                            value={currentProduct.tipo_id}
                                            onChange={(e) => setCurrentProduct({ ...currentProduct, tipo_id: e.target.value })}
                                            required
                                        >
                                            <option value="">Elegir...</option>
                                            {categorias.map(cat => (
                                                <option key={cat.id} value={cat.id}>{cat.nombre}</option>
                                            ))}
                                        </select>
                                    </div>
                                </div>
                                <div className="space-y-2">
                                    <label className="text-[10px] font-black uppercase tracking-widest text-[var(--text-muted)] ml-1">Descripción</label>
                                    <textarea
                                        className="input min-h-[100px] resize-none py-4"
                                        value={currentProduct.descripcion}
                                        onChange={(e) => setCurrentProduct({ ...currentProduct, descripcion: e.target.value })}
                                    ></textarea>
                                </div>
                                <div className="flex items-center gap-6 pt-2">
                                    <label className="flex items-center gap-3 cursor-pointer group">
                                        <input
                                            type="checkbox"
                                            className="w-5 h-5 accent-brand-600 rounded-lg cursor-pointer"
                                            checked={currentProduct.disponible}
                                            onChange={(e) => setCurrentProduct({ ...currentProduct, disponible: e.target.checked })}
                                        />
                                        <span className="text-sm font-bold text-[var(--text-secondary)]">Disponible</span>
                                    </label>
                                    <label className="flex items-center gap-3 cursor-pointer group">
                                        <input
                                            type="checkbox"
                                            className="w-5 h-5 accent-brand-600 rounded-lg cursor-pointer"
                                            checked={currentProduct.es_receta}
                                            onChange={(e) => setCurrentProduct({ ...currentProduct, es_receta: e.target.checked })}
                                        />
                                        <span className="text-sm font-bold text-[var(--text-secondary)]">Es Receta</span>
                                    </label>
                                </div>
                                <div className="flex gap-4 pt-6">
                                    <button type="button" onClick={() => setShowProductForm(false)} className="flex-1 btn btn-secondary">Cancelar</button>
                                    <button type="submit" className="flex-1 btn btn-primary">Guardar Plato</button>
                                </div>
                            </form>
                        </motion.div>
                    </div>
                )}
            </AnimatePresence>

            {/* Category Modal (Simplified) */}
            <AnimatePresence>
                {showCategoryForm && (
                    <div className="fixed inset-0 bg-black/60 backdrop-blur-md z-50 flex items-center justify-center p-4">
                        <motion.div
                            initial={{ scale: 0.9, opacity: 0 }}
                            animate={{ scale: 1, opacity: 1 }}
                            className="bg-white rounded-[2.5rem] p-10 max-w-md w-full shadow-2xl"
                        >
                            <h3 className="text-3xl font-display font-black mb-8">Gestionar Categorías</h3>

                            <form onSubmit={handleSaveCategory} className="mb-10 p-6 bg-gray-50 rounded-3xl border border-gray-100 flex flex-col gap-4">
                                <input
                                    type="text"
                                    placeholder="Nombre de categoría"
                                    className="input"
                                    value={currentCategory.nombre}
                                    onChange={(e) => setCurrentCategory({ ...currentCategory, nombre: e.target.value })}
                                    required
                                />
                                <label className="flex items-center gap-3 px-2 cursor-pointer group">
                                    <input
                                        type="checkbox"
                                        className="w-5 h-5 accent-brand-600 rounded-lg cursor-pointer"
                                        checked={currentCategory.es_barra}
                                        onChange={(e) => setCurrentCategory({ ...currentCategory, es_barra: e.target.checked })}
                                    />
                                    <span className="text-sm font-bold text-[var(--text-secondary)]">Asignar a Despacho de Bar</span>
                                </label>
                                <button type="submit" className="btn btn-primary w-full shadow-md mt-2">
                                    {currentCategory.id ? 'Actualizar' : 'Crear'} Categoría
                                </button>
                                {currentCategory.id && (
                                    <button type="button" onClick={() => setCurrentCategory({ id: null, nombre: '', descripcion: '', es_barra: false })} className="text-xs text-[var(--text-muted)] font-bold hover:text-brand-600">Cancelar edición</button>
                                )}
                            </form>

                            <div className="space-y-3 max-h-[300px] overflow-y-auto pr-2 custom-scrollbar">
                                {categorias.map(cat => (
                                    <div key={cat.id} className="flex justify-between items-center p-4 bg-white border border-gray-100 rounded-2xl group hover:border-brand-200 transition-all">
                                        <div className="flex flex-col">
                                            <span className="font-bold">{cat.nombre}</span>
                                            {cat.es_barra ? (
                                                <span className="text-[8px] font-black uppercase text-blue-600 tracking-widest">Módulo Bar</span>
                                            ) : (
                                                <span className="text-[8px] font-black uppercase text-brand-400 tracking-widest">Módulo Cocina</span>
                                            )}
                                        </div>
                                        <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                            <button onClick={() => setCurrentCategory(cat)} className="p-2 text-gray-400 hover:text-brand-600"><Edit2 size={14} /></button>
                                            <button onClick={() => handleDeleteCategory(cat.id)} className="p-2 text-gray-400 hover:text-red-600"><Trash2 size={14} /></button>
                                        </div>
                                    </div>
                                ))}
                            </div>

                            <button onClick={() => setShowCategoryForm(false)} className="w-full mt-8 btn btn-secondary">Cerrar</button>
                        </motion.div>
                    </div>
                )}
            </AnimatePresence>
        </div>
    );
};

export default MenuManagement;
