import React, { useCallback, useEffect, useState } from 'react';
import {
    Wrench, Plus, Search, AlertTriangle, Eye, Edit2, Play, CheckCircle2, XCircle, CalendarClock, Trash2, History, ShieldCheck
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { SUPERADMIN } from '../security/accessControl';
import { addDaysYmd, formatDateTime, startOfMonthYmd, toPeruYmd } from '../utils/dateTime';
import { Modal, Field, ErrorBox, ToggleGroup } from '../components/billing/billingShared';
import { METODOS_COBRO, money, readJson } from '../components/billing/billingUtils';

const CATEGORIAS = {
    coccion: 'Coccion', refrigeracion: 'Refrigeracion', preparacion: 'Preparacion', lavado: 'Lavado',
    bar_cafeteria: 'Bar / Cafeteria', ventilacion: 'Ventilacion', electronica: 'Electronica / POS', mobiliario: 'Mobiliario', otro: 'Otro'
};
const AREAS = { cocina: 'Cocina', bar: 'Bar', salon: 'Salon', almacen: 'Almacen', caja: 'Caja', otro: 'Otro' };
const ESTADO_EQUIPO = {
    operativo: ['bg-emerald-50 text-emerald-700 border-emerald-200', 'Operativo'],
    en_mantenimiento: ['bg-sky-50 text-sky-700 border-sky-200', 'En mantenimiento'],
    averiado: ['bg-rose-50 text-rose-700 border-rose-200', 'Averiado'],
    baja: ['bg-gray-100 text-gray-500 border-gray-200', 'De baja']
};
const ESTADO_MANT = {
    programado: ['bg-amber-50 text-amber-700 border-amber-200', 'Programado'],
    en_ejecucion: ['bg-sky-50 text-sky-700 border-sky-200', 'En ejecucion'],
    ejecutado: ['bg-emerald-50 text-emerald-700 border-emerald-200', 'Ejecutado'],
    anulado: ['bg-gray-100 text-gray-500 border-gray-200', 'Anulado']
};
const PRIORIDAD = { alta: 'text-rose-600', media: 'text-amber-600', baja: 'text-gray-500' };

const formatFecha = (ymd) => (ymd ? new Date(`${ymd}T00:00:00`).toLocaleDateString('es-PE', { day: '2-digit', month: 'short', year: 'numeric' }) : '-');
const Badge = ({ map, value }) => {
    const [style, label] = map[value] || ['bg-gray-100 text-gray-500 border-gray-200', value];
    return <span className={`inline-block px-2 py-1 rounded-lg border text-[10px] font-black uppercase tracking-widest whitespace-nowrap ${style}`}>{label}</span>;
};

const postJson = async (url, body, fallback, method = 'POST') => readJson(await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {})
}), fallback);

const Equipos = () => {
    const { isSuperadmin, activeProfile, baseProfile, sedes, activeSede, activeSedeId } = useAuth();
    const isAdmin = baseProfile === 'administrador' || activeProfile === SUPERADMIN;
    const today = toPeruYmd();
    const defaultSede = activeSedeId ? String(activeSedeId) : 'todas';

    const [tab, setTab] = useState('inventario');
    const [message, setMessage] = useState('');
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);
    const [proveedores, setProveedores] = useState([]);

    const [invFilters, setInvFilters] = useState({ sede: defaultSede, estado: 'activos', area: '', q: '' });
    const [inventario, setInventario] = useState({ equipos: [], resumen: null });
    const [pendSede, setPendSede] = useState(defaultSede);
    const [pendientes, setPendientes] = useState({ mantenimientos: [], resumen: null });
    const [histFilters, setHistFilters] = useState({ sede: defaultSede, desde: startOfMonthYmd(today), hasta: today });
    const [historial, setHistorial] = useState({ mantenimientos: [], resumen: null });

    const [equipoForm, setEquipoForm] = useState(null);
    const [hojaVida, setHojaVida] = useState(null);
    const [fallaTarget, setFallaTarget] = useState(null);
    const [planForm, setPlanForm] = useState(null);
    const [programarTarget, setProgramarTarget] = useState(null);
    const [ejecutarTarget, setEjecutarTarget] = useState(null);
    const [motivoTarget, setMotivoTarget] = useState(null); // { tipo: 'baja'|'anular', id, titulo }

    const sedeParam = useCallback((params, sede) => { if (isSuperadmin) params.set('sede_id', sede); }, [isSuperadmin]);

    const load = useCallback(async (target, filters) => {
        setLoading(true);
        setError('');
        try {
            const params = new URLSearchParams();
            if (target === 'inventario') {
                sedeParam(params, filters.sede);
                params.set('estado', filters.estado);
                if (filters.area) params.set('area', filters.area);
                if (filters.q.trim()) params.set('q', filters.q.trim());
                const body = await readJson(await fetch(`/api/equipos?${params}`), 'No se pudo cargar el inventario.');
                setInventario({ equipos: body.equipos || [], resumen: body.resumen });
            } else if (target === 'pendientes') {
                sedeParam(params, filters);
                const body = await readJson(await fetch(`/api/mantenimientos?${params}`), 'No se pudo cargar los mantenimientos.');
                setPendientes({ mantenimientos: body.mantenimientos || [], resumen: body.resumen });
            } else {
                sedeParam(params, filters.sede);
                params.set('vista', 'historial');
                params.set('desde', filters.desde);
                params.set('hasta', filters.hasta);
                const body = await readJson(await fetch(`/api/mantenimientos?${params}`), 'No se pudo cargar el historial.');
                setHistorial({ mantenimientos: body.mantenimientos || [], resumen: body.resumen });
            }
        } catch (e) {
            setError(e.message);
        } finally {
            setLoading(false);
        }
    }, [sedeParam]);

    const refresh = (target = tab) => {
        if (target === 'inventario') load('inventario', invFilters);
        if (target === 'pendientes') load('pendientes', pendSede);
        if (target === 'historial') load('historial', histFilters);
    };

    useEffect(() => {
        refresh(tab);
        // Only on tab change; filters are applied with the Buscar button.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [tab]);

    useEffect(() => {
        fetch('/api/equipos/opciones').then((res) => (res.ok ? res.json() : {})).then((body) => setProveedores(body.proveedores || [])).catch(() => {});
    }, []);

    const notify = (text) => { setError(''); setMessage(text); };

    const openHojaVida = async (id) => {
        setError('');
        try {
            setHojaVida(await readJson(await fetch(`/api/equipos/${id}`), 'No se pudo cargar el equipo.'));
        } catch (e) {
            setError(e.message);
        }
    };

    // After any change: reload the visible tab and the open equipment sheet.
    const afterChange = (text, equipoId) => {
        notify(text);
        refresh();
        if (hojaVida && (!equipoId || hojaVida.id === equipoId)) openHojaVida(hojaVida.id);
    };

    const iniciar = async (m) => {
        try {
            await postJson(`/api/mantenimientos/${m.id}/iniciar`, {}, 'No se pudo iniciar.');
            afterChange(`${m.codigo} en ejecucion: ${m.equipo_nombre} queda en mantenimiento.`, m.equipo_id);
        } catch (e) {
            setError(e.message);
        }
    };

    const sedeSelect = (value, onChange) => (
        <Field label="Sede">
            {isSuperadmin ? (
                <select className="input" value={value} onChange={(e) => onChange(e.target.value)}>
                    <option value="todas">Todas las sedes</option>
                    {sedes.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
                </select>
            ) : <input className="input" value={activeSede?.nombre || ''} disabled />}
        </Field>
    );

    const mantenimientoActions = (m) => (
        <div className="flex items-center justify-end gap-1">
            {isAdmin && m.estado === 'programado' && (
                <button className="p-2 text-gray-500 hover:text-sky-600" title="Iniciar" aria-label={`Iniciar ${m.codigo}`} onClick={() => iniciar(m)}><Play size={16} /></button>
            )}
            {isAdmin && ['programado', 'en_ejecucion'].includes(m.estado) && (
                <>
                    <button className="btn btn-primary text-xs px-3 py-2" onClick={() => setEjecutarTarget(m)}><CheckCircle2 size={14} /> Ejecutar</button>
                    <button className="p-2 text-gray-500 hover:text-rose-600" title="Anular" aria-label={`Anular ${m.codigo}`}
                        onClick={() => setMotivoTarget({ tipo: 'anular', id: m.id, equipoId: m.equipo_id, titulo: `Anular ${m.codigo}` })}><XCircle size={16} /></button>
                </>
            )}
            <button className="p-2 text-gray-500 hover:text-brand-600" title="Hoja de vida" aria-label={`Ver equipo ${m.equipo_codigo}`} onClick={() => openHojaVida(m.equipo_id)}><Eye size={16} /></button>
        </div>
    );

    const tabs = [
        { key: 'inventario', label: 'Inventario', icon: <Wrench size={16} /> },
        { key: 'pendientes', label: 'Mantenimientos pendientes', icon: <CalendarClock size={16} /> },
        { key: 'historial', label: 'Historial', icon: <History size={16} /> }
    ];

    return (
        <div className="space-y-8">
            <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
                <div>
                    <h2 className="text-4xl font-display font-black tracking-tight">Equipos <span className="text-brand-600">y Mantenimiento</span></h2>
                    <p className="text-[var(--text-secondary)] mt-2">
                        {isAdmin
                            ? 'Inventario de equipos del local, planes preventivos, averias y su costo.'
                            : 'Consulta los equipos de tu sede y reporta cualquier averia.'}
                    </p>
                </div>
                {isAdmin && (
                    <button className="btn btn-primary text-sm" onClick={() => setEquipoForm({})} disabled={!activeSedeId}>
                        <Plus size={16} /> Nuevo Equipo
                    </button>
                )}
            </div>

            {message && <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-700 font-semibold">{message}</div>}
            {error && <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 font-semibold">{error}</div>}

            <div className="flex flex-wrap gap-2">
                {tabs.map((t) => (
                    <button key={t.key} onClick={() => { setMessage(''); setTab(t.key); }} aria-pressed={tab === t.key}
                        className={`flex items-center gap-2 px-4 py-2.5 rounded-2xl border font-bold text-sm transition-all ${tab === t.key ? 'bg-brand-600 border-brand-600 text-white' : 'bg-white border-gray-200 text-gray-600 hover:border-brand-300'}`}>
                        {t.icon}{t.label}
                    </button>
                ))}
            </div>

            {tab === 'inventario' && (
                <>
                    <form onSubmit={(e) => { e.preventDefault(); refresh('inventario'); }}
                        className="card p-5 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-[1.2fr_1fr_1fr_1.5fr_auto] gap-3 items-end">
                        {sedeSelect(invFilters.sede, (sede) => setInvFilters({ ...invFilters, sede }))}
                        <Field label="Estado">
                            <select className="input" value={invFilters.estado} onChange={(e) => setInvFilters({ ...invFilters, estado: e.target.value })}>
                                <option value="activos">Activos (sin bajas)</option>
                                <option value="operativo">Operativos</option>
                                <option value="en_mantenimiento">En mantenimiento</option>
                                <option value="averiado">Averiados</option>
                                <option value="baja">De baja</option>
                            </select>
                        </Field>
                        <Field label="Area">
                            <select className="input" value={invFilters.area} onChange={(e) => setInvFilters({ ...invFilters, area: e.target.value })}>
                                <option value="">Todas</option>
                                {Object.entries(AREAS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                            </select>
                        </Field>
                        <Field label="Buscar"><input className="input" placeholder="Codigo, nombre, marca, serie" value={invFilters.q} onChange={(e) => setInvFilters({ ...invFilters, q: e.target.value })} /></Field>
                        <button type="submit" className="btn btn-secondary"><Search size={16} /> Buscar</button>
                    </form>

                    {inventario.resumen && (
                        <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
                            <Tile label="Equipos activos" value={inventario.resumen.total} />
                            <Tile label="Operativos" value={inventario.resumen.operativo} tone="text-emerald-600" />
                            <Tile label="En mantenimiento" value={inventario.resumen.en_mantenimiento} tone="text-sky-600" />
                            <Tile label="Averiados" value={inventario.resumen.averiado} tone="text-rose-600" />
                            <Tile label="Valor de compra" value={money(inventario.resumen.valor_compra)} />
                        </div>
                    )}

                    <div className="card p-0 overflow-hidden">
                        <div className="overflow-x-auto">
                            <table className="w-full">
                                <thead>
                                    <tr className="text-left text-xs uppercase text-gray-500 border-b bg-gray-50/60">
                                        <th className="px-5 py-3">Equipo</th>
                                        <th className="px-5 py-3">Area / Categoria</th>
                                        <th className="px-5 py-3">Marca / Modelo</th>
                                        {isSuperadmin && invFilters.sede === 'todas' && <th className="px-5 py-3">Sede</th>}
                                        <th className="px-5 py-3">Proximo mant.</th>
                                        <th className="px-5 py-3">Estado</th>
                                        <th className="px-5 py-3 text-right">Acciones</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {loading && <tr><td colSpan={7} className="py-10 text-center font-bold text-gray-500">Cargando equipos...</td></tr>}
                                    {!loading && inventario.equipos.map((e) => (
                                        <tr key={e.id} className={`border-b border-gray-100 align-top ${e.estado === 'baja' ? 'opacity-60' : ''}`}>
                                            <td className="px-5 py-4">
                                                <p className="font-semibold">{e.nombre}</p>
                                                <p className="text-xs text-gray-500 font-mono">{e.codigo}{e.serie ? ` · S/N ${e.serie}` : ''}</p>
                                            </td>
                                            <td className="px-5 py-4 text-sm"><p className="font-semibold">{AREAS[e.area]}</p><p className="text-xs text-gray-500">{CATEGORIAS[e.categoria]}{e.almacen_nombre ? ` · ${e.almacen_nombre}` : ''}</p></td>
                                            <td className="px-5 py-4 text-sm">{[e.marca, e.modelo].filter(Boolean).join(' · ') || <span className="text-gray-400">—</span>}
                                                {Number(e.en_garantia) === 1 && <p className="text-[10px] text-emerald-600 font-bold flex items-center gap-1 mt-0.5"><ShieldCheck size={11} /> En garantia</p>}
                                            </td>
                                            {isSuperadmin && invFilters.sede === 'todas' && <td className="px-5 py-4 text-sm">{e.sede_nombre}</td>}
                                            <td className={`px-5 py-4 text-sm font-semibold ${e.proximo_mantenimiento && e.proximo_mantenimiento < today ? 'text-rose-600' : ''}`}>
                                                {e.proximo_mantenimiento ? formatFecha(e.proximo_mantenimiento) : <span className="text-gray-400">—</span>}
                                            </td>
                                            <td className="px-5 py-4"><Badge map={ESTADO_EQUIPO} value={e.estado} /></td>
                                            <td className="px-5 py-4">
                                                <div className="flex items-center justify-end gap-1">
                                                    {e.estado !== 'baja' && (
                                                        <button className="btn btn-secondary text-xs px-3 py-2" onClick={() => setFallaTarget(e)}><AlertTriangle size={14} /> Reportar falla</button>
                                                    )}
                                                    <button className="p-2 text-gray-500 hover:text-brand-600" title="Hoja de vida" aria-label={`Ver ${e.codigo}`} onClick={() => openHojaVida(e.id)}><Eye size={16} /></button>
                                                </div>
                                            </td>
                                        </tr>
                                    ))}
                                    {!loading && inventario.equipos.length === 0 && (
                                        <tr><td colSpan={7} className="py-12 text-center text-gray-500"><Wrench className="mx-auto mb-2 text-gray-300" size={32} />No hay equipos registrados con esos filtros.</td></tr>
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </>
            )}

            {tab === 'pendientes' && (
                <>
                    <div className="card p-5 flex flex-col sm:flex-row gap-3 sm:items-end">
                        {isSuperadmin && <div className="sm:w-72">{sedeSelect(pendSede, setPendSede)}</div>}
                        <button className="btn btn-secondary sm:w-fit" onClick={() => refresh('pendientes')}><Search size={16} /> Actualizar</button>
                    </div>
                    {pendientes.resumen && (
                        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                            <Tile label="Programados" value={pendientes.resumen.programados} tone="text-amber-600" />
                            <Tile label="Vencidos" value={pendientes.resumen.vencidos} tone="text-rose-600" />
                            <Tile label="En ejecucion" value={pendientes.resumen.en_ejecucion} tone="text-sky-600" />
                            <Tile label="Averias abiertas" value={pendientes.resumen.averias_abiertas} tone="text-rose-600" />
                        </div>
                    )}
                    <MantenimientosTable rows={pendientes.mantenimientos} loading={loading} actions={mantenimientoActions} showSede={isSuperadmin && pendSede === 'todas'} pendientes />
                </>
            )}

            {tab === 'historial' && (
                <>
                    <form onSubmit={(e) => { e.preventDefault(); refresh('historial'); }}
                        className="card p-5 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_1.2fr_auto] gap-3 items-end">
                        <Field label="Desde"><input type="date" className="input" value={histFilters.desde} onChange={(e) => setHistFilters({ ...histFilters, desde: e.target.value })} required /></Field>
                        <Field label="Hasta"><input type="date" className="input" value={histFilters.hasta} min={histFilters.desde} onChange={(e) => setHistFilters({ ...histFilters, hasta: e.target.value })} required /></Field>
                        {sedeSelect(histFilters.sede, (sede) => setHistFilters({ ...histFilters, sede }))}
                        <button type="submit" className="btn btn-secondary"><Search size={16} /> Buscar</button>
                    </form>
                    {historial.resumen && (
                        <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
                            <Tile label="Ejecutados" value={historial.resumen.ejecutados} tone="text-emerald-600" />
                            <Tile label="Costo de mantenimiento" value={money(historial.resumen.costo_total)} />
                            <Tile label="Anulados" value={historial.resumen.cantidad - historial.resumen.ejecutados} />
                        </div>
                    )}
                    <MantenimientosTable rows={historial.mantenimientos} loading={loading} actions={mantenimientoActions} showSede={isSuperadmin && histFilters.sede === 'todas'} />
                </>
            )}

            {equipoForm && (
                <EquipoModal initial={equipoForm} proveedores={proveedores} sedeNombre={activeSede?.nombre} today={today} onClose={() => setEquipoForm(null)}
                    onSaved={(e, editado) => { setEquipoForm(null); afterChange(editado ? `Equipo ${e.codigo} actualizado.` : `Equipo ${e.codigo} registrado.`, e.id); }} />
            )}

            {hojaVida && (
                <HojaVidaModal equipo={hojaVida} isAdmin={isAdmin} onClose={() => setHojaVida(null)}
                    onEditar={() => setEquipoForm(hojaVida)}
                    onFalla={() => setFallaTarget(hojaVida)}
                    onPlan={(plan) => setPlanForm({ equipo: hojaVida, plan })}
                    onProgramar={() => setProgramarTarget(hojaVida)}
                    onBaja={() => setMotivoTarget({ tipo: 'baja', id: hojaVida.id, equipoId: hojaVida.id, titulo: `Dar de baja ${hojaVida.codigo}` })}
                    actions={mantenimientoActions} />
            )}

            {fallaTarget && (
                <FallaModal equipo={fallaTarget} onClose={() => setFallaTarget(null)}
                    onSaved={(m) => { setFallaTarget(null); afterChange(`Falla reportada (${m.codigo}). El administrador la vera en mantenimientos pendientes.`, m.equipo_id); }} />
            )}

            {planForm && (
                <PlanModal equipo={planForm.equipo} plan={planForm.plan} today={today} onClose={() => setPlanForm(null)}
                    onSaved={() => { setPlanForm(null); afterChange('Plan de mantenimiento guardado.', planForm.equipo.id); }} />
            )}

            {programarTarget && (
                <ProgramarModal equipo={programarTarget} today={today} onClose={() => setProgramarTarget(null)}
                    onSaved={(m) => { setProgramarTarget(null); afterChange(`Mantenimiento ${m.codigo} programado para el ${formatFecha(m.fecha_programada)}.`, m.equipo_id); }} />
            )}

            {ejecutarTarget && (
                <EjecutarModal mantenimiento={ejecutarTarget} proveedores={proveedores} today={today} onClose={() => setEjecutarTarget(null)}
                    onSaved={(m) => { setEjecutarTarget(null); afterChange(`${m.codigo} ejecutado${m.gasto_codigo ? ` y registrado como gasto ${m.gasto_codigo}` : ''}.`, m.equipo_id); }} />
            )}

            {motivoTarget && (
                <MotivoModal target={motivoTarget} onClose={() => setMotivoTarget(null)}
                    onDone={(text) => { setMotivoTarget(null); afterChange(text, motivoTarget.equipoId); }} />
            )}
        </div>
    );
};

const MantenimientosTable = ({ rows, loading, actions, showSede, pendientes = false }) => (
    <div className="card p-0 overflow-hidden">
        <div className="overflow-x-auto">
            <table className="w-full">
                <thead>
                    <tr className="text-left text-xs uppercase text-gray-500 border-b bg-gray-50/60">
                        <th className="px-5 py-3">{pendientes ? 'Programado' : 'Fecha'}</th>
                        <th className="px-5 py-3">Equipo</th>
                        <th className="px-5 py-3">Mantenimiento</th>
                        {showSede && <th className="px-5 py-3">Sede</th>}
                        {!pendientes && <th className="px-5 py-3 text-right">Costo</th>}
                        <th className="px-5 py-3">Estado</th>
                        <th className="px-5 py-3 text-right">Acciones</th>
                    </tr>
                </thead>
                <tbody>
                    {loading && <tr><td colSpan={7} className="py-10 text-center font-bold text-gray-500">Cargando...</td></tr>}
                    {!loading && rows.map((m) => (
                        <tr key={m.id} className="border-b border-gray-100 align-top">
                            <td className="px-5 py-4">
                                <p className={`font-bold text-sm ${Number(m.vencido) ? 'text-rose-600' : ''}`}>{formatFecha(m.fecha_ejecucion || m.fecha_programada)}</p>
                                <p className="text-xs text-gray-500 font-mono">{m.codigo}</p>
                                {Number(m.vencido) === 1 && <p className="text-[10px] font-black text-rose-600 uppercase">Vencido</p>}
                            </td>
                            <td className="px-5 py-4"><p className="font-semibold">{m.equipo_nombre}</p><p className="text-xs text-gray-500 font-mono">{m.equipo_codigo} · {AREAS[m.equipo_area]}</p></td>
                            <td className="px-5 py-4 text-sm max-w-[320px]">
                                <p className="font-bold capitalize">{m.tipo}{m.tipo === 'correctivo' && <span className={`ml-2 text-[10px] uppercase ${PRIORIDAD[m.prioridad]}`}>Prioridad {m.prioridad}</span>}</p>
                                <p className="text-gray-600 line-clamp-2" title={m.descripcion}>{m.trabajo_realizado || m.descripcion}</p>
                                {m.reportado_por_nombre && <p className="text-[11px] text-gray-400">Reportado por {m.reportado_por_nombre}</p>}
                                {m.estado === 'anulado' && m.motivo_anulacion && <p className="text-[11px] text-gray-400">Anulado: {m.motivo_anulacion}</p>}
                            </td>
                            {showSede && <td className="px-5 py-4 text-sm">{m.sede_nombre}</td>}
                            {!pendientes && <td className="px-5 py-4 text-right tabular-nums">{m.estado === 'ejecutado' ? money(m.costo_total) : '—'}{m.gasto_codigo && <p className="text-[10px] text-gray-500">Gasto {m.gasto_codigo}</p>}</td>}
                            <td className="px-5 py-4"><Badge map={ESTADO_MANT} value={m.estado} /></td>
                            <td className="px-5 py-4">{actions(m)}</td>
                        </tr>
                    ))}
                    {!loading && rows.length === 0 && (
                        <tr><td colSpan={7} className="py-12 text-center text-gray-500"><CalendarClock className="mx-auto mb-2 text-gray-300" size={32} />{pendientes ? 'No hay mantenimientos pendientes.' : 'No hay mantenimientos en ese rango.'}</td></tr>
                    )}
                </tbody>
            </table>
        </div>
    </div>
);

const EquipoModal = ({ initial, proveedores, sedeNombre, today, onClose, onSaved }) => {
    const editing = Boolean(initial.id);
    const [form, setForm] = useState({
        codigo: initial.codigo || '', nombre: initial.nombre || '', categoria: initial.categoria || 'coccion', area: initial.area || 'cocina',
        marca: initial.marca || '', modelo: initial.modelo || '', serie: initial.serie || '', proveedor_id: initial.proveedor_id ? String(initial.proveedor_id) : '',
        fecha_compra: initial.fecha_compra || '', costo_compra: initial.costo_compra ?? '', garantia_hasta: initial.garantia_hasta || '', observacion: initial.observacion || ''
    });
    const [saving, setSaving] = useState(false);
    const [formError, setFormError] = useState('');
    const set = (patch) => setForm((prev) => ({ ...prev, ...patch }));

    const save = async (event) => {
        event.preventDefault();
        setSaving(true);
        setFormError('');
        try {
            const body = { ...form, proveedor_id: form.proveedor_id ? Number(form.proveedor_id) : null };
            const saved = await postJson(editing ? `/api/equipos/${initial.id}` : '/api/equipos', body, 'No se pudo guardar el equipo.', editing ? 'PUT' : 'POST');
            onSaved(saved, editing);
        } catch (e) {
            setFormError(e.message);
        } finally {
            setSaving(false);
        }
    };

    return (
        <Modal title={editing ? `Editar ${initial.codigo}` : 'Nuevo equipo'} subtitle={editing ? initial.sede_nombre : `Sede: ${sedeNombre}`} wide onClose={onClose}>
            <ErrorBox text={formError} />
            <form onSubmit={save} className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-[2fr_1fr] gap-3">
                    <Field label="Nombre"><input className="input" placeholder="Ej. Congeladora horizontal 400 L" value={form.nombre} onChange={(e) => set({ nombre: e.target.value })} required minLength={3} maxLength={150} /></Field>
                    <Field label="Codigo (opcional)"><input className="input font-mono" placeholder="Automatico" value={form.codigo} onChange={(e) => set({ codigo: e.target.value.toUpperCase() })} maxLength={30} /></Field>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <Field label="Categoria">
                        <select className="input" value={form.categoria} onChange={(e) => set({ categoria: e.target.value })}>
                            {Object.entries(CATEGORIAS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                        </select>
                    </Field>
                    <Field label="Area">
                        <select className="input" value={form.area} onChange={(e) => set({ area: e.target.value })}>
                            {Object.entries(AREAS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                        </select>
                    </Field>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <Field label="Marca"><input className="input" value={form.marca} onChange={(e) => set({ marca: e.target.value })} maxLength={80} /></Field>
                    <Field label="Modelo"><input className="input" value={form.modelo} onChange={(e) => set({ modelo: e.target.value })} maxLength={80} /></Field>
                    <Field label="N° de serie"><input className="input" value={form.serie} onChange={(e) => set({ serie: e.target.value })} maxLength={80} /></Field>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <Field label="Proveedor (opcional)">
                        <select className="input" value={form.proveedor_id} onChange={(e) => set({ proveedor_id: e.target.value })}>
                            <option value="">—</option>
                            {proveedores.map((p) => <option key={p.id} value={p.id}>{p.razon_social}</option>)}
                        </select>
                    </Field>
                    <Field label="Costo de compra (S/)"><input type="number" min="0" step="0.01" className="input" value={form.costo_compra} onChange={(e) => set({ costo_compra: e.target.value })} /></Field>
                    <Field label="Fecha de compra"><input type="date" className="input" max={today} value={form.fecha_compra} onChange={(e) => set({ fecha_compra: e.target.value })} /></Field>
                    <Field label="Garantia hasta"><input type="date" className="input" value={form.garantia_hasta} onChange={(e) => set({ garantia_hasta: e.target.value })} /></Field>
                </div>
                <Field label="Observacion (opcional)"><textarea className="input min-h-[70px]" value={form.observacion} onChange={(e) => set({ observacion: e.target.value })} maxLength={500} /></Field>
                <div className="flex gap-3 pt-2">
                    <button type="button" className="btn btn-secondary flex-1" onClick={onClose}>Cancelar</button>
                    <button type="submit" className="btn btn-primary flex-1" disabled={saving}>{saving ? 'Guardando...' : 'Guardar equipo'}</button>
                </div>
            </form>
        </Modal>
    );
};

const HojaVidaModal = ({ equipo, isAdmin, onClose, onEditar, onFalla, onPlan, onProgramar, onBaja, actions }) => {
    const activo = equipo.estado !== 'baja';
    return (
        <Modal title={`${equipo.codigo} · ${equipo.nombre}`} subtitle={`${equipo.sede_nombre} · ${AREAS[equipo.area]} · ${CATEGORIAS[equipo.categoria]}`} wide onClose={onClose}>
            <div className="flex flex-wrap items-center gap-2 mb-4">
                <Badge map={ESTADO_EQUIPO} value={equipo.estado} />
                {Number(equipo.en_garantia) === 1 && <span className="text-[10px] font-black text-emerald-600 uppercase tracking-widest flex items-center gap-1"><ShieldCheck size={12} /> En garantia hasta {formatFecha(equipo.garantia_hasta)}</span>}
            </div>
            {equipo.estado === 'baja' && <p className="mb-4 p-3 rounded-xl bg-gray-100 text-sm">De baja desde {formatDateTime(equipo.fecha_baja)}: {equipo.motivo_baja}</p>}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm">
                <Info label="Marca / Modelo" value={[equipo.marca, equipo.modelo].filter(Boolean).join(' · ') || '—'} />
                <Info label="N° de serie" value={equipo.serie || '—'} />
                <Info label="Proveedor" value={equipo.proveedor_nombre || '—'} />
                <Info label="Ubicación (almacén)" value={equipo.almacen_nombre || '—'} />
                <Info label="Fecha de compra" value={formatFecha(equipo.fecha_compra)} />
                <Info label="Costo de compra" value={equipo.costo_compra !== null ? money(equipo.costo_compra) : '—'} />
                <Info label="Gastado en mantenimiento" value={money(equipo.costo_mantenimiento)} strong />
            </div>
            {equipo.observacion && <p className="text-sm text-gray-600 mt-3">{equipo.observacion}</p>}

            <div className="mt-6 flex items-center justify-between">
                <p className="text-xs font-black uppercase tracking-widest text-gray-500">Planes preventivos</p>
                {isAdmin && activo && <button className="text-xs font-bold text-brand-600" onClick={() => onPlan(null)}>+ Nuevo plan</button>}
            </div>
            <div className="mt-2 space-y-2">
                {equipo.planes.map((p) => (
                    <div key={p.id} className={`flex items-center justify-between gap-3 p-3 rounded-xl border ${Number(p.activo) ? 'border-gray-100' : 'bg-gray-50 opacity-60'}`}>
                        <div className="min-w-0 text-sm">
                            <p className="font-bold">{p.nombre} · cada {p.frecuencia_dias} dias</p>
                            <p className="text-xs text-gray-500">{Number(p.activo) ? `Proximo: ${formatFecha(p.proxima_fecha)}` : 'Inactivo'}{p.responsable ? ` · ${p.responsable}` : ''}</p>
                        </div>
                        {isAdmin && activo && <button className="p-2 text-gray-500 hover:text-brand-600" aria-label={`Editar plan ${p.nombre}`} onClick={() => onPlan(p)}><Edit2 size={14} /></button>}
                    </div>
                ))}
                {equipo.planes.length === 0 && <p className="text-sm text-gray-500">Sin planes preventivos.</p>}
            </div>

            <p className="mt-6 text-xs font-black uppercase tracking-widest text-gray-500">Mantenimientos</p>
            <div className="mt-2 space-y-2">
                {equipo.mantenimientos.map((m) => (
                    <div key={m.id} className="p-3 rounded-xl border border-gray-100 text-sm">
                        <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                                <p className="font-bold"><span className="font-mono text-xs text-gray-500">{m.codigo}</span> · <span className="capitalize">{m.tipo}</span> · {formatFecha(m.fecha_ejecucion || m.fecha_programada)}</p>
                                <p className="text-gray-600">{m.trabajo_realizado || m.descripcion}</p>
                                {m.diagnostico && <p className="text-xs text-gray-500">Diagnostico: {m.diagnostico}</p>}
                                {(m.tecnico || m.proveedor_nombre) && <p className="text-xs text-gray-500">Tecnico: {m.proveedor_nombre || m.tecnico}</p>}
                            </div>
                            <div className="text-right shrink-0">
                                <Badge map={ESTADO_MANT} value={m.estado} />
                                {m.estado === 'ejecutado' && <p className="font-black mt-1 tabular-nums">{money(m.costo_total)}</p>}
                            </div>
                        </div>
                        {['programado', 'en_ejecucion'].includes(m.estado) && isAdmin && <div className="mt-2">{actions(m)}</div>}
                    </div>
                ))}
                {equipo.mantenimientos.length === 0 && <p className="text-sm text-gray-500">Aun no tiene mantenimientos.</p>}
            </div>

            <div className="grid grid-cols-2 gap-3 mt-6">
                {activo && <button className="btn btn-secondary" onClick={onFalla}><AlertTriangle size={16} /> Reportar falla</button>}
                {isAdmin && activo && <button className="btn btn-secondary" onClick={onProgramar}><CalendarClock size={16} /> Programar</button>}
                {isAdmin && activo && <button className="btn btn-secondary" onClick={onEditar}><Edit2 size={16} /> Editar datos</button>}
                {isAdmin && activo && <button className="btn btn-secondary text-rose-600" onClick={onBaja}><Trash2 size={16} /> Dar de baja</button>}
            </div>
            <button className="btn btn-secondary w-full mt-3" onClick={onClose}>Cerrar</button>
        </Modal>
    );
};

const FallaModal = ({ equipo, onClose, onSaved }) => {
    const [form, setForm] = useState({ descripcion: '', prioridad: 'media', fuera_de_servicio: false });
    const [saving, setSaving] = useState(false);
    const [formError, setFormError] = useState('');
    const save = async (event) => {
        event.preventDefault();
        setSaving(true);
        setFormError('');
        try {
            onSaved(await postJson(`/api/equipos/${equipo.id}/reportar-falla`, form, 'No se pudo reportar la falla.'));
        } catch (e) {
            setFormError(e.message);
        } finally {
            setSaving(false);
        }
    };
    return (
        <Modal title="Reportar falla" subtitle={`${equipo.codigo} · ${equipo.nombre}`} onClose={onClose}>
            <ErrorBox text={formError} />
            <form onSubmit={save} className="space-y-4">
                <Field label="Que esta pasando?"><textarea className="input min-h-[90px]" placeholder="Ej. La congeladora no enfria, hace ruido fuerte..." value={form.descripcion} onChange={(e) => setForm({ ...form, descripcion: e.target.value })} required minLength={5} maxLength={900} /></Field>
                <Field label="Prioridad">
                    <ToggleGroup options={[{ value: 'baja', label: 'Baja' }, { value: 'media', label: 'Media' }, { value: 'alta', label: 'Alta' }]} value={form.prioridad} onChange={(prioridad) => setForm({ ...form, prioridad })} />
                </Field>
                <label className="flex items-center gap-2 text-sm font-semibold">
                    <input type="checkbox" checked={form.fuera_de_servicio} onChange={(e) => setForm({ ...form, fuera_de_servicio: e.target.checked })} />
                    El equipo no funciona (marcarlo como averiado)
                </label>
                <div className="flex gap-3 pt-2">
                    <button type="button" className="btn btn-secondary flex-1" onClick={onClose}>Cancelar</button>
                    <button type="submit" className="btn btn-primary flex-1" disabled={saving}>{saving ? 'Enviando...' : 'Reportar'}</button>
                </div>
            </form>
        </Modal>
    );
};

const PlanModal = ({ equipo, plan, today, onClose, onSaved }) => {
    const [form, setForm] = useState({
        nombre: plan?.nombre || '', frecuencia_dias: plan?.frecuencia_dias || 30, proxima_fecha: plan?.proxima_fecha || addDaysYmd(today, 30),
        responsable: plan?.responsable || '', instrucciones: plan?.instrucciones || '', activo: plan ? Boolean(Number(plan.activo)) : true
    });
    const [saving, setSaving] = useState(false);
    const [formError, setFormError] = useState('');
    const save = async (event) => {
        event.preventDefault();
        setSaving(true);
        setFormError('');
        try {
            const body = { ...form, frecuencia_dias: Number(form.frecuencia_dias), equipo_id: equipo.id };
            onSaved(await postJson(plan ? `/api/mantenimiento-planes/${plan.id}` : '/api/mantenimiento-planes', body, 'No se pudo guardar el plan.', plan ? 'PUT' : 'POST'));
        } catch (e) {
            setFormError(e.message);
        } finally {
            setSaving(false);
        }
    };
    return (
        <Modal title={plan ? 'Editar plan preventivo' : 'Nuevo plan preventivo'} subtitle={`${equipo.codigo} · ${equipo.nombre}`} onClose={onClose}>
            <ErrorBox text={formError} />
            <form onSubmit={save} className="space-y-4">
                <Field label="Nombre"><input className="input" placeholder="Ej. Limpieza de campana y filtros" value={form.nombre} onChange={(e) => setForm({ ...form, nombre: e.target.value })} required minLength={3} maxLength={150} /></Field>
                <div className="grid grid-cols-2 gap-3">
                    <Field label="Cada (dias)"><input type="number" min={1} max={3650} className="input" value={form.frecuencia_dias} onChange={(e) => setForm({ ...form, frecuencia_dias: e.target.value })} required /></Field>
                    <Field label="Proximo"><input type="date" className="input" value={form.proxima_fecha} onChange={(e) => setForm({ ...form, proxima_fecha: e.target.value })} required /></Field>
                </div>
                <Field label="Responsable / tecnico (opcional)"><input className="input" value={form.responsable} onChange={(e) => setForm({ ...form, responsable: e.target.value })} maxLength={150} /></Field>
                <Field label="Instrucciones (opcional)"><textarea className="input min-h-[80px]" value={form.instrucciones} onChange={(e) => setForm({ ...form, instrucciones: e.target.value })} maxLength={2000} /></Field>
                {plan && (
                    <label className="flex items-center gap-2 text-sm font-semibold">
                        <input type="checkbox" checked={form.activo} onChange={(e) => setForm({ ...form, activo: e.target.checked })} />
                        Plan activo (si se desactiva, se anula el mantenimiento programado)
                    </label>
                )}
                <div className="flex gap-3 pt-2">
                    <button type="button" className="btn btn-secondary flex-1" onClick={onClose}>Cancelar</button>
                    <button type="submit" className="btn btn-primary flex-1" disabled={saving}>{saving ? 'Guardando...' : 'Guardar plan'}</button>
                </div>
            </form>
        </Modal>
    );
};

const ProgramarModal = ({ equipo, today, onClose, onSaved }) => {
    const [form, setForm] = useState({ tipo: 'correctivo', fecha_programada: today, descripcion: '', prioridad: 'media', tecnico: '' });
    const [saving, setSaving] = useState(false);
    const [formError, setFormError] = useState('');
    const save = async (event) => {
        event.preventDefault();
        setSaving(true);
        setFormError('');
        try {
            onSaved(await postJson('/api/mantenimientos', { ...form, equipo_id: equipo.id }, 'No se pudo programar.'));
        } catch (e) {
            setFormError(e.message);
        } finally {
            setSaving(false);
        }
    };
    return (
        <Modal title="Programar mantenimiento" subtitle={`${equipo.codigo} · ${equipo.nombre}`} onClose={onClose}>
            <ErrorBox text={formError} />
            <form onSubmit={save} className="space-y-4">
                <Field label="Tipo"><ToggleGroup options={[{ value: 'preventivo', label: 'Preventivo' }, { value: 'correctivo', label: 'Correctivo' }]} value={form.tipo} onChange={(tipo) => setForm({ ...form, tipo })} /></Field>
                <div className="grid grid-cols-2 gap-3">
                    <Field label="Fecha"><input type="date" className="input" value={form.fecha_programada} onChange={(e) => setForm({ ...form, fecha_programada: e.target.value })} required /></Field>
                    <Field label="Prioridad">
                        <select className="input" value={form.prioridad} onChange={(e) => setForm({ ...form, prioridad: e.target.value })}>
                            <option value="baja">Baja</option><option value="media">Media</option><option value="alta">Alta</option>
                        </select>
                    </Field>
                </div>
                <Field label="Descripcion"><textarea className="input min-h-[80px]" value={form.descripcion} onChange={(e) => setForm({ ...form, descripcion: e.target.value })} required minLength={5} maxLength={1000} /></Field>
                <Field label="Tecnico (opcional)"><input className="input" value={form.tecnico} onChange={(e) => setForm({ ...form, tecnico: e.target.value })} maxLength={150} /></Field>
                <div className="flex gap-3 pt-2">
                    <button type="button" className="btn btn-secondary flex-1" onClick={onClose}>Cancelar</button>
                    <button type="submit" className="btn btn-primary flex-1" disabled={saving}>{saving ? 'Guardando...' : 'Programar'}</button>
                </div>
            </form>
        </Modal>
    );
};

const EjecutarModal = ({ mantenimiento, proveedores, today, onClose, onSaved }) => {
    const [form, setForm] = useState({
        diagnostico: '', trabajo_realizado: '', fecha_ejecucion: today, tecnico: mantenimiento.tecnico || '', proveedor_id: '',
        costo_material: '', costo_servicio: '', estado_equipo: 'operativo'
    });
    const [registrarGasto, setRegistrarGasto] = useState(false);
    const [gasto, setGasto] = useState({ tipo_documento: 'boleta', serie: '', numero: '', condicion_pago: 'contado', fecha_vencimiento: addDaysYmd(today, 15), metodo_pago: 'efectivo', referencia: '' });
    const [saving, setSaving] = useState(false);
    const [formError, setFormError] = useState('');
    const set = (patch) => setForm((prev) => ({ ...prev, ...patch }));
    const total = (Number(form.costo_material) || 0) + (Number(form.costo_servicio) || 0);

    const save = async (event) => {
        event.preventDefault();
        setSaving(true);
        setFormError('');
        try {
            const body = {
                ...form,
                proveedor_id: form.proveedor_id ? Number(form.proveedor_id) : null,
                costo_material: Number(form.costo_material) || 0,
                costo_servicio: Number(form.costo_servicio) || 0,
                gasto: registrarGasto && total > 0 ? {
                    tipo_documento: gasto.tipo_documento,
                    serie: gasto.serie,
                    numero: gasto.numero,
                    condicion_pago: gasto.condicion_pago,
                    fecha_vencimiento: gasto.condicion_pago === 'credito' ? gasto.fecha_vencimiento : undefined,
                    afectacion: ['recibo_honorarios', 'sin_comprobante'].includes(gasto.tipo_documento) ? undefined : 'gravado',
                    pago: gasto.condicion_pago === 'contado' ? { metodo_pago: gasto.metodo_pago, referencia: gasto.referencia } : undefined
                } : undefined
            };
            onSaved(await postJson(`/api/mantenimientos/${mantenimiento.id}/ejecutar`, body, 'No se pudo registrar la ejecucion.'));
        } catch (e) {
            setFormError(e.message);
        } finally {
            setSaving(false);
        }
    };

    return (
        <Modal title={`Ejecutar ${mantenimiento.codigo}`} subtitle={`${mantenimiento.equipo_codigo} · ${mantenimiento.equipo_nombre} · ${mantenimiento.tipo}`} wide onClose={onClose}>
            <ErrorBox text={formError} />
            <p className="text-sm text-gray-600 mb-4">{mantenimiento.descripcion}</p>
            <form onSubmit={save} className="space-y-4">
                <Field label="Diagnostico (opcional)"><input className="input" value={form.diagnostico} onChange={(e) => set({ diagnostico: e.target.value })} maxLength={2000} /></Field>
                <Field label="Trabajo realizado"><textarea className="input min-h-[80px]" value={form.trabajo_realizado} onChange={(e) => set({ trabajo_realizado: e.target.value })} required minLength={5} maxLength={2000} /></Field>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <Field label="Fecha"><input type="date" className="input" max={today} value={form.fecha_ejecucion} onChange={(e) => set({ fecha_ejecucion: e.target.value })} required /></Field>
                    <Field label="Tecnico"><input className="input" value={form.tecnico} onChange={(e) => set({ tecnico: e.target.value })} maxLength={150} /></Field>
                    <Field label="Proveedor (opcional)">
                        <select className="input" value={form.proveedor_id} onChange={(e) => set({ proveedor_id: e.target.value })}>
                            <option value="">—</option>
                            {proveedores.map((p) => <option key={p.id} value={p.id}>{p.razon_social}</option>)}
                        </select>
                    </Field>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-end">
                    <Field label="Repuestos / materiales (S/)"><input type="number" min="0" step="0.01" className="input" value={form.costo_material} onChange={(e) => set({ costo_material: e.target.value })} /></Field>
                    <Field label="Mano de obra / servicio (S/)"><input type="number" min="0" step="0.01" className="input" value={form.costo_servicio} onChange={(e) => set({ costo_servicio: e.target.value })} /></Field>
                    <p className="pb-3 text-sm">Total: <span className="font-black text-lg">{money(total)}</span></p>
                </div>
                <Field label="Como queda el equipo">
                    <ToggleGroup options={[{ value: 'operativo', label: 'Operativo' }, { value: 'averiado', label: 'Sigue averiado' }]} value={form.estado_equipo} onChange={(estado_equipo) => set({ estado_equipo })} />
                </Field>

                <div className={`p-4 rounded-2xl border ${registrarGasto ? 'border-brand-200 bg-brand-50/30' : 'border-gray-100 bg-gray-50'}`}>
                    <label className="flex items-center gap-2 text-sm font-bold">
                        <input type="checkbox" checked={registrarGasto} onChange={(e) => setRegistrarGasto(e.target.checked)} disabled={total <= 0} />
                        Registrar {money(total)} como gasto (Mantenimiento y reparaciones)
                    </label>
                    {total <= 0 && <p className="text-xs text-gray-500 mt-1">Ingresa el costo para poder registrarlo como gasto.</p>}
                    {registrarGasto && total > 0 && (
                        <div className="space-y-3 mt-3">
                            <div className="grid grid-cols-1 sm:grid-cols-[1.4fr_0.8fr_1fr] gap-3">
                                <Field label="Comprobante">
                                    <select className="input" value={gasto.tipo_documento} onChange={(e) => setGasto({ ...gasto, tipo_documento: e.target.value })}>
                                        <option value="factura">Factura</option><option value="boleta">Boleta</option><option value="ticket">Ticket</option>
                                        <option value="recibo_honorarios">Recibo por honorarios</option><option value="sin_comprobante">Sin comprobante</option>
                                    </select>
                                </Field>
                                {gasto.tipo_documento !== 'sin_comprobante' && (
                                    <>
                                        <Field label="Serie"><input className="input" value={gasto.serie} onChange={(e) => setGasto({ ...gasto, serie: e.target.value.toUpperCase() })} maxLength={20} /></Field>
                                        <Field label="Numero"><input className="input" value={gasto.numero} onChange={(e) => setGasto({ ...gasto, numero: e.target.value })} required={['factura', 'boleta', 'recibo_honorarios'].includes(gasto.tipo_documento)} maxLength={30} /></Field>
                                    </>
                                )}
                            </div>
                            <ToggleGroup options={[{ value: 'contado', label: 'Pagado (contado)' }, { value: 'credito', label: 'Por pagar (credito)' }]} value={gasto.condicion_pago} onChange={(condicion_pago) => setGasto({ ...gasto, condicion_pago })} />
                            {gasto.condicion_pago === 'credito' ? (
                                <Field label="Vence"><input type="date" className="input" min={form.fecha_ejecucion} value={gasto.fecha_vencimiento} onChange={(e) => setGasto({ ...gasto, fecha_vencimiento: e.target.value })} required /></Field>
                            ) : (
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                    <Field label="Metodo de pago">
                                        <select className="input" value={gasto.metodo_pago} onChange={(e) => setGasto({ ...gasto, metodo_pago: e.target.value })}>
                                            {METODOS_COBRO.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
                                        </select>
                                    </Field>
                                    {gasto.metodo_pago === 'efectivo'
                                        ? <p className="text-xs text-gray-500 self-end pb-2">El pago no se vincula a ninguna caja.</p>
                                        : <Field label="N° de operacion (opcional)"><input className="input" value={gasto.referencia} onChange={(e) => setGasto({ ...gasto, referencia: e.target.value })} maxLength={100} /></Field>}
                                </div>
                            )}
                        </div>
                    )}
                </div>

                <div className="flex gap-3 pt-2">
                    <button type="button" className="btn btn-secondary flex-1" onClick={onClose}>Cancelar</button>
                    <button type="submit" className="btn btn-primary flex-1" disabled={saving}>{saving ? 'Guardando...' : 'Marcar como ejecutado'}</button>
                </div>
            </form>
        </Modal>
    );
};

const MotivoModal = ({ target, onClose, onDone }) => {
    const [motivo, setMotivo] = useState('');
    const [saving, setSaving] = useState(false);
    const [formError, setFormError] = useState('');
    const save = async (event) => {
        event.preventDefault();
        setSaving(true);
        setFormError('');
        try {
            const url = target.tipo === 'baja' ? `/api/equipos/${target.id}/baja` : `/api/mantenimientos/${target.id}/anular`;
            await postJson(url, { motivo }, 'No se pudo completar la accion.');
            onDone(target.tipo === 'baja' ? 'Equipo dado de baja; sus mantenimientos programados se anularon.' : 'Mantenimiento anulado.');
        } catch (e) {
            setFormError(e.message);
        } finally {
            setSaving(false);
        }
    };
    return (
        <Modal title={target.titulo} subtitle={target.tipo === 'baja' ? 'El equipo sale del inventario activo y se conserva su historial.' : 'Si pertenece a un plan, se programa el siguiente.'} onClose={onClose}>
            <ErrorBox text={formError} />
            <form onSubmit={save} className="space-y-4">
                <Field label="Motivo"><input className="input" value={motivo} onChange={(e) => setMotivo(e.target.value)} required minLength={3} maxLength={200} autoFocus /></Field>
                <div className="flex gap-3 pt-2">
                    <button type="button" className="btn btn-secondary flex-1" onClick={onClose}>Volver</button>
                    <button type="submit" className="btn flex-1 bg-rose-600 hover:bg-rose-700 text-white" disabled={saving}>{saving ? 'Guardando...' : 'Confirmar'}</button>
                </div>
            </form>
        </Modal>
    );
};

const Info = ({ label, value, strong = false }) => (
    <div className="min-w-0">
        <p className="text-[10px] font-black uppercase tracking-widest text-gray-500">{label}</p>
        <p className={`mt-0.5 ${strong ? 'font-black' : 'font-semibold'}`}>{value}</p>
    </div>
);

const Tile = ({ label, value, tone = 'text-[var(--text-primary)]' }) => (
    <div className="card p-5">
        <p className="text-[10px] font-black uppercase tracking-widest text-gray-500">{label}</p>
        <p className={`text-2xl font-display font-black mt-1 tabular-nums ${tone}`}>{value ?? 0}</p>
    </div>
);

export default Equipos;
