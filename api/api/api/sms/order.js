import { smsVirtualRequest } from "./_lib.js";

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      return res.status(405).json({
        success: false,
        error: "Method not allowed"
      });
    }

    const {
      serviceCountryPriceId,
      operatorId,
      quantity = 1,
      autoSearchServer = false
    } = req.body || {};

    if (!serviceCountryPriceId) {
      return res.status(400).json({
        success: false,
        error: "serviceCountryPriceId is required"
      });
    }

    const body = {
      serviceCountryPriceId,
      quantity,
      autoSearchServer
    };

    if (operatorId) {
      body.operatorId = operatorId;
    }

    const data = await smsVirtualRequest(
      "/v1/orders/request-single-service",
      {
        method: "POST",
        body
      }
    );

    return res.status(200).json(data);

  } catch (error) {

    console.error(
      "Order API error:",
      error
    );

    return res.status(500).json({
      success: false,
      error:
        error.message ||
        "Unable to purchase number"
    });
  }
}
