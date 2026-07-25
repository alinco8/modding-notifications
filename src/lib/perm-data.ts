import { z } from "zod";

import { readFile } from "./schema-file";

const ModPermDataSchema = z
    .object({
        lastNotifiedMcVersion: z.string(),
        lastDepsMcs: z.record(z.string(), z.string()),
        notifiedReadyToUpdate: z.boolean(),
    })
    .partial();
export type ModPermData = z.infer<typeof ModPermDataSchema>;

const PermDataSchema = z.record(z.string(), z.record(z.string(), ModPermDataSchema));
export type PermData = z.infer<typeof PermDataSchema>;

const FILE_NAME = "perm-data.json";
export const DEFAULT: PermData = {};

export async function getPermData() {
    return await readFile(FILE_NAME, PermDataSchema, JSON.parse, DEFAULT);
}

export async function savePermData(data: PermData) {
    await Bun.file(FILE_NAME).write(JSON.stringify(data, null, 2));
}
