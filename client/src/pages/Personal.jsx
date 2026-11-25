import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
    Users, Shirt, ClipboardCheck, HardHat, Calculator, Settings2, Plus, Edit2, Download, Search, Paperclip, Trash2, Undo2, Ban, Lock, Power, FileText
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { Modal, Field, ErrorBox } from '../components/billing/billingShared';
import { readJson, money } from '../components/billing/billingUtils';
import { toPeruYmd, addDaysYmd, startOfMonthYmd, formatDateTime } from '../utils/dateTime';
import {
    VINCULO_LABEL, ESTADO_LABEL, ESTADO_ELEMENTO_LABEL,
    exportarTrabajadores, exportarEntregas, exportarControl, exportarControles, exportarElementos, exportarCostos, exportarCatalogo
} from '../utils/exportPersonal';

const TABS = [
    { key: 'trabajadores', label: 'Trabajadores', icon: Users },
    { key: 'entregas', label: 'Uniforme y EPP', icon: Shirt },
    { key: 'control', label: 'Control diario C/NC', icon: ClipboardCheck },
    { key: 'elementos', label: 'Elementos de EPP', icon: HardHat },
    { key: 'costos', label: 'Costos por trabajador y área', icon: Calculator },
    { key: 'config', label: 'Cargos, áreas y turnos', icon: Settings2 }
];
const TIPO_ADJUNTO_LABEL = { contrato: 'Contrato', dni: 'DNI', certificado: 'Certificado', antecedentes: 'Antecedentes', otro: 'Otro' };
const MOTIVOS_ENTREGA = ['Ingreso', 'Reposición por desgaste', 'Cambio programado', 'Cambio de talla', 'Pérdida', 'Reposición por no conformidad'];
const ESTADO_STYLE = {
    activo: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    vacaciones: 'bg-sky-50 text-sky-700 border-sky-200',
    suspendido: 'bg-amber-50 text-amber-700 border-amber-200',
    cesado: 'bg-gray-100 text-gray-500 border-gray-200'
};

const fecha = (ymd) => (ymd ? new Date(`${String(ymd).slice(0, 10)}T00:00:00`).toLocaleDateString('es-PE', { day: '2-digit', month: 'short', year: 'numeric' }) : '—');
const tamano = (bytes) => (bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);
const cant = (v) => Number(v || 0).toLocaleString('es-PE', { maximumFractionDigits: 2 });
const jsonPost = (url, body, method = 'POST') => fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

const Badge = ({ className, children }) => (
    <span className={`inline-block px-2 py-1 rounded-lg border text-[10px] font-black uppercase tracking-widest whitespace-nowrap ${className}`}>{children}</span>
);
const Th = ({ children, right }) => <th className={`px-4 py-3 ${right ? 'text-right' : ''}`}>{children}</th>;
const Tabla = ({ head, children, minWidth = 900 }) => (
    <div className="card p-0 overflow-hidden">
        <div className="overflow-x-auto">
            <table className="w-full text-sm" style={{ minWidth }}>
                <thead><tr className="text-left text-xs uppercase text-gray-500 border-b bg-gray-50/60">{head}</tr></thead>
                <tbody>{children}</tbody>
            </table>
        </div>
    </div>
);
const Vacio = ({ cols, text }) => <tr><td colSpan={cols} className="py-10 text-center text-gray-500">{text}</td></tr>;
const BotonExcel = ({ onClick, disabled }) => (
    <button className="btn btn-secondary text-sm" onClick={onClick} disabled={disabled}><Download size={16} /> Excel</button>
);

const Personal = () => {
    const { activeSede } = useAuth();
    const [tab, setTab] = useState('trabajadores');
    const [opciones, setOpciones] = useState(null);
    const [error, setError] = useState('');
    const [message, setMessage] = useState('');

    const cargarOpciones = async () => {
        try {
            const data = await readJson(await fetch('/api/personal/opciones'), 'No se pudo cargar el módulo Personal.');
            setOpciones(data);
            setError('');
        } catch (e) {
            setError(e.message);
        }
    };
    // Se recarga al cambiar de sede.
    useEffect(() => {
        fetch('/api/personal/opciones')
            .then((res) => readJson(res, 'No se pudo cargar el módulo Personal.'))
            .then((data) => { setOpciones(data); setError(''); })
            .catch((e) => setError(e.message));
    }, [activeSede?.id]);

    const avisar = (texto) => { setMessage(texto); setError(''); };
    const ctx = { opciones, recargarOpciones: cargarOpciones, sede: activeSede?.nombre, avisar, setError };

    return (
        <div className="space-y-8">
            <div>
                <h2 className="text-4xl font-display font-black tracking-tight">Gestión de <span className="text-brand-600">Personal</span></h2>
                <p className="text-[var(--text-secondary)] mt-2">Trabajadores, uniforme y EPP, control diario y costos de {activeSede?.nombre || 'la sede'}.</p>
            </div>

            {message && <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-700 font-semibold">{message}</div>}
            {error && <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 font-semibold">{error}</div>}

            <div className="flex gap-2 overflow-x-auto pb-1" role="tablist">
                {TABS.map(({ key, label, icon }) => (
                    <button key={key} role="tab" aria-selected={tab === key} onClick={() => { setTab(key); setMessage(''); }}
                        className={`shrink-0 flex items-center gap-2 px-4 py-2 rounded-2xl border font-bold text-sm transition-all ${tab === key ? 'bg-brand-600 border-brand-600 text-white' : 'bg-white border-gray-200 text-gray-600 hover:border-brand-300'}`}>
                        {React.createElement(icon, { size: 16 })} {label}
                    </button>
                ))}
            </div>

            {!opciones ? (
                !error && <div className="py-16 flex justify-center"><div className="w-10 h-10 border-4 border-brand-100 border-t-brand-600 rounded-full animate-spin" /></div>
            ) : (
                <>
                    {tab === 'trabajadores' && <TrabajadoresTab {...ctx} />}
                    {tab === 'entregas' && <EntregasTab {...ctx} />}
                    {tab === 'control' && <ControlTab {...ctx} />}
                    {tab === 'elementos' && <ElementosTab {...ctx} />}
                    {tab === 'costos' && <CostosTab {...ctx} />}
                    {tab === 'config' && <ConfigTab {...ctx} />}
                </>
            )}
        </div>
    );
};

// ---------------- Trabajadores ----------------
const TrabajadoresTab = ({ opciones, sede, avisar, setError }) => {
    const [filtros, setFiltros] = useState({ q: '', estado: '', area_id: '', cargo_id: '', turno_id: '', funcion: '' });
    const [lista, setLista] = useState([]);
    const [loading, setLoading] = useState(true);
    const [ficha, setFicha] = useState(null);
    const [dniConsulta, setDniConsulta] = useState('');
    const [consultando, setConsultando] = useState(false);
    const verRem = opciones.puede_ver_remuneracion;

    // Como el sistema de bebidas: consulta RENIEC y abre la ficha nueva con los datos; si el DNI ya tiene ficha, avisa (y la abre si es de la sede).
    const consultarDni = async (event) => {
        event.preventDefault();
        setConsultando(true);
        setError('');
        try {
            const d = await readJson(await fetch(`/api/personal/consulta-dni/${dniConsulta}`), 'No se pudo consultar el DNI.');
            if (d.existe) {
                if (d.misma_sede && d.personal_id) {
                    avisar(`El DNI ${dniConsulta} ya tiene ficha: ${d.trabajador}.`);
                    setFicha({ id: d.personal_id });
                } else {
                    setError(`El DNI ${dniConsulta} ya tiene ficha en la sede ${d.sede} (${d.trabajador}).`);
                }
            } else {
                setFicha({ nuevo: true, inicial: { dni: d.dni, nombres: d.nombres || '', apellidos: d.apellidos || '' } });
            }
            setDniConsulta('');
        } catch (e) {
            // Sin consulta disponible igual se puede crear la ficha a mano con el DNI escrito.
            setError(e.message);
            setFicha({ nuevo: true, inicial: { dni: dniConsulta } });
        } finally {
            setConsultando(false);
        }
    };

    const cargar = useCallback(async (f = filtros) => {
        setLoading(true);
        try {
            const qs = new URLSearchParams(Object.entries(f).filter(([, v]) => v)).toString();
            setLista(await readJson(await fetch(`/api/personal/trabajadores${qs ? `?${qs}` : ''}`), 'No se pudo cargar los trabajadores.'));
        } catch (e) {
            setError(e.message);
        } finally {
            setLoading(false);
        }
    }, [filtros, setError]);
    useEffect(() => { cargar(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

    const set = (patch) => setFiltros((prev) => ({ ...prev, ...patch }));
    const activos = lista.filter((t) => t.estado === 'activo').length;

    return (
        <div className="space-y-4">
            <form className="card p-4 grid grid-cols-2 lg:grid-cols-[2fr_1fr_1fr_1fr_1fr_auto] gap-3 items-end" onSubmit={(e) => { e.preventDefault(); cargar(); }}>
                <Field label="Buscar" className="col-span-2 lg:col-span-1">
                    <input className="input" placeholder="DNI, código, nombres o apellidos" value={filtros.q} onChange={(e) => set({ q: e.target.value })} />
                </Field>
                <Field label="Estado">
                    <select className="input" value={filtros.estado} onChange={(e) => set({ estado: e.target.value })}>
                        <option value="">Todos</option>
                        {opciones.estados.map((v) => <option key={v} value={v}>{ESTADO_LABEL[v]}</option>)}
                    </select>
                </Field>
                <Field label="Área">
                    <select className="input" value={filtros.area_id} onChange={(e) => set({ area_id: e.target.value })}>
                        <option value="">Todas</option>
                        {opciones.areas.map((a) => <option key={a.id} value={a.id}>{a.nombre}</option>)}
                    </select>
                </Field>
                <Field label="Cargo">
                    <select className="input" value={filtros.cargo_id} onChange={(e) => set({ cargo_id: e.target.value })}>
                        <option value="">Todos</option>
                        {opciones.cargos.map((a) => <option key={a.id} value={a.id}>{a.nombre}</option>)}
                    </select>
                </Field>
                <Field label="Turno">
                    <select className="input" value={filtros.turno_id} onChange={(e) => set({ turno_id: e.target.value })}>
                        <option value="">Todos</option>
                        {opciones.turnos.map((a) => <option key={a.id} value={a.id}>{a.nombre}</option>)}
                    </select>
                </Field>
                <button type="submit" className="btn btn-secondary"><Search size={16} /> Buscar</button>
            </form>

            <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-sm text-gray-500">{lista.length} trabajador(es) · {activos} activo(s)</p>
                <div className="flex flex-wrap gap-2 items-center">
                    <form className="flex gap-2 items-center" onSubmit={consultarDni}>
                        <input className="input w-36" inputMode="numeric" maxLength={8} pattern="\d{8}" required placeholder="DNI a consultar" aria-label="DNI a consultar"
                            value={dniConsulta} onChange={(e) => setDniConsulta(e.target.value.replace(/\D/g, ''))} />
                        <button type="submit" className="btn btn-secondary text-sm" disabled={consultando || dniConsulta.length !== 8}>
                            <Search size={16} /> {consultando ? 'Consultando...' : 'Consultar DNI y crear ficha'}
                        </button>
                    </form>
                    <BotonExcel disabled={!lista.length} onClick={() => exportarTrabajadores(sede, lista, verRem).catch((e) => setError(e.message))} />
                    <button className="btn btn-primary text-sm" onClick={() => setFicha({ nuevo: true })}><Plus size={16} /> Nuevo trabajador</button>
                </div>
            </div>

            <Tabla minWidth={980} head={<>
                <Th>Trabajador</Th><Th>Cargo / área</Th><Th>Turno</Th><Th>Vínculo</Th><Th>Ingreso</Th>
                <Th>Docs.</Th><Th>Estado</Th><Th right>Acciones</Th>
            </>}>
                {loading && <Vacio cols={8} text="Cargando trabajadores..." />}
                {!loading && lista.map((t) => (
                    <tr key={t.id} className="border-b border-gray-100 align-top">
                        <td className="px-4 py-3">
                            <p className="font-bold">{t.apellidos}, {t.nombres}</p>
                            <p className="text-xs text-gray-500">DNI {t.dni}{t.codigo ? ` · ${t.codigo}` : ''}</p>
                            {t.funciones && <p className="text-[10px] text-brand-700 font-bold mt-0.5 line-clamp-2 max-w-xs" title={t.funciones}>{t.funciones}</p>}
                        </td>
                        <td className="px-4 py-3"><p className="font-semibold">{t.cargo || '—'}</p><p className="text-xs text-gray-500">{t.area || 'Sin área'}</p></td>
                        <td className="px-4 py-3">{t.turno || '—'}</td>
                        <td className="px-4 py-3">{VINCULO_LABEL[t.vinculo] || t.vinculo}</td>
                        <td className="px-4 py-3 whitespace-nowrap">{fecha(t.fecha_ingreso)}{t.fecha_cese && <p className="text-xs text-gray-500">Cese: {fecha(t.fecha_cese)}</p>}</td>
                        <td className="px-4 py-3">{t.adjuntos > 0 ? <span className="flex items-center gap-1 text-brand-700 font-bold"><Paperclip size={14} />{t.adjuntos}</span> : <span className="text-gray-300">—</span>}</td>
                        <td className="px-4 py-3"><Badge className={ESTADO_STYLE[t.estado]}>{ESTADO_LABEL[t.estado]}</Badge></td>
                        <td className="px-4 py-3 text-right">
                            <button className="btn btn-secondary text-xs px-3 py-2" onClick={() => setFicha({ id: t.id })}><Edit2 size={14} /> Ficha</button>
                        </td>
                    </tr>
                ))}
                {!loading && lista.length === 0 && <Vacio cols={8} text="No hay trabajadores con esos filtros. Registra el primero con «Nuevo trabajador»." />}
            </Tabla>

            {ficha && (
                <TrabajadorModal id={ficha.id} inicial={ficha.inicial} opciones={opciones} onClose={() => setFicha(null)}
                    onSaved={(t, nuevo) => { avisar(`Trabajador ${t.nombres} ${t.apellidos} ${nuevo ? 'registrado' : 'actualizado'}.`); cargar(); if (nuevo) setFicha({ id: t.id }); }}
                    onDocs={() => cargar()} />
            )}
        </div>
    );
};

const TRABAJADOR_VACIO = {
    dni: '', codigo: '', nombres: '', apellidos: '', fecha_nacimiento: '', fecha_ingreso: '', fecha_cese: '', cargo_id: '', area_id: '', turno_id: '',
    vinculo: 'planilla', ruc: '', sistema_pension: '', cuspp: '', remuneracion: '', funciones: '', telefono: '', email: '', direccion: '',
    contacto_emergencia: '', telefono_emergencia: '', usuario_id: '', estado: 'activo', observacion: ''
};

const TrabajadorModal = ({ id, inicial, opciones, onClose, onSaved, onDocs }) => {
    const [form, setForm] = useState(null);
    const [detalle, setDetalle] = useState(null);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');
    const verRem = opciones.puede_ver_remuneracion;

    const cargar = useCallback(async () => {
        if (!id) { setForm({ ...TRABAJADOR_VACIO, ...(inicial || {}) }); return; }
        try {
            const t = await readJson(await fetch(`/api/personal/trabajadores/${id}`), 'No se pudo cargar la ficha.');
            setDetalle(t);
            const limpio = {};
            for (const k of Object.keys(TRABAJADOR_VACIO)) limpio[k] = t[k] === null || t[k] === undefined ? TRABAJADOR_VACIO[k] : t[k];
            setForm(limpio);
        } catch (e) {
            setError(e.message);
        }
    }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
    useEffect(() => { cargar(); }, [cargar]);

    const set = (patch) => setForm((prev) => ({ ...prev, ...patch }));

    const save = async (event) => {
        event.preventDefault();
        setSaving(true);
        setError('');
        try {
            const body = { ...form };
            if (!verRem) delete body.remuneracion;
            const t = await readJson(await jsonPost(id ? `/api/personal/trabajadores/${id}` : '/api/personal/trabajadores', body, id ? 'PUT' : 'POST'), 'No se pudo guardar el trabajador.');
            onSaved(t, !id);
            if (id) onClose();
        } catch (e) {
            setError(e.message);
        } finally {
            setSaving(false);
        }
    };

    const sel = (key, items, vacio = 'Sin asignar') => (
        <select className="input" value={form[key] || ''} onChange={(e) => set({ [key]: e.target.value })}>
            <option value="">{vacio}</option>
            {items.filter((i) => Number(i.activo) || String(i.id) === String(form[key])).map((i) => <option key={i.id} value={i.id}>{i.nombre}</option>)}
        </select>
    );

    return (
        <Modal title={id ? 'Ficha del trabajador' : 'Nuevo trabajador'} subtitle={detalle ? `${detalle.nombre_completo} · DNI ${detalle.dni}` : 'Datos personales, vínculo laboral, funciones y contacto.'} xl onClose={onClose}>
            <ErrorBox text={error} />
            {!form ? <p className="py-10 text-center text-gray-500 font-bold">Cargando...</p> : (
                <div className="space-y-8">
                    <form onSubmit={save} className="space-y-6">
                        <section>
                            <h5 className="text-xs font-black uppercase tracking-widest text-gray-500 mb-3">Datos personales</h5>
                            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                                <Field label="DNI"><input className="input" inputMode="numeric" maxLength={8} value={form.dni} onChange={(e) => set({ dni: e.target.value.replace(/\D/g, '') })} required pattern="\d{8}" autoFocus={!id} /></Field>
                                <Field label="Código (opcional)"><input className="input" maxLength={30} value={form.codigo} onChange={(e) => set({ codigo: e.target.value })} /></Field>
                                <Field label="Nombres"><input className="input" value={form.nombres} onChange={(e) => set({ nombres: e.target.value })} required maxLength={120} /></Field>
                                <Field label="Apellidos"><input className="input" value={form.apellidos} onChange={(e) => set({ apellidos: e.target.value })} required maxLength={120} /></Field>
                                <Field label="Fecha de nacimiento"><input type="date" className="input" value={form.fecha_nacimiento} onChange={(e) => set({ fecha_nacimiento: e.target.value })} /></Field>
                                <Field label="Teléfono"><input className="input" value={form.telefono} onChange={(e) => set({ telefono: e.target.value })} maxLength={40} /></Field>
                                <Field label="Correo"><input type="email" className="input" value={form.email} onChange={(e) => set({ email: e.target.value })} maxLength={120} /></Field>
                                <Field label="Dirección"><input className="input" value={form.direccion} onChange={(e) => set({ direccion: e.target.value })} maxLength={300} /></Field>
                                <Field label="Contacto de emergencia"><input className="input" value={form.contacto_emergencia} onChange={(e) => set({ contacto_emergencia: e.target.value })} maxLength={150} placeholder="Nombre y parentesco" /></Field>
                                <Field label="Teléfono de emergencia"><input className="input" value={form.telefono_emergencia} onChange={(e) => set({ telefono_emergencia: e.target.value })} maxLength={40} /></Field>
                            </div>
                        </section>

                        <section>
                            <h5 className="text-xs font-black uppercase tracking-widest text-gray-500 mb-3">Vínculo laboral</h5>
                            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                                <Field label="Cargo">{sel('cargo_id', opciones.cargos)}</Field>
                                <Field label="Área">{sel('area_id', opciones.areas)}</Field>
                                <Field label="Turno">{sel('turno_id', opciones.turnos)}</Field>
                                <Field label="Tipo de vínculo">
                                    <select className="input" value={form.vinculo} onChange={(e) => set({ vinculo: e.target.value })}>
                                        {opciones.vinculos.map((v) => <option key={v} value={v}>{VINCULO_LABEL[v]}</option>)}
                                    </select>
                                </Field>
                                <Field label="Fecha de ingreso"><input type="date" className="input" max={toPeruYmd()} value={form.fecha_ingreso} onChange={(e) => set({ fecha_ingreso: e.target.value })} /></Field>
                                <Field label="Estado">
                                    <select className="input" value={form.estado} onChange={(e) => set({ estado: e.target.value, fecha_cese: e.target.value === 'cesado' ? (form.fecha_cese || toPeruYmd()) : '' })}>
                                        {opciones.estados.map((v) => <option key={v} value={v}>{ESTADO_LABEL[v]}</option>)}
                                    </select>
                                </Field>
                                {form.estado === 'cesado' && <Field label="Fecha de cese"><input type="date" className="input" value={form.fecha_cese} onChange={(e) => set({ fecha_cese: e.target.value })} required /></Field>}
                                {verRem && <Field label="Remuneración mensual (S/)"><input type="number" min="0" step="0.01" className="input" value={form.remuneracion ?? ''} onChange={(e) => set({ remuneracion: e.target.value })} /></Field>}
                                <Field label="Sistema de pensión"><input className="input" list="sistemas-pension" value={form.sistema_pension} onChange={(e) => set({ sistema_pension: e.target.value })} maxLength={60} /></Field>
                                <Field label="CUSPP"><input className="input" value={form.cuspp} onChange={(e) => set({ cuspp: e.target.value })} maxLength={30} /></Field>
                                <Field label="RUC (honorarios)"><input className="input" inputMode="numeric" maxLength={11} value={form.ruc} onChange={(e) => set({ ruc: e.target.value.replace(/\D/g, '') })} /></Field>
                                <Field label="Usuario del sistema">
                                    <select className="input" value={form.usuario_id || ''} onChange={(e) => set({ usuario_id: e.target.value })}>
                                        <option value="">Sin vincular</option>
                                        {opciones.usuarios.map((u) => <option key={u.id} value={u.id}>{u.nombre} ({u.usuario})</option>)}
                                    </select>
                                </Field>
                                <datalist id="sistemas-pension">
                                    {['ONP', 'AFP Integra', 'AFP Prima', 'AFP Profuturo', 'AFP Habitat', 'No aplica'].map((x) => <option key={x} value={x} />)}
                                </datalist>
                            </div>
                        </section>

                        <section>
                            <h5 className="text-xs font-black uppercase tracking-widest text-gray-500 mb-3">Funciones</h5>
                            <textarea className="input min-h-[80px]" maxLength={4000} value={form.funciones} onChange={(e) => set({ funciones: e.target.value })}
                                placeholder="Describa las funciones del trabajador. Ej.: Atención de mesas del salón, apoyo en caja en el turno tarde." aria-label="Funciones" />
                        </section>

                        <Field label="Observación"><textarea className="input min-h-[70px]" maxLength={2000} value={form.observacion} onChange={(e) => set({ observacion: e.target.value })} /></Field>

                        <div className="flex gap-3">
                            <button type="button" className="btn btn-secondary flex-1" onClick={onClose}>Cerrar</button>
                            <button type="submit" className="btn btn-primary flex-1" disabled={saving}>{saving ? 'Guardando...' : id ? 'Guardar cambios' : 'Registrar trabajador'}</button>
                        </div>
                    </form>

                    {id && detalle && <DocumentosTrabajador personalId={id} documentos={detalle.documentos} tipos={opciones.tipos_adjunto} maxBytes={opciones.max_adjunto} onChanged={() => { cargar(); onDocs(); }} />}

                    {id && detalle && (
                        <section>
                            <h5 className="text-xs font-black uppercase tracking-widest text-gray-500 mb-3">Uniforme y EPP entregado</h5>
                            {detalle.entregas.length === 0 ? <p className="text-sm text-gray-500">Sin entregas registradas.</p> : (
                                <div className="overflow-x-auto">
                                    <table className="w-full text-sm min-w-[600px]">
                                        <thead><tr className="text-left text-[10px] uppercase text-gray-500 border-b"><th className="py-2 pr-3">Fecha</th><th className="py-2 pr-3">Elemento</th><th className="py-2 pr-3 text-right">Cant.</th><th className="py-2 pr-3 text-right">Pendiente</th><th className="py-2 pr-3">Devolución / baja</th><th className="py-2 pr-3">Próx. cambio</th><th className="py-2 text-right">Costo</th></tr></thead>
                                        <tbody>
                                            {detalle.entregas.map((e) => (
                                                <tr key={e.id} className={`border-b border-gray-50 ${Number(e.anulada) ? 'opacity-50 line-through' : ''}`}>
                                                    <td className="py-2 pr-3">{fecha(e.fecha)}</td>
                                                    <td className="py-2 pr-3">{e.elemento_nombre}{e.talla ? ` · talla ${e.talla}` : ''}</td>
                                                    <td className="py-2 pr-3 text-right">{cant(e.cantidad)}</td>
                                                    <td className="py-2 pr-3 text-right">{cant(e.pendiente)}</td>
                                                    <td className="py-2 pr-3 text-xs"><FechasMovimiento e={e} /></td>
                                                    <td className="py-2 pr-3">{fecha(e.proximo_cambio)}</td>
                                                    <td className="py-2 text-right tabular-nums">{money(e.costo_total)}</td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            )}
                        </section>
                    )}
                </div>
            )}
        </Modal>
    );
};

const DocumentosTrabajador = ({ personalId, documentos, tipos, maxBytes, onChanged }) => {
    const [tipo, setTipo] = useState('contrato');
    const [subiendo, setSubiendo] = useState(false);
    const [error, setError] = useState('');

    const subir = async (event) => {
        const file = event.target.files?.[0];
        event.target.value = '';
        if (!file) return;
        setError('');
        if (file.size > maxBytes) { setError(`El archivo pesa ${tamano(file.size)}: el máximo es ${tamano(maxBytes)}.`); return; }
        if (!['application/pdf', 'image/jpeg', 'image/png'].includes(file.type)) { setError('Solo se admiten archivos PDF, JPG o PNG.'); return; }
        setSubiendo(true);
        try {
            await readJson(await fetch(`/api/personal/trabajadores/${personalId}/adjuntos?nombre=${encodeURIComponent(file.name)}&tipo=${tipo}`, {
                method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: file
            }), 'No se pudo subir el documento.');
            onChanged();
        } catch (e) {
            setError(e.message);
        } finally {
            setSubiendo(false);
        }
    };

    const descargar = async (doc) => {
        setError('');
        try {
            const res = await fetch(`/api/personal/adjuntos/${doc.id}`);
            if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'No se pudo descargar el documento.');
            const url = URL.createObjectURL(await res.blob());
            const a = document.createElement('a');
            a.href = url;
            a.download = doc.nombre;
            a.click();
            setTimeout(() => URL.revokeObjectURL(url), 2000);
        } catch (e) {
            setError(e.message);
        }
    };

    const eliminar = async (doc) => {
        if (!window.confirm(`¿Eliminar el documento "${doc.nombre}"?`)) return;
        try {
            await readJson(await fetch(`/api/personal/adjuntos/${doc.id}`, { method: 'DELETE' }), 'No se pudo eliminar el documento.');
            onChanged();
        } catch (e) {
            setError(e.message);
        }
    };

    return (
        <section>
            <h5 className="text-xs font-black uppercase tracking-widest text-gray-500 mb-3">Documentos adjuntos</h5>
            <ErrorBox text={error} />
            <div className="flex flex-wrap items-end gap-3 mb-3">
                <Field label="Tipo de documento">
                    <select className="input" value={tipo} onChange={(e) => setTipo(e.target.value)}>
                        {tipos.map((t) => <option key={t} value={t}>{TIPO_ADJUNTO_LABEL[t] || t}</option>)}
                    </select>
                </Field>
                <label className={`btn btn-secondary cursor-pointer ${subiendo ? 'opacity-50 pointer-events-none' : ''}`}>
                    <input type="file" accept="application/pdf,image/jpeg,image/png" className="sr-only" onChange={subir} disabled={subiendo} />
                    <Paperclip size={16} /> {subiendo ? 'Subiendo...' : 'Adjuntar archivo'}
                </label>
                <p className="text-xs text-gray-500">PDF, JPG o PNG de hasta {tamano(maxBytes)}.</p>
            </div>
            {documentos.length === 0 ? <p className="text-sm text-gray-500">Sin documentos adjuntos.</p> : (
                <ul className="divide-y divide-gray-100 border border-gray-100 rounded-2xl">
                    {documentos.map((d) => (
                        <li key={d.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                            <FileText size={18} className="text-brand-600" />
                            <div className="flex-1 min-w-[180px]">
                                <p className="font-bold text-sm break-all">{d.nombre}</p>
                                <p className="text-xs text-gray-500">{TIPO_ADJUNTO_LABEL[d.tipo] || d.tipo} · {tamano(d.tamano)} · {formatDateTime(d.creado_en)}{d.usuario_nombre ? ` · ${d.usuario_nombre}` : ''}</p>
                            </div>
                            <button className="btn btn-secondary text-xs px-3 py-2" onClick={() => descargar(d)}><Download size={14} /> Descargar</button>
                            <button className="p-2 text-gray-500 hover:text-rose-600" aria-label={`Eliminar ${d.nombre}`} onClick={() => eliminar(d)}><Trash2 size={16} /></button>
                        </li>
                    ))}
                </ul>
            )}
        </section>
    );
};

// ---------------- Uniforme y EPP ----------------
const EntregasTab = ({ opciones, sede, avisar, setError }) => {
    const hoy = toPeruYmd();
    const [filtros, setFiltros] = useState({ desde: addDaysYmd(hoy, -90), hasta: hoy, vista: '', tipo: '', personal_id: '' });
    const [lista, setLista] = useState([]);
    const [trabajadores, setTrabajadores] = useState([]);
    const [loading, setLoading] = useState(true);
    const [nueva, setNueva] = useState(null);
    const [devolver, setDevolver] = useState(null);
    const [anular, setAnular] = useState(null);

    const cargar = useCallback(async (f = filtros) => {
        setLoading(true);
        try {
            const qs = new URLSearchParams(Object.entries(f).filter(([k, v]) => v && !(f.vista && ['desde', 'hasta'].includes(k)))).toString();
            setLista(await readJson(await fetch(`/api/personal/entregas?${qs}`), 'No se pudo cargar las entregas.'));
        } catch (e) {
            setError(e.message);
        } finally {
            setLoading(false);
        }
    }, [filtros, setError]);
    useEffect(() => {
        cargar();
        fetch('/api/personal/trabajadores?estado=activo').then((r) => (r.ok ? r.json() : [])).then(setTrabajadores).catch(() => {});
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    const set = (patch) => setFiltros((prev) => ({ ...prev, ...patch }));
    const vigentes = lista.filter((e) => !Number(e.anulada));
    const total = vigentes.reduce((acc, e) => acc + e.costo_total, 0);

    return (
        <div className="space-y-4">
            <form className="card p-4 grid grid-cols-2 lg:grid-cols-[1fr_1fr_1.4fr_1fr_1.6fr_auto] gap-3 items-end" onSubmit={(e) => { e.preventDefault(); cargar(); }}>
                <Field label="Desde"><input type="date" className="input" value={filtros.desde} disabled={Boolean(filtros.vista)} onChange={(e) => set({ desde: e.target.value })} /></Field>
                <Field label="Hasta"><input type="date" className="input" value={filtros.hasta} disabled={Boolean(filtros.vista)} onChange={(e) => set({ hasta: e.target.value })} /></Field>
                <Field label="Vista">
                    <select className="input" value={filtros.vista} onChange={(e) => set({ vista: e.target.value })}>
                        <option value="">Entregas del periodo</option>
                        <option value="por_cambiar">Por cambiar (próximos 15 días)</option>
                        <option value="por_devolver">Pendientes de devolver o dar de baja</option>
                    </select>
                </Field>
                <Field label="Tipo">
                    <select className="input" value={filtros.tipo} onChange={(e) => set({ tipo: e.target.value })}>
                        <option value="">EPP y uniformes</option>
                        <option value="epp">EPP</option>
                        <option value="uniforme">Uniformes</option>
                    </select>
                </Field>
                <Field label="Trabajador">
                    <select className="input" value={filtros.personal_id} onChange={(e) => set({ personal_id: e.target.value })}>
                        <option value="">Todos</option>
                        {trabajadores.map((t) => <option key={t.id} value={t.id}>{t.apellidos}, {t.nombres}</option>)}
                    </select>
                </Field>
                <button type="submit" className="btn btn-secondary"><Search size={16} /> Buscar</button>
            </form>

            <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-sm text-gray-500">{vigentes.length} entrega(s) · costo {money(total)}</p>
                <div className="flex gap-2">
                    <BotonExcel disabled={!lista.length} onClick={() => exportarEntregas(sede, lista).catch((e) => setError(e.message))} />
                    <button className="btn btn-primary text-sm" onClick={() => setNueva({})}><Plus size={16} /> Registrar entrega</button>
                </div>
            </div>

            <Tabla minWidth={1000} head={<>
                <Th>Fecha</Th><Th>Trabajador</Th><Th>Elemento</Th><Th right>Cant.</Th><Th right>Pendiente</Th><Th>Estado</Th><Th>Devolución / baja</Th><Th>Próx. cambio</Th><Th right>Costo</Th><Th right>Acciones</Th>
            </>}>
                {loading && <Vacio cols={10} text="Cargando entregas..." />}
                {!loading && lista.map((e) => {
                    const anulada = Number(e.anulada);
                    const vence = e.proximo_cambio && e.proximo_cambio <= hoy && e.pendiente > 0 && !anulada;
                    return (
                        <tr key={e.id} className={`border-b border-gray-100 align-top ${anulada ? 'opacity-50' : ''}`}>
                            <td className="px-4 py-3 whitespace-nowrap">{fecha(e.fecha)}</td>
                            <td className="px-4 py-3"><p className="font-bold">{e.trabajador}</p><p className="text-xs text-gray-500">DNI {e.dni}{e.area ? ` · ${e.area}` : ''}</p></td>
                            <td className="px-4 py-3">
                                <p className="font-semibold">{e.elemento_nombre}</p>
                                <p className="text-xs text-gray-500">{e.elemento_tipo === 'uniforme' ? 'Uniforme' : 'EPP'}{e.talla ? ` · talla ${e.talla}` : ''} · {e.motivo}</p>
                                {anulada ? <p className="text-xs text-rose-600 font-bold">Anulada: {e.motivo_anulacion}</p> : null}
                            </td>
                            <td className="px-4 py-3 text-right tabular-nums">{cant(e.cantidad)} {e.unidad}</td>
                            <td className="px-4 py-3 text-right tabular-nums">{cant(e.pendiente)}</td>
                            <td className="px-4 py-3">{ESTADO_ELEMENTO_LABEL[e.estado] || e.estado}</td>
                            <td className="px-4 py-3 text-xs whitespace-nowrap"><FechasMovimiento e={e} /></td>
                            <td className={`px-4 py-3 whitespace-nowrap ${vence ? 'text-rose-600 font-bold' : ''}`}>{fecha(e.proximo_cambio)}</td>
                            <td className="px-4 py-3 text-right tabular-nums font-bold">{money(e.costo_total)}</td>
                            <td className="px-4 py-3 text-right whitespace-nowrap">
                                {!anulada && e.pendiente > 0 && (
                                    <button className="p-2 text-gray-500 hover:text-brand-600" title="Registrar devolución o baja" aria-label="Registrar devolución o baja" onClick={() => setDevolver(e)}><Undo2 size={16} /></button>
                                )}
                                {!anulada && e.devuelta === 0 && !e.baja && (
                                    <button className="p-2 text-gray-500 hover:text-rose-600" title="Anular entrega" aria-label="Anular entrega" onClick={() => setAnular(e)}><Ban size={16} /></button>
                                )}
                            </td>
                        </tr>
                    );
                })}
                {!loading && lista.length === 0 && <Vacio cols={10} text="No hay entregas con esos filtros." />}
            </Tabla>

            {nueva && <EntregaModal inicial={nueva} opciones={opciones} trabajadores={trabajadores} onClose={() => setNueva(null)} onSaved={(e) => { setNueva(null); avisar(`Entrega registrada: ${e.elemento_nombre} para ${e.trabajador}.`); cargar(); }} />}
            {devolver && <DevolucionModal entrega={devolver} onClose={() => setDevolver(null)} onSaved={(tipo) => { setDevolver(null); avisar(tipo === 'baja' ? 'Baja registrada.' : 'Devolución registrada.'); cargar(); }} />}
            {anular && <MotivoModal titulo="Anular entrega" subtitulo={`${anular.elemento_nombre} · ${anular.trabajador}`} url={`/api/personal/entregas/${anular.id}/anular`}
                onClose={() => setAnular(null)} onSaved={() => { setAnular(null); avisar('Entrega anulada.'); cargar(); }} />}
        </div>
    );
};

const EntregaModal = ({ inicial, opciones, trabajadores, onClose, onSaved }) => {
    const elementos = opciones.elementos.filter((e) => Number(e.activo));
    const [form, setForm] = useState({
        personal_id: inicial.personal_id ? String(inicial.personal_id) : '', elemento_id: inicial.elemento_id ? String(inicial.elemento_id) : '',
        fecha: toPeruYmd(), cantidad: '1', talla: '', estado: 'nuevo', motivo: inicial.control_detalle_id ? 'Reposición por no conformidad' : 'Ingreso',
        costo_unitario: '', proximo_cambio: '', control_detalle_id: inicial.control_detalle_id || null
    });
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');
    const set = (patch) => setForm((prev) => ({ ...prev, ...patch }));
    const elemento = elementos.find((e) => String(e.id) === String(form.elemento_id));
    const costo = form.costo_unitario === '' ? Number(elemento?.costo_unitario || 0) : Number(form.costo_unitario);

    const save = async (event) => {
        event.preventDefault();
        setSaving(true);
        setError('');
        try {
            onSaved(await readJson(await jsonPost('/api/personal/entregas', form), 'No se pudo registrar la entrega.'));
        } catch (e) {
            setError(e.message);
        } finally {
            setSaving(false);
        }
    };

    return (
        <Modal title="Registrar entrega de uniforme / EPP" subtitle="El próximo cambio se calcula con la frecuencia del elemento." wide onClose={onClose}>
            <ErrorBox text={error} />
            <form onSubmit={save} className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <Field label="Trabajador">
                        <select className="input" value={form.personal_id} onChange={(e) => set({ personal_id: e.target.value })} required disabled={Boolean(inicial.control_detalle_id)}>
                            <option value="">Elegir...</option>
                            {trabajadores.map((t) => <option key={t.id} value={t.id}>{t.apellidos}, {t.nombres} · {t.area || 'sin área'}</option>)}
                        </select>
                    </Field>
                    <Field label="Elemento">
                        <select className="input" value={form.elemento_id} onChange={(e) => set({ elemento_id: e.target.value })} required disabled={Boolean(inicial.control_detalle_id)}>
                            <option value="">Elegir...</option>
                            {elementos.map((e) => <option key={e.id} value={e.id}>{e.nombre} ({e.tipo === 'uniforme' ? 'uniforme' : 'EPP'})</option>)}
                        </select>
                    </Field>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <Field label="Fecha"><input type="date" className="input" max={toPeruYmd()} value={form.fecha} onChange={(e) => set({ fecha: e.target.value })} required /></Field>
                    <Field label={`Cantidad${elemento ? ` (${elemento.unidad})` : ''}`}><input type="number" min="0.01" step="0.01" className="input" value={form.cantidad} onChange={(e) => set({ cantidad: e.target.value })} required /></Field>
                    <Field label="Talla"><input className="input" maxLength={30} value={form.talla} onChange={(e) => set({ talla: e.target.value })} /></Field>
                    <Field label="Estado">
                        <select className="input" value={form.estado} onChange={(e) => set({ estado: e.target.value })}>
                            {opciones.estados_elemento.map((v) => <option key={v} value={v}>{ESTADO_ELEMENTO_LABEL[v]}</option>)}
                        </select>
                    </Field>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <Field label="Motivo">
                        <input className="input" list="motivos-entrega" value={form.motivo} onChange={(e) => set({ motivo: e.target.value })} required minLength={3} maxLength={500} />
                        <datalist id="motivos-entrega">{MOTIVOS_ENTREGA.map((m) => <option key={m} value={m} />)}</datalist>
                    </Field>
                    <Field label="Costo unitario (S/)">
                        <input type="number" min="0" step="0.01" className="input" placeholder={elemento?.costo_unitario != null ? String(elemento.costo_unitario) : '0.00'} value={form.costo_unitario} onChange={(e) => set({ costo_unitario: e.target.value })} />
                    </Field>
                    <Field label="Próximo cambio (opcional)"><input type="date" className="input" min={form.fecha} value={form.proximo_cambio} onChange={(e) => set({ proximo_cambio: e.target.value })} /></Field>
                </div>
                <p className="text-sm text-gray-600">Costo de la entrega: <strong>{money(costo * (Number(form.cantidad) || 0))}</strong>
                    {elemento && Number(elemento.frecuencia_meses) > 0 && !form.proximo_cambio && <span className="text-gray-500"> · cambio cada {elemento.frecuencia_meses} mes(es)</span>}
                </p>
                <div className="flex gap-3">
                    <button type="button" className="btn btn-secondary flex-1" onClick={onClose}>Cancelar</button>
                    <button type="submit" className="btn btn-primary flex-1" disabled={saving}>{saving ? 'Guardando...' : 'Registrar entrega'}</button>
                </div>
            </form>
        </Modal>
    );
};

// Fechas de la ultima devolucion y de la ultima baja de una entrega (con lo devuelto / dado de baja).
const FechasMovimiento = ({ e }) => (
    <>
        {e.fecha_devolucion && <p>Devolución: {fecha(e.fecha_devolucion)} ({cant(e.devuelta)})</p>}
        {e.fecha_baja && <p className="text-rose-600">Baja: {fecha(e.fecha_baja)} ({cant(e.baja)})</p>}
        {!e.fecha_devolucion && !e.fecha_baja && <span className="text-gray-300">—</span>}
    </>
);

const DevolucionModal = ({ entrega, onClose, onSaved }) => {
    const [form, setForm] = useState({ tipo: 'devolucion', cantidad: String(entrega.pendiente), fecha: toPeruYmd(), estado: 'bueno', motivo: '' });
    const [historial, setHistorial] = useState([]);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');
    useEffect(() => {
        fetch(`/api/personal/entregas/${entrega.id}/movimientos`).then((r) => (r.ok ? r.json() : [])).then(setHistorial).catch(() => {});
    }, [entrega.id]);
    const esBaja = form.tipo === 'baja';
    const save = async (event) => {
        event.preventDefault();
        setSaving(true);
        setError('');
        try {
            await readJson(await jsonPost(`/api/personal/entregas/${entrega.id}/devolver`, form), esBaja ? 'No se pudo registrar la baja.' : 'No se pudo registrar la devolución.');
            onSaved(form.tipo);
        } catch (e) {
            setError(e.message);
        } finally {
            setSaving(false);
        }
    };
    return (
        <Modal title="Registrar devolución o baja" subtitle={`${entrega.elemento_nombre} · ${entrega.trabajador} · pendiente ${cant(entrega.pendiente)}`} onClose={onClose}>
            <ErrorBox text={error} />
            <form onSubmit={save} className="space-y-4">
                <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Tipo de movimiento">
                    {[['devolucion', 'Devolución', 'El trabajador devuelve el elemento.'], ['baja', 'Baja', 'El elemento se pierde, se daña o se descarta.']].map(([v, l, d]) => (
                        <label key={v} className={`p-3 rounded-xl border cursor-pointer ${form.tipo === v ? 'bg-brand-50 border-brand-300' : 'bg-white border-gray-200'}`}>
                            <input type="radio" name="tipo" className="sr-only" checked={form.tipo === v} onChange={() => setForm({ ...form, tipo: v, estado: v === 'baja' ? 'danado' : 'bueno' })} />
                            <p className="font-black text-sm">{l}</p><p className="text-xs text-gray-500">{d}</p>
                        </label>
                    ))}
                </div>
                <div className="grid grid-cols-3 gap-3">
                    <Field label="Cantidad"><input type="number" min="0.01" max={entrega.pendiente} step="0.01" className="input" value={form.cantidad} onChange={(e) => setForm({ ...form, cantidad: e.target.value })} required /></Field>
                    <Field label={esBaja ? 'Fecha de baja' : 'Fecha de devolución'}><input type="date" className="input" min={entrega.fecha} max={toPeruYmd()} value={form.fecha} onChange={(e) => setForm({ ...form, fecha: e.target.value })} required /></Field>
                    <Field label="Estado">
                        <select className="input" value={form.estado} onChange={(e) => setForm({ ...form, estado: e.target.value })}>
                            {['bueno', 'regular', 'danado'].map((v) => <option key={v} value={v}>{ESTADO_ELEMENTO_LABEL[v]}</option>)}
                        </select>
                    </Field>
                </div>
                <Field label="Motivo"><input className="input" value={form.motivo} onChange={(e) => setForm({ ...form, motivo: e.target.value })} required minLength={3} maxLength={500} placeholder={esBaja ? 'Ej. Pérdida, rotura, desgaste total' : 'Ej. Cese, cambio de talla'} autoFocus /></Field>
                {historial.length > 0 && (
                    <div className="text-xs border border-gray-100 rounded-xl p-3 space-y-1">
                        <p className="font-black uppercase tracking-widest text-gray-500 text-[10px]">Historial</p>
                        {historial.map((h) => (
                            <p key={h.id}>{fecha(h.fecha)} · <strong>{h.tipo === 'baja' ? 'Baja' : 'Devolución'}</strong> {cant(h.cantidad)} · {ESTADO_ELEMENTO_LABEL[h.estado] || h.estado} · {h.motivo}{h.usuario_nombre ? ` · ${h.usuario_nombre}` : ''}</p>
                        ))}
                    </div>
                )}
                <div className="flex gap-3">
                    <button type="button" className="btn btn-secondary flex-1" onClick={onClose}>Cancelar</button>
                    <button type="submit" className="btn btn-primary flex-1" disabled={saving}>{saving ? 'Guardando...' : esBaja ? 'Registrar baja' : 'Registrar devolución'}</button>
                </div>
            </form>
        </Modal>
    );
};

const MotivoModal = ({ titulo, subtitulo, url, onClose, onSaved }) => {
    const [motivo, setMotivo] = useState('');
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');
    const save = async (event) => {
        event.preventDefault();
        setSaving(true);
        setError('');
        try {
            await readJson(await jsonPost(url, { motivo }), 'No se pudo completar la acción.');
            onSaved();
        } catch (e) {
            setError(e.message);
        } finally {
            setSaving(false);
        }
    };
    return (
        <Modal title={titulo} subtitle={subtitulo} onClose={onClose}>
            <ErrorBox text={error} />
            <form onSubmit={save} className="space-y-4">
                <Field label="Motivo"><input className="input" value={motivo} onChange={(e) => setMotivo(e.target.value)} required minLength={3} maxLength={255} autoFocus /></Field>
                <div className="flex gap-3">
                    <button type="button" className="btn btn-secondary flex-1" onClick={onClose}>Cancelar</button>
                    <button type="submit" className="btn btn-primary flex-1" disabled={saving}>{saving ? 'Guardando...' : 'Confirmar'}</button>
                </div>
            </form>
        </Modal>
    );
};

// ---------------- Control diario C/NC ----------------
const ControlTab = ({ opciones, sede, avisar, setError }) => {
    const hoy = toPeruYmd();
    const [rango, setRango] = useState({ desde: startOfMonthYmd(hoy), hasta: hoy });
    const [nuevo, setNuevo] = useState({ fecha: hoy, turno_id: '', area_id: '' });
    const [lista, setLista] = useState([]);
    const [loading, setLoading] = useState(true);
    const [abierto, setAbierto] = useState(null);
    const [creando, setCreando] = useState(false);

    const cargar = useCallback(async (r = rango) => {
        setLoading(true);
        try {
            setLista(await readJson(await fetch(`/api/personal/controles?desde=${r.desde}&hasta=${r.hasta}`), 'No se pudo cargar los controles.'));
        } catch (e) {
            setError(e.message);
        } finally {
            setLoading(false);
        }
    }, [rango, setError]);
    useEffect(() => { cargar(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

    const abrir = async (event) => {
        event.preventDefault();
        setCreando(true);
        setError('');
        try {
            const c = await readJson(await jsonPost('/api/personal/controles', nuevo), 'No se pudo abrir el control.');
            setAbierto(c.id);
            cargar();
        } catch (e) {
            setError(e.message);
        } finally {
            setCreando(false);
        }
    };

    const turnos = opciones.turnos.filter((t) => Number(t.activo));
    const areas = opciones.areas.filter((a) => Number(a.activo));

    return (
        <div className="space-y-4">
            <form className="card p-4 grid grid-cols-1 sm:grid-cols-[1fr_1fr_1fr_auto] gap-3 items-end" onSubmit={abrir}>
                <Field label="Fecha del control"><input type="date" className="input" max={hoy} value={nuevo.fecha} onChange={(e) => setNuevo({ ...nuevo, fecha: e.target.value })} required /></Field>
                <Field label="Turno">
                    <select className="input" value={nuevo.turno_id} onChange={(e) => setNuevo({ ...nuevo, turno_id: e.target.value })} required>
                        <option value="">Elegir...</option>
                        {turnos.map((t) => <option key={t.id} value={t.id}>{t.nombre}{t.hora_inicio ? ` (${t.hora_inicio}-${t.hora_fin || ''})` : ''}</option>)}
                    </select>
                </Field>
                <Field label="Área (opcional)">
                    <select className="input" value={nuevo.area_id} onChange={(e) => setNuevo({ ...nuevo, area_id: e.target.value })}>
                        <option value="">Todas las áreas</option>
                        {areas.map((a) => <option key={a.id} value={a.id}>{a.nombre}</option>)}
                    </select>
                </Field>
                <button type="submit" className="btn btn-primary" disabled={creando}><ClipboardCheck size={16} /> {creando ? 'Abriendo...' : 'Abrir control'}</button>
            </form>
            <p className="text-xs text-gray-500">El control lista a los trabajadores activos del turno (y del área elegida) con los elementos marcados «control diario». Si ya existe el control de ese día, turno y área, se abre el mismo.</p>

            <div className="flex flex-wrap items-end justify-between gap-3">
                <form className="flex flex-wrap items-end gap-3" onSubmit={(e) => { e.preventDefault(); cargar(); }}>
                    <Field label="Desde"><input type="date" className="input" value={rango.desde} onChange={(e) => setRango({ ...rango, desde: e.target.value })} /></Field>
                    <Field label="Hasta"><input type="date" className="input" value={rango.hasta} onChange={(e) => setRango({ ...rango, hasta: e.target.value })} /></Field>
                    <button type="submit" className="btn btn-secondary"><Search size={16} /> Buscar</button>
                </form>
                <BotonExcel disabled={!lista.length} onClick={() => exportarControles(sede, lista).catch((e) => setError(e.message))} />
            </div>

            <Tabla minWidth={760} head={<><Th>Fecha</Th><Th>Turno</Th><Th>Área</Th><Th right>Casillas</Th><Th right>NC</Th><Th right>Cumplimiento</Th><Th>Estado</Th><Th right>Acciones</Th></>}>
                {loading && <Vacio cols={8} text="Cargando controles..." />}
                {!loading && lista.map((c) => (
                    <tr key={c.id} className="border-b border-gray-100">
                        <td className="px-4 py-3 whitespace-nowrap font-bold">{fecha(c.fecha)}</td>
                        <td className="px-4 py-3">{c.turno}</td>
                        <td className="px-4 py-3">{c.area || 'Todas'}</td>
                        <td className="px-4 py-3 text-right">{c.items}{c.sin_marcar > 0 ? <span className="text-xs text-amber-600"> ({c.sin_marcar} sin marcar)</span> : ''}</td>
                        <td className="px-4 py-3 text-right">{c.no_conformes}</td>
                        <td className="px-4 py-3 text-right font-black tabular-nums">{c.cumplimiento === null ? '—' : `${c.cumplimiento.toFixed(2)} %`}</td>
                        <td className="px-4 py-3">{c.estado === 'cerrado' ? <Badge className="bg-gray-100 text-gray-600 border-gray-200">Cerrado</Badge> : <Badge className="bg-emerald-50 text-emerald-700 border-emerald-200">Abierto</Badge>}</td>
                        <td className="px-4 py-3 text-right"><button className="btn btn-secondary text-xs px-3 py-2" onClick={() => setAbierto(c.id)}>{c.estado === 'cerrado' ? 'Ver' : 'Marcar'}</button></td>
                    </tr>
                ))}
                {!loading && lista.length === 0 && <Vacio cols={8} text="No hay controles en el periodo." />}
            </Tabla>

            {abierto && <ControlModal id={abierto} opciones={opciones} sede={sede} onClose={() => { setAbierto(null); cargar(); }} avisar={avisar} />}
        </div>
    );
};

const ControlModal = ({ id, opciones, sede, onClose, avisar }) => {
    const [control, setControl] = useState(null);
    const [marcas, setMarcas] = useState({});
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');
    const [reponer, setReponer] = useState(null);

    const cargar = useCallback(async () => {
        try {
            const c = await readJson(await fetch(`/api/personal/controles/${id}`), 'No se pudo cargar el control.');
            setControl(c);
            setMarcas(Object.fromEntries(c.items.map((i) => [i.id, { resultado: i.resultado || '', observacion: i.observacion || '' }])));
        } catch (e) {
            setError(e.message);
        }
    }, [id]);
    useEffect(() => { cargar(); }, [cargar]);

    const cerrado = control?.estado === 'cerrado';
    const grupos = useMemo(() => {
        const g = new Map();
        for (const i of control?.items || []) {
            if (!g.has(i.personal_id)) g.set(i.personal_id, { trabajador: i.trabajador, dni: i.dni, area: i.area, items: [] });
            g.get(i.personal_id).items.push(i);
        }
        return [...g.values()];
    }, [control]);
    const marcar = (itemId, patch) => setMarcas((prev) => ({ ...prev, [itemId]: { ...prev[itemId], ...patch } }));
    const todosC = () => setMarcas((prev) => Object.fromEntries(Object.entries(prev).map(([k, v]) => [k, v.resultado ? v : { ...v, resultado: 'C' }])));

    const guardar = async (cerrar = false) => {
        setSaving(true);
        setError('');
        try {
            const items = Object.entries(marcas).map(([itemId, m]) => ({ id: Number(itemId), resultado: m.resultado || null, observacion: m.observacion }));
            await readJson(await jsonPost(`/api/personal/controles/${id}/marcar`, { items }), 'No se pudo guardar el control.');
            if (cerrar) {
                await readJson(await jsonPost(`/api/personal/controles/${id}/cerrar`, {}), 'No se pudo cerrar el control.');
                avisar('Control diario cerrado.');
            } else {
                avisar('Marcas guardadas.');
            }
            await cargar();
        } catch (e) {
            setError(e.message);
        } finally {
            setSaving(false);
        }
    };

    const pendientes = Object.values(marcas).filter((m) => !m.resultado).length;

    return (
        <Modal title="Control diario C/NC" subtitle={control ? `${fecha(control.fecha)} · Turno ${control.turno} · ${control.area || 'Todas las áreas'}${cerrado ? ` · Cumplimiento ${Number(control.cumplimiento).toFixed(2)} %` : ''}` : ''} xl onClose={onClose}>
            <ErrorBox text={error} />
            {!control ? <p className="py-10 text-center text-gray-500 font-bold">Cargando...</p> : (
                <div className="space-y-4">
                    <div className="flex flex-wrap gap-2 justify-between items-center">
                        <p className="text-sm text-gray-500">C = cumple · NC = no cumple (requiere observación){!cerrado && pendientes > 0 ? ` · ${pendientes} casilla(s) sin marcar` : ''}</p>
                        <div className="flex gap-2">
                            {!cerrado && <button className="btn btn-secondary text-sm" onClick={todosC}>Marcar pendientes como C</button>}
                            <BotonExcel onClick={() => exportarControl(sede, control).catch((e) => setError(e.message))} />
                        </div>
                    </div>
                    <div className="space-y-3 max-h-[60vh] overflow-y-auto pr-1">
                        {grupos.map((g) => (
                            <div key={g.dni} className="border border-gray-100 rounded-2xl p-4">
                                <p className="font-black">{g.trabajador} <span className="text-xs text-gray-500 font-semibold">DNI {g.dni}{g.area ? ` · ${g.area}` : ''}</span></p>
                                <div className="mt-2 space-y-2">
                                    {g.items.map((i) => {
                                        const m = marcas[i.id] || {};
                                        return (
                                            <div key={i.id} className="grid grid-cols-1 md:grid-cols-[1.3fr_auto_2fr_auto] gap-2 items-center">
                                                <span className="text-sm font-semibold">{i.elemento_nombre}</span>
                                                <div className="flex gap-1">
                                                    {['C', 'NC'].map((r) => (
                                                        <button key={r} type="button" disabled={cerrado} aria-pressed={m.resultado === r}
                                                            onClick={() => marcar(i.id, { resultado: m.resultado === r ? '' : r })}
                                                            className={`w-12 py-1.5 rounded-lg border text-xs font-black ${m.resultado === r ? (r === 'C' ? 'bg-emerald-600 border-emerald-600 text-white' : 'bg-rose-600 border-rose-600 text-white') : 'bg-white border-gray-200 text-gray-600'}`}>
                                                            {r}
                                                        </button>
                                                    ))}
                                                </div>
                                                {m.resultado === 'NC' ? (
                                                    <input className="input py-1.5 text-sm" placeholder="Observación de la no conformidad" disabled={cerrado} value={m.observacion}
                                                        onChange={(e) => marcar(i.id, { observacion: e.target.value })} maxLength={500} />
                                                ) : <span />}
                                                {i.resultado === 'NC' && (
                                                    i.reposicion_id
                                                        ? <span className="text-[10px] font-black uppercase text-emerald-700">Repuesto</span>
                                                        : <button type="button" className="btn btn-secondary text-xs px-3 py-1.5" onClick={() => setReponer(i)}>Reponer</button>
                                                )}
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        ))}
                    </div>
                    {cerrado ? (
                        <p className="text-sm text-gray-500 flex items-center gap-2"><Lock size={14} /> Control cerrado el {formatDateTime(control.cerrado_en)}{control.usuario_nombre ? ` · ${control.usuario_nombre}` : ''}.</p>
                    ) : (
                        <div className="flex flex-wrap gap-3">
                            <button className="btn btn-secondary flex-1" onClick={() => guardar(false)} disabled={saving}>Guardar marcas</button>
                            <button className="btn btn-primary flex-1" onClick={() => guardar(true)} disabled={saving || pendientes > 0}>{saving ? 'Guardando...' : 'Guardar y cerrar control'}</button>
                        </div>
                    )}
                </div>
            )}
            {reponer && (
                <EntregaModal inicial={{ personal_id: reponer.personal_id, elemento_id: reponer.elemento_id, control_detalle_id: reponer.id }} opciones={opciones}
                    trabajadores={[{ id: reponer.personal_id, apellidos: reponer.trabajador, nombres: '', area: reponer.area }]}
                    onClose={() => setReponer(null)} onSaved={() => { setReponer(null); avisar('Reposición registrada.'); cargar(); }} />
            )}
        </Modal>
    );
};

// ---------------- Elementos de EPP ----------------
const ELEMENTO_VACIO = { id: null, nombre: '', tipo: 'epp', unidad: 'UND', frecuencia_meses: 0, costo_unitario: '', area_id: '', control_diario: true, activo: true };

const ElementosTab = ({ opciones, recargarOpciones, sede, avisar, setError }) => {
    const [form, setForm] = useState(null);
    const [saving, setSaving] = useState(false);
    const [errorForm, setErrorForm] = useState('');
    const lista = opciones.elementos;

    const guardar = async (event) => {
        event.preventDefault();
        setSaving(true);
        setErrorForm('');
        try {
            await readJson(await jsonPost(form.id ? `/api/personal/elementos/${form.id}` : '/api/personal/elementos', form, form.id ? 'PUT' : 'POST'), 'No se pudo guardar el elemento.');
            avisar(`Elemento "${form.nombre}" guardado.`);
            setForm(null);
            recargarOpciones();
        } catch (e) {
            setErrorForm(e.message);
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="space-y-4">
            <div className="flex flex-wrap justify-end gap-2">
                <BotonExcel disabled={!lista.length} onClick={() => exportarElementos(sede, lista).catch((e) => setError(e.message))} />
                <button className="btn btn-primary text-sm" onClick={() => setForm({ ...ELEMENTO_VACIO })}><Plus size={16} /> Nuevo elemento</button>
            </div>
            <Tabla minWidth={760} head={<><Th>Elemento</Th><Th>Tipo</Th><Th>Unidad</Th><Th right>Cambio cada</Th><Th right>Costo</Th><Th>Área</Th><Th>Control diario</Th><Th right>Acciones</Th></>}>
                {lista.map((e) => (
                    <tr key={e.id} className={`border-b border-gray-100 ${Number(e.activo) ? '' : 'opacity-50'}`}>
                        <td className="px-4 py-3 font-bold">{e.nombre}</td>
                        <td className="px-4 py-3">{e.tipo === 'uniforme' ? 'Uniforme' : 'EPP'}</td>
                        <td className="px-4 py-3">{e.unidad}</td>
                        <td className="px-4 py-3 text-right">{Number(e.frecuencia_meses) ? `${e.frecuencia_meses} mes(es)` : '—'}</td>
                        <td className="px-4 py-3 text-right tabular-nums">{e.costo_unitario === null ? '—' : money(e.costo_unitario)}</td>
                        <td className="px-4 py-3">{e.area || 'Todas'}</td>
                        <td className="px-4 py-3">{Number(e.control_diario) ? 'Sí' : 'No'}</td>
                        <td className="px-4 py-3 text-right">
                            <button className="p-2 text-gray-500 hover:text-brand-600" aria-label={`Editar ${e.nombre}`}
                                onClick={() => setForm({ ...e, costo_unitario: e.costo_unitario ?? '', area_id: e.area_id || '', control_diario: Boolean(Number(e.control_diario)), activo: Boolean(Number(e.activo)) })}><Edit2 size={16} /></button>
                        </td>
                    </tr>
                ))}
                {lista.length === 0 && <Vacio cols={8} text="No hay elementos configurados." />}
            </Tabla>
            {form && (
                <Modal title={form.id ? 'Editar elemento' : 'Nuevo elemento de EPP / uniforme'} onClose={() => setForm(null)}>
                    <ErrorBox text={errorForm} />
                    <form onSubmit={guardar} className="space-y-4">
                        <Field label="Nombre"><input className="input" value={form.nombre} onChange={(e) => setForm({ ...form, nombre: e.target.value })} required maxLength={150} autoFocus /></Field>
                        <div className="grid grid-cols-3 gap-3">
                            <Field label="Tipo">
                                <select className="input" value={form.tipo} onChange={(e) => setForm({ ...form, tipo: e.target.value })}>
                                    <option value="epp">EPP</option><option value="uniforme">Uniforme</option>
                                </select>
                            </Field>
                            <Field label="Unidad"><input className="input" value={form.unidad} onChange={(e) => setForm({ ...form, unidad: e.target.value.toUpperCase() })} maxLength={20} /></Field>
                            <Field label="Cambio cada (meses)"><input type="number" min="0" max="120" className="input" value={form.frecuencia_meses} onChange={(e) => setForm({ ...form, frecuencia_meses: e.target.value })} /></Field>
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                            <Field label="Costo unitario (S/)"><input type="number" min="0" step="0.01" className="input" value={form.costo_unitario} onChange={(e) => setForm({ ...form, costo_unitario: e.target.value })} /></Field>
                            <Field label="Área">
                                <select className="input" value={form.area_id} onChange={(e) => setForm({ ...form, area_id: e.target.value })}>
                                    <option value="">Todas</option>
                                    {opciones.areas.map((a) => <option key={a.id} value={a.id}>{a.nombre}</option>)}
                                </select>
                            </Field>
                        </div>
                        <div className="flex gap-6">
                            <label className="flex items-center gap-2 text-sm font-bold"><input type="checkbox" className="w-4 h-4 accent-brand-600" checked={form.control_diario} onChange={(e) => setForm({ ...form, control_diario: e.target.checked })} /> Incluir en el control diario</label>
                            <label className="flex items-center gap-2 text-sm font-bold"><input type="checkbox" className="w-4 h-4 accent-brand-600" checked={form.activo} onChange={(e) => setForm({ ...form, activo: e.target.checked })} /> Activo</label>
                        </div>
                        <div className="flex gap-3">
                            <button type="button" className="btn btn-secondary flex-1" onClick={() => setForm(null)}>Cancelar</button>
                            <button type="submit" className="btn btn-primary flex-1" disabled={saving}>{saving ? 'Guardando...' : 'Guardar'}</button>
                        </div>
                    </form>
                </Modal>
            )}
        </div>
    );
};

// ---------------- Costos ----------------
// Como el sistema concesionario: solo el valor total de EPP y uniformes vigentes (en poder del trabajador) por trabajador y por área.
const CostosTab = ({ opciones, sede, setError }) => {
    const [filtros, setFiltros] = useState({ desde: '', hasta: '', area_id: '' });
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);

    const cargar = useCallback(async (f = filtros) => {
        setLoading(true);
        try {
            const qs = new URLSearchParams(Object.entries(f).filter(([, v]) => v)).toString();
            setData(await readJson(await fetch(`/api/personal/costos${qs ? `?${qs}` : ''}`), 'No se pudo calcular los costos.'));
        } catch (e) {
            setError(e.message);
        } finally {
            setLoading(false);
        }
    }, [filtros, setError]);
    useEffect(() => { cargar(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

    const total = (data?.areas || []).reduce((acc, a) => acc + a.costo_total, 0);

    return (
        <div className="space-y-4">
            <form className="card p-4 grid grid-cols-2 sm:grid-cols-[1fr_1fr_1fr_auto_auto] gap-3 items-end" onSubmit={(e) => { e.preventDefault(); cargar(); }}>
                <Field label="Entregado desde (opcional)"><input type="date" className="input" value={filtros.desde} max={filtros.hasta || undefined} onChange={(e) => setFiltros({ ...filtros, desde: e.target.value })} /></Field>
                <Field label="Entregado hasta (opcional)"><input type="date" className="input" value={filtros.hasta} min={filtros.desde || undefined} onChange={(e) => setFiltros({ ...filtros, hasta: e.target.value })} /></Field>
                <Field label="Área">
                    <select className="input" value={filtros.area_id} onChange={(e) => setFiltros({ ...filtros, area_id: e.target.value })}>
                        <option value="">Todas</option>
                        {opciones.areas.map((a) => <option key={a.id} value={a.id}>{a.nombre}</option>)}
                    </select>
                </Field>
                <button type="submit" className="btn btn-secondary"><Search size={16} /> Calcular</button>
                <BotonExcel disabled={!data?.trabajadores?.length} onClick={() => exportarCostos(sede, data).catch((e) => setError(e.message))} />
            </form>
            <p className="text-xs text-gray-500">
                Valor de los uniformes y EPP que cada trabajador tiene en su poder: lo entregado menos lo devuelto y lo dado de baja (sin entregas anuladas).
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                {(data?.areas || []).map((a) => (
                    <div key={a.area} className="card p-4">
                        <p className="text-[10px] font-black uppercase tracking-widest text-gray-500">{a.area} · {a.trabajadores} trab.</p>
                        <p className="text-2xl font-display font-black text-brand-600 tabular-nums">{money(a.costo_total)}</p>
                        <p className="text-xs text-gray-500">EPP {money(a.costo_epp)} · Uniformes {money(a.costo_uniforme)}</p>
                    </div>
                ))}
            </div>

            <Tabla minWidth={760} head={<>
                <Th>Trabajador</Th><Th>Área / cargo</Th><Th right>EPP</Th><Th right>Uniformes</Th><Th right>Total EPP y uniforme</Th>
            </>}>
                {loading && <Vacio cols={5} text="Calculando..." />}
                {!loading && (data?.trabajadores || []).map((t) => (
                    <tr key={`${t.personal_id}-${t.area_id}`} className="border-b border-gray-100">
                        <td className="px-4 py-3"><p className="font-bold">{t.trabajador}</p><p className="text-xs text-gray-500">DNI {t.dni} · {ESTADO_LABEL[t.estado]}</p></td>
                        <td className="px-4 py-3"><p>{t.area}</p><p className="text-xs text-gray-500">{t.cargo || '—'}</p></td>
                        <td className="px-4 py-3 text-right tabular-nums">{money(t.costo_epp)}</td>
                        <td className="px-4 py-3 text-right tabular-nums">{money(t.costo_uniforme)}</td>
                        <td className="px-4 py-3 text-right tabular-nums font-black">{money(t.costo_total)}</td>
                    </tr>
                ))}
                {!loading && data?.trabajadores?.length === 0 && <Vacio cols={5} text="Ningún trabajador tiene uniformes o EPP vigentes con esos filtros." />}
                {!loading && data?.trabajadores?.length > 0 && (
                    <tr className="bg-gray-50 font-black">
                        <td className="px-4 py-3" colSpan={4}>Total</td>
                        <td className="px-4 py-3 text-right tabular-nums">{money(total)}</td>
                    </tr>
                )}
            </Tabla>
        </div>
    );
};

// ---------------- Cargos, areas y turnos ----------------
const ConfigTab = ({ opciones, recargarOpciones, sede, avisar, setError }) => (
    <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <Catalogo tipo="cargos" titulo="Cargos" filas={opciones.cargos} {...{ recargarOpciones, sede, avisar, setError }} />
        <Catalogo tipo="areas" titulo="Áreas" filas={opciones.areas} {...{ recargarOpciones, sede, avisar, setError }} />
        <Catalogo tipo="turnos" titulo="Turnos" filas={opciones.turnos} conHorario {...{ recargarOpciones, sede, avisar, setError }} />
    </div>
);

const Catalogo = ({ tipo, titulo, filas, conHorario, recargarOpciones, sede, avisar, setError }) => {
    const vacio = { id: null, nombre: '', descripcion: '', hora_inicio: '', hora_fin: '', activo: true };
    const [form, setForm] = useState(vacio);
    const [saving, setSaving] = useState(false);

    const guardar = async (event, datos = form) => {
        event?.preventDefault();
        setSaving(true);
        try {
            await readJson(await jsonPost(datos.id ? `/api/personal/catalogos/${tipo}/${datos.id}` : `/api/personal/catalogos/${tipo}`, datos, datos.id ? 'PUT' : 'POST'), 'No se pudo guardar.');
            avisar(`${titulo}: "${datos.nombre}" guardado.`);
            setForm(vacio);
            recargarOpciones();
        } catch (e) {
            setError(e.message);
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="card p-5 space-y-4">
            <div className="flex items-center justify-between">
                <h4 className="text-lg font-black">{titulo}</h4>
                <BotonExcel disabled={!filas.length} onClick={() => exportarCatalogo(sede, titulo.normalize('NFD').replace(/[̀-ͯ]/g, ''), filas, conHorario).catch((e) => setError(e.message))} />
            </div>
            <form onSubmit={guardar} className="space-y-2">
                <input className="input" placeholder={`Nombre ${form.id ? '' : `del nuevo registro`}`} value={form.nombre} onChange={(e) => setForm({ ...form, nombre: e.target.value })} required minLength={2} maxLength={100} />
                <input className="input" placeholder="Descripción (opcional)" value={form.descripcion || ''} onChange={(e) => setForm({ ...form, descripcion: e.target.value })} maxLength={255} />
                {conHorario && (
                    <div className="grid grid-cols-2 gap-2">
                        <input type="time" className="input" aria-label="Hora de inicio" value={form.hora_inicio || ''} onChange={(e) => setForm({ ...form, hora_inicio: e.target.value })} />
                        <input type="time" className="input" aria-label="Hora de fin" value={form.hora_fin || ''} onChange={(e) => setForm({ ...form, hora_fin: e.target.value })} />
                    </div>
                )}
                <div className="flex gap-2">
                    {form.id && <button type="button" className="btn btn-secondary flex-1 text-sm" onClick={() => setForm(vacio)}>Cancelar</button>}
                    <button type="submit" className="btn btn-primary flex-1 text-sm" disabled={saving}>{form.id ? 'Guardar cambios' : <><Plus size={14} /> Agregar</>}</button>
                </div>
            </form>
            <ul className="divide-y divide-gray-100">
                {filas.map((f) => (
                    <li key={f.id} className={`flex items-center gap-2 py-2 ${Number(f.activo) ? '' : 'opacity-50'}`}>
                        <div className="flex-1">
                            <p className="font-bold text-sm">{f.nombre}</p>
                            {(f.descripcion || f.hora_inicio) && <p className="text-xs text-gray-500">{[f.hora_inicio && `${f.hora_inicio} - ${f.hora_fin || ''}`, f.descripcion].filter(Boolean).join(' · ')}</p>}
                        </div>
                        <button className="p-1.5 text-gray-500 hover:text-brand-600" aria-label={`Editar ${f.nombre}`}
                            onClick={() => setForm({ ...vacio, ...f, descripcion: f.descripcion || '', hora_inicio: f.hora_inicio || '', hora_fin: f.hora_fin || '', activo: Boolean(Number(f.activo)) })}><Edit2 size={15} /></button>
                        <button className="p-1.5 text-gray-500 hover:text-brand-600" title={Number(f.activo) ? 'Desactivar' : 'Activar'} aria-label={`${Number(f.activo) ? 'Desactivar' : 'Activar'} ${f.nombre}`} disabled={saving}
                            onClick={() => guardar(null, { ...f, descripcion: f.descripcion || '', hora_inicio: f.hora_inicio || '', hora_fin: f.hora_fin || '', activo: !Number(f.activo) })}><Power size={15} /></button>
                    </li>
                ))}
            </ul>
        </div>
    );
};

export default Personal;
