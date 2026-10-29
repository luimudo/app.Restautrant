import React, { useState } from 'react';
import { UtensilsCrossed, User, Lock, LogIn } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

const Login = () => {
    const { login } = useAuth();
    const [usuario, setUsuario] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const [submitting, setSubmitting] = useState(false);

    const handleSubmit = async (event) => {
        event.preventDefault();
        setError('');
        setSubmitting(true);
        try {
            await login(usuario.trim(), password);
        } catch (e) {
            setError(e.message);
            setSubmitting(false);
        }
    };

    return (
        <div className="min-h-screen bg-[#1a1512] flex items-center justify-center p-4 relative overflow-hidden">
            <div className="absolute top-0 right-0 w-[500px] h-[500px] bg-brand-500/10 blur-[120px] pointer-events-none rounded-full"></div>
            <div className="absolute bottom-0 left-0 w-[500px] h-[500px] bg-blue-500/5 blur-[120px] pointer-events-none rounded-full"></div>

            <div className="w-full max-w-md relative z-10">
                <div className="flex items-center justify-center gap-4 mb-8">
                    <div className="w-12 h-12 bg-gradient-to-tr from-brand-600 to-brand-400 rounded-2xl flex items-center justify-center shadow-lg shadow-brand-900/50">
                        <UtensilsCrossed size={24} className="text-white" />
                    </div>
                    <div>
                        <h1 className="text-2xl font-display font-black tracking-tight leading-none text-white">
                            Gourmet<span className="text-brand-500">OS</span>
                        </h1>
                        <span className="text-[10px] text-gray-500 tracking-[0.2em] uppercase font-bold">POS System</span>
                    </div>
                </div>

                <div className="bg-white rounded-3xl p-8 shadow-2xl">
                    <h2 className="text-2xl font-display font-black text-gray-900">Iniciar sesion</h2>
                    <p className="text-sm text-gray-500 mt-1 mb-6">Ingresa con tu usuario o email.</p>

                    {error && (
                        <div className="mb-4 p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-sm font-semibold" role="alert">
                            {error}
                        </div>
                    )}

                    <form onSubmit={handleSubmit} className="space-y-4">
                        <label className="block">
                            <span className="text-xs font-bold text-gray-500 uppercase tracking-widest">Usuario</span>
                            <div className="relative mt-1.5">
                                <User size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" />
                                <input
                                    className="input pl-11"
                                    autoComplete="username"
                                    autoFocus
                                    value={usuario}
                                    onChange={(e) => setUsuario(e.target.value)}
                                    required
                                />
                            </div>
                        </label>
                        <label className="block">
                            <span className="text-xs font-bold text-gray-500 uppercase tracking-widest">Clave</span>
                            <div className="relative mt-1.5">
                                <Lock size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" />
                                <input
                                    className="input pl-11"
                                    type="password"
                                    autoComplete="current-password"
                                    value={password}
                                    onChange={(e) => setPassword(e.target.value)}
                                    required
                                />
                            </div>
                        </label>
                        <button type="submit" className="btn btn-primary w-full mt-2" disabled={submitting}>
                            <LogIn size={18} />
                            {submitting ? 'Ingresando...' : 'Ingresar'}
                        </button>
                    </form>
                </div>
            </div>
        </div>
    );
};

export default Login;
