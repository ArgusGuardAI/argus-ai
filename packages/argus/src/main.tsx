import { Buffer } from 'buffer';
(window as unknown as Record<string, unknown>).Buffer = Buffer;

import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import App from './App';
import Landing from './pages/Landing';
import { WalletContextProvider } from './contexts/AuthContext';
import './index.css';

// Check if we're on the app subdomain
const isAppSubdomain = window.location.hostname.startsWith('app.');

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <Routes>
        {isAppSubdomain ? (
          // app.argusguard.io -> dashboard directly
          <Route path="*" element={
            <WalletContextProvider>
              <App />
            </WalletContextProvider>
          } />
        ) : (
          // argusguard.io -> landing page with dashboard route
          <>
            <Route path="/" element={<Landing />} />
            <Route path="/dashboard" element={
              <WalletContextProvider>
                <App />
              </WalletContextProvider>
            } />
            <Route path="*" element={<Navigate to="/" replace />} />
          </>
        )}
      </Routes>
    </BrowserRouter>
  </React.StrictMode>
);
