import { z } from "zod";

import { CONFIG_PATH } from "./constants";
import { readFile } from "./schema-file";

export const ConfigSchema = z.object({
    discord: z.object({
        channel_id: z.string(),
    }),
    mods: z.record(
        z.string(),
        z
            .object({
                target_loaders: z.array(z.string()),
            })
            .strict(),
    ),
});

export async function getConfig() {
    return await readFile(CONFIG_PATH, ConfigSchema, Bun.TOML.parse);
}
