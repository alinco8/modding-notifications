import { z } from "zod";

export const VersionManifestV2Schema = z.object({
  latest: z.object({
    release: z.string(),
    snapshot: z.string(),
  }),
  versions: z.array(
    z.object({
      id: z.string(),
      type: z.string(),
      url: z.string(),
      time: z.string(),
      releaseTime: z.string(),
      sha1: z.string(),
      complianceLevel: z.number(),
    }),
  ),
});
