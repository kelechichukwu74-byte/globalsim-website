import { buyNumberRequest } from "./_lib.js";

export default async function handler(req, res) {
  try {
    if (req.method !== "GET") {
      return res.status(405).json({
        success: false,
        error: "Method not allowed"
      });
    }

    const {
      service,
      country,
      max_price
    } = req.query;

    if (!service || !country) {
      return res.status(400).json({
        success: false,
        error: "Service and country are required"
      });
    }

    const params = {
      action: "newNumber",
      service,
      country
    };

    if (max_price !== undefined) {
      params.max_price = max_price;
    }

    const data = await buyNumberRequest(
      "/activation-numbers",
      params
    );

    return res.status(200).json({
      success: true,
      order: data?.data || null
    });

  } catch (error) {
    console.error("BuyNumber order error:", error);

    return res.status(500).json({
      success: false,
      error:
        error.message ||
        "Unable to purchase number"
    });
  }
}
