import { z } from "zod";
import { PERM_DATA_PATH } from "./constants";

export const PermData = z.record(
  z.string(),
  z.object({
    lastNotifiedMcVersion: z.string().optional(),
    notifiedDeps: z.array(z.string()).optional(),
    readyForUpdateNotified: z.boolean().optional(),
  }),
);

export async function getPermData() {
  if (!(await Bun.file(PERM_DATA_PATH).exists())) {
    await Bun.file(PERM_DATA_PATH).write(JSON.stringify({}));
  }

  const json = await Bun.file(PERM_DATA_PATH).json();

  return PermData.parse(json);
}
