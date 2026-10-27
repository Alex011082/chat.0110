import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import type { Span } from "./privacy.ts";

// Один процесс под существующим systemd-сервисом: текст не уходит в сеть.
export class LocalEntities {
  private child?: ChildProcessWithoutNullStreams;
  private pending?: { resolve: (spans: Span[]) => void; reject: () => void };
  private tail: Promise<unknown> = Promise.resolve();
  private waiting = 0;
  private ready?: Promise<void>;

  scan = async (text: string): Promise<Span[]> => {
    if (this.waiting >= 32) throw new Error("scanner busy");
    this.waiting++;
    const work = this.tail.then(async () => {
      await this.start();
      return new Promise<Span[]>((resolve, reject) => {
        const timer = setTimeout(() => { this.stop(); reject(new Error("scanner timeout")); }, 30_000);
        this.pending = { resolve: (spans) => { clearTimeout(timer); resolve(spans); }, reject: () => { clearTimeout(timer); reject(new Error("scanner unavailable")); } };
        this.child!.stdin.write(JSON.stringify({ text }) + "\n");
      });
    }).finally(() => { this.waiting--; });
    this.tail = work.catch(() => {});
    return work;
  };

  private start(): Promise<void> {
    if (this.ready) return this.ready;
    this.ready = new Promise<void>((resolve, reject) => {
      const child = spawn(process.env.CHAT0110_PRIVACY_PYTHON ?? "/var/lib/chat0110/privacy-venv/bin/python", [fileURLToPath(new URL("../privacy/worker.py", import.meta.url))], {
        env: {
          PATH: process.env.PATH ?? "/usr/bin:/bin",
          HF_HOME: process.env.HF_HOME ?? "/var/lib/chat0110/privacy-cache",
          ...(process.env.CHAT0110_PRIVACY_MODEL ? { CHAT0110_PRIVACY_MODEL: process.env.CHAT0110_PRIVACY_MODEL } : {}),
          HF_HUB_OFFLINE: "1", TRANSFORMERS_OFFLINE: "1", PYTHONDONTWRITEBYTECODE: "1", TOKENIZERS_PARALLELISM: "false",
        },
        stdio: ["pipe", "pipe", "pipe"],
      });
      this.child = child;
      // Библиотеки могут печатать исключения с фрагментами ввода: stderr не журналируем.
      child.stderr.resume();
      const timer = setTimeout(() => { this.stop(); reject(new Error("scanner startup timeout")); }, 120_000);
      const fail = () => { clearTimeout(timer); if (this.child === child) this.stop(); reject(new Error("scanner unavailable")); };
      child.on("error", fail);
      child.on("exit", fail);
      child.stdin.on("error", fail);
      const lines = createInterface({ input: child.stdout });
      lines.on("line", (line) => {
        try {
          const value = JSON.parse(line);
          if (value.ready === true) { clearTimeout(timer); resolve(); return; }
          if (!this.pending || !Array.isArray(value.spans)) { fail(); return; }
          const pending = this.pending;
          this.pending = undefined;
          pending.resolve(value.spans);
        } catch { fail(); }
      });
    });
    return this.ready;
  }
  stop() {
    const child = this.child;
    this.child = undefined;
    this.ready = undefined;
    this.pending?.reject();
    this.pending = undefined;
    if (child && !child.killed) child.kill();
  }
}
