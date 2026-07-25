import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { getCurrentWindow } from '@tauri-apps/api/window'
import './styles/globals.css'
import { applyTheme } from './theme/applyTheme'
import { branding } from './config/branding'
import App from './App.tsx'

// The native window's title bar is a separate concept from the webview's
// document.title (setting the latter alone does nothing visible in a Tauri
// window) -- tauri.conf.json's static "title" is just the pre-launch
// fallback; this is what actually keeps the title bar in sync with
// branding.ts at runtime.
void getCurrentWindow().setTitle(branding.appName)

// FrameX applies its dark theme unconditionally at startup (no light mode,
// no system-preference check) -- matched exactly here rather than defaulting
// to light like the earlier (incorrect) version of this file did.
document.documentElement.classList.add('dark')
applyTheme('dark')

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
