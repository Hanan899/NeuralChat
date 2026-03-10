/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          dark: "#082032",
          accent: "#2c74b3",
          soft: "#f2f7ff"
        }
      }
    }
  },
  plugins: []
};
