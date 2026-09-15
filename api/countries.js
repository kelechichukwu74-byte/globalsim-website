import { sureVerificationRequest } from "./_lib.js";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({
      success: false,
      error: "Method not allowed"
    });
  }

  try {
    const data = await sureVerificationRequest("/countries");

    return res.status(200).json({
      success: true,
      providerResponse: data
    });

  } catch (error) {
    console.error("COUNTRIES ERROR:", error);

    return res.status(500).json({
      success: false,
      error: error?.message || "Unable to load countries.",
      details: error?.stack || null
    });
  }
}
