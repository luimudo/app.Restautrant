import React, { useState, useEffect } from 'react';
import { Search, Edit, Trash2, UserPlus, Mail, Phone, CreditCard, ChevronRight, X, Download, Power, AlertTriangle } from 'lucide-react';
import { descargarClientes } from '../utils/exportContactos';
import { motion, AnimatePresence } from 'framer-motion';

const FORM_VACIO = { nombre: '', telefono: '', email: '', tipo_documento: '', documento: '', direccion: '' };

const leerError = async (response, porDefecto) => {
    try {
        const data = await response.json();
        return data;
    } catch {
        return { error: porDefecto };
    }
};

const Clients = () => {
    const [clients, setClients] = useState([]);
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');
    const [verInactivos, setVerInactivos] = useState(false);
    const [showModal, setShowModal] = useState(false);
    const [editingId, setEditingId] = useState(null);
    const [saving, setSaving] = useState(false);
    const [formError, setFormError] = useState('');
    const [exporting, setExporting] = useState(false);
    const [formData, setFormData] = useState(FORM_VACIO);
    // Aviso cuando el cliente no se puede eliminar por tener pedidos/comprobantes: { client, mensaje }
    const [bloqueo, setBloqueo] = useState(null);

    useEffect(() => {
        fetchClients();
    }, []);

    const fetchClients = async () => {
        try {
            const response = await fetch('/api/clientes?todos=1');
            const data = await response.json();
            setClients(Array.isArray(data) ? data : []);
        } catch (error) {
            console.error('Error fetching clients:', error);
            setClients([]);
        } finally {
            setLoading(false);
        }
    };

    const abrirNuevo = () => {
        setEditingId(null);
        setFormData(FORM_VACIO);
        setFormError('');
        setShowModal(true);
    };

    const abrirEditar = (client) => {
        setEditingId(client.id);
        setFormData({
            nombre: client.nombre || '',
            telefono: client.telefono || '',
            email: client.email || '',
            tipo_documento: client.tipo_documento || '',
            documento: client.documento || '',
            direccion: client.direccion || ''
        });
        setFormError('');
        setShowModal(true);
    };

    // Consulta RENIEC (DNI) / SUNAT (RUC) para llenar la ficha, como en el sistema de Bebidas.
    const [consultando, setConsultando] = useState(false);
    const [consultaMsg, setConsultaMsg] = useState('');
    const consultarDocumento = async () => {
        const numero = String(formData.documento || '').trim();
        const tipo = formData.tipo_documento || (/^\d{8}$/.test(numero) ? 'DNI' : /^\d{11}$/.test(numero) ? 'RUC' : '');
        setFormError('');
        setConsultaMsg('');
        if (!['DNI', 'RUC'].includes(tipo) || !(tipo === 'DNI' ? /^\d{8}$/ : /^\d{11}$/).test(numero)) {
            setFormError('Para consultar ingrese un DNI de 8 dígitos o un RUC de 11 dígitos.');
            return;
        }
        const existente = clients.find(c => String(c.documento || '') === numero && c.id !== editingId);
        if (existente) {
            setFormError(`Ya existe un cliente con ese documento: ${existente.nombre} (#${existente.id}).`);
            return;
        }
        setConsultando(true);
        try {
            const res = await fetch(`/api/clientes/buscar?doc_tipo=${tipo}&doc_numero=${numero}&guardar=0`);
            const data = await leerError(res, 'No se pudo consultar el documento.');
            if (!res.ok) {
                setFormError(data.error || 'No se pudo consultar el documento.');
                return;
            }
            setFormData(prev => ({ ...prev, tipo_documento: tipo, nombre: data.nombre || prev.nombre, direccion: data.direccion || prev.direccion }));
            setConsultaMsg(data.origen === 'registrado' ? 'Datos tomados de un cliente ya registrado.' : `Datos obtenidos de ${data.origen}. Revise y guarde la ficha.`);
        } catch {
            setFormError('No se pudo consultar el documento. Ingrese los datos manualmente.');
        } finally {
            setConsultando(false);
        }
    };

    const cerrarModal = () => {
        setConsultaMsg('');
        setShowModal(false);
        setEditingId(null);
        setFormData(FORM_VACIO);
        setFormError('');
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        setSaving(true);
        setFormError('');
        try {
            const response = await fetch(editingId ? `/api/clientes/${editingId}` : '/api/clientes', {
                method: editingId ? 'PUT' : 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(formData)
            });
            if (!response.ok) {
                const data = await leerError(response, 'No se pudo guardar el cliente.');
                setFormError(data.error || 'No se pudo guardar el cliente.');
                return;
            }
            await fetchClients();
            cerrarModal();
        } catch (error) {
            console.error('Error saving client:', error);
            setFormError('No se pudo guardar el cliente.');
        } finally {
            setSaving(false);
        }
    };

    const cambiarEstado = async (client, activo) => {
        try {
            const response = await fetch(`/api/clientes/${client.id}/estado`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ activo })
            });
            if (!response.ok) {
                const data = await leerError(response, 'No se pudo cambiar el estado del cliente.');
                alert(data.error || 'No se pudo cambiar el estado del cliente.');
                return;
            }
            setBloqueo(null);
            await fetchClients();
        } catch (error) {
            console.error('Error changing client status:', error);
            alert('No se pudo cambiar el estado del cliente.');
        }
    };

    const eliminar = async (client) => {
        if (!window.confirm(`¿Eliminar al cliente "${client.nombre}"? Esta acción no se puede deshacer.`)) return;
        try {
            const response = await fetch(`/api/clientes/${client.id}`, { method: 'DELETE' });
            if (response.status === 409) {
                const data = await leerError(response, 'El cliente tiene registros asociados. Solo se puede desactivar.');
                setBloqueo({ client, mensaje: data.error || 'El cliente tiene registros asociados. Solo se puede desactivar.' });
                return;
            }
            if (!response.ok) {
                const data = await leerError(response, 'No se pudo eliminar el cliente.');
                alert(data.error || 'No se pudo eliminar el cliente.');
                return;
            }
            await fetchClients();
        } catch (error) {
            console.error('Error deleting client:', error);
            alert('No se pudo eliminar el cliente.');
        }
    };

    const exportarExcel = async () => {
        setExporting(true);
        try {
            await descargarClientes(filteredClients);
        } catch (error) {
            console.error('Error exporting clients:', error);
            alert('No se pudo generar el archivo de clientes.');
        } finally {
            setExporting(false);
        }
    };

    const termino = searchTerm.toLowerCase();
    const filteredClients = clients.filter(client =>
        (verInactivos || Number(client.activo ?? 1) === 1) &&
        (String(client.nombre || '').toLowerCase().includes(termino) ||
            String(client.documento || '').includes(searchTerm))
    );
    const totalInactivos = clients.filter(c => Number(c.activo ?? 1) === 0).length;

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
                <div className="flex flex-wrap items-center gap-3">
                    <button type="button" onClick={exportarExcel} disabled={exporting || filteredClients.length === 0} className="btn btn-secondary flex items-center gap-2">
                        <Download size={18} /> {exporting ? 'Generando...' : 'Excel'}
                    </button>
                    <button
                        onClick={abrirNuevo}
                        className="btn btn-primary"
                    >
                        <UserPlus size={18} /> Nuevo Cliente
                    </button>
                </div>
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
                    <div className="flex flex-wrap items-center gap-3">
                        <label className="flex items-center gap-2 text-xs font-bold text-[var(--text-secondary)] cursor-pointer select-none">
                            <input type="checkbox" checked={verInactivos} onChange={(e) => setVerInactivos(e.target.checked)} />
                            Ver desactivados ({totalInactivos})
                        </label>
                        <div className="flex items-center gap-2 text-xs font-bold text-[var(--text-muted)] uppercase tracking-wider bg-gray-50 px-4 py-2 rounded-xl border border-gray-100">
                            Total: <span className="text-brand-600">{filteredClients.length}</span> Clientes
                        </div>
                    </div>
                </div>

                <div className="rounded-2xl border border-[var(--border-color)] overflow-x-auto">
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
                                filteredClients.map((client, idx) => {
                                    const activo = Number(client.activo ?? 1) === 1;
                                    return (
                                        <motion.tr
                                            initial={{ opacity: 0, y: 10 }}
                                            animate={{ opacity: 1, y: 0 }}
                                            transition={{ delay: Math.min(idx, 20) * 0.03 }}
                                            key={client.id}
                                            className={`hover:bg-brand-50/30 transition-colors group ${activo ? '' : 'opacity-60'}`}
                                        >
                                            <td className="px-6 py-4">
                                                <div className="flex items-center gap-4">
                                                    <div className="w-10 h-10 rounded-xl bg-gray-100 flex items-center justify-center font-bold text-brand-600 border border-gray-200 group-hover:bg-white transition-colors">
                                                        {String(client.nombre || '?').substring(0, 1)}
                                                    </div>
                                                    <div>
                                                        <p className="font-black text-[var(--text-primary)] leading-none">{client.nombre}</p>
                                                        <p className="text-[10px] text-brand-500 mt-1.5 font-bold uppercase tracking-widest">
                                                            ID: #{client.id}
                                                            {!activo && <span className="ml-2 px-2 py-0.5 rounded-md bg-gray-200 text-gray-600">Desactivado</span>}
                                                        </p>
                                                    </div>
                                                </div>
                                            </td>
                                            <td className="px-6 py-4">
                                                <div className="flex items-center justify-center gap-2 px-3 py-1.5 bg-gray-100/50 rounded-xl border border-gray-200/50 w-fit mx-auto">
                                                    <CreditCard size={14} className="text-[var(--text-muted)]" />
                                                    <span className="text-sm font-bold text-[var(--text-secondary)]">
                                                        {client.documento ? `${client.tipo_documento ? client.tipo_documento + ' ' : ''}${client.documento}` : 'No definido'}
                                                    </span>
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
                                                    <button
                                                        type="button"
                                                        title="Editar"
                                                        onClick={() => abrirEditar(client)}
                                                        className="p-2.5 hover:bg-white hover:text-brand-600 hover:shadow-sm rounded-xl transition-all text-[var(--text-muted)] border border-transparent hover:border-brand-100"
                                                    >
                                                        <Edit size={16} />
                                                    </button>
                                                    <button
                                                        type="button"
                                                        title={activo ? 'Desactivar' : 'Activar'}
                                                        onClick={() => cambiarEstado(client, !activo)}
                                                        className={`p-2.5 hover:bg-white hover:shadow-sm rounded-xl transition-all border border-transparent ${activo ? 'text-[var(--text-muted)] hover:text-amber-600 hover:border-amber-100' : 'text-green-600 hover:border-green-100'}`}
                                                    >
                                                        <Power size={16} />
                                                    </button>
                                                    <button
                                                        type="button"
                                                        title="Eliminar"
                                                        onClick={() => eliminar(client)}
                                                        className="p-2.5 hover:bg-white hover:text-red-600 hover:shadow-sm rounded-xl transition-all text-[var(--text-muted)] border border-transparent hover:border-red-100"
                                                    >
                                                        <Trash2 size={16} />
                                                    </button>
                                                </div>
                                            </td>
                                        </motion.tr>
                                    );
                                })
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* Modal Nuevo / Editar Cliente */}
            <AnimatePresence>
                {showModal && (
                    <div className="fixed inset-0 bg-brand-950/20 flex items-center justify-center p-4 backdrop-blur-md z-50">
                        <motion.div
                            initial={{ opacity: 0, scale: 0.9, y: 20 }}
                            animate={{ opacity: 1, scale: 1, y: 0 }}
                            exit={{ opacity: 0, scale: 0.9, y: 20 }}
                            className="card w-full max-w-lg p-0 overflow-hidden shadow-3xl bg-white border-none max-h-[95vh] overflow-y-auto"
                        >
                            <div className="p-6 border-b border-gray-100 flex items-center justify-between bg-brand-50/30">
                                <div className="flex items-center gap-4">
                                    <div className="w-12 h-12 bg-brand-600 rounded-2xl flex items-center justify-center text-white shadow-lg shadow-brand-200">
                                        {editingId ? <Edit size={24} /> : <UserPlus size={24} />}
                                    </div>
                                    <div>
                                        <h3 className="text-xl font-display font-black tracking-tight">{editingId ? 'Editar Cliente' : 'Nuevo Cliente'}</h3>
                                        <p className="text-xs text-brand-600 font-bold uppercase tracking-widest">{editingId ? `Cliente #${editingId}` : 'Información de Registro'}</p>
                                    </div>
                                </div>
                                <button type="button" onClick={cerrarModal} className="p-2 hover:bg-red-50 hover:text-red-500 rounded-xl transition-all text-gray-400">
                                    <X size={24} />
                                </button>
                            </div>

                            <form onSubmit={handleSubmit} className="p-8 space-y-6">
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                    <div className="md:col-span-2">
                                        <label className="block text-[10px] font-black uppercase tracking-[0.2em] text-[var(--text-muted)] mb-2 ml-1">Nombre Completo</label>
                                        <input
                                            type="text"
                                            className="input pl-4"
                                            placeholder="Ej. Juan Pérez"
                                            required
                                            value={formData.nombre}
                                            onChange={e => setFormData({ ...formData, nombre: e.target.value })}
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-[10px] font-black uppercase tracking-[0.2em] text-[var(--text-muted)] mb-2 ml-1">Tipo de Documento</label>
                                        <select
                                            className="input"
                                            value={formData.tipo_documento}
                                            onChange={e => setFormData({ ...formData, tipo_documento: e.target.value })}
                                        >
                                            <option value="">Sin definir</option>
                                            <option value="DNI">DNI</option>
                                            <option value="RUC">RUC</option>
                                            <option value="CE">Carné de extranjería</option>
                                            <option value="PAS">Pasaporte</option>
                                        </select>
                                    </div>
                                    <div>
                                        <label className="block text-[10px] font-black uppercase tracking-[0.2em] text-[var(--text-muted)] mb-2 ml-1">Documento</label>
                                        <div className="flex gap-2">
                                            <input
                                                type="text"
                                                className="input"
                                                placeholder="8 o 11 dígitos"
                                                value={formData.documento}
                                                onChange={e => setFormData({ ...formData, documento: e.target.value.trim() })}
                                                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); consultarDocumento(); } }}
                                            />
                                            <button
                                                type="button"
                                                title="Consultar RENIEC / SUNAT"
                                                onClick={consultarDocumento}
                                                disabled={consultando}
                                                className="btn btn-secondary px-3 shrink-0"
                                            >
                                                {consultando ? <div className="w-4 h-4 border-2 border-brand-200 border-t-brand-600 rounded-full animate-spin"></div> : <Search size={16} />}
                                            </button>
                                        </div>
                                    </div>
                                    {consultaMsg && (
                                        <p className="md:col-span-2 -mt-3 text-xs font-bold text-green-700">{consultaMsg}</p>
                                    )}
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
                                    <div>
                                        <label className="block text-[10px] font-black uppercase tracking-[0.2em] text-[var(--text-muted)] mb-2 ml-1">Email Principal</label>
                                        <input
                                            type="email"
                                            className="input"
                                            placeholder="correo@ejemplo.com"
                                            value={formData.email}
                                            onChange={e => setFormData({ ...formData, email: e.target.value })}
                                        />
                                    </div>
                                    <div className="md:col-span-2">
                                        <label className="block text-[10px] font-black uppercase tracking-[0.2em] text-[var(--text-muted)] mb-2 ml-1">Dirección</label>
                                        <input
                                            type="text"
                                            className="input"
                                            placeholder="Av. / Jr. / Calle..."
                                            value={formData.direccion}
                                            onChange={e => setFormData({ ...formData, direccion: e.target.value })}
                                        />
                                    </div>
                                </div>
                                {formError && (
                                    <p className="text-sm font-bold text-red-600 bg-red-50 border border-red-100 rounded-xl px-4 py-3">{formError}</p>
                                )}
                                <div className="flex gap-4 pt-4">
                                    <button type="button" onClick={cerrarModal} className="flex-1 btn btn-secondary py-4">
                                        Cancelar
                                    </button>
                                    <button type="submit" disabled={saving} className="flex-[2] btn btn-primary py-4 shadow-xl shadow-brand-200 group">
                                        <span>{saving ? 'Guardando...' : editingId ? 'Guardar Cambios' : 'Registrar Cliente'}</span>
                                        <ChevronRight size={18} className="group-hover:translate-x-1 transition-transform" />
                                    </button>
                                </div>
                            </form>
                        </motion.div>
                    </div>
                )}
            </AnimatePresence>

            {/* Aviso: el cliente tiene referencias y solo se puede desactivar */}
            <AnimatePresence>
                {bloqueo && (
                    <div className="fixed inset-0 bg-brand-950/20 flex items-center justify-center p-4 backdrop-blur-md z-50">
                        <motion.div
                            initial={{ opacity: 0, scale: 0.9, y: 20 }}
                            animate={{ opacity: 1, scale: 1, y: 0 }}
                            exit={{ opacity: 0, scale: 0.9, y: 20 }}
                            className="card w-full max-w-md bg-white border-none shadow-3xl"
                        >
                            <div className="flex items-start gap-4">
                                <div className="w-12 h-12 shrink-0 bg-amber-100 rounded-2xl flex items-center justify-center text-amber-600">
                                    <AlertTriangle size={24} />
                                </div>
                                <div>
                                    <h3 className="text-lg font-display font-black tracking-tight">No se puede eliminar</h3>
                                    <p className="text-sm font-bold text-[var(--text-primary)] mt-1">{bloqueo.client.nombre}</p>
                                    <p className="text-sm text-[var(--text-secondary)] mt-2">{bloqueo.mensaje}</p>
                                    <p className="text-xs text-[var(--text-muted)] mt-2">Al desactivarlo deja de aparecer al facturar o registrar deliverys, pero se conserva su historial. Puede reactivarlo cuando quiera.</p>
                                </div>
                            </div>
                            <div className="flex gap-3 pt-6">
                                <button type="button" onClick={() => setBloqueo(null)} className="flex-1 btn btn-secondary">
                                    Cancelar
                                </button>
                                {Number(bloqueo.client.activo ?? 1) === 1 ? (
                                    <button type="button" onClick={() => cambiarEstado(bloqueo.client, false)} className="flex-1 btn btn-primary">
                                        <Power size={16} /> Desactivar
                                    </button>
                                ) : (
                                    <button type="button" onClick={() => setBloqueo(null)} className="flex-1 btn btn-primary">
                                        Entendido
                                    </button>
                                )}
                            </div>
                        </motion.div>
                    </div>
                )}
            </AnimatePresence>
        </div>
    );
};

export default Clients;
