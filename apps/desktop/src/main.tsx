import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { getCurrentWindow } from '@tauri-apps/api/window'
import './styles/globals.css'
import { applyTheme } from './theme/applyTheme'
import { branding } from './config/branding'
import App from './App.tsx'

// document.title alone doesn't update a Tauri window's native title bar.
void getCurrentWindow().setTitle(branding.appName)

// Dark theme only, unconditionally -- no light mode or system-preference check.
document.documentElement.classList.add('dark')
applyTheme('dark')

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
