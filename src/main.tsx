import { createRoot } from "react-dom/client";
import App from "./App";
import "./style.css";
import "./light.css";
if ((navigator as Navigator & { standalone?: boolean }).standalone) {
  document.documentElement.classList.add("inkloop-standalone");
}

createRoot(document.getElementById("root")!).render(<App />);
if ("serviceWorker" in navigator)
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(() => {
      /* The notebook still works online. */
    });
  });
