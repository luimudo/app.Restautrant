import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ShieldCheck, Plus, Save, Edit2, Trash2, Building2, Building, Lock } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { Modal, Field, ErrorBox } from '../components/billing/billingShared';
import { readJson } from '../components/billing/billingUtils';

const BASE_LABEL = {
    administrador: 'Administrador (todas las operaciones del módulo)',
    mozo: 'Mozo (atención de mesas y delivery)',
    caja: 'Caja (cobros y comprobantes)',
    cocina: 'Cocina (comandas y bar)'
};
const EMPTY_PERFIL = { codigo: '', nombre: '', descripcion: '', base: 'administrador', alcance: 'sede', copiar_de: '' };

const jsonRequest = (method, body) => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const sameSet = (a, b) => a.size === b.size && [...a].every((item) => b.has(item));

const Permisos = () => {
    const { isSystemSuperadmin, refreshUser } = useAuth();
    const [data, setData] = useState({ modulos: [], bases: [], perfiles: [], editable: true });
    const [draft, setDraft] = useState({});
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');
    const [message, setMessage] = useState('');
    const [perfilForm, setPerfilForm] = useState(null); // { ...perfil, nuevo }

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const body = await readJson(await fetch('/api/permisos'), 'No se pudo cargar los permisos.');
            setData(body);
            setDraft(Object.fromEntries(body.perfiles.map((p) => [p.codigo, new Set(p.modulos)])));
            setError('');
        } catch (e) {
            setError(e.message);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { load(); }, [load]);

    const cambios = useMemo(() => data.perfiles.filter((p) => draft[p.codigo] && !sameSet(draft[p.codigo], new Set(p.modulos))), [data, draft]);

    const toggle = (codigo, modulo) => {
        setDraft((prev) => {
            const next = new Set(prev[codigo]);
            if (next.has(modulo)) next.delete(modulo); else next.add(modulo);
            return { ...prev, [codigo]: next };
        });
        setMessage('');
    };

    const guardarCambios = async () => {
        setSaving(true);
        setError('');
        setMessage('');
        try {
            for (const perfil of cambios) {
                await readJson(
                    await fetch(`/api/permisos/perfiles/${perfil.codigo}`, jsonRequest('PUT', { modulos: [...draft[perfil.codigo]] })),
                    `No se pudo guardar el perfil ${perfil.nombre}.`
                );
            }
            setMessage(`Permisos guardados (${cambios.length} ${cambios.length === 1 ? 'perfil' : 'perfiles'}). Los usuarios los ven al volver a cargar la pantalla.`);
            await load();
            await refreshUser();
        } catch (e) {
            setError(e.message);
            await load();
        } finally {
            setSaving(false);
        }
    };

    const guardarPerfil = async (event) => {
        event.preventDefault();
        setError('');
        try {
            if (perfilForm.nuevo) {
                await readJson(await fetch('/api/permisos/perfiles', jsonRequest('POST', perfilForm)), 'No se pudo crear el perfil.');
                setMessage(`Perfil ${perfilForm.nombre} creado. Marca sus módulos y guarda.`);
            } else {
                const cuerpo = { nombre: perfilForm.nombre, descripcion: perfilForm.descripcion };
                if (isSystemSuperadmin) { cuerpo.base = perfilForm.base; cuerpo.alcance = perfilForm.alcance; }
                await readJson(await fetch(`/api/permisos/perfiles/${perfilForm.codigo}`, jsonRequest('PUT', cuerpo)), 'No se pudo guardar el perfil.');
                setMessage('Perfil actualizado.');
            }
            setPerfilForm(null);
            await load();
            await refreshUser();
        } catch (e) {
            setError(e.message);
        }
    };

    const eliminarPerfil = async (perfil) => {
        if (!confirm(`¿Eliminar el perfil "${perfil.nombre}"?`)) return;
        try {
            await readJson(await fetch(`/api/permisos/perfiles/${perfil.codigo}`, { method: 'DELETE' }), 'No se pudo eliminar el perfil.');
            setPerfilForm(null);
            setMessage('Perfil eliminado.');
            await load();
        } catch (e) {
            setError(e.message);
        }
    };

    if (loading) return <div className="py-20 text-center font-bold text-gray-500">Cargando permisos...</div>;

    return (
        <div className="space-y-8 animate-fade-in text-[var(--text-primary)]">
            <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
                <div>
                    <h2 className="text-4xl font-display font-black tracking-tight uppercase leading-none">
                        Perfiles y <span className="text-brand-600">permisos</span>
                    </h2>
                    <p className="text-[var(--text-secondary)] mt-1.5 font-medium">
                        Marca a qué módulos entra cada perfil. Al crear un usuario con ese perfil, solo verá y podrá operar esos módulos.
                    </p>
                </div>
                <div className="flex gap-3">
                    <button className="btn btn-secondary" onClick={() => setPerfilForm({ ...EMPTY_PERFIL, nuevo: true })} disabled={!data.editable}>
                        <Plus size={18} /> Nuevo perfil
                    </button>
                    <button className="btn btn-primary" onClick={guardarCambios} disabled={saving || cambios.length === 0}>
                        <Save size={18} /> {saving ? 'Guardando...' : `Guardar cambios${cambios.length ? ` (${cambios.length})` : ''}`}
                    </button>
                </div>
            </div>

            <ErrorBox text={error} />
            {message && <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-700 text-sm font-semibold">{message}</div>}
            {!data.editable && (
                <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-amber-800 text-sm font-semibold">
                    Las tablas de permisos aún no están disponibles en la base de datos: reinicia la aplicación. Mientras tanto se muestran los valores por defecto y no se pueden editar.
                </div>
            )}

            <div className="card p-0 overflow-x-auto">
                <table className="w-full text-sm min-w-[720px]">
                    <thead>
                        <tr className="bg-gray-50 border-b border-gray-100">
                            <th className="text-left px-5 py-4 text-[10px] font-black uppercase tracking-widest text-gray-500 sticky left-0 bg-gray-50">Módulo</th>
                            {data.perfiles.map((perfil) => (
                                <th key={perfil.codigo} className="px-3 py-4 text-center align-top min-w-[120px]">
                                    <div className="flex flex-col items-center gap-1">
                                        <span className="font-black text-gray-900 normal-case text-sm">{perfil.nombre}</span>
                                        <span className={`inline-flex items-center gap-1 text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full border ${perfil.alcance === 'multisede' ? 'bg-violet-50 text-violet-700 border-violet-200' : 'bg-gray-100 text-gray-600 border-gray-200'}`}>
                                            {perfil.alcance === 'multisede' ? <Building2 size={10} /> : <Building size={10} />}
                                            {perfil.alcance === 'multisede' ? 'Multisede' : 'Una sede'}
                                        </span>
                                        <span className="text-[10px] text-gray-400">{perfil.usuarios} {perfil.usuarios === 1 ? 'usuario' : 'usuarios'}</span>
                                        <button
                                            className="text-[11px] font-bold text-brand-600 hover:underline flex items-center gap-1 disabled:opacity-40"
                                            onClick={() => setPerfilForm({ ...perfil, copiar_de: '', nuevo: false })}
                                            disabled={!data.editable}
                                        >
                                            <Edit2 size={11} /> Editar
                                        </button>
                                    </div>
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                        {data.modulos.map((modulo) => (
                            <tr key={modulo.clave} className="hover:bg-gray-50/60">
                                <td className="px-5 py-3 font-bold text-gray-700 sticky left-0 bg-white">{modulo.nombre}</td>
                                {data.perfiles.map((perfil) => {
                                    const marcado = draft[perfil.codigo]?.has(modulo.clave) || false;
                                    const original = perfil.modulos.includes(modulo.clave);
                                    const bloqueado = !data.editable || (perfil.codigo === 'administrador' && modulo.clave === 'settings');
                                    return (
                                        <td key={perfil.codigo} className={`px-3 py-3 text-center ${marcado !== original ? 'bg-amber-50' : ''}`}>
                                            {bloqueado && perfil.codigo === 'administrador' ? (
                                                <Lock size={14} className="inline text-gray-400" title="El administrador conserva este módulo" />
                                            ) : (
                                                <input
                                                    type="checkbox"
                                                    className="w-5 h-5 accent-brand-600 cursor-pointer"
                                                    checked={marcado}
                                                    disabled={bloqueado}
                                                    onChange={() => toggle(perfil.codigo, modulo.clave)}
                                                    aria-label={`${modulo.nombre} para ${perfil.nombre}`}
                                                />
                                            )}
                                        </td>
                                    );
                                })}
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            <div className="card p-5 text-sm text-gray-600 space-y-2">
                <p className="font-black text-gray-900 flex items-center gap-2"><ShieldCheck size={16} className="text-brand-600" /> Cómo funcionan los permisos</p>
                <p><b>Módulos:</b> el perfil solo ve en el menú los módulos marcados y el sistema rechaza sus operaciones en los demás.</p>
                <p><b>Alcance:</b> los perfiles de <i>una sede</i> solo ven la información de su sede; los <i>multisede</i> (p. ej. Contador) eligen y consultan cualquier sede.</p>
                <p><b>Perfil base:</b> define qué operaciones puede hacer dentro de un módulo. Un módulo que el perfil base no traía de origen se abre con todas sus operaciones.</p>
                <p><b>Super admin:</b> siempre tiene acceso a todo y no aparece aquí.</p>
            </div>

            {perfilForm && (
                <Modal title={perfilForm.nuevo ? 'Nuevo perfil' : `Editar perfil: ${perfilForm.nombre}`} onClose={() => setPerfilForm(null)}>
                    <form onSubmit={guardarPerfil} className="space-y-4">
                        {perfilForm.nuevo && (
                            <Field label="Código (sin espacios)">
                                <input className="input" value={perfilForm.codigo} placeholder="ej. jefe_salon" pattern="[a-z][a-z0-9_]{2,29}"
                                    title="3 a 30 caracteres: minúsculas, números o guion bajo, empezando con letra" required
                                    onChange={(e) => setPerfilForm({ ...perfilForm, codigo: e.target.value.toLowerCase() })} />
                            </Field>
                        )}
                        <Field label="Nombre">
                            <input className="input" value={perfilForm.nombre} maxLength={60} required onChange={(e) => setPerfilForm({ ...perfilForm, nombre: e.target.value })} />
                        </Field>
                        <Field label="Descripción (opcional)">
                            <input className="input" value={perfilForm.descripcion || ''} maxLength={255} onChange={(e) => setPerfilForm({ ...perfilForm, descripcion: e.target.value })} />
                        </Field>
                        {(perfilForm.nuevo || isSystemSuperadmin) && (
                            <>
                                <Field label="Perfil base">
                                    <select className="input" value={perfilForm.base} onChange={(e) => setPerfilForm({ ...perfilForm, base: e.target.value })}>
                                        {data.bases.map((base) => <option key={base} value={base}>{BASE_LABEL[base] || base}</option>)}
                                    </select>
                                </Field>
                                <Field label="Alcance">
                                    <select className="input" value={perfilForm.alcance} onChange={(e) => setPerfilForm({ ...perfilForm, alcance: e.target.value })}
                                        disabled={!isSystemSuperadmin && perfilForm.nuevo}>
                                        <option value="sede">Una sola sede</option>
                                        {(isSystemSuperadmin || perfilForm.alcance === 'multisede') && <option value="multisede">Multisede (todas las sedes)</option>}
                                    </select>
                                </Field>
                            </>
                        )}
                        {perfilForm.nuevo && (
                            <Field label="Copiar módulos de (opcional)">
                                <select className="input" value={perfilForm.copiar_de} onChange={(e) => setPerfilForm({ ...perfilForm, copiar_de: e.target.value })}>
                                    <option value="">Empezar sin módulos</option>
                                    {data.perfiles.map((p) => <option key={p.codigo} value={p.codigo}>{p.nombre}</option>)}
                                </select>
                            </Field>
                        )}
                        {!perfilForm.nuevo && !isSystemSuperadmin && (
                            <p className="text-xs text-gray-500">El alcance y el perfil base solo los cambia el super administrador.</p>
                        )}
                        <div className="flex gap-3 pt-2">
                            {!perfilForm.nuevo && !perfilForm.sistema && (
                                <button type="button" className="btn bg-rose-600 hover:bg-rose-700 text-white" onClick={() => eliminarPerfil(perfilForm)}>
                                    <Trash2 size={16} /> Eliminar
                                </button>
                            )}
                            <button type="button" className="btn btn-secondary flex-1" onClick={() => setPerfilForm(null)}>Cancelar</button>
                            <button type="submit" className="btn btn-primary flex-1">Guardar</button>
                        </div>
                    </form>
                </Modal>
            )}
        </div>
    );
};

export default Permisos;
