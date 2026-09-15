// Global Virtual Sim Web - Supabase Configuration

const SUPABASE_URL = "https://rfitbmkizfmwfqqskwhy.supabase.co";

// IMPORTANT:
// Put your Supabase PUBLISHABLE/anon key here.
// Do NOT put your service-role or secret key here.
const SUPABASE_PUBLISHABLE_KEY = "YOUR_SUPABASE_PUBLISHABLE_KEY";

if (!window.supabase) {
  console.error("Supabase JavaScript library was not loaded.");
} else if (
  !SUPABASE_PUBLISHABLE_KEY ||
  SUPABASE_PUBLISHABLE_KEY === "YOUR_SUPABASE_PUBLISHABLE_KEY"
) {
  console.error("Supabase publishable key has not been configured.");
} else {
  window.supabaseClient = window.supabase.createClient(
    SUPABASE_URL,
    SUPABASE_PUBLISHABLE_KEY
  );

  console.log("Supabase client initialized.");
}
