const BASE_URL = "https://sureverifications.com/api/v1";

/* =========================================================
   SERVER SELECTION
========================================================= */

export function getServerForCountry(country) {
  const value = String(country || "")
    .trim()
    .toLowerCase();

  if (
    value === "us" ||
    value === "usa" ||
    value === "united states" ||
    value === "united states of america"
  ) {
    return "usa-server-2";
  }

  return "global-server-2";
}


/* =========================================================
   MULTIPLE SERVERS FOR COUNTRY
========================================================= */

export function getServersForCountry(country) {
  const value = String(country || "")
    .trim()
    .toLowerCase();

  if (
    value === "us" ||
    value === "usa" ||
    value === "united states" ||
    value === "united states of america"
  ) {
    /*
     * US NUMBERS:
     * Portal / USA Server 2 ONLY.
     *
     * Do NOT fall back to USA Server 1.
     */
    return ["usa-server-2"];
  }

  /*
   * Non-US numbers use the global servers.
   */
  return [
    "global-server-2",
    "global-server-1"
  ];
}


/* =========================================================
   SUREVERIFICATION REQUEST
========================================================= */

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

        "x-api-key":
          apiKey,

        ...(options.headers || {})
      },

      ...(options.body !== undefined
        ? {
            body:
              typeof options.body === "string"
                ? options.body
                : JSON.stringify(
                    options.body
                  )
          }
        : {})
    }
  );

  const text =
    await response.text();

  let data = {};

  try {
    data =
      text
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
      data?.detail ||
      data?.data?.message ||
      `SureVerification returned HTTP ${response.status}.`
    );
  }

  return data;
}
