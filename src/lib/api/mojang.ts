import { VersionManifestV2Schema } from "../schemas/mojang";

export const mojangAPI = {
    getVersionManifestV2: async () =>
        fetch("https://launchermeta.mojang.com/mc/game/version_manifest_v2.json")
            .then((res) => res.json())
            .then((data) => VersionManifestV2Schema.parse(data)),
};
