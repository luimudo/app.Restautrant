import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { ACTIVE_USER_ID_KEY, ACTIVE_USER_PROFILE_KEY } from './context/authStorage'

const originalFetch = window.fetch.bind(window)

window.fetch = (input, init = {}) => {
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

  const activeUserId = localStorage.getItem(ACTIVE_USER_ID_KEY)
  const activeUserProfile = localStorage.getItem(ACTIVE_USER_PROFILE_KEY)

  if (activeUserId && !headers.has('x-user-id')) {
    headers.set('x-user-id', activeUserId)
  }

  if (activeUserProfile && !headers.has('x-user-profile')) {
    headers.set('x-user-profile', activeUserProfile)
  }

  return originalFetch(input, { ...init, headers })
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
