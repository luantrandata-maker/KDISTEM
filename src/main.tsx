import './sw-register'
import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './index.css'
import { installRowClick } from './lib/rowClick'
installRowClick()
createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>)

