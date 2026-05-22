import React, { useEffect, useMemo, useState } from 'react';
import { DollarSign, Users, ShoppingBag, TrendingUp, Calendar, Clock } from 'lucide-react';
import { motion } from 'framer-motion';

const formatDateInput = (date) => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
};

const formatShortDate = (isoDate) => {
    return new Date(`${isoDate}T00:00:00`).toLocaleDateString('es-PE', {
        day: '2-digit',
        month: 'short'
    });
};

const buildDateRange = (range) => {
    const today = new Date();
    const start = new Date(today);

    if (range === 'month') {
        start.setDate(1);
    } else if (range === '30d') {
        start.setDate(today.getDate() - 29);
    } else {
        start.setDate(today.getDate() - 6);
    }

    return {
        desde: formatDateInput(start),
        hasta: formatDateInput(today)
    };
};

const Dashboard = () => {
    const [pedidos, setPedidos] = useState([]);
    const [loading, setLoading] = useState(true);
    const [stats, setStats] = useState([]);
    const [chartRange, setChartRange] = useState('7d');
    const [salesTimeline, setSalesTimeline] = useState([]);
    const [chartLoading, setChartLoading] = useState(true);

    const fetchDashboardData = async () => {
        try {
            const [ordersRes, clientsRes, salesTodayRes] = await Promise.all([
                fetch('http://localhost:3000/api/pedidos'),
                fetch('http://localhost:3000/api/clientes'),
                fetch('http://localhost:3000/api/stats/ventas-hoy')
            ]);

            const ordersData = await ordersRes.json();
            const clientsData = await clientsRes.json();
            const salesTodayData = await salesTodayRes.json();

            const safeOrders = Array.isArray(ordersData) ? ordersData : [];
            const safeClients = Array.isArray(clientsData) ? clientsData : [];
            const todayStr = formatDateInput(new Date());

            setPedidos(safeOrders);

            const activeOrders = safeOrders.filter((p) => ['pendiente', 'en_proceso', 'listo'].includes(p.estado)).length;
            const closedSalesToday = safeOrders.filter((p) => {
                return p.estado === 'pagado' && formatDateInput(new Date(p.fecha_creacion)) === todayStr;
            }).length;

            setStats([
                {
                    title: 'Ventas de Hoy',
                    value: `S/ ${Number(salesTodayData?.total || 0).toFixed(2)}`,
                    icon: <DollarSign size={22} />,
                    change: 'Facturado',
                    trend: 'neutral',
                    color: 'brand'
                },
                {
                    title: 'Pedidos Activos',
                    value: activeOrders.toString(),
                    icon: <ShoppingBag size={22} />,
                    change: 'En curso',
                    trend: 'neutral',
                    color: 'blue'
                },
                {
                    title: 'Clientes Registrados',
                    value: safeClients.length.toString(),
                    icon: <Users size={22} />,
                    change: 'Total',
                    trend: 'up',
                    color: 'emerald'
                },
                {
                    title: 'Ventas Cerradas',
                    value: closedSalesToday.toString(),
                    icon: <TrendingUp size={22} />,
                    change: 'Hoy',
                    trend: 'up',
                    color: 'rose'
                }
            ]);
        } catch (error) {
            console.error('Error fetching dashboard data:', error);
        } finally {
            setLoading(false);
        }
    };

    const fetchSalesTimeline = async (range) => {
        setChartLoading(true);
        try {
            const { desde, hasta } = buildDateRange(range);
            const query = new URLSearchParams({ desde, hasta });
            const res = await fetch(`http://localhost:3000/api/stats/ventas-tiempo?${query.toString()}`);
            if (!res.ok) throw new Error('No se pudo cargar la serie de ventas');
            const data = await res.json();
            setSalesTimeline(Array.isArray(data?.series) ? data.series : []);
        } catch (error) {
            console.error('Error fetching sales timeline:', error);
            setSalesTimeline([]);
        } finally {
            setChartLoading(false);
        }
    };

    useEffect(() => {
        fetchDashboardData();
    }, []);

    useEffect(() => {
        fetchSalesTimeline(chartRange);
    }, [chartRange]);

    const chartData = useMemo(() => {
        const safeSeries = Array.isArray(salesTimeline) ? salesTimeline : [];
        if (safeSeries.length === 0) return null;

        const width = 980;
        const height = 300;
        const paddingLeft = 42;
        const paddingRight = 20;
        const paddingTop = 20;
        const paddingBottom = 32;
        const maxY = Math.max(...safeSeries.map((item) => Number(item.cantidad) || 0), 1);
        const xStep = safeSeries.length > 1
            ? (width - paddingLeft - paddingRight) / (safeSeries.length - 1)
            : 0;

        const points = safeSeries.map((item, index) => {
            const value = Number(item.cantidad) || 0;
            const x = paddingLeft + index * xStep;
            const y = paddingTop + ((maxY - value) / maxY) * (height - paddingTop - paddingBottom);
            return {
                ...item,
                value,
                x,
                y
            };
        });

        const linePath = points
            .map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`)
            .join(' ');

        const areaPath = points.length > 0
            ? `${linePath} L ${points[points.length - 1].x} ${height - paddingBottom} L ${points[0].x} ${height - paddingBottom} Z`
            : '';

        const totalCount = points.reduce((acc, point) => acc + point.value, 0);
        const peakPoint = points.reduce((acc, point) => (point.value > acc.value ? point : acc), points[0]);
        const labelStep = safeSeries.length > 20 ? 5 : safeSeries.length > 10 ? 3 : 1;
        const gridMarks = [0, 0.25, 0.5, 0.75, 1].map((ratio) => ({
            y: paddingTop + ratio * (height - paddingTop - paddingBottom),
            value: Math.round(maxY - ratio * maxY)
        }));

        return {
            width,
            height,
            paddingLeft,
            paddingBottom,
            points,
            linePath,
            areaPath,
            totalCount,
            peakPoint,
            labelStep,
            gridMarks
        };
    }, [salesTimeline]);

    const getColorClasses = (color) => {
        const classes = {
            brand: 'bg-brand-50 text-brand-600 border-brand-100',
            blue: 'bg-blue-50 text-blue-600 border-blue-100',
            emerald: 'bg-emerald-50 text-emerald-600 border-emerald-100',
            rose: 'bg-rose-50 text-rose-600 border-rose-100'
        };
        return classes[color] || classes.brand;
    };

    if (loading) return (
        <div className="flex flex-col items-center justify-center min-h-[400px]">
            <div className="w-16 h-16 border-4 border-brand-100 border-t-brand-600 rounded-full animate-spin mb-4"></div>
            <p className="font-display font-bold text-gray-400">Sincronizando Dashboard...</p>
        </div>
    );

    return (
        <div className="space-y-10 animate-fade-in text-[var(--text-primary)]">
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
                <div>
                    <h2 className="text-4xl font-display font-black tracking-tight leading-none text-gray-900 uppercase">
                        Vision <span className="text-brand-600">General</span>
                    </h2>
                    <p className="text-[var(--text-secondary)] mt-1.5 font-medium">Estado en tiempo real de tu operacion gastronomica.</p>
                </div>
                <div className="flex items-center gap-3 px-5 py-3 glass rounded-2xl border border-[var(--border-color)] text-xs font-bold text-[var(--text-secondary)] shadow-sm">
                    <Calendar size={18} className="text-brand-600" />
                    {new Date().toLocaleDateString('es-PE', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
                </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
                {stats.map((stat, index) => (
                    <motion.div
                        initial={{ opacity: 0, y: 30 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: index * 0.1, duration: 0.5 }}
                        key={index}
                        className="card group relative overflow-hidden"
                    >
                        <div className="absolute top-0 right-0 -mr-4 -mt-4 w-24 h-24 bg-brand-500/5 rounded-full blur-2xl group-hover:scale-150 transition-transform duration-500"></div>

                        <div className="flex justify-between items-start mb-6">
                            <div className={`p-4 rounded-2xl border ${getColorClasses(stat.color)} group-hover:scale-110 transition-transform duration-300 shadow-sm shadow-brand-900/5`}>
                                {stat.icon}
                            </div>
                            <span className={`text-[10px] font-black px-2.5 py-1 rounded-xl border uppercase tracking-wider ${stat.trend === 'up' ? 'text-emerald-600 bg-emerald-50 border-emerald-100' :
                                stat.trend === 'down' ? 'text-rose-600 bg-rose-50 border-rose-100' :
                                    'text-blue-600 bg-blue-50 border-blue-100'
                                }`}>
                                {stat.change}
                            </span>
                        </div>

                        <div>
                            <p className="text-[var(--text-muted)] text-[10px] font-bold uppercase tracking-[0.2em] mb-1.5">{stat.title}</p>
                            <p className="text-3xl font-display font-black tracking-tight leading-none">{stat.value}</p>
                        </div>
                    </motion.div>
                ))}
            </div>

            <div className="grid grid-cols-1 xl:grid-cols-3 gap-8">
                <div className="card xl:col-span-2 min-h-[450px] flex flex-col p-8">
                    <div className="flex justify-between items-center mb-6">
                        <div className="flex items-center gap-4">
                            <div className="w-12 h-12 bg-gray-50 rounded-2xl flex items-center justify-center text-brand-600 border border-gray-100">
                                <TrendingUp size={24} />
                            </div>
                            <div>
                                <h3 className="text-xl font-display font-black tracking-tight">Cantidad de Ventas en el Tiempo</h3>
                                <p className="text-xs text-[var(--text-muted)] leading-none mt-1">Comprobantes emitidos por dia</p>
                            </div>
                        </div>
                        <select
                            value={chartRange}
                            onChange={(e) => setChartRange(e.target.value)}
                            className="bg-gray-50 border border-gray-100 text-[var(--text-secondary)] text-xs font-bold rounded-xl px-4 py-2.5 outline-none focus:border-brand-500 cursor-pointer shadow-sm"
                        >
                            <option value="7d">Ultimos 7 dias</option>
                            <option value="30d">Ultimos 30 dias</option>
                            <option value="month">Este mes</option>
                        </select>
                    </div>

                    {chartLoading ? (
                        <div className="flex-1 flex flex-col items-center justify-center rounded-[2.5rem] bg-gray-50/50 border border-gray-100">
                            <div className="w-10 h-10 border-4 border-brand-100 border-t-brand-600 rounded-full animate-spin mb-4"></div>
                            <p className="text-sm font-bold text-gray-500">Cargando serie de ventas...</p>
                        </div>
                    ) : chartData ? (
                        <div className="flex-1 rounded-[2.5rem] bg-gray-50/60 border border-gray-100 p-6">
                            <div className="flex flex-wrap items-center gap-3 mb-5">
                                <span className="px-3 py-1 rounded-lg bg-brand-50 text-brand-700 text-xs font-bold">
                                    Total: {chartData.totalCount} ventas
                                </span>
                                <span className="px-3 py-1 rounded-lg bg-blue-50 text-blue-700 text-xs font-bold">
                                    Pico: {chartData.peakPoint.value} ({formatShortDate(chartData.peakPoint.fecha)})
                                </span>
                            </div>

                            <div className="h-[280px]">
                                <svg viewBox={`0 0 ${chartData.width} ${chartData.height}`} className="w-full h-full">
                                    <defs>
                                        <linearGradient id="salesAreaGradient" x1="0" x2="0" y1="0" y2="1">
                                            <stop offset="0%" stopColor="#d97706" stopOpacity="0.28" />
                                            <stop offset="100%" stopColor="#d97706" stopOpacity="0.02" />
                                        </linearGradient>
                                    </defs>

                                    {chartData.gridMarks.map((mark, index) => (
                                        <g key={index}>
                                            <line
                                                x1={chartData.paddingLeft}
                                                y1={mark.y}
                                                x2={chartData.width - 20}
                                                y2={mark.y}
                                                stroke="#e5e7eb"
                                                strokeDasharray="4 4"
                                            />
                                            <text
                                                x={10}
                                                y={mark.y + 4}
                                                fill="#9ca3af"
                                                fontSize="11"
                                                fontWeight="700"
                                            >
                                                {mark.value}
                                            </text>
                                        </g>
                                    ))}

                                    <path d={chartData.areaPath} fill="url(#salesAreaGradient)" />
                                    <path
                                        d={chartData.linePath}
                                        fill="none"
                                        stroke="#d97706"
                                        strokeWidth="3"
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                    />

                                    {chartData.points.map((point, index) => (
                                        <g key={point.fecha}>
                                            <circle cx={point.x} cy={point.y} r="3.8" fill="#d97706" stroke="#fff" strokeWidth="2" />
                                            {(index % chartData.labelStep === 0 || index === chartData.points.length - 1) && (
                                                <text
                                                    x={point.x}
                                                    y={chartData.height - chartData.paddingBottom + 18}
                                                    textAnchor="middle"
                                                    fill="#9ca3af"
                                                    fontSize="11"
                                                    fontWeight="700"
                                                >
                                                    {formatShortDate(point.fecha)}
                                                </text>
                                            )}
                                        </g>
                                    ))}
                                </svg>
                            </div>
                        </div>
                    ) : (
                        <div className="flex-1 flex flex-col justify-center items-center rounded-[2.5rem] bg-gray-50/50 border-2 border-dashed border-gray-100">
                            <TrendingUp size={42} className="text-gray-300 mb-4" />
                            <p className="text-sm font-bold text-gray-500">No hay datos de ventas para este rango.</p>
                        </div>
                    )}
                </div>

                <div className="card flex flex-col p-8 bg-[#1a1512] border-none text-white relative overflow-hidden">
                    <div className="absolute top-0 right-0 w-64 h-64 bg-brand-500/10 blur-[100px] rounded-full -mr-32 -mt-32"></div>

                    <div className="flex justify-between items-center mb-10 relative z-10">
                        <div>
                            <h3 className="text-xl font-display font-black tracking-tight">Ultimos Pedidos</h3>
                            <p className="text-xs text-brand-500 font-bold uppercase tracking-widest mt-1 italic">Mesas Activas</p>
                        </div>
                    </div>

                    <div className="flex-1 overflow-auto pr-2 custom-scrollbar relative z-10">
                        <div className="space-y-4">
                            {pedidos.slice(0, 6).map((pedido, idx) => (
                                <motion.div
                                    initial={{ opacity: 0, x: 20 }}
                                    animate={{ opacity: 1, x: 0 }}
                                    transition={{ delay: 0.1 * idx }}
                                    key={pedido.id}
                                    className="flex items-center justify-between p-4 rounded-2xl bg-white/5 border border-white/5 hover:bg-white/10 hover:border-white/10 transition-all group"
                                >
                                    <div className="flex items-center gap-4">
                                        <div className="w-12 h-12 rounded-xl bg-white/5 flex items-center justify-center font-black text-xs text-gray-500 border border-white/5 group-hover:border-brand-500/30 group-hover:text-brand-500 transition-colors">
                                            #{pedido.id}
                                        </div>
                                        <div>
                                            <p className="font-bold text-sm text-gray-200">Mesa {pedido.mesa_numero || 'S/M'}</p>
                                            <div className="flex items-center gap-1.5 mt-1">
                                                <Clock size={12} className="text-gray-500" />
                                                <p className="text-[10px] font-bold uppercase text-gray-500 tracking-wider">
                                                    {new Date(pedido.fecha_creacion).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                                </p>
                                            </div>
                                        </div>
                                    </div>
                                    <div className="text-right">
                                        <p className="font-display font-black text-brand-500 text-sm leading-none mb-1.5">S/ {Number(pedido.total).toFixed(2)}</p>
                                        <span className={`text-[9px] font-black px-2 py-0.5 rounded-lg uppercase tracking-widest border ${pedido.estado === 'pendiente' ? 'bg-amber-500/10 text-amber-500 border-amber-500/20' :
                                            pedido.estado === 'listo' ? 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20' :
                                                'bg-white/5 text-gray-400 border-white/10'
                                            }`}>
                                            {pedido.estado}
                                        </span>
                                    </div>
                                </motion.div>
                            ))}
                            {pedidos.length === 0 && (
                                <div className="text-center py-10 opacity-40">
                                    <Clock size={40} className="mx-auto mb-4" />
                                    <p className="text-sm font-bold">No hay pedidos hoy</p>
                                </div>
                            )}
                        </div>
                    </div>

                    <button className="w-full mt-10 py-4 bg-brand-600 text-white rounded-2xl font-black text-sm uppercase tracking-widest hover:bg-brand-500 shadow-xl shadow-brand-900/40 transition-all relative z-10">
                        Monitor de Cocina
                    </button>
                </div>
            </div>
        </div>
    );
};

export default Dashboard;
