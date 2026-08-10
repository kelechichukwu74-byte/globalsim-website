import { buyNumberRequest } from "./_lib.js";

export default async function handler(req, res) {
  try {
    if (req.method !== "GET") {
      return res.status(405).json({
        success: false,
        error: "Method not allowed"
      });
    }

    const data = await buyNumberRequest(
      "/account",
      {
        action: "getBalance"
      }
    );

    return res.status(200).json({
      success: true,
      balance: data?.data?.balance ?? "0"
    });

  } catch (error) {
    console.error("BuyNumber balance error:", error);

    return res.status(500).json({
      success: false,
      error:
        error.message ||
        "Unable to load BuyNumber balance"
    });
  }
}
