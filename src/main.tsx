import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './index.css';
import { initDevConsole } from './devtools';
import { ErrorBoundary } from './debug/ErrorBoundary';

void initDevConsole();

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
);
