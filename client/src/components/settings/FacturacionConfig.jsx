import React, { useEffect, useState } from 'react';
import { Building2, KeyRound, PlugZap, Save } from 'lucide-react';

const readJson = async (res, fallback) => {
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || fallback);
    return body;
};

const EMPTY = {
    ruc: '', razon_social: '', nombre_comercial: '', direccion: '', telefono: '', igv_porcentaje: 10.5,
    nubefact_ambiente: 'PRUEBAS', facturacion_url: '', nubefact_ruc_pruebas: '', envio_automatico: true
};

/**
 * Company data printed on receipts and the billing API account used for electronic invoicing.
 * Only the administrator and the superadmin reach it; the API key is never shown, only replaced.
 */
const FacturacionConfig = () => {
    const [form, setForm] = useState(EMPTY);
    const [tokenInfo, setTokenInfo] = useState({ configurado: false, final: null });
    const [token, setToken] = useState('');
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [testing, setTesting] = useState(false);
    const [message, setMessage] = useState('');
    const [error, setError] = useState('');

    const apply = (config) => {
        setForm({
            ruc: config.ruc || '', razon_social: config.razon_social || '', nombre_comercial: config.nombre_comercial || '',
            direccion: config.direccion || '', telefono: config.telefono || '', igv_porcentaje: Number(config.igv_porcentaje) || 10.5,
            nubefact_ambiente: config.nubefact_ambiente || 'PRUEBAS', facturacion_url: config.facturacion_url || '',
            nubefact_ruc_pruebas: config.nubefact_ruc_pruebas || '', envio_automatico: Boolean(config.envio_automatico)
        });
        setTokenInfo({ configurado: Boolean(config.token_configurado), final: config.token_final });
    };

    useEffect(() => {
        fetch('/api/configuracion/facturacion')
            .then((res) => readJson(res, 'No se pudo cargar la configuracion.'))
            .then(apply)
            .catch((e) => setError(e.message))
            .finally(() => setLoading(false));
    }, []);

    const set = (patch) => setForm((prev) => ({ ...prev, ...patch }));

    const save = async (event) => {
        event.preventDefault();
        setSaving(true);
        setMessage('');
        setError('');
        try {
            const res = await fetch('/api/configuracion/facturacion', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ...form, igv_porcentaje: Number(form.igv_porcentaje), ...(token.trim() ? { facturacion_token: token.trim() } : {}) })
            });
            apply(await readJson(res, 'No se pudo guardar la configuracion.'));
            setToken('');
            setMessage('Configuracion guardada.');
        } catch (e) {
            setError(e.message);
        } finally {
            setSaving(false);
        }
    };

    const probar = async () => {
        setTesting(true);
        setMessage('');
        setError('');
        try {
            const body = await readJson(await fetch('/api/configuracion/facturacion/probar', { method: 'POST' }), 'No se pudo conectar con la API de facturacion.');
            setMessage(body.mensaje);
        } catch (e) {
            setError(e.message);
        } finally {
            setTesting(false);
        }
    };

    if (loading) return <div className="card p-6 font-bold text-gray-500">Cargando configuracion de facturacion...</div>;

    return (
        <form onSubmit={save} className="card p-6 space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div className="flex items-center gap-2">
                    <Building2 className="text-brand-600" />
                    <h3 className="text-xl font-black">Empresa y Facturacion Electronica</h3>
                </div>
                <span className={`self-start px-3 py-1 rounded-lg border text-[10px] font-black uppercase tracking-widest ${form.nubefact_ambiente === 'PRODUCCION' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-amber-50 text-amber-700 border-amber-200'}`}>
                    API de facturacion · {form.nubefact_ambiente === 'PRODUCCION' ? 'Produccion' : 'Pruebas (SUNAT beta)'}
                </span>
            </div>

            {message && <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-700 font-semibold text-sm">{message}</div>}
            {error && <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 font-semibold text-sm">{error}</div>}

            <div>
                <p className="text-xs font-black uppercase tracking-widest text-gray-500 mb-3">Datos del emisor (se imprimen en los comprobantes)</p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <Labeled label="RUC"><input className="input" inputMode="numeric" maxLength={11} value={form.ruc} onChange={(e) => set({ ruc: e.target.value.replace(/\D/g, '') })} /></Labeled>
                    <Labeled label="Razon social"><input className="input" value={form.razon_social} onChange={(e) => set({ razon_social: e.target.value })} required minLength={3} /></Labeled>
                    <Labeled label="Nombre comercial (opcional)"><input className="input" value={form.nombre_comercial} onChange={(e) => set({ nombre_comercial: e.target.value })} /></Labeled>
                    <Labeled label="Telefono (opcional)"><input className="input" value={form.telefono} onChange={(e) => set({ telefono: e.target.value })} /></Labeled>
                    <Labeled label="Direccion fiscal" className="md:col-span-2"><input className="input" value={form.direccion} onChange={(e) => set({ direccion: e.target.value })} /></Labeled>
                    <Labeled label="IGV (%)">
                        <select className="input" value={String(form.igv_porcentaje)} onChange={(e) => set({ igv_porcentaje: Number(e.target.value) })}>
                            <option value="18">18 % (regimen general)</option>
                            <option value="10">10 % (MYPE restaurantes, Ley 31556)</option>
                            <option value="10.5">10.5 %</option>
                            {![18, 10, 10.5].includes(Number(form.igv_porcentaje)) && <option value={form.igv_porcentaje}>{form.igv_porcentaje} %</option>}
                        </select>
                    </Labeled>
                </div>
                <p className="text-xs text-gray-500 mt-2">Cada sede imprime su propia direccion (Sedes) si la tiene registrada; si no, se usa la direccion fiscal.</p>
            </div>

            <div>
                <p className="text-xs font-black uppercase tracking-widest text-gray-500 mb-3">Cuenta de la API de facturacion electronica</p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <Labeled label="Ambiente">
                        <select className="input" value={form.nubefact_ambiente} onChange={(e) => set({ nubefact_ambiente: e.target.value })}>
                            <option value="PRUEBAS">Pruebas (SUNAT beta, sin valor tributario)</option>
                            <option value="PRODUCCION">Produccion</option>
                        </select>
                    </Labeled>
                    <Labeled label="RUC de la cuenta de pruebas (opcional)"><input className="input" inputMode="numeric" maxLength={11} value={form.nubefact_ruc_pruebas} onChange={(e) => set({ nubefact_ruc_pruebas: e.target.value.replace(/\D/g, '') })} /></Labeled>
                    <Labeled label="URL de la API" className="md:col-span-2">
                        <input className="input font-mono text-sm" placeholder="https://facturacion.midominio.com" value={form.facturacion_url} onChange={(e) => set({ facturacion_url: e.target.value.trim() })} />
                    </Labeled>
                    <Labeled label="API key" className="md:col-span-2">
                        <div className="relative">
                            <KeyRound size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" />
                            <input
                                className="input pl-10 font-mono text-sm"
                                type="password"
                                autoComplete="new-password"
                                placeholder={tokenInfo.configurado ? `Configurado (termina en ${tokenInfo.final}). Escribe uno nuevo solo para reemplazarlo.` : 'Pega la API key (fe_...) generada en el panel de facturacion'}
                                value={token}
                                onChange={(e) => setToken(e.target.value)}
                            />
                        </div>
                    </Labeled>
                </div>
                <label className="flex items-center gap-2 text-sm font-semibold mt-3">
                    <input type="checkbox" checked={form.envio_automatico} onChange={(e) => set({ envio_automatico: e.target.checked })} />
                    Enviar boletas y facturas a SUNAT automaticamente al emitirlas
                </label>
                {form.nubefact_ambiente === 'PRUEBAS' && (
                    <p className="text-xs text-amber-700 mt-2">En pruebas los comprobantes no tienen valor tributario y se imprimen con la marca PRUEBAS. Usa las series habilitadas en la cuenta de pruebas de la API de facturacion (Correlativos).</p>
                )}
            </div>

            <div className="flex flex-col sm:flex-row gap-3">
                <button type="button" className="btn btn-secondary" onClick={probar} disabled={testing || saving}>
                    <PlugZap size={16} /> {testing ? 'Probando...' : 'Probar conexion'}
                </button>
                <button type="submit" className="btn btn-primary" disabled={saving}>
                    <Save size={16} /> {saving ? 'Guardando...' : 'Guardar configuracion'}
                </button>
            </div>
        </form>
    );
};

const Labeled = ({ label, children, className = '' }) => (
    <label className={`block ${className}`}>
        <span className="text-xs font-bold text-gray-500 uppercase tracking-widest">{label}</span>
        <div className="mt-1.5">{children}</div>
    </label>
);

export default FacturacionConfig;
