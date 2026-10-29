import React, { useEffect, useState } from 'react';
import { Building2, Plus, Edit2, MapPin, Phone, Users, Utensils, Power } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

const EMPTY_FORM = { id: null, nombre: '', direccion: '', telefono: '' };

const Sedes = () => {
    const { reloadSedes, activeSedeId, selectSede } = useAuth();
    const [sedes, setSedes] = useState([]);
    const [loading, setLoading] = useState(true);
    const [message, setMessage] = useState('');
    const [error, setError] = useState('');
    const [showModal, setShowModal] = useState(false);
    const [form, setForm] = useState(EMPTY_FORM);
    const [saving, setSaving] = useState(false);

    const fetchSedes = async () => {
        setLoading(true);
        try {
            const res = await fetch('/api/sedes');
            if (!res.ok) throw new Error('No se pudo cargar las sedes.');
            const data = await res.json();
            setSedes(Array.isArray(data) ? data : []);
        } catch (e) {
            setError(e.message);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchSedes();
    }, []);

    const refreshAll = async () => {
        await fetchSedes();
        await reloadSedes();
    };

    const openCreate = () => {
        setForm(EMPTY_FORM);
        setShowModal(true);
    };

    const openEdit = (sede) => {
        setForm({
            id: sede.id,
            nombre: sede.nombre || '',
            direccion: sede.direccion || '',
            telefono: sede.telefono || ''
        });
        setShowModal(true);
    };

    const saveSede = async (event) => {
        event.preventDefault();
        setError('');
        setMessage('');
        setSaving(true);

        const isEdit = Boolean(form.id);
        try {
            const res = await fetch(isEdit ? `/api/sedes/${form.id}` : '/api/sedes', {
                method: isEdit ? 'PUT' : 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    nombre: form.nombre.trim(),
                    direccion: form.direccion.trim(),
                    telefono: form.telefono.trim()
                })
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(data.error || 'No se pudo guardar la sede.');

            setMessage(isEdit
                ? 'Sede actualizada.'
                : `Sede "${data.nombre}" creada con su caja, zona y correlativos. Ahora crea sus usuarios en Configuracion.`);
            setShowModal(false);
            await refreshAll();
        } catch (e) {
            setError(e.message);
        } finally {
            setSaving(false);
        }
    };

    const toggleEstado = async (sede) => {
        setError('');
        setMessage('');
        const activar = Number(sede.estado) !== 1;
        if (!activar && !window.confirm(`Desactivar ${sede.nombre}? Sus usuarios no podran iniciar sesion.`)) return;
        try {
            const res = await fetch(`/api/sedes/${sede.id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ estado: activar })
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(data.error || 'No se pudo cambiar el estado.');
            setMessage(activar ? 'Sede activada.' : 'Sede desactivada.');
            await refreshAll();
        } catch (e) {
            setError(e.message);
        }
    };

    if (loading) {
        return <div className="p-8 text-center font-bold text-gray-500">Cargando sedes...</div>;
    }

    return (
        <div className="space-y-8">
            <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
                <div>
                    <h2 className="text-4xl font-display font-black tracking-tight">Gestion de <span className="text-brand-600">Sedes</span></h2>
                    <p className="text-[var(--text-secondary)] mt-2">Locales del restaurante. La carta es compartida; mesas, cajas, ventas y stock son propios de cada sede.</p>
                </div>
                <button className="btn btn-primary text-sm" onClick={openCreate}><Plus size={16} /> Nueva Sede</button>
            </div>

            {message && <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-700 font-semibold">{message}</div>}
            {error && <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 font-semibold">{error}</div>}

            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
                {sedes.map((sede) => {
                    const activa = Number(sede.estado) === 1;
                    const seleccionada = Number(sede.id) === Number(activeSedeId);
                    return (
                        <div key={sede.id} className={`card p-6 ${seleccionada ? 'ring-2 ring-brand-500' : ''} ${activa ? '' : 'opacity-60'}`}>
                            <div className="flex items-start justify-between gap-3 mb-4">
                                <div className="flex items-center gap-3 min-w-0">
                                    <div className="w-11 h-11 rounded-2xl bg-brand-50 border border-brand-100 flex items-center justify-center shrink-0">
                                        <Building2 size={20} className="text-brand-600" />
                                    </div>
                                    <div className="min-w-0">
                                        <h3 className="text-lg font-black truncate">{sede.nombre}</h3>
                                        <span className={`inline-block mt-0.5 px-2 py-0.5 rounded-lg text-[10px] font-black uppercase tracking-widest ${activa ? 'bg-emerald-50 text-emerald-700' : 'bg-gray-100 text-gray-500'}`}>
                                            {activa ? 'Activa' : 'Inactiva'}
                                        </span>
                                    </div>
                                </div>
                                <button className="p-2 text-gray-500 hover:text-brand-600" onClick={() => openEdit(sede)} aria-label={`Editar ${sede.nombre}`}><Edit2 size={16} /></button>
                            </div>

                            <div className="space-y-2 text-sm text-gray-600">
                                <p className="flex items-center gap-2"><MapPin size={14} className="text-gray-400 shrink-0" />{sede.direccion || 'Sin direccion'}</p>
                                <p className="flex items-center gap-2"><Phone size={14} className="text-gray-400 shrink-0" />{sede.telefono || 'Sin telefono'}</p>
                                <div className="flex items-center gap-4 pt-1">
                                    <span className="flex items-center gap-1.5"><Users size={14} className="text-gray-400" />{Number(sede.usuarios) || 0} usuarios</span>
                                    <span className="flex items-center gap-1.5"><Utensils size={14} className="text-gray-400" />{Number(sede.mesas) || 0} mesas</span>
                                </div>
                            </div>

                            <div className="flex gap-2 mt-5">
                                <button
                                    className="btn btn-secondary flex-1 text-xs px-3 py-2"
                                    onClick={() => selectSede(sede.id)}
                                    disabled={seleccionada || !activa}
                                >
                                    {seleccionada ? 'Sede actual' : 'Trabajar en esta sede'}
                                </button>
                                <button
                                    className={`btn text-xs px-3 py-2 ${activa ? 'bg-rose-50 text-rose-700 hover:bg-rose-100' : 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100'}`}
                                    onClick={() => toggleEstado(sede)}
                                    title={activa ? 'Desactivar' : 'Activar'}
                                >
                                    <Power size={14} />
                                </button>
                            </div>
                        </div>
                    );
                })}
                {sedes.length === 0 && (
                    <p className="text-gray-500">No hay sedes registradas.</p>
                )}
            </div>

            {showModal && (
                <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
                    <div className="bg-white rounded-3xl p-8 w-full max-w-md">
                        <h4 className="text-2xl font-black mb-5">{form.id ? 'Editar Sede' : 'Nueva Sede'}</h4>
                        <form onSubmit={saveSede} className="space-y-4">
                            <input className="input" placeholder="Nombre de la sede" value={form.nombre} onChange={(e) => setForm({ ...form, nombre: e.target.value })} required />
                            <input className="input" placeholder="Direccion" value={form.direccion} onChange={(e) => setForm({ ...form, direccion: e.target.value })} />
                            <input className="input" placeholder="Telefono" value={form.telefono} onChange={(e) => setForm({ ...form, telefono: e.target.value })} />
                            {!form.id && (
                                <p className="text-xs text-gray-500">Se crea con una caja, una zona "Salón Principal" y su propia serie de boletas y facturas.</p>
                            )}
                            <div className="flex gap-3 pt-2">
                                <button type="button" className="btn btn-secondary flex-1" onClick={() => setShowModal(false)}>Cancelar</button>
                                <button type="submit" className="btn btn-primary flex-1" disabled={saving}>{saving ? 'Guardando...' : 'Guardar'}</button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
};

export default Sedes;
