import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { canAccessModule, getDefaultRouteForUser, normalizeProfile, SUPERADMIN } from '../security/accessControl';
import {
    AUTH_EXPIRED_EVENT,
    getStoredSedeId,
    getStoredToken,
    setStoredSedeId,
    setStoredToken
} from './authStorage';

const AuthContext = createContext(null);

// A multisede user (superadmin, contador...) keeps the last chosen sede if it still exists, otherwise the first active one.
const pickSedeForMultisede = (sedes) => {
    const stored = getStoredSedeId();
    if (stored && sedes.some((sede) => Number(sede.id) === stored)) return stored;
    const firstActive = sedes.find((sede) => Number(sede.estado) === 1) || sedes[0];
    return firstActive ? Number(firstActive.id) : null;
};

export const AuthProvider = ({ children }) => {
    const [activeUser, setActiveUser] = useState(null);
    const [sedes, setSedes] = useState([]);
    const [activeSedeId, setActiveSedeId] = useState(null);
    const [perfilNombres, setPerfilNombres] = useState({});
    const [loading, setLoading] = useState(true);

    const activeProfile = normalizeProfile(activeUser?.perfil) || null;
    // Perfil base (administrador, mozo, caja o cocina): decide que operaciones puede hacer dentro de cada modulo.
    const baseProfile = activeUser?.base || null;
    const isSystemSuperadmin = activeProfile === SUPERADMIN;
    // "Superadmin" en las pantallas = puede ver y elegir cualquier sede (super admin o perfil multisede como contador).
    const isSuperadmin = isSystemSuperadmin || Boolean(activeUser?.multisede);

    const clearSession = useCallback(() => {
        setStoredToken(null);
        setStoredSedeId(null);
        setActiveUser(null);
        setSedes([]);
        setActiveSedeId(null);
    }, []);

    // Loads the sedes visible to the user and fixes the active one.
    const loadSedes = useCallback(async (user) => {
        const response = await fetch('/api/sedes');
        const data = response.ok ? await response.json() : [];
        const list = Array.isArray(data) ? data : [];
        setSedes(list);

        const sedeId = (normalizeProfile(user?.perfil) === SUPERADMIN || user?.multisede)
            ? pickSedeForMultisede(list)
            : (user?.sede_id ?? null);
        // Stored synchronously so the very next API call already carries x-sede-id.
        setStoredSedeId(sedeId);
        setActiveSedeId(sedeId);
        return list;
    }, []);

    const startSession = useCallback(async (user) => {
        await loadSedes(user);
        try {
            const response = await fetch('/api/perfiles/detalle');
            const perfiles = response.ok ? await response.json() : [];
            setPerfilNombres(Object.fromEntries((Array.isArray(perfiles) ? perfiles : []).map((p) => [p.codigo, p.nombre])));
        } catch {
            setPerfilNombres({});
        }
        setActiveUser(user);
    }, [loadSedes]);

    useEffect(() => {
        const restore = async () => {
            if (!getStoredToken()) {
                setLoading(false);
                return;
            }
            try {
                const response = await fetch('/api/auth/me');
                if (!response.ok) throw new Error('Sesion expirada');
                await startSession(await response.json());
            } catch {
                clearSession();
            } finally {
                setLoading(false);
            }
        };
        restore();
    }, [startSession, clearSession]);

    useEffect(() => {
        window.addEventListener(AUTH_EXPIRED_EVENT, clearSession);
        return () => window.removeEventListener(AUTH_EXPIRED_EVENT, clearSession);
    }, [clearSession]);

    const login = useCallback(async (usuario, password) => {
        const response = await fetch('/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ usuario, password })
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || 'No se pudo iniciar sesion');

        setStoredToken(data.token);
        setStoredSedeId(null);
        await startSession(data.usuario);
        return data.usuario;
    }, [startSession]);

    const logout = useCallback(() => {
        clearSession();
    }, [clearSession]);

    const selectSede = useCallback((sedeId) => {
        if (!isSuperadmin) return;
        const numericId = Number(sedeId);
        if (!Number.isInteger(numericId) || numericId <= 0) return;
        setStoredSedeId(numericId);
        setActiveSedeId(numericId);
    }, [isSuperadmin]);

    // Vuelve a pedir el usuario: sus modulos cambian cuando se editan los permisos de su perfil.
    const refreshUser = useCallback(async () => {
        const response = await fetch('/api/auth/me');
        if (response.ok) setActiveUser(await response.json());
    }, []);

    const reloadSedes = useCallback(() => loadSedes(activeUser), [loadSedes, activeUser]);

    const activeSede = useMemo(
        () => sedes.find((sede) => Number(sede.id) === Number(activeSedeId)) || null,
        [sedes, activeSedeId]
    );

    const value = useMemo(() => ({
        loading,
        activeUser,
        activeUserId: activeUser?.id ?? null,
        activeProfile,
        baseProfile,
        isSuperadmin,
        isSystemSuperadmin,
        profileLabel: (code) => perfilNombres[code] || code || 'sin perfil',
        sedes,
        activeSede,
        activeSedeId,
        selectSede,
        reloadSedes,
        refreshUser,
        login,
        logout,
        canAccess: (moduleKey) => canAccessModule(activeUser, moduleKey),
        defaultRoute: getDefaultRouteForUser(activeUser)
    }), [loading, activeUser, activeProfile, baseProfile, isSuperadmin, isSystemSuperadmin, perfilNombres, sedes, activeSede, activeSedeId, selectSede, reloadSedes, refreshUser, login, logout]);

    return (
        <AuthContext.Provider value={value}>
            {children}
        </AuthContext.Provider>
    );
};

export const useAuth = () => {
    const context = useContext(AuthContext);
    if (!context) {
        throw new Error('useAuth must be used within AuthProvider');
    }
    return context;
};
