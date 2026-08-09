export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({
      success: false,
      error: "Method not allowed"
    });
  }

  try {
    const { pricing_id } = req.body || {};

    if (!pricing_id) {
      return res.status(400).json({
        success: false,
        error: "pricing_id is required"
      });
    }

    const apiKey = process.env.RENTNUMBER_API_KEY;

    if (!apiKey) {
      return res.status(500).json({
        success: false,
        error: "RENTNUMBER_API_KEY is not configured"
      });
    }

    const response = await fetch("https://rentnumber.net/api/v1/rent", {
      method: "POST",
      headers: {
        "X-API-KEY": apiKey,
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: new URLSearchParams({
        pricing_id: String(pricing_id)
      })
    });

    const data = await response.json();

    return res.status(response.status).json(data);
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: "Unable to contact number provider"
    });
  }
}
