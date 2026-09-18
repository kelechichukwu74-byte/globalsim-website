const BASE_URL = "https://sureverifications.com/api/v1";

export const SERVERS = {
  global: ["global-server-1", "global-server-2"],
  usa: ["usa-server-1", "usa-server-2"]
};

export function isUsaCountry(country) {
  const v = String(country || "").trim().toLowerCase();
  return ["us","usa","united states","united states of america","united_states","united-states"].includes(v);
}

export function getServersForCountry(country) {
  return isUsaCountry(country) ? [...SERVERS.usa] : [...SERVERS.global];
}

export function getServerForCountry(country) {
  return getServersForCountry(country)[0];
}

export async function sureVerificationRequest(path, options = {}) {
  const key = process.env.SUREVERIFICATION_API_KEY;
  if (!key) throw new Error("SUREVERIFICATION_API_KEY is not configured.");

  const response = await fetch(`${BASE_URL}${path}`, {
    method: options.method || "GET",
    headers: {
      Accept: "application/json",
      "x-api-key": key,
      ...(options.headers || {})
    },
    ...(options.body !== undefined ? { body: options.body } : {})
  });

  const text = await response.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; }
  catch { throw new Error(`SureVerification returned invalid JSON (HTTP ${response.status}).`); }

  if (!response.ok) {
    throw new Error(data?.message || data?.error || data?.details || `SureVerification returned HTTP ${response.status}.`);
  }
  return data;
}

export function quote(value) {
  return encodeURIComponent(String(value ?? ""));
}

export function extractProviderPrice(data) {
  const candidates = [
    data?.price, data?.amount,
    data?.data?.price, data?.data?.amount,
    data?.providerResponse?.price, data?.providerResponse?.amount,
    data?.providerResponse?.data?.price, data?.providerResponse?.data?.amount
  ];
  for (const value of candidates) {
    const n = Number(value);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return null;
}

export function getVerification(data) {
  return data?.verification || data?.data?.verification || data?.data || data;
}

export function getVerificationId(data) {
  const v = getVerification(data);
  return v?.request_id ?? v?.requestId ?? v?.verification_id ?? v?.verificationId ?? v?.id ?? null;
}

export function getPhoneNumber(data) {
  const v = getVerification(data);
  return v?.number ?? v?.phone_number ?? v?.phoneNumber ?? v?.phone ?? null;
}
