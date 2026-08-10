import { smsVirtualRequest } from "./_lib.js";

export default async function handler(req, res) {
  try {
    if (req.method !== "GET") {
      return res.status(405).json({
        success: false,
        error: "Method not allowed"
      });
    }

    const countryId =
      req.query?.countryId;

    if (!countryId) {
      return res.status(400).json({
        success: false,
        error: "countryId is required"
      });
    }

    const data =
      await smsVirtualRequest(
        `/v1/public/services/list?countryId=${encodeURIComponent(countryId)}`
      );

    return res.status(200).json(data);

  } catch (error) {

    console.error(
      "Prices API error:",
      error
    );

    return res.status(500).json({
      success: false,
      error:
        error.message ||
        "Unable to load prices"
    });
  }
}
