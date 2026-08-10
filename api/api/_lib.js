const BASE_URL = "https://api.sms-virtual.net";

export async function smsVirtualRequest(
  path,
  options = {}
) {
  const apiKey = process.env.SMSVIRTUAL_API_KEY;

  if (!apiKey) {
    throw new Error(
      "SMSVIRTUAL_API_KEY is not configured in Vercel."
    );
  }

  const response = await fetch(
    `${BASE_URL}${path}`,
    {
      method: options.method || "GET",

      headers: {
        "x-api-key": apiKey,

        "Content-Type":
          "application/json",

        ...(options.headers || {})
      },

      body:
        options.body !== undefined
          ? JSON.stringify(options.body)
          : undefined
    }
  );

  const text = await response.text();

  let data;

  try {
    data = text
      ? JSON.parse(text)
      : {};
  } catch {
    data = {
      success: false,
      error: text || "Invalid provider response"
    };
  }

  if (!response.ok) {
    throw new Error(
      data.error ||
      data.message ||
      `SMS Virtual returned HTTP ${response.status}`
    );
  }

  if (
    data.success === false
  ) {
    throw new Error(
      data.error ||
      data.message ||
      "SMS Virtual request failed"
    );
  }

  return data;
}
