import { buyNumberRequest } from "./_lib.js";

export default async function handler(req, res) {
  try {
    if (req.method !== "GET") {
      return res.status(405).json({
        success: false,
        error: "Method not allowed"
      });
    }

    const { id } = req.query;

    if (!id) {
      return res.status(400).json({
        success: false,
        error: "Number ID is required"
      });
    }

    const data = await buyNumberRequest(
      "/activation-numbers",
      {
        action: "getSms",
        id
      }
    );

    return res.status(200).json({
      success: true,
      sms: data?.data || {}
    });

  } catch (error) {
    console.error("BuyNumber status error:", error);

    return res.status(500).json({
      success: false,
      error:
        error.message ||
        "Unable to retrieve SMS"
    });
  }
}
