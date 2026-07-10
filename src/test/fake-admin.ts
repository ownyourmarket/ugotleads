/**
 * Minimal in-memory stand-in for the Firestore Admin SDK — just enough
 * surface for the agent-api routes. Not a general-purpose fake.
 * FieldValue sentinels (serverTimestamp etc.) are stored as-is; tests
 * must not assert on timestamp fields.
 */
type DocData = Record<string, unknown>;

// Deep clone for snapshot reads: arrays copied, plain objects recursed;
// class instances (e.g. FieldValue sentinels) pass through by reference.
function cloneData(data: DocData): DocData {
  const out: DocData = {};
  for (const [k, v] of Object.entries(data)) {
    out[k] = Array.isArray(v)
      ? [...v]
      : v && typeof v === "object" && v.constructor === Object
        ? cloneData(v as DocData)
        : v;
  }
  return out;
}

interface FakeSnap {
  id: string;
  exists: boolean;
  ref: FakeDocRef;
  data(): DocData | undefined;
}

export class FakeDocRef {
  constructor(
    private db: FakeDb,
    public path: string
  ) {}

  get id(): string {
    return this.path.split("/").pop() as string;
  }

  async get(): Promise<FakeSnap> {
    const data = this.db.store.get(this.path);
    return {
      id: this.id,
      exists: data !== undefined,
      ref: this,
      data: () => (data ? cloneData(data) : undefined),
    };
  }

  set(data: DocData, opts?: { merge?: boolean }): Promise<void> {
    const existing = this.db.store.get(this.path);
    this.db.store.set(
      this.path,
      opts?.merge && existing ? { ...existing, ...data } : { ...data }
    );
    return Promise.resolve();
  }

  async update(data: DocData): Promise<void> {
    const existing = this.db.store.get(this.path);
    if (!existing) throw new Error(`update on missing doc ${this.path}`);
    this.db.store.set(this.path, { ...existing, ...data });
  }

  async delete(): Promise<void> {
    this.db.store.delete(this.path);
  }

  /** Mirrors Admin SDK create(): rejects with gRPC code 6 (ALREADY_EXISTS). */
  async create(data: DocData): Promise<void> {
    if (this.db.store.has(this.path)) {
      throw Object.assign(new Error(`ALREADY_EXISTS: ${this.path}`), {
        code: 6,
      });
    }
    this.db.store.set(this.path, { ...data });
  }
}

type Filter = { field: string; op: "==" | "array-contains"; value: unknown };

class FakeQuery {
  constructor(
    private db: FakeDb,
    private collectionPath: string,
    private filters: Filter[] = [],
    private limitN: number | null = null
  ) {}

  where(field: string, op: "==" | "array-contains", value: unknown): FakeQuery {
    return new FakeQuery(
      this.db,
      this.collectionPath,
      [...this.filters, { field, op, value }],
      this.limitN
    );
  }

  limit(n: number): FakeQuery {
    return new FakeQuery(this.db, this.collectionPath, this.filters, n);
  }

  select(..._fields: string[]): FakeQuery {
    return this; // projection is a perf detail; the fake returns full docs
  }

  async get(): Promise<{ empty: boolean; size: number; docs: FakeSnap[] }> {
    const prefix = `${this.collectionPath}/`;
    let docs: FakeSnap[] = [];
    for (const [path, data] of this.db.store) {
      if (!path.startsWith(prefix)) continue;
      if (path.slice(prefix.length).includes("/")) continue; // exclude subcollections
      const matches = this.filters.every((f) => {
        // Support nested fields like "trigger.type"
        const keys = f.field.split(".");
        let v = data as unknown;
        for (const key of keys) {
          if (v && typeof v === "object") {
            v = (v as Record<string, unknown>)[key];
          } else {
            v = undefined;
            break;
          }
        }
        if (f.op === "==") return v === f.value;
        return Array.isArray(v) && v.includes(f.value);
      });
      if (!matches) continue;
      const ref = new FakeDocRef(this.db, path);
      docs.push({ id: ref.id, exists: true, ref, data: () => cloneData(data) });
    }
    if (this.limitN !== null) docs = docs.slice(0, this.limitN);
    return { empty: docs.length === 0, size: docs.length, docs };
  }

  async add(data: DocData): Promise<FakeDocRef> {
    const id = `fake${(this.db.nextId++).toString(36).padStart(6, "0")}`;
    const ref = new FakeDocRef(this.db, `${this.collectionPath}/${id}`);
    await ref.set(data);
    return ref;
  }

  doc(id?: string): FakeDocRef {
    const docId =
      id ?? `fake${(this.db.nextId++).toString(36).padStart(6, "0")}`;
    return new FakeDocRef(this.db, `${this.collectionPath}/${docId}`);
  }
}

export class FakeDb {
  store = new Map<string, DocData>();
  nextId = 1;

  doc(path: string): FakeDocRef {
    return new FakeDocRef(this, path);
  }

  collection(path: string): FakeQuery {
    return new FakeQuery(this, path);
  }

  async runTransaction<T>(
    fn: (tx: {
      // Accepts a doc ref OR a query — anything with .get() (mirrors real tx.get overloads).
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      get: (refOrQuery: { get(): Promise<any> }) => Promise<any>;
      set: (ref: FakeDocRef, data: DocData, opts?: { merge?: boolean }) => void;
      update: (ref: FakeDocRef, data: DocData) => void;
    }) => Promise<T>
  ): Promise<T> {
    return fn({
      get: (refOrQuery) => refOrQuery.get(),
      set: (ref, data, opts) => void ref.set(data, opts),
      update: (ref, data) => void ref.update(data),
    });
  }
}

export const fakeDb = new FakeDb();

export function resetFakeDb(): void {
  fakeDb.store.clear();
  fakeDb.nextId = 1;
}
