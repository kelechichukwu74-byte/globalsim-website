const BASE_URL = "https://sureverifications.com/api/v1";

export const SERVERS = {
  USA: ["usa-server-2", "usa-server-1"],
  GLOBAL: ["global-server-1", "global-server-2"]
};

export function isUSA(country) {
  const value = String(country || "").trim().toLowerCase();

  return [
    "us",
    "usa",
    "united states",
    "united states of america"
  ].includes(value);
}

export function getServersForCountry(country) {
  return isUSA(country)
    ? SERVERS.USA
    : SERVERS.GLOBAL;
}

export async function sureVerificationRequest(path, options = {}) {
  const apiKey = process.env.SUREVERIFICATION_API_KEY;

  if (!apiKey) {
    throw new Error(
      "SUREVERIFICATION_API_KEY is not configured."
    );
  }

  const response = await fetch(
    `${BASE_URL}${path}`,
    {
      method: options.method || "GET",
      headers: {
        Accept: "application/json",
        "x-api-key": apiKey,
        ...(options.headers || {})
      },
      ...(options.body !== undefined
        ? { body: options.body }
        : {})
    }
  );

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
      data?.code ||
      `SureVerification returned HTTP ${response.status}.`
    );
  }

  return data;
}

export function quote(value) {
  return encodeURIComponent(String(value ?? ""));
}

export function getProviderPrice(data) {
  const candidates = [
    data?.price,
    data?.amount,
    data?.cost,
    data?.providerPrice,
    data?.provider_price,
    data?.data?.price,
    data?.data?.amount,
    data?.data?.cost,
    data?.data?.providerPrice,
    data?.data?.provider_price,
    data?.result?.price,
    data?.result?.amount,
    data?.result?.cost,
    data?.result?.providerPrice,
    data?.result?.provider_price
  ];

  for (const value of candidates) {
    const n = Number(value);

    if (Number.isFinite(n) && n > 0) {
      return n;
    }
  }

  return null;
}
