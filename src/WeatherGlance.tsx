import {
  Cloud,
  CloudDrizzle,
  CloudFog,
  CloudLightning,
  CloudRain,
  CloudSnow,
  CloudSun,
  type LucideIcon,
  Sun,
  Wind,
} from "lucide-react";
import { numericAttribute, type HaState } from "./homeAssistant";

const CONDITION_ICONS: Record<string, LucideIcon> = {
  "clear-night": Sun,
  sunny: Sun,
  cloudy: Cloud,
  partlycloudy: CloudSun,
  fog: CloudFog,
  hail: CloudSnow,
  lightning: CloudLightning,
  "lightning-rainy": CloudLightning,
  pouring: CloudRain,
  rainy: CloudRain,
  snowy: CloudSnow,
  "snowy-rainy": CloudSnow,
  windy: Wind,
  "windy-variant": Wind,
  exceptional: CloudDrizzle,
};

function conditionLabel(condition: string): string {
  return condition
    .replace(/[-_]/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

// A compact current-weather readout. `state` is the HA weather entity; renders
// nothing if it's missing/unavailable so it never shows a broken placeholder.
export function WeatherGlance({
  state,
  variant = "hero",
}: {
  state: HaState | null;
  variant?: "hero" | "lock";
}) {
  if (!state || state.state === "unavailable" || state.state === "unknown") return null;

  const temp = numericAttribute(state, "temperature");
  const condition = state.state;
  const Icon = CONDITION_ICONS[condition] ?? Cloud;

  const forecast = state.attributes?.forecast;
  let high: number | null = null;
  let low: number | null = null;
  if (Array.isArray(forecast) && forecast.length > 0) {
    const today = forecast[0] as { temperature?: unknown; templow?: unknown };
    if (typeof today.temperature === "number") high = today.temperature;
    if (typeof today.templow === "number") low = today.templow;
  }

  return (
    <div className={`weather-glance ${variant}`}>
      <Icon size={variant === "hero" ? 22 : 18} />
      <span className="weather-temp">{temp == null ? "--" : `${Math.round(temp)}°`}</span>
      <span className="weather-cond">
        <span className="weather-cond-name">{conditionLabel(condition)}</span>
        {high != null ? (
          <span className="weather-hilo">
            H {Math.round(high)}°{low != null ? ` · L ${Math.round(low)}°` : ""}
          </span>
        ) : null}
      </span>
    </div>
  );
}
