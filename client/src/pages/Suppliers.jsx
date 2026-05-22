import React, { useState, useEffect } from 'react';
import { Users, Search, Plus, Edit2, Trash2, X, Save, Phone, MapPin, CreditCard, Building2, UserCircle } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

const Suppliers = () => {
    const [suppliers, setSuppliers] = useState([]);
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');
    const [showModal, setShowModal] = useState(false);
    const [currentSupplier, setCurrentSupplier] = useState({
        id: null,
        razon_social: '',
        ruc: '',
        contacto: '',
        direccion: '',
        telefono: ''
    });

    useEffect(() => {
        fetchData();
    }, []);

    const fetchData = async () => {
        try {
            const res = await fetch('http://localhost:3000/api/proveedores');
            if (!res.ok) throw new Error('Error al obtener proveedores');
            const data = await res.json();
            setSuppliers(Array.isArray(data) ? data : []);
        } catch (error) {
            console.error('Error fetching suppliers:', error);
        } finally {
            setLoading(false);
        }
    };

    const handleSave = async (e) => {
        e.preventDefault();
        const method = currentSupplier.id ? 'PUT' : 'POST';
        const url = currentSupplier.id
            ? `http://localhost:3000/api/proveedores/${currentSupplier.id}`
            : 'http://localhost:3000/api/proveedores';

        try {
            const res = await fetch(url, {
                method,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(currentSupplier)
            });
            if (res.ok) {
                setShowModal(false);
                fetchData();
            } else {
                const errorData = await res.json();
                alert(`Error: ${errorData.error || 'No se pudo guardar el proveedor'}`);
            }
        } catch (error) {
            console.error('Error saving supplier:', error);
            alert('Error de conexión con el servidor');
        }
    };

    const handleDelete = async (id) => {
        if (!confirm('¿Estás seguro de eliminar este proveedor?')) return;
        try {
            const res = await fetch(`http://localhost:3000/api/proveedores/${id}`, { method: 'DELETE' });
            if (res.ok) fetchData();
        } catch (error) {
            console.error('Error deleting supplier:', error);
        }
    };

    const filteredSuppliers = suppliers.filter(s =>
        (s.razon_social || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
        (s.ruc || '').includes(searchTerm) ||
        (s.contacto || '').toLowerCase().includes(searchTerm.toLowerCase())
    );

    if (loading) return (
        <div className="flex flex-col items-center justify-center min-h-[400px]">
            <div className="w-16 h-16 border-4 border-brand-100 border-t-brand-600 rounded-full animate-spin"></div>
            <p className="mt-4 font-display font-bold text-brand-900 uppercase tracking-widest text-xs">Cargando Proveedores...</p>
        </div>
    );

    return (
        <div className="space-y-10 animate-fade-in">
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
                <div>
                    <h2 className="text-4xl font-display font-black uppercase tracking-tight">Gestión de <span className="text-brand-600">Proveedores</span></h2>
                    <p className="text-[var(--text-secondary)] mt-1.5 font-medium">Administra tus contactos comerciales y fuentes de abastecimiento.</p>
                </div>
                <button
                    onClick={() => {
                        setCurrentSupplier({ id: null, razon_social: '', ruc: '', contacto: '', direccion: '', telefono: '' });
                        setShowModal(true);
                    }}
                    className="btn btn-primary flex items-center gap-2 px-8 py-4 rounded-2xl shadow-lg shadow-brand-500/30"
                >
                    <Plus size={20} /> Nuevo Proveedor
                </button>
            </div>

            <div className="card bg-white p-0 overflow-hidden">
                <div className="p-6 border-b border-gray-100">
                    <div className="relative w-full md:w-96 group">
                        <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 group-focus-within:text-brand-600 transition-colors" size={18} />
                        <input
                            type="text"
                            placeholder="Buscar por RUC o Razón Social..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            className="w-full pl-12 pr-4 py-3 bg-gray-50 border-transparent rounded-2xl text-sm focus:bg-white focus:ring-4 focus:ring-brand-500/10 transition-all outline-none"
                        />
                    </div>
                </div>

                <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                        <thead>
                            <tr className="bg-gray-50/50">
                                <th className="px-8 py-5 text-[10px] font-black uppercase tracking-widest text-gray-400 border-b border-gray-100">Razón Social</th>
                                <th className="px-8 py-5 text-[10px] font-black uppercase tracking-widest text-gray-400 border-b border-gray-100">RUC / Identificación</th>
                                <th className="px-8 py-5 text-[10px] font-black uppercase tracking-widest text-gray-400 border-b border-gray-100">Contacto / Teléfono</th>
                                <th className="px-8 py-5 text-[10px] font-black uppercase tracking-widest text-gray-400 border-b border-gray-100 text-right">Acciones</th>
                            </tr>
                        </thead>
                        <tbody>
                            {filteredSuppliers.map(supplier => (
                                <tr key={supplier.id} className="group hover:bg-gray-50/80 transition-colors">
                                    <td className="px-8 py-6 border-b border-gray-50">
                                        <div className="flex items-center gap-4">
                                            <div className="p-3 rounded-2xl bg-brand-50 text-brand-600">
                                                <Building2 size={18} />
                                            </div>
                                            <span className="font-bold text-gray-900">{supplier.razon_social}</span>
                                        </div>
                                    </td>
                                    <td className="px-8 py-6 border-b border-gray-50">
                                        <div className="flex items-center gap-2 text-sm font-medium text-gray-700">
                                            <CreditCard size={14} className="text-gray-400" />
                                            {supplier.ruc}
                                        </div>
                                    </td>
                                    <td className="px-8 py-6 border-b border-gray-50">
                                        <div className="space-y-1">
                                            <div className="flex items-center gap-2 text-xs text-gray-600 font-bold">
                                                <UserCircle size={12} className="text-brand-500" />
                                                {supplier.contacto || 'Sin contacto'}
                                            </div>
                                            <div className="flex items-center gap-2 text-xs text-gray-500">
                                                <Phone size={12} className="text-gray-400" />
                                                {supplier.telefono}
                                            </div>
                                        </div>
                                    </td>
                                    <td className="px-8 py-6 border-b border-gray-50 text-right">
                                        <div className="flex justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                            <button
                                                onClick={() => {
                                                    setCurrentSupplier(supplier);
                                                    setShowModal(true);
                                                }}
                                                className="p-2 text-gray-400 hover:text-brand-600 hover:bg-brand-50 rounded-xl transition-all"
                                            >
                                                <Edit2 size={16} />
                                            </button>
                                            <button
                                                onClick={() => handleDelete(supplier.id)}
                                                className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-xl transition-all"
                                            >
                                                <Trash2 size={16} />
                                            </button>
                                        </div>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>

            <AnimatePresence>
                {showModal && (
                    <div className="fixed inset-0 bg-black/60 backdrop-blur-md z-50 flex items-center justify-center p-4">
                        <motion.div
                            initial={{ scale: 0.9, opacity: 0 }}
                            animate={{ scale: 1, opacity: 1 }}
                            className="bg-white rounded-[2.5rem] p-10 max-w-2xl w-full shadow-2xl relative overflow-hidden"
                        >
                            <div className="absolute top-0 left-0 w-full h-2 bg-brand-600"></div>
                            <div className="flex justify-between items-center mb-8">
                                <h3 className="text-3xl font-display font-black">{currentSupplier.id ? 'Editar' : 'Nuevo'} Proveedor</h3>
                                <button onClick={() => setShowModal(false)} className="p-2 hover:bg-gray-100 rounded-full transition-colors">
                                    <X size={24} />
                                </button>
                            </div>

                            <form onSubmit={handleSave} className="space-y-6">
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                    <div className="md:col-span-2 space-y-2">
                                        <label className="text-[10px] font-black uppercase tracking-widest text-gray-400 ml-1">Razón Social</label>
                                        <input
                                            type="text"
                                            className="input"
                                            value={currentSupplier.razon_social}
                                            onChange={(e) => setCurrentSupplier({ ...currentSupplier, razon_social: e.target.value })}
                                            placeholder="Ejem: Distribuidora de Alimentos S.A.C."
                                            required
                                        />
                                    </div>
                                    <div className="space-y-2">
                                        <label className="text-[10px] font-black uppercase tracking-widest text-gray-400 ml-1">RUC / Identificación</label>
                                        <input
                                            type="text"
                                            className="input"
                                            value={currentSupplier.ruc}
                                            onChange={(e) => setCurrentSupplier({ ...currentSupplier, ruc: e.target.value })}
                                            placeholder="20123456789"
                                            required
                                        />
                                    </div>
                                    <div className="space-y-2">
                                        <label className="text-[10px] font-black uppercase tracking-widest text-gray-400 ml-1">Teléfono</label>
                                        <input
                                            type="text"
                                            className="input"
                                            value={currentSupplier.telefono}
                                            onChange={(e) => setCurrentSupplier({ ...currentSupplier, telefono: e.target.value })}
                                            placeholder="987 654 321"
                                        />
                                    </div>
                                    <div className="space-y-2">
                                        <label className="text-[10px] font-black uppercase tracking-widest text-gray-400 ml-1">Nombre de Contacto</label>
                                        <input
                                            type="text"
                                            className="input"
                                            value={currentSupplier.contacto}
                                            onChange={(e) => setCurrentSupplier({ ...currentSupplier, contacto: e.target.value })}
                                            placeholder="Ejem: Carlos Pérez"
                                        />
                                    </div>
                                    <div className="md:col-span-1 space-y-2">
                                        <label className="text-[10px] font-black uppercase tracking-widest text-gray-400 ml-1">Dirección</label>
                                        <div className="relative">
                                            <MapPin className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
                                            <input
                                                type="text"
                                                className="input pl-12"
                                                value={currentSupplier.direccion}
                                                onChange={(e) => setCurrentSupplier({ ...currentSupplier, direccion: e.target.value })}
                                                placeholder="Av. Las Flores 456"
                                            />
                                        </div>
                                    </div>
                                </div>

                                <div className="flex gap-4 pt-6">
                                    <button type="button" onClick={() => setShowModal(false)} className="flex-1 btn btn-secondary px-8 py-4 rounded-2xl font-black uppercase tracking-widest">Cancelar</button>
                                    <button type="submit" className="flex-1 btn btn-primary flex items-center justify-center gap-2 px-8 py-4 rounded-2xl font-black uppercase tracking-widest shadow-lg shadow-brand-500/30">
                                        <Save size={18} /> Guardar Proveedor
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

export default Suppliers;
