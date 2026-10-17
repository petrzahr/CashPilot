/** @type {import('tailwindcss').Config} */

// Barvy čtou proměnné ze src/theme.css, aby se světlý a tmavý vzhled přepínal bez změny tříd.
// Paleta je uzavřená: jiné rodiny výchozího Tailwindu (rose, blue, gray...) neexistují, protože by nesledovaly vzhled.
const STEPS = ['50', '100', '200', '300', '400', '500', '600', '700', '800', '900', '950'];
const THEMED_FAMILIES = ['slate', 'sky', 'red', 'amber', 'emerald', 'purple'];
const token = (name) => `rgb(var(--c-${name}) / <alpha-value>)`;
const family = (name) => Object.fromEntries(STEPS.map((step) => [step, token(`${name}-${step}`)]));

export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    colors: {
      transparent: 'transparent',
      current: 'currentColor',
      inherit: 'inherit',
      white: token('white'),
      ...Object.fromEntries(THEMED_FAMILIES.map((name) => [name, family(name)])),
      scrim: token('scrim'),
      canvas: token('canvas'),
      table: {
        header: token('table-header'),
        category: token('table-category'),
        nonmonthly: token('table-nonmonthly'),
      },
    },
  },
  plugins: [],
}
