import React, { useEffect, useState } from 'react';
import { Printer, FileText, Download, Send, CheckCircle2, AlertCircle, Search, Plus, Trash2 } from 'lucide-react';
import { addDaysYmd, toPeruYmd } from '../../utils/dateTime';
import { abrirPdf, descargarPdf, imprimirTicket, a4Path, ticketPath } from '../../utils/printDocs';
import { SunatBadge, Modal, Field, ErrorBox, ToggleGroup } from './billingShared';
import { METODOS_COBRO, TIPO_LABEL, money, readJson, puedeEnviar } from './billingUtils';

const TIPOS = [
    { value: 'factura', label: 'Factura' },
    { value: 'boleta', label: 'Boleta' },
    { value: 'nota_venta', label: 'Nota de venta' }
];
const DOCS = [
    { value: '-', label: 'Sin documento' },
    { value: 'DNI', label: 'DNI' },
    { value: 'RUC', label: 'RUC' },
    { value: 'CE', label: 'Carnet ext.' },
    { value: 'PAS', label: 'Pasaporte' }
];
const PRINT_PREF_KEY = 'billing.autoPrintTicket';
const MAX_ITEMS = 100;
const itemVacio = () => ({ descripcion: '', cantidad: '1', precio: '' });
const round2 = (value) => Math.round(value * 100) / 100;

const readPrintPref = () => {
    try {
        return localStorage.getItem(PRINT_PREF_KEY) !== '0';
    } catch {
        return true;
    }
};

/**
 * Factura libre: boleta, factura o nota de venta con items escritos a mano. No se asocia a ningun pedido ni mueve stock.
 * Al contado se registra el cobro sin pasar por la caja; al credito queda en Cuentas por cobrar con una fecha de vencimiento.
 */
const FacturaLibreModal = ({ onClose, onEmitido }) => {
    const today = toPeruYmd();
    const [opciones, setOpciones] = useState({ igv_porcentaje: 10.5, limite_boleta_anonima: 700 });
    const [form, setForm] = useState({
        tipo: 'factura',
        tipo_documento: 'RUC',
        numero_documento: '',
        nombre: '',
        direccion: '',
        condicion: 'contado',
        fecha_vencimiento: addDaysYmd(today, 15),
        metodo: 'efectivo',
        referencia: '',
        observacion: ''
    });
    const [items, setItems] = useState([itemVacio()]);
    const [incluyeIgv, setIncluyeIgv] = useState(true);
    const [autoPrint, setAutoPrint] = useState(readPrintPref);
    const [enviarSunat, setEnviarSunat] = useState(true);
    const [lookup, setLookup] = useState({ loading: false, msg: '', ok: false });
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');
    const [result, setResult] = useState(null);
    const [busy, setBusy] = useState('');

    const set = (patch) => setForm((prev) => ({ ...prev, ...patch }));

    useEffect(() => {
        fetch('/api/facturas/libre/opciones')
            .then((res) => (res.ok ? res.json() : null))
            .then((body) => { if (body) setOpciones(body); })
            .catch(() => {});
    }, []);

    // Totales: con precios sin IGV se suma el IGV encima; con precios con IGV se separa de cada total.
    const tasa = Number(opciones.igv_porcentaje) || 10.5;
    const suma = items.reduce((acc, i) => acc + (Number(i.cantidad) || 0) * (Number(i.precio) || 0), 0);
    const total = round2(incluyeIgv ? suma : suma * (1 + tasa / 100));
    const gravada = round2(total / (1 + tasa / 100));
    const igv = round2(total - gravada);

    // El documento lo define el comprobante: boleta = DNI, factura = RUC. Solo la nota de venta deja elegir.
    const docDe = (tipo, tipoDocumento) => (tipo === 'factura' ? 'RUC' : tipo === 'boleta' ? 'DNI' : tipoDocumento);
    const tipoDocEfectivo = docDe(form.tipo, form.tipo_documento);
    const identificado = form.tipo === 'nota_venta' ? form.tipo_documento !== '-' : form.numero_documento.trim() !== '';
    const largoDoc = tipoDocEfectivo === 'RUC' ? 11 : tipoDocEfectivo === 'DNI' ? 8 : 15;
    const esNumerico = ['DNI', 'RUC'].includes(tipoDocEfectivo);
    const requiereCliente = form.tipo === 'factura' || form.condicion === 'credito' || (form.tipo === 'boleta' && total >= opciones.limite_boleta_anonima);

    const setTipo = (tipo) => {
        if (tipo === form.tipo) return;
        const anterior = tipoDocEfectivo;
        const nuevo = tipo === 'nota_venta' ? (['DNI', 'RUC', 'CE', 'PAS'].includes(anterior) ? anterior : '-') : docDe(tipo);
        set({ tipo, tipo_documento: nuevo, ...(nuevo === anterior ? {} : { numero_documento: '', nombre: '', direccion: '' }) });
        setLookup({ loading: false, msg: '', ok: false });
    };

    const setNumero = (value) => {
        const numero = value.toUpperCase().replace(/\s/g, '');
        set({ numero_documento: esNumerico ? numero.replace(/\D/g, '') : numero });
        setLookup({ loading: false, msg: '', ok: false });
    };

    // Clientes registrados y luego RENIEC/SUNAT (si estan configurados) completan el nombre al terminar el DNI/RUC.
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

    const updateItem = (index, patch) => setItems((prev) => prev.map((item, i) => (i === index ? { ...item, ...patch } : item)));
    const removeItem = (index) => setItems((prev) => (prev.length > 1 ? prev.filter((_, i) => i !== index) : prev));

    const imprimir = async (kind, factura = result) => {
        setBusy(kind);
        setError('');
        try {
            if (kind === 'ticket') await imprimirTicket(ticketPath(factura.id, ''));
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
                    : `Una boleta desde S/ ${opciones.limite_boleta_anonima} requiere el DNI del cliente.`);
            return;
        }
        if (!(total > 0)) {
            setError('Ingrese al menos un item con cantidad y precio.');
            return;
        }
        setSaving(true);
        try {
            try {
                localStorage.setItem(PRINT_PREF_KEY, autoPrint ? '1' : '0');
            } catch {
                // Preference only.
            }
            const res = await fetch('/api/facturas/libre', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    tipo_comprobante: form.tipo,
                    cliente: identificado
                        ? { tipo_documento: tipoDocEfectivo, numero_documento: form.numero_documento, nombre: form.nombre, direccion: form.direccion }
                        : null,
                    items: items.map((i) => ({ descripcion: i.descripcion, cantidad: Number(i.cantidad), precio_unitario: Number(i.precio) })),
                    precios_incluyen_igv: incluyeIgv,
                    enviar_sunat: form.tipo === 'nota_venta' ? undefined : enviarSunat,
                    condicion_pago: form.condicion,
                    fecha_vencimiento: form.condicion === 'credito' ? form.fecha_vencimiento : undefined,
                    pago: form.condicion === 'contado' ? { metodo_pago: form.metodo, referencia: form.referencia } : undefined,
                    observacion: form.observacion
                })
            });
            const factura = await readJson(res, 'No se pudo emitir el comprobante.');
            setResult(factura);
            onEmitido?.(factura);
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
                        {result.condicion_pago === 'credito' && <p className="text-gray-600 mt-1">Al credito: vence el {result.fecha_vencimiento}. Queda en Cuentas por cobrar.</p>}
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
        <Modal title="Factura libre" subtitle="Comprobante con items escritos a mano: no se asocia a ningun pedido ni mueve stock." xl onClose={onClose}>
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
                                    : form.tipo === 'boleta' && total >= opciones.limite_boleta_anonima ? `Obligatorio desde S/ ${opciones.limite_boleta_anonima}: DNI y nombre`
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
                            <input className="input" placeholder={tipoDocEfectivo === 'RUC' ? 'Razon social' : 'Nombre completo'} value={form.nombre} onChange={(e) => set({ nombre: e.target.value })} required maxLength={200} />
                            <input className="input" placeholder={form.tipo === 'factura' ? 'Direccion fiscal' : 'Direccion (opcional)'} value={form.direccion} onChange={(e) => set({ direccion: e.target.value })} required={form.tipo === 'factura'} maxLength={255} />
                        </>
                    )}
                </div>

                <div className="space-y-3">
                    <div className="flex items-center justify-between gap-3">
                        <span className="text-xs font-black uppercase tracking-widest text-gray-500">Detalle</span>
                        <label className="flex items-center gap-2 text-xs text-gray-600 cursor-pointer select-none">
                            <input type="checkbox" checked={incluyeIgv} onChange={(e) => setIncluyeIgv(e.target.checked)} className="w-4 h-4 accent-brand-600" />
                            Los precios incluyen IGV ({tasa}%)
                        </label>
                    </div>
                    <div className="hidden sm:grid grid-cols-[1fr_6rem_8rem_6rem_2.5rem] gap-2 text-[10px] font-black uppercase tracking-widest text-gray-400 px-1">
                        <span>Descripcion</span><span className="text-right">Cantidad</span><span className="text-right">Precio unit.</span><span className="text-right">Importe</span><span />
                    </div>
                    {items.map((item, index) => (
                        <div key={index} className="grid grid-cols-1 sm:grid-cols-[1fr_6rem_8rem_6rem_2.5rem] gap-2 items-center">
                            <input className="input" placeholder="Descripcion del producto o servicio" maxLength={250} value={item.descripcion}
                                onChange={(e) => updateItem(index, { descripcion: e.target.value })} aria-label={`Descripcion del item ${index + 1}`} required />
                            <input type="number" min="0.001" step="0.001" className="input text-right" value={item.cantidad}
                                onChange={(e) => updateItem(index, { cantidad: e.target.value })} aria-label={`Cantidad del item ${index + 1}`} required />
                            <input type="number" min="0.01" step="0.01" className="input text-right" placeholder="0.00" value={item.precio}
                                onChange={(e) => updateItem(index, { precio: e.target.value })} aria-label={`Precio unitario del item ${index + 1}`} required />
                            <span className="text-sm font-bold text-right tabular-nums">{money((Number(item.cantidad) || 0) * (Number(item.precio) || 0))}</span>
                            <button type="button" onClick={() => removeItem(index)} disabled={items.length === 1} aria-label={`Quitar item ${index + 1}`}
                                className="p-2 text-rose-400 hover:text-rose-600 hover:bg-rose-50 rounded-xl disabled:opacity-30"><Trash2 size={16} /></button>
                        </div>
                    ))}
                    <button type="button" className="btn btn-secondary text-xs" onClick={() => setItems((prev) => [...prev, itemVacio()])} disabled={items.length >= MAX_ITEMS}>
                        <Plus size={14} /> Agregar item
                    </button>
                    <div className="ml-auto max-w-xs text-sm space-y-1 pt-2">
                        <div className="flex justify-between text-gray-500"><span>Op. gravada</span><span className="tabular-nums">{money(gravada)}</span></div>
                        <div className="flex justify-between text-gray-500"><span>IGV ({tasa}%)</span><span className="tabular-nums">{money(igv)}</span></div>
                        <div className="flex justify-between font-black text-lg"><span>Total</span><span className="tabular-nums">{money(total)}</span></div>
                    </div>
                </div>

                <Field label="Condicion de pago">
                    <ToggleGroup options={[{ value: 'contado', label: 'Contado' }, { value: 'credito', label: 'Credito' }]} value={form.condicion} onChange={(condicion) => set({ condicion })} />
                </Field>

                {form.condicion === 'credito' ? (
                    <Field label="Fecha de vencimiento">
                        <input type="date" className="input" min={addDaysYmd(today, 1)} value={form.fecha_vencimiento} onChange={(e) => set({ fecha_vencimiento: e.target.value })} required />
                        <p className="text-xs text-gray-500 mt-1.5">Queda en Cuentas por cobrar hasta que se registre el cobro.</p>
                    </Field>
                ) : (
                    <div className="space-y-3">
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
                            <p className="text-xs text-gray-500 mt-1.5">El cobro se registra sin pasar por la caja: no entra al arqueo.</p>
                        </Field>
                        {form.metodo !== 'efectivo' && (
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

export default FacturaLibreModal;
