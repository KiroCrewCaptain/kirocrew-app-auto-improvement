import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach, beforeEach } from 'vitest'
import { setTransport } from '../src/api'
import { resetStubSdk, useAppApi } from './stubs/app-sdk'

// A component rendered without the bundle's root (`src/index.tsx`) still sends
// through the host's scoped client, as every page component does inside AppHost.
beforeEach(() => {
  setTransport(useAppApi())
})

afterEach(() => {
  cleanup()
  resetStubSdk()
  setTransport(null)
})
