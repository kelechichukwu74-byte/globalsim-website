import {
  sureVerificationRequest
} from "./_lib.js";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({
      success: false,
      error: "Method not allowed"
    });
  }

  try {
    const data =
      await sureVerificationRequest("/countries");

    const countries =
      Array.isArray(data?.countries)
        ? data.countries
        : Array.isArray(data?.data)
          ? data.data
          : Array.isArray(data)
            ? data
            : [];

    return res.status(200).json({
      success: true,
      countries
    });

  } catch (error) {
    console.error(
      "SureVerification countries error:",
      error
    );

    return res.status(500).json({
      success: false,
      error:
        error.message ||
        "Unable to load countries."
    });
  }
}
