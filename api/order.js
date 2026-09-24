let result;
let selectedProviderService = null;

if (isUnitedStates) {
  // USA MUST use USA Server 2
  selectedProviderService = await providerService(
    "usa-server-2",
    countryId,
    internalServiceId,
    serviceNameValue
  );

  result = await sureVerificationRequest(
    `/usa-server-2/purchase?country_id=${enc(
      countryId
    )}&service=${enc(
      selectedProviderService.id
    )}`,
    {
      method: "POST"
    }
  );
} else {
  // GLOBAL SERVER 2
  // Its documented purchase endpoint does NOT
  // use country_id or service query parameters.
  result = await sureVerificationRequest(
    "/global-server-2/purchase",
    {
      method: "POST"
    }
  );
}

const phone =
  result?.verification?.number ||
  null;

const providerVerificationId =
  result?.verification?.request_id ||
  null;

const providerServiceName =
  result?.verification?.service ||
  serviceNameValue ||
  null;

if (!phone) {
  throw new Error(
    "Provider did not return a phone number."
  );
}

if (!providerVerificationId) {
  throw new Error(
    "Provider did not return a verification ID."
  );
}
