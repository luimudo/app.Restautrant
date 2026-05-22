import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { canAccessModule, getDefaultRouteForProfile, normalizeProfile } from '../security/accessControl';
import { ACTIVE_USER_ID_KEY, ACTIVE_USER_PROFILE_KEY } from './authStorage';

const FALLBACK_ADMIN_USER = {
    id: 0,
    nombre: 'Administrador Local',
    email: 'local@restaurant.com',
    perfil: 'administrador'
};

const AuthContext = createContext(null);

const resolveInitialUser = (userList) => {
    const storedRaw = localStorage.getItem(ACTIVE_USER_ID_KEY);
    const storedId = storedRaw !== null ? Number(storedRaw) : null;
    if (storedId !== null && !Number.isNaN(storedId)) {
        const match = userList.find((user) => Number(user.id) === storedId);
        if (match) return Number(match.id);
    }
    return userList.length > 0 ? Number(userList[0].id) : null;
};

export const AuthProvider = ({ children }) => {
    const [users, setUsers] = useState([]);
    const [activeUserId, setActiveUserId] = useState(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const loadUsers = async () => {
            setLoading(true);
            try {
                const response = await fetch('http://localhost:3000/api/usuarios');
                if (!response.ok) throw new Error('No se pudo cargar usuarios');
                const data = await response.json();
                const safeUsers = Array.isArray(data) && data.length > 0 ? data : [FALLBACK_ADMIN_USER];

                setUsers(safeUsers);
                const initialId = resolveInitialUser(safeUsers);
                setActiveUserId(initialId);
                if (initialId !== null) localStorage.setItem(ACTIVE_USER_ID_KEY, String(initialId));
            } catch (error) {
                console.error('Error loading users for session:', error);
                setUsers([FALLBACK_ADMIN_USER]);
                setActiveUserId(FALLBACK_ADMIN_USER.id);
                localStorage.setItem(ACTIVE_USER_ID_KEY, String(FALLBACK_ADMIN_USER.id));
                localStorage.setItem(ACTIVE_USER_PROFILE_KEY, FALLBACK_ADMIN_USER.perfil);
            } finally {
                setLoading(false);
            }
        };

        loadUsers();
    }, []);

    useEffect(() => {
        if (activeUserId === null || Number.isNaN(Number(activeUserId))) return;
        localStorage.setItem(ACTIVE_USER_ID_KEY, String(activeUserId));
    }, [activeUserId]);

    const switchUser = useCallback((userId) => {
        const numericId = Number(userId);
        if (Number.isNaN(numericId)) return;
        setActiveUserId(numericId);
    }, []);

    const logout = useCallback(() => {
        localStorage.removeItem(ACTIVE_USER_ID_KEY);
        localStorage.removeItem(ACTIVE_USER_PROFILE_KEY);
        setActiveUserId(null);
    }, []);

    const activeUser = useMemo(
        () => users.find((user) => Number(user.id) === Number(activeUserId)) || null,
        [users, activeUserId]
    );

    useEffect(() => {
        if (!activeUser?.perfil) {
            localStorage.removeItem(ACTIVE_USER_PROFILE_KEY);
            return;
        }
        localStorage.setItem(ACTIVE_USER_PROFILE_KEY, String(activeUser.perfil));
    }, [activeUser]);

    const activeProfile = normalizeProfile(activeUser?.perfil) || null;

    const value = useMemo(() => ({
        users,
        loading,
        activeUser,
        activeUserId,
        activeProfile,
        switchUser,
        logout,
        canAccess: (moduleKey) => canAccessModule(activeProfile, moduleKey),
        defaultRoute: getDefaultRouteForProfile(activeProfile)
    }), [users, loading, activeUser, activeUserId, activeProfile, switchUser, logout]);

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
