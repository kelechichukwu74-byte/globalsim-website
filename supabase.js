// Global Virtual Sim Web - Supabase Configuration

const SUPABASE_URL = "https://rfitbmkizfmwfqqskwhy.supabase.co";

// Paste your Supabase PUBLISHABLE key between the quotes below.
const SUPABASE_PUBLISHABLE_KEY = "PASTE_YOUR_SUPABASE_PUBLISHABLE_KEY_HERE";

if (!window.supabase) {
  console.error("Supabase library was not loaded.");
} else {
  window.supabaseClient = window.supabase.createClient(
    SUPABASE_URL,
    SUPABASE_PUBLISHABLE_KEY
  );

  console.log("Supabase connected successfully.");
}
