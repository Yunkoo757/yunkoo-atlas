import React from 'react'
import ReactDOM from 'react-dom/client'
import { App } from './App'
import '@fontsource-variable/inter'
import '@fontsource/jetbrains-mono/latin-400.css'
import '@fontsource/jetbrains-mono/latin-500.css'
import './styles/tokens.css'
import './styles/global.css'
import './components/ui/Button.css'
import './components/ui/Chip.css'
import './components/ui/Kbd.css'

Object.defineProperty(window, '__ATLAS_BUILD_IDENTITY__', {
  value: Object.freeze({ ...__ATLAS_BUILD_IDENTITY__ }),
  writable: false,
  configurable: false,
  enumerable: false,
})

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
