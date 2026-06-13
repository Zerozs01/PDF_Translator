import React from 'react'
import ReactDOM from 'react-dom/client'
import './services/pdf/pdfjsWorker'
import App from './App'
import { ErrorBoundary } from './components/ErrorBoundary'
import { AuthGuard } from './components/Auth/AuthGuard'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <AuthGuard>
        <App />
      </AuthGuard>
    </ErrorBoundary>
  </React.StrictMode>,
)

