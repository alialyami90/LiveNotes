import type { Weather } from '../formula/values';

/** WMO weather interpretation codes, grouped coarsely. */
export function describeWeather(code: number): Pick<Weather, 'condition' | 'icon'> {
  if (code === 0) return { condition: 'Clear', icon: '☀️' };
  if (code <= 3) return { condition: 'Partly cloudy', icon: '⛅' };
  if (code === 45 || code === 48) return { condition: 'Fog', icon: '🌫️' };
  if (code >= 51 && code <= 67) return { condition: 'Rain', icon: '🌧️' };
  if (code >= 71 && code <= 77) return { condition: 'Snow', icon: '🌨️' };
  if (code >= 80 && code <= 86) return { condition: 'Showers', icon: '🌦️' };
  if (code >= 95) return { condition: 'Thunderstorm', icon: '⛈️' };
  return { condition: 'Cloudy', icon: '☁️' };
}
