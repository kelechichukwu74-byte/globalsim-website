import { sureVerificationRequest } from "./_lib.js";

const SUPABASE_URL =
  process.env.SUPABASE_URL ||
  "https://rfitbmkizfmwfqqskwhy.supabase.co";

const SUPABASE_PUBLISHABLE_KEY =
  process.env.SUPABASE_PUBLISHABLE_KEY ||
  "sb_publishable_erjKhsDOoyhbjHDExvQ7RQ_gpGcK0C-";

const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY;

function getBearerToken(req) {
  const header =
    req.headers?.authorization ||
    req.headers?.Authorization ||
    "";

  if (!header.startsWith("Bearer ")) {
    return null;
  }

  return header.slice(7).trim() || null;
}

function supabaseHeaders(extra = {}) {
  return {
    apikey: SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    "Content-Type": "application/json",
    ...extra
  };
}

async function supabaseRequest(path, options = {}) {
  if (!SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY is not configured."
    );
  }

  const response = await fetch(
    `${SUPABASE_URL}/rest/v1${path}`,
    {
      method: options.method || "GET",
      headers: supabaseHeaders(
        options.headers || {}
      ),
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

  const text = await response.text();

  let data = null;

  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }

  if (!response.ok) {
    const message =
      data?.message ||
      data?.error ||
      data?.hint ||
      (typeof data === "string"
        ? data
        : `Supabase request failed with HTTP ${response.status}.`);

    throw new Error(message);
  }

  return data;
}

async function getAuthenticatedUser(req) {
  const accessToken = getBearerToken(req);

  if (!accessToken) {
    throw new Error("Unauthorized.");
  }

  const response = await fetch(
    `${SUPABASE_URL}/auth/v1/user`,
    {
      method: "GET",
      headers: {
        apikey: SUPABASE_PUBLISHABLE_KEY,
        Authorization: `Bearer ${accessToken}`
      }
    }
  );

  const text = await response.text();

  let data = null;

  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }

  if (!response.ok || !data?.id) {
    throw new Error("Unauthorized.");
  }

  return data;
}

function normalize(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function isUSA(
  countryId,
  countryCode,
  countryName
) {
  const values = [
    countryId,
    countryCode,
    countryName
  ]
    .filter(
      value =>
        value !== undefined &&
        value !== null
    )
    .map(value =>
      String(value)
        .trim()
        .toLowerCase()
    );

  return values.some(value =>
    [
      "us",
      "usa",
      "unitedstates",
      "united states",
      "united states of america",
      "unitedstatesofamerica"
    ].includes(value)
  );
}

function getArrayFromProvider(
  data,
  keys = []
) {
  if (Array.isArray(data)) {
    return data;
  }

  for (const key of keys) {
    if (Array.isArray(data?.[key])) {
      return data[key];
    }
  }

  if (Array.isArray(data?.data)) {
    return data.data;
  }

  if (Array.isArray(data?.data?.data)) {
    return data.data.data;
  }

  if (Array.isArray(data?.providerResponse)) {
    return data.providerResponse;
  }

  if (
    Array.isArray(
      data?.providerResponse?.services
    )
  ) {
    return data.providerResponse.services;
  }

  if (
    Array.isArray(
      data?.providerResponse?.data
    )
  ) {
    return data.providerResponse.data;
  }

  return [];
}

function getServiceId(service) {
  return (
    service?.id ??
    service?.service_id ??
    service?.serviceId ??
    service?.code ??
    service?.key ??
    null
  );
}

function getServiceName(service) {
  return (
    service?.name ??
    service?.service_name ??
    service?.serviceName ??
    service?.title ??
    service?.service ??
    ""
  );
}

function normalizeServiceName(value) {
  return normalize(value);
}

function getVerification(data) {
  if (!data) {
    return null;
  }

  if (data.verification) {
    return data.verification;
  }

  if (data.data?.verification) {
    return data.data.verification;
  }

  if (data.data) {
    return data.data;
  }

  return data;
}

function getVerificationId(
  verification
) {
  if (!verification) {
    return null;
  }

  return (
    verification.id ??
    verification.verification_id ??
    verification.verificationId ??
    null
  );
}

function getRequestId(
  verification
) {
  if (!verification) {
    return null;
  }

  return (
    verification.request_id ??
    verification.requestId ??
    null
  );
}

function getPhoneNumber(
  verification
) {
  if (!verification) {
    return null;
  }

  return (
    verification.number ??
    verification.phone_number ??
    verification.phoneNumber ??
    verification.phone ??
    null
  );
}

async function resolveProviderServiceId(
  server,
  countryId,
  requestedServiceId,
  requestedServiceName
) {
  const url =
    `/${server}/services?country_id=` +
    encodeURIComponent(countryId);

  console.log(
    "[order] Loading provider services:",
    url
  );

  const data =
    await sureVerificationRequest(url);

  const services =
    getArrayFromProvider(
      data,
      [
        "services",
        "results",
        "items"
      ]
    );

  if (!services.length) {
    throw new Error(
      `No services were returned by ${server} for country ${countryId}.`
    );
  }

  const requestedId =
    String(
      requestedServiceId ?? ""
    ).trim();

  const requestedName =
    normalizeServiceName(
      requestedServiceName
    );

  let match = null;

  if (requestedId) {
    match = services.find(service => {
      const providerId =
        String(
          getServiceId(service) ?? ""
        ).trim();

      return (
        providerId &&
        providerId === requestedId
      );
    });
  }

  if (!match && requestedName) {
    match = services.find(service => {
      return (
        normalizeServiceName(
          getServiceName(service)
        ) === requestedName
      );
    });
  }

  if (!match && requestedName) {
    match = services.find(service => {
      const providerName =
        normalizeServiceName(
          getServiceName(service)
        );

      return (
        providerName.includes(
          requestedName
        ) ||
        requestedName.includes(
          providerName
        )
      );
    });
  }

  if (!match) {
    throw new Error(
      `Service "${requestedServiceName || requestedServiceId}" is not available on ${server} for country ${countryId}.`
    );
  }

  const providerServiceId =
    getServiceId(match);

  if (
    providerServiceId === null ||
    providerServiceId === undefined ||
    String(providerServiceId).trim() === ""
  ) {
    throw new Error(
      `The provider returned a service without a valid service ID on ${server}.`
    );
  }

  return {
    id: String(providerServiceId),
    name: getServiceName(match),
    raw: match
  };
}
