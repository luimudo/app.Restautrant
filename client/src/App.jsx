import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import MainLayout from './layouts/MainLayout';
import Dashboard from './pages/Dashboard';
import Clients from './pages/Clients';
import Inventory from './pages/Inventory';
import POS from './pages/POS';
import Billing from './pages/Billing';
import CuentasPorCobrar from './pages/CuentasPorCobrar';
import Settings from './pages/Settings';
import Permisos from './pages/Permisos';
import MenuManagement from './pages/MenuManagement';
import KitchenPage from './pages/Kitchen';
import BarPage from './pages/Bar';
import Purchases from './pages/Purchases';
import Suppliers from './pages/Suppliers';
import Sedes from './pages/Sedes';
import Reservas from './pages/Reservas';
import Gastos from './pages/Gastos';
import Equipos from './pages/Equipos';
import Almacenes from './pages/Almacenes';
import Recordatorios from './pages/Recordatorios';
import Delivery from './pages/Delivery';
import Login from './pages/Login';
import ProtectedRoute from './components/ProtectedRoute';
import { AuthProvider, useAuth } from './context/AuthContext';
import { MODULES } from './security/accessControl';

// Placeholder components for routes not yet fully implemented
const Placeholder = ({ title }) => (
  <div className="space-y-10 animate-fade-in">
    <h2 className="text-4xl font-display font-black tracking-tight">{title}</h2>
    <div className="card h-96 flex flex-col items-center justify-center text-center relative overflow-hidden">
      <div className="absolute top-0 left-0 w-full h-1 bg-brand-600/20"></div>
      <div className="w-20 h-20 bg-brand-50 rounded-full flex items-center justify-center mb-6 border border-brand-100">
        <div className="w-8 h-8 border-4 border-brand-100 border-t-brand-600 rounded-full animate-spin"></div>
      </div>
      <p className="text-xl font-display font-bold text-[var(--text-primary)]">Módulo en Desarrollo</p>
      <p className="text-sm text-[var(--text-muted)] mt-2 max-w-xs">Estamos trabajando para traerte la mejor experiencia en la gestión de {title.toLowerCase()}.</p>
    </div>
  </div>
);

const SessionGate = ({ children }) => {
  const { loading, activeUser } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center">
        <div className="w-10 h-10 border-4 border-brand-100 border-t-brand-600 rounded-full animate-spin mb-3"></div>
        <p className="text-sm font-bold text-gray-500">Cargando sesion...</p>
      </div>
    );
  }

  return activeUser ? children : <Login />;
};

function App() {
  const withAccess = (moduleKey, element) => (
    <ProtectedRoute moduleKey={moduleKey}>
      {element}
    </ProtectedRoute>
  );

  return (
    <AuthProvider>
      <SessionGate>
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<MainLayout />}>
              <Route index element={withAccess(MODULES.dashboard, <Dashboard />)} />
              <Route path="pos" element={withAccess(MODULES.pos, <POS />)} />
              <Route path="delivery" element={withAccess(MODULES.delivery, <Delivery />)} />
              <Route path="reservas" element={withAccess(MODULES.reservations, <Reservas />)} />
              <Route path="menu" element={withAccess(MODULES.menu, <MenuManagement />)} />
              <Route path="kitchen" element={withAccess(MODULES.kitchen, <KitchenPage />)} />
              <Route path="bar" element={withAccess(MODULES.bar, <BarPage />)} />
              <Route path="inventory" element={withAccess(MODULES.inventory, <Inventory />)} />
              <Route path="purchases" element={withAccess(MODULES.purchases, <Purchases />)} />
              <Route path="almacenes" element={withAccess(MODULES.warehouses, <Almacenes />)} />
              <Route path="equipos" element={withAccess(MODULES.equipment, <Equipos />)} />
              <Route path="gastos" element={withAccess(MODULES.expenses, <Gastos />)} />
              <Route path="recordatorios" element={withAccess(MODULES.reminders, <Recordatorios />)} />
              <Route path="suppliers" element={withAccess(MODULES.suppliers, <Suppliers />)} />
              <Route path="clients" element={withAccess(MODULES.clients, <Clients />)} />
              <Route path="billing" element={withAccess(MODULES.billing, <Billing />)} />
              <Route path="cuentas-por-cobrar" element={withAccess(MODULES.receivables, <CuentasPorCobrar />)} />
              <Route path="settings" element={withAccess(MODULES.settings, <Settings />)} />
              <Route path="permisos" element={withAccess(MODULES.settings, <Permisos />)} />
              <Route path="sedes" element={withAccess(MODULES.sedes, <Sedes />)} />
              <Route path="help" element={withAccess(MODULES.help, <Placeholder title="Ayuda" />)} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Route>
          </Routes>
        </BrowserRouter>
      </SessionGate>
    </AuthProvider>
  );
}

export default App;
