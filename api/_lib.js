const BASE_URL = "https://sureverifications.com/api/v1";

/*
  SureVerification servers

  Global servers:
  - global-server-1
  - global-server-2

  USA servers:
  - usa-server-1
  - usa-server-2
*/

export const SURE_VERIFICATION_SERVERS = {
  global: [
    "global-server-1",
    "global-server-2"
  ],

  usa: [
    "usa-server-1",
    "usa-server-2"
  ]
};


/*
  Detect whether the selected country is the USA.
*/
export function isUsaCountry(country) {
  const value =
    String(country || "")
      .trim()
      .toLowerCase();

  return (
    value === "us" ||
    value === "usa" ||
    value === "united states" ||
    value === "united states of america" ||
    value === "united_states" ||
    value === "united-states"
  );
}


/*
  Return all servers that can be used for
  the selected country.

  IMPORTANT:
  This does NOT purchase anything.

  It simply gives the other API files
  the correct four-server list.
*/
export function getServersForCountry(country) {
  if (isUsaCountry(country)) {
    return [
      ...SURE_VERIFICATION_SERVERS.usa
    ];
  }

  return [
    ...SURE_VERIFICATION_SERVERS.global
  ];
}


/*
  Backwards-compatible helper.

  Existing API files that still call
  getServerForCountry() will continue working.
*/
export function getServerForCountry(country) {
  return getServersForCountry(country)[0];
}


/*
  Call SureVerification.
*/
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

  const response =
    await fetch(
      `${BASE_URL}${path}`,
      {
        method:
          options.method || "GET",

        headers: {
          Accept:
            "application/json",

          "x-api-key":
            apiKey,

          ...(options.headers || {})
        },

        ...(options.body !== undefined
          ? {
              body:
                options.body
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
      data?.details ||
      `SureVerification returned HTTP ${response.status}.`
    );
  }

  return data;
}
