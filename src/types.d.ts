declare module "bun" {
  interface Env {
    DISCORD_BOT_TOKEN?: string;
    MODRINTH_API_TOKEN?: string;
  }
}
