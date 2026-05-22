import React from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { LayoutDashboard, ShoppingCart, UtensilsCrossed, Users, FileText, Package, LogOut, Bell, Search, ChevronRight, Settings, HelpCircle, ChefHat, Beer } from 'lucide-react';
import { motion } from 'framer-motion';
import { useAuth } from '../context/AuthContext';
import { MODULES } from '../security/accessControl';

const MAIN_ITEMS = [
    { to: '/', icon: <LayoutDashboard size={20} />, label: 'Dashboard', moduleKey: MODULES.dashboard },
    { to: '/pos', icon: <ShoppingCart size={20} />, label: 'Punto de Venta', moduleKey: MODULES.pos },
    { to: '/menu', icon: <ChefHat size={20} />, label: 'Carta / Menu', moduleKey: MODULES.menu },
    { to: '/kitchen', icon: <UtensilsCrossed size={20} />, label: 'Cocina', moduleKey: MODULES.kitchen },
    { to: '/bar', icon: <Beer size={20} />, label: 'Bar / Bebidas', moduleKey: MODULES.bar },
    { to: '/inventory', icon: <Package size={20} />, label: 'Inventario', moduleKey: MODULES.inventory },
    { to: '/purchases', icon: <ShoppingCart size={20} />, label: 'Compras', moduleKey: MODULES.purchases },
    { to: '/suppliers', icon: <Users size={20} />, label: 'Proveedores', moduleKey: MODULES.suppliers },
    { to: '/clients', icon: <Users size={20} />, label: 'Clientes', moduleKey: MODULES.clients },
    { to: '/billing', icon: <FileText size={20} />, label: 'Facturacion', moduleKey: MODULES.billing }
];

const SYSTEM_ITEMS = [
    { to: '/settings', icon: <Settings size={20} />, label: 'Configuracion', moduleKey: MODULES.settings },
    { to: '/help', icon: <HelpCircle size={20} />, label: 'Ayuda', moduleKey: MODULES.help }
];

const MainLayout = () => {
    const { users, activeUser, activeProfile, switchUser, logout, canAccess } = useAuth();

    const visibleMainItems = MAIN_ITEMS.filter((item) => canAccess(item.moduleKey));
    const visibleSystemItems = SYSTEM_ITEMS.filter((item) => canAccess(item.moduleKey));
    const userName = activeUser?.nombre || 'Usuario';
    const profileLabel = activeProfile || 'sin perfil';
    const avatarSrc = `https://ui-avatars.com/api/?name=${encodeURIComponent(userName)}&background=ff701a&color=fff&rounded=true`;

    return (
        <div className="flex h-screen bg-[var(--bg-secondary)] font-sans antialiased text-[var(--text-primary)] overflow-hidden">
            <aside className="w-20 lg:w-72 bg-[#1a1512] text-white flex flex-col shrink-0 relative z-50 shadow-2xl transition-all duration-300">
                <div className="p-6 mb-4">
                    <div className="flex items-center gap-4 group cursor-pointer">
                        <div className="relative">
                            <div className="w-10 h-10 lg:w-12 lg:h-12 bg-gradient-to-tr from-brand-600 to-brand-400 rounded-2xl flex items-center justify-center shadow-lg shadow-brand-900/50 group-hover:rotate-6 transition-transform duration-300">
                                <UtensilsCrossed size={24} className="text-white" />
                            </div>
                            <div className="absolute -bottom-1 -right-1 w-3.5 h-3.5 bg-green-500 border-2 border-[#1a1512] rounded-full"></div>
                        </div>
                        <div className="hidden lg:block">
                            <h1 className="text-xl font-display font-black tracking-tight leading-none text-white">
                                Gourmet<span className="text-brand-500">OS</span>
                            </h1>
                            <span className="text-[10px] text-gray-500 tracking-[0.2em] uppercase font-bold">POS System</span>
                        </div>
                    </div>
                </div>

                <nav className="flex-1 px-4 space-y-1.5 overflow-y-auto custom-scrollbar pt-2">
                    {visibleMainItems.length > 0 && (
                        <div className="hidden lg:block text-[10px] font-black text-gray-600 uppercase tracking-[0.2em] mb-4 ml-4">Menu Principal</div>
                    )}
                    {visibleMainItems.map((item) => (
                        <NavItem key={item.to} to={item.to} icon={item.icon} label={item.label} />
                    ))}

                    {visibleSystemItems.length > 0 && (
                        <div className="hidden lg:block text-[10px] font-black text-gray-600 uppercase tracking-[0.2em] mt-8 mb-4 ml-4">Sistema</div>
                    )}
                    {visibleSystemItems.map((item) => (
                        <NavItem key={item.to} to={item.to} icon={item.icon} label={item.label} />
                    ))}
                </nav>

                <div className="p-4 mt-auto">
                    <div className="hidden lg:block mb-6">
                        <div className="p-4 rounded-3xl bg-white/5 border border-white/10 hover:bg-white/10 transition-colors">
                            <p className="text-xs font-bold text-gray-300 mb-1">Sucursal Principal</p>
                            <p className="text-[10px] text-gray-500 leading-relaxed">Jr. Los Pinos 123, Lima</p>
                        </div>
                    </div>

                    <button
                        onClick={logout}
                        className="w-full flex items-center gap-3 p-3 lg:px-4 lg:py-3.5 rounded-2xl text-gray-400 hover:text-red-400 hover:bg-red-500/10 transition-all group overflow-hidden"
                    >
                        <LogOut size={20} className="group-hover:-translate-x-1 transition-transform" />
                        <span className="hidden lg:block font-bold text-sm">Cambiar Sesion</span>
                    </button>
                </div>
            </aside>

            <div className="flex-1 flex flex-col overflow-hidden">
                <header className="h-20 bg-white/80 backdrop-blur-md border-b border-[var(--border-color)] px-8 flex items-center justify-between shrink-0">
                    <div className="flex-1 max-w-xl relative group">
                        <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 group-focus-within:text-brand-600 transition-colors" size={18} />
                        <input
                            type="text"
                            placeholder="Buscar mesa, pedido o cliente..."
                            className="w-full pl-12 pr-4 py-3 bg-gray-50 border-transparent rounded-2xl text-sm focus:bg-white focus:ring-4 focus:ring-brand-500/10 focus:border-brand-500 transition-all outline-none"
                        />
                    </div>

                    <div className="flex items-center gap-6">
                        <div className="hidden md:flex items-center gap-2">
                            <select
                                value={activeUser?.id ?? ''}
                                onChange={(event) => switchUser(event.target.value)}
                                className="bg-gray-50 border border-gray-200 text-gray-700 text-xs font-bold rounded-xl px-3 py-2 outline-none focus:border-brand-500"
                            >
                                {users.map((user) => (
                                    <option key={user.id} value={user.id}>
                                        {user.nombre} ({user.perfil})
                                    </option>
                                ))}
                            </select>
                        </div>

                        <div className="flex items-center gap-2">
                            <button className="p-2.5 rounded-2xl text-gray-500 hover:bg-gray-100 transition-all relative group">
                                <Bell size={20} className="group-hover:rotate-12 transition-transform" />
                                <span className="absolute top-2.5 right-2.5 w-2 h-2 bg-brand-600 rounded-full border-2 border-white"></span>
                            </button>
                        </div>

                        <div className="h-8 w-px bg-gray-100"></div>

                        <div className="flex items-center gap-4 pl-2 group cursor-pointer">
                            <div className="text-right hidden sm:block">
                                <p className="font-black text-sm text-[var(--text-primary)] leading-tight">{userName}</p>
                                <p className="text-[10px] font-bold text-brand-600 uppercase tracking-widest mt-0.5">{profileLabel}</p>
                            </div>
                            <div className="relative">
                                <img
                                    src={avatarSrc}
                                    alt="Profile"
                                    className="w-10 h-10 rounded-2xl shadow-md border-2 border-white group-hover:scale-110 transition-transform"
                                />
                                <div className="absolute -bottom-1 -right-1 w-4 h-4 bg-green-500 border-2 border-white rounded-full"></div>
                            </div>
                        </div>
                    </div>
                </header>

                <main className="flex-1 overflow-y-auto bg-[var(--bg-secondary)] relative">
                    <div className="absolute top-0 right-0 w-[500px] h-[500px] bg-brand-500/5 blur-[120px] pointer-events-none rounded-full"></div>
                    <div className="absolute bottom-0 left-0 w-[500px] h-[500px] bg-blue-500/5 blur-[120px] pointer-events-none rounded-full"></div>

                    <div className="p-8 lg:p-12 relative z-10">
                        <Outlet />
                    </div>
                </main>
            </div>
        </div>
    );
};

const NavItem = ({ to, icon, label }) => {
    return (
        <NavLink
            to={to}
            className={({ isActive }) =>
                `flex items-center gap-4 px-4 py-3.5 rounded-2xl transition-all duration-300 group relative ${isActive
                    ? 'text-white bg-brand-600 shadow-xl shadow-brand-900/40'
                    : 'text-gray-400 hover:bg-white/5 hover:text-white'
                }`
            }
        >
            {({ isActive }) => (
                <>
                    <span className={`relative z-10 transition-transform duration-300 ${isActive ? 'scale-110' : 'group-hover:scale-110'}`}>
                        {icon}
                    </span>
                    <span className="hidden lg:block relative z-10 font-bold text-sm tracking-tight">{label}</span>

                    {isActive && (
                        <motion.div
                            layoutId="nav-glow"
                            className="absolute -inset-1 bg-brand-600/20 blur-xl rounded-2xl z-0"
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                        />
                    )}

                    <ChevronRight
                        size={14}
                        className={`ml-auto hidden lg:block transition-all duration-300 ${isActive ? 'translate-x-0 opacity-100' : '-translate-x-2 opacity-0 group-hover:opacity-50 group-hover:translate-x-0'}`}
                    />
                </>
            )}
        </NavLink>
    );
};

export default MainLayout;
