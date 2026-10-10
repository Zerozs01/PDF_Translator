import React from 'react'
import ReactDOM from 'react-dom/client'
import './services/bridge'
import App from './App'
import { ErrorBoundary } from './components/ErrorBoundary'
import { AuthGuard } from './components/Auth/AuthGuard'
import './index.css'

console.log('[MAIN.TSX] Initializing React application...');

try {
  const rootElement = document.getElementById('root');
  if (!rootElement) {
    console.error('[MAIN.TSX] Error: #root element not found in DOM');
  } else {
    ReactDOM.createRoot(rootElement).render(
      <React.StrictMode>
        <ErrorBoundary>
          <AuthGuard>
            <App />
          </AuthGuard>
        </ErrorBoundary>
      </React.StrictMode>,
    );
    console.log('[MAIN.TSX] ReactDOM.createRoot mounted successfully');
  }
} catch (error) {
  console.error('[MAIN.TSX] Fatal uncaught error mounting root:', error);
}
