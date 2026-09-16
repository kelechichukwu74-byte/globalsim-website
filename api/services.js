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
    const countryId = req.query?.countryId;
    const requestedServer = req.query?.server;

    if (!countryId) {
      return res.status(400).json({
        success: false,
        error: "countryId is required"
      });
    }

    const server =
      requestedServer ||
      getServerForCountry(countryId);

    // Only request the service list.
    // Do NOT request the price for every service here.
    const data = await sureVerificationRequest(
      `/${server}/services?country_id=${encodeURIComponent(
        countryId
      )}`
    );

    const rawServices =
      Array.isArray(data?.services)
        ? data.services
        : Array.isArray(data?.data)
          ? data.data
          : Array.isArray(data)
            ? data
            : [];

    const services = rawServices.map(service => {
      const serviceId =
        service.id ??
        service.serviceId ??
        service.service_id ??
        service.serviceCountryPriceId ??
        service.service_country_price_id;

      const serviceName =
        service.name ??
        service.serviceName ??
        service.service_name ??
        service.title ??
        String(serviceId || "");

      return {
        ...service,
        id: serviceId,
        name: serviceName
      };
    });

    return res.status(200).json({
      success: true,
      server,
      services
    });

  } catch (error) {
    console.error(
      "SureVerification services error:",
      error
    );

    return res.status(500).json({
      success: false,
      error:
        error?.message ||
        "Unable to load services."
    });
  }
}
