/** @type {import('tailwindcss').Config} */
/** Popup CSS (popup.html). The content script uses tailwind.content.config.js. */
export default {
  important: "#root",
  content: ["./popup.html", "./src/popup/**/*.{ts,tsx}", "./src/lib/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        pine: {
          50: "#f2f7f5",
          100: "#e1ede8",
          200: "#c4dbd3",
          300: "#9bc0b6",
          400: "#6e9f93",
          500: "#4f8377",
          600: "#3d685e",
          700: "#32534c",
          800: "#2a433e",
          900: "#253834",
          950: "#13201e",
        },
      },
    },
  },
  plugins: [],
}
