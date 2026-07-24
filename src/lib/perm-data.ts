import { z } from "zod";
import { PERM_DATA_PATH } from "./constants";

export const PermDataSchema = z.record(
  z.string(),
  z.record(
    z.string(),
    z
      .object({
        lastNotifiedMcVersion: z.string(),
        notifiedDeps: z.record(z.string(), z.string()),
        readyForUpdateNotified: z.boolean(),
      })
      .partial(),
  ),
);

const DEFAULT_PERM_DATA: z.infer<typeof PermDataSchema> = {};

export async function getPermData() {
  if (!(await Bun.file(PERM_DATA_PATH).exists())) {
    await Bun.file(PERM_DATA_PATH).write(JSON.stringify(DEFAULT_PERM_DATA));
  }

  const json = await Bun.file(PERM_DATA_PATH).json();

  const result = PermDataSchema.safeParse(json);
  if (!result.success) {
    await Bun.file(PERM_DATA_PATH).write(JSON.stringify(DEFAULT_PERM_DATA, null, 2));

    return DEFAULT_PERM_DATA;
  }

  return result.data;
}
