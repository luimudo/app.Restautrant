// Fechas y horas siempre en hora de Peru, sin importar la zona horaria del navegador.
export const APP_LOCALE = 'es-PE';
export const APP_TIMEZONE = 'America/Lima';

const partsOf = (date) => {
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: APP_TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit'
    }).formatToParts(date);
    const get = (type) => parts.find((part) => part.type === type).value;
    return { year: get('year'), month: get('month'), day: get('day') };
};

/** YYYY-MM-DD de una fecha en hora de Peru. */
export const toPeruYmd = (date = new Date()) => {
    const { year, month, day } = partsOf(date);
    return `${year}-${month}-${day}`;
};

/** Suma dias a un YYYY-MM-DD (calendario puro, sin zona horaria). */
export const addDaysYmd = (ymd, days) => {
    const date = new Date(`${ymd}T12:00:00Z`);
    date.setUTCDate(date.getUTCDate() + days);
    return date.toISOString().slice(0, 10);
};

/** Primer dia del mes de un YYYY-MM-DD. */
export const startOfMonthYmd = (ymd) => `${ymd.slice(0, 8)}01`;

const toDate = (value) => (value instanceof Date ? value : new Date(value));

/** 12/10/2026, 20:15 */
export const formatDateTime = (value) => (value ? toDate(value).toLocaleString(APP_LOCALE, {
    timeZone: APP_TIMEZONE, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit'
}) : '-');

/** 12/10/2026 */
export const formatDate = (value) => (value ? toDate(value).toLocaleDateString(APP_LOCALE, {
    timeZone: APP_TIMEZONE, day: '2-digit', month: '2-digit', year: 'numeric'
}) : '-');

/** 20:15 */
export const formatTime = (value) => (value ? toDate(value).toLocaleTimeString(APP_LOCALE, {
    timeZone: APP_TIMEZONE, hour: '2-digit', minute: '2-digit'
}) : '-');
