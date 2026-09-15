const BASE_URL = "https://sureverifications.com/api/v1";

export async function sureVerificationRequest(path, options = {}) {
  const apiKey = process.env.SUREVERIFICATION_API_KEY;

  if (!apiKey) {
    throw new Error("SUREVERIFICATION_API_KEY is missing");
  }

  const response = await fetch(`${BASE_URL}${path}`, {
    method: options.method || "GET",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      ...(options.headers || {})
    },
    body: options.body
  });

  const text = await response.text();

  if (!response.ok) {
    throw new Error(
      `SureVerification HTTP ${response.status}: ${text}`
    );
  }

  try {
    return text ? JSON.parse(text) : {};
  } catch {
    throw new Error(
      `SureVerification returned invalid JSON: ${text}`
    );
  }
}
