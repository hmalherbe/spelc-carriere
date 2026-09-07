import "dotenv/config";
import { createApp } from "./app.js";

// Last-resort safety net: an async route wrapped in asyncHandler should never let a rejection
// escape unhandled, but a long-running external integration (e.g. the ADEL scraper, or a browser
// automation library's own background event handlers) can still produce a rejection outside any
// request's own promise chain. Without this, Node treats that as fatal and kills the process for
// every user — log and keep running instead.
process.on("unhandledRejection", (reason) => {
  console.error("Unhandled promise rejection (server reste actif) :", reason);
});
process.on("uncaughtException", (err) => {
  console.error("Uncaught exception (server reste actif) :", err);
});

const port = Number(process.env.PORT ?? 4000);
const app = createApp();

app.listen(port, () => {
  console.log(`Spelc API listening on http://localhost:${port}`);
});
