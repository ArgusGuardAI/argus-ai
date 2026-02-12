import { Buffer } from 'buffer';
(window as unknown as Record<string, unknown>).Buffer = Buffer;

import React, { Suspense } from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { WalletContextProvider } from './contexts/AuthContext';
import './index.css';

// ONE DASHBOARD - Terminal with AGI Council
const TerminalApp = React.lazy(() => import('./TerminalApp'));
const Landing = React.lazy(() => import('./pages/Landing'));

// Loading spinner
const Loading = () => (
  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', background: '#040405' }}>
    <div style={{ width: 32, height: 32, border: '3px solid #131518', borderTopColor: '#00e040', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
    <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
  </div>
);

const isAppSubdomain = window.location.hostname.startsWith('app.');

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <Suspense fallback={<Loading />}>
        <WalletContextProvider>
          <Routes>
            {isAppSubdomain ? (
              // app.argusguard.io -> Terminal Dashboard
              <Route path="*" element={<TerminalApp />} />
            ) : (
              // localhost or argusguard.io
              <>
                <Route path="/" element={<TerminalApp />} />
                <Route path="/landing" element={<Landing />} />
                <Route path="*" element={<TerminalApp />} />
              </>
            )}
          </Routes>
        </WalletContextProvider>
      </Suspense>
    </BrowserRouter>
  </React.StrictMode>
);
