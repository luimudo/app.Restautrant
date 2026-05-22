import React, { useEffect, useMemo, useState } from 'react';
import { UserCog, Shield, Plus, Edit2, Trash2, Hash, Layers, Utensils } from 'lucide-react';

const FALLBACK_PROFILES = ['administrador', 'mozo', 'caja', 'cocina'];
const USERS_PAGE_SIZE = 8;

const Settings = () => {
    const [loading, setLoading] = useState(true);
    const [message, setMessage] = useState('');
    const [error, setError] = useState('');

    const [usuarios, setUsuarios] = useState([]);
    const [perfiles, setPerfiles] = useState(FALLBACK_PROFILES);
    const [zonas, setZonas] = useState([]);
    const [mesas, setMesas] = useState([]);
    const [correlativos, setCorrelativos] = useState([]);

    const [showUserModal, setShowUserModal] = useState(false);
    const [showCorrModal, setShowCorrModal] = useState(false);
    const [formUser, setFormUser] = useState({ id: null, nombre: '', email: '', perfil: 'mozo', password: '' });
    const [formCorr, setFormCorr] = useState({ tipo: '', serie: '', siguiente_numero: 1 });
    const [userSearch, setUserSearch] = useState('');
    const [userProfileFilter, setUserProfileFilter] = useState('todos');
    const [userPage, setUserPage] = useState(1);

    const adminCount = useMemo(
        () => usuarios.filter((u) => u.perfil === 'administrador').length,
        [usuarios]
    );

    const filteredUsers = useMemo(() => {
        const search = userSearch.trim().toLowerCase();
        return usuarios.filter((u) => {
            const matchProfile = userProfileFilter === 'todos' || u.perfil === userProfileFilter;
            const matchSearch = search.length === 0
                || String(u.nombre || '').toLowerCase().includes(search)
                || String(u.email || '').toLowerCase().includes(search);
            return matchProfile && matchSearch;
        });
    }, [usuarios, userSearch, userProfileFilter]);

    const totalUserPages = useMemo(
        () => Math.max(1, Math.ceil(filteredUsers.length / USERS_PAGE_SIZE)),
        [filteredUsers.length]
    );

    const paginatedUsers = useMemo(() => {
        const start = (userPage - 1) * USERS_PAGE_SIZE;
        return filteredUsers.slice(start, start + USERS_PAGE_SIZE);
    }, [filteredUsers, userPage]);

    useEffect(() => {
        fetchAll();
    }, []);

    useEffect(() => {
        setUserPage(1);
    }, [userSearch, userProfileFilter]);

    useEffect(() => {
        if (userPage > totalUserPages) {
            setUserPage(totalUserPages);
        }
    }, [userPage, totalUserPages]);

    const safeFetchJson = async (url, fallback) => {
        try {
            const res = await fetch(url);
            if (!res.ok) return fallback;
            return await res.json();
        } catch (_error) {
            return fallback;
        }
    };

    const fetchAll = async () => {
        setLoading(true);
        setError('');
        try {
            const [users, profiles, zones, tables, corrs] = await Promise.all([
                safeFetchJson('http://localhost:3000/api/usuarios', []),
                safeFetchJson('http://localhost:3000/api/perfiles', FALLBACK_PROFILES),
                safeFetchJson('http://localhost:3000/api/zonas', []),
                safeFetchJson('http://localhost:3000/api/mesas', []),
                safeFetchJson('http://localhost:3000/api/correlativos', [])
            ]);
            setUsuarios(Array.isArray(users) ? users : []);
            setPerfiles(Array.isArray(profiles) && profiles.length > 0 ? profiles : FALLBACK_PROFILES);
            setZonas(Array.isArray(zones) ? zones : []);
            setMesas(Array.isArray(tables) ? tables : []);
            setCorrelativos(Array.isArray(corrs) ? corrs : []);
        } catch (e) {
            setError('No se pudo cargar configuracion.');
        } finally {
            setLoading(false);
        }
    };

    const openCreateUser = () => {
        setFormUser({ id: null, nombre: '', email: '', perfil: perfiles[0] || 'mozo', password: '' });
        setShowUserModal(true);
    };

    const openEditUser = (user) => {
        setFormUser({
            id: user.id,
            nombre: user.nombre || '',
            email: user.email || '',
            perfil: user.perfil || 'mozo',
            password: ''
        });
        setShowUserModal(true);
    };

    const saveUser = async (event) => {
        event.preventDefault();
        setError('');
        setMessage('');

        const isEdit = Boolean(formUser.id);
        if (!isEdit && !formUser.password.trim()) {
            setError('La clave es obligatoria para crear usuario.');
            return;
        }

        const payload = {
            nombre: formUser.nombre.trim(),
            email: formUser.email.trim(),
            perfil: formUser.perfil
        };
        if (formUser.password.trim()) payload.password = formUser.password.trim();

        const url = isEdit
            ? `http://localhost:3000/api/usuarios/${formUser.id}`
            : 'http://localhost:3000/api/usuarios';
        const method = isEdit ? 'PUT' : 'POST';

        try {
            const res = await fetch(url, {
                method,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                throw new Error(err.error || 'No se pudo guardar el usuario.');
            }
            setMessage(isEdit ? 'Usuario actualizado.' : 'Usuario creado.');
            setShowUserModal(false);
            fetchAll();
        } catch (e) {
            setError(e.message);
        }
    };

    const deleteUser = async (user) => {
        setError('');
        setMessage('');
        if (user.perfil === 'administrador' && adminCount <= 1) {
            setError('No se puede eliminar el ultimo administrador.');
            return;
        }
        if (!window.confirm(`Eliminar usuario ${user.nombre}?`)) return;
        try {
            const res = await fetch(`http://localhost:3000/api/usuarios/${user.id}`, { method: 'DELETE' });
            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                throw new Error(err.error || 'No se pudo eliminar el usuario.');
            }
            setMessage('Usuario eliminado.');
            fetchAll();
        } catch (e) {
            setError(e.message);
        }
    };

    const openEditCorr = (corr) => {
        setFormCorr({
            tipo: corr.tipo,
            serie: corr.serie,
            siguiente_numero: Number(corr.siguiente_numero) || 1
        });
        setShowCorrModal(true);
    };

    const saveCorr = async (event) => {
        event.preventDefault();
        setError('');
        setMessage('');
        try {
            const res = await fetch(`http://localhost:3000/api/correlativos/${formCorr.tipo}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    serie: formCorr.serie.trim().toUpperCase(),
                    siguiente_numero: Number(formCorr.siguiente_numero) || 1
                })
            });
            if (!res.ok) throw new Error('No se pudo actualizar el correlativo.');
            setMessage('Correlativo actualizado.');
            setShowCorrModal(false);
            fetchAll();
        } catch (e) {
            setError(e.message);
        }
    };

    if (loading) {
        return <div className="p-8 text-center font-bold text-gray-500">Cargando configuracion...</div>;
    }

    return (
        <div className="space-y-8">
            <div>
                <h2 className="text-4xl font-display font-black tracking-tight">Configuracion <span className="text-brand-600">del Sistema</span></h2>
                <p className="text-[var(--text-secondary)] mt-2">Gestion de usuarios y perfiles del restaurante.</p>
            </div>

            {message && <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-700 font-semibold">{message}</div>}
            {error && <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 font-semibold">{error}</div>}

            <div className="card p-6">
                <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-2">
                        <UserCog className="text-brand-600" />
                        <h3 className="text-xl font-black">Usuarios y Perfiles</h3>
                    </div>
                    <button className="btn btn-primary text-xs" onClick={openCreateUser}><Plus size={14} /> Nuevo Usuario</button>
                </div>
                <p className="text-xs text-gray-500 mb-4">Perfiles disponibles: {perfiles.join(', ')}</p>
                <div className="grid grid-cols-1 md:grid-cols-[1fr_220px] gap-3 mb-4">
                    <input
                        className="input"
                        placeholder="Buscar por nombre o email..."
                        value={userSearch}
                        onChange={(e) => setUserSearch(e.target.value)}
                    />
                    <select
                        className="input"
                        value={userProfileFilter}
                        onChange={(e) => setUserProfileFilter(e.target.value)}
                    >
                        <option value="todos">Todos los perfiles</option>
                        {perfiles.map((p) => <option key={p} value={p}>{p}</option>)}
                    </select>
                </div>
                <div className="overflow-x-auto">
                    <table className="w-full">
                        <thead>
                            <tr className="text-left text-xs uppercase text-gray-500 border-b">
                                <th className="py-3">Nombre</th>
                                <th className="py-3">Email</th>
                                <th className="py-3">Perfil</th>
                                <th className="py-3">Creado</th>
                                <th className="py-3 text-right">Acciones</th>
                            </tr>
                        </thead>
                        <tbody>
                            {paginatedUsers.map((u) => (
                                <tr key={u.id} className="border-b border-gray-100">
                                    <td className="py-3 font-semibold">{u.nombre}</td>
                                    <td className="py-3">{u.email}</td>
                                    <td className="py-3">
                                        <span className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-brand-50 text-brand-700 text-xs font-bold">
                                            <Shield size={12} />{u.perfil}
                                        </span>
                                    </td>
                                    <td className="py-3 text-sm">{u.creado_en ? new Date(u.creado_en).toLocaleString() : '-'}</td>
                                    <td className="py-3 text-right">
                                        <button className="p-2 text-gray-500 hover:text-brand-600" onClick={() => openEditUser(u)}><Edit2 size={14} /></button>
                                        <button className="p-2 text-gray-500 hover:text-rose-600" onClick={() => deleteUser(u)}><Trash2 size={14} /></button>
                                    </td>
                                </tr>
                            ))}
                            {filteredUsers.length === 0 && (
                                <tr><td colSpan="5" className="py-6 text-center text-gray-500">No hay usuarios para ese filtro.</td></tr>
                            )}
                        </tbody>
                    </table>
                </div>
                <div className="mt-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                    <p className="text-xs text-gray-500 font-semibold">
                        Mostrando {filteredUsers.length === 0 ? 0 : ((userPage - 1) * USERS_PAGE_SIZE) + 1}
                        {' - '}
                        {Math.min(userPage * USERS_PAGE_SIZE, filteredUsers.length)}
                        {' de '}
                        {filteredUsers.length}
                    </p>
                    <div className="flex items-center gap-2">
                        <button
                            type="button"
                            className="btn btn-secondary text-xs px-3 py-2 disabled:opacity-40"
                            onClick={() => setUserPage((prev) => Math.max(1, prev - 1))}
                            disabled={userPage === 1}
                        >
                            Anterior
                        </button>
                        <span className="text-xs font-bold text-gray-500">Pag {userPage}/{totalUserPages}</span>
                        <button
                            type="button"
                            className="btn btn-secondary text-xs px-3 py-2 disabled:opacity-40"
                            onClick={() => setUserPage((prev) => Math.min(totalUserPages, prev + 1))}
                            disabled={userPage === totalUserPages}
                        >
                            Siguiente
                        </button>
                    </div>
                </div>
            </div>

            <div className="card p-6 bg-gray-900 text-white border-none">
                <div className="flex items-center gap-2 mb-4">
                    <Hash className="text-brand-500" />
                    <h3 className="text-xl font-black">Correlativos de Comprobantes</h3>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {correlativos.map((c) => (
                        <div key={c.tipo} className="p-4 rounded-2xl bg-white/5 border border-white/10">
                            <p className="text-xs uppercase text-brand-400 font-black">{c.tipo}</p>
                            <p className="text-xl font-black mt-1">{c.serie}-{String(c.siguiente_numero).padStart(8, '0')}</p>
                            <button className="mt-3 text-xs px-3 py-2 rounded-lg bg-white/10 hover:bg-brand-600" onClick={() => openEditCorr(c)}>Editar</button>
                        </div>
                    ))}
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div className="card p-6">
                    <div className="flex items-center gap-2 mb-3">
                        <Layers className="text-brand-600" />
                        <h3 className="text-lg font-black">Zonas</h3>
                    </div>
                    <div className="space-y-2">
                        {zonas.map((z) => <div key={z.id} className="p-3 rounded-xl bg-gray-50 font-semibold">{z.nombre}</div>)}
                        {zonas.length === 0 && <p className="text-gray-500">No hay zonas.</p>}
                    </div>
                </div>
                <div className="card p-6">
                    <div className="flex items-center gap-2 mb-3">
                        <Utensils className="text-brand-600" />
                        <h3 className="text-lg font-black">Mesas</h3>
                    </div>
                    <div className="space-y-2">
                        {mesas.map((m) => <div key={m.id} className="p-3 rounded-xl bg-gray-50 font-semibold">Mesa {m.numero} - {m.zona_nombre || 'Sin zona'}</div>)}
                        {mesas.length === 0 && <p className="text-gray-500">No hay mesas.</p>}
                    </div>
                </div>
            </div>

            {showUserModal && (
                <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
                    <div className="bg-white rounded-3xl p-8 w-full max-w-md">
                        <h4 className="text-2xl font-black mb-5">{formUser.id ? 'Editar Usuario' : 'Nuevo Usuario'}</h4>
                        <form onSubmit={saveUser} className="space-y-4">
                            <input className="input" placeholder="Nombre" value={formUser.nombre} onChange={(e) => setFormUser({ ...formUser, nombre: e.target.value })} required />
                            <input className="input" type="email" placeholder="Email" value={formUser.email} onChange={(e) => setFormUser({ ...formUser, email: e.target.value })} required />
                            <select className="input" value={formUser.perfil} onChange={(e) => setFormUser({ ...formUser, perfil: e.target.value })}>
                                {perfiles.map((p) => <option key={p} value={p}>{p}</option>)}
                            </select>
                            <input className="input" type="password" placeholder={formUser.id ? 'Nueva clave (opcional)' : 'Clave'} value={formUser.password} onChange={(e) => setFormUser({ ...formUser, password: e.target.value })} required={!formUser.id} />
                            <div className="flex gap-3 pt-2">
                                <button type="button" className="btn btn-secondary flex-1" onClick={() => setShowUserModal(false)}>Cancelar</button>
                                <button type="submit" className="btn btn-primary flex-1">Guardar</button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {showCorrModal && (
                <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
                    <div className="bg-white rounded-3xl p-8 w-full max-w-md">
                        <h4 className="text-2xl font-black mb-5">Editar Correlativo {formCorr.tipo}</h4>
                        <form onSubmit={saveCorr} className="space-y-4">
                            <input className="input" placeholder="Serie" maxLength={4} value={formCorr.serie} onChange={(e) => setFormCorr({ ...formCorr, serie: e.target.value })} required />
                            <input className="input" type="number" min={1} placeholder="Siguiente numero" value={formCorr.siguiente_numero} onChange={(e) => setFormCorr({ ...formCorr, siguiente_numero: Number(e.target.value) || 1 })} required />
                            <div className="flex gap-3 pt-2">
                                <button type="button" className="btn btn-secondary flex-1" onClick={() => setShowCorrModal(false)}>Cancelar</button>
                                <button type="submit" className="btn btn-primary flex-1">Guardar</button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
};

export default Settings;
