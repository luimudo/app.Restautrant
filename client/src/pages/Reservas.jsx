import React, { useCallback, useEffect, useState } from 'react';
import {
    CalendarDays, Plus, Search, Edit2, XCircle, ShieldCheck, CheckCircle2, AlertCircle,
    Users, Clock, PartyPopper, Utensils, MessageSquare, Download
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { addDaysYmd, toPeruYmd } from '../utils/dateTime';
import { descargarReporteReservas } from '../utils/exportReservas';

const formatFecha = (ymd) => new Date(`${ymd}T00:00:00`).toLocaleDateString('es-PE', {
    weekday: 'short', day: '2-digit', month: 'short', year: 'numeric'
});

const EMPTY_FORM = {
    id: null,
    nombre_completo: '',
    dni: '',
    fecha: '',
    hora: '',
    tipo: 'consumo',
    numero_personas: 2,
    comentario: ''
};

const ESTADO_STYLES = {
    pendiente: 'bg-amber-50 text-amber-700 border-amber-200',
    confirmada: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    cancelada: 'bg-gray-100 text-gray-500 border-gray-200'
};

const Reservas = () => {
    const { isSuperadmin, sedes, activeSede, activeSedeId } = useAuth();
    const today = toPeruYmd();

    const [filters, setFilters] = useState({
        desde: today,
        hasta: addDaysYmd(today, 30),
        sede: activeSedeId ? String(activeSedeId) : 'todas',
        estado: 'todos'
    });
    const [data, setData] = useState({ reservas: [], resumen: null });
    const [applied, setApplied] = useState(null); // filters of the list on screen: the report matches it
    const [loading, setLoading] = useState(true);
    const [message, setMessage] = useState('');
    const [error, setError] = useState('');

    const [showForm, setShowForm] = useState(false);
    const [form, setForm] = useState(EMPTY_FORM);
    const [saving, setSaving] = useState(false);
    const [formError, setFormError] = useState('');

    const [cancelForm, setCancelForm] = useState(null); // { reserva, motivo, error }
    const [cancelling, setCancelling] = useState(false);

    const [validation, setValidation] = useState(null); // { reserva, valida, checks }
    const [validating, setValidating] = useState(false);
    const [confirming, setConfirming] = useState(false);

    const fetchReservas = useCallback(async (current) => {
        setLoading(true);
        setError('');
        try {
            const params = new URLSearchParams({ desde: current.desde, hasta: current.hasta });
            if (isSuperadmin) params.set('sede_id', current.sede);
            if (current.estado !== 'todos') params.set('estado', current.estado);

            const res = await fetch(`/api/reservas?${params.toString()}`);
            const body = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(body.error || 'No se pudo cargar las reservas.');
            setData({ reservas: body.reservas || [], resumen: body.resumen || null });
            setApplied(current);
        } catch (e) {
            setError(e.message);
            setData({ reservas: [], resumen: null });
            setApplied(null);
        } finally {
            setLoading(false);
        }
    }, [isSuperadmin]);

    useEffect(() => {
        fetchReservas(filters);
        // Only the initial load; later searches are triggered with the Buscar button.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const handleSearch = (event) => {
        event.preventDefault();
        if (filters.desde > filters.hasta) {
            setError('La fecha "desde" no puede ser mayor que "hasta".');
            return;
        }
        fetchReservas(filters);
    };

    const showAllSedes = isSuperadmin && filters.sede === 'todas';

    const openCreate = () => {
        setForm({ ...EMPTY_FORM, fecha: today });
        setFormError('');
        setShowForm(true);
    };

    const openEdit = (reserva) => {
        setForm({
            id: reserva.id,
            nombre_completo: reserva.nombre_completo,
            dni: reserva.dni,
            fecha: reserva.fecha,
            hora: reserva.hora,
            tipo: reserva.tipo,
            numero_personas: reserva.numero_personas,
            comentario: reserva.comentario || ''
        });
        setFormError('');
        setShowForm(true);
    };

    const saveReserva = async (event) => {
        event.preventDefault();
        setFormError('');
        setMessage('');

        if (!/^\d{8}$/.test(form.dni)) {
            setFormError('El DNI debe tener 8 digitos.');
            return;
        }

        setSaving(true);
        const isEdit = Boolean(form.id);
        try {
            const res = await fetch(isEdit ? `/api/reservas/${form.id}` : '/api/reservas', {
                method: isEdit ? 'PUT' : 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    nombre_completo: form.nombre_completo,
                    dni: form.dni,
                    fecha: form.fecha,
                    hora: form.hora,
                    tipo: form.tipo,
                    numero_personas: Number(form.numero_personas),
                    comentario: form.comentario
                })
            });
            const body = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(body.error || 'No se pudo guardar la reserva.');

            setShowForm(false);
            setMessage(isEdit
                ? `Reserva #${body.id} actualizada.`
                : `Reserva #${body.id} registrada como pendiente. Validala para confirmarla.`);
            fetchReservas(filters);
        } catch (e) {
            setFormError(e.message);
        } finally {
            setSaving(false);
        }
    };

    const openValidation = async (reserva) => {
        setError('');
        setMessage('');
        setValidating(true);
        setValidation({ reserva, valida: false, checks: [] });
        try {
            const res = await fetch(`/api/reservas/${reserva.id}/validacion`);
            const body = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(body.error || 'No se pudo validar la reserva.');
            setValidation(body);
        } catch (e) {
            setValidation(null);
            setError(e.message);
        } finally {
            setValidating(false);
        }
    };

    const confirmReserva = async () => {
        if (!validation?.reserva) return;
        setConfirming(true);
        try {
            const res = await fetch(`/api/reservas/${validation.reserva.id}/confirmar`, { method: 'PUT' });
            const body = await res.json().catch(() => ({}));
            if (res.status === 422) {
                // Something changed since the check was shown: display the fresh result.
                setValidation((prev) => ({ ...prev, valida: false, checks: body.checks || prev.checks }));
                return;
            }
            if (!res.ok) throw new Error(body.error || 'No se pudo confirmar la reserva.');
            setValidation(null);
            setMessage(`Reserva #${body.id} de ${body.nombre_completo} confirmada.`);
            fetchReservas(filters);
        } catch (e) {
            setValidation(null);
            setError(e.message);
        } finally {
            setConfirming(false);
        }
    };

    const openCancel = (reserva) => {
        setError('');
        setMessage('');
        setCancelForm({ reserva, motivo: '', error: '' });
    };

    const cancelReserva = async (event) => {
        event.preventDefault();
        const { reserva, motivo } = cancelForm;
        setCancelling(true);
        try {
            const res = await fetch(`/api/reservas/${reserva.id}/cancelar`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ motivo })
            });
            const body = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(body.error || 'No se pudo cancelar la reserva.');
            setCancelForm(null);
            setMessage(`Reserva #${reserva.id} cancelada.`);
            fetchReservas(filters);
        } catch (e) {
            setCancelForm((prev) => ({ ...prev, error: e.message }));
        } finally {
            setCancelling(false);
        }
    };

    const exportarReporte = async () => {
        if (!applied || data.reservas.length === 0) return;
        setError('');
        try {
            const sedeNombre = isSuperadmin && applied.sede === 'todas'
                ? 'Todas las sedes'
                : (sedes.find((s) => String(s.id) === String(isSuperadmin ? applied.sede : activeSedeId))?.nombre || activeSede?.nombre || 'Sede');
            await descargarReporteReservas({
                periodo: { desde: applied.desde, hasta: applied.hasta },
                sedeNombre,
                estado: applied.estado,
                reservas: data.reservas,
                resumen: data.resumen
            });
        } catch (e) {
            setError('No se pudo generar el reporte de reservas.');
        }
    };

    const resumen = data.resumen;

    return (
        <div className="space-y-8">
            <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
                <div>
                    <h2 className="text-4xl font-display font-black tracking-tight">Reservas <span className="text-brand-600">de Mesas</span></h2>
                    <p className="text-[var(--text-secondary)] mt-2">
                        Registra reservas por consumo o evento y confirmalas despues de validarlas.
                    </p>
                </div>
                <div className="flex flex-wrap gap-2">
                    <button className="btn btn-secondary text-sm" onClick={exportarReporte} disabled={loading || data.reservas.length === 0}>
                        <Download size={16} /> Excel
                    </button>
                    <button className="btn btn-primary text-sm" onClick={openCreate} disabled={!activeSedeId}>
                        <Plus size={16} /> Nueva Reserva
                    </button>
                </div>
            </div>

            {message && <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-700 font-semibold">{message}</div>}
            {error && <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 font-semibold">{error}</div>}

            <form onSubmit={handleSearch} className="card p-5 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_1.3fr_1fr_auto] gap-3 items-end">
                <label className="block">
                    <span className="text-xs font-bold text-gray-500 uppercase tracking-widest">Desde</span>
                    <input type="date" className="input mt-1.5" value={filters.desde} onChange={(e) => setFilters({ ...filters, desde: e.target.value })} required />
                </label>
                <label className="block">
                    <span className="text-xs font-bold text-gray-500 uppercase tracking-widest">Hasta</span>
                    <input type="date" className="input mt-1.5" value={filters.hasta} min={filters.desde} onChange={(e) => setFilters({ ...filters, hasta: e.target.value })} required />
                </label>
                <label className="block">
                    <span className="text-xs font-bold text-gray-500 uppercase tracking-widest">Sede</span>
                    {isSuperadmin ? (
                        <select className="input mt-1.5" value={filters.sede} onChange={(e) => setFilters({ ...filters, sede: e.target.value })}>
                            <option value="todas">Todas las sedes</option>
                            {sedes.map((sede) => <option key={sede.id} value={sede.id}>{sede.nombre}</option>)}
                        </select>
                    ) : (
                        <input className="input mt-1.5" value={activeSede?.nombre || ''} disabled />
                    )}
                </label>
                <label className="block">
                    <span className="text-xs font-bold text-gray-500 uppercase tracking-widest">Estado</span>
                    <select className="input mt-1.5" value={filters.estado} onChange={(e) => setFilters({ ...filters, estado: e.target.value })}>
                        <option value="todos">Todos</option>
                        <option value="pendiente">Pendientes</option>
                        <option value="confirmada">Confirmadas</option>
                        <option value="cancelada">Canceladas</option>
                    </select>
                </label>
                <button type="submit" className="btn btn-secondary"><Search size={16} /> Buscar</button>
            </form>

            {resumen && (
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                    <SummaryTile label="Reservas" value={resumen.total} />
                    <SummaryTile label="Pendientes" value={resumen.pendiente} tone="text-amber-600" />
                    <SummaryTile label="Confirmadas" value={resumen.confirmada} tone="text-emerald-600" />
                    <SummaryTile label="Personas confirmadas" value={resumen.personas_confirmadas} tone="text-brand-600" />
                </div>
            )}

            <div className="card p-0 overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="w-full">
                        <thead>
                            <tr className="text-left text-xs uppercase text-gray-500 border-b bg-gray-50/60">
                                <th className="px-5 py-3">Fecha y hora</th>
                                <th className="px-5 py-3">Cliente</th>
                                <th className="px-5 py-3">Tipo</th>
                                <th className="px-5 py-3 text-center">Personas</th>
                                {showAllSedes && <th className="px-5 py-3">Sede</th>}
                                <th className="px-5 py-3">Comentario</th>
                                <th className="px-5 py-3">Estado</th>
                                <th className="px-5 py-3 text-right">Acciones</th>
                            </tr>
                        </thead>
                        <tbody>
                            {loading && (
                                <tr><td colSpan={8} className="py-10 text-center font-bold text-gray-500">Cargando reservas...</td></tr>
                            )}
                            {!loading && data.reservas.map((r) => (
                                <tr key={r.id} className="border-b border-gray-100 align-top">
                                    <td className="px-5 py-4">
                                        <p className="font-bold text-sm">{formatFecha(r.fecha)}</p>
                                        <p className="text-xs text-gray-500 flex items-center gap-1 mt-0.5"><Clock size={12} />{r.hora}</p>
                                    </td>
                                    <td className="px-5 py-4">
                                        <p className="font-semibold">{r.nombre_completo}</p>
                                        <p className="text-xs text-gray-500 font-mono">DNI {r.dni}</p>
                                    </td>
                                    <td className="px-5 py-4">
                                        <span className="inline-flex items-center gap-1 text-xs font-bold capitalize">
                                            {r.tipo === 'evento' ? <PartyPopper size={14} className="text-brand-600" /> : <Utensils size={14} className="text-gray-500" />}
                                            {r.tipo}
                                        </span>
                                    </td>
                                    <td className="px-5 py-4 text-center font-black">{r.numero_personas}</td>
                                    {showAllSedes && <td className="px-5 py-4 text-sm">{r.sede_nombre}</td>}
                                    <td className="px-5 py-4 text-sm text-gray-600 max-w-[220px]">
                                        {r.comentario
                                            ? <span className="line-clamp-2" title={r.comentario}>{r.comentario}</span>
                                            : <span className="text-gray-400">—</span>}
                                    </td>
                                    <td className="px-5 py-4">
                                        <span className={`inline-block px-2 py-1 rounded-lg border text-[10px] font-black uppercase tracking-widest ${ESTADO_STYLES[r.estado]}`}>
                                            {r.estado}
                                        </span>
                                        {r.estado === 'confirmada' && r.usuario_confirmacion_nombre && (
                                            <p className="text-[10px] text-gray-400 mt-1">por {r.usuario_confirmacion_nombre}</p>
                                        )}
                                        {r.estado === 'cancelada' && r.motivo_cancelacion && (
                                            <p className="text-[10px] text-gray-500 mt-1 max-w-[180px]" title={r.motivo_cancelacion}>
                                                Motivo: {r.motivo_cancelacion}{r.usuario_cancelacion_nombre ? ` · ${r.usuario_cancelacion_nombre}` : ''}
                                            </p>
                                        )}
                                    </td>
                                    <td className="px-5 py-4">
                                        <div className="flex items-center justify-end gap-1">
                                            {r.estado === 'pendiente' && (
                                                <>
                                                    <button className="btn btn-primary text-xs px-3 py-2" onClick={() => openValidation(r)}>
                                                        <ShieldCheck size={14} /> Validar y confirmar
                                                    </button>
                                                    <button className="p-2 text-gray-500 hover:text-brand-600" onClick={() => openEdit(r)} aria-label={`Editar reserva ${r.id}`}>
                                                        <Edit2 size={14} />
                                                    </button>
                                                </>
                                            )}
                                            {r.estado !== 'cancelada' && (
                                                <button className="p-2 text-gray-500 hover:text-rose-600" onClick={() => openCancel(r)} aria-label={`Cancelar reserva ${r.id}`}>
                                                    <XCircle size={16} />
                                                </button>
                                            )}
                                        </div>
                                    </td>
                                </tr>
                            ))}
                            {!loading && data.reservas.length === 0 && (
                                <tr>
                                    <td colSpan={8} className="py-12 text-center text-gray-500">
                                        <CalendarDays className="mx-auto mb-2 text-gray-300" size={32} />
                                        No hay reservas en ese rango de fechas.
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            {showForm && (
                <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
                    <div className="bg-white rounded-3xl p-8 w-full max-w-lg max-h-[90vh] overflow-y-auto">
                        <h4 className="text-2xl font-black">{form.id ? `Editar Reserva #${form.id}` : 'Nueva Reserva'}</h4>
                        <p className="text-sm text-gray-500 mt-1 mb-5">Sede: <span className="font-bold text-gray-700">{activeSede?.nombre}</span></p>

                        {formError && <div className="mb-4 p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-sm font-semibold">{formError}</div>}

                        <form onSubmit={saveReserva} className="space-y-4">
                            <input className="input" placeholder="Nombre completo" value={form.nombre_completo} onChange={(e) => setForm({ ...form, nombre_completo: e.target.value })} required minLength={3} />
                            <input
                                className="input"
                                placeholder="DNI (8 digitos)"
                                inputMode="numeric"
                                maxLength={8}
                                value={form.dni}
                                onChange={(e) => setForm({ ...form, dni: e.target.value.replace(/\D/g, '').slice(0, 8) })}
                                required
                            />
                            <div className="grid grid-cols-2 gap-3">
                                <label className="block">
                                    <span className="text-xs font-bold text-gray-500 uppercase tracking-widest">Fecha</span>
                                    <input type="date" className="input mt-1.5" min={today} value={form.fecha} onChange={(e) => setForm({ ...form, fecha: e.target.value })} required />
                                </label>
                                <label className="block">
                                    <span className="text-xs font-bold text-gray-500 uppercase tracking-widest">Hora</span>
                                    <input type="time" className="input mt-1.5" value={form.hora} onChange={(e) => setForm({ ...form, hora: e.target.value })} required />
                                </label>
                            </div>
                            <div>
                                <span className="text-xs font-bold text-gray-500 uppercase tracking-widest">Tipo de reserva</span>
                                <div className="grid grid-cols-2 gap-3 mt-1.5">
                                    {[
                                        { value: 'consumo', label: 'Por consumo', icon: <Utensils size={16} /> },
                                        { value: 'evento', label: 'Por evento', icon: <PartyPopper size={16} /> }
                                    ].map((option) => (
                                        <button
                                            type="button"
                                            key={option.value}
                                            onClick={() => setForm({ ...form, tipo: option.value })}
                                            aria-pressed={form.tipo === option.value}
                                            className={`flex items-center justify-center gap-2 px-4 py-3 rounded-2xl border font-bold text-sm transition-all ${form.tipo === option.value
                                                ? 'bg-brand-600 border-brand-600 text-white'
                                                : 'bg-white border-gray-200 text-gray-600 hover:border-brand-300'}`}
                                        >
                                            {option.icon}{option.label}
                                        </button>
                                    ))}
                                </div>
                            </div>
                            <label className="block">
                                <span className="text-xs font-bold text-gray-500 uppercase tracking-widest">Numero de personas</span>
                                <div className="relative mt-1.5">
                                    <Users size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" />
                                    <input type="number" min={1} className="input pl-11" value={form.numero_personas} onChange={(e) => setForm({ ...form, numero_personas: e.target.value })} required />
                                </div>
                            </label>
                            <label className="block">
                                <span className="text-xs font-bold text-gray-500 uppercase tracking-widest">Comentario (opcional)</span>
                                <div className="relative mt-1.5">
                                    <MessageSquare size={18} className="absolute left-4 top-4 text-gray-400" />
                                    <textarea className="input pl-11 min-h-[90px]" placeholder="Ej. cumpleaños, mesa cerca a la ventana..." value={form.comentario} onChange={(e) => setForm({ ...form, comentario: e.target.value })} />
                                </div>
                            </label>
                            <div className="flex gap-3 pt-2">
                                <button type="button" className="btn btn-secondary flex-1" onClick={() => setShowForm(false)}>Cancelar</button>
                                <button type="submit" className="btn btn-primary flex-1" disabled={saving}>{saving ? 'Guardando...' : 'Guardar'}</button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {cancelForm && (
                <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
                    <div className="bg-white rounded-3xl p-8 w-full max-w-md">
                        <h4 className="text-2xl font-black">Cancelar Reserva #{cancelForm.reserva.id}</h4>
                        <p className="text-sm text-gray-500 mt-1 mb-5">
                            {cancelForm.reserva.nombre_completo} · {formatFecha(cancelForm.reserva.fecha)} {cancelForm.reserva.hora} · {cancelForm.reserva.numero_personas} persona(s)
                        </p>
                        {cancelForm.error && <div className="mb-4 p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-sm font-semibold">{cancelForm.error}</div>}
                        <form onSubmit={cancelReserva} className="space-y-4">
                            <label className="block">
                                <span className="text-xs font-bold text-gray-500 uppercase tracking-widest">Motivo de la cancelación</span>
                                <textarea
                                    className="input mt-1.5 min-h-[90px]"
                                    placeholder="Ej. el cliente avisó que no asistirá"
                                    value={cancelForm.motivo}
                                    onChange={(e) => setCancelForm({ ...cancelForm, motivo: e.target.value })}
                                    minLength={3}
                                    maxLength={200}
                                    required
                                    autoFocus
                                />
                            </label>
                            <div className="flex gap-3 pt-1">
                                <button type="button" className="btn btn-secondary flex-1" onClick={() => setCancelForm(null)}>Volver</button>
                                <button type="submit" className="btn bg-rose-600 hover:bg-rose-700 text-white flex-1" disabled={cancelling || cancelForm.motivo.trim().length < 3}>
                                    <XCircle size={16} /> {cancelling ? 'Cancelando...' : 'Cancelar reserva'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {validation && (
                <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
                    <div className="bg-white rounded-3xl p-8 w-full max-w-lg max-h-[90vh] overflow-y-auto">
                        <h4 className="text-2xl font-black">Validar Reserva #{validation.reserva?.id}</h4>
                        <p className="text-sm text-gray-500 mt-1 mb-5">
                            {validation.reserva?.nombre_completo} · {validation.reserva && formatFecha(validation.reserva.fecha)} {validation.reserva?.hora} · {validation.reserva?.numero_personas} persona(s)
                        </p>

                        {validating ? (
                            <p className="py-6 text-center font-bold text-gray-500">Validando...</p>
                        ) : (
                            <>
                                <ul className="space-y-2">
                                    {validation.checks.map((check) => (
                                        <li key={check.clave} className={`flex items-start gap-3 p-3 rounded-xl border ${check.ok ? 'bg-emerald-50/50 border-emerald-100' : 'bg-rose-50 border-rose-200'}`}>
                                            {check.ok
                                                ? <CheckCircle2 size={18} className="text-emerald-600 shrink-0 mt-0.5" />
                                                : <AlertCircle size={18} className="text-rose-600 shrink-0 mt-0.5" />}
                                            <div className="min-w-0">
                                                <p className="text-sm font-bold">{check.descripcion}</p>
                                                <p className="text-xs text-gray-500">{check.detalle}</p>
                                            </div>
                                        </li>
                                    ))}
                                </ul>
                                <p className={`mt-4 text-sm font-bold ${validation.valida ? 'text-emerald-700' : 'text-rose-700'}`}>
                                    {validation.valida
                                        ? 'La reserva paso todas las validaciones.'
                                        : 'La reserva no se puede confirmar. Corrige los puntos marcados o cancelala.'}
                                </p>
                            </>
                        )}

                        <div className="flex gap-3 pt-5">
                            <button type="button" className="btn btn-secondary flex-1" onClick={() => setValidation(null)}>Cerrar</button>
                            <button
                                type="button"
                                className="btn btn-primary flex-1"
                                onClick={confirmReserva}
                                disabled={validating || confirming || !validation.valida}
                            >
                                <CheckCircle2 size={16} /> {confirming ? 'Confirmando...' : 'Confirmar reserva'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

const SummaryTile = ({ label, value, tone = 'text-[var(--text-primary)]' }) => (
    <div className="card p-5">
        <p className="text-[10px] font-black uppercase tracking-widest text-gray-500">{label}</p>
        <p className={`text-3xl font-display font-black mt-1 ${tone}`}>{value ?? 0}</p>
    </div>
);

export default Reservas;
