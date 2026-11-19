import React, { useCallback, useEffect, useState } from 'react';
import { Plus, Edit2, Power, Warehouse } from 'lucide-react';
import { Modal, Field, ErrorBox } from './billingShared';
import { readJson } from './billingUtils';

const VACIO = { id: null, descripcion: '', almacen_id: '', activo: true };

/**
 * R-02: mantenimiento de cajas de la sede. Cada caja se asocia a un almacen: las ventas registradas en ella
 * descuentan stock de ese almacen (sin almacen, del almacen de ventas por defecto de la sede).
 */
const CajasAdminModal = ({ sedeNombre, onClose, onChanged }) => {
    const [cajas, setCajas] = useState([]);
    const [almacenes, setAlmacenes] = useState([]);
    const [form, setForm] = useState(null);
    const [error, setError] = useState('');
    const [saving, setSaving] = useState(false);

    const cargar = useCallback(async () => {
        try {
            const [lista, alm] = await Promise.all([
                readJson(await fetch('/api/cajas?todas=1'), 'No se pudo cargar las cajas.'),
                readJson(await fetch('/api/almacenes'), 'No se pudo cargar los almacenes.')
            ]);
            setCajas(Array.isArray(lista) ? lista : []);
            setAlmacenes((Array.isArray(alm) ? alm : []).filter((a) => Number(a.activo)));
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
                body: JSON.stringify({ descripcion: datos.descripcion, almacen_id: datos.almacen_id ? Number(datos.almacen_id) : null, activo: datos.activo })
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

    const alternar = (caja) => guardar(null, { id: caja.id, descripcion: caja.descripcion, almacen_id: caja.almacen_id || '', activo: !Number(caja.activo) });

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
                        <table className="w-full min-w-[560px] text-sm">
                            <thead>
                                <tr className="text-left text-xs uppercase text-gray-500 border-b">
                                    <th className="py-2 pr-3">Caja</th>
                                    <th className="py-2 pr-3">Almacén</th>
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
                                        <td className="py-3 pr-3">
                                            {!Number(c.activo)
                                                ? <span className="text-xs font-bold text-gray-500">Inactiva</span>
                                                : c.sesion_abierta_id
                                                    ? <span className="text-xs font-bold text-emerald-600">Abierta (sesión #{c.sesion_abierta_id})</span>
                                                    : <span className="text-xs font-bold text-gray-600">Cerrada</span>}
                                        </td>
                                        <td className="py-3 text-right whitespace-nowrap">
                                            <button className="p-2 text-gray-500 hover:text-brand-600" title="Editar" aria-label={`Editar ${c.descripcion}`}
                                                onClick={() => setForm({ id: c.id, descripcion: c.descripcion, almacen_id: c.almacen_id ? String(c.almacen_id) : '', activo: Boolean(Number(c.activo)) })}><Edit2 size={16} /></button>
                                            <button className="p-2 text-gray-500 hover:text-brand-600" title={Number(c.activo) ? 'Desactivar' : 'Activar'} aria-label={`${Number(c.activo) ? 'Desactivar' : 'Activar'} ${c.descripcion}`}
                                                disabled={saving} onClick={() => alternar(c)}><Power size={16} /></button>
                                        </td>
                                    </tr>
                                ))}
                                {cajas.length === 0 && <tr><td colSpan={4} className="py-8 text-center text-gray-500">No hay cajas en esta sede.</td></tr>}
                            </tbody>
                        </table>
                    </div>
                </>
            )}
        </Modal>
    );
};

export default CajasAdminModal;
