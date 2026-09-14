const BASE_URL = "https://sureverifications.com/api/v1";

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
      data.message ||
      data.error ||
      `SureVerification returned HTTP ${response.status}`
    );
  }

  return data;
}
