export const SUPERADMIN = 'superadmin';
export const PROFILES = ['administrador', 'mozo', 'caja', 'cocina'];

const PROFILE_ALIASES = {
    superadmin: SUPERADMIN,
    administrador: 'administrador',
    admin: 'administrador',
    mozo: 'mozo',
    mesero: 'mozo',
    caja: 'caja',
    cajero: 'caja',
    cocina: 'cocina',
    cocinero: 'cocina'
};

export const PROFILE_LABELS = {
    superadmin: 'super admin',
    administrador: 'administrador',
    mozo: 'mozo',
    caja: 'caja',
    cocina: 'cocina'
};

export const MODULES = {
    dashboard: 'dashboard',
    pos: 'pos',
    reservations: 'reservations',
    delivery: 'delivery',
    menu: 'menu',
    kitchen: 'kitchen',
    bar: 'bar',
    inventory: 'inventory',
    purchases: 'purchases',
    expenses: 'expenses',
    equipment: 'equipment',
    warehouses: 'warehouses',
    suppliers: 'suppliers',
    clients: 'clients',
    billing: 'billing',
    receivables: 'receivables',
    reminders: 'reminders',
    settings: 'settings',
    sedes: 'sedes',
    help: 'help'
};

const moduleList = Object.values(MODULES);

// Ruta de inicio preferida segun el perfil base; si no tiene acceso a ninguna, se usa el primer modulo permitido.
const preferredRoutes = {
    administrador: [MODULES.dashboard],
    mozo: [MODULES.pos, MODULES.delivery],
    caja: [MODULES.billing, MODULES.pos, MODULES.delivery],
    cocina: [MODULES.kitchen, MODULES.bar]
};

const moduleRoute = {
    [MODULES.dashboard]: '/',
    [MODULES.pos]: '/pos',
    [MODULES.reservations]: '/reservas',
    [MODULES.delivery]: '/delivery',
    [MODULES.menu]: '/menu',
    [MODULES.kitchen]: '/kitchen',
    [MODULES.bar]: '/bar',
    [MODULES.inventory]: '/inventory',
    [MODULES.purchases]: '/purchases',
    [MODULES.expenses]: '/gastos',
    [MODULES.equipment]: '/equipos',
    [MODULES.warehouses]: '/almacenes',
    [MODULES.suppliers]: '/suppliers',
    [MODULES.clients]: '/clients',
    [MODULES.billing]: '/billing',
    [MODULES.receivables]: '/cuentas-por-cobrar',
    [MODULES.reminders]: '/recordatorios',
    [MODULES.settings]: '/settings',
    [MODULES.sedes]: '/sedes',
    [MODULES.help]: '/help'
};

export const normalizeProfile = (value) => {
    if (typeof value !== 'string') return null;
    const key = value.trim().toLowerCase();
    return PROFILE_ALIASES[key] || key || null;
};

// El usuario trae sus modulos desde el servidor (perfil + permisos editables); el super admin entra a todo.
export const canAccessModule = (user, moduleKey) => {
    if (!moduleKey) return true;
    if (!user) return false;
    if (normalizeProfile(user.perfil) === SUPERADMIN) return true;
    return Array.isArray(user.modulos) && user.modulos.includes(moduleKey);
};

export const getRouteForModule = (moduleKey) => moduleRoute[moduleKey] || '/';

export const getDefaultRouteForUser = (user) => {
    if (!user) return '/';
    const preferred = preferredRoutes[user.base] || [];
    const first = [...preferred, ...moduleList].find((moduleKey) => canAccessModule(user, moduleKey));
    return first ? getRouteForModule(first) : '/';
};
