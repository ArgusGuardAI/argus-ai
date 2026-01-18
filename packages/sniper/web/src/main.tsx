import ReactDOM from 'react-dom/client';
import App from './App';
import { WalletProvider } from './components/WalletProvider';
import './index.css';

// Note: Strict Mode disabled to prevent double WebSocket connections in dev
ReactDOM.createRoot(document.getElementById('root')!).render(
  <WalletProvider>
    <App />
  </WalletProvider>
);
