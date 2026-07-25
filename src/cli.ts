import Bun from "bun";

import { getConfig } from "./lib/config";
import { notify } from "./notify";

switch (Bun.argv[2]) {
    case "check":
        await checkConfig();
        break;
    case "notify":
        await notify();
        break;
    default:
        console.error(`Unknown command: ${Bun.argv[2]}`);
        process.exit(1);
}

async function checkConfig() {
    await getConfig();
}
