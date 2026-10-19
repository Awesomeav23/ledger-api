import "dotenv/config";
import { app } from "./app";

const port = Number(process.env.PORT) || 3000;

app.listen(port, () => {
  console.log(`Ledger API running on http://localhost:${port}`);
});
