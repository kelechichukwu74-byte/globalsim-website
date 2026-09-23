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

    const rawCountries =
      Array.isArray(data)
        ? data
        : Array.isArray(data?.countries)
          ? data.countries
          : Array.isArray(data?.data)
            ? data.data
            : Array.isArray(data?.providerResponse?.countries)
              ? data.providerResponse.countries
              : Array.isArray(data?.providerResponse?.data)
                ? data.providerResponse.data
                : [];

    const countries = rawCountries.map((country) => {
      const id =
        country.id ??
        country.country_id ??
        country.countryId;

      const name =
        country.name ??
        country.country_name ??
        country.countryName ??
        String(id);

      const code =
        country.code ??
        country.country_code ??
        country.countryCode ??
        "";

      const normalizedCode = String(code).trim().toUpperCase();
      const normalizedName = String(name).trim().toLowerCase();

      /*
       * USA MUST use USA Server 2.
       * All other countries use Global Server 2.
       */
      const isUSA =
        normalizedCode === "US" ||
        normalizedCode === "USA" ||
        normalizedName === "united states" ||
        normalizedName === "united states of america";

      const server = isUSA
        ? "usa-server-2"
        : "global-server-2";

      return {
        ...country,
        id,
        name,
        code,
        server
      };
    });

    return res.status(200).json({
      success: true,
      countries
    });

  } catch (error) {
    console.error("SureVerification countries error:", error);

    return res.status(500).json({
      success: false,
      error:
        error?.message ||
        "Unable to load countries."
    });
  }
}
