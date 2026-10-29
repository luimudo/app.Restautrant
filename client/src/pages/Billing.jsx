import React, { useState, useEffect } from 'react';
import { FileText, CreditCard, Receipt, Printer, Clock, Banknote, Landmark, X, Download, BarChart3, RefreshCw, Pencil, FileDown } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { useAuth } from '../context/AuthContext';
import { formatDateTime, formatTime, startOfMonthYmd, toPeruYmd } from '../utils/dateTime';
import EmitirComprobanteModal from '../components/billing/EmitirComprobanteModal';
import EditComandaModal from '../components/billing/EditComandaModal';
import { descargarReporteVentasExcel } from '../utils/exportVentas';
import { BotonesInformeArqueo, HistorialArqueos } from '../components/billing/ArqueoInformes';
import ComprobantesPanel from '../components/billing/ComprobantesPanel';

const Billing = () => {
    const { activeUser } = useAuth();

    const [pedidos, setPedidos] = useState([]);
    const [cobrarPedido, setCobrarPedido] = useState(null);
    const [editarPedido, setEditarPedido] = useState(null);
    const [comprobantesKey, setComprobantesKey] = useState(0);
    const [loading, setLoading] = useState(true);
    const [totalHoy, setTotalHoy] = useState(0);
    const [showSalesReport, setShowSalesReport] = useState(false);
    const [salesReportLoading, setSalesReportLoading] = useState(false);
    const [salesReportError, setSalesReportError] = useState('');
    const [salesReport, setSalesReport] = useState(null);
    const [salesReportRange, setSalesReportRange] = useState(() => {
        const end = toPeruYmd();
        const start = startOfMonthYmd(end);
        return { desde: start, hasta: end };
    });
    const [showCashAudit, setShowCashAudit] = useState(false);
    const [cashAuditLoading, setCashAuditLoading] = useState(false);
    const [cashAuditError, setCashAuditError] = useState('');
    const [showHistorialArqueos, setShowHistorialArqueos] = useState(false);
    const [cajas, setCajas] = useState([]);
    const [activeCashSession, setActiveCashSession] = useState(null);
    const [openSessionForm, setOpenSessionForm] = useState({
        caja_id: '',
        // The cash count is done per shift: suggested from the current hour (Peru time).
        turno: (() => {
            const hora = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'America/Lima', hour: '2-digit', hour12: false }).format(new Date()));
            return hora < 12 ? 'Mañana' : hora < 18 ? 'Tarde' : 'Noche';
        })(),
        monto_inicial: '0',
        observaciones: ''
    });
    const [movementForm, setMovementForm] = useState({
        tipo: 'ingreso',
        categoria: 'egreso',
        monto: '',
        descripcion: ''
    });
    const [closeSessionForm, setCloseSessionForm] = useState({
        monto_contado: '',
        observaciones: ''
    });

    useEffect(() => {
        fetchPedidos();
        fetchTotalHoy();
    }, []);

    const fetchTotalHoy = async () => {
        try {
            const res = await fetch('/api/stats/ventas-hoy');
            const data = await res.json();
            setTotalHoy(data.total);
        } catch (error) {
            console.error('Error fetching today total:', error);
        }
    };

    const fetchPedidos = async () => {
        try {
            const res = await fetch('/api/pedidos');
            if (!res.ok) throw new Error('Error al cargar pedidos');
            const data = await res.json();

            if (Array.isArray(data)) {
                const chargeableOrders = data.filter((p) => {
                    const estado = String(p?.estado || '').toLowerCase();
                    const total = Number(p?.total || 0);
                    return estado !== 'pagado' && estado !== 'cancelado' && total > 0;
                });
                setPedidos(chargeableOrders);
            } else {
                setPedidos([]);
            }
        } catch (error) {
            console.error('Error fetching billing data:', error);
            setPedidos([]);
        } finally {
            setLoading(false);
        }
    };

    const formatCurrency = (value) => {
        return `S/ ${Number(value || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    };

    const fetchSalesReport = async (customRange) => {
        const range = customRange || salesReportRange;
        setSalesReportLoading(true);
        setSalesReportError('');
        try {
            const query = new URLSearchParams({
                desde: range.desde,
                hasta: range.hasta
            });
            const res = await fetch(`/api/reportes/ventas?${query.toString()}`);
            if (!res.ok) {
                const errData = await res.json().catch(() => ({}));
                throw new Error(errData.error || 'No se pudo obtener el reporte');
            }
            const data = await res.json();
            setSalesReport(data);
        } catch (error) {
            setSalesReportError(error.message || 'Error cargando reporte');
            setSalesReport(null);
        } finally {
            setSalesReportLoading(false);
        }
    };

    const openSalesReport = () => {
        setShowSalesReport(true);
        fetchSalesReport();
    };

    const closeSalesReport = () => {
        setShowSalesReport(false);
        setSalesReportError('');
    };

    const fetchCashAuditData = async () => {
        setCashAuditLoading(true);
        setCashAuditError('');
        try {
            const [cajasRes, activeRes] = await Promise.all([
                fetch('/api/cajas'),
                fetch('/api/caja/sesion-activa')
            ]);

            if (!cajasRes.ok) throw new Error('No se pudo cargar las cajas');
            if (!activeRes.ok) {
                const err = await activeRes.json().catch(() => ({}));
                throw new Error(err.error || 'No se pudo obtener sesion activa');
            }

            const cajasData = await cajasRes.json();
            const activeSessionData = await activeRes.json();

            const safeCajas = Array.isArray(cajasData) ? cajasData : [];
            setCajas(safeCajas);
            setActiveCashSession(activeSessionData || null);

            if (!openSessionForm.caja_id && safeCajas.length > 0) {
                setOpenSessionForm((prev) => ({
                    ...prev,
                    caja_id: String(safeCajas[0].id)
                }));
            }

            if (activeSessionData?.resumen?.monto_teorico !== undefined) {
                setCloseSessionForm((prev) => ({
                    ...prev,
                    monto_contado: String(activeSessionData.resumen.monto_teorico)
                }));
            }
        } catch (error) {
            setCashAuditError(error.message || 'Error cargando arqueo de caja');
            setActiveCashSession(null);
        } finally {
            setCashAuditLoading(false);
        }
    };

    const openCashAudit = () => {
        setShowCashAudit(true);
        fetchCashAuditData();
    };

    const closeCashAudit = () => {
        setShowCashAudit(false);
        setCashAuditError('');
    };

    const handleOpenCashSession = async (event) => {
        event.preventDefault();
        setCashAuditError('');
        try {
            const response = await fetch('/api/caja/apertura', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    caja_id: Number(openSessionForm.caja_id),
                    monto_inicial: Number(openSessionForm.monto_inicial) || 0,
                    turno: openSessionForm.turno,
                    observaciones: openSessionForm.observaciones
                })
            });

            if (!response.ok) {
                const err = await response.json().catch(() => ({}));
                throw new Error(err.error || 'No se pudo abrir caja');
            }

            const data = await response.json();
            setActiveCashSession(data);
            setCloseSessionForm((prev) => ({
                ...prev,
                monto_contado: String(data?.resumen?.monto_teorico ?? '')
            }));
            alert('Caja abierta correctamente.');
        } catch (error) {
            setCashAuditError(error.message || 'No se pudo abrir caja');
        }
    };

    const handleCreateManualMovement = async (event) => {
        event.preventDefault();
        if (!activeCashSession?.id) return;
        setCashAuditError('');
        try {
            const response = await fetch('/api/caja/movimiento-manual', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    sesion_id: activeCashSession.id,
                    tipo: movementForm.tipo,
                    categoria: movementForm.tipo === 'egreso' ? movementForm.categoria : undefined,
                    monto: Number(movementForm.monto) || 0,
                    descripcion: movementForm.descripcion
                })
            });

            if (!response.ok) {
                const err = await response.json().catch(() => ({}));
                throw new Error(err.error || 'No se pudo registrar movimiento');
            }

            const data = await response.json();
            setActiveCashSession(data);
            setMovementForm((prev) => ({ ...prev, monto: '', descripcion: '' }));
        } catch (error) {
            setCashAuditError(error.message || 'No se pudo registrar movimiento');
        }
    };

    const handleCloseCashSession = async (event) => {
        event.preventDefault();
        if (!activeCashSession?.id) return;
        setCashAuditError('');
        try {
            const response = await fetch('/api/caja/cierre', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    sesion_id: activeCashSession.id,
                    monto_contado: Number(closeSessionForm.monto_contado) || 0,
                    observaciones: closeSessionForm.observaciones
                })
            });

            if (!response.ok) {
                const err = await response.json().catch(() => ({}));
                throw new Error(err.error || 'No se pudo cerrar caja');
            }

            await response.json();
            alert('Caja cerrada correctamente.');
            setCloseSessionForm({
                monto_contado: '',
                observaciones: ''
            });
            await fetchCashAuditData();
        } catch (error) {
            setCashAuditError(error.message || 'No se pudo cerrar caja');
        }
    };

    // Excel in the "Ventas · modelo Excel" format: one row per receipt of the selected range.
    const [exportingSalesExcel, setExportingSalesExcel] = useState(false);
    const exportSalesReportExcel = async () => {
        setExportingSalesExcel(true);
        setSalesReportError('');
        try {
            const params = new URLSearchParams({ desde: salesReportRange.desde, hasta: salesReportRange.hasta });
            const res = await fetch(`/api/reportes/ventas/excel?${params}`);
            const body = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(body.error || 'No se pudo generar el Excel de ventas');
            if (body.filas.length === 0) throw new Error('No hay ventas en el rango seleccionado');
            await descargarReporteVentasExcel(body);
        } catch (error) {
            setSalesReportError(error.message || 'No se pudo generar el Excel de ventas');
        } finally {
            setExportingSalesExcel(false);
        }
    };

    const exportSalesReportPDF = () => {
        if (!salesReport) return;

        const doc = new jsPDF({ unit: 'mm', format: 'a4' });
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(15);
        doc.text('Reporte de Ventas', 14, 14);
        doc.setFontSize(10);
        doc.setFont('helvetica', 'normal');
        doc.text(`Periodo: ${salesReport.periodo.desde} a ${salesReport.periodo.hasta}`, 14, 21);

        autoTable(doc, {
            startY: 27,
            theme: 'grid',
            head: [['Metricas', 'Valor']],
            body: [
                ['Comprobantes', String(salesReport.resumen?.total_comprobantes ?? 0)],
                ['Total ventas', formatCurrency(salesReport.resumen?.total_ventas)],
                ['IGV', formatCurrency(salesReport.resumen?.total_igv)],
                ['Ticket promedio', formatCurrency(salesReport.resumen?.ticket_promedio)]
            ],
            styles: { fontSize: 9 }
        });

        const porTipo = Array.isArray(salesReport.por_tipo) ? salesReport.por_tipo : [];
        if (porTipo.length > 0) {
            autoTable(doc, {
                startY: doc.lastAutoTable.finalY + 8,
                theme: 'striped',
                head: [['Tipo', 'Cantidad', 'Total']],
                body: porTipo.map(row => [
                    row.tipo_comprobante,
                    String(row.cantidad),
                    formatCurrency(row.total)
                ]),
                styles: { fontSize: 9 },
                headStyles: { fillColor: [31, 41, 55] }
            });
        }

        const topProductos = Array.isArray(salesReport.top_productos) ? salesReport.top_productos : [];
        if (topProductos.length > 0) {
            autoTable(doc, {
                startY: doc.lastAutoTable.finalY + 8,
                theme: 'striped',
                head: [['Producto', 'Cantidad', 'Total']],
                body: topProductos.map(row => [
                    row.producto_nombre,
                    String(row.cantidad_vendida),
                    formatCurrency(row.total_vendido)
                ]),
                styles: { fontSize: 9 },
                headStyles: { fillColor: [16, 185, 129] }
            });
        }

        const comprobantes = Array.isArray(salesReport.comprobantes) ? salesReport.comprobantes : [];
        if (comprobantes.length > 0) {
            doc.addPage();
            doc.setFont('helvetica', 'bold');
            doc.setFontSize(13);
            doc.text('Detalle de Comprobantes', 14, 14);
            autoTable(doc, {
                startY: 20,
                theme: 'grid',
                head: [['Numero', 'Tipo', 'Mesa', 'Cliente', 'Total', 'Fecha']],
                body: comprobantes.map(row => [
                    row.numero_comprobante,
                    row.tipo_comprobante,
                    row.mesa_numero ? `Mesa ${row.mesa_numero}` : '-',
                    row.cliente_nombre,
                    formatCurrency(row.total_venta),
                    formatDateTime(row.fecha_emision)
                ]),
                styles: { fontSize: 8 }
            });
        }

        doc.save(`reporte_ventas_${salesReport.periodo.desde}_${salesReport.periodo.hasta}.pdf`);
    };

    // Called once the receipt is issued: the order leaves the pending list and totals refresh.
    const handleEmitido = (factura) => {
        setPedidos((prev) => prev.filter((p) => p.id !== factura.pedido_id));
        setComprobantesKey((key) => key + 1);
        fetchTotalHoy();
        if (showCashAudit) {
            fetchCashAuditData();
        }
    };

    return (
        <div className="space-y-10 animate-fade-in">
            {/* Header Section */}
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
                <div>
                    <h2 className="text-4xl font-display font-black tracking-tight leading-none">
                        Caja y <span className="text-brand-600">Facturación</span>
                    </h2>
                    <p className="text-[var(--text-secondary)] mt-1.5 font-medium">Gestiona los cobros de tus mesas y emite comprobantes electrónicos.</p>
                </div>
                <div className="flex gap-3">
                    <button onClick={openCashAudit} className="btn btn-secondary bg-white border border-[var(--border-color)] text-[var(--text-secondary)]">
                        <Banknote size={18} /> Arqueo de Caja
                    </button>
                    <button onClick={openSalesReport} className="btn btn-primary shadow-xl shadow-brand-200">
                        <BarChart3 size={18} /> Ver Reportes de Venta
                    </button>
                </div>
            </div>

            {/* List Section */}
            <div className="card shadow-2xl relative overflow-hidden p-0 border-none">
                <div className="absolute top-0 left-0 w-full h-1.5 bg-brand-600"></div>

                <div className="p-8 border-b border-gray-100 flex items-center justify-between bg-brand-50/20">
                    <div className="flex items-center gap-4">
                        <div className="w-12 h-12 bg-white rounded-2xl flex items-center justify-center text-brand-600 shadow-sm border border-brand-100">
                            <Receipt size={24} />
                        </div>
                        <div>
                            <h3 className="text-xl font-display font-black tracking-tight">Comandas Pendientes</h3>
                            <p className="text-xs text-brand-600 font-bold uppercase tracking-widest">Listo para cobrar</p>
                        </div>
                    </div>
                    <div className="px-4 py-2 bg-white rounded-xl border border-brand-100 text-xs font-bold text-brand-700">
                        {pedidos.length} Pedidos por cobrar
                    </div>
                </div>

                <div className="p-8 overflow-x-auto">
                    <table className="w-full border-collapse">
                        <thead>
                            <tr className="bg-gray-50/50">
                                <th className="px-6 py-4 text-left text-xs font-black uppercase tracking-[0.2em] text-[var(--text-muted)] border-b border-gray-100">Pedido / ID</th>
                                <th className="px-6 py-4 text-center text-xs font-black uppercase tracking-[0.2em] text-[var(--text-muted)] border-b border-gray-100">Ubicación</th>
                                <th className="px-6 py-4 text-center text-xs font-black uppercase tracking-[0.2em] text-[var(--text-muted)] border-b border-gray-100">Monto Total</th>
                                <th className="px-6 py-4 text-center text-xs font-black uppercase tracking-[0.2em] text-[var(--text-muted)] border-b border-gray-100">Tiempo Transcurrido</th>
                                <th className="px-6 py-4 text-center text-xs font-black uppercase tracking-[0.2em] text-[var(--text-muted)] border-b border-gray-100">Acciones</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-50">
                            {loading ? (
                                <tr>
                                    <td colSpan="6" className="px-6 py-20 text-center">
                                        <div className="flex flex-col items-center">
                                            <div className="w-10 h-10 border-4 border-brand-100 border-t-brand-600 rounded-full animate-spin mb-4"></div>
                                            <p className="font-bold text-gray-500 font-display">Sincronizando caja...</p>
                                        </div>
                                    </td>
                                </tr>
                            ) : pedidos.length === 0 ? (
                                <tr>
                                    <td colSpan="6" className="px-6 py-20 text-center">
                                        <div className="flex flex-col items-center max-w-sm mx-auto">
                                            <div className="w-20 h-20 bg-gray-50 rounded-full flex items-center justify-center mb-6 border-2 border-dashed border-gray-200">
                                                <CreditCard size={32} className="text-gray-300" />
                                            </div>
                                            <p className="font-display font-bold text-lg text-gray-900 mb-2">Todo en Orden</p>
                                            <p className="text-sm text-gray-500 font-medium leading-relaxed">No hay pedidos pendientes de cobro en este momento. Todas las cuentas están al día.</p>
                                        </div>
                                    </td>
                                </tr>
                            ) : (
                                pedidos.map((pedido, idx) => (
                                    <motion.tr
                                        initial={{ opacity: 0, y: 10 }}
                                        animate={{ opacity: 1, y: 0 }}
                                        transition={{ delay: idx * 0.05 }}
                                        key={pedido.id}
                                        className="hover:bg-brand-50/10 transition-colors group"
                                    >
                                        <td className="px-6 py-5">
                                            <div className="flex items-center gap-4">
                                                <div className="w-10 h-10 rounded-xl bg-gray-50 border border-gray-100 flex items-center justify-center font-black text-xs text-gray-400 group-hover:bg-white group-hover:text-brand-600 group-hover:border-brand-100 transition-all">
                                                    #{pedido.id}
                                                </div>
                                                <div>
                                                    <p className="font-black text-gray-900 leading-none">{pedido.es_delivery ? (pedido.delivery_cliente || 'Delivery') : 'Venta Directa'}</p>
                                                    <p className="text-[10px] font-bold text-brand-600 mt-1 uppercase tracking-widest leading-none">{pedido.es_delivery ? `Delivery · ${pedido.delivery_estado}` : 'Pedido de Comedor'}</p>
                                                </div>
                                            </div>
                                        </td>
                                        <td className="px-6 py-5 text-center">
                                            <span className="px-3 py-1.5 bg-gray-100 text-gray-700 rounded-xl text-xs font-black uppercase tracking-widest border border-gray-200">
                                                {pedido.es_delivery ? 'Delivery' : `Mesa ${pedido.mesa_id}`}
                                            </span>
                                        </td>
                                        <td className="px-6 py-5 text-center">
                                            <p className="text-xl font-display font-black text-brand-700">S/ {Number(pedido.total).toFixed(2)}</p>
                                            <p className="text-[10px] text-gray-400 font-bold uppercase tracking-widest leading-none mt-1">INC. IGV</p>
                                        </td>
                                        <td className="px-6 py-5 text-center">
                                            <div className="flex flex-col items-center gap-1.5 text-xs font-semibold text-gray-500">
                                                <div className="flex items-center gap-1.5">
                                                    <Clock size={12} className="text-brand-500" />
                                                    {formatTime(pedido.fecha_creacion)}
                                                </div>
                                                <p className="text-[10px] font-bold uppercase text-gray-400">Hace 12 min</p>
                                            </div>
                                        </td>
                                        <td className="px-6 py-5">
                                            <div className="flex items-center justify-center gap-3">
                                                <button
                                                    onClick={() => setEditarPedido(pedido)}
                                                    className="px-4 py-2.5 border border-gray-200 bg-white text-gray-700 rounded-xl text-xs font-bold hover:border-brand-300 hover:text-brand-700 transition-all flex items-center gap-2"
                                                >
                                                    <Pencil size={14} /> Editar
                                                </button>
                                                <button
                                                    onClick={() => setCobrarPedido(pedido)}
                                                    className="px-5 py-2.5 bg-brand-600 text-white rounded-xl text-xs font-bold hover:bg-brand-700 hover:shadow-lg hover:shadow-brand-200 transition-all flex items-center gap-2"
                                                >
                                                    <Receipt size={14} /> Cobrar
                                                </button>
                                            </div>
                                        </td>
                                    </motion.tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            <ComprobantesPanel refreshKey={comprobantesKey} onChanged={() => { fetchTotalHoy(); if (showCashAudit) fetchCashAuditData(); }} />

            {/* Quick Actions / Statistics */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                <div className="card bg-gray-900 border-none text-white overflow-hidden relative p-8">
                    <div className="absolute top-0 right-0 p-8 opacity-20 group-hover:scale-110 transition-transform">
                        <Printer size={120} />
                    </div>
                    <div className="relative z-10">
                        <h4 className="text-xl font-display font-black mb-2">Impresión Automática</h4>
                        <p className="text-gray-400 text-sm font-medium mb-6 max-w-xs leading-relaxed">Configura la emisión automática de comprobantes al confirmar el pago en el POS.</p>
                        <button className="px-6 py-3 bg-white text-gray-900 rounded-2xl font-black text-xs uppercase tracking-widest hover:bg-brand-500 hover:text-white transition-colors">
                            Configurar Terminal
                        </button>
                    </div>
                </div>

                <div className="card p-8 border-2 border-brand-50 flex items-center justify-between">
                    <div>
                        <h4 className="text-xl font-display font-black text-gray-900 mb-1">Total de Ventas (Hoy)</h4>
                        <p className="text-brand-600 font-bold text-sm uppercase tracking-widest">Resumen Actualizado</p>
                        <p className="text-4xl font-display font-black text-gray-900 mt-4 leading-none">S/ {Number(totalHoy).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
                    </div>
                    <div className="w-20 h-20 bg-emerald-50 text-emerald-600 rounded-3xl flex items-center justify-center border border-emerald-100 shadow-sm shadow-emerald-50">
                        <TrendingUp size={40} />
                    </div>
                </div>
            </div>

            {editarPedido && (
                <EditComandaModal
                    pedido={editarPedido}
                    onClose={() => setEditarPedido(null)}
                    onSaved={() => {
                        setEditarPedido(null);
                        fetchPedidos();
                    }}
                />
            )}

            {showHistorialArqueos && <HistorialArqueos onClose={() => setShowHistorialArqueos(false)} />}

            {cobrarPedido && (
                <EmitirComprobanteModal pedido={cobrarPedido} onClose={() => setCobrarPedido(null)} onEmitido={handleEmitido} />
            )}

            <AnimatePresence>
                {showCashAudit && (
                    <motion.div
                        className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm p-4 md:p-8 overflow-y-auto"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        onClick={closeCashAudit}
                    >
                        <motion.div
                            className="max-w-5xl mx-auto bg-white rounded-2xl shadow-2xl border border-gray-100"
                            initial={{ opacity: 0, y: 20 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: 20 }}
                            transition={{ duration: 0.2 }}
                            onClick={(event) => event.stopPropagation()}
                        >
                            <div className="p-6 border-b border-gray-100 flex flex-col md:flex-row gap-4 md:items-center md:justify-between">
                                <div>
                                    <h3 className="text-2xl font-display font-black text-gray-900">Arqueo de Caja</h3>
                                    <p className="text-sm text-gray-500 font-medium">Apertura, movimientos manuales y cierre de caja con diferencia.</p>
                                </div>
                                <div className="flex items-center gap-2">
                                    <button
                                        type="button"
                                        onClick={() => setShowHistorialArqueos(true)}
                                        className="px-3 py-2 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 text-sm font-bold flex items-center gap-2"
                                    >
                                        <FileDown size={16} /> Historial e informes
                                    </button>
                                    <button
                                        type="button"
                                        onClick={fetchCashAuditData}
                                        className="px-3 py-2 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50"
                                    >
                                        <RefreshCw size={16} />
                                    </button>
                                    <button
                                        type="button"
                                        onClick={closeCashAudit}
                                        className="px-3 py-2 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50"
                                    >
                                        <X size={16} />
                                    </button>
                                </div>
                            </div>

                            <div className="p-6 space-y-6">
                                {cashAuditError && (
                                    <div className="p-4 rounded-xl border border-red-200 bg-red-50 text-red-700 text-sm font-semibold">
                                        {cashAuditError}
                                    </div>
                                )}

                                {cashAuditLoading ? (
                                    <div className="py-16 flex items-center justify-center">
                                        <div className="w-10 h-10 border-4 border-brand-100 border-t-brand-600 rounded-full animate-spin"></div>
                                    </div>
                                ) : !activeCashSession ? (
                                    <div className="space-y-4">
                                        <h4 className="text-lg font-black text-gray-900">Apertura de Caja</h4>
                                        {cajas.length === 0 ? (
                                            <p className="text-sm text-gray-500">No hay cajas configuradas. Crea una caja primero en backend/configuracion.</p>
                                        ) : (
                                            <form onSubmit={handleOpenCashSession} className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                                <div>
                                                    <label className="block text-xs font-bold uppercase tracking-wider text-gray-500 mb-2">Caja</label>
                                                    <select
                                                        className="w-full px-3 py-2.5 rounded-xl border border-gray-200 font-medium text-sm"
                                                        value={openSessionForm.caja_id}
                                                        onChange={(e) => setOpenSessionForm((prev) => ({ ...prev, caja_id: e.target.value }))}
                                                        required
                                                    >
                                                        <option value="">Selecciona caja</option>
                                                        {cajas.map((caja) => (
                                                            <option key={caja.id} value={caja.id}>{caja.descripcion}</option>
                                                        ))}
                                                    </select>
                                                </div>
                                                <div>
                                                    <label className="block text-xs font-bold uppercase tracking-wider text-gray-500 mb-2">Monto Inicial</label>
                                                    <input
                                                        type="number"
                                                        min="0"
                                                        step="0.01"
                                                        className="w-full px-3 py-2.5 rounded-xl border border-gray-200 font-medium text-sm"
                                                        value={openSessionForm.monto_inicial}
                                                        onChange={(e) => setOpenSessionForm((prev) => ({ ...prev, monto_inicial: e.target.value }))}
                                                        required
                                                    />
                                                </div>
                                                <div>
                                                    <label className="block text-xs font-bold uppercase tracking-wider text-gray-500 mb-2">Turno</label>
                                                    <select
                                                        className="w-full px-3 py-2.5 rounded-xl border border-gray-200 font-medium text-sm"
                                                        value={openSessionForm.turno}
                                                        onChange={(e) => setOpenSessionForm((prev) => ({ ...prev, turno: e.target.value }))}
                                                    >
                                                        <option value="Mañana">Mañana</option>
                                                        <option value="Tarde">Tarde</option>
                                                        <option value="Noche">Noche</option>
                                                        <option value="">Sin turno</option>
                                                    </select>
                                                </div>
                                                <div>
                                                    <label className="block text-xs font-bold uppercase tracking-wider text-gray-500 mb-2">Observaciones</label>
                                                    <input
                                                        type="text"
                                                        className="w-full px-3 py-2.5 rounded-xl border border-gray-200 font-medium text-sm"
                                                        value={openSessionForm.observaciones}
                                                        onChange={(e) => setOpenSessionForm((prev) => ({ ...prev, observaciones: e.target.value }))}
                                                    />
                                                </div>
                                                <div className="md:col-span-2">
                                                    <button
                                                        type="submit"
                                                        className="px-4 py-2.5 rounded-xl bg-brand-600 text-white text-sm font-bold"
                                                    >
                                                        Abrir Caja
                                                    </button>
                                                </div>
                                            </form>
                                        )}
                                    </div>
                                ) : (
                                    <div className="space-y-6">
                                        <div className="flex flex-wrap items-center gap-3">
                                            <span className="px-3 py-1.5 rounded-lg bg-brand-50 text-brand-700 text-xs font-black uppercase">
                                                Sesion #{activeCashSession.id}
                                            </span>
                                            <span className="px-3 py-1.5 rounded-lg bg-emerald-50 text-emerald-700 text-xs font-black uppercase">
                                                {activeCashSession.estado}
                                            </span>
                                            {activeCashSession.turno && (
                                                <span className="px-3 py-1.5 rounded-lg bg-sky-50 text-sky-700 text-xs font-black uppercase">Turno {activeCashSession.turno}</span>
                                            )}
                                            <span className="text-xs font-bold text-gray-500">
                                                Caja: {activeCashSession.caja_descripcion || activeCashSession.caja_id}
                                            </span>
                                            <div className="ml-auto flex items-center gap-2">
                                                <span className="text-[10px] font-black uppercase tracking-widest text-gray-400">Informe de movimientos</span>
                                                <BotonesInformeArqueo sesionId={activeCashSession.id} compacto onError={setCashAuditError} />
                                            </div>
                                        </div>

                                        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
                                            <SummaryCard title="Monto Inicial" value={formatCurrency(activeCashSession.resumen?.monto_inicial)} />
                                            <SummaryCard title="Ingresos Manuales" value={formatCurrency(activeCashSession.resumen?.ingresos_manual)} />
                                            <SummaryCard title="Egresos Manuales" value={formatCurrency(activeCashSession.resumen?.egresos_manual)} />
                                            <SummaryCard title="Ventas Facturadas" value={formatCurrency(activeCashSession.resumen?.ventas_totales)} />
                                            <SummaryCard title="Cobros en Efectivo" value={formatCurrency(activeCashSession.resumen?.cobros_efectivo)} />
                                            <SummaryCard title="Cobros Tarjeta / Digital" value={formatCurrency(activeCashSession.resumen?.cobros_otros)} />
                                            <SummaryCard title="Monto Teorico" value={formatCurrency(activeCashSession.resumen?.monto_teorico)} highlight />
                                            <SummaryCard title="Comprobantes" value={String(activeCashSession.resumen?.comprobantes || 0)} />
                                        </div>

                                        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
                                            <div className="border border-gray-100 rounded-2xl p-4 space-y-4">
                                                <h4 className="text-sm font-black uppercase tracking-wider text-gray-700">Movimiento Manual</h4>
                                                <form onSubmit={handleCreateManualMovement} className="space-y-3">
                                                    <div className="grid grid-cols-2 gap-3">
                                                        <select
                                                            className="w-full px-3 py-2.5 rounded-xl border border-gray-200 font-medium text-sm"
                                                            value={movementForm.tipo}
                                                            onChange={(e) => setMovementForm((prev) => ({ ...prev, tipo: e.target.value }))}
                                                        >
                                                            <option value="ingreso">Ingreso</option>
                                                            <option value="egreso">Egreso</option>
                                                        </select>
                                                        <input
                                                            type="number"
                                                            min="0.01"
                                                            step="0.01"
                                                            placeholder="Monto"
                                                            className="w-full px-3 py-2.5 rounded-xl border border-gray-200 font-medium text-sm"
                                                            value={movementForm.monto}
                                                            onChange={(e) => setMovementForm((prev) => ({ ...prev, monto: e.target.value }))}
                                                            required
                                                        />
                                                    </div>
                                                    {movementForm.tipo === 'egreso' && (
                                                        <select
                                                            className="w-full px-3 py-2.5 rounded-xl border border-gray-200 font-medium text-sm"
                                                            value={movementForm.categoria}
                                                            onChange={(e) => setMovementForm((prev) => ({ ...prev, categoria: e.target.value }))}
                                                            aria-label="Tipo de egreso"
                                                        >
                                                            <option value="egreso">Egreso (gasto menor de la caja)</option>
                                                            <option value="retiro">Retiro / entrega de caja</option>
                                                        </select>
                                                    )}
                                                    <input
                                                        type="text"
                                                        placeholder="Descripcion"
                                                        className="w-full px-3 py-2.5 rounded-xl border border-gray-200 font-medium text-sm"
                                                        value={movementForm.descripcion}
                                                        onChange={(e) => setMovementForm((prev) => ({ ...prev, descripcion: e.target.value }))}
                                                    />
                                                    <button
                                                        type="submit"
                                                        className="px-4 py-2.5 rounded-xl bg-gray-900 text-white text-sm font-bold"
                                                    >
                                                        Registrar Movimiento
                                                    </button>
                                                </form>
                                            </div>

                                            <div className="border border-gray-100 rounded-2xl p-4 space-y-4">
                                                <h4 className="text-sm font-black uppercase tracking-wider text-gray-700">Cierre de Caja</h4>
                                                <form onSubmit={handleCloseCashSession} className="space-y-3">
                                                    <input
                                                        type="number"
                                                        min="0"
                                                        step="0.01"
                                                        placeholder="Monto contado"
                                                        className="w-full px-3 py-2.5 rounded-xl border border-gray-200 font-medium text-sm"
                                                        value={closeSessionForm.monto_contado}
                                                        onChange={(e) => setCloseSessionForm((prev) => ({ ...prev, monto_contado: e.target.value }))}
                                                        required
                                                    />
                                                    <input
                                                        type="text"
                                                        placeholder="Observaciones de cierre"
                                                        className="w-full px-3 py-2.5 rounded-xl border border-gray-200 font-medium text-sm"
                                                        value={closeSessionForm.observaciones}
                                                        onChange={(e) => setCloseSessionForm((prev) => ({ ...prev, observaciones: e.target.value }))}
                                                    />
                                                    <button
                                                        type="submit"
                                                        className="px-4 py-2.5 rounded-xl bg-brand-600 text-white text-sm font-bold"
                                                    >
                                                        Cerrar Caja
                                                    </button>
                                                </form>
                                            </div>
                                        </div>

                                        <div className="border border-gray-100 rounded-2xl overflow-hidden">
                                            <div className="px-4 py-3 bg-gray-50 border-b border-gray-100">
                                                <h4 className="text-sm font-black text-gray-800 uppercase tracking-wider">Movimientos de la Sesion</h4>
                                            </div>
                                            <div className="max-h-[240px] overflow-y-auto">
                                                <table className="w-full text-sm">
                                                    <thead className="sticky top-0 bg-white">
                                                        <tr className="text-gray-500 text-xs uppercase tracking-wider border-b border-gray-100">
                                                            <th className="px-4 py-3 text-left">Tipo</th>
                                                            <th className="px-4 py-3 text-left">Descripcion</th>
                                                            <th className="px-4 py-3 text-right">Monto</th>
                                                            <th className="px-4 py-3 text-right">Fecha</th>
                                                        </tr>
                                                    </thead>
                                                    <tbody>
                                                        {(activeCashSession.movimientos || []).map((item) => (
                                                            <tr key={item.id} className="border-b border-gray-50">
                                                                <td className="px-4 py-3 font-semibold uppercase">{item.tipo}</td>
                                                                <td className="px-4 py-3">{item.descripcion || '-'}</td>
                                                                <td className="px-4 py-3 text-right font-semibold">{formatCurrency(item.monto)}</td>
                                                                <td className="px-4 py-3 text-right">{formatDateTime(item.fecha)}</td>
                                                            </tr>
                                                        ))}
                                                        {(activeCashSession.movimientos || []).length === 0 && (
                                                            <tr>
                                                                <td colSpan="4" className="px-4 py-6 text-center text-gray-500">Sin movimientos manuales.</td>
                                                            </tr>
                                                        )}
                                                    </tbody>
                                                </table>
                                            </div>
                                        </div>
                                    </div>
                                )}
                            </div>
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>

            <AnimatePresence>
                {showSalesReport && (
                    <motion.div
                        className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm p-4 md:p-8 overflow-y-auto"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                    >
                        <motion.div
                            className="max-w-6xl mx-auto bg-white rounded-2xl shadow-2xl border border-gray-100"
                            initial={{ opacity: 0, y: 20 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: 20 }}
                            transition={{ duration: 0.2 }}
                            onClick={(e) => e.stopPropagation()}
                        >
                            <div className="p-6 border-b border-gray-100 flex flex-col md:flex-row gap-4 md:items-center md:justify-between">
                                <div>
                                    <h3 className="text-2xl font-display font-black text-gray-900">Reporte de Ventas</h3>
                                    <p className="text-sm text-gray-500 font-medium">Analiza comprobantes, montos y productos mas vendidos por rango de fechas.</p>
                                </div>
                                <button onClick={closeSalesReport} className="self-start md:self-auto p-2 rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50">
                                    <X size={18} />
                                </button>
                            </div>

                            <div className="p-6 space-y-6">
                                <div className="grid grid-cols-1 md:grid-cols-[1fr_1fr_auto_auto] gap-3 items-end">
                                    <div>
                                        <label className="block text-xs font-bold uppercase tracking-wider text-gray-500 mb-2">Desde</label>
                                        <input
                                            type="date"
                                            value={salesReportRange.desde}
                                            onChange={(e) => setSalesReportRange(prev => ({ ...prev, desde: e.target.value }))}
                                            className="w-full px-3 py-2.5 rounded-xl border border-gray-200 font-medium text-sm"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-xs font-bold uppercase tracking-wider text-gray-500 mb-2">Hasta</label>
                                        <input
                                            type="date"
                                            value={salesReportRange.hasta}
                                            onChange={(e) => setSalesReportRange(prev => ({ ...prev, hasta: e.target.value }))}
                                            className="w-full px-3 py-2.5 rounded-xl border border-gray-200 font-medium text-sm"
                                        />
                                    </div>
                                    <button
                                        onClick={() => fetchSalesReport(salesReportRange)}
                                        disabled={salesReportLoading}
                                        className="px-4 py-2.5 rounded-xl bg-brand-600 text-white text-sm font-bold disabled:opacity-50"
                                    >
                                        {salesReportLoading ? 'Consultando...' : 'Consultar'}
                                    </button>
                                    <button
                                        onClick={exportSalesReportPDF}
                                        disabled={!salesReport || salesReportLoading}
                                        className="px-4 py-2.5 rounded-xl border border-gray-300 text-gray-700 text-sm font-bold flex items-center justify-center gap-2 disabled:opacity-50"
                                    >
                                        <Download size={16} /> Exportar PDF
                                    </button>
                                    <button
                                        onClick={exportSalesReportExcel}
                                        disabled={exportingSalesExcel}
                                        className="px-4 py-2.5 rounded-xl border border-green-700 bg-green-700 text-white text-sm font-bold flex items-center justify-center gap-2 disabled:opacity-50"
                                    >
                                        <Download size={16} /> {exportingSalesExcel ? 'Generando...' : 'Exportar Excel'}
                                    </button>
                                </div>

                                {salesReportError && (
                                    <div className="p-4 rounded-xl border border-red-200 bg-red-50 text-red-700 text-sm font-semibold">
                                        {salesReportError}
                                    </div>
                                )}

                                {salesReportLoading ? (
                                    <div className="py-16 flex items-center justify-center">
                                        <div className="w-10 h-10 border-4 border-brand-100 border-t-brand-600 rounded-full animate-spin"></div>
                                    </div>
                                ) : salesReport && (
                                    <div className="space-y-6">
                                        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
                                            <div className="p-4 rounded-2xl border border-gray-100 bg-gray-50">
                                                <p className="text-xs font-bold uppercase tracking-wider text-gray-500">Comprobantes</p>
                                                <p className="text-2xl font-black text-gray-900 mt-2">{salesReport.resumen?.total_comprobantes ?? 0}</p>
                                            </div>
                                            <div className="p-4 rounded-2xl border border-gray-100 bg-emerald-50">
                                                <p className="text-xs font-bold uppercase tracking-wider text-emerald-700">Total Ventas</p>
                                                <p className="text-2xl font-black text-emerald-700 mt-2">{formatCurrency(salesReport.resumen?.total_ventas)}</p>
                                            </div>
                                            <div className="p-4 rounded-2xl border border-gray-100 bg-amber-50">
                                                <p className="text-xs font-bold uppercase tracking-wider text-amber-700">IGV</p>
                                                <p className="text-2xl font-black text-amber-700 mt-2">{formatCurrency(salesReport.resumen?.total_igv)}</p>
                                            </div>
                                            <div className="p-4 rounded-2xl border border-gray-100 bg-blue-50">
                                                <p className="text-xs font-bold uppercase tracking-wider text-blue-700">Ticket Promedio</p>
                                                <p className="text-2xl font-black text-blue-700 mt-2">{formatCurrency(salesReport.resumen?.ticket_promedio)}</p>
                                            </div>
                                        </div>

                                        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
                                            <div className="border border-gray-100 rounded-2xl overflow-hidden">
                                                <div className="px-4 py-3 bg-gray-50 border-b border-gray-100">
                                                    <h4 className="text-sm font-black text-gray-800 uppercase tracking-wider">Resumen por Tipo</h4>
                                                </div>
                                                <div className="overflow-x-auto">
                                                    <table className="w-full text-sm">
                                                        <thead>
                                                            <tr className="text-gray-500 text-xs uppercase tracking-wider">
                                                                <th className="px-4 py-3 text-left">Tipo</th>
                                                                <th className="px-4 py-3 text-right">Cantidad</th>
                                                                <th className="px-4 py-3 text-right">Total</th>
                                                            </tr>
                                                        </thead>
                                                        <tbody>
                                                            {(salesReport.por_tipo || []).map((item) => (
                                                                <tr key={item.tipo_comprobante} className="border-t border-gray-50">
                                                                    <td className="px-4 py-3 font-bold">{item.tipo_comprobante}</td>
                                                                    <td className="px-4 py-3 text-right font-semibold">{item.cantidad}</td>
                                                                    <td className="px-4 py-3 text-right font-semibold">{formatCurrency(item.total)}</td>
                                                                </tr>
                                                            ))}
                                                        </tbody>
                                                    </table>
                                                </div>
                                            </div>

                                            <div className="border border-gray-100 rounded-2xl overflow-hidden">
                                                <div className="px-4 py-3 bg-gray-50 border-b border-gray-100">
                                                    <h4 className="text-sm font-black text-gray-800 uppercase tracking-wider">Top Productos</h4>
                                                </div>
                                                <div className="overflow-x-auto">
                                                    <table className="w-full text-sm">
                                                        <thead>
                                                            <tr className="text-gray-500 text-xs uppercase tracking-wider">
                                                                <th className="px-4 py-3 text-left">Producto</th>
                                                                <th className="px-4 py-3 text-right">Cantidad</th>
                                                                <th className="px-4 py-3 text-right">Total</th>
                                                            </tr>
                                                        </thead>
                                                        <tbody>
                                                            {(salesReport.top_productos || []).map((item, idx) => (
                                                                <tr key={`${item.producto_nombre}-${idx}`} className="border-t border-gray-50">
                                                                    <td className="px-4 py-3 font-semibold">{item.producto_nombre}</td>
                                                                    <td className="px-4 py-3 text-right font-semibold">{item.cantidad_vendida}</td>
                                                                    <td className="px-4 py-3 text-right font-semibold">{formatCurrency(item.total_vendido)}</td>
                                                                </tr>
                                                            ))}
                                                        </tbody>
                                                    </table>
                                                </div>
                                            </div>
                                        </div>

                                        <div className="border border-gray-100 rounded-2xl overflow-hidden">
                                            <div className="px-4 py-3 bg-gray-50 border-b border-gray-100">
                                                <h4 className="text-sm font-black text-gray-800 uppercase tracking-wider">Detalle de Comprobantes</h4>
                                            </div>
                                            <div className="overflow-x-auto max-h-[360px]">
                                                <table className="w-full text-sm">
                                                    <thead className="sticky top-0 bg-white">
                                                        <tr className="text-gray-500 text-xs uppercase tracking-wider border-b border-gray-100">
                                                            <th className="px-4 py-3 text-left">Numero</th>
                                                            <th className="px-4 py-3 text-left">Tipo</th>
                                                            <th className="px-4 py-3 text-left">Mesa</th>
                                                            <th className="px-4 py-3 text-left">Cliente</th>
                                                            <th className="px-4 py-3 text-right">Total</th>
                                                            <th className="px-4 py-3 text-right">Fecha</th>
                                                        </tr>
                                                    </thead>
                                                    <tbody>
                                                        {(salesReport.comprobantes || []).map((item) => (
                                                            <tr key={item.id} className="border-b border-gray-50">
                                                                <td className="px-4 py-3 font-semibold">{item.numero_comprobante}</td>
                                                                <td className="px-4 py-3">{item.tipo_comprobante}</td>
                                                                <td className="px-4 py-3">{item.mesa_numero ? `Mesa ${item.mesa_numero}` : '-'}</td>
                                                                <td className="px-4 py-3">{item.cliente_nombre}</td>
                                                                <td className="px-4 py-3 text-right font-semibold">{formatCurrency(item.total_venta)}</td>
                                                                <td className="px-4 py-3 text-right">{formatDateTime(item.fecha_emision)}</td>
                                                            </tr>
                                                        ))}
                                                    </tbody>
                                                </table>
                                            </div>
                                        </div>
                                    </div>
                                )}
                            </div>
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
};

const TrendingUp = ({ size }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="23 6 13.5 15.5 8.5 10.5 1 18"></polyline>
        <polyline points="17 6 23 6 23 12"></polyline>
    </svg>
);

const SummaryCard = ({ title, value, highlight = false }) => (
    <div className={`rounded-2xl border p-4 ${highlight ? 'border-brand-200 bg-brand-50/40' : 'border-gray-100 bg-white'}`}>
        <p className={`text-xs font-black uppercase tracking-wider ${highlight ? 'text-brand-700' : 'text-gray-500'}`}>
            {title}
        </p>
        <p className={`mt-2 text-2xl font-display font-black ${highlight ? 'text-brand-700' : 'text-gray-900'}`}>
            {value}
        </p>
    </div>
);

export default Billing;
