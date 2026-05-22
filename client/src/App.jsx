import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import MainLayout from './layouts/MainLayout';
import Dashboard from './pages/Dashboard';
import Clients from './pages/Clients';
import Inventory from './pages/Inventory';
import POS from './pages/POS';
import Billing from './pages/Billing';
import Settings from './pages/Settings';
import MenuManagement from './pages/MenuManagement';
import KitchenPage from './pages/Kitchen';
import BarPage from './pages/Bar';
import Purchases from './pages/Purchases';
import Suppliers from './pages/Suppliers';
import ProtectedRoute from './components/ProtectedRoute';
import { AuthProvider } from './context/AuthContext';
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

function App() {
  const withAccess = (moduleKey, element) => (
    <ProtectedRoute moduleKey={moduleKey}>
      {element}
    </ProtectedRoute>
  );

  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<MainLayout />}>
            <Route index element={withAccess(MODULES.dashboard, <Dashboard />)} />
            <Route path="pos" element={withAccess(MODULES.pos, <POS />)} />
            <Route path="menu" element={withAccess(MODULES.menu, <MenuManagement />)} />
            <Route path="kitchen" element={withAccess(MODULES.kitchen, <KitchenPage />)} />
            <Route path="bar" element={withAccess(MODULES.bar, <BarPage />)} />
            <Route path="inventory" element={withAccess(MODULES.inventory, <Inventory />)} />
            <Route path="purchases" element={withAccess(MODULES.purchases, <Purchases />)} />
            <Route path="suppliers" element={withAccess(MODULES.suppliers, <Suppliers />)} />
            <Route path="clients" element={withAccess(MODULES.clients, <Clients />)} />
            <Route path="billing" element={withAccess(MODULES.billing, <Billing />)} />
            <Route path="settings" element={withAccess(MODULES.settings, <Settings />)} />
            <Route path="help" element={withAccess(MODULES.help, <Placeholder title="Ayuda" />)} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}

export default App;
