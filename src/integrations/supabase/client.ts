import { createClient } from '@supabase/supabase-js';
import type { Database } from './types';
import { brokeredPreviewStorage } from './previewAuthStorage';
import { createMockSupabaseClient } from '@/lib/mock-supabase';

function isNewSupabaseApiKey(value: string): boolean {
  return value.startsWith('sb_publishable_') || value.startsWith('sb_secret_');
}

function createSupabaseFetch(supabaseKey: string): typeof fetch {
  return (input, init) => {
    const headers = new Headers(
      typeof Request !== 'undefined' && input instanceof Request ? input.headers : undefined,
    );

    if (init?.headers) {
      new Headers(init.headers).forEach((value, key) => headers.set(key, value));
    }

    // New Supabase API keys are opaque strings, not bearer JWTs.
    if (isNewSupabaseApiKey(supabaseKey) && headers.get('Authorization') === `Bearer ${supabaseKey}`) {
      headers.delete('Authorization');
    }

    headers.set('apikey', supabaseKey);
    return fetch(input, { ...init, headers });
  };
}

function createSupabaseClient() {
  const SUPABASE_URL =
    (typeof import.meta !== 'undefined' && import.meta.env ? import.meta.env['VITE_SUPABASE_URL'] : undefined) ||
    process.env['SUPABASE_URL'] ||
    process.env['VITE_SUPABASE_URL'] ||
    'https://yweefvfmutrutogxtyis.supabase.co';
  const SUPABASE_PUBLISHABLE_KEY =
    (typeof import.meta !== 'undefined' && import.meta.env ? import.meta.env['VITE_SUPABASE_PUBLISHABLE_KEY'] : undefined) ||
    process.env['SUPABASE_PUBLISHABLE_KEY'] ||
    process.env['VITE_SUPABASE_PUBLISHABLE_KEY'] ||
    'sb_publishable_JuS6yJGn8w1-PN-Ss5cHhw_ta_3TZLS';

  // If the host is the expired/unreachable Lovable sandbox or localhost mock requested:
  // Immediately use the universal resilient local client to avoid "Failed to fetch" errors.
  const isExpiredDomain =
    !SUPABASE_URL ||
    SUPABASE_URL.includes('yweefvfmutrutogxtyis') ||
    SUPABASE_URL.includes('example.supabase.co') ||
    SUPABASE_URL.includes('placeholder');

  if (isExpiredDomain) {
    return createMockSupabaseClient() as unknown as ReturnType<typeof createClient<Database>>;
  }

  try {
    return createClient<Database>(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
      global: {
        fetch: createSupabaseFetch(SUPABASE_PUBLISHABLE_KEY),
      },
      auth: {
        storage: brokeredPreviewStorage(),
        persistSession: true,
        autoRefreshToken: true,
      },
    });
  } catch (err) {
    console.warn("Failed to initialize remote Supabase client, using local mock:", err);
    return createMockSupabaseClient() as unknown as ReturnType<typeof createClient<Database>>;
  }
}

let _supabase: ReturnType<typeof createSupabaseClient> | undefined;

// Import the supabase client like this:
// import { supabase } from "@/integrations/supabase/client";
export const supabase = new Proxy({} as ReturnType<typeof createSupabaseClient>, {
  get(_, prop, receiver) {
    if (!_supabase) _supabase = createSupabaseClient();
    return Reflect.get(_supabase, prop, receiver);
  },
});
