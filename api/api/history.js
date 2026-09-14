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
    const data =
      await sureVerificationRequest(
        "/orders"
      );

    return res.status(200).json({
      success: true,
      data
    });

  } catch (error) {
    console.error(
      "SureVerification history error:",
      error
    );

    return res.status(500).json({
      success: false,
      error:
        error.message ||
        "Unable to load order history."
    });
  }
}
