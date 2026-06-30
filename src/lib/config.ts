import { z } from "zod";
import { CONFIG_PATH } from "./constants";

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
  const configText = await Bun.file(CONFIG_PATH).text();
  const configData = Bun.TOML.parse(configText);
  return ConfigSchema.parse(configData);
}
