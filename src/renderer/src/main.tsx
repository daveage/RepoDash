import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource/rajdhani/300.css'
import '@fontsource/rajdhani/500.css'
import '@fontsource/share-tech-mono/400.css'
import './styles.css'
import './detail.css'
import { App } from './App'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
