import { LspClient, type Transport } from "./client";
import type { LanguageId } from "./language";
import { serverConfigFor } from "./serverConfig";

export type SpawnedProcess = {
  transport: Transport;
  pid: number;
  kill(): void;
};

export type Spawner = (command: string, args: string[]) => SpawnedProcess;

export type ClientResult =
  | { kind: "ready"; client: LspClient }
  | { kind: "unsupported" }
  | { kind: "missing-binary"; binary: string };

type Slot = {
  process: SpawnedProcess;
  client: LspClient;
  ready: Promise<void>;
};

export class LspGateway {
  private slots = new Map<LanguageId, Slot>();

  constructor(private opts: { spawner: Spawner; rootUri: string }) {}

  async getClient(language: LanguageId | null | undefined): Promise<ClientResult> {
    const config = serverConfigFor(language);
    if (!config || !language) return { kind: "unsupported" };

    const existing = this.slots.get(language);
    if (existing) {
      await existing.ready;
      return { kind: "ready", client: existing.client };
    }

    let process: SpawnedProcess;
    try {
      process = this.opts.spawner(config.command, config.args);
    } catch (e) {
      if ((e as NodeJS.ErrnoException)?.code === "ENOENT") {
        return { kind: "missing-binary", binary: config.command };
      }
      throw e;
    }

    const client = new LspClient(process.transport);
    const ready = client.initialize({ rootUri: this.opts.rootUri }).then(() => {});
    const slot: Slot = { process, client, ready };
    this.slots.set(language, slot);
    await ready;
    return { kind: "ready", client };
  }

  async shutdown(): Promise<void> {
    const slots = [...this.slots.values()];
    this.slots.clear();
    for (const slot of slots) {
      await slot.client.shutdown();
      slot.client.dispose();
      slot.process.kill();
    }
  }
}
