const BASE_URL = "https://sureverifications.com/api/v1";

function normalizeCountry(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

export function isUSA(country) {
  const value = normalizeCountry(country);

  return (
    value === "us" ||
    value === "usa" ||
    value === "united states" ||
    value === "united states of america" ||
    value === "united states of america (usa)"
  );
}

/*
 * The provider's documented API does not expose a URL such as:
 *
 *   /usa-server-2/purchase
 *
 * Server selection is handled by the provider through the
 * selected serviceCountryPriceId and autoSearchServer.
 *
 * We keep these helpers for compatibility with the rest of
 * your project, but we do NOT construct fake provider URLs.
 */
export function getServerForCountry(country) {
  return isUSA(country)
    ? "usa-server-2"
    : "global-server-2";
}

export function getServersForCountry(country) {
  return isUSA(country)
    ? ["usa-server-2"]
    : ["global-server-2", "global-server-1"];
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

  const requestPath =
    String(path || "").trim();

  if (!requestPath.startsWith("/")) {
    throw new Error(
      "SureVerification API path must start with '/'."
    );
  }

  const headers = {
    Accept: "application/json",
    "x-api-key": apiKey,
    ...(options.headers || {})
  };

  if (
    options.body !== undefined &&
    !headers["Content-Type"]
  ) {
    headers["Content-Type"] =
      "application/json";
  }

  const response = await fetch(
    `${BASE_URL}${requestPath}`,
    {
      method:
        options.method || "GET",
      headers,
      ...(options.body !== undefined
        ? {
            body:
              typeof options.body === "string"
                ? options.body
                : JSON.stringify(options.body)
          }
        : {})
    }
  );

  const responseText =
    await response.text();

  let data = {};

  try {
    data = responseText
      ? JSON.parse(responseText)
      : {};
  } catch {
    throw new Error(
      `SureVerification returned invalid JSON (HTTP ${response.status}).`
    );
  }

  if (!response.ok) {
    const errorCode =
      data?.error || "";

    const message =
      data?.message ||
      data?.error ||
      data?.details ||
      `SureVerification returned HTTP ${response.status}.`;

    const error =
      new Error(String(message));

    error.status =
      response.status;

    error.code =
      errorCode;

    error.providerResponse =
      data;

    throw error;
  }

  return data;
}
