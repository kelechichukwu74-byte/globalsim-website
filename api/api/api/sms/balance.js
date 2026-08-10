import { smsVirtualRequest } from "./_lib.js";

export default async function handler(req, res) {
  try {
    if (req.method !== "GET") {
      return res.status(405).json({
        success: false,
        error: "Method not allowed"
      });
    }

    const data =
      await smsVirtualRequest(
        "/v1/user/balance"
      );

    return res.status(200).json(data);

  } catch (error) {

    console.error(
      "Balance API error:",
      error
    );

    return res.status(500).json({
      success: false,
      error:
        error.message ||
        "Unable to load balance"
    });
  }
}
