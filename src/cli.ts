import {
    AuthFeature,
    GenericModrinthClient,
    RetryFeature,
    type Labrinth,
} from "@modrinth/api-client";
import { Client, GatewayIntentBits } from "discord.js";

import { mojangAPI } from "./lib/api/mojang";
import { getConfig } from "./lib/config";
import { compareMcVersions } from "./lib/mcver";

const discordToken = Bun.env.DISCORD_BOT_TOKEN;
const modrinthToken = Bun.env.MODRINTH_API_TOKEN;

if (!discordToken) throw new Error("DISCORD_BOT_TOKEN is not set.");
if (!modrinthToken) throw new Error("MODRINTH_API_TOKEN is not set.");

const config = await getConfig();

const {
    latest: { release: latestMc },
} = await mojangAPI.getVersionManifestV2();

const modrinth = new GenericModrinthClient({
    features: [
        new RetryFeature({ maxAttempts: 3 }),
        //@ts-expect-error - AuthFeature is not typed correctly
        new AuthFeature({ token: modrinthToken }),
    ],
});

const discord = new Client({
    intents: [GatewayIntentBits.Guilds],
});

const projectNameCache = new Map<string, string>();
const dependencyCompatibilityCache = new Map<string, boolean>();
const dependencyVersionProjectCache = new Map<string, string | null>();

try {
    await discord.login(discordToken);

    const channel = await getTextChannel(discord, config.discord.channel_id);
    const notifications: string[] = [];

    for (const [modId, modConfig] of Object.entries(config.mods)) {
        const project = await modrinth.labrinth.projects_v3.get(modId);
        const versions = await modrinth.labrinth.versions_v3.getProjectVersions(modId, {});

        const loaderNotifications: LoaderNotification[] = [];

        for (const loader of modConfig.target_loaders) {
            if (isUpdatedFor(versions, loader, latestMc)) continue;

            const newestVersion = getNewestVersion(versions, loader);
            if (!newestVersion) continue;

            const outdatedDependencies = await getOutdatedDependencies(newestVersion, loader);

            loaderNotifications.push({
                loader,
                dependencies: outdatedDependencies,
            });
        }

        if (loaderNotifications.length === 0) continue;

        notifications.push(formatNotification(project.name, loaderNotifications));
    }

    const text = `-# ||@everyone||\n${notifications.join("\n")}`;

    if (text) {
        await sendLongMessage(channel, text);
    }
} finally {
    await discord.destroy();
}

type LoaderNotification = {
    loader: string;
    dependencies: string[];
};

function isUpdatedFor(
    versions: Labrinth.Versions.v3.Version[],
    loader: string,
    gameVersion: string,
) {
    return versions.some(
        (version) =>
            version.loaders.includes(loader) && version.game_versions.includes(gameVersion),
    );
}

function getNewestVersion(versions: Labrinth.Versions.v3.Version[], loader: string) {
    const compatibleVersions = versions.filter((version) => version.loaders.includes(loader));

    if (compatibleVersions.length === 0) return null;

    return compatibleVersions.reduce((newest, current) => {
        const newestGameVersion = getNewestGameVersion(newest.game_versions);
        const currentGameVersion = getNewestGameVersion(current.game_versions);

        return compareMcVersions(currentGameVersion, newestGameVersion) > 0 ? current : newest;
    });
}

function getNewestGameVersion(gameVersions: string[]) {
    return gameVersions.reduce((newest, current) =>
        compareMcVersions(current, newest) > 0 ? current : newest,
    );
}

async function getOutdatedDependencies(version: Labrinth.Versions.v3.Version, loader: string) {
    const dependencies: string[] = [];

    for (const dependency of version.dependencies) {
        if (dependency.dependency_type !== "required") continue;

        const projectId = await getDependencyProjectId(dependency);
        if (!projectId) continue;

        const [name, compatible] = await Promise.all([
            getProjectName(projectId),
            isDependencyCompatible(projectId, loader),
        ]);

        if (!compatible) {
            dependencies.push(name);
        }
    }

    return dependencies;
}

async function getDependencyProjectId(dependency: Labrinth.Versions.v3.Dependency) {
    if (dependency.project_id) {
        return dependency.project_id;
    }

    if (!dependency.version_id) {
        return null;
    }

    if (dependencyVersionProjectCache.has(dependency.version_id)) {
        return dependencyVersionProjectCache.get(dependency.version_id) ?? null;
    }

    const version = await modrinth.labrinth.versions_v3.getVersion(dependency.version_id);

    const projectId = version.project_id ?? null;

    dependencyVersionProjectCache.set(dependency.version_id, projectId);

    return projectId;
}

async function getProjectName(projectId: string) {
    const cached = projectNameCache.get(projectId);
    if (cached) return cached;

    const project = await modrinth.labrinth.projects_v3.get(projectId);

    projectNameCache.set(projectId, project.name);

    return project.name;
}

async function isDependencyCompatible(projectId: string, loader: string) {
    const key = `${projectId}:${latestMc}:${loader}`;

    const cached = dependencyCompatibilityCache.get(key);
    if (cached !== undefined) return cached;

    const versions = await modrinth.labrinth.versions_v3.getProjectVersions(projectId, {
        game_versions: [latestMc],
        loaders: [loader],
    });

    const compatible = versions.length > 0;

    dependencyCompatibilityCache.set(key, compatible);

    return compatible;
}

function formatNotification(projectName: string, loaders: LoaderNotification[]) {
    let text = `# ${projectName}\n`;

    for (const { loader, dependencies } of loaders) {
        text += `## ${loader}\n`;
        text += `The mod is not updated for \`${latestMc}-${loader}\` yet.\n`;

        if (dependencies.length === 0) {
            text += "All required dependencies are already updated.\n";
            continue;
        }

        text += "The following required dependencies are not updated yet:\n";

        for (const dependency of dependencies) {
            text += `- ${dependency}\n`;
        }
    }

    return text;
}

async function sendLongMessage(channel: Awaited<ReturnType<typeof getTextChannel>>, text: string) {
    const chunks = splitMessage(text, 2000);

    for (const chunk of chunks) {
        await channel.send(chunk);
    }
}

function splitMessage(text: string, maxLength: number) {
    const chunks: string[] = [];
    let current = "";

    for (const line of text.split("\n")) {
        const next = current ? `${current}\n${line}` : line;

        if (next.length <= maxLength) {
            current = next;
            continue;
        }

        if (current) chunks.push(current);
        current = line;
    }

    if (current) chunks.push(current);

    return chunks;
}

async function getTextChannel(client: Client, channelId: string) {
    const channel = await client.channels.fetch(channelId);

    if (!channel) throw new Error("Discord channel not found.");
    if (!channel.isTextBased()) {
        throw new Error("Selected Discord channel is not a text channel.");
    }
    if (!channel.isSendable()) {
        throw new Error("Bot does not have permission to send messages in the selected channel.");
    }

    return channel;
}
