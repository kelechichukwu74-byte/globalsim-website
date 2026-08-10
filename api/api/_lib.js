const BASE_URL = "https://api.buynumber.io/v1";

export async function buyNumberRequest(
  path,
  params = {}
) {
  const apiKey = process.env.BUYNUMBER_API_KEY;

  if (!apiKey) {
    throw new Error(
      "BUYNUMBER_API_KEY is not configured in Vercel."
    );
  }

  const searchParams = new URLSearchParams({
    api_key: apiKey,
    ...params
  });

  const response = await fetch(
    `${BASE_URL}${path}?${searchParams.toString()}`,
    {
      method: "GET",
      headers: {
        "Accept": "application/json"
      }
    }
  );

  const text = await response.text();

  let data;

  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(
      text || "Invalid BuyNumber response"
    );
  }

  if (!response.ok) {
    throw new Error(
      data.error ||
      data.message ||
      `BuyNumber returned HTTP ${response.status}`
    );
  }

  if (data.result !== "success") {
    throw new Error(
      data.error ||
      data.message ||
      "BuyNumber request failed"
    );
  }

  return data;
}
