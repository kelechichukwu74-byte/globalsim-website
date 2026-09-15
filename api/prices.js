import {
  sureVerificationRequest,
  getServerForCountry
} from "./_lib.js";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({
      success: false,
      error: "Method not allowed"
    });
  }

  try {
    const {
      countryId,
      service
    } = req.query || {};

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
        `/${server}/price?country_id=${encodeURIComponent(countryId)}&service=${encodeURIComponent(service)}`
      );

    return res.status(200).json({
      success: true,
      server,
      price:
        data?.price ??
        data?.data?.price ??
        null,
      data
    });

  } catch (error) {
    console.error(
      "SureVerification price error:",
      error
    );

    return res.status(500).json({
      success: false,
      error:
        error.message ||
        "Unable to load price."
    });
  }
}
