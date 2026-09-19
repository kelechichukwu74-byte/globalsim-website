import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.SUPABASE_URL;

const supabaseKey =
  process.env.SUPABASE_ANON_KEY ||
  process.env.SUPABASE_PUBLISHABLE_KEY;

if (!supabaseUrl) {
  throw new Error("SUPABASE_URL is missing");
}

if (!supabaseKey) {
  throw new Error("SUPABASE_ANON_KEY is missing");
}

export const supabase = createClient(
  supabaseUrl,
  supabaseKey
);
