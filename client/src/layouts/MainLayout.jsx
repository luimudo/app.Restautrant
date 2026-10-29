import React, { useCallback, useEffect, useRef, useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { LayoutDashboard, ShoppingCart, UtensilsCrossed, Users, FileText, Package, LogOut, Bell, Search, ChevronRight, Settings, HelpCircle, ChefHat, Beer, Building2, CalendarDays, Wallet, Wrench, Warehouse, Menu, X, BellRing, Bike, HandCoins, ShieldCheck } from 'lucide-react';
import { motion } from 'framer-motion';
import { useAuth } from '../context/AuthContext';
import { MODULES } from '../security/accessControl';
import RecordatoriosBell from '../components/RecordatoriosBell';

const MAIN_ITEMS = [
    { to: '/', icon: <LayoutDashboard size={20} />, label: 'Dashboard', moduleKey: MODULES.dashboard },
    { to: '/pos', icon: <ShoppingCart size={20} />, label: 'Punto de Venta', moduleKey: MODULES.pos },
    { to: '/delivery', icon: <Bike size={20} />, label: 'Pedidos Delivery', moduleKey: MODULES.delivery },
    { to: '/reservas', icon: <CalendarDays size={20} />, label: 'Reservas', moduleKey: MODULES.reservations },
    { to: '/menu', icon: <ChefHat size={20} />, label: 'Carta / Menu', moduleKey: MODULES.menu },
    { to: '/kitchen', icon: <UtensilsCrossed size={20} />, label: 'Cocina', moduleKey: MODULES.kitchen },
    { to: '/bar', icon: <Beer size={20} />, label: 'Bar / Bebidas', moduleKey: MODULES.bar },
    { to: '/inventory', icon: <Package size={20} />, label: 'Inventario', moduleKey: MODULES.inventory },
    { to: '/purchases', icon: <ShoppingCart size={20} />, label: 'Compras', moduleKey: MODULES.purchases },
    { to: '/almacenes', icon: <Warehouse size={20} />, label: 'Almacenes y Guías', moduleKey: MODULES.warehouses },
    { to: '/equipos', icon: <Wrench size={20} />, label: 'Equipos', moduleKey: MODULES.equipment },
    { to: '/gastos', icon: <Wallet size={20} />, label: 'Gastos y Pagos', moduleKey: MODULES.expenses },
    { to: '/recordatorios', icon: <BellRing size={20} />, label: 'Recordatorios', moduleKey: MODULES.reminders },
    { to: '/suppliers', icon: <Users size={20} />, label: 'Proveedores', moduleKey: MODULES.suppliers },
    { to: '/clients', icon: <Users size={20} />, label: 'Clientes', moduleKey: MODULES.clients },
    { to: '/billing', icon: <FileText size={20} />, label: 'Facturacion', moduleKey: MODULES.billing },
    { to: '/cuentas-por-cobrar', icon: <HandCoins size={20} />, label: 'Cuentas por cobrar', moduleKey: MODULES.receivables }
];

const SYSTEM_ITEMS = [
    { to: '/sedes', icon: <Building2 size={20} />, label: 'Sedes', moduleKey: MODULES.sedes },
    { to: '/settings', icon: <Settings size={20} />, label: 'Configuracion', moduleKey: MODULES.settings },
    { to: '/permisos', icon: <ShieldCheck size={20} />, label: 'Perfiles y permisos', moduleKey: MODULES.settings },
    { to: '/help', icon: <HelpCircle size={20} />, label: 'Ayuda', moduleKey: MODULES.help }
];

const DESKTOP_QUERY = '(min-width: 1024px)';

/**
 * Fixed sidebar on desktop (1024 px and up); below that the menu is a drawer opened from the header.
 * The drawer locks the page scroll, keeps the focus inside and closes with Escape, on navigation
 * or when the screen grows to desktop.
 */
const MainLayout = () => {
    const { activeUser, activeProfile, isSuperadmin, sedes, activeSede, activeSedeId, selectSede, logout, canAccess, profileLabel: labelOf } = useAuth();
    const [menuOpen, setMenuOpen] = useState(false);
    const drawerRef = useRef(null);
    const menuButtonRef = useRef(null);

    const visibleMainItems = MAIN_ITEMS.filter((item) => canAccess(item.moduleKey));
    const visibleSystemItems = SYSTEM_ITEMS.filter((item) => canAccess(item.moduleKey));
    const userName = activeUser?.nombre || 'Usuario';
    const profileLabel = labelOf(activeProfile);
    const selectableSedes = sedes.filter((sede) => Number(sede.estado) === 1 || Number(sede.id) === Number(activeSedeId));
    const avatarSrc = `https://ui-avatars.com/api/?name=${encodeURIComponent(userName)}&background=ff701a&color=fff&rounded=true`;

    const closeMenu = useCallback(() => setMenuOpen(false), []);

    // Growing to desktop closes it too.
    useEffect(() => {
        const query = window.matchMedia(DESKTOP_QUERY);
        const onChange = (event) => { if (event.matches) closeMenu(); };
        query.addEventListener('change', onChange);
        return () => query.removeEventListener('change', onChange);
    }, [closeMenu]);

    // While open: no background scroll, Escape closes and Tab stays inside the drawer.
    useEffect(() => {
        if (!menuOpen) return undefined;
        const previousOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        const focusables = () => [...(drawerRef.current?.querySelectorAll('a[href], button:not([disabled]), select') || [])];
        focusables()[0]?.focus();
        const onKey = (event) => {
            if (event.key === 'Escape') {
                setMenuOpen(false);
                menuButtonRef.current?.focus();
            } else if (event.key === 'Tab') {
                const items = focusables();
                if (items.length === 0) return;
                const first = items[0];
                const last = items[items.length - 1];
                if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
                else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
            }
        };
        document.addEventListener('keydown', onKey);
        return () => {
            document.body.style.overflow = previousOverflow;
            document.removeEventListener('keydown', onKey);
        };
    }, [menuOpen]);

    const sedeSelector = (compact = false) => (
        <div className={`flex items-center gap-2 ${compact ? '' : 'min-w-0'}`}>
            <Building2 size={16} className="text-brand-600 shrink-0" />
            {isSuperadmin ? (
                <select
                    value={activeSedeId ?? ''}
                    onChange={(event) => selectSede(event.target.value)}
                    aria-label="Sede activa"
                    className="bg-gray-50 border border-gray-200 text-gray-700 text-xs font-bold rounded-xl px-3 py-2 outline-none focus:border-brand-500 max-w-[200px] sm:max-w-none"
                >
                    {!activeSedeId && <option value="">Sin sedes</option>}
                    {selectableSedes.map((sede) => (
                        <option key={sede.id} value={sede.id}>
                            {sede.nombre}{Number(sede.estado) === 1 ? '' : ' (inactiva)'}
                        </option>
                    ))}
                </select>
            ) : (
                <span className="text-xs font-bold text-gray-700 truncate">{activeSede?.nombre || activeUser?.sede_nombre}</span>
            )}
        </div>
    );

    const sidebarContent = (
        <>
            <div className="p-6 mb-2 flex items-center justify-between gap-3">
                <div className="flex items-center gap-4 group cursor-pointer min-w-0">
                    <div className="relative shrink-0">
                        <div className="w-12 h-12 bg-gradient-to-tr from-brand-600 to-brand-400 rounded-2xl flex items-center justify-center shadow-lg shadow-brand-900/50 group-hover:rotate-6 transition-transform duration-300">
                            <UtensilsCrossed size={24} className="text-white" />
                        </div>
                        <div className="absolute -bottom-1 -right-1 w-3.5 h-3.5 bg-green-500 border-2 border-[#1a1512] rounded-full"></div>
                    </div>
                    <div className="min-w-0">
                        <h1 className="text-xl font-display font-black tracking-tight leading-none text-white">
                            Gourmet<span className="text-brand-500">OS</span>
                        </h1>
                        <span className="text-[10px] text-gray-500 tracking-[0.2em] uppercase font-bold">POS System</span>
                    </div>
                </div>
                <button type="button" onClick={closeMenu} className="lg:hidden p-2 rounded-xl text-gray-400 hover:text-white hover:bg-white/10" aria-label="Cerrar menú">
                    <X size={22} />
                </button>
            </div>

            <nav className="flex-1 px-4 space-y-1.5 overflow-y-auto custom-scrollbar pt-2" aria-label="Menú principal">
                {visibleMainItems.length > 0 && (
                    <div className="text-[10px] font-black text-gray-600 uppercase tracking-[0.2em] mb-4 ml-4">Menu Principal</div>
                )}
                {visibleMainItems.map((item) => (
                    <NavItem key={item.to} to={item.to} icon={item.icon} label={item.label} onNavigate={closeMenu} />
                ))}

                {visibleSystemItems.length > 0 && (
                    <div className="text-[10px] font-black text-gray-600 uppercase tracking-[0.2em] mt-8 mb-4 ml-4">Sistema</div>
                )}
                {visibleSystemItems.map((item) => (
                    <NavItem key={item.to} to={item.to} icon={item.icon} label={item.label} onNavigate={closeMenu} />
                ))}
            </nav>

            <div className="p-4 mt-auto">
                <div className="mb-4">
                    <div className="p-4 rounded-3xl bg-white/5 border border-white/10">
                        <p className="text-xs font-bold text-gray-300 mb-1">{activeSede?.nombre || 'Sin sede seleccionada'}</p>
                        <p className="text-[10px] text-gray-500 leading-relaxed">{activeSede?.direccion || (isSuperadmin ? 'Elige una sede en la parte superior' : '')}</p>
                    </div>
                </div>
                <button
                    onClick={logout}
                    className="w-full flex items-center gap-3 px-4 py-3.5 rounded-2xl text-gray-400 hover:text-red-400 hover:bg-red-500/10 transition-all group overflow-hidden"
                >
                    <LogOut size={20} className="group-hover:-translate-x-1 transition-transform" />
                    <span className="font-bold text-sm">Cerrar Sesion</span>
                </button>
            </div>
        </>
    );

    return (
        <div className="flex h-[100dvh] bg-[var(--bg-secondary)] font-sans antialiased text-[var(--text-primary)] overflow-hidden">
            {/* Desktop sidebar */}
            <aside className="hidden lg:flex w-72 bg-[#1a1512] text-white flex-col shrink-0 relative z-40 shadow-2xl">
                {sidebarContent}
            </aside>

            {/* Mobile / tablet drawer */}
            {menuOpen && (
                <div className="lg:hidden fixed inset-0 z-[60]">
                    <div className="absolute inset-0 bg-black/50" onClick={closeMenu} aria-hidden="true" />
                    <aside
                        id="menu-movil"
                        ref={drawerRef}
                        role="dialog"
                        aria-modal="true"
                        aria-label="Menú"
                        className="absolute inset-y-0 left-0 w-[85vw] max-w-xs bg-[#1a1512] text-white flex flex-col shadow-2xl"
                    >
                        {sidebarContent}
                    </aside>
                </div>
            )}

            <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
                <header className="relative z-30 h-16 sm:h-20 bg-white/80 backdrop-blur-md border-b border-[var(--border-color)] px-3 sm:px-6 lg:px-8 flex items-center justify-between gap-2 sm:gap-4 shrink-0">
                    <div className="flex items-center gap-2 sm:gap-4 flex-1 min-w-0">
                        <button
                            ref={menuButtonRef}
                            type="button"
                            onClick={() => setMenuOpen(true)}
                            className="lg:hidden p-2.5 rounded-2xl text-gray-600 hover:bg-gray-100 shrink-0"
                            aria-label="Abrir menú"
                            aria-expanded={menuOpen}
                            aria-controls="menu-movil"
                        >
                            <Menu size={22} />
                        </button>
                        <div className="hidden sm:block flex-1 max-w-xl relative group">
                            <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 group-focus-within:text-brand-600 transition-colors" size={18} />
                            <input
                                type="text"
                                placeholder="Buscar mesa, pedido o cliente..."
                                className="w-full pl-12 pr-4 py-3 bg-gray-50 border-transparent rounded-2xl text-sm focus:bg-white focus:ring-4 focus:ring-brand-500/10 focus:border-brand-500 transition-all outline-none"
                            />
                        </div>
                        <div className="sm:hidden min-w-0 flex-1">{sedeSelector(true)}</div>
                    </div>

                    <div className="flex items-center gap-2 sm:gap-4 lg:gap-6 shrink-0">
                        <div className="hidden sm:flex">{sedeSelector()}</div>

                        {canAccess(MODULES.reminders) ? (
                            <RecordatoriosBell />
                        ) : (
                            <button className="hidden sm:inline-flex p-2.5 rounded-2xl text-gray-500 hover:bg-gray-100 transition-all relative group" aria-label="Notificaciones">
                                <Bell size={20} className="group-hover:rotate-12 transition-transform" />
                            </button>
                        )}

                        <div className="hidden sm:block h-8 w-px bg-gray-100"></div>

                        <div className="flex items-center gap-3 pl-1 group cursor-pointer">
                            <div className="text-right hidden md:block">
                                <p className="font-black text-sm text-[var(--text-primary)] leading-tight">{userName}</p>
                                <p className="text-[10px] font-bold text-brand-600 uppercase tracking-widest mt-0.5">{profileLabel}</p>
                            </div>
                            <div className="relative">
                                <img
                                    src={avatarSrc}
                                    alt="Perfil"
                                    className="w-9 h-9 sm:w-10 sm:h-10 rounded-2xl shadow-md border-2 border-white group-hover:scale-110 transition-transform"
                                />
                                <div className="absolute -bottom-1 -right-1 w-4 h-4 bg-green-500 border-2 border-white rounded-full"></div>
                            </div>
                        </div>
                    </div>
                </header>

                <main className="flex-1 overflow-y-auto overflow-x-hidden bg-[var(--bg-secondary)] relative">
                    <div className="absolute top-0 right-0 w-[min(500px,80vw)] h-[500px] bg-brand-500/5 blur-[120px] pointer-events-none rounded-full"></div>
                    <div className="absolute bottom-0 left-0 w-[min(500px,80vw)] h-[500px] bg-blue-500/5 blur-[120px] pointer-events-none rounded-full"></div>

                    <div className="p-4 sm:p-6 lg:p-10 xl:p-12 relative z-10">
                        {/* Remount the page when the superadmin switches sede so it reloads its data. */}
                        <Outlet key={activeSedeId ?? 'sin-sede'} />
                    </div>
                </main>
            </div>
        </div>
    );
};

const NavItem = ({ to, icon, label, onNavigate }) => {
    return (
        <NavLink
            to={to}
            onClick={onNavigate}
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
                    <span className="relative z-10 font-bold text-sm tracking-tight">{label}</span>

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
                        className={`ml-auto transition-all duration-300 ${isActive ? 'translate-x-0 opacity-100' : '-translate-x-2 opacity-0 group-hover:opacity-50 group-hover:translate-x-0'}`}
                    />
                </>
            )}
        </NavLink>
    );
};

export default MainLayout;
