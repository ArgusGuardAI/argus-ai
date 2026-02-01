import { Buffer } from 'buffer';
(window as unknown as Record<string, unknown>).Buffer = Buffer;

import React, { Suspense } from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { WalletContextProvider } from './contexts/AuthContext';
import './index.css';

// Code-split: lazy load pages so each subdomain only downloads what it needs
const TerminalApp = React.lazy(() => import('./TerminalApp'));
const App = React.lazy(() => import('./App')); // Legacy dashboard
const Landing = React.lazy(() => import('./pages/Landing'));
const NotFound = React.lazy(() => import('./pages/NotFound'));

// Minimal loading spinner matching the dark theme
const Loading = () => (
  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', background: '#09090b' }}>
    <div style={{ width: 32, height: 32, border: '3px solid #27272a', borderTopColor: '#10b981', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
    <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
  </div>
);

// Check environment
const isAppSubdomain = window.location.hostname.startsWith('app.');
const isLocalhost = window.location.hostname === 'localhost';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <Suspense fallback={<Loading />}>
        <Routes>
          {isAppSubdomain ? (
            // app.argusguard.io -> original dashboard in production
            <Route path="*" element={
              <WalletContextProvider>
                <App />
              </WalletContextProvider>
            } />
          ) : isLocalhost ? (
            // localhost -> new terminal dashboard for development/testing
            <>
              <Route path="/" element={
                <WalletContextProvider>
                  <TerminalApp />
                </WalletContextProvider>
              } />
              <Route path="/landing" element={<Landing />} />
              <Route path="/dashboard" element={
                <WalletContextProvider>
                  <TerminalApp />
                </WalletContextProvider>
              } />
              <Route path="/original" element={
                <WalletContextProvider>
                  <App />
                </WalletContextProvider>
              } />
              <Route path="*" element={<NotFound />} />
            </>
          ) : (
            // argusguard.io -> landing page with dashboard routes
            <>
              <Route path="/" element={<Landing />} />
              <Route path="/dashboard" element={
                <WalletContextProvider>
                  <App />
                </WalletContextProvider>
              } />
              <Route path="/terminal" element={
                <WalletContextProvider>
                  <TerminalApp />
                </WalletContextProvider>
              } />
              <Route path="*" element={<NotFound />} />
            </>
          )}
        </Routes>
      </Suspense>
    </BrowserRouter>
  </React.StrictMode>
);
