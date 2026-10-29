import React from 'react';

/** Símbolo de la moneda (S/) con la misma firma que un ícono de lucide: <SolesSymbol size={18} className="..." /> */
const SolesSymbol = ({ size = 16, className = '', ...rest }) => (
    <span
        aria-hidden="true"
        className={`inline-flex items-center justify-center font-black leading-none tracking-tight select-none ${className}`}
        style={{ fontSize: size * 0.85, width: size, height: size }}
        {...rest}
    >
        S/
    </span>
);

export default SolesSymbol;
