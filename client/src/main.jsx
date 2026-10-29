import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { AUTH_EXPIRED_EVENT, getStoredSedeId, getStoredToken } from './context/authStorage'

const originalFetch = window.fetch.bind(window)

window.fetch = async (input, init = {}) => {
  const requestUrl = typeof input === 'string' ? input : input?.url
  const isApiRequest = typeof requestUrl === 'string' && requestUrl.includes('/api/')

  if (!isApiRequest) {
    return originalFetch(input, init)
  }

  const headers = new Headers(input instanceof Request ? input.headers : undefined)
  if (init.headers) {
    const initHeaders = new Headers(init.headers)
    initHeaders.forEach((value, key) => headers.set(key, value))
  }

  const token = getStoredToken()
  const sedeId = getStoredSedeId()

  if (token && !headers.has('authorization')) {
    headers.set('authorization', `Bearer ${token}`)
  }

  // Only honoured by the API for the superadmin; other users are pinned to their sede.
  if (sedeId && !headers.has('x-sede-id')) {
    headers.set('x-sede-id', String(sedeId))
  }

  const response = await originalFetch(input, { ...init, headers })

  if (response.status === 401 && !requestUrl.includes('/api/auth/login')) {
    window.dispatchEvent(new Event(AUTH_EXPIRED_EVENT))
  }

  return response
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
