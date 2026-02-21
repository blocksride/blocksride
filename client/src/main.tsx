import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.tsx'
import './styles/index.css'
import { ThemeProvider } from '@/components/theme-provider.tsx'
import { Web3Provider } from './providers/Web3Provider.tsx'
import { Buffer } from 'buffer'

window.Buffer = Buffer

// Register service worker for PWA support
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/sw.js')
      .catch(() => {
        // Service worker registration failed silently
      })
  })
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ThemeProvider>
      <Web3Provider>
        <App />
      </Web3Provider>
    </ThemeProvider>
  </React.StrictMode>
)
