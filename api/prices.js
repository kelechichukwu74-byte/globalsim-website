import { buyNumberRequest } from "./_lib.js";

export default async function handler(req, res) {
  try {
    if (req.method !== "GET") {
      return res.status(405).json({
        success: false,
        error: "Method not allowed"
      });
    }

    const { service, all_prices } = req.query;

    if (!service) {
      return res.status(400).json({
        success: false,
        error: "Service is required"
      });
    }

    const data = await buyNumberRequest(
      "/activation-numbers",
      {
        action: "getTopCountriesByService",
        service,
        all_prices:
          all_prices === "true"
            ? "true"
            : "false"
      }
    );

    return res.status(200).json({
      success: true,
      prices: data?.data || []
    });

  } catch (error) {
    console.error("BuyNumber prices error:", error);

    return res.status(500).json({
      success: false,
      error:
        error.message ||
        "Unable to load prices"
    });
  }
}
