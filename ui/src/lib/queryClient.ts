import { QueryClient } from '@tanstack/react-query'

/**
 * The harvest/cluster pipeline runs on the order of once per week(s)/month,
 * so within any realistic browser session the underlying data never goes
 * stale on its own. A full page reload resets this in-memory singleton and
 * is the only "refresh" mechanism this needs.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: Infinity,
    },
  },
})
