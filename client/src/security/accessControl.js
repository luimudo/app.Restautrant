export const PROFILES = ['administrador', 'mozo', 'caja', 'cocina'];

const PROFILE_ALIASES = {
    administrador: 'administrador',
    admin: 'administrador',
    mozo: 'mozo',
    mesero: 'mozo',
    caja: 'caja',
    cajero: 'caja',
    cocina: 'cocina',
    cocinero: 'cocina'
};

export const MODULES = {
    dashboard: 'dashboard',
    pos: 'pos',
    menu: 'menu',
    kitchen: 'kitchen',
    bar: 'bar',
    inventory: 'inventory',
    purchases: 'purchases',
    suppliers: 'suppliers',
    clients: 'clients',
    billing: 'billing',
    settings: 'settings',
    help: 'help'
};

const moduleList = Object.values(MODULES);

const profileAccess = {
    administrador: new Set(moduleList),
    mozo: new Set([MODULES.dashboard, MODULES.pos, MODULES.clients, MODULES.help]),
    caja: new Set([MODULES.dashboard, MODULES.billing, MODULES.clients, MODULES.help]),
    cocina: new Set([MODULES.dashboard, MODULES.kitchen, MODULES.bar, MODULES.help])
};

const defaultRouteByProfile = {
    administrador: '/',
    mozo: '/pos',
    caja: '/billing',
    cocina: '/kitchen'
};

const moduleRoute = {
    [MODULES.dashboard]: '/',
    [MODULES.pos]: '/pos',
    [MODULES.menu]: '/menu',
    [MODULES.kitchen]: '/kitchen',
    [MODULES.bar]: '/bar',
    [MODULES.inventory]: '/inventory',
    [MODULES.purchases]: '/purchases',
    [MODULES.suppliers]: '/suppliers',
    [MODULES.clients]: '/clients',
    [MODULES.billing]: '/billing',
    [MODULES.settings]: '/settings',
    [MODULES.help]: '/help'
};

export const normalizeProfile = (value) => {
    if (typeof value !== 'string') return null;
    return PROFILE_ALIASES[value.trim().toLowerCase()] || null;
};

export const canAccessModule = (profile, moduleKey) => {
    if (!moduleKey) return true;
    const normalized = normalizeProfile(profile);
    if (!normalized) return false;
    const allowedModules = profileAccess[normalized];
    return allowedModules ? allowedModules.has(moduleKey) : false;
};

export const getDefaultRouteForProfile = (profile) => {
    const normalized = normalizeProfile(profile);
    if (!normalized) return '/';
    return defaultRouteByProfile[normalized] || '/';
};

export const getRouteForModule = (moduleKey) => moduleRoute[moduleKey] || '/';

