import type { SnapshotAsset } from "@/anywidget/client";

type SnapshotLoad = (selectionId: string) => Promise<SnapshotAsset>;

type SnapshotEntry = {
  promise: Promise<SnapshotAsset>;
  leases: number;
  settled: boolean;
};

export type SelectionSnapshotLease = {
  readonly asset: Promise<SnapshotAsset>;
  release: () => void;
};

export class SelectionSnapshotLoader {
  readonly #load: SnapshotLoad;
  readonly #entries = new Map<string, SnapshotEntry>();

  constructor(load: SnapshotLoad) {
    this.#load = load;
  }

  acquire(selectionId: string, sha256: string): SelectionSnapshotLease {
    const key = snapshotKey(selectionId, sha256);
    let entry = this.#entries.get(key);
    if (!entry) {
      const created: SnapshotEntry = {
        promise: Promise.resolve().then(async () => {
          const asset = await this.#load(selectionId);
          if (asset.snapshot.sha256 !== sha256) {
            throw new Error("Snapshot changed before the preview loaded");
          }
          return asset;
        }),
        leases: 0,
        settled: false,
      };
      entry = created;
      this.#entries.set(key, entry);
      void entry.promise.then(
        () => this.#settle(key, created),
        () => this.#settle(key, created),
      );
    }
    entry.leases += 1;

    let released = false;
    return {
      asset: entry.promise,
      release: () => {
        if (released) return;
        released = true;
        entry.leases -= 1;
        if (entry.leases === 0 && entry.settled && this.#entries.get(key) === entry) {
          this.#entries.delete(key);
        }
      },
    };
  }

  clear(): void {
    this.#entries.clear();
  }

  #settle(key: string, entry: SnapshotEntry): void {
    entry.settled = true;
    if (entry.leases === 0 && this.#entries.get(key) === entry) this.#entries.delete(key);
  }
}

function snapshotKey(selectionId: string, sha256: string): string {
  return `${selectionId}:${sha256}`;
}
