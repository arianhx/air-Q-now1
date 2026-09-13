# Air Q Now

A polished single-page app that shows a city’s air quality using the OpenWeather Geocoding and Air Pollution APIs.

## Files

- `index.html` — page structure and API key modal
- `styles.css` — modern UI and AQI-colored backgrounds
- `app.js` — key storage, search, and API calls (vanilla JS)

## Run

No build step. Open `index.html` in a browser, or serve the folder statically:

```bash
npx serve .
# or: python3 -m http.server 8080
```

## Setup

1. Get a free API key from [OpenWeather](https://openweathermap.org/api).
2. On first load, enter the key in the modal (saved in `localStorage`).
3. Search for a city to see AQI (1–5) and pollutant components.

Use **Change API key** in the header to update the stored key.
