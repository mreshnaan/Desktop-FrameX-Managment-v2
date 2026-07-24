import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles/globals.css'
import { applyTheme } from './theme/applyTheme'
import App from './App.tsx'

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
