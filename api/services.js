import { sureVerificationRequest } from "./_lib.js";

const SUPABASE_URL =
  "https://rfitbmkizfmwfqqskwhy.supabase.co";

const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY;


/* =========================================================
   SUPABASE REQUEST
   ========================================================= */

async function supabaseRequest(path) {
  if (!SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY is not configured."
    );
  }

  const response = await fetch(
    `${SUPABASE_URL}/rest/v1/${path}`,
    {
      method: "GET",
      headers: {
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization:
          `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        Accept: "application/json"
      }
    }
  );

  const text = await response.text();

  let data = {};

  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(
      `Supabase returned invalid JSON (HTTP ${response.status}).`
    );
  }

  if (!response.ok) {
    throw new Error(
      data?.message ||
      data?.hint ||
      data?.details ||
      `Supabase request failed (HTTP ${response.status}).`
    );
  }

  return data;
}


/* =========================================================
   HELPERS
   ========================================================= */

function clean(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase();
}


function normalizeName(value) {
  return clean(value)
    .replace(/[^a-z0-9]+/g, "");
}


function getServiceId(service) {
  return (
    service?.id ??
    service?.serviceId ??
    service?.service_id ??
    service?.serviceCountryPriceId ??
    service?.service_country_price_id ??
    null
  );
}


function getServiceName(service) {
  return (
    service?.name ??
    service?.serviceName ??
    service?.service_name ??
    service?.title ??
    service?.service ??
    ""
  );
}


function getServiceCode(service) {
  return (
    service?.code ??
    service?.serviceCode ??
    service?.service_code ??
    service?.slug ??
    ""
  );
}


/* =========================================================
   LOAD SERVICES FROM ONE PROVIDER
   ========================================================= */

async function getProviderServices(
  server,
  countryId
) {
  try {
    const data =
      await
