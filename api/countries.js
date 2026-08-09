export default async function handler(req, res) {
  try {
    const response = await fetch(
      "https://rentnumber.net/api/v1/countries"
    );

    const data = await response.json();

    res.status(200).json(data);
  } catch (error) {
    res.status(500).json({
      success: false,
      error: "Unable to load countries"
    });
  }
}
