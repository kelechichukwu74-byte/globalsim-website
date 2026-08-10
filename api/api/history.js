import { smsVirtualRequest } from "./_lib.js";

export default async function handler(req, res) {
  try {
    if (req.method !== "GET") {
      return res.status(405).json({
        success: false,
        error: "Method not allowed"
      });
    }

    const page =
      req.query?.page || "1";

    const pageSize =
      req.query?.pageSize || "50";

    const params = new URLSearchParams({
      page: String(page),
      pageSize: String(pageSize)
    });

    if (req.query?.startDate) {
      params.set(
        "startDate",
        req.query.startDate
      );
    }

    if (req.query?.endDate) {
      params.set(
        "endDate",
        req.query.endDate
      );
    }

    const data =
      await smsVirtualRequest(
        `/v1/public/orders/history-activation?${params.toString()}`
      );

    return res.status(200).json(data);

  } catch (error) {
    console.error(
      "History API error:",
      error
    );

    return res.status(500).json({
      success: false,
      error:
        error.message ||
        "Unable to load purchase history"
    });
  }
}
