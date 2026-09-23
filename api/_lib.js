const BASE_URL = "https://sureverifications.com/api/v1";

function normalizeCountry(country) {
  return String(country || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

export function isUSA(country) {
  const value = normalizeCountry(country);

  return [
    "us",
    "usa",
    "united states",
    "united states of america"
  ].includes(value);
}

/*
 * SERVER ROUTING
 *
 * USA:
 *   Portal 2 -> USA Server 2
 *
 * Other countries:
 *   Portal 2 -> Global Server 2
 *   Portal 1 -> Global Server 1
 *
 * SureVerification documents Global Server 1 and
 * Global Server 2 as supporting international countries,
 * while USA Server 2 is USA-only.
 */

export function getServerForCountry(country) {
  if (isUSA(country)) {
    return "usa-server-2";
  }

  return "global-server-2";
}

export function getServersForCountry(country) {
  if (isUSA(country)) {
    return [
      "usa-server-2"
    ];
  }

  return [
    "global-server-2",
    "global-server-1"
  ];
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
      method:
        options.method || "GET",

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

  const responseText =
    await response.text();

  let data = {};

  try {
    data =
      responseText
        ? JSON.parse(responseText)
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
      data?.details ||
      `SureVerification returned HTTP ${response.status}.`
    );
  }

  return data;
}
