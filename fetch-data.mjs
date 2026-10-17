import { writeFile } from "node:fs/promises";

const beaches = {
    Gwithian: {
        latitude: 50.17218,
        longitude: -5.12122
    },
    Maenporth: {
        latitude: 50.12243,
        longitude: -5.09310
    },
    Sidmouth: {
        latitude: 50.68227,
        longitude: -3.23840
    },
    Woolacombe: {
        latitude: 51.17223,
        longitude: -4.20599
    }
};

// Weather fields to request.
const weatherVariables = [
    "temperature_2m",
    "apparent_temperature",
    "precipitation_probability",
    "precipitation",
    "weather_code",
    "cloud_cover",
    "wind_speed_10m",
    "wind_direction_10m",
    "wind_gusts_10m",
    "uv_index"
];

// Marine fields to request.
const marineVariables = [
    "wave_height",
    "wave_direction",
    "wave_period",
    "wind_wave_height",
    "wind_wave_direction",
    "wind_wave_period",
    "swell_wave_height",
    "swell_wave_direction",
    "swell_wave_period",
    "sea_surface_temperature"
];

// Make an API request and check for errors.
async function fetchJson(endpoint, parameters, label) {
    const url = new URL(endpoint);
    url.search = new URLSearchParams(parameters).toString();

    const response = await fetch(url, {
        signal: AbortSignal.timeout(30000)
    });

    if (!response.ok) {
        const details = await response.text();
        throw new Error(
            `${label} failed: HTTP ${response.status} — ${details}`
        );
    }

    const data = await response.json();

    if (data.error) {
        throw new Error(`${label} failed: ${data.reason}`);
    }

    return data;
}

const results = {};

for (const [name, coordinates] of Object.entries(beaches)) {
    console.log(`Fetching weather and marine data for ${name}...`);

    const commonParameters = {
        latitude: coordinates.latitude,
        longitude: coordinates.longitude,
        timezone: "Europe/London",
        forecast_days: 7
    };

    // Fetch both forecasts for this beach together.
    const [weather, marine] = await Promise.all([
        fetchJson(
            "https://api.open-meteo.com/v1/forecast",
            {
                ...commonParameters,
                hourly: weatherVariables.join(","),
                temperature_unit: "celsius",
                wind_speed_unit: "mph",
                precipitation_unit: "mm"
            },
            `${name} weather`
        ),
        fetchJson(
            "https://marine-api.open-meteo.com/v1/marine",
            {
                ...commonParameters,
                hourly: marineVariables.join(","),
                length_unit: "metric",
                cell_selection: "sea"
            },
            `${name} marine`
        )
    ]);

    // Keep both full API responses under the beach name.
    results[name] = {
        ...coordinates,
        weather,
        marine
    };

    console.log(`${name} completed.`);
}

// Only replace the JSON file after every request succeeds.
const output = {
    updated_at: new Date().toISOString(),
    beaches: results
};

await writeFile(
    "api-data.json",
    JSON.stringify(output, null, 2) + "\n",
    "utf8"
);


// Image generation

console.log("api-data.json updated successfully for all beaches.");
