/**
 * 日出日落時間（深色模式「自動」用）：在瀏覽器裡用天文公式算，不打 API、不用定位權限。
 * 地點固定台北（台灣各地差幾分鐘，不影響切換主題）。
 * 演算法參考 SunCalc（https://github.com/mourner/suncalc，BSD-2 授權）的 sunrise equation，
 * 太陽中心在地平線下 0.833 度（含大氣折射與太陽半徑）算日出／日落。
 */

export const TAIPEI = { lat: 25.033, lng: 121.5654 } as const;

const RAD = Math.PI / 180;
const DAY_MS = 1000 * 60 * 60 * 24;
const J1970 = 2440588;
const J2000 = 2451545;
const J0 = 0.0009;
// 地球自轉軸傾角
const OBLIQUITY = RAD * 23.4397;
// 日出／日落時太陽中心的高度角
const SUNRISE_ALTITUDE = RAD * -0.833;

const toDays = (date: Date): number => date.valueOf() / DAY_MS - 0.5 + J1970 - J2000;
const fromJulian = (j: number): Date => new Date((j + 0.5 - J1970) * DAY_MS);

const solarMeanAnomaly = (d: number): number => RAD * (357.5291 + 0.98560028 * d);

const eclipticLongitude = (m: number): number => {
  const center = RAD * (1.9148 * Math.sin(m) + 0.02 * Math.sin(2 * m) + 0.0003 * Math.sin(3 * m));
  const perihelion = RAD * 102.9372;
  return m + center + perihelion + Math.PI;
};

const approxTransit = (hourAngle: number, lw: number, n: number): number =>
  J0 + (hourAngle + lw) / (2 * Math.PI) + n;

const solarTransitJ = (ds: number, m: number, l: number): number =>
  J2000 + ds + 0.0053 * Math.sin(m) - 0.0069 * Math.sin(2 * l);

export interface SunTimes {
  sunrise: Date;
  sunset: Date;
}

/** date 那天（UTC 換日附近也正確對到台灣當天）的日出、日落時間 */
export const getSunTimes = (
  date: Date,
  lat: number = TAIPEI.lat,
  lng: number = TAIPEI.lng,
): SunTimes => {
  const lw = RAD * -lng;
  const phi = RAD * lat;
  const d = toDays(date);
  const n = Math.round(d - J0 - lw / (2 * Math.PI));
  const ds = approxTransit(0, lw, n);
  const m = solarMeanAnomaly(ds);
  const l = eclipticLongitude(m);
  const dec = Math.asin(Math.sin(OBLIQUITY) * Math.sin(l));
  const jNoon = solarTransitJ(ds, m, l);

  const w = Math.acos(
    (Math.sin(SUNRISE_ALTITUDE) - Math.sin(phi) * Math.sin(dec)) / (Math.cos(phi) * Math.cos(dec)),
  );
  const jSet = solarTransitJ(approxTransit(w, lw, n), m, l);
  const jRise = jNoon - (jSet - jNoon);
  return { sunrise: fromJulian(jRise), sunset: fromJulian(jSet) };
};

/** now 是否在日落之後、日出之前（天黑） */
export const isAfterSunset = (now: Date = new Date()): boolean => {
  const { sunrise, sunset } = getSunTimes(now);
  return now < sunrise || now >= sunset;
};

/** now 之後下一次日出或日落的時間（「自動」模式排下一次切換用） */
export const nextSunEvent = (now: Date = new Date()): Date => {
  const { sunrise, sunset } = getSunTimes(now);
  if (now < sunrise) return sunrise;
  if (now < sunset) return sunset;
  return getSunTimes(new Date(now.valueOf() + DAY_MS)).sunrise;
};
