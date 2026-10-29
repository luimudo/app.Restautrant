import React, { useEffect, useMemo, useState } from 'react';
import { Printer, FileText, Download, Send, CheckCircle2, AlertCircle } from 'lucide-react';
import { abrirPdf, descargarPdf, imprimirTicket, a4Path, ticketPath } from '../../utils/printDocs';
import { SunatBadge, Modal, Field, ErrorBox, ToggleGroup } from './billingShared';
import { METODOS_COBRO, TIPO_LABEL, money, readJson, puedeEnviar } from './billingUtils';

const round2 = (value) => Math.round((Number(value) + Number.EPSILON) * 100) / 100;

/**
 * Credit or debit note over an electronic boleta/factura. A credit note with a "total" reason
 * cancels the receipt; partial ones return items or reduce the value; a debit note increases it.
 */
const NotaModal = ({ factura, onClose, onEmitida }) => {
    const [opciones, setOpciones] = useState(null);
    const [loadError, setLoadError] = useState('');
    const [tipo, setTipo] = useState('nota_credito');
    const [motivoCodigo, setMotivoCodigo] = useState('');
    const [sustento, setSustento] = useState('');
    const [monto, setMonto] = useState('');
    const [cantidades, setCantidades] = useState({});
    const [devolucion, setDevolucion] = useState({ metodo_pago: 'efectivo', referencia: '' });
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');
    const [result, setResult] = useState(null);
    const [busy, setBusy] = useState('');

    useEffect(() => {
        fetch(`/api/facturas/${factura.id}/notas/opciones`)
            .then((res) => readJson(res, 'No se pudo cargar las opciones de la nota.'))
            .then((body) => {
                setOpciones(body);
                setMotivoCodigo(body.motivos.nota_credito[0]?.codigo || '');
            })
            .catch((e) => setLoadError(e.message));
    }, [factura.id]);

    const motivos = opciones?.motivos[tipo] || [];
    const motivo = motivos.find((m) => m.codigo === motivoCodigo);

    const cambiarTipo = (nuevo) => {
        setTipo(nuevo);
        setMotivoCodigo(opciones?.motivos[nuevo][0]?.codigo || '');
        setError('');
    };

    const total = useMemo(() => {
        if (!opciones || !motivo) return 0;
        if (motivo.modo === 'total') return round2(opciones.importe_vigente);
        if (motivo.modo === 'items') {
            return round2(opciones.items.reduce((sum, item) => sum + (Number(cantidades[item.producto_id]) || 0) * Number(item.precio_unitario), 0));
        }
        return round2(Number(monto) || 0);
    }, [opciones, motivo, cantidades, monto]);

    const nuevoVigente = opciones ? round2(tipo === 'nota_credito' ? opciones.importe_vigente - total : opciones.importe_vigente + total) : 0;
    const devolver = opciones ? round2(Math.max(0, Number(opciones.origen.monto_cobrado) - nuevoVigente)) : 0;

    const emitir = async (event) => {
        event.preventDefault();
        setError('');
        if (!(total > 0)) {
            setError(motivo?.modo === 'items' ? 'Indique la cantidad a devolver de al menos un ítem.' : 'Ingrese el importe de la nota.');
            return;
        }
        setSaving(true);
        try {
            const res = await fetch(`/api/facturas/${factura.id}/notas`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    tipo,
                    motivo_codigo: motivoCodigo,
                    motivo_descripcion: sustento,
                    monto: motivo.modo === 'monto' ? Number(monto) : undefined,
                    items: motivo.modo === 'items'
                        ? Object.entries(cantidades).filter(([, c]) => Number(c) > 0).map(([productoId, cantidad]) => ({ producto_id: Number(productoId), cantidad: Number(cantidad) }))
                        : undefined,
                    devolucion: devolver > 0 ? devolucion : undefined
                })
            });
            const nota = await readJson(res, 'No se pudo emitir la nota.');
            setResult(nota);
            onEmitida(nota);
        } catch (e) {
            setError(e.message);
        } finally {
            setSaving(false);
        }
    };

    const accion = async (kind) => {
        setBusy(kind);
        setError('');
        try {
            if (kind === 'ticket') await imprimirTicket(ticketPath(result.id));
            else if (kind === 'a4') await abrirPdf(a4Path(result.id));
            else if (kind === 'descargar') await descargarPdf(a4Path(result.id));
            else setResult(await readJson(await fetch(`/api/facturas/${result.id}/enviar`, { method: 'POST' }), 'No se pudo enviar la nota.'));
        } catch (e) {
            setError(e.message);
        } finally {
            setBusy('');
        }
    };

    if (result) {
        const ok = ['aceptado', 'observado', 'enviado'].includes(result.estado_sunat);
        return (
            <Modal title={`${TIPO_LABEL[result.tipo_comprobante]} ${result.numero_comprobante}`} subtitle={`Modifica ${result.origen_numero} · ${money(result.total_venta)}`} onClose={onClose}>
                <ErrorBox text={error} />
                <div className={`p-4 rounded-2xl border flex gap-3 ${ok ? 'bg-emerald-50/60 border-emerald-100' : 'bg-rose-50 border-rose-200'}`}>
                    {ok ? <CheckCircle2 className="text-emerald-600 shrink-0" /> : <AlertCircle className="text-rose-600 shrink-0" />}
                    <div className="text-sm min-w-0">
                        <div className="flex flex-wrap items-center gap-2"><span className="font-black">SUNAT:</span><SunatBadge estado={result.estado_sunat} />
                            {result.ambiente === 'PRUEBAS' && <span className="text-[10px] font-black text-rose-600 uppercase tracking-widest">Pruebas</span>}</div>
                        <p className="text-gray-600 mt-1 break-words">{result.envio_error || result.sunat_descripcion || 'Pendiente de envío.'}</p>
                        <p className="text-gray-600 mt-1">{result.motivo_descripcion}: {result.observacion}</p>
                    </div>
                </div>
                <div className="grid grid-cols-2 gap-3 mt-5">
                    <button className="btn btn-primary" onClick={() => accion('ticket')} disabled={Boolean(busy)}><Printer size={16} /> Ticket</button>
                    <button className="btn btn-secondary" onClick={() => accion('a4')} disabled={Boolean(busy)}><FileText size={16} /> PDF A4</button>
                    <button className="btn btn-secondary col-span-2" onClick={() => accion('descargar')} disabled={Boolean(busy)}><Download size={16} /> Descargar nota PDF</button>
                    {puedeEnviar(result) && <button className="btn btn-secondary col-span-2" onClick={() => accion('enviar')} disabled={Boolean(busy)}><Send size={16} /> Reintentar envío a SUNAT</button>}
                </div>
                <button className="btn btn-secondary w-full mt-3" onClick={onClose}>Cerrar</button>
            </Modal>
        );
    }

    return (
        <Modal title={`Nota sobre ${factura.numero_comprobante}`} subtitle={`${factura.cliente_nombre} · ${TIPO_LABEL[factura.tipo_comprobante]}`} wide onClose={onClose}>
            <ErrorBox text={loadError || error} />
            {!opciones && !loadError && <p className="py-6 text-center font-bold text-gray-500">Cargando...</p>}
            {opciones && (
                <form onSubmit={emitir} className="space-y-5">
                    <div className="grid grid-cols-3 gap-3 text-sm">
                        <Stat label="Importe vigente" value={money(opciones.importe_vigente)} />
                        <Stat label="Cobrado" value={money(opciones.origen.monto_cobrado)} />
                        <Stat label="Saldo" value={money(opciones.origen.saldo)} />
                    </div>

                    <Field label="Tipo de nota">
                        <ToggleGroup options={[{ value: 'nota_credito', label: 'Nota de crédito (resta / anula)' }, { value: 'nota_debito', label: 'Nota de débito (suma)' }]} value={tipo} onChange={cambiarTipo} />
                    </Field>

                    <Field label="Motivo (catálogo SUNAT)">
                        <select className="input" value={motivoCodigo} onChange={(e) => { setMotivoCodigo(e.target.value); setError(''); }}>
                            {motivos.map((m) => <option key={m.codigo} value={m.codigo}>{m.codigo} · {m.nombre}</option>)}
                        </select>
                        {tipo === 'nota_credito' && opciones.tiene_notas_credito && <p className="text-xs text-gray-500 mt-1">Ya tiene notas de crédito: solo se admiten devoluciones parciales o disminuciones.</p>}
                    </Field>

                    {motivo?.modo === 'total' && (
                        <div className="p-4 rounded-2xl bg-rose-50 border border-rose-200 text-sm">
                            <p className="font-black text-rose-700">Se anulará el comprobante completo por {money(opciones.importe_vigente)}.</p>
                            <ul className="mt-2 text-gray-700 space-y-0.5">
                                {opciones.items.map((item) => <li key={item.producto_id}>{item.cantidad} × {item.descripcion} · {money(item.total)}</li>)}
                            </ul>
                        </div>
                    )}

                    {motivo?.modo === 'items' && (
                        <div className="space-y-2">
                            <span className="text-xs font-bold text-gray-500 uppercase tracking-widest">Cantidad a devolver</span>
                            {opciones.items.map((item) => (
                                <div key={item.producto_id} className="grid grid-cols-[1fr_auto_90px] gap-3 items-center p-3 rounded-xl border border-gray-100">
                                    <div className="min-w-0">
                                        <p className="font-semibold text-sm truncate">{item.descripcion}</p>
                                        <p className="text-xs text-gray-500">{money(item.precio_unitario)} c/u · disponible {item.disponible} de {item.cantidad}</p>
                                    </div>
                                    <span className="text-sm tabular-nums">{money((Number(cantidades[item.producto_id]) || 0) * Number(item.precio_unitario))}</span>
                                    <input type="number" min={0} max={item.disponible} step={1} className="input text-right" disabled={item.disponible === 0}
                                        value={cantidades[item.producto_id] ?? ''} aria-label={`Cantidad a devolver de ${item.descripcion}`}
                                        onChange={(e) => setCantidades({ ...cantidades, [item.producto_id]: Math.min(item.disponible, Math.max(0, Math.floor(Number(e.target.value) || 0))) })} />
                                </div>
                            ))}
                        </div>
                    )}

                    {motivo?.modo === 'monto' && (
                        <Field label="Importe de la nota (incluye IGV)">
                            <input type="number" min="0.01" step="0.01" max={tipo === 'nota_credito' ? opciones.importe_vigente : undefined} className="input" value={monto} onChange={(e) => setMonto(e.target.value)} required />
                        </Field>
                    )}

                    <Field label="Sustento (se imprime en la nota)">
                        <input className="input" placeholder="Ej. Cliente devolvió un plato por estar frío" value={sustento} onChange={(e) => setSustento(e.target.value)} required minLength={5} maxLength={255} />
                    </Field>

                    <div className="p-4 rounded-2xl bg-gray-50 border border-gray-100 text-sm space-y-1">
                        <p>Total de la nota: <span className="font-black">{money(total)}</span></p>
                        <p>Nuevo importe del comprobante: <span className="font-black">{money(nuevoVigente)}</span>{motivo?.modo === 'total' && <span className="text-rose-600 font-bold"> · ANULADO</span>}</p>
                        {devolver > 0 && <p className="text-rose-700 font-bold">El cliente ya pagó: hay que devolverle {money(devolver)}.</p>}
                    </div>

                    {devolver > 0 && (
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            <Field label="Devolver por">
                                <select className="input" value={devolucion.metodo_pago} onChange={(e) => setDevolucion({ ...devolucion, metodo_pago: e.target.value })}>
                                    {METODOS_COBRO.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
                                </select>
                            </Field>
                            {devolucion.metodo_pago === 'efectivo'
                                ? <p className="text-xs text-gray-500 self-end pb-2">Sale de la caja abierta de la sede.</p>
                                : <Field label="N° de operación (opcional)"><input className="input" value={devolucion.referencia} onChange={(e) => setDevolucion({ ...devolucion, referencia: e.target.value })} maxLength={100} /></Field>}
                        </div>
                    )}

                    <div className="flex gap-3 pt-1">
                        <button type="button" className="btn btn-secondary flex-1" onClick={onClose}>Cancelar</button>
                        <button type="submit" className={`btn flex-1 ${motivo?.modo === 'total' ? 'bg-rose-600 hover:bg-rose-700 text-white' : 'btn-primary'}`} disabled={saving || !motivo}>
                            {saving ? 'Emitiendo...' : `Emitir ${TIPO_LABEL[tipo].toLowerCase()} · ${money(total)}`}
                        </button>
                    </div>
                </form>
            )}
        </Modal>
    );
};

const Stat = ({ label, value }) => (
    <div className="p-3 rounded-xl bg-gray-50 border border-gray-100">
        <p className="text-[10px] font-black uppercase tracking-widest text-gray-500">{label}</p>
        <p className="font-black tabular-nums">{value}</p>
    </div>
);

export default NotaModal;
