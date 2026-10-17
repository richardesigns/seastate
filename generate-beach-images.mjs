import {
    readFile,
    writeFile,
    rename,
    mkdir,
    stat
} from "node:fs/promises";

const API_KEY = process.env.PRIVATE_API_KEY;

if (!API_KEY) {
    throw new Error(
        "Add your Magnific API key as PRIVATE_API_KEY."
    );
}

const API_URL = "https://api.magnific.com/v1/ai/mystic";
const STATE_FILE = "beach-images.json";
const HOURS = ["09:00", "12:00", "15:00", "18:00"];

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

const profiles = {
    Gwithian: [
        "gwithian",
        "Gwithian, Cornwall: a broad sandy beach and dunes on St Ives Bay."
    ],
    Maenporth: [
        "maenporth",
        "Maenporth near Falmouth, Cornwall: a small sandy cove."
    ],
    Sidmouth: [
        "sidmouth",
        "Sidmouth, Devon: a shingle beach with distinctive red coastal cliffs."
    ],
    Woolacombe: [
        "woolacombe",
        "Woolacombe, North Devon: a long sandy beach backed by dunes."
    ]
};

// Determine today's date in the UK.
const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
}).formatToParts(new Date());

const part = type => parts.find(item => item.type === type).value;

const today =
    `${part("year")}-${part("month")}-${part("day")}`;

async function readJSON(path, fallback) {
    try {
        return JSON.parse(await readFile(path, "utf8"));
    } catch (error) {
        if (error.code === "ENOENT" && fallback !== undefined) {
            return fallback;
        }
        throw error;
    }
}

async function saveJSON(path, value) {
    await writeFile(
        path + ".tmp",
        JSON.stringify(value, null, 2) + "\n",
        "utf8"
    );

    await rename(path + ".tmp", path);
}

async function fileExists(path) {
    if (!path) return false;

    try {
        return (await stat(path)).size > 0;
    } catch (error) {
        if (error.code === "ENOENT") return false;
        throw error;
    }
}

// Retry temporary failures when checking status or downloading.
// Paid generation submissions are sent once.
async function request(url, options = {}) {
    const method = options.method || "GET";
    const attempts = method === "GET" ? 4 : 1;

    for (let attempt = 1; attempt <= attempts; attempt++) {
        try {
            const response = await fetch(url, {
                ...options,
                signal: AbortSignal.timeout(60000)
            });

            if (response.ok) return response;

            const detail = (await response.text())
                .replaceAll(API_KEY, "[redacted]")
                .slice(0, 300);

            const error = new Error(
                `${method} failed: HTTP ${response.status} ${detail}`
            );

            error.retryable = [
                429, 500, 502, 503, 504
            ].includes(response.status);

            const retryAfter = response.headers.get("retry-after");

            error.retryAfter = retryAfter
                ? (
                    /^\d+$/.test(retryAfter)
                        ? Number(retryAfter) * 1000
                        : Date.parse(retryAfter) - Date.now()
                )
                : 0;

            throw error;
        } catch (error) {
            const temporary =
                error.retryable ||
                ["TypeError", "TimeoutError", "AbortError"]
                    .includes(error.name);

            const delay = Math.max(
                5000 * 2 ** (attempt - 1),
                error.retryAfter || 0
            );

            if (
                !temporary ||
                attempt === attempts ||
                delay > 60000
            ) {
                throw error;
            }

            console.warn(
                `Temporary download/status error; ` +
                `retrying in ${delay / 1000}s.`
            );

            await sleep(delay);
        }
    }
}

async function magnific(path = "", body) {
    const response = await request(API_URL + path, {
        method: body ? "POST" : "GET",
        headers: {
            "x-magnific-api-key": API_KEY,
            "Content-Type": "application/json"
        },
        ...(body ? { body: JSON.stringify(body) } : {})
    });

    const result = await response.json();

    if (!result.data) {
        throw new Error("Magnific returned an unexpected response.");
    }

    return result.data;
}

// Extract one forecast hour rather than sending all seven days.
function readings(response, index) {
    return Object.fromEntries(
        Object.entries(response.hourly)
            .filter(([key]) => key !== "time")
            .map(([key, values]) => [
                key,
                {
                    value: Number.isFinite(values[index])
                        ? values[index]
                        : null,
                    unit: response.hourly_units?.[key] || ""
                }
            ])
    );
}

function weatherDescription(code) {
    if (code === 0) return "clear sky";
    if (code === 1) return "mainly clear sky";
    if (code === 2) return "partly cloudy sky";
    if (code === 3) return "overcast sky";
    if ([45, 48].includes(code)) return "fog";

    if ([51, 53, 55, 56, 57].includes(code)) {
        return "drizzle";
    }

    if ([61, 63, 65, 66, 67].includes(code)) {
        return "rain";
    }

    if ([71, 73, 75, 77, 85, 86].includes(code)) {
        return "snow or snow showers";
    }

    if ([80, 81, 82].includes(code)) return "rain showers";
    if ([95, 96, 99].includes(code)) return "thunderstorm conditions";

    return "weather description unavailable; use the other supplied readings";
}

function promptFor(name, description, forecastTime, conditions) {
    const day = conditions.weather.is_day?.value;

    const lighting = day === 0
        ? "Nighttime or after sunset: naturally dark lighting."
        : day === 1
            ? "Daylight, with brightness appropriate to cloud cover and weather."
            : "Use natural lighting appropriate to the date, UK location and local forecast time.";

    return `
Photorealistic landscape image of ${name} beach, United Kingdom.

LOCATION:
${description}

FORECAST TIME:
${forecastTime}, Europe/London local time.

WEATHER:
${weatherDescription(conditions.weather.weather_code?.value)}.

LIGHTING:
${lighting}

CONDITIONS WITH UNITS:
${JSON.stringify(conditions)}

View from the shore towards the sea, with enough shoreline to identify the location.
Natural British coastal colours, realistic perspective and photographic detail.
Landscape 16:9 composition.

Use wave height, swell height and periods to depict the sea scale and texture.
These are offshore significant wave heights, not exact beach breaking-wave heights.
Do not exaggerate small waves into storm surf.

Reflect wind speed and gusts through ripples, whitecaps, spray and vegetation where appropriate.
Wind and wave directions are where they come FROM, in degrees clockwise from true north,
interpreted relative to the coastline.

Match the supplied cloud cover and weather conditions.
Rain probability alone does not mean it is raining.

Null means unknown.
Tide data has not been collected: do not claim a specific high or low tide,
expose invented tidal features, or infer tides from waves.

No labels, text, arrows, logos or watermarks.
No added people or boats.

This is an AI illustration of forecast conditions,
not a live photograph or a measured surf prediction.
`.trim();
}

const forecast = await readJSON("api-data.json");

let state = await readJSON(STATE_FILE, {
    date: today,
    jobs: {}
});

if (state.date !== today) {
    state = {
        date: today,
        jobs: {}
    };
}

if (!state.jobs || typeof state.jobs !== "object") {
    throw new Error("Invalid beach-images.json state.");
}

// Validate all 16 forecast hours before submitting any generation.
const jobs = [];

for (const [name, [slug, description]] of Object.entries(profiles)) {
    const beach = forecast.beaches?.[name];

    if (!beach) {
        throw new Error(`No forecast found for ${name}.`);
    }

    for (const hour of HOURS) {
        const forecastTime = `${today}T${hour}`;

        const wi =
            beach.weather?.hourly?.time?.indexOf(forecastTime) ?? -1;

        const mi =
            beach.marine?.hourly?.time?.indexOf(forecastTime) ?? -1;

        if (wi < 0 || mi < 0) {
            throw new Error(
                `Missing weather/marine forecast for ` +
                `${name} at ${forecastTime}.`
            );
        }

        if (!Number.isFinite(beach.marine.hourly.wave_height?.[mi])) {
            throw new Error(
                `Missing wave height for ${name} at ${forecastTime}; ` +
                `check its coordinates.`
            );
        }

        const conditions = {
            weather: readings(beach.weather, wi),
            marine: readings(beach.marine, mi),
            tide: null
        };

        jobs.push({
            key: `${name}:${hour}`,
            name,
            slug,
            hour,
            forecastTime,
            prompt: promptFor(
                name,
                description,
                forecastTime,
                conditions
            )
        });
    }
}

// If a completed file is missing, recover it using its existing task.
for (const entry of Object.values(state.jobs)) {
    if (
        entry.status === "COMPLETED" &&
        !await fileExists(entry.path)
    ) {
        entry.status = "IN_PROGRESS";
    }
}

// Save progress and expose completed image paths in api-data.json.
async function checkpoint() {
    await saveJSON(STATE_FILE, state);

    for (const name of Object.keys(profiles)) {
        forecast.beaches[name].images = Object.values(state.jobs)
            .filter(entry =>
                entry.beach === name &&
                entry.status === "COMPLETED"
            )
            .sort((a, b) =>
                a.forecast_time.localeCompare(b.forecast_time)
            )
            .map(({
                forecast_time,
                path,
                generated_at,
                weather_updated_at
            }) => ({
                forecast_time,
                timezone: "Europe/London",
                path,
                generated_at,
                weather_updated_at,
                ai_generated: true
            }));
    }

    await saveJSON("api-data.json", forecast);
}

async function waitForTask(id) {
    const deadline = Date.now() + 15 * 60 * 1000;

    while (Date.now() < deadline) {
        const task = await magnific(
            "/" + encodeURIComponent(id)
        );

        if (task.status === "COMPLETED") {
            if (task.has_nsfw?.some(Boolean)) {
                throw new Error(`Magnific filtered task ${id}.`);
            }

            if (!task.generated?.[0]) {
                throw new Error(
                    `Task ${id} completed without an image.`
                );
            }

            return task.generated[0];
        }

        if (
            ["FAILED", "ERROR", "CANCELLED", "CANCELED"]
                .includes(task.status)
        ) {
            const error = new Error(
                `Magnific task ${id}: ${task.status}`
            );

            error.taskFailed = true;
            throw error;
        }

        await sleep(5000);
    }

    throw new Error(
        `Timed out waiting for task ${id}; ` +
        `its ID has been saved for a rerun.`
    );
}

async function downloadImage(url, slug, hour) {
    // The image download receives no API key.
    const response = await request(url);
    const bytes = Buffer.from(await response.arrayBuffer());

    let extension;

    if (
        bytes.subarray(0, 8).equals(
            Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
        )
    ) {
        extension = "png";
    } else if (
        bytes[0] === 255 &&
        bytes[1] === 216 &&
        bytes[2] === 255
    ) {
        extension = "jpg";
    } else if (
        bytes.toString("ascii", 0, 4) === "RIFF" &&
        bytes.toString("ascii", 8, 12) === "WEBP"
    ) {
        extension = "webp";
    } else {
        throw new Error(
            "Magnific download did not contain a supported image."
        );
    }

    const directory = `images/${slug}`;
    await mkdir(directory, { recursive: true });

    const path =
        `${directory}/${hour.replace(":", "")}.${extension}`;

    await writeFile(path + ".tmp", bytes);
    await rename(path + ".tmp", path);

    return path;
}

await checkpoint();

for (const job of jobs) {
    let entry = state.jobs[job.key];

    if (entry?.status === "COMPLETED") {
        console.log(
            `Reusing today's ${job.name} ${job.hour} image.`
        );
        continue;
    }

    try {
        if (!entry?.task_id || entry.status === "FAILED") {
            console.log(
                `Generating ${job.name} for ${job.hour} UK time...`
            );

            const task = await magnific("", {
                prompt: job.prompt,
                model: "realism",
                resolution: "1k",
                aspect_ratio: "widescreen_16_9",
                engine: "automatic",
                creative_detailing: 10,
                fixed_generation: true
            });

            if (!task.task_id) {
                throw new Error(
                    "Magnific did not return a task ID."
                );
            }

            entry = state.jobs[job.key] = {
                beach: job.name,
                forecast_time: job.forecastTime,
                weather_updated_at: forecast.updated_at,
                task_id: task.task_id,
                status: "IN_PROGRESS",
                prompt: job.prompt
            };

            await checkpoint();
        } else {
            console.log(
                `Resuming ${job.name} ${job.hour}: ${entry.task_id}`
            );
        }

        const url = await waitForTask(entry.task_id);

        entry.path = await downloadImage(
            url,
            job.slug,
            job.hour
        );

        entry.status = "COMPLETED";
        entry.generated_at = new Date().toISOString();

        await checkpoint();

        console.log(`Saved ${entry.path}`);
    } catch (error) {
        if (error.taskFailed && entry) {
            entry.status = "FAILED";
        }

        await checkpoint();
        throw error;
    }
}

console.log("All 16 beach images are ready.");
