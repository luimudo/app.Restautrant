import React, { useState, useEffect } from 'react';
import { Search, Plus, Edit, Trash2, UserPlus, Mail, Phone, CreditCard, ChevronRight, X } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

const Clients = () => {
    const [clients, setClients] = useState([]);
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');
    const [showModal, setShowModal] = useState(false);
    const [formData, setFormData] = useState({ nombre: '', telefono: '', email: '', documento: '' });

    useEffect(() => {
        fetchClients();
    }, []);

    const fetchClients = async () => {
        try {
            const response = await fetch('http://localhost:3000/api/clientes');
            const data = await response.json();
            setClients(Array.isArray(data) ? data : []);
        } catch (error) {
            console.error('Error fetching clients:', error);
            setClients([]);
        } finally {
            setLoading(false);
        }
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        try {
            const response = await fetch('http://localhost:3000/api/clientes', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(formData)
            });
            if (response.ok) {
                fetchClients();
                setShowModal(false);
                setFormData({ nombre: '', telefono: '', email: '', documento: '' });
            }
        } catch (error) {
            console.error('Error creating client:', error);
        }
    };

    const filteredClients = clients.filter(client =>
        client.nombre.toLowerCase().includes(searchTerm.toLowerCase()) ||
        client.documento.includes(searchTerm)
    );

    return (
        <div className="space-y-10 animate-fade-in">
            {/* Header Section */}
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
                <div>
                    <h2 className="text-4xl font-display font-black tracking-tight leading-none">
                        Gestión de <span className="text-brand-600">Clientes</span>
                    </h2>
                    <p className="text-[var(--text-secondary)] mt-1.5 font-medium">Administra y fideliza tu base de datos de comensales.</p>
                </div>
                <button
                    onClick={() => setShowModal(true)}
                    className="btn btn-primary"
                >
                    <UserPlus size={18} /> Nuevo Cliente
                </button>
            </div>

            {/* Content Card */}
            <div className="card shadow-2xl overflow-hidden relative">
                <div className="absolute top-0 left-0 w-full h-1 bg-brand-600/50"></div>

                <div className="flex flex-col md:flex-row items-center justify-between gap-6 mb-8">
                    <div className="relative w-full md:w-96 group">
                        <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-[var(--text-muted)] group-focus-within:text-brand-500 transition-colors" size={18} />
                        <input
                            type="text"
                            placeholder="Buscar por nombre o DNI..."
                            className="w-full pl-12 pr-4 py-3 bg-[var(--bg-secondary)] border-transparent rounded-2xl text-sm focus:bg-white focus:ring-4 focus:ring-brand-500/10 focus:border-brand-500 transition-all outline-none"
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                        />
                    </div>
                    <div className="flex items-center gap-2 text-xs font-bold text-[var(--text-muted)] uppercase tracking-wider bg-gray-50 px-4 py-2 rounded-xl border border-gray-100">
                        Total: <span className="text-brand-600">{filteredClients.length}</span> Clientes
                    </div>
                </div>

                <div className="table-container rounded-2xl border border-[var(--border-color)]">
                    <table className="w-full border-collapse">
                        <thead>
                            <tr className="bg-gray-50/50">
                                <th className="px-6 py-4 text-xs font-black uppercase tracking-[0.2em] text-[var(--text-muted)] border-b border-[var(--border-color)]">Nombre del Cliente</th>
                                <th className="px-6 py-4 text-xs font-black uppercase tracking-[0.2em] text-[var(--text-muted)] border-b border-[var(--border-color)] text-center">Documento</th>
                                <th className="px-6 py-4 text-xs font-black uppercase tracking-[0.2em] text-[var(--text-muted)] border-b border-[var(--border-color)] text-center">Contacto</th>
                                <th className="px-6 py-4 text-xs font-black uppercase tracking-[0.2em] text-[var(--text-muted)] border-b border-[var(--border-color)] text-center">Acciones</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-[var(--border-color)]">
                            {loading ? (
                                <tr>
                                    <td colSpan="4" className="px-6 py-12 text-center">
                                        <div className="flex flex-col items-center">
                                            <div className="w-8 h-8 border-2 border-brand-200 border-t-brand-600 rounded-full animate-spin mb-3"></div>
                                            <span className="font-bold text-sm text-[var(--text-muted)]">Cargando datos...</span>
                                        </div>
                                    </td>
                                </tr>
                            ) : filteredClients.length === 0 ? (
                                <tr>
                                    <td colSpan="4" className="px-6 py-12 text-center text-[var(--text-muted)] font-medium">
                                        No se encontraron clientes que coincidan con la búsqueda.
                                    </td>
                                </tr>
                            ) : (
                                filteredClients.map((client, idx) => (
                                    <motion.tr
                                        initial={{ opacity: 0, y: 10 }}
                                        animate={{ opacity: 1, y: 0 }}
                                        transition={{ delay: idx * 0.05 }}
                                        key={client.id}
                                        className="hover:bg-brand-50/30 transition-colors group"
                                    >
                                        <td className="px-6 py-4">
                                            <div className="flex items-center gap-4">
                                                <div className="w-10 h-10 rounded-xl bg-gray-100 flex items-center justify-center font-bold text-brand-600 border border-gray-200 group-hover:bg-white transition-colors">
                                                    {client.nombre.substring(0, 1)}
                                                </div>
                                                <div>
                                                    <p className="font-black text-[var(--text-primary)] leading-none">{client.nombre}</p>
                                                    <p className="text-[10px] text-brand-500 mt-1.5 font-bold uppercase tracking-widest">ID: #{client.id}</p>
                                                </div>
                                            </div>
                                        </td>
                                        <td className="px-6 py-4">
                                            <div className="flex items-center justify-center gap-2 px-3 py-1.5 bg-gray-100/50 rounded-xl border border-gray-200/50 w-fit mx-auto">
                                                <CreditCard size={14} className="text-[var(--text-muted)]" />
                                                <span className="text-sm font-bold text-[var(--text-secondary)]">{client.documento || 'No definido'}</span>
                                            </div>
                                        </td>
                                        <td className="px-6 py-4">
                                            <div className="flex flex-col gap-1.5 items-center">
                                                {client.telefono && (
                                                    <div className="flex items-center gap-2 text-xs font-bold text-[var(--text-secondary)]">
                                                        <Phone size={12} className="text-brand-600" /> {client.telefono}
                                                    </div>
                                                )}
                                                {client.email && (
                                                    <div className="flex items-center gap-2 text-xs font-medium text-[var(--text-muted)]">
                                                        <Mail size={12} /> {client.email}
                                                    </div>
                                                )}
                                                {!client.telefono && !client.email && (
                                                    <span className="text-xs text-[var(--text-muted)] font-medium">Sin datos de contacto</span>
                                                )}
                                            </div>
                                        </td>
                                        <td className="px-6 py-4">
                                            <div className="flex items-center justify-center gap-2">
                                                <button className="p-2.5 hover:bg-white hover:text-brand-600 hover:shadow-sm rounded-xl transition-all text-[var(--text-muted)] border border-transparent hover:border-brand-100">
                                                    <Edit size={16} />
                                                </button>
                                                <button className="p-2.5 hover:bg-white hover:text-red-600 hover:shadow-sm rounded-xl transition-all text-[var(--text-muted)] border border-transparent hover:border-red-100">
                                                    <Trash2 size={16} />
                                                </button>
                                                <button className="p-2.5 hover:bg-white hover:text-brand-600 hover:shadow-sm rounded-xl transition-all text-[var(--text-muted)] border border-transparent hover:border-brand-100">
                                                    <ChevronRight size={16} />
                                                </button>
                                            </div>
                                        </td>
                                    </motion.tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* Modal Rediseñado */}
            <AnimatePresence>
                {showModal && (
                    <div className="fixed inset-0 bg-brand-950/20 flex items-center justify-center p-4 backdrop-blur-md z-50">
                        <motion.div
                            initial={{ opacity: 0, scale: 0.9, y: 20 }}
                            animate={{ opacity: 1, scale: 1, y: 0 }}
                            exit={{ opacity: 0, scale: 0.9, y: 20 }}
                            className="card w-full max-w-lg p-0 overflow-hidden shadow-3xl bg-white border-none"
                        >
                            <div className="p-6 border-b border-gray-100 flex items-center justify-between bg-brand-50/30">
                                <div className="flex items-center gap-4">
                                    <div className="w-12 h-12 bg-brand-600 rounded-2xl flex items-center justify-center text-white shadow-lg shadow-brand-200">
                                        <UserPlus size={24} />
                                    </div>
                                    <div>
                                        <h3 className="text-xl font-display font-black tracking-tight">Nuevo Cliente</h3>
                                        <p className="text-xs text-brand-600 font-bold uppercase tracking-widest">Información de Registro</p>
                                    </div>
                                </div>
                                <button onClick={() => setShowModal(false)} className="p-2 hover:bg-red-50 hover:text-red-500 rounded-xl transition-all text-gray-400">
                                    <X size={24} />
                                </button>
                            </div>

                            <form onSubmit={handleSubmit} className="p-8 space-y-6">
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                    <div className="md:col-span-2">
                                        <label className="block text-[10px] font-black uppercase tracking-[0.2em] text-[var(--text-muted)] mb-2 ml-1">Nombre Completo</label>
                                        <div className="relative">
                                            <input
                                                type="text"
                                                className="input pl-4"
                                                placeholder="Ej. Juan Pérez"
                                                required
                                                value={formData.nombre}
                                                onChange={e => setFormData({ ...formData, nombre: e.target.value })}
                                            />
                                        </div>
                                    </div>
                                    <div>
                                        <label className="block text-[10px] font-black uppercase tracking-[0.2em] text-[var(--text-muted)] mb-2 ml-1">Documento (DNI/RUC)</label>
                                        <input
                                            type="text"
                                            className="input"
                                            placeholder="8 o 11 dígitos"
                                            value={formData.documento}
                                            onChange={e => setFormData({ ...formData, documento: e.target.value })}
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-[10px] font-black uppercase tracking-[0.2em] text-[var(--text-muted)] mb-2 ml-1">Teléfono</label>
                                        <div className="flex">
                                            <span className="flex items-center px-3 bg-gray-100 border border-transparent rounded-l-2xl text-xs font-bold text-gray-500">+51</span>
                                            <input
                                                type="tel"
                                                className="input rounded-l-none"
                                                placeholder="999 999 999"
                                                value={formData.telefono}
                                                onChange={e => setFormData({ ...formData, telefono: e.target.value })}
                                            />
                                        </div>
                                    </div>
                                    <div className="md:col-span-2">
                                        <label className="block text-[10px] font-black uppercase tracking-[0.2em] text-[var(--text-muted)] mb-2 ml-1">Email Principal</label>
                                        <input
                                            type="email"
                                            className="input"
                                            placeholder="correo@ejemplo.com"
                                            value={formData.email}
                                            onChange={e => setFormData({ ...formData, email: e.target.value })}
                                        />
                                    </div>
                                </div>
                                <div className="flex gap-4 pt-4">
                                    <button type="button" onClick={() => setShowModal(false)} className="flex-1 btn btn-secondary py-4">
                                        Cancelar
                                    </button>
                                    <button type="submit" className="flex-[2] btn btn-primary py-4 shadow-xl shadow-brand-200 group">
                                        <span>Registrar Cliente</span>
                                        <ChevronRight size={18} className="group-hover:translate-x-1 transition-transform" />
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

export default Clients;
