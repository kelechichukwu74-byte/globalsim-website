const SUPABASE_URL = "https://rfitbmkizfmwfqqskwhy.supabase.co";

const SUPABASE_PUBLISHABLE_KEY =
  "sb_publishable_erjKhsDOoyhbjHDExvQ7RQ_gpGcK0C-";

const { createClient } = supabase;

window.supabaseClient = createClient(
  SUPABASE_URL,
  SUPABASE_PUBLISHABLE_KEY
);
