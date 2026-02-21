import { BrowserRouter } from 'react-router-dom'
import { AuthProvider } from './contexts/AuthContext'
import { ContestProvider } from './contexts/ContestContext'
import { OnboardingProvider } from './contexts/OnboardingContext'
import { BettingOnboarding } from './components/onboarding/BettingOnboarding'
import { Toaster } from './components/ui/sonner'
import { ErrorBoundary } from './components/ErrorBoundary'
import { OfflineBanner } from './components/NetworkStatus'
import AppRoutes from './router/routes'

function App() {
  return (
    <ErrorBoundary>
      <BrowserRouter>
        <AuthProvider>
          <ContestProvider>
            <OnboardingProvider>
              <OfflineBanner />
              <ErrorBoundary>
                <AppRoutes />
              </ErrorBoundary>
              <BettingOnboarding />
              <Toaster />
            </OnboardingProvider>
          </ContestProvider>
        </AuthProvider>
      </BrowserRouter>
    </ErrorBoundary>
  )
}

export default App
