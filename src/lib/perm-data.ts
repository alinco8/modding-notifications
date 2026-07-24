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

export async function getPermData() {
  if (!(await Bun.file(PERM_DATA_PATH).exists())) {
    await Bun.file(PERM_DATA_PATH).write(JSON.stringify({}));
  }

  const json = await Bun.file(PERM_DATA_PATH).json();

  const result = PermDataSchema.safeParse(json);
  if (!result.success) return {} satisfies z.infer<typeof PermDataSchema>;

  return result.data;
}
