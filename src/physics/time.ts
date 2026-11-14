export const J2000 = 2451545.0;

export const dateToJD = (d: Date): number => d.getTime() / 86400000 + 2440587.5;
export const jdToDate = (jd: number): Date => new Date((jd - 2440587.5) * 86400000);
export const isoToJD = (iso: string): number => dateToJD(new Date(iso + 'T00:00:00Z'));

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export const formatJD = (jd: number): string => {
  const d = jdToDate(jd);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
};

export const formatJDShort = (jd: number): string => {
  const d = jdToDate(jd);
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
};

export const formatDuration = (days: number): string => {
  if (days < 60) return `${Math.round(days)} days`;
  if (days < 730) return `${(days / 30.44).toFixed(1)} months`;
  return `${(days / 365.25).toFixed(1)} years`;
};
