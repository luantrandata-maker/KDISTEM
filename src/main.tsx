import './sw-register'
import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './index.css'
import { installRowClick } from './lib/rowClick'
import { installTableSort } from './lib/tableSort'
import { installFontSize } from './components/FontSize'
installRowClick()
installTableSort()
installFontSize()
createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>)

