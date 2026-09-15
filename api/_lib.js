const BASE_URL = "https://sureverifications.com/api/v1";

export function getServerForCountry(country) {
  const value = String(country || "").toLowerCase();

  // United States
  if (
    value === "us" ||
    value === "usa" ||
    value === "united states" ||
    value === "united states of america"
  ) {
    return "usa-server-1";
  }

  // All other countries
  return "global-server-1";
}

export async function sureVerificationRequest(
  path,
  options = {}
) {
  const apiKey =
    process.env.SUREVERIFICATION_API_KEY;

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
        ? {
            body: options.body
          }
        : {})
    }
  );

  const text =
    await response.text();

  let data = {};

  try {
    data = text
      ? JSON.parse(text)
      : {};
  } catch {
    throw new Error(
      `SureVerification returned invalid JSON (HTTP ${response.status}).`
    );
  }

  if (!response.ok) {
    throw new Error(
      data?.message ||
      data?.error ||
      `SureVerification returned HTTP ${response.status}.`
    );
  }

  return data;
}
