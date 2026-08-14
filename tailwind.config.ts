import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#14251f",
        pine: "#1d5b45",
        lime: "#d8f35a",
        sand: "#f6f8ef",
        coral: "#ff8067"
      },
      boxShadow: { soft: "0 18px 50px rgba(20, 37, 31, 0.08)" }
    }
  },
  plugins: []
} satisfies Config;
