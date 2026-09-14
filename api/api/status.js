import {
  sureVerificationRequest
} from "../_lib.js";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({
      success: false,
      error: "Method not allowed"
    });
  }

  try {
    const id = req.query?.id;

    if (!id) {
      return res.status(400).json({
        success: false,
        error: "Order ID is required"
      });
    }

    const data =
      await sureVerificationRequest(
        `/orders/getStatus/${encodeURIComponent(id)}`
      );

    return res.status(200).json({
      success: true,
      data
    });

  } catch (error) {
    console.error(
      "SureVerification status error:",
      error
    );

    return res.status(500).json({
      success: false,
      error:
        error.message ||
        "Unable to retrieve order status."
    });
  }
}
