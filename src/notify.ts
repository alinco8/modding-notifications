import { getConfig } from "./lib/config";
import { AuthFeature, GenericModrinthClient, RetryFeature } from "@modrinth/api-client";
import { VersionManifestV2Schema } from "./lib/mojang";
import { compareMcVersions } from "./lib/mcver";
import { getPermData } from "./lib/perm-data";
import { Client, GatewayIntentBits } from "discord.js";
import { PERM_DATA_PATH } from "./lib/constants";

export async function notify() {
  if (!Bun.env.MODRINTH_API_TOKEN)
    throw new Error("MODRINTH_API_TOKEN is not set in environment variables.");
  if (!Bun.env.DISCORD_BOT_TOKEN)
    throw new Error("DISCORD_BOT_TOKEN is not set in environment variables.");

  const discordClient = new Client({
    intents: [GatewayIntentBits.Guilds],
  });

  try {
    await discordClient.login(Bun.env.DISCORD_BOT_TOKEN);

    const config = await getConfig();
    const permData = await getPermData();
    let permDataDirty = false;

    const { labrinth } = new GenericModrinthClient({
      features: [
        new RetryFeature({ maxAttempts: 3 }),
        //@ts-expect-error typescript couldn't detect the `token` property
        new AuthFeature({ token: Bun.env.MODRINTH_API_TOKEN }),
      ],
    });

    const channel = await discordClient.channels.fetch(config.discord.channel_id);
    if (!channel) throw new Error("Discord channel not found.");
    if (!channel.isTextBased()) throw new Error("Selected Discord channel is not a text channel.");
    if (!channel.isSendable())
      throw new Error("Bot does not have permission to send messages in the selected channel.");

    const versionManifest = await fetch(
      "https://piston-meta.mojang.com/mc/game/version_manifest_v2.json",
    )
      .then((res) => res.json())
      .then((json) => VersionManifestV2Schema.parse(json));

    const latestMcVersion = versionManifest.latest.release;

    for (const [modId, modConfig] of Object.entries(config.mods)) {
      for (const loader of modConfig.target_loaders) {
        const modVersions = await labrinth.versions_v3.getProjectVersions(modId, {
          loaders: [loader],
        });

        const supportedMcVersions = new Set(
          modVersions.flatMap((modVersion) => modVersion.game_versions),
        );

        if (supportedMcVersions.has(latestMcVersion)) {
          continue;
        }

        const lines: string[] = [];

        const isNewMcVersionNotice =
          permData[modId]?.[loader]?.lastNotifiedMcVersion !== latestMcVersion;
        if (isNewMcVersionNotice) {
          lines.push(
            `Minecraft ${latestMcVersion} was released, but this mod has not been updated for it yet.`,
          );

          permData[modId] ??= {};
          permData[modId][loader] ??= {};
          permData[modId][loader].lastNotifiedMcVersion = latestMcVersion;
          permData[modId][loader].notifiedDeps = {};
          permData[modId][loader].readyForUpdateNotified = false;

          permDataDirty = true;
        }

        const latestSupportedMcVersion = Array.from(supportedMcVersions)
          .toSorted(compareMcVersions)
          .at(-1);
        const newerModVersion = modVersions.find((modVersion) =>
          modVersion.game_versions.includes(latestSupportedMcVersion!),
        )!;

        let incompatibleDepFound = false;
        const newlyAvailableDeps: string[] = [];

        for (const dep of newerModVersion.dependencies) {
          if (dep.dependency_type !== "required") continue; // TODO: handle `embedded` dependencies
          if (!dep.project_id) continue;

          const depVersions = await labrinth.versions_v3.getProjectVersions(dep.project_id, {
            game_versions: [latestMcVersion],
            loaders: [loader],
          });

          const latestDepVersion = depVersions[0];

          if (!latestDepVersion) {
            incompatibleDepFound = true;
            continue;
          }

          if (permData[modId]?.[loader]?.notifiedDeps?.[dep.project_id]) continue;

          const depLabel = dep.file_name ?? dep.project_id;
          newlyAvailableDeps.push(`- [${depLabel}](https://modrinth.com/mod/${dep.project_id})`);

          permData[modId] ??= {};
          permData[modId][loader] ??= {};
          permData[modId][loader].notifiedDeps ??= {};
          permData[modId][loader].notifiedDeps[dep.project_id] = latestDepVersion.version_number;
          permDataDirty = true;
        }

        if (newlyAvailableDeps.length > 0) {
          lines.push(`Dependency now updated for ${latestMcVersion}:`, ...newlyAvailableDeps);
        }

        if (!incompatibleDepFound && !permData[modId]?.[loader]?.readyForUpdateNotified) {
          lines.push(`All required dependencies are ready. This mod can be updated now.`);

          permData[modId] ??= {};
          permData[modId][loader] ??= {};
          permData[modId][loader].readyForUpdateNotified = true;
          permDataDirty = true;
        }

        if (lines.length === 0) continue;

        const message = [
          `@everyone`,
          `**[${modId}](https://modrinth.com/mod/${modId})** (${loader})`,
          ...lines,
        ].join("\n");

        await channel.send(message);
      }
    }

    if (permDataDirty) {
      await Bun.file(PERM_DATA_PATH).write(JSON.stringify(permData, null, 2));
    }
  } finally {
    discordClient.destroy();
  }
}
