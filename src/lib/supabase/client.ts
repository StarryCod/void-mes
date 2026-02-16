import { createBrowserClient } from '@supabase/ssr'

export const createBrowserSupabaseClient = () => {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
}

// Singleton pattern for client-side Supabase client
let client: ReturnType<typeof createBrowserSupabaseClient> | undefined

export const getSupabaseClient = () => {
  if (!client) {
    client = createBrowserSupabaseClient()
  }
  return client
}
