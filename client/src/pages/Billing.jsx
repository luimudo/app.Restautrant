import React, { useState, useEffect } from 'react';
import { FileText, CreditCard, Receipt, Printer, Clock, Banknote, Landmark, X, Download, BarChart3, RefreshCw } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { useAuth } from '../context/AuthContext';

const Billing = () => {
    const { activeUser } = useAuth();
    const activeUserId = activeUser?.id ? String(activeUser.id) : '';

    const [pedidos, setPedidos] = useState([]);
    const [loading, setLoading] = useState(true);
    const [totalHoy, setTotalHoy] = useState(0);
    const [showSalesReport, setShowSalesReport] = useState(false);
    const [salesReportLoading, setSalesReportLoading] = useState(false);
    const [salesReportError, setSalesReportError] = useState('');
    const [salesReport, setSalesReport] = useState(null);
    const [salesReportRange, setSalesReportRange] = useState(() => {
        const now = new Date();
        const end = now.toISOString().slice(0, 10);
        const start = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
        return { desde: start, hasta: end };
    });
    const [showCashAudit, setShowCashAudit] = useState(false);
    const [cashAuditLoading, setCashAuditLoading] = useState(false);
    const [cashAuditError, setCashAuditError] = useState('');
    const [cajas, setCajas] = useState([]);
    const [activeCashSession, setActiveCashSession] = useState(null);
    const [openSessionForm, setOpenSessionForm] = useState({
        caja_id: '',
        monto_inicial: '0',
        usuario_id: '',
        observaciones: ''
    });
    const [movementForm, setMovementForm] = useState({
        tipo: 'ingreso',
        monto: '',
        descripcion: '',
        usuario_id: ''
    });
    const [closeSessionForm, setCloseSessionForm] = useState({
        monto_contado: '',
        usuario_cierre_id: '',
        observaciones: ''
    });

    useEffect(() => {
        fetchPedidos();
        fetchTotalHoy();
    }, []);

    useEffect(() => {
        if (!activeUserId) return;

        setOpenSessionForm((prev) => ({ ...prev, usuario_id: activeUserId }));
        setMovementForm((prev) => ({ ...prev, usuario_id: activeUserId }));
        setCloseSessionForm((prev) => ({ ...prev, usuario_cierre_id: activeUserId }));
    }, [activeUserId]);

    const fetchTotalHoy = async () => {
        try {
            const res = await fetch('http://localhost:3000/api/stats/ventas-hoy');
            const data = await res.json();
            setTotalHoy(data.total);
        } catch (error) {
            console.error('Error fetching today total:', error);
        }
    };

    const fetchPedidos = async () => {
        try {
            const res = await fetch('http://localhost:3000/api/pedidos');
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
            const res = await fetch(`http://localhost:3000/api/reportes/ventas?${query.toString()}`);
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
                fetch('http://localhost:3000/api/cajas'),
                fetch('http://localhost:3000/api/caja/sesion-activa')
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
            const response = await fetch('http://localhost:3000/api/caja/apertura', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    caja_id: Number(openSessionForm.caja_id),
                    usuario_id: Number(openSessionForm.usuario_id) || null,
                    monto_inicial: Number(openSessionForm.monto_inicial) || 0,
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
            const response = await fetch('http://localhost:3000/api/caja/movimiento-manual', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    sesion_id: activeCashSession.id,
                    tipo: movementForm.tipo,
                    monto: Number(movementForm.monto) || 0,
                    descripcion: movementForm.descripcion,
                    usuario_id: Number(movementForm.usuario_id) || null
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
            const response = await fetch('http://localhost:3000/api/caja/cierre', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    sesion_id: activeCashSession.id,
                    usuario_cierre_id: Number(closeSessionForm.usuario_cierre_id) || null,
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
                usuario_cierre_id: activeUserId,
                observaciones: ''
            });
            await fetchCashAuditData();
        } catch (error) {
            setCashAuditError(error.message || 'No se pudo cerrar caja');
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
                    new Date(row.fecha_emision).toLocaleString()
                ]),
                styles: { fontSize: 8 }
            });
        }

        doc.save(`reporte_ventas_${salesReport.periodo.desde}_${salesReport.periodo.hasta}.pdf`);
    };

    const processPayment = async (pedido, tipo) => {
        try {
            // 1. Obtener el pedido exacto con detalles para el PDF
            const detailsRes = await fetch(`http://localhost:3000/api/pedidos/${pedido.id}/detalle`);
            if (!detailsRes.ok) {
                alert("No se pudieron obtener los detalles del pedido.");
                return;
            }
            const orderWithDetails = await detailsRes.json();

            // 2. Procesar el pago y obtener correlativo
            const response = await fetch('http://localhost:3000/api/facturas', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    pedido_id: pedido.id,
                    tipo_comprobante: tipo,
                    cliente_id: pedido.cliente_id
                })
            });

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                throw new Error(errorData.error || 'No se pudo generar el comprobante.');
            }

            const invoiceData = await response.json();

            // 3. Generar PDF Oficial
            generateInvoicePDF(orderWithDetails, invoiceData, tipo);

            alert(`Comprobante ${invoiceData.numero} generado exitosamente.`);
            setPedidos(pedidos.filter(p => p.id !== pedido.id));
            fetchTotalHoy();
            if (showCashAudit) {
                fetchCashAuditData();
            }
        } catch (error) {
            console.error('Error processing billing:', error);
            alert("Error al procesar la facturación.");
        }
    };

    const normalizeOrderDetails = (order) => {
        const detalles = Array.isArray(order?.detalles) ? order.detalles : [];
        return detalles.map((item, index) => {
            const safeName = String(item?.producto_nombre ?? item?.nombre ?? `Producto ${index + 1}`);
            const cantidad = Number(item?.cantidad) || 0;
            const precio = Number(item?.precio ?? item?.precio_unitario) || 0;
            return {
                nombre: safeName,
                cantidad,
                total: cantidad * precio
            };
        });
    };

    const generateInvoicePDF = (order, invoice, tipo) => {
        const doc = new jsPDF({
            unit: 'mm',
            format: [80, 200] // Formato ticketera largo
        });

        const margin = 5;
        const width = 80;

        // Cabecera Restaurante
        doc.setFont("helvetica", "bold");
        doc.setFontSize(12);
        doc.text("GOURMET OS RESTAURANTE", 40, 10, { align: "center" });
        doc.setFontSize(8);
        doc.text("R.U.C. 20123456789", 40, 15, { align: "center" });
        doc.setFont("helvetica", "normal");
        doc.text("Av. Gastronomía 123 - Lima", 40, 19, { align: "center" });
        doc.text("Telf: (01) 456-7890", 40, 23, { align: "center" });
        
        doc.text("------------------------------------------", 40, 27, { align: "center" });

        // Datos del Comprobante
        doc.setFont("helvetica", "bold");
        doc.setFontSize(9);
        const label = tipo === 'factura' ? 'FACTURA ELECTRÓNICA' : 'BOLETA DE VENTA ELECTRÓNICA';
        doc.text(label, 40, 32, { align: "center" });
        doc.text(invoice.numero, 40, 37, { align: "center" });
        
        doc.setFont("helvetica", "normal");
        doc.setFontSize(7);
        doc.text(`Fecha: ${new Date().toLocaleDateString()} ${new Date().toLocaleTimeString()}`, margin, 43);
        doc.text(`Mesa: ${order.mesa_numero || order.mesa_id}`, margin, 47);
        doc.text(`Cliente: ${order.cliente_nombre || 'PÚBLICO EN GENERAL'}`, margin, 51);
        doc.text("------------------------------------------", 40, 55, { align: "center" });

        // Detalle de productos
        const normalizedDetails = normalizeOrderDetails(order);
        const tableBody = normalizedDetails.map(item => [
            `${item.cantidad} ${item.nombre.slice(0, 18)}`,
            `S/ ${item.total.toFixed(2)}`
        ]);

        autoTable(doc, {
            startY: 57,
            body: tableBody,
            theme: 'plain',
            styles: { fontSize: 7, cellPadding: 0.5 },
            columnStyles: {
                0: { cellWidth: 50 },
                1: { cellWidth: 20, halign: 'right' }
            },
            margin: { left: margin }
        });

        const finalY = doc.lastAutoTable.finalY + 5;
        
        // Totales
        const total = Number(invoice.total);
        const subtotal = total / 1.18;
        const igv = total - subtotal;

        doc.setFontSize(7);
        doc.text(`OP. GRAVADA:`, 45, finalY, { align: "right" });
        doc.text(`S/ ${subtotal.toFixed(2)}`, 75, finalY, { align: "right" });
        
        doc.text(`I.G.V. (18%):`, 45, finalY + 4, { align: "right" });
        doc.text(`S/ ${igv.toFixed(2)}`, 75, finalY + 4, { align: "right" });
        
        doc.setFontSize(9);
        doc.setFont("helvetica", "bold");
        doc.text(`TOTAL A PAGAR:`, 45, finalY + 10, { align: "right" });
        doc.text(`S/ ${total.toFixed(2)}`, 75, finalY + 10, { align: "right" });

        // Pie de página
        doc.setFont("helvetica", "normal");
        doc.setFontSize(7);
        doc.text("------------------------------------------", 40, finalY + 16, { align: "center" });
        doc.text("Representación impresa de la", 40, finalY + 20, { align: "center" });
        doc.text("Boleta de Venta Electrónica", 40, finalY + 23, { align: "center" });
        doc.text("Gracias por su preferencia", 40, finalY + 28, { align: "center" });

        doc.save(`${tipo}_${invoice.numero}.pdf`);
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
                                <th className="px-6 py-4 text-center text-xs font-black uppercase tracking-[0.2em] text-[var(--text-muted)] border-b border-gray-100">Emitir Comprobante</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-50">
                            {loading ? (
                                <tr>
                                    <td colSpan="5" className="px-6 py-20 text-center">
                                        <div className="flex flex-col items-center">
                                            <div className="w-10 h-10 border-4 border-brand-100 border-t-brand-600 rounded-full animate-spin mb-4"></div>
                                            <p className="font-bold text-gray-500 font-display">Sincronizando caja...</p>
                                        </div>
                                    </td>
                                </tr>
                            ) : pedidos.length === 0 ? (
                                <tr>
                                    <td colSpan="5" className="px-6 py-20 text-center">
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
                                                    <p className="font-black text-gray-900 leading-none">Venta Directa</p>
                                                    <p className="text-[10px] font-bold text-brand-600 mt-1 uppercase tracking-widest leading-none">Pedido de Comedor</p>
                                                </div>
                                            </div>
                                        </td>
                                        <td className="px-6 py-5 text-center">
                                            <span className="px-3 py-1.5 bg-gray-100 text-gray-700 rounded-xl text-xs font-black uppercase tracking-widest border border-gray-200">
                                                Mesa {pedido.mesa_id}
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
                                                    {new Date(pedido.fecha_creacion).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                                </div>
                                                <p className="text-[10px] font-bold uppercase text-gray-400">Hace 12 min</p>
                                            </div>
                                        </td>
                                        <td className="px-6 py-5">
                                            <div className="flex items-center justify-center gap-3">
                                                <button
                                                    onClick={() => processPayment(pedido, 'boleta')}
                                                    className="px-4 py-2.5 bg-white border border-brand-200 text-brand-600 rounded-xl text-xs font-bold hover:bg-brand-600 hover:text-white hover:shadow-lg hover:shadow-brand-100 transition-all flex items-center gap-2 group/btn"
                                                >
                                                    <FileText size={14} className="group-hover/btn:rotate-12 transition-transform" /> Boleta
                                                </button>
                                                <button
                                                    onClick={() => processPayment(pedido, 'factura')}
                                                    className="px-4 py-2.5 bg-brand-600 text-white rounded-xl text-xs font-bold hover:bg-brand-700 hover:shadow-lg hover:shadow-brand-200 transition-all flex items-center gap-2"
                                                >
                                                    <Landmark size={14} /> Factura
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
                                                    <label className="block text-xs font-bold uppercase tracking-wider text-gray-500 mb-2">Usuario Apertura (ID)</label>
                                                    <input
                                                        type="number"
                                                        min="1"
                                                        className="w-full px-3 py-2.5 rounded-xl border border-gray-200 font-medium text-sm"
                                                        value={openSessionForm.usuario_id}
                                                        onChange={(e) => setOpenSessionForm((prev) => ({ ...prev, usuario_id: e.target.value }))}
                                                    />
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
                                            <span className="text-xs font-bold text-gray-500">
                                                Caja: {activeCashSession.caja_descripcion || activeCashSession.caja_id}
                                            </span>
                                        </div>

                                        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
                                            <SummaryCard title="Monto Inicial" value={formatCurrency(activeCashSession.resumen?.monto_inicial)} />
                                            <SummaryCard title="Ingresos Manuales" value={formatCurrency(activeCashSession.resumen?.ingresos_manual)} />
                                            <SummaryCard title="Egresos Manuales" value={formatCurrency(activeCashSession.resumen?.egresos_manual)} />
                                            <SummaryCard title="Ventas Facturadas" value={formatCurrency(activeCashSession.resumen?.ventas_totales)} />
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
                                                    <input
                                                        type="text"
                                                        placeholder="Descripcion"
                                                        className="w-full px-3 py-2.5 rounded-xl border border-gray-200 font-medium text-sm"
                                                        value={movementForm.descripcion}
                                                        onChange={(e) => setMovementForm((prev) => ({ ...prev, descripcion: e.target.value }))}
                                                    />
                                                    <input
                                                        type="number"
                                                        min="1"
                                                        placeholder="Usuario ID"
                                                        className="w-full px-3 py-2.5 rounded-xl border border-gray-200 font-medium text-sm"
                                                        value={movementForm.usuario_id}
                                                        onChange={(e) => setMovementForm((prev) => ({ ...prev, usuario_id: e.target.value }))}
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
                                                        type="number"
                                                        min="1"
                                                        placeholder="Usuario cierre ID"
                                                        className="w-full px-3 py-2.5 rounded-xl border border-gray-200 font-medium text-sm"
                                                        value={closeSessionForm.usuario_cierre_id}
                                                        onChange={(e) => setCloseSessionForm((prev) => ({ ...prev, usuario_cierre_id: e.target.value }))}
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
                                                                <td className="px-4 py-3 text-right">{new Date(item.fecha).toLocaleString()}</td>
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
                                                                <td className="px-4 py-3 text-right">{new Date(item.fecha_emision).toLocaleString()}</td>
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
