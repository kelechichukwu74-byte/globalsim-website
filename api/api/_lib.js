const BASE_URL = "https://sureverifications.com/api/v1";

export function getServerForCountry(countryId) {
  // The USA uses the USA server.
  // Everything else uses Global Server 1.
  const normalized = String(countryId || "").trim().toLowerCase();

  const isUSA =
    normalized === "usa" ||
    normalized === "us" ||
    normalized === "united states" ||
    normalized === "236";

  return isUSA ? "usa-server-1" : "global-server-1";
}

export async function sureVerificationRequest(
  path,
  options = {}
) {
  const apiKey = process.env.SUREVERIFICATION_API_KEY;

  if (!apiKey) {
    throw new Error(
      "SUREVERIFICATION_API_KEY is not configured in Vercel."
    );
  }

  const response = await fetch(
    `${BASE_URL}${path}`,
    {
      ...options,
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        ...(options.headers || {})
      }
    }
  );

  const text = await response.text();

  let data = {};

  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(
      text || "Invalid SureVerification response."
    );
  }

  if (!response.ok) {
    throw new Error(
      data?.message ||
      data?.error ||
      `SureVerification returned HTTP ${response.status}`
    );
  }

  return data;
}
