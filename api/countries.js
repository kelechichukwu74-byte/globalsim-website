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
      req.query?.pageSize || "206";

    const data =
      await smsVirtualRequest(
        `/v1/public/country/list?page=${encodeURIComponent(page)}&pageSize=${encodeURIComponent(pageSize)}`
      );

    return res.status(200).json(data);

  } catch (error) {

    console.error(
      "Countries API error:",
      error
    );

    return res.status(500).json({
      success: false,
      error:
        error.message ||
        "Unable to load countries"
    });
  }
}
