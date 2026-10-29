import React, { useRef } from 'react';
import { createPortal } from 'react-dom';

const SUNAT_STYLES = {
    no_aplica: ['bg-gray-100 text-gray-500 border-gray-200', 'Interno'],
    pendiente: ['bg-amber-50 text-amber-700 border-amber-200', 'Pendiente de envio'],
    enviando: ['bg-sky-50 text-sky-700 border-sky-200', 'Enviando'],
    enviado: ['bg-sky-50 text-sky-700 border-sky-200', 'Enviado'],
    aceptado: ['bg-emerald-50 text-emerald-700 border-emerald-200', 'Aceptado SUNAT'],
    observado: ['bg-emerald-50 text-emerald-700 border-emerald-200', 'Aceptado con obs.'],
    rechazado: ['bg-rose-50 text-rose-700 border-rose-200', 'Rechazado'],
    error: ['bg-rose-50 text-rose-700 border-rose-200', 'Error de envio'],
    incierto: ['bg-orange-50 text-orange-700 border-orange-200', 'Por confirmar'],
    anulado: ['bg-gray-100 text-gray-500 border-gray-200', 'Anulado']
};

export const SunatBadge = ({ estado }) => {
    const [style, label] = SUNAT_STYLES[estado] || SUNAT_STYLES.pendiente;
    return <span className={`inline-block px-2 py-1 rounded-lg border text-[10px] font-black uppercase tracking-widest whitespace-nowrap ${style}`}>{label}</span>;
};

const COBRO_STYLES = {
    cobrado: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    parcial: 'bg-sky-50 text-sky-700 border-sky-200',
    pendiente: 'bg-amber-50 text-amber-700 border-amber-200',
    vencido: 'bg-rose-50 text-rose-700 border-rose-200'
};

export const CobroBadge = ({ estado }) => (
    <span className={`inline-block px-2 py-1 rounded-lg border text-[10px] font-black uppercase tracking-widest ${COBRO_STYLES[estado] || COBRO_STYLES.pendiente}`}>{estado}</span>
);

/**
 * `xl` is for long forms (guias): a larger sheet that does not close by clicking outside, so a click that slips
 * off the form (or a text selection dragged past its edge) never throws away what was typed.
 * In the other modals the backdrop only closes when the press also started on it.
 */
export const Modal = ({ title, subtitle, children, wide = false, xl = false, onClose }) => {
    const pressedBackdrop = useRef(false);
    const size = xl ? 'max-w-5xl' : wide ? 'max-w-2xl' : 'max-w-lg';
    return createPortal(
        <div
            className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-2 sm:p-4"
            onMouseDown={(e) => { pressedBackdrop.current = e.target === e.currentTarget; }}
            onClick={(e) => { if (!xl && pressedBackdrop.current && e.target === e.currentTarget) onClose(); }}
        >
            <div className={`bg-white rounded-3xl p-6 sm:p-8 w-full ${size} ${xl ? 'max-h-[96vh]' : 'max-h-[92vh]'} overflow-y-auto`}>
                <div className="flex items-start justify-between gap-4">
                    <div>
                        <h4 className="text-2xl font-black text-gray-900">{title}</h4>
                        {subtitle && <p className="text-sm text-gray-500 mt-1">{subtitle}</p>}
                    </div>
                    {xl && <button type="button" onClick={onClose} className="shrink-0 p-2 rounded-xl text-gray-400 hover:text-gray-700 hover:bg-gray-100 font-black leading-none" aria-label="Cerrar">✕</button>}
                </div>
                <div className="mt-5">{children}</div>
            </div>
        </div>,
        document.body
    );
};

export const Field = ({ label, children, className = '' }) => (
    <label className={`block ${className}`}>
        <span className="text-xs font-bold text-gray-500 uppercase tracking-widest">{label}</span>
        <div className="mt-1.5">{children}</div>
    </label>
);

export const ErrorBox = ({ text }) => (text
    ? <div className="mb-4 p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-sm font-semibold">{text}</div>
    : null);

export const ToggleGroup = ({ options, value, onChange }) => (
    <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}>
        {options.map((option) => (
            <button
                type="button"
                key={option.value}
                onClick={() => onChange(option.value)}
                aria-pressed={value === option.value}
                className={`px-3 py-2.5 rounded-2xl border font-bold text-sm transition-all ${value === option.value
                    ? 'bg-brand-600 border-brand-600 text-white'
                    : 'bg-white border-gray-200 text-gray-600 hover:border-brand-300'}`}
            >
                {option.label}
            </button>
        ))}
    </div>
);
