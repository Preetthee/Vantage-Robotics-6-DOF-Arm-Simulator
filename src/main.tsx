import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import { ArmStateProvider } from "./context/ArmStateContext";
import App from "./App";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ArmStateProvider>
      <App />
    </ArmStateProvider>
  </StrictMode>
);