import React, { useCallback, useEffect, useState } from 'react';
import { Plus, Edit2, Power, Warehouse, Users } from 'lucide-react';
import { Modal, Field, ErrorBox } from './billingShared';
import { readJson } from './billingUtils';

const VACIO = { id: null, descripcion: '', almacen_id: '', activo: true, usuario_ids: [] };
// Perfiles que operan todas las cajas: no se les asigna una.
const PERFILES_QUE_VEN_TODO = ['administrador', 'contador', 'superadmin'];

/**
 * R-02: mantenimiento de cajas de la sede. Cada caja se asocia a un almacen: las ventas registradas en ella
 * descuentan stock de ese almacen (sin almacen, del almacen de ventas por defecto de la sede).
 * Cada caja tiene sus usuarios (varios, por turno): solo ellos la ven y la operan. El administrador y el contador operan todas.
 */
const CajasAdminModal = ({ sedeNombre, onClose, onChanged }) => {
    const [cajas, setCajas] = useState([]);
    const [almacenes, setAlmacenes] = useState([]);
    const [usuarios, setUsuarios] = useState([]);
    const [form, setForm] = useState(null);
    const [error, setError] = useState('');
    const [saving, setSaving] = useState(false);

    const cargar = useCallback(async () => {
        try {
            const [lista, alm, usu] = await Promise.all([
                readJson(await fetch('/api/cajas?todas=1'), 'No se pudo cargar las cajas.'),
                readJson(await fetch('/api/almacenes'), 'No se pudo cargar los almacenes.'),
                readJson(await fetch('/api/cajas/usuarios-asignables'), 'No se pudo cargar los usuarios.')
            ]);
            setCajas(Array.isArray(lista) ? lista : []);
            setAlmacenes((Array.isArray(alm) ? alm : []).filter((a) => Number(a.activo)));
            setUsuarios((Array.isArray(usu) ? usu : []).filter((u) => !PERFILES_QUE_VEN_TODO.includes(u.perfil)));
            setError('');
        } catch (e) {
            setError(e.message);
        }
    }, []);

    useEffect(() => { cargar(); }, [cargar]);

    const guardar = async (event, datos = form) => {
        event?.preventDefault();
        setSaving(true);
        setError('');
        try {
            await readJson(await fetch(datos.id ? `/api/cajas/${datos.id}` : '/api/cajas', {
                method: datos.id ? 'PUT' : 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    descripcion: datos.descripcion, almacen_id: datos.almacen_id ? Number(datos.almacen_id) : null, activo: datos.activo,
                    ...(Array.isArray(datos.usuario_ids) ? { usuario_ids: datos.usuario_ids.map(Number) } : {})
                })
            }), 'No se pudo guardar la caja.');
            setForm(null);
            await cargar();
            onChanged?.();
        } catch (e) {
            setError(e.message);
        } finally {
            setSaving(false);
        }
    };

    // Activar/desactivar no toca los usuarios asignados (no se envia usuario_ids).
    const alternar = (caja) => guardar(null, { id: caja.id, descripcion: caja.descripcion, almacen_id: caja.almacen_id || '', activo: !Number(caja.activo) });
    const toggleUsuario = (id) => setForm((f) => ({
        ...f, usuario_ids: f.usuario_ids.includes(id) ? f.usuario_ids.filter((x) => x !== id) : [...f.usuario_ids, id]
    }));

    return (
        <Modal title="Cajas de la sede" subtitle={`${sedeNombre || 'Sede actual'}: cada caja abre y cierra por separado y vende desde su almacén.`} wide onClose={onClose}>
            <ErrorBox text={error} />
            {form ? (
                <form onSubmit={guardar} className="space-y-4">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <Field label="Descripción">
                            <input className="input" value={form.descripcion} onChange={(e) => setForm({ ...form, descripcion: e.target.value })} placeholder="Ej. Caja barra" required minLength={3} maxLength={100} autoFocus />
                        </Field>
                        <Field label="Almacén del que descuenta las ventas">
                            <select className="input" value={form.almacen_id} onChange={(e) => setForm({ ...form, almacen_id: e.target.value })}>
                                <option value="">Almacén de ventas por defecto de la sede</option>
                                {almacenes.map((a) => <option key={a.id} value={a.id}>{a.codigo ? `${a.codigo} · ` : ''}{a.nombre}</option>)}
                            </select>
                        </Field>
                    </div>
                    <fieldset>
                        <legend className="text-xs font-bold uppercase tracking-wider text-gray-500 mb-2 flex items-center gap-1.5"><Users size={14} /> Usuarios que operan esta caja (por turno)</legend>
                        <p className="text-xs text-gray-500 mb-2">Solo los usuarios marcados verán y podrán abrir, cerrar y vender en esta caja. El administrador y el contador operan todas las cajas.</p>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-56 overflow-y-auto">
                            {usuarios.map((u) => (
                                <label key={u.id} className={`flex items-center gap-2 px-3 py-2 rounded-xl border text-sm cursor-pointer ${form.usuario_ids.includes(u.id) ? 'bg-brand-50 border-brand-300' : 'bg-white border-gray-200'}`}>
                                    <input type="checkbox" className="w-4 h-4 accent-brand-600" checked={form.usuario_ids.includes(u.id)} onChange={() => toggleUsuario(u.id)} />
                                    <span className="font-bold">{u.nombre}</span><span className="text-xs text-gray-500">{u.usuario} · {u.perfil}</span>
                                </label>
                            ))}
                            {usuarios.length === 0 && <p className="text-sm text-gray-500">No hay otros usuarios en la sede.</p>}
                        </div>
                    </fieldset>
                    <label className="flex items-center gap-2 text-sm font-bold text-gray-600">
                        <input type="checkbox" className="w-4 h-4 accent-brand-600" checked={form.activo} onChange={(e) => setForm({ ...form, activo: e.target.checked })} /> Activa
                    </label>
                    <div className="flex gap-3">
                        <button type="button" className="btn btn-secondary flex-1" onClick={() => setForm(null)}>Cancelar</button>
                        <button type="submit" className="btn btn-primary flex-1" disabled={saving}>{saving ? 'Guardando...' : 'Guardar caja'}</button>
                    </div>
                </form>
            ) : (
                <>
                    <div className="flex justify-end mb-3">
                        <button className="btn btn-primary text-sm" onClick={() => setForm({ ...VACIO })}><Plus size={16} /> Nueva caja</button>
                    </div>
                    <div className="overflow-x-auto">
                        <table className="w-full min-w-[720px] text-sm">
                            <thead>
                                <tr className="text-left text-xs uppercase text-gray-500 border-b">
                                    <th className="py-2 pr-3">Caja</th>
                                    <th className="py-2 pr-3">Almacén</th>
                                    <th className="py-2 pr-3">Usuarios</th>
                                    <th className="py-2 pr-3">Estado</th>
                                    <th className="py-2 text-right">Acciones</th>
                                </tr>
                            </thead>
                            <tbody>
                                {cajas.map((c) => (
                                    <tr key={c.id} className={`border-b border-gray-100 ${Number(c.activo) ? '' : 'opacity-60'}`}>
                                        <td className="py-3 pr-3 font-bold">{c.descripcion}</td>
                                        <td className="py-3 pr-3">
                                            <span className="flex items-center gap-1.5"><Warehouse size={14} className="text-gray-400" />{c.almacen_nombre || <span className="text-gray-400">Por defecto de la sede</span>}</span>
                                        </td>
                                        <td className="py-3 pr-3 text-xs">
                                            {(c.usuarios || []).length > 0
                                                ? c.usuarios.map((u) => u.nombre).join(', ')
                                                : <span className="text-amber-600 font-bold">Sin usuarios: solo administrador y contador</span>}
                                        </td>
                                        <td className="py-3 pr-3">
                                            {!Number(c.activo)
                                                ? <span className="text-xs font-bold text-gray-500">Inactiva</span>
                                                : c.sesion_abierta_id
                                                    ? <span className="text-xs font-bold text-emerald-600">Abierta (sesión #{c.sesion_abierta_id})</span>
                                                    : <span className="text-xs font-bold text-gray-600">Cerrada</span>}
                                        </td>
                                        <td className="py-3 text-right whitespace-nowrap">
                                            <button className="p-2 text-gray-500 hover:text-brand-600" title="Editar" aria-label={`Editar ${c.descripcion}`}
                                                onClick={() => setForm({ id: c.id, descripcion: c.descripcion, almacen_id: c.almacen_id ? String(c.almacen_id) : '', activo: Boolean(Number(c.activo)), usuario_ids: (c.usuarios || []).map((u) => u.id) })}><Edit2 size={16} /></button>
                                            <button className="p-2 text-gray-500 hover:text-brand-600" title={Number(c.activo) ? 'Desactivar' : 'Activar'} aria-label={`${Number(c.activo) ? 'Desactivar' : 'Activar'} ${c.descripcion}`}
                                                disabled={saving} onClick={() => alternar(c)}><Power size={16} /></button>
                                        </td>
                                    </tr>
                                ))}
                                {cajas.length === 0 && <tr><td colSpan={5} className="py-8 text-center text-gray-500">No hay cajas en esta sede.</td></tr>}
                            </tbody>
                        </table>
                    </div>
                </>
            )}
        </Modal>
    );
};

export default CajasAdminModal;
