import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { ErrorBoundary } from './components/ErrorBoundary';
import './styles/app.css';

function applyInitialTheme(): void {
  try {
    const raw = localStorage.getItem('qf:theme');
    if (raw === 'dark' || raw === 'light') {
      document.documentElement.dataset.theme = raw;
    }
  } catch {
    // ignore (storage disabled / private mode)
  }
}

applyInitialTheme();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);
