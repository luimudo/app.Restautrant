import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { canAccessModule, getDefaultRouteForUser, MODULES } from '../security/accessControl';

const ProtectedRoute = ({ moduleKey, children }) => {
    const location = useLocation();
    const { loading, activeUser, isSuperadmin, activeSedeId } = useAuth();

    if (loading) {
        return (
            <div className="flex flex-col items-center justify-center min-h-[400px]">
                <div className="w-10 h-10 border-4 border-brand-100 border-t-brand-600 rounded-full animate-spin mb-3"></div>
                <p className="text-sm font-bold text-gray-500">Cargando permisos...</p>
            </div>
        );
    }

    if (!activeUser) {
        return (
            <div className="card p-8 text-center max-w-xl mx-auto">
                <h3 className="text-xl font-display font-black text-gray-900 mb-2">Sesion no iniciada</h3>
                <p className="text-sm text-gray-500">Inicia sesion para continuar.</p>
            </div>
        );
    }

    // A superadmin without any sede can only reach the Sedes module to create one.
    if (isSuperadmin && !activeSedeId && moduleKey !== MODULES.sedes) {
        return <Navigate to="/sedes" replace />;
    }

    if (!canAccessModule(activeUser, moduleKey)) {
        const fallback = getDefaultRouteForUser(activeUser);
        // Sin ningun modulo asignado no hay a donde redirigir: se avisa en lugar de entrar en un bucle.
        const hasAnyModule = Object.values(MODULES).some((key) => canAccessModule(activeUser, key));
        if (fallback === location.pathname || !hasAnyModule) {
            return (
                <div className="card p-8 text-center max-w-xl mx-auto">
                    <h3 className="text-xl font-display font-black text-gray-900 mb-2">Sin acceso</h3>
                    <p className="text-sm text-gray-500">Tu perfil no tiene modulos asignados. Pide al administrador que revise tus permisos.</p>
                </div>
            );
        }
        return (
            <Navigate
                to={fallback}
                replace
                state={{ deniedPath: location.pathname }}
            />
        );
    }

    return children;
};

export default ProtectedRoute;

