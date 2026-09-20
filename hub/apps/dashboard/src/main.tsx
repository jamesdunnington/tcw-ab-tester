import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { AuthProvider } from "./context/AuthContext.js";
import { App } from "./App.js";
import "@fontsource-variable/schibsted-grotesk/index.css";
import "@fontsource/fira-code/400.css";
import "./styles.css";
import { applyStoredTheme } from "./theme.js";

applyStoredTheme();

const root = document.getElementById("root");
if (!root) throw new Error("#root element missing");

createRoot(root).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <App />
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
);
