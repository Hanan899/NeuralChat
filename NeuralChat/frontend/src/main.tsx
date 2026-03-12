import { ClerkProvider } from "@clerk/clerk-react";
import React from "react";
import ReactDOM from "react-dom/client";

import App from "./App";
import "./index.css";

const savedThemeMode = window.localStorage.getItem("neuralchat:theme-mode:v1");
const fallbackThemeMode =
  typeof window.matchMedia === "function" && window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
const initialThemeMode =
  savedThemeMode === "dark" || savedThemeMode === "light" ? savedThemeMode : fallbackThemeMode;
document.documentElement.setAttribute("data-theme", initialThemeMode);
document.documentElement.style.colorScheme = initialThemeMode;

const clerkPublishableKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;

if (!clerkPublishableKey) {
  throw new Error("Missing VITE_CLERK_PUBLISHABLE_KEY. Configure frontend/.env before running the app.");
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ClerkProvider publishableKey={clerkPublishableKey}>
      <App />
    </ClerkProvider>
  </React.StrictMode>
);
