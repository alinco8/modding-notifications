import { AuthFeature, GenericModrinthClient, RetryFeature } from "@modrinth/api-client";
import { Client, GatewayIntentBits } from "discord.js";

import { getConfig } from "./lib/config";
import { compareMcVersions } from "./lib/mcver";
import { getPermData, savePermData, type PermData } from "./lib/perm-data";
import { VersionManifestV2Schema } from "./lib/schemas/mojang";

const MESSAGES = {
    MINECRAFT_VERSION_UNSUPPORTED: (mcVersion: string) =>
        `New Minecraft version ${mcVersion} is not supported by this mod!`,
    DEPENDENCY_SUPPORTED_NEW_MC: (depName: string, mcVersion: string) =>
        `Dependency ${depName} is now supported on Minecraft version ${mcVersion}.`,
    READY_TO_UPDATE: (mcVersion: string) =>
        `This mod is now ready to update to Minecraft version ${mcVersion}.`,
} satisfies Record<string, (...args: any[]) => string>;

const depNameCache = new Map<string, string>();

async function getTextChannel(client: Client, channelId: string) {
    const channel = await client.channels.fetch(channelId);

    if (!channel) throw new Error("Discord channel not found.");
    if (!channel.isTextBased()) throw new Error("Selected Discord channel is not a text channel.");
    if (!channel.isSendable())
        throw new Error("Bot does not have permission to send messages in the selected channel.");

    return channel;
}

function getMcVersions() {
    return fetch("https://launchermeta.mojang.com/mc/game/version_manifest_v2.json")
        .then((res) => res.json())
        .then((data) => VersionManifestV2Schema.parse(data));
}

export async function notify() {
    if (!Bun.env.DISCORD_BOT_TOKEN) throw new Error("DISCORD_BOT_TOKEN is not set.");
    if (!Bun.env.MODRINTH_API_TOKEN) throw new Error("MODRINTH_API_TOKEN is not set.");

    const config = await getConfig();
    const permData = await getPermData();
    const mcVersions = await getMcVersions();

    const modrinth = new GenericModrinthClient({
        features: [
            new RetryFeature({ maxAttempts: 3 }),
            //@ts-expect-error typescript couldn't detect the `token` property
            new AuthFeature({ token: Bun.env.MODRINTH_API_TOKEN }),
        ],
    });

    const discord = new Client({
        intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages],
    });

    const latestMinecraft = mcVersions.latest.release;

    try {
        await discord.login(Bun.env.DISCORD_BOT_TOKEN);
        const channel = await getTextChannel(discord, config.discord.channel_id);

        await channel.sendTyping();

        let lines = ["|| @everyone ||"];

        for (const [modId, mod] of Object.entries(config.mods)) {
            permData[modId] ??= {};

            const modProject = await modrinth.labrinth.projects_v3.get(modId);

            for (const loader of mod.target_loaders) {
                permData[modId][loader] ??= {};

                const messages = await notifyMod(
                    modrinth,
                    permData[modId][loader],
                    modId,
                    loader,
                    latestMinecraft,
                );

                if (messages.length === 0) continue;

                lines.push(`## ${modProject.name} (${loader})`);
                lines.push(...messages.map((m) => `- ${m}`));
            }
        }

        if (lines.length <= 1) return;

        await channel.send(lines.join("\n"));
    } finally {
        await discord.destroy();
    }

    await savePermData(permData);
}

async function notifyMod(
    modrinth: GenericModrinthClient,
    permData: PermData[string][string],
    modId: string,
    loader: string,
    latestMinecraft: string,
): Promise<string[]> {
    let messages: string[] = [];

    const modVersions = await modrinth.labrinth.versions_v3.getProjectVersions(modId, {
        loaders: [loader],
    });

    const supportedMcVersions = new Set(modVersions.flatMap((v) => v.game_versions));
    const latestSupportedMcVersion = Array.from(supportedMcVersions)
        .toSorted(compareMcVersions)
        .at(-1);

    if (!latestSupportedMcVersion)
        throw new Error(
            `No supported Minecraft versions found for mod ${modId} and loader ${loader}.`,
        );

    if (latestSupportedMcVersion === latestMinecraft) return messages; //TODO: 依存関係のは快適更新は通知したいかも

    if (permData.lastNotifiedMcVersion !== latestSupportedMcVersion) {
        messages.push(MESSAGES.MINECRAFT_VERSION_UNSUPPORTED(latestSupportedMcVersion));

        permData.lastNotifiedMcVersion = latestSupportedMcVersion;
    }

    const modVersionForLatestMc = modVersions.find((v) =>
        v.game_versions.includes(latestSupportedMcVersion),
    );
    if (!modVersionForLatestMc)
        throw new Error(
            `No mod version found for mod ${modId}, loader ${loader}, and Minecraft version ${latestSupportedMcVersion}.`,
        );

    let isReadyToUpdate = true;
    for (const dep of modVersionForLatestMc.dependencies) {
        if (dep.dependency_type !== "required" || !dep.project_id) continue;
        permData.lastDepsMcs ??= {};

        const depVersionsForLatestMc = await modrinth.labrinth.versions_v3.getProjectVersions(
            dep.project_id,
            {
                loaders: [loader],
                game_versions: [latestSupportedMcVersion],
            },
        );

        if (depVersionsForLatestMc.length === 0) {
            isReadyToUpdate = false;
            continue;
        }
        if (permData.lastDepsMcs[dep.project_id] === latestSupportedMcVersion) continue;

        const depName =
            depNameCache.get(dep.project_id) ??
            (await modrinth.labrinth.projects_v3.get(dep.project_id)).name;
        depNameCache.set(dep.project_id, depName);

        messages.push(MESSAGES.DEPENDENCY_SUPPORTED_NEW_MC(depName, latestSupportedMcVersion));
        permData.lastDepsMcs[dep.project_id] = latestSupportedMcVersion;
    }

    if (!isReadyToUpdate) return messages;
    if (permData.notifiedReadyToUpdate) return messages;

    messages.push(MESSAGES.READY_TO_UPDATE(latestSupportedMcVersion));
    permData.notifiedReadyToUpdate = true;

    return messages;
}
