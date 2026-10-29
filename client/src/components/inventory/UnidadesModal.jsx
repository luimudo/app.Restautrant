import React, { useEffect, useState } from 'react';
import { Plus, Edit2, Trash2, Check, X, ArrowRight } from 'lucide-react';
import { Modal, Field, ErrorBox } from '../billing/billingShared';
import { readJson } from '../billing/billingUtils';

const JSON_HEADERS = { 'Content-Type': 'application/json' };
const UNIDAD_VACIA = { nombre: '', abreviatura: '', codigo_sunat: 'NIU', permite_decimales: true };

/** Create, edit, deactivate and delete units of measure, and define the conversions between them. */
const UnidadesModal = ({ unidades, conversiones, onClose, onChanged }) => {
    const [vista, setVista] = useState('unidades'); // 'unidades' | 'conversiones'
    const [form, setForm] = useState(UNIDAD_VACIA);
    const [editandoId, setEditandoId] = useState(null);
    const [conv, setConv] = useState({ unidad_origen_id: '', unidad_destino_id: '', factor: '' });
    const [error, setError] = useState('');
    const [busy, setBusy] = useState(false);
    const [codigos, setCodigos] = useState([]); // SUNAT catalog 03 codes the server accepts

    useEffect(() => {
        fetch('/api/unidades-codigos-sunat').then((r) => (r.ok ? r.json() : [])).then((rows) => setCodigos(Array.isArray(rows) ? rows : [])).catch(() => {});
    }, []);

    const activas = unidades.filter((u) => Number(u.activo));

    const ejecutar = async (accion) => {
        setBusy(true);
        setError('');
        try {
            await accion();
            await onChanged();
        } catch (e) {
            setError(e.message);
        } finally {
            setBusy(false);
        }
    };

    const guardarUnidad = (event) => {
        event.preventDefault();
        ejecutar(async () => {
            const actual = unidades.find((u) => u.id === editandoId);
            await readJson(await fetch(editandoId ? `/api/unidades-medida/${editandoId}` : '/api/unidades-medida', {
                method: editandoId ? 'PUT' : 'POST', headers: JSON_HEADERS,
                body: JSON.stringify({ ...form, activo: actual ? Number(actual.activo) === 1 : true })
            }), 'No se pudo guardar la unidad.');
            setForm(UNIDAD_VACIA);
            setEditandoId(null);
        });
    };

    const editar = (u) => {
        setEditandoId(u.id);
        setForm({ nombre: u.nombre, abreviatura: u.abreviatura, codigo_sunat: u.codigo_sunat, permite_decimales: Number(u.permite_decimales) === 1 });
    };

    const cambiarActivo = (u) => ejecutar(async () => {
        await readJson(await fetch(`/api/unidades-medida/${u.id}`, {
            method: 'PUT', headers: JSON_HEADERS,
            body: JSON.stringify({ nombre: u.nombre, abreviatura: u.abreviatura, codigo_sunat: u.codigo_sunat, permite_decimales: Number(u.permite_decimales) === 1, activo: Number(u.activo) !== 1 })
        }), 'No se pudo actualizar la unidad.');
    });

    const eliminar = (u) => {
        if (!window.confirm(`¿Eliminar la unidad "${u.nombre}"?`)) return;
        ejecutar(async () => { await readJson(await fetch(`/api/unidades-medida/${u.id}`, { method: 'DELETE' }), 'No se pudo eliminar la unidad.'); });
    };

    const guardarConversion = (event) => {
        event.preventDefault();
        ejecutar(async () => {
            await readJson(await fetch('/api/unidades-conversiones', {
                method: 'POST', headers: JSON_HEADERS,
                body: JSON.stringify({ unidad_origen_id: Number(conv.unidad_origen_id), unidad_destino_id: Number(conv.unidad_destino_id), factor: Number(conv.factor) })
            }), 'No se pudo guardar la conversión.');
            setConv({ unidad_origen_id: '', unidad_destino_id: '', factor: '' });
        });
    };

    const eliminarConversion = (c) => ejecutar(async () => {
        await readJson(await fetch(`/api/unidades-conversiones/${c.id}`, { method: 'DELETE' }), 'No se pudo eliminar la conversión.');
    });

    const origen = unidades.find((u) => String(u.id) === String(conv.unidad_origen_id));
    const destino = unidades.find((u) => String(u.id) === String(conv.unidad_destino_id));

    return (
        <Modal title="Unidades de medida" subtitle="Catálogo compartido entre sedes. El código SUNAT es el que se envía en comprobantes y guías." wide onClose={onClose}>
            <ErrorBox text={error} />
            <div className="grid grid-cols-2 gap-2 p-1 bg-gray-50 rounded-2xl border border-gray-100 mb-5">
                {[['unidades', 'Unidades'], ['conversiones', 'Conversiones']].map(([valor, etiqueta]) => (
                    <button key={valor} type="button" onClick={() => { setVista(valor); setError(''); }} aria-pressed={vista === valor}
                        className={`py-2 rounded-xl text-sm font-bold ${vista === valor ? 'bg-white shadow text-brand-600' : 'text-gray-500'}`}>{etiqueta}</button>
                ))}
            </div>

            {vista === 'unidades' ? (
                <>
                    <form onSubmit={guardarUnidad} className="grid grid-cols-2 sm:grid-cols-6 gap-3 mb-4 items-end">
                        <Field label="Nombre" className="col-span-2"><input className="input" value={form.nombre} onChange={(e) => setForm({ ...form, nombre: e.target.value })} maxLength={60} required placeholder="Ej. Caja" /></Field>
                        <Field label="Abrev."><input className="input" value={form.abreviatura} onChange={(e) => setForm({ ...form, abreviatura: e.target.value })} maxLength={20} required placeholder="Cja" /></Field>
                        <Field label="Cód. SUNAT">
                            <select className="input" value={form.codigo_sunat} onChange={(e) => setForm({ ...form, codigo_sunat: e.target.value })} required>
                                {!codigos.some((c) => c.codigo === form.codigo_sunat) && <option value={form.codigo_sunat}>{form.codigo_sunat}</option>}
                                {codigos.map((c) => <option key={c.codigo} value={c.codigo}>{c.codigo} · {c.nombre}</option>)}
                            </select>
                        </Field>
                        <label className="flex items-center gap-2 text-sm font-semibold text-gray-600 pb-3">
                            <input type="checkbox" checked={form.permite_decimales} onChange={(e) => setForm({ ...form, permite_decimales: e.target.checked })} /> Decimales
                        </label>
                        <div className="flex gap-2 pb-0.5">
                            <button type="submit" className="btn btn-primary flex-1 flex items-center justify-center gap-1.5" disabled={busy}>
                                {editandoId ? <Check size={16} /> : <Plus size={16} />} {editandoId ? 'Guardar' : 'Agregar'}
                            </button>
                            {editandoId && <button type="button" className="btn btn-secondary" onClick={() => { setEditandoId(null); setForm(UNIDAD_VACIA); }} aria-label="Cancelar edición"><X size={16} /></button>}
                        </div>
                    </form>
                    <div className="space-y-2 max-h-[42vh] overflow-y-auto pr-1">
                        {unidades.map((u) => (
                            <div key={u.id} className={`flex items-center gap-3 p-3 rounded-2xl border border-gray-100 ${Number(u.activo) ? '' : 'opacity-50'}`}>
                                <div className="flex-1 min-w-0">
                                    <p className="font-bold truncate">{u.nombre} <span className="text-gray-400 font-semibold">({u.abreviatura})</span></p>
                                    <p className="text-xs text-gray-500">SUNAT {u.codigo_sunat} · {Number(u.permite_decimales) ? 'admite decimales' : 'solo enteros'} · {u.insumos} insumo(s), {u.productos} producto(s)</p>
                                </div>
                                <button type="button" className="text-xs font-bold text-gray-500 hover:text-brand-600 px-2" onClick={() => cambiarActivo(u)} disabled={busy}>{Number(u.activo) ? 'Desactivar' : 'Activar'}</button>
                                <button type="button" className="p-2 text-gray-400 hover:text-brand-600 hover:bg-brand-50 rounded-xl" onClick={() => editar(u)} aria-label={`Editar ${u.nombre}`}><Edit2 size={16} /></button>
                                <button type="button" className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-xl disabled:opacity-30" onClick={() => eliminar(u)} disabled={busy || u.insumos + u.productos > 0}
                                    title={u.insumos + u.productos > 0 ? 'Está en uso: desactívala en lugar de eliminarla' : 'Eliminar'} aria-label={`Eliminar ${u.nombre}`}><Trash2 size={16} /></button>
                            </div>
                        ))}
                    </div>
                </>
            ) : (
                <>
                    <p className="text-sm text-gray-500 mb-3">Permite comprar o mover un insumo en otra unidad (p. ej. una caja de 12 kg) y que el stock se registre en la unidad del insumo.</p>
                    <form onSubmit={guardarConversion} className="grid grid-cols-2 sm:grid-cols-7 gap-3 items-end mb-4">
                        <Field label="1 unidad de" className="sm:col-span-2">
                            <select className="input" value={conv.unidad_origen_id} onChange={(e) => setConv({ ...conv, unidad_origen_id: e.target.value })} required>
                                <option value="">Origen...</option>
                                {activas.map((u) => <option key={u.id} value={u.id}>{u.nombre}</option>)}
                            </select>
                        </Field>
                        <Field label="equivale a" className="sm:col-span-1"><input type="number" min="0.000001" step="any" className="input font-mono" value={conv.factor} onChange={(e) => setConv({ ...conv, factor: e.target.value })} required /></Field>
                        <Field label="de" className="sm:col-span-2">
                            <select className="input" value={conv.unidad_destino_id} onChange={(e) => setConv({ ...conv, unidad_destino_id: e.target.value })} required>
                                <option value="">Destino...</option>
                                {activas.filter((u) => String(u.id) !== String(conv.unidad_origen_id)).map((u) => <option key={u.id} value={u.id}>{u.nombre}</option>)}
                            </select>
                        </Field>
                        <button type="submit" className="btn btn-primary flex items-center justify-center gap-1.5 sm:col-span-2" disabled={busy}><Plus size={16} /> Guardar</button>
                    </form>
                    {origen && destino && conv.factor && <p className="text-xs text-gray-500 mb-3">1 {origen.nombre} = {conv.factor} {destino.nombre} · 1 {destino.nombre} = {Number((1 / Number(conv.factor)).toFixed(6))} {origen.nombre}</p>}
                    <div className="space-y-2 max-h-[38vh] overflow-y-auto pr-1">
                        {conversiones.map((c) => (
                            <div key={c.id} className="flex items-center gap-3 p-3 rounded-2xl border border-gray-100">
                                <p className="flex-1 font-semibold flex items-center gap-2 flex-wrap">1 {c.origen} <ArrowRight size={14} className="text-gray-400" /> <span className="font-mono">{c.factor}</span> {c.destino}</p>
                                <button type="button" className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-xl" onClick={() => eliminarConversion(c)} disabled={busy} aria-label={`Eliminar conversión ${c.origen} a ${c.destino}`}><Trash2 size={16} /></button>
                            </div>
                        ))}
                        {conversiones.length === 0 && <p className="py-6 text-center text-sm text-gray-500">Aún no hay conversiones definidas.</p>}
                    </div>
                </>
            )}
            <button type="button" className="btn btn-secondary w-full mt-5" onClick={onClose}>Cerrar</button>
        </Modal>
    );
};

export default UnidadesModal;
