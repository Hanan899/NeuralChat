import { ClerkProvider } from "@clerk/clerk-react";
import { QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";

import App from "./App";
import "./index.css";
import { queryClient } from "./lib/queryClient";
import { startKeepAlive } from "./scripts/keepAlive";

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

if (import.meta.env.PROD) {
  startKeepAlive();
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <ClerkProvider publishableKey={clerkPublishableKey}>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </ClerkProvider>
    </QueryClientProvider>
  </React.StrictMode>
);
