/**
 * Representacion impresa de boletas, facturas y notas de venta: ticket termico de 80 mm (HTML)
 * y A4 (PDF). Adaptado del sistema de DistribucionBebidas: cabecera con recuadro del documento,
 * cliente, detalle, importes, "SON:", informacion del credito y bloque de verificacion con QR.
 */
const PDFDocument = require('pdfkit');
const QRCode = require('qrcode');
const numeroALetras = require('./numeroALetras');

const PAGE_W = 595.28;
const PAGE_H = 841.89;
const MARGIN = 18;
const COLORS = { border: [70, 70, 70], lightBorder: [190, 190, 190], grayBg: [248, 248, 248], text: [25, 25, 25], muted: [90, 90, 90] };
const TITULOS = {
    factura: 'FACTURA ELECTRONICA', boleta: 'BOLETA DE VENTA ELECTRONICA', nota_venta: 'NOTA DE VENTA',
    nota_credito: 'NOTA DE CREDITO ELECTRONICA', nota_debito: 'NOTA DE DEBITO ELECTRONICA'
};
const NOMBRES = { factura: 'factura electrónica', boleta: 'boleta de venta electrónica', nota_credito: 'nota de crédito electrónica', nota_debito: 'nota de débito electrónica' };
const REF_LABEL = { factura: 'FACTURA', boleta: 'BOLETA DE VENTA' };
const SUNAT_TIPO = { factura: '01', boleta: '03', nota_credito: '07', nota_debito: '08' };
const SUNAT_DOC = { RUC: '6', DNI: '1', CE: '4', PAS: '7', '-': '0' };

const safeText = (value) => (value === null || value === undefined ? '' : String(value).replace(/\s+/g, ' ').trim());
const escapeHtml = (value) => safeText(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const num = (value) => Number(value || 0);
const money = (value) => `S/ ${num(value).toFixed(2)}`;
const pad = (value) => String(value || 0).padStart(8, '0');
const fechaPE = (ymd) => (/^\d{4}-\d{2}-\d{2}$/.test(String(ymd)) ? String(ymd).split('-').reverse().join('/') : safeText(ymd) || '-');

class FormatoError extends Error {
    constructor(status, message) {
        super(message);
        this.status = status;
    }
}

const empresaDe = (empresa) => {
    if (!empresa?.razon_social) {
        throw new FormatoError(409, 'Configura la razon social de la empresa en Configuracion > Facturacion electronica antes de imprimir');
    }
    return {
        razon_social: safeText(empresa.razon_social),
        nombre_comercial: safeText(empresa.nombre_comercial),
        ruc: safeText(empresa.ruc),
        direccion: safeText(empresa.direccion),
        telefono: safeText(empresa.telefono)
    };
};

const cadenaQr = (data, empresa) => {
    if (!data.electronico) return '';
    if (data.qr) return data.qr;
    return [empresa.ruc, SUNAT_TIPO[data.tipo], data.serie, data.numero, num(data.igv).toFixed(2), num(data.total).toFixed(2),
        data.fecha, SUNAT_DOC[data.cliente_doc_tipo] ?? '0', data.cliente_doc_numero || '-', data.hash || ''].join('|');
};

const nombreArchivo = (data, extension) => {
    const label = { factura: 'Factura', boleta: 'Boleta', nota_venta: 'NotaVenta', nota_credito: 'NotaCredito', nota_debito: 'NotaDebito' }[data.tipo] || 'Comprobante';
    return `${label}_${data.serie}-${pad(data.numero)}.${extension}`;
};

const formaPagoTexto = (data) => (data.ref ? '-' : data.condicion === 'credito' ? 'Crédito' : (data.forma_pago || 'Contado'));

function drawRect(doc, x, y, w, h, fill, stroke = COLORS.border) {
    if (fill) { doc.save(); doc.rect(x, y, w, h).fill(fill); doc.restore(); }
    doc.save(); doc.lineWidth(0.7); doc.strokeColor(...stroke); doc.rect(x, y, w, h).stroke(); doc.restore();
}

function ensureSpace(doc, y, needed) {
    if (y + needed <= PAGE_H - 28) return y;
    doc.addPage({ size: 'A4', margin: MARGIN });
    return MARGIN + 12;
}

async function pdfA4(data, empresaSource) {
    const company = empresaDe(empresaSource);
    const doc = new PDFDocument({ size: 'A4', margin: MARGIN, bufferPages: true, info: { Title: nombreArchivo(data, 'pdf') } });
    const chunks = [];
    doc.on('data', (chunk) => chunks.push(chunk));
    const done = new Promise((resolve, reject) => { doc.on('end', () => resolve(Buffer.concat(chunks))); doc.on('error', reject); });

    const titulo = TITULOS[data.tipo] || 'COMPROBANTE';
    const credito = data.condicion === 'credito';
    const qrData = cadenaQr(data, company);
    const qrImage = qrData ? await QRCode.toDataURL(qrData, { width: 180, margin: 1 }) : null;
    let y = MARGIN;

    // Cabecera: emisor a la izquierda, recuadro del documento a la derecha.
    drawRect(doc, MARGIN, y, PAGE_W - MARGIN * 2, 62, null);
    doc.save();
    doc.font('Helvetica-Bold').fontSize(10).fillColor(...COLORS.text).text(company.nombre_comercial || company.razon_social, MARGIN + 6, y + 6, { width: 330 });
    doc.font('Helvetica').fontSize(8.1);
    if (company.nombre_comercial) doc.text(company.razon_social, MARGIN + 6, y + 19, { width: 330 });
    doc.text(company.direccion, MARGIN + 6, y + (company.nombre_comercial ? 30 : 19), { width: 330 });
    if (company.telefono) doc.text(`Telf: ${company.telefono}`, MARGIN + 6, y + 48, { width: 330 });
    doc.restore();
    drawRect(doc, PAGE_W - MARGIN - 190, y + 3, 186, 56, null);
    doc.save();
    doc.font('Helvetica-Bold').fontSize(titulo.length > 20 ? 9.5 : 13).fillColor(...COLORS.text).text(titulo, PAGE_W - MARGIN - 190, y + 9, { width: 186, align: 'center' });
    if (company.ruc) doc.fontSize(9).text(`RUC: ${company.ruc}`, PAGE_W - MARGIN - 190, y + 25, { width: 186, align: 'center' });
    doc.font('Helvetica-Bold').fontSize(11).text(`${data.serie}-${pad(data.numero)}`, PAGE_W - MARGIN - 190, y + 40, { width: 186, align: 'center' });
    doc.restore();
    y += 70;

    if (data.pruebas) {
        doc.save();
        doc.font('Helvetica-Bold').fontSize(10).fillColor(180, 40, 40).text('AMBIENTE DE PRUEBAS - SIN VALOR TRIBUTARIO', MARGIN, y, { width: PAGE_W - MARGIN * 2, align: 'center' });
        doc.restore();
        y += 16;
    }

    // Datos del cliente.
    const direccion = safeText(data.cliente_direccion) || '-';
    doc.font('Helvetica').fontSize(7.6);
    const direccionHeight = doc.heightOfString(direccion, { width: 125 });
    const filaDoc = 18 + Math.max(11, direccionHeight + 3);
    const alto = Math.max(46, filaDoc + 17);
    drawRect(doc, MARGIN, y, PAGE_W - MARGIN * 2, alto, null);
    doc.save();
    doc.font('Helvetica').fontSize(8.2).fillColor(...COLORS.text);
    doc.text('Fecha de Emisión', MARGIN + 6, y + 7); doc.text(':', MARGIN + 78, y + 7); doc.text(`${fechaPE(data.fecha)} ${data.hora || ''}`, MARGIN + 84, y + 7);
    doc.text('Forma de pago', PAGE_W - 180, y + 7, { width: 70, align: 'right' }); doc.text(':', PAGE_W - 106, y + 7);
    doc.font('Helvetica-Bold').text(formaPagoTexto(data), PAGE_W - 96, y + 7, { width: 76 });
    doc.font('Helvetica').text('Señor(es)', MARGIN + 6, y + 18); doc.text(':', MARGIN + 78, y + 18);
    doc.font('Helvetica-Bold').text(safeText(data.cliente_nombre) || 'CLIENTES VARIOS', MARGIN + 84, y + 18, { width: 300 });
    doc.font('Helvetica').text(data.cliente_doc_tipo && data.cliente_doc_tipo !== '-' ? data.cliente_doc_tipo : 'Documento', MARGIN + 6, y + filaDoc);
    doc.text(':', MARGIN + 78, y + filaDoc); doc.text(data.cliente_doc_numero || '-', MARGIN + 84, y + filaDoc);
    doc.fontSize(7.6).text('Dirección del Cliente', PAGE_W - 230, y + 18); doc.text(':', PAGE_W - 154, y + 18); doc.text(direccion, PAGE_W - 148, y + 18, { width: 125 });
    doc.fontSize(8.2).text('Tipo de Moneda', PAGE_W - 230, y + filaDoc); doc.text(':', PAGE_W - 154, y + filaDoc); doc.text('SOLES', PAGE_W - 148, y + filaDoc);
    doc.restore();
    y += alto + 6;

    if (data.ref) {
        drawRect(doc, MARGIN, y, PAGE_W - MARGIN * 2, 34, COLORS.grayBg);
        doc.save();
        doc.font('Helvetica-Bold').fontSize(8.5).fillColor(...COLORS.text).text('DOCUMENTO QUE SE MODIFICA', MARGIN + 6, y + 6);
        doc.font('Helvetica').fontSize(8.2).text(`${REF_LABEL[data.ref.tipo] || data.ref.tipo}:`, MARGIN + 6, y + 18);
        doc.font('Helvetica-Bold').text(`${data.ref.serie}-${pad(data.ref.numero)}`, MARGIN + 108, y + 18);
        if (data.motivo) {
            doc.font('Helvetica').text('Motivo:', PAGE_W - MARGIN - 290, y + 18);
            doc.font('Helvetica-Bold').text(safeText(data.motivo), PAGE_W - MARGIN - 250, y + 18, { width: 245, height: 12, ellipsis: true });
        }
        doc.restore();
        y += 40;
    }
    if (data.mesa) {
        doc.save(); doc.font('Helvetica').fontSize(8).fillColor(...COLORS.muted).text(`Mesa ${data.mesa} · Pedido #${data.pedido_id}`, MARGIN + 2, y); doc.restore();
        y += 12;
    }

    // Detalle.
    const col = { qty: 58, unit: 70, desc: 255, value: 95, total: 81 };
    const tableW = col.qty + col.unit + col.desc + col.value + col.total;
    const precioColumna = data.electronico ? 'Valor Unitario' : 'Precio Unitario';
    drawRect(doc, MARGIN, y, tableW, 14, null);
    doc.save();
    doc.font('Helvetica-Bold').fontSize(8).fillColor(...COLORS.text);
    let x = MARGIN;
    for (const [label, width] of [['Cantidad', col.qty], ['Unidad Medida', col.unit], ['Descripción', col.desc], [precioColumna, col.value], ['Importe', col.total]]) {
        doc.text(label, x + 2, y + 4, { width: width - 4, align: 'center' }); x += width;
    }
    doc.restore();
    y += 14;
    doc.save();
    doc.font('Helvetica').fontSize(8).fillColor(...COLORS.text);
    for (const item of data.items) {
        const descripcion = safeText(item.descripcion) || 'ITEM';
        const h = Math.max(16, doc.heightOfString(descripcion, { width: col.desc - 8 }) + 8);
        y = ensureSpace(doc, y, h + 1);
        drawRect(doc, MARGIN, y, tableW, h, null, COLORS.lightBorder);
        x = MARGIN;
        doc.text(num(item.cantidad).toFixed(2), x + 4, y + 4, { width: col.qty - 8, align: 'right' }); x += col.qty;
        doc.text('UNIDAD', x + 4, y + 4, { width: col.unit - 8, align: 'center' }); x += col.unit;
        doc.text(descripcion, x + 4, y + 4, { width: col.desc - 8 }); x += col.desc;
        doc.text(num(data.electronico ? item.valor_unitario : item.precio_unitario).toFixed(2), x + 4, y + 4, { width: col.value - 8, align: 'right' }); x += col.value;
        doc.text(num(item.total).toFixed(2), x + 4, y + 4, { width: col.total - 8, align: 'right' });
        y += h;
    }
    doc.restore();
    y += 8;

    // Resumen de importes.
    y = ensureSpace(doc, y, 150);
    const leftW = 268;
    const rightW = PAGE_W - MARGIN * 2 - leftW - 6;
    const rightX = MARGIN + leftW + 6;
    const rows = data.electronico
        ? [['Op. Gravada', money(data.gravada)], ['Op. Exonerada', money(0)], ['Op. Inafecta', money(0)], ['Descuentos', money(0)],
            [`IGV (${num(data.igv_porcentaje)}%)`, money(data.igv)], ['ICBPER', money(0)], ['Importe Total', money(data.total)]]
        : [['Sub Total', money(data.gravada)], [`IGV (${num(data.igv_porcentaje)}%)`, money(data.igv)], ['Importe Total', money(data.total)]];
    const rightH = rows.length * 12 + 14;
    drawRect(doc, MARGIN, y, leftW, Math.max(72, rightH), null);
    drawRect(doc, rightX, y, rightW, rightH, null);
    doc.save();
    doc.font('Helvetica-Bold').fontSize(8.7).fillColor(...COLORS.text).text(`SON: ${numeroALetras(num(data.total)).toUpperCase()}`, MARGIN + 6, y + 14, { width: leftW - 12 });
    doc.restore();
    doc.save();
    doc.font('Helvetica').fontSize(8.1).fillColor(...COLORS.text);
    let ry = y + 8;
    rows.forEach(([label, value], index) => {
        if (index === rows.length - 1) doc.font('Helvetica-Bold');
        doc.text(label, rightX + 10, ry, { width: rightW - 90 }); doc.text(':', rightX + rightW - 78, ry);
        drawRect(doc, rightX + rightW - 72, ry - 2, 66, 12, null, COLORS.lightBorder);
        doc.text(value, rightX + rightW - 70, ry + 1, { width: 60, align: 'right' });
        ry += 12;
    });
    doc.restore();
    y += Math.max(72, rightH) + 8;

    if (credito && data.cuotas.length) {
        const h = 52 + data.cuotas.length * 14;
        y = ensureSpace(doc, y, h + 8);
        drawRect(doc, MARGIN, y, PAGE_W - MARGIN * 2, h, null);
        doc.save();
        doc.font('Helvetica-Bold').fontSize(8.3).fillColor(...COLORS.text).text('Información del crédito', MARGIN + 8, y + 6);
        doc.font('Helvetica').fontSize(8);
        const totalCuotas = data.cuotas.reduce((sum, c) => sum + num(c.monto), 0);
        doc.text('Monto neto pendiente de pago', MARGIN + 8, y + 18); doc.text(':', MARGIN + 155, y + 18); doc.text(money(totalCuotas), MARGIN + 166, y + 18);
        doc.text('Total de Cuotas', MARGIN + 8, y + 28); doc.text(':', MARGIN + 155, y + 28); doc.text(String(data.cuotas.length), MARGIN + 166, y + 28);
        doc.font('Helvetica-Bold');
        ['N° Cuota', 'Fec. Venc.', 'Monto'].forEach((label, i) => doc.text(label, MARGIN + 8 + i * 120, y + 42));
        doc.font('Helvetica');
        data.cuotas.forEach((c, i) => {
            const rowY = y + 54 + i * 14;
            doc.text(String(c.numero || i + 1), MARGIN + 8, rowY); doc.text(fechaPE(c.fecha), MARGIN + 128, rowY); doc.text(money(c.monto), MARGIN + 248, rowY);
        });
        doc.restore();
        y += h + 8;
    }

    if (data.observacion) {
        doc.font('Helvetica').fontSize(8);
        const h = doc.heightOfString(safeText(data.observacion), { width: PAGE_W - MARGIN * 2 - 90 }) + 12;
        y = ensureSpace(doc, y, h + 6);
        drawRect(doc, MARGIN, y, PAGE_W - MARGIN * 2, h, null);
        doc.save(); doc.font('Helvetica').fontSize(8).fillColor(...COLORS.text).text('Observación :', MARGIN + 6, y + 6);
        doc.text(safeText(data.observacion), MARGIN + 78, y + 6, { width: PAGE_W - MARGIN * 2 - 90 }); doc.restore();
        y += h + 6;
    }

    if (data.electronico) {
        y = ensureSpace(doc, y, 140);
        drawRect(doc, MARGIN, y, PAGE_W - MARGIN * 2, 112, null);
        if (qrImage) doc.image(qrImage, MARGIN + 8, y + 10, { width: 92, height: 92 });
        drawRect(doc, MARGIN + 108, y + 8, PAGE_W - MARGIN * 2 - 116, 96, null, COLORS.lightBorder);
        doc.save();
        doc.font('Helvetica-Bold').fontSize(8.3).fillColor(...COLORS.text).text('Datos del QR y verificación', MARGIN + 116, y + 13);
        const columnas = [
            [['RUC', company.ruc], ['Tipo', titulo.replace(' ELECTRONICA', '')], ['Serie', data.serie], ['Número', pad(data.numero)]],
            [['Fecha', fechaPE(data.fecha)], ['IGV', money(data.igv)], ['Total', money(data.total)]],
            [['F. Pago', data.ref ? '-' : credito ? 'Crédito' : 'Contado'], ['Estado', safeText(data.estado_sunat).toUpperCase()]]
        ];
        columnas.forEach((filas, c) => filas.forEach(([label, value], i) => {
            const cx = MARGIN + 116 + c * 140;
            const cy = y + 28 + i * 12;
            doc.font('Helvetica-Bold').fontSize(7.4).text(`${label}:`, cx, cy, { width: 46 });
            doc.font('Helvetica').text(safeText(value), cx + 46, cy, { width: 92 });
        }));
        doc.moveTo(MARGIN + 109, y + 80).lineTo(PAGE_W - MARGIN - 9, y + 80).strokeColor(...COLORS.lightBorder).lineWidth(0.4).stroke();
        doc.font('Helvetica-Bold').fontSize(7.4).text('Resumen:', MARGIN + 116, y + 85, { width: 46 });
        doc.font('Helvetica').fontSize(6.8).text(safeText(data.hash) || 'Pendiente de respuesta del proveedor', MARGIN + 162, y + 85, { width: PAGE_W - MARGIN * 2 - 175 });
        doc.restore();
        y += 118;
        drawRect(doc, MARGIN, y, PAGE_W - MARGIN * 2, 22, null);
        doc.save();
        doc.font('Helvetica-Oblique').fontSize(8).fillColor(...COLORS.text).text(`Esta es una representación impresa de la ${NOMBRES[data.tipo]}, generada en el Sistema de SUNAT. Puede verificarla utilizando su clave SOL.`, MARGIN + 8, y + 6, { width: PAGE_W - MARGIN * 2 - 16, align: 'center' });
        doc.restore();
    } else {
        y = ensureSpace(doc, y, 24);
        drawRect(doc, MARGIN, y, PAGE_W - MARGIN * 2, 20, null);
        doc.save(); doc.font('Helvetica-Oblique').fontSize(8.6).fillColor(...COLORS.text).text('Documento interno. No es un comprobante de pago electrónico SUNAT.', MARGIN + 8, y + 6, { width: PAGE_W - MARGIN * 2 - 16, align: 'center' }); doc.restore();
    }

    doc.end();
    return { buffer: await done, filename: nombreArchivo(data, 'pdf') };
}

async function ticketHtml(data, empresaSource) {
    const co = empresaDe(empresaSource);
    const titulo = { boleta: 'BOLETA DE VENTA ELECT.', nota_credito: 'NOTA DE CREDITO ELECT.', nota_debito: 'NOTA DE DEBITO ELECT.' }[data.tipo] || TITULOS[data.tipo] || 'COMPROBANTE';
    const qr = cadenaQr(data, co);
    const qrImg = qr ? await QRCode.toDataURL(qr, { width: 120, margin: 1, errorCorrectionLevel: 'M' }) : '';
    const rows = data.items.map((item) => `<tr><td class="qty">${num(item.cantidad)}</td><td class="desc">${escapeHtml(item.descripcion)}</td><td class="amount">${num(item.total).toFixed(2)}</td></tr>`).join('');
    const pie = data.electronico ? `
 <div class="sep"></div>
 <div class="center tiny">Representación impresa de la ${escapeHtml(TITULOS[data.tipo])}<br>Consulte en www.sunat.gob.pe</div>
 ${data.hash ? `<div class="hash"><strong>Resumen:</strong><br>${escapeHtml(data.hash)}</div>` : ''}
 ${qrImg ? `<div class="center qr"><img src="${qrImg}" alt="QR SUNAT"></div>` : ''}`
        : '<div class="sep"></div><div class="center tiny">Documento interno. No es comprobante electrónico SUNAT.</div>';
    const credito = data.condicion === 'credito'
        ? `<div class="row"><span>Vence:</span><span>${escapeHtml(fechaPE(data.cuotas[0]?.fecha))}</span></div>` : '';
    const vuelto = data.recibido && data.recibido > data.total
        ? `<div class="row"><span>Recibido:</span><span>${money(data.recibido)}</span></div><div class="row"><span>Vuelto:</span><span>${money(data.recibido - data.total)}</span></div>` : '';

    return {
        filename: nombreArchivo(data, 'html'),
        html: `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><title>${escapeHtml(nombreArchivo(data, 'pdf').replace('.pdf', '_Termico'))}</title>
<style>
 *{box-sizing:border-box} html,body{margin:0;padding:0;background:#fff;color:#000}
 body{width:80mm;padding:4mm 4mm 8mm;font-family:"Courier New",Courier,monospace;font-size:11px;font-weight:700}
 body,body *{font-weight:700!important} .center{text-align:center} .small{font-size:9px} .tiny{font-size:7px}
 .sep{border-top:1px dashed #000;margin:5px 0} .title{font-size:12px} .doc-number{font-size:13px;letter-spacing:1px}
 .row{display:flex;justify-content:space-between;gap:8px;margin:2px 0} table{width:100%;border-collapse:collapse;margin-top:3px}
 th{font-size:8px;border-bottom:1px dashed #000;padding-bottom:3px;text-align:left} td{padding:3px 0;vertical-align:top}
 .qty{width:28px} .desc{padding-right:4px} .amount{width:58px;text-align:right;white-space:nowrap}
 .hash{font-size:6px;word-break:break-all;margin:4px 0} .qr img{width:30mm;height:30mm;margin-top:4px}
 .cut-feed{height:18mm} .row,table,tr,.hash,.qr{break-inside:avoid;page-break-inside:avoid}
 @media print{html,body{width:80mm;height:auto;overflow:visible} @page{size:auto;margin:0}}
</style></head><body>
 <div class="center"><div class="title">${escapeHtml(co.nombre_comercial || co.razon_social)}</div>${co.nombre_comercial ? `<div class="small">${escapeHtml(co.razon_social)}</div>` : ''}${co.ruc ? `<div class="small">RUC: ${escapeHtml(co.ruc)}</div>` : ''}<div class="small">${escapeHtml(co.direccion)}</div>${co.telefono ? `<div class="small">Telf: ${escapeHtml(co.telefono)}</div>` : ''}</div>
 <div class="sep"></div>
 <div class="center"><div>${escapeHtml(titulo)}</div><div class="doc-number">${escapeHtml(data.serie)}-${pad(data.numero)}</div>${data.pruebas ? '<div class="small">*** PRUEBAS - SIN VALOR ***</div>' : ''}</div>
 ${data.ref ? `<div class="sep"></div><div class="center small"><div>${escapeHtml(REF_LABEL[data.ref.tipo] || data.ref.tipo)} QUE MODIFICA</div><div>${escapeHtml(data.ref.serie)}-${pad(data.ref.numero)}</div>${data.motivo ? `<div>Motivo: ${escapeHtml(data.motivo)}</div>` : ''}</div>` : ''}
 <div class="sep"></div>
 <div class="row"><span>Fecha:</span><span>${escapeHtml(fechaPE(data.fecha))} ${escapeHtml(data.hora || '')}</span></div>
 ${data.mesa ? `<div class="row"><span>Mesa:</span><span>${escapeHtml(data.mesa)}</span></div>` : ''}
 <div>Cliente: ${escapeHtml(data.cliente_nombre || 'CLIENTES VARIOS')}</div>
 ${data.cliente_doc_numero ? `<div>${escapeHtml(data.cliente_doc_tipo || 'DOC')}: ${escapeHtml(data.cliente_doc_numero)}</div>` : ''}
 ${data.cliente_direccion ? `<div class="small">Dir: ${escapeHtml(data.cliente_direccion)}</div>` : ''}
 <div>F. Pago: ${escapeHtml(formaPagoTexto(data))}</div>
 ${credito}
 <div class="sep"></div>
 <table><thead><tr><th>CANT</th><th>DESCRIPCION</th><th class="amount">IMPORTE</th></tr></thead><tbody>${rows}</tbody></table>
 <div class="sep"></div>
 <div class="row"><span>${data.electronico ? 'OP. GRAVADA:' : 'SUB TOTAL:'}</span><span>${money(data.gravada)}</span></div>
 <div class="row"><span>IGV (${num(data.igv_porcentaje)}%):</span><span>${money(data.igv)}</span></div>
 <div class="row"><span>TOTAL:</span><span>${money(data.total)}</span></div>
 ${vuelto}
 <div class="small">SON: ${escapeHtml(numeroALetras(num(data.total)))}</div>
 ${pie}
 <div class="sep"></div><div class="center small">GRACIAS POR SU PREFERENCIA</div><div class="cut-feed">&nbsp;</div>
</body></html>`
    };
}

/** Pre-cuenta (account preview) for the table: same 80 mm look, clearly not a payment receipt. */
function preCuentaHtml({ mesa, items, total, fecha, hora, mozo }, empresaSource) {
    const co = empresaDe(empresaSource);
    const rows = items.map((item) => `<tr><td class="qty">${num(item.cantidad)}</td><td class="desc">${escapeHtml(item.descripcion)}</td><td class="amount">${(num(item.cantidad) * num(item.precio)).toFixed(2)}</td></tr>`).join('');
    return `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><title>PreCuenta_Mesa_${escapeHtml(mesa)}</title>
<style>
 *{box-sizing:border-box} html,body{margin:0;padding:0;background:#fff;color:#000}
 body{width:80mm;padding:4mm 4mm 8mm;font-family:"Courier New",Courier,monospace;font-size:11px;font-weight:700}
 .center{text-align:center} .small{font-size:9px} .sep{border-top:1px dashed #000;margin:5px 0} .title{font-size:12px}
 .row{display:flex;justify-content:space-between;gap:8px;margin:2px 0} table{width:100%;border-collapse:collapse;margin-top:3px}
 th{font-size:8px;border-bottom:1px dashed #000;padding-bottom:3px;text-align:left} td{padding:3px 0;vertical-align:top}
 .qty{width:28px} .desc{padding-right:4px} .amount{width:58px;text-align:right;white-space:nowrap} .total{font-size:13px}
 .cut-feed{height:18mm} @media print{html,body{width:80mm;height:auto} @page{size:auto;margin:0}}
</style></head><body>
 <div class="center"><div class="title">${escapeHtml(co.nombre_comercial || co.razon_social)}</div><div class="small">${escapeHtml(co.direccion)}</div></div>
 <div class="sep"></div>
 <div class="center title">PRE-CUENTA · MESA ${escapeHtml(mesa)}</div>
 <div class="row"><span>Fecha:</span><span>${escapeHtml(fechaPE(fecha))} ${escapeHtml(hora)}</span></div>
 ${mozo ? `<div class="row"><span>Atendido por:</span><span>${escapeHtml(mozo)}</span></div>` : ''}
 <div class="sep"></div>
 <table><thead><tr><th>CANT</th><th>DESCRIPCION</th><th class="amount">IMPORTE</th></tr></thead><tbody>${rows}</tbody></table>
 <div class="sep"></div>
 <div class="row total"><span>TOTAL A PAGAR:</span><span>${money(total)}</span></div>
 <div class="sep"></div>
 <div class="center small">ESTE DOCUMENTO NO ES UN COMPROBANTE DE PAGO</div>
 <div class="center small">Solicite su boleta o factura al pagar</div>
 <div class="center small">GRACIAS POR SU VISITA</div><div class="cut-feed">&nbsp;</div>
</body></html>`;
}

/** A4 print of a guide: electronic sender guide (with QR) or internal guide (control document, with signature). */
async function guiaPdf(guia, empresaSource) {
    const company = empresaDe(empresaSource);
    const doc = new PDFDocument({ size: 'A4', margin: MARGIN, bufferPages: true, info: { Title: `Guia_${guia.numero_guia}` } });
    const chunks = [];
    doc.on('data', (chunk) => chunks.push(chunk));
    const done = new Promise((resolve, reject) => { doc.on('end', () => resolve(Buffer.concat(chunks))); doc.on('error', reject); });
    const remitente = guia.tipo === 'remitente';
    const titulo = remitente ? 'GUIA DE REMISION ELECTRONICA REMITENTE' : 'GUIA INTERNA DE TRASLADO';
    const qrImage = remitente && guia.cadena_qr ? await QRCode.toDataURL(guia.cadena_qr, { width: 180, margin: 1 }) : null;
    const W = PAGE_W - MARGIN * 2;
    let y = MARGIN;

    drawRect(doc, MARGIN, y, W, 62, null);
    doc.save();
    doc.font('Helvetica-Bold').fontSize(10).fillColor(...COLORS.text).text(company.nombre_comercial || company.razon_social, MARGIN + 6, y + 6, { width: 320 });
    doc.font('Helvetica').fontSize(8.1);
    if (company.nombre_comercial) doc.text(company.razon_social, MARGIN + 6, y + 19, { width: 320 });
    doc.text(company.direccion, MARGIN + 6, y + (company.nombre_comercial ? 30 : 19), { width: 320 });
    doc.restore();
    drawRect(doc, PAGE_W - MARGIN - 200, y + 3, 196, 56, null);
    doc.save();
    doc.font('Helvetica-Bold').fontSize(8).fillColor(...COLORS.text).text(titulo, PAGE_W - MARGIN - 200, y + 10, { width: 196, align: 'center' });
    if (company.ruc) doc.fontSize(9).text(`RUC: ${company.ruc}`, PAGE_W - MARGIN - 200, y + 29, { width: 196, align: 'center' });
    doc.fontSize(11).text(guia.numero_guia, PAGE_W - MARGIN - 200, y + 42, { width: 196, align: 'center' });
    doc.restore();
    y += 70;

    if (remitente && guia.ambiente === 'PRUEBAS') {
        doc.save(); doc.font('Helvetica-Bold').fontSize(10).fillColor(180, 40, 40).text('AMBIENTE DE PRUEBAS - SIN VALOR TRIBUTARIO', MARGIN, y, { width: W, align: 'center' }); doc.restore();
        y += 16;
    }
    if (guia.estado === 'anulada') {
        doc.save(); doc.font('Helvetica-Bold').fontSize(12).fillColor(180, 40, 40).text(`DOCUMENTO ANULADO: ${safeText(guia.motivo_anulacion)}`, MARGIN, y, { width: W, align: 'center' }); doc.restore();
        y += 18;
    }

    const fila = (pares, top) => {
        pares.forEach(([label, value], i) => {
            const x = MARGIN + 6 + i * (W / 2);
            doc.font('Helvetica-Bold').fontSize(8).text(`${label}:`, x, top, { width: 110 });
            doc.font('Helvetica').text(safeText(value) || '-', x + 112, top, { width: W / 2 - 124, height: 11, ellipsis: true });
        });
    };
    const bloque = (titulo2, filas) => {
        const alto = 18 + filas.length * 13;
        y = ensureSpace(doc, y, alto + 6);
        drawRect(doc, MARGIN, y, W, alto, null);
        doc.save();
        doc.font('Helvetica-Bold').fontSize(8.5).fillColor(...COLORS.text).text(titulo2, MARGIN + 6, y + 5);
        filas.forEach((pares, i) => fila(pares, y + 18 + i * 13));
        doc.restore();
        y += alto + 6;
    };

    const referencia = guia.transferencia_codigo ? `Transferencia ${guia.transferencia_codigo}` : guia.factura_numero ? `${guia.factura_tipo === 'factura' ? 'Factura' : 'Boleta'} ${guia.factura_numero}` : 'Guía libre';
    bloque('DATOS DEL TRASLADO', [
        [['Fecha de emisión', fechaPE(guia.fecha_emision)], ['Inicio del traslado', fechaPE(guia.fecha_traslado)]],
        [['Motivo', remitente ? `${guia.motivo_traslado} - ${guia.motivo_nombre || ''}` : 'Traslado interno'], ['Documento relacionado', referencia]],
        [['Destinatario', guia.destinatario_nombre], ['Documento', guia.destinatario_num_doc ? `${guia.destinatario_tipo_doc} ${guia.destinatario_num_doc}` : '-']]
    ]);
    bloque('PUNTOS DE PARTIDA Y LLEGADA', [
        [['Partida', guia.partida_direccion], ['Ubigeo / establecimiento', remitente ? `${guia.partida_ubigeo || '-'} / ${guia.partida_establecimiento || '-'}` : '-']],
        [['Llegada', guia.llegada_direccion], ['Ubigeo / establecimiento', remitente ? `${guia.llegada_ubigeo || '-'} / ${guia.llegada_establecimiento || '-'}` : '-']]
    ]);
    if (remitente) {
        bloque('TRANSPORTE', guia.modalidad === '01' ? [
            [['Modalidad', 'Transporte público'], ['Placa', guia.placa]],
            [['Transportista', guia.transportista_nombre], ['RUC / MTC', `${guia.transportista_ruc || '-'} / ${guia.transportista_mtc || '-'}`]],
            [['Peso bruto', `${Number(guia.peso_bruto).toFixed(3)} ${guia.unidad_peso}`], ['Bultos', guia.bultos]]
        ] : [
            [['Modalidad', 'Transporte privado'], ['Placa', guia.placa]],
            [['Conductor', `${guia.conductor_nombres || ''} ${guia.conductor_apellidos || ''}`], ['DNI / Licencia', `${guia.conductor_dni || '-'} / ${guia.conductor_licencia || '-'}`]],
            [['Peso bruto', `${Number(guia.peso_bruto).toFixed(3)} ${guia.unidad_peso}`], ['Bultos', guia.bultos]]
        ]);
    }

    // Detalle de bienes
    const col = { n: 30, codigo: 70, desc: 330, unidad: 60, cantidad: W - 30 - 70 - 330 - 60 };
    y = ensureSpace(doc, y, 40);
    drawRect(doc, MARGIN, y, W, 14, COLORS.grayBg);
    doc.save();
    doc.font('Helvetica-Bold').fontSize(8).fillColor(...COLORS.text);
    let x = MARGIN;
    for (const [label, width] of [['N°', col.n], ['Código', col.codigo], ['Descripción', col.desc], ['Unidad', col.unidad], ['Cantidad', col.cantidad]]) {
        doc.text(label, x + 2, y + 4, { width: width - 4, align: 'center' }); x += width;
    }
    doc.restore();
    y += 14;
    doc.save();
    doc.font('Helvetica').fontSize(8).fillColor(...COLORS.text);
    guia.items.forEach((item, index) => {
        const descripcion = safeText(item.descripcion);
        const h = Math.max(16, doc.heightOfString(descripcion, { width: col.desc - 8 }) + 8);
        y = ensureSpace(doc, y, h + 1);
        drawRect(doc, MARGIN, y, W, h, null, COLORS.lightBorder);
        x = MARGIN;
        doc.text(String(index + 1), x + 2, y + 4, { width: col.n - 4, align: 'center' }); x += col.n;
        doc.text(safeText(item.codigo), x + 4, y + 4, { width: col.codigo - 8 }); x += col.codigo;
        doc.text(descripcion, x + 4, y + 4, { width: col.desc - 8 }); x += col.desc;
        doc.text(safeText(item.unidad_medida), x + 2, y + 4, { width: col.unidad - 4, align: 'center' }); x += col.unidad;
        doc.text(num(item.cantidad).toFixed(3).replace(/\.?0+$/, ''), x + 4, y + 4, { width: col.cantidad - 8, align: 'right' });
        y += h;
    });
    doc.restore();
    y += 8;

    const nota = guia.comentario || guia.observaciones;
    if (nota) {
        doc.font('Helvetica').fontSize(8);
        const h = doc.heightOfString(safeText(nota), { width: W - 100 }) + 12;
        y = ensureSpace(doc, y, h + 6);
        drawRect(doc, MARGIN, y, W, h, null);
        doc.save(); doc.font('Helvetica-Bold').fontSize(8).fillColor(...COLORS.text).text(remitente ? 'Observaciones:' : 'Comentario:', MARGIN + 6, y + 6);
        doc.font('Helvetica').text(safeText(nota), MARGIN + 90, y + 6, { width: W - 100 }); doc.restore();
        y += h + 6;
    }

    if (remitente) {
        y = ensureSpace(doc, y, 120);
        drawRect(doc, MARGIN, y, W, 104, null);
        if (qrImage) doc.image(qrImage, MARGIN + 8, y + 8, { width: 88, height: 88 });
        doc.save();
        doc.font('Helvetica-Bold').fontSize(8.3).fillColor(...COLORS.text).text('Estado SUNAT:', MARGIN + 110, y + 12);
        doc.font('Helvetica').text(safeText(guia.estado_sunat).toUpperCase(), MARGIN + 180, y + 12);
        doc.font('Helvetica-Bold').text('Resumen:', MARGIN + 110, y + 28);
        doc.font('Helvetica').fontSize(7).text(safeText(guia.codigo_hash) || (['aceptado', 'observado'].includes(guia.estado_sunat) ? 'Aceptada: XML y CDR disponibles en NubeFact' : 'Pendiente de respuesta del proveedor'), MARGIN + 160, y + 28, { width: W - 175 });
        doc.font('Helvetica-Oblique').fontSize(8).text('Representación impresa de la guía de remisión electrónica remitente. Consulte su validez en www.sunat.gob.pe', MARGIN + 110, y + 60, { width: W - 125 });
        doc.restore();
    } else {
        y = ensureSpace(doc, y, 90);
        const firma = guia.cargo
            ? `Cargo: ${safeText(guia.cargo)} (${safeText(guia.cargo_por_nombre)}, ${guia.cargo_fecha ? new Date(guia.cargo_fecha).toLocaleString('es-PE', { timeZone: 'America/Lima' }) : ''})`
            : 'Pendiente de recepción';
        drawRect(doc, MARGIN, y, W, 70, null);
        doc.save();
        doc.font('Helvetica').fontSize(8).fillColor(...COLORS.text);
        doc.moveTo(MARGIN + 30, y + 42).lineTo(MARGIN + 220, y + 42).strokeColor(...COLORS.border).lineWidth(0.5).stroke();
        doc.moveTo(MARGIN + W - 220, y + 42).lineTo(MARGIN + W - 30, y + 42).stroke();
        doc.text('Entregado por', MARGIN + 30, y + 46, { width: 190, align: 'center' });
        doc.text('Recibido por', MARGIN + W - 220, y + 46, { width: 190, align: 'center' });
        doc.font('Helvetica-Oblique').text(firma, MARGIN + 6, y + 58, { width: W - 12, align: 'center' });
        doc.restore();
        y += 76;
        drawRect(doc, MARGIN, y, W, 20, null);
        doc.save(); doc.font('Helvetica-Oblique').fontSize(8.4).fillColor(...COLORS.text).text('Documento interno de control. No es una guía de remisión electrónica SUNAT.', MARGIN + 8, y + 6, { width: W - 16, align: 'center' }); doc.restore();
    }
    doc.end();
    return { buffer: await done, filename: `Guia_${guia.numero_guia}.pdf` };
}

module.exports = { FormatoError, pdfA4, ticketHtml, preCuentaHtml, guiaPdf, empresaDe };
