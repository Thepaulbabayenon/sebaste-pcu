export const BARANGAYS = [
  "Abiera",
  "Aguila",
  "Alegre",
  "Aras-asan",
  "Bacalan",
  "Callan",
  "Idio",
  "Nauhon",
  "P. Javier",
  "Poblacion",
] as const;

export type BarangayName =
  (typeof BARANGAYS)[number];