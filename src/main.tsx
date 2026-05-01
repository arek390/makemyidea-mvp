import React, { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

if (import.meta.env.DEV) {
  if (typeof window !== 'undefined' && !(window as any).__readinessLogTracerInstalled) {
    ;(window as any).__readinessLogTracerInstalled = true

    const originalLog = console.log.bind(console)
    const originalWarn = console.warn.bind(console)

    console.log = (...args: any[]) => {
      const first = String(args?.[0] ?? '')
      if (first.includes('[readiness][llm]')) {
        // eslint-disable-next-line no-console
        ;(console as any).trace('[TRACE readiness console.log source]', ...args)
      }
      return originalLog(...args)
    }

    console.warn = (...args: any[]) => {
      const first = String(args?.[0] ?? '')
      if (first.includes('[readiness][llm]')) {
        // eslint-disable-next-line no-console
        ;(console as any).trace('[TRACE readiness console.warn source]', ...args)
      }
      return originalWarn(...args)
    }
  }

  if (typeof window !== 'undefined' && !(window as any).__readinessFetchTracerInstalled) {
    ;(window as any).__readinessFetchTracerInstalled = true
    const originalFetch = window.fetch.bind(window)
    window.fetch = async (...args: any[]) => {
      const url = String(args?.[0] || '')
      const body = typeof args?.[1]?.body === 'string' ? args[1].body : ''
      if (
        url.includes('readiness') ||
        body.includes('readiness') ||
        body.includes('action-plan-readiness')
      ) {
        // eslint-disable-next-line no-console
        console.warn('[TRACE READINESS FETCH]', { url, bodyPreview: body.slice(0, 300) })
        // eslint-disable-next-line no-console
        ;(console as any).trace('[TRACE READINESS FETCH STACK]')
      }
      return originalFetch(args[0] as any, args[1] as any)
    }
  }
}

const UI_LANGUAGE_STORAGE_KEY = 'ui-language'

const resolveUiLanguage = () => {
  if (typeof window !== 'undefined') {
    const stored = window.localStorage.getItem(UI_LANGUAGE_STORAGE_KEY)
    if (stored === 'English' || stored === 'Polish') return stored
    const lang = window.navigator?.language || ''
    if (lang.toLowerCase().startsWith('pl')) return 'Polish'
  }
  return 'English'
}

if (location.hostname === 'localhost') {
  const el = document.getElementById('boot-overlay')
  if (el) el.textContent += '\nREACT: entry loaded'
}

class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { error: Error | null; stack: string | null }
> {
  state: { error: Error | null; stack: string | null } = {
    error: null,
    stack: null,
  }

  static getDerivedStateFromError(error: Error) {
    return { error, stack: error.stack || null }
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    // eslint-disable-next-line no-console
    console.error('[ErrorBoundary]', error, error.stack, info)
  }

  render() {
    if (this.state.error) {
      const isPl = resolveUiLanguage() === 'Polish'
      const copy = {
        title: isPl ? 'Coś poszło nie tak' : 'Something went wrong',
        unknownError: isPl ? 'Nieznany błąd' : 'Unknown error',
        copyStack: isPl ? 'Skopiuj stack' : 'Copy stack',
        backToLanding: isPl ? 'Wróć na landing' : 'Back to landing',
      }
      const stack =
        import.meta.env.DEV && this.state.stack
          ? this.state.stack.split('\n').slice(0, 60).join('\n')
          : null
      return (
        <div className="app auth-screen">
          <section className="panel auth-panel">
            <h1>{copy.title}</h1>
            <p className="engine-error">
              {this.state.error ? this.state.error.message : copy.unknownError}
            </p>
            {stack && (
              <>
                <pre style={{ whiteSpace: 'pre-wrap', fontSize: 12 }}>{stack}</pre>
                <div className="actions">
                  <button
                    type="button"
                    className="ghost"
                    onClick={() => {
                      void navigator.clipboard.writeText(stack)
                    }}
                  >
                    {copy.copyStack}
                  </button>
                </div>
              </>
            )}
            <div className="actions">
              <button
                type="button"
                className="primary"
                onClick={() => {
                  window.location.href = '/'
                }}
              >
                {copy.backToLanding}
              </button>
            </div>
          </section>
        </div>
      )
    }
    return this.props.children
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)

if (location.hostname === 'localhost') {
  const el = document.getElementById('boot-overlay')
  if (el) el.textContent += '\nREACT: rendered'
}
