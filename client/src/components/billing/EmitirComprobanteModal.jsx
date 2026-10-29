import React, { useEffect, useState } from 'react';
import { Printer, FileText, Download, Send, CheckCircle2, AlertCircle, Search } from 'lucide-react';
import { addDaysYmd, toPeruYmd } from '../../utils/dateTime';
import { abrirPdf, descargarPdf, imprimirTicket, a4Path, ticketPath } from '../../utils/printDocs';
import { SunatBadge, Modal, Field, ErrorBox, ToggleGroup } from './billingShared';
import { METODOS_COBRO, TIPO_LABEL, money, readJson, puedeEnviar } from './billingUtils';

const TIPOS = [
    { value: 'boleta', label: 'Boleta' },
    { value: 'factura', label: 'Factura' },
    { value: 'nota_venta', label: 'Nota de venta' }
];
const DOCS = [
    { value: '-', label: 'Sin documento' },
    { value: 'DNI', label: 'DNI' },
    { value: 'RUC', label: 'RUC' },
    { value: 'CE', label: 'Carnet ext.' },
    { value: 'PAS', label: 'Pasaporte' }
];
const LIMITE_ANONIMO = 700;
const PRINT_PREF_KEY = 'billing.autoPrintTicket';

const readPrintPref = () => {
    try {
        return localStorage.getItem(PRINT_PREF_KEY) !== '0';
    } catch {
        return true;
    }
};

/**
 * Collects an order: picks the receipt (boleta, factura or nota de venta), the customer,
 * cash or credit and the payment method, then shows the SUNAT result and the print buttons.
 */
const EmitirComprobanteModal = ({ pedido, onClose, onEmitido }) => {
    const today = toPeruYmd();
    const total = Number(pedido.total) || 0;
    const [clientes, setClientes] = useState([]);
    const [form, setForm] = useState({
        tipo: 'boleta',
        tipo_documento: '-',
        numero_documento: '',
        nombre: '',
        direccion: '',
        condicion: 'contado',
        fecha_vencimiento: addDaysYmd(today, 15),
        metodo: 'efectivo',
        referencia: '',
        recibido: '',
        observacion: ''
    });
    const [autoPrint, setAutoPrint] = useState(readPrintPref);
    const [enviarSunat, setEnviarSunat] = useState(true);
    const [lookup, setLookup] = useState({ loading: false, msg: '', ok: false });
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');
    const [result, setResult] = useState(null);
    const [busy, setBusy] = useState('');
    // Each caja is independent: the sale is registered in the open caja chosen here.
    const [sesionesAbiertas, setSesionesAbiertas] = useState([]);
    const [cajaId, setCajaId] = useState('');

    const set = (patch) => setForm((prev) => ({ ...prev, ...patch }));

    useEffect(() => {
        fetch('/api/caja/sesiones-abiertas')
            .then((res) => (res.ok ? res.json() : []))
            .then((rows) => {
                const list = Array.isArray(rows) ? rows : [];
                setSesionesAbiertas(list);
                if (list.length > 0) setCajaId(String(list[0].caja_id));
            })
            .catch(() => {});
    }, []);

    useEffect(() => {
        fetch('/api/clientes')
            .then((res) => (res.ok ? res.json() : []))
            .then((rows) => {
                const list = Array.isArray(rows) ? rows : [];
                setClientes(list);
                const pedidoCliente = list.find((c) => c.id === pedido.cliente_id);
                if (pedidoCliente?.documento && ['DNI', 'RUC'].includes(pedidoCliente.tipo_documento)) {
                    setForm((prev) => ({
                        ...prev,
                        tipo: pedidoCliente.tipo_documento === 'RUC' ? 'factura' : 'boleta',
                        tipo_documento: pedidoCliente.tipo_documento,
                        numero_documento: pedidoCliente.documento,
                        nombre: pedidoCliente.nombre,
                        direccion: pedidoCliente.direccion || ''
                    }));
                }
            })
            .catch(() => setClientes([]));
    }, [pedido.cliente_id]);

    // Como en el POS de Cealka, el documento lo define el comprobante: boleta = DNI, factura = RUC.
    // Solo la nota de venta (documento interno) deja elegir el tipo de documento.
    const docDe = (tipo, tipoDocumento) => (tipo === 'factura' ? 'RUC' : tipo === 'boleta' ? 'DNI' : tipoDocumento);
    const tipoDocEfectivo = docDe(form.tipo, form.tipo_documento);
    const identificado = form.tipo === 'nota_venta' ? form.tipo_documento !== '-' : form.numero_documento.trim() !== '';
    const largoDoc = tipoDocEfectivo === 'RUC' ? 11 : tipoDocEfectivo === 'DNI' ? 8 : 15;
    const esNumerico = ['DNI', 'RUC'].includes(tipoDocEfectivo);

    const setTipo = (tipo) => {
        if (tipo === form.tipo) return;
        const anterior = tipoDocEfectivo;
        const nuevo = tipo === 'nota_venta' ? (['DNI', 'RUC', 'CE', 'PAS'].includes(anterior) ? anterior : '-') : docDe(tipo);
        // The number typed for another document type does not apply to the new one.
        set({ tipo, tipo_documento: nuevo, ...(nuevo === anterior ? {} : { numero_documento: '', nombre: '', direccion: '' }) });
        setLookup({ loading: false, msg: '', ok: false });
    };

    const setNumero = (value) => {
        const numero = value.toUpperCase().replace(/\s/g, '');
        set({ numero_documento: esNumerico ? numero.replace(/\D/g, '') : numero });
        setLookup({ loading: false, msg: '', ok: false });
    };

    // Registered customers, then RENIEC/SUNAT (when configured), complete the name once the DNI/RUC is complete.
    const buscarDocumento = async (manual = false) => {
        if (!esNumerico) return;
        if (form.numero_documento.length !== largoDoc) {
            if (manual) setLookup({ loading: false, msg: `Ingrese un ${tipoDocEfectivo} de ${largoDoc} digitos.`, ok: false });
            return;
        }
        setLookup({ loading: true, msg: '', ok: false });
        try {
            const res = await fetch(`/api/clientes/buscar?doc_tipo=${tipoDocEfectivo}&doc_numero=${form.numero_documento}`);
            const body = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(body.error || 'No se encontro el documento.');
            set({ nombre: body.nombre, ...(body.direccion ? { direccion: body.direccion } : {}) });
            setLookup({ loading: false, msg: body.origen === 'registrado' ? 'Cliente registrado.' : `Datos de ${body.origen}.`, ok: true });
        } catch (e) {
            setLookup({ loading: false, msg: e.message, ok: false });
        }
    };

    useEffect(() => {
        if (!esNumerico || form.numero_documento.length !== largoDoc) return undefined;
        const timer = setTimeout(() => buscarDocumento(false), 250);
        return () => clearTimeout(timer);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [form.numero_documento, tipoDocEfectivo]);

    const requiereCliente = form.tipo === 'factura' || form.condicion === 'credito' || (form.tipo === 'boleta' && total >= LIMITE_ANONIMO);
    const vuelto = form.metodo === 'efectivo' && Number(form.recibido) > total ? Number(form.recibido) - total : 0;

    const imprimir = async (kind, factura = result) => {
        setBusy(kind);
        setError('');
        try {
            if (kind === 'ticket') await imprimirTicket(ticketPath(factura.id, form.metodo === 'efectivo' ? Number(form.recibido) || '' : ''));
            else if (kind === 'descargar') await descargarPdf(a4Path(factura.id));
            else await abrirPdf(a4Path(factura.id));
        } catch (e) {
            setError(e.message);
        } finally {
            setBusy('');
        }
    };

    const reenviar = async () => {
        setBusy('enviar');
        setError('');
        try {
            setResult(await readJson(await fetch(`/api/facturas/${result.id}/enviar`, { method: 'POST' }), 'No se pudo enviar el comprobante.'));
        } catch (e) {
            setError(e.message);
        } finally {
            setBusy('');
        }
    };

    const emitir = async (event) => {
        event.preventDefault();
        setError('');
        if (requiereCliente && !identificado) {
            setError(form.tipo === 'factura'
                ? 'La factura requiere el RUC del cliente.'
                : form.condicion === 'credito'
                    ? 'Una venta al credito requiere identificar al cliente.'
                    : `Una boleta desde S/ ${LIMITE_ANONIMO} requiere el DNI del cliente.`);
            return;
        }
        setSaving(true);
        try {
            try {
                localStorage.setItem(PRINT_PREF_KEY, autoPrint ? '1' : '0');
            } catch {
                // Preference only.
            }
            const res = await fetch('/api/facturas', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    pedido_id: pedido.id,
                    caja_id: cajaId ? Number(cajaId) : undefined,
                    tipo_comprobante: form.tipo,
                    cliente: identificado
                        ? { tipo_documento: tipoDocEfectivo, numero_documento: form.numero_documento, nombre: form.nombre, direccion: form.direccion }
                        : null,
                    enviar_sunat: form.tipo === 'nota_venta' ? undefined : enviarSunat,
                    condicion_pago: form.condicion,
                    fecha_vencimiento: form.condicion === 'credito' ? form.fecha_vencimiento : undefined,
                    pago: form.condicion === 'contado' ? { metodo_pago: form.metodo, referencia: form.referencia } : undefined,
                    observacion: form.observacion
                })
            });
            const factura = await readJson(res, 'No se pudo emitir el comprobante.');
            setResult(factura);
            onEmitido(factura);
            if (autoPrint) imprimir('ticket', factura);
        } catch (e) {
            setError(e.message);
        } finally {
            setSaving(false);
        }
    };

    if (result) {
        const electronico = result.estado_sunat !== 'no_aplica';
        const ok = ['aceptado', 'observado', 'enviado', 'no_aplica'].includes(result.estado_sunat);
        return (
            <Modal title={`${TIPO_LABEL[result.tipo_comprobante]} ${result.numero_comprobante}`} subtitle={`${result.cliente_nombre} · ${money(result.total_venta)}`} onClose={onClose}>
                <ErrorBox text={error} />
                <div className={`p-4 rounded-2xl border flex gap-3 ${ok ? 'bg-emerald-50/60 border-emerald-100' : 'bg-rose-50 border-rose-200'}`}>
                    {ok ? <CheckCircle2 className="text-emerald-600 shrink-0" /> : <AlertCircle className="text-rose-600 shrink-0" />}
                    <div className="min-w-0 text-sm">
                        <div className="flex flex-wrap items-center gap-2">
                            <span className="font-black">{electronico ? 'SUNAT:' : 'Documento interno'}</span>
                            {electronico && <SunatBadge estado={result.estado_sunat} />}
                            {result.ambiente === 'PRUEBAS' && <span className="text-[10px] font-black text-rose-600 uppercase tracking-widest">Pruebas</span>}
                        </div>
                        {electronico && <p className="text-gray-600 mt-1 break-words">{result.envio_error || result.sunat_descripcion || 'Pendiente de envio.'}</p>}
                        {!electronico && <p className="text-gray-600 mt-1">La nota de venta no se envia a SUNAT.</p>}
                        {result.estado_sunat === 'enviado' && <p className="text-gray-500 text-xs mt-1">Las boletas se aceptan en el resumen diario de SUNAT; puedes consultarla luego en Comprobantes emitidos.</p>}
                        {result.condicion_pago === 'credito' && <p className="text-gray-600 mt-1">Al credito: vence el {result.fecha_vencimiento}. Queda en Cuentas por cobrar.</p>}
                        {vuelto > 0 && <p className="font-black mt-1">Vuelto: {money(vuelto)}</p>}
                    </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-5">
                    <button type="button" className="btn btn-primary" onClick={() => imprimir('ticket')} disabled={Boolean(busy)}>
                        <Printer size={16} /> {busy === 'ticket' ? 'Preparando...' : 'Imprimir ticket'}
                    </button>
                    <button type="button" className="btn btn-secondary" onClick={() => imprimir('a4')} disabled={Boolean(busy)}>
                        <FileText size={16} /> {busy === 'a4' ? 'Generando...' : 'Ver PDF A4'}
                    </button>
                    <button type="button" className="btn btn-secondary sm:col-span-2" onClick={() => imprimir('descargar')} disabled={Boolean(busy)}>
                        <Download size={16} /> {busy === 'descargar' ? 'Descargando...' : 'Descargar comprobante PDF'}
                    </button>
                    {puedeEnviar(result) && (
                        <button type="button" className="btn btn-secondary sm:col-span-2" onClick={reenviar} disabled={Boolean(busy)}>
                            <Send size={16} /> {busy === 'enviar' ? 'Enviando...' : 'Reintentar envio a SUNAT'}
                        </button>
                    )}
                </div>
                <button type="button" className="btn btn-secondary w-full mt-3" onClick={onClose}>Cerrar</button>
            </Modal>
        );
    }

    return (
        <Modal title={`Cobrar pedido #${pedido.id}`} subtitle={`${pedido.es_delivery ? `Delivery${pedido.delivery_cliente ? ` · ${pedido.delivery_cliente}` : ''}` : `Mesa ${pedido.mesa_numero || pedido.mesa_id}`} · Total ${money(total)} (incluye IGV)`} wide onClose={onClose}>
            <ErrorBox text={error} />
            <form onSubmit={emitir} className="space-y-5">
                <Field label="Comprobante">
                    <ToggleGroup options={TIPOS} value={form.tipo} onChange={setTipo} />
                    <p className="text-xs text-gray-500 mt-1.5">
                        {form.tipo === 'nota_venta'
                            ? 'Documento interno: no se envia a SUNAT.'
                            : 'Comprobante electronico: se envia a SUNAT por la API de facturacion.'}
                    </p>
                    {form.tipo !== 'nota_venta' && (
                        <label className="flex items-center gap-2 mt-2 text-xs text-gray-600 cursor-pointer select-none">
                            <input type="checkbox" checked={enviarSunat} onChange={(e) => setEnviarSunat(e.target.checked)} className="w-4 h-4 accent-brand-600" />
                            Enviar a SUNAT al emitir
                            {!enviarSunat && <span className="text-[10px] text-amber-600 font-bold">(queda pendiente: envialo luego desde Comprobantes emitidos)</span>}
                        </label>
                    )}
                </Field>

                <div className={`p-4 rounded-2xl border space-y-3 ${!requiereCliente ? 'bg-amber-50/40 border-amber-200 border-dashed' : 'bg-gray-50 border-gray-100'}`}>
                    <div className="flex items-center justify-between gap-3">
                        <span className="text-xs font-black uppercase tracking-widest text-gray-500">Cliente</span>
                        <span className={`text-[11px] font-bold text-right ${requiereCliente ? 'text-rose-600' : 'text-amber-600'}`}>
                            {form.tipo === 'factura' ? 'Obligatorio: RUC y razon social'
                                : form.condicion === 'credito' ? 'Obligatorio en ventas al credito'
                                    : form.tipo === 'boleta' && total >= LIMITE_ANONIMO ? `Obligatorio desde S/ ${LIMITE_ANONIMO}: DNI y nombre`
                                        : form.tipo === 'boleta' ? `Opcional (menos de S/ ${LIMITE_ANONIMO}): sin DNI sale como "Clientes varios"`
                                            : 'Opcional: sin documento sale como "Clientes varios"'}
                        </span>
                    </div>
                    <div className="grid grid-cols-[6.5rem_1fr] gap-3">
                        {form.tipo === 'nota_venta' ? (
                            <select className="input" value={form.tipo_documento} onChange={(e) => set({ tipo_documento: e.target.value, numero_documento: '' })} aria-label="Tipo de documento">
                                {DOCS.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}
                            </select>
                        ) : (
                            <div className="flex items-center justify-center text-xs font-black border border-gray-200 rounded-2xl bg-white px-2" aria-label="Tipo de documento">{tipoDocEfectivo}</div>
                        )}
                        {tipoDocEfectivo !== '-' ? (
                            <div className="flex">
                                <input
                                    className="input rounded-r-none"
                                    placeholder={tipoDocEfectivo === 'RUC' ? 'RUC (11 digitos)' : tipoDocEfectivo === 'DNI' ? (requiereCliente ? 'DNI (8 digitos)' : 'DNI (opcional)') : 'Numero de documento'}
                                    inputMode={esNumerico ? 'numeric' : 'text'}
                                    maxLength={largoDoc}
                                    value={form.numero_documento}
                                    onChange={(e) => setNumero(e.target.value)}
                                    required={requiereCliente}
                                    aria-label="Numero de documento"
                                />
                                {esNumerico && (
                                    <button type="button" onClick={() => buscarDocumento(true)} disabled={lookup.loading} aria-label={`Buscar ${tipoDocEfectivo}`}
                                        className="px-3 border border-l-0 border-gray-200 rounded-r-2xl bg-white hover:bg-gray-50 disabled:opacity-50">
                                        <Search size={16} className={lookup.loading ? 'animate-pulse text-brand-600' : 'text-gray-500'} />
                                    </button>
                                )}
                            </div>
                        ) : <p className="text-xs text-gray-400 self-center">Sin documento</p>}
                    </div>
                    {lookup.msg && <p className={`text-xs font-semibold ${lookup.ok ? 'text-emerald-600' : 'text-gray-500'}`}>{lookup.msg}</p>}
                    {identificado && (
                        <>
                            <input className="input" placeholder={tipoDocEfectivo === 'RUC' ? 'Razon social' : 'Nombre completo'} value={form.nombre} onChange={(e) => set({ nombre: e.target.value })} required minLength={3} maxLength={200} aria-label="Nombre o razon social" />
                            <input className="input" placeholder={form.tipo === 'factura' ? 'Direccion fiscal' : 'Direccion (opcional)'} value={form.direccion} onChange={(e) => set({ direccion: e.target.value })} required={form.tipo === 'factura'} maxLength={255} aria-label="Direccion" />
                        </>
                    )}
                </div>

                <Field label="Condicion de pago">
                    <ToggleGroup options={[{ value: 'contado', label: 'Contado' }, { value: 'credito', label: 'Credito' }]} value={form.condicion} onChange={(condicion) => set({ condicion })} />
                </Field>

                {form.condicion === 'credito' ? (
                    <Field label="Fecha de vencimiento">
                        <input type="date" className="input" min={addDaysYmd(today, 1)} value={form.fecha_vencimiento} onChange={(e) => set({ fecha_vencimiento: e.target.value })} required />
                    </Field>
                ) : (
                    <div className="space-y-3">
                        {sesionesAbiertas.length > 0 && (
                            <Field label="Caja donde se registra la venta">
                                <select className="input" value={cajaId} onChange={(e) => setCajaId(e.target.value)} disabled={sesionesAbiertas.length === 1}>
                                    {sesionesAbiertas.map((s) => <option key={s.id} value={s.caja_id}>{s.caja_descripcion}</option>)}
                                </select>
                            </Field>
                        )}
                        <Field label="Metodo de pago">
                            <div className="grid grid-cols-3 gap-2">
                                {METODOS_COBRO.map((m) => (
                                    <button
                                        type="button"
                                        key={m.value}
                                        onClick={() => set({ metodo: m.value })}
                                        aria-pressed={form.metodo === m.value}
                                        className={`px-3 py-2 rounded-xl border font-bold text-xs transition-all ${form.metodo === m.value
                                            ? 'bg-gray-900 border-gray-900 text-white'
                                            : 'bg-white border-gray-200 text-gray-600 hover:border-gray-400'}`}
                                    >
                                        {m.label}
                                    </button>
                                ))}
                            </div>
                        </Field>
                        {form.metodo === 'efectivo' ? (
                            <div className="grid grid-cols-2 gap-3 items-end">
                                <Field label="Monto recibido (opcional)">
                                    <input type="number" min="0" step="0.10" className="input" value={form.recibido} onChange={(e) => set({ recibido: e.target.value })} />
                                </Field>
                                <div className="pb-3 text-sm">
                                    Vuelto: <span className="font-black text-lg">{money(vuelto)}</span>
                                </div>
                            </div>
                        ) : (
                            <Field label="N° de operacion / voucher (opcional)">
                                <input className="input" value={form.referencia} onChange={(e) => set({ referencia: e.target.value })} maxLength={100} />
                            </Field>
                        )}
                    </div>
                )}

                <Field label="Observacion (opcional)">
                    <input className="input" value={form.observacion} onChange={(e) => set({ observacion: e.target.value })} maxLength={255} />
                </Field>

                <label className="flex items-center gap-2 text-sm font-semibold text-gray-600">
                    <input type="checkbox" checked={autoPrint} onChange={(e) => setAutoPrint(e.target.checked)} />
                    Imprimir el ticket al emitir
                </label>

                <div className="flex gap-3 pt-1">
                    <button type="button" className="btn btn-secondary flex-1" onClick={onClose}>Cancelar</button>
                    <button type="submit" className="btn btn-primary flex-1" disabled={saving}>
                        {saving ? 'Emitiendo...' : `Emitir ${TIPO_LABEL[form.tipo].toLowerCase()} · ${money(total)}`}
                    </button>
                </div>
            </form>
        </Modal>
    );
};

export default EmitirComprobanteModal;
