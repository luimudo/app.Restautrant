import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { canAccessModule, getDefaultRouteForProfile } from '../security/accessControl';

const ProtectedRoute = ({ moduleKey, children }) => {
    const location = useLocation();
    const { loading, activeUser, activeProfile } = useAuth();

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
                <p className="text-sm text-gray-500">Selecciona un usuario para continuar.</p>
            </div>
        );
    }

    if (!canAccessModule(activeProfile, moduleKey)) {
        return (
            <Navigate
                to={getDefaultRouteForProfile(activeProfile)}
                replace
                state={{ deniedPath: location.pathname }}
            />
        );
    }

    return children;
};

export default ProtectedRoute;

