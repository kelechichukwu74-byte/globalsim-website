import {
  sureVerificationRequest
} from "./_lib.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({
      success: false,
      error: "Method not allowed"
    });
  }

  try {
    const {
      serviceCountryPriceId,
      operatorId,
      quantity,
      autoSearchServer
    } = req.body || {};

    if (!serviceCountryPriceId) {
      return res.status(400).json({
        success: false,
        error:
          "serviceCountryPriceId is required"
      });
    }

    const body = {
      serviceCountryPriceId:
        String(serviceCountryPriceId)
    };

    if (operatorId) {
      body.operatorId = String(operatorId);
    }

    if (quantity) {
      body.quantity = Number(quantity);
    }

    if (autoSearchServer !== undefined) {
      body.autoSearchServer =
        Boolean(autoSearchServer);
    }

    const data =
      await sureVerificationRequest(
        "/orders/request-single-service",
        {
          method: "POST",

          headers: {
            "Content-Type":
              "application/json",

            "Idempotency-Key":
              crypto.randomUUID()
          },

          body: JSON.stringify(body)
        }
      );

    return res.status(200).json({
      success: true,
      data
    });

  } catch (error) {
    console.error(
      "SureVerification order error:",
      error
    );

    return res.status(500).json({
      success: false,
      error:
        error.message ||
        "Unable to create order."
    });
  }
}
