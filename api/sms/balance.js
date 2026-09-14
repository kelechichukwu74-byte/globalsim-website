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
      await sureVerificationRequest(
        "/balance"
      );

    return res.status(200).json({
      success: true,
      balance:
        data?.data?.balance ??
        data?.balance ??
        0
    });

  } catch (error) {

    console.error(
      "SureVerification balance error:",
      error
    );

    return res.status(500).json({
      success: false,
      error:
        error.message ||
        "Unable to load provider balance."
    });

  }

}
