export default async function handler(req, res) {
  try {
    const { country_id } = req.query;

    let url = "https://rentnumber.net/api/v1/services/whatsapp/prices";

    if (country_id) {
      url += "?country_id=" + encodeURIComponent(country_id);
    }

    const response = await fetch(url);
    const data = await response.json();

    res.status(200).json(data);
  } catch (error) {
    res.status(500).json({
      success: false,
      error: "Unable to load WhatsApp prices"
    });
  }
}
