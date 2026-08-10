import { smsVirtualRequest } from "./_lib.js";

export default async function handler(req, res) {
  try {
    if (req.method !== "GET") {
      return res.status(405).json({
        success: false,
        error: "Method not allowed"
      });
    }

    const { id } = req.query || {};

    if (!id) {
      return res.status(400).json({
        success: false,
        error: "Activation ID is required"
      });
    }

    const data = await smsVirtualRequest(
      `/v1/public/orders/getStatus/${encodeURIComponent(id)}`
    );

    return res.status(200).json(data);

  } catch (error) {
    console.error(
      "Status API error:",
      error
    );

    return res.status(500).json({
      success: false,
      error:
        error.message ||
        "Unable to get activation status"
    });
  }
}
