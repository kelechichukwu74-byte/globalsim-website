const BASE_URL = "https://sureverifications.com/api/v1";

export const SURE_VERIFICATION_SERVERS = {
  global: ["global-server-1", "global-server-2"],
  usa: ["usa-server-1", "usa-server-2"]
};

export function isUsaCountry(country) {
  const value = String(country || "").trim().toLowerCase();
  return [
    "us",
    "usa",
    "united states",
    "united states of america",
    "united_states",
    "united-states"
  ].includes(value);
}

export function getServersForCountry(country) {
  return isUsaCountry(country)
    ? [...SURE_VERIFICATION_SERVERS.usa]
    : [...SURE_VERIFICATION_SERVERS.global];
}

export function getServerForCountry(country) {
  return getServersForCountry(country)[0];
}

export async function sureVerificationRequest(path, options = {}) {
  const apiKey = process.env.SUREVERIFICATION_API_KEY;

  if (!apiKey) {
    throw new Error("SUREVERIFICATION_API_KEY is not configured.");
  }

  const response = await fetch(`${BASE_URL}${path}`, {
    method: options.method || "GET",
    headers: {
      Accept: "application/json",
      "x-api-key": apiKey,
      ...(options.headers || {})
    },
    ...(options.body !== undefined ? { body: options.body } : {})
  });

  const text = await response.text();
  let data = {};

  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(
      `SureVerification returned invalid JSON (HTTP ${response.status}).`
    );
  }

  if (!response.ok) {
    throw new Error(
      data?.message ||
      data?.error ||
      data?.details ||
      `SureVerification returned HTTP ${response.status}.`
    );
  }

  return data;
}
