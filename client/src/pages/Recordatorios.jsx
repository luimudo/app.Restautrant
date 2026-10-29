import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
    BellRing, Plus, Edit2, Trash2, CheckCircle2, RotateCcw, CalendarClock, Power, Repeat, CalendarDays, AlertTriangle, Clock, Wallet
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { Modal, Field, ErrorBox, ToggleGroup } from '../components/billing/billingShared';
import { readJson, money } from '../components/billing/billingUtils';

export const CATEGORIAS = { pago: 'Pago', documento: 'Documento', licencia: 'Licencia', otro: 'Otro' };

const ESTADOS = {
    vencido: ['bg-rose-50 text-rose-700 border-rose-200', 'Vencido'],
    por_vencer: ['bg-amber-50 text-amber-700 border-amber-200', 'Por vencer'],
    al_dia: ['bg-emerald-50 text-emerald-700 border-emerald-200', 'Al día'],
    atendido: ['bg-sky-50 text-sky-700 border-sky-200', null],
    deshabilitado: ['bg-gray-100 text-gray-500 border-gray-200', 'Deshabilitado'],
    sin_fecha: ['bg-gray-100 text-gray-500 border-gray-200', 'Sin fecha']
};

const EMPTY_FORM = { id: null, nombre: '', categoria: 'pago', monto: '', tipo_vencimiento: 'fecha', fecha_vencimiento: '', dia_pago: '', dias_aviso: 7, notas: '' };

const formatFecha = (ymd) => (ymd ? new Date(`${ymd}T00:00:00`).toLocaleDateString('es-PE', { day: '2-digit', month: 'short', year: 'numeric' }) : '-');
const labelAtendido = (r) => (r.categoria === 'pago' ? 'Pagado' : 'Atendido');

const Recordatorios = () => {
    const { activeSede } = useAuth();
    const [data, setData] = useState({ recordatorios: [], resumen: null });
    const [loading, setLoading] = useState(true);
    const [tab, setTab] = useState('todos');
    const [error, setError] = useState('');
    const [message, setMessage] = useState('');
    const [busyId, setBusyId] = useState(null);
    const [form, setForm] = useState(null);
    const [fechaTarget, setFechaTarget] = useState(null);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            setData(await readJson(await fetch('/api/recordatorios'), 'No se pudo cargar los recordatorios.'));
            setError('');
        } catch (e) {
            setError(e.message);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { load(); }, [load]);

    const lista = useMemo(() => (tab === 'todos' ? data.recordatorios : data.recordatorios.filter((r) => r.categoria === tab)), [data, tab]);
    const conteo = (categoria) => data.recordatorios.filter((r) => r.categoria === categoria).length;

    const accion = async (r, ruta, textoOk, options = {}) => {
        setBusyId(r.id);
        setError('');
        setMessage('');
        try {
            await readJson(await fetch(`/api/recordatorios/${r.id}${ruta}`, { method: options.method || 'POST', ...(options.body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(options.body) } : {}) }), 'No se pudo completar la acción.');
            if (textoOk) setMessage(textoOk);
            await load();
        } catch (e) {
            setError(e.message);
        } finally {
            setBusyId(null);
        }
    };

    const eliminar = (r) => {
        if (!window.confirm(`¿Eliminar el recordatorio "${r.nombre}"?`)) return;
        accion(r, '', 'Recordatorio eliminado.', { method: 'DELETE' });
    };

    const badge = (r) => {
        const [style, label] = ESTADOS[r.estado] || ESTADOS.sin_fecha;
        const texto = r.estado === 'atendido' ? labelAtendido(r)
            : r.estado === 'por_vencer' ? `Vence en ${r.dias_restantes}d` : label;
        return <span className={`inline-block px-2 py-1 rounded-lg border text-[10px] font-black uppercase tracking-widest whitespace-nowrap ${style}`}>{texto}</span>;
    };

    const faltan = (r) => {
        if (r.estado === 'deshabilitado' || r.dias_restantes === null) return <span className="text-gray-300">—</span>;
        if (r.estado === 'atendido') {
            return r.tipo_vencimiento === 'periodico'
                ? <span className="text-xs text-gray-500">Próx. en {r.dias_restantes} días</span>
                : <span className="text-gray-300">—</span>;
        }
        if (r.dias_restantes < 0) return <span className="font-bold text-rose-600">Vencido hace {Math.abs(r.dias_restantes)}d</span>;
        if (r.dias_restantes === 0) return <span className="font-bold text-amber-600">Hoy</span>;
        return <span className={r.estado === 'por_vencer' ? 'font-bold text-amber-600' : ''}>{r.dias_restantes} días</span>;
    };

    const resumen = data.resumen;

    return (
        <div className="space-y-8">
            <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
                <div>
                    <h2 className="text-4xl font-display font-black tracking-tight">Recordatorios <span className="text-brand-600">y Vencimientos</span></h2>
                    <p className="text-[var(--text-secondary)] mt-2">Pagos de servicios, documentos, licencias y otros vencimientos de {activeSede?.nombre || 'la sede'}.</p>
                </div>
                <button className="btn btn-primary text-sm" onClick={() => setForm({ ...EMPTY_FORM })}><Plus size={16} /> Nuevo recordatorio</button>
            </div>

            {message && <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-700 font-semibold">{message}</div>}
            {error && <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 font-semibold">{error}</div>}

            {resumen && (
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                    <Tile icon={<AlertTriangle size={18} />} label="Vencidos" value={resumen.vencido} tone="text-rose-600" />
                    <Tile icon={<Clock size={18} />} label="Por vencer" value={resumen.por_vencer} tone="text-amber-600" />
                    <Tile icon={<CheckCircle2 size={18} />} label="Al día / atendidos" value={resumen.al_dia + resumen.atendido} tone="text-emerald-600" />
                    <Tile icon={<Wallet size={18} />} label="Pagos por atender" value={money(resumen.monto_pendiente)} tone="text-brand-600" />
                </div>
            )}

            <div className="flex gap-2 overflow-x-auto pb-1">
                {[['todos', 'Todos', data.recordatorios.length], ...Object.entries(CATEGORIAS).map(([value, label]) => [value, label, conteo(value)])].map(([value, label, count]) => (
                    <button key={value} onClick={() => setTab(value)} aria-pressed={tab === value}
                        className={`shrink-0 flex items-center gap-2 px-4 py-2 rounded-2xl border font-bold text-sm transition-all ${tab === value ? 'bg-brand-600 border-brand-600 text-white' : 'bg-white border-gray-200 text-gray-600 hover:border-brand-300'}`}>
                        {label}
                        <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${tab === value ? 'bg-white/25' : 'bg-gray-100'}`}>{count}</span>
                    </button>
                ))}
            </div>

            <div className="card p-0 overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="w-full min-w-[900px]">
                        <thead>
                            <tr className="text-left text-xs uppercase text-gray-500 border-b bg-gray-50/60">
                                <th className="px-5 py-3">Recordatorio</th>
                                <th className="px-5 py-3">Categoría</th>
                                <th className="px-5 py-3 text-right">Monto</th>
                                <th className="px-5 py-3">Vence</th>
                                <th className="px-5 py-3">Faltan</th>
                                <th className="px-5 py-3">Estado</th>
                                <th className="px-5 py-3 text-right">Acciones</th>
                            </tr>
                        </thead>
                        <tbody>
                            {loading && <tr><td colSpan={7} className="py-10 text-center font-bold text-gray-500">Cargando recordatorios...</td></tr>}
                            {!loading && lista.map((r) => (
                                <tr key={r.id} className={`border-b border-gray-100 align-top ${r.activo ? '' : 'opacity-60'}`}>
                                    <td className="px-5 py-4">
                                        <p className="font-bold">{r.nombre}</p>
                                        {r.notas && <p className="text-xs text-gray-500 mt-0.5 max-w-[260px]">{r.notas}</p>}
                                    </td>
                                    <td className="px-5 py-4 text-sm">{CATEGORIAS[r.categoria]}</td>
                                    <td className="px-5 py-4 text-right font-black tabular-nums">{r.categoria === 'pago' ? money(r.monto) : <span className="text-gray-300 font-normal">—</span>}</td>
                                    <td className="px-5 py-4 text-sm">
                                        {r.tipo_vencimiento === 'periodico' ? (
                                            <>
                                                <p className="font-semibold flex items-center gap-1"><Repeat size={12} className="text-brand-600" />Día {r.dia_pago} de cada mes</p>
                                                <p className="text-xs text-gray-500">Próximo: {formatFecha(r.proxima_fecha)}</p>
                                            </>
                                        ) : (
                                            <p className="font-semibold flex items-center gap-1"><CalendarDays size={12} className="text-brand-600" />{formatFecha(r.fecha_vencimiento)}</p>
                                        )}
                                        <p className="text-[10px] text-gray-400">Avisa {r.dias_aviso} día(s) antes</p>
                                    </td>
                                    <td className="px-5 py-4 text-sm">{faltan(r)}</td>
                                    <td className="px-5 py-4">{badge(r)}</td>
                                    <td className="px-5 py-4">
                                        <div className="flex flex-wrap justify-end gap-1">
                                            {r.activo && !r.atendido && (
                                                <button className="btn btn-primary text-xs px-3 py-2" disabled={busyId === r.id}
                                                    onClick={() => accion(r, '/atender', `${r.nombre}: ${labelAtendido(r).toLowerCase()}.`)}>
                                                    <CheckCircle2 size={14} /> {r.categoria === 'pago' ? 'Marcar pagado' : 'Marcar atendido'}
                                                </button>
                                            )}
                                            {r.activo && r.atendido && (
                                                <button className="btn btn-secondary text-xs px-3 py-2" disabled={busyId === r.id}
                                                    onClick={() => accion(r, '/revertir', `${r.nombre}: marcado como pendiente.`)}>
                                                    <RotateCcw size={14} /> Revertir
                                                </button>
                                            )}
                                            {r.tipo_vencimiento === 'fecha' && (
                                                <button className="p-2 text-gray-500 hover:text-brand-600" title="Cambiar fecha de vencimiento (renovar)" aria-label={`Cambiar fecha de ${r.nombre}`}
                                                    onClick={() => setFechaTarget({ recordatorio: r, fecha: r.fecha_vencimiento || '' })}><CalendarClock size={16} /></button>
                                            )}
                                            <button className="p-2 text-gray-500 hover:text-brand-600" title="Editar" aria-label={`Editar ${r.nombre}`}
                                                onClick={() => setForm({ ...EMPTY_FORM, ...r, monto: r.categoria === 'pago' ? r.monto : '', fecha_vencimiento: r.fecha_vencimiento || '', dia_pago: r.dia_pago || '', notas: r.notas || '' })}><Edit2 size={16} /></button>
                                            <button className="p-2 text-gray-500 hover:text-brand-600" title={r.activo ? 'Deshabilitar' : 'Habilitar'} aria-label={`${r.activo ? 'Deshabilitar' : 'Habilitar'} ${r.nombre}`}
                                                disabled={busyId === r.id} onClick={() => accion(r, '/alternar', r.activo ? `${r.nombre} deshabilitado.` : `${r.nombre} habilitado.`)}><Power size={16} /></button>
                                            <button className="p-2 text-gray-500 hover:text-rose-600" title="Eliminar" aria-label={`Eliminar ${r.nombre}`}
                                                disabled={busyId === r.id} onClick={() => eliminar(r)}><Trash2 size={16} /></button>
                                        </div>
                                    </td>
                                </tr>
                            ))}
                            {!loading && lista.length === 0 && (
                                <tr>
                                    <td colSpan={7} className="py-12 text-center text-gray-500">
                                        <BellRing className="mx-auto mb-2 text-gray-300" size={32} />
                                        {data.recordatorios.length === 0 ? 'Aún no hay recordatorios. Agrega el primero: luz, agua, licencia de funcionamiento...' : 'No hay recordatorios en esta categoría.'}
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            {form && <RecordatorioModal initial={form} onClose={() => setForm(null)} onSaved={(r, editando) => { setForm(null); setMessage(`Recordatorio "${r.nombre}" ${editando ? 'actualizado' : 'registrado'}.`); load(); }} />}

            {fechaTarget && (
                <FechaModal target={fechaTarget} onClose={() => setFechaTarget(null)}
                    onSaved={(nombre) => { setFechaTarget(null); setMessage(`${nombre}: nueva fecha de vencimiento registrada.`); load(); }} />
            )}
        </div>
    );
};

const Tile = ({ icon, label, value, tone }) => (
    <div className="card p-5">
        <p className="text-[10px] font-black uppercase tracking-widest text-gray-500 flex items-center gap-1.5">{icon}{label}</p>
        <p className={`text-3xl font-display font-black mt-1 tabular-nums ${tone}`}>{value ?? 0}</p>
    </div>
);

const RecordatorioModal = ({ initial, onClose, onSaved }) => {
    const editando = Boolean(initial.id);
    const [form, setForm] = useState(initial);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');
    const set = (patch) => setForm((prev) => ({ ...prev, ...patch }));

    const save = async (event) => {
        event.preventDefault();
        setSaving(true);
        setError('');
        try {
            const body = await readJson(await fetch(editando ? `/api/recordatorios/${initial.id}` : '/api/recordatorios', {
                method: editando ? 'PUT' : 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ...form, monto: form.categoria === 'pago' ? Number(form.monto) : 0, dias_aviso: Number(form.dias_aviso), dia_pago: form.tipo_vencimiento === 'periodico' ? Number(form.dia_pago) : null })
            }), 'No se pudo guardar el recordatorio.');
            onSaved(body, editando);
        } catch (e) {
            setError(e.message);
        } finally {
            setSaving(false);
        }
    };

    return (
        <Modal title={editando ? 'Editar recordatorio' : 'Nuevo recordatorio'} subtitle="Se avisa en la campana cuando se acerca el vencimiento." wide onClose={onClose}>
            <ErrorBox text={error} />
            <form onSubmit={save} className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-[2fr_1fr] gap-3">
                    <Field label="Nombre"><input className="input" placeholder="Ej. Recibo de luz, licencia de funcionamiento" value={form.nombre} onChange={(e) => set({ nombre: e.target.value })} required minLength={3} maxLength={100} autoFocus /></Field>
                    <Field label="Categoría">
                        <select className="input" value={form.categoria} onChange={(e) => set({ categoria: e.target.value })}>
                            {Object.entries(CATEGORIAS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                        </select>
                    </Field>
                </div>

                <Field label="Tipo de vencimiento">
                    <ToggleGroup value={form.tipo_vencimiento} onChange={(tipo_vencimiento) => set({ tipo_vencimiento })}
                        options={[{ value: 'fecha', label: 'Fecha fija' }, { value: 'periodico', label: 'Periódico mensual' }]} />
                </Field>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    {form.tipo_vencimiento === 'fecha'
                        ? <Field label="Fecha de vencimiento"><input type="date" className="input" value={form.fecha_vencimiento} onChange={(e) => set({ fecha_vencimiento: e.target.value })} required /></Field>
                        : <Field label="Día del mes (1-31)"><input type="number" min={1} max={31} className="input" value={form.dia_pago} onChange={(e) => set({ dia_pago: e.target.value })} required /></Field>}
                    <Field label="Avisar días antes"><input type="number" min={0} max={365} className="input" value={form.dias_aviso} onChange={(e) => set({ dias_aviso: e.target.value })} required /></Field>
                    {form.categoria === 'pago' && (
                        <Field label="Monto (S/)"><input type="number" min="0.01" step="0.01" className="input" placeholder="80.00" value={form.monto} onChange={(e) => set({ monto: e.target.value })} required /></Field>
                    )}
                </div>
                {form.tipo_vencimiento === 'periodico' && Number(form.dia_pago) > 28 && (
                    <p className="text-xs text-gray-500">En los meses más cortos vence el último día del mes.</p>
                )}

                <Field label="Notas (opcional)"><input className="input" placeholder="Ej. N° de suministro, a nombre de..." value={form.notas} onChange={(e) => set({ notas: e.target.value })} maxLength={255} /></Field>

                <div className="flex gap-3 pt-1">
                    <button type="button" className="btn btn-secondary flex-1" onClick={onClose}>Cancelar</button>
                    <button type="submit" className="btn btn-primary flex-1" disabled={saving}>{saving ? 'Guardando...' : editando ? 'Actualizar' : 'Guardar'}</button>
                </div>
            </form>
        </Modal>
    );
};

const FechaModal = ({ target, onClose, onSaved }) => {
    const [fecha, setFecha] = useState(target.fecha);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');
    const save = async (event) => {
        event.preventDefault();
        setSaving(true);
        setError('');
        try {
            await readJson(await fetch(`/api/recordatorios/${target.recordatorio.id}/fecha`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fecha_vencimiento: fecha })
            }), 'No se pudo actualizar la fecha.');
            onSaved(target.recordatorio.nombre);
        } catch (e) {
            setError(e.message);
        } finally {
            setSaving(false);
        }
    };
    return (
        <Modal title="Nueva fecha de vencimiento" subtitle={`${target.recordatorio.nombre}: al renovarlo vuelve a quedar pendiente.`} onClose={onClose}>
            <ErrorBox text={error} />
            <form onSubmit={save} className="space-y-4">
                <Field label="Fecha de vencimiento"><input type="date" className="input" value={fecha} onChange={(e) => setFecha(e.target.value)} required autoFocus /></Field>
                <div className="flex gap-3 pt-1">
                    <button type="button" className="btn btn-secondary flex-1" onClick={onClose}>Cancelar</button>
                    <button type="submit" className="btn btn-primary flex-1" disabled={saving || !fecha}>{saving ? 'Guardando...' : 'Guardar fecha'}</button>
                </div>
            </form>
        </Modal>
    );
};

export default Recordatorios;
