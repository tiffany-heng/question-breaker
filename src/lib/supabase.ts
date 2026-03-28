import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

// Create a single supabase client for interacting with your database and real-time
// Added a safety check to prevent the app from crashing if keys are missing
export const supabase = (supabaseUrl && supabaseAnonKey) 
  ? createClient(supabaseUrl, supabaseAnonKey)
  : (null as any);

// Helper for Session Broadcasting
export const SESSION_CHANNEL_PREFIX = 'session:';

export type SessionEvent = 
  | { type: 'IMAGE_UPLOADED'; payload: { imageUrl: string } }
  | { type: 'TEXT_EXTRACTED'; payload: { text: string } }
  | { type: 'VARIATIONS_READY'; payload: { variations: any[] } }
  | { type: 'USER_JOINED'; payload: { device: string } };
