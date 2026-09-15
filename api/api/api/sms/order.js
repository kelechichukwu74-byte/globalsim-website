import {
  sureVerificationRequest,
  getServerForCountry
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
      countryId,
      service
    } = req.body || {};

    if (!countryId) {
      return res.status(400).json({
        success: false,
        error: "countryId is required"
      });
    }

    if (!service) {
      return res.status(400).json({
        success: false,
        error: "service is required"
      });
    }

    const server =
      getServerForCountry(countryId);

    const data =
      await sureVerificationRequest(
        `/${server}/purchase?country_id=${encodeURIComponent(countryId)}&service=${encodeURIComponent(service)}`,
        {
          method: "POST"
        }
      );

    const verification =
      data?.verification || null;

    return res.status(200).json({
      success: true,
      server,
      verification,
      data
    });

  } catch (error) {
    console.error(
      "SureVerification purchase error:",
      error
    );

    return res.status(500).json({
      success: false,
      error:
        error.message ||
        "Unable to purchase number."
    });
  }
}
