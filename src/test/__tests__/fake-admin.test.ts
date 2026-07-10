import { beforeEach, describe, expect, it } from "vitest";
import { fakeDb, resetFakeDb } from "@/test/fake-admin";

describe("FakeDb", () => {
  beforeEach(resetFakeDb);

  it("set/get/update/delete a doc", async () => {
    fakeDb.doc("contacts/c1").set({ name: "Ann", tags: ["a"] });
    let snap = await fakeDb.doc("contacts/c1").get();
    expect(snap.exists).toBe(true);
    expect(snap.data()).toEqual({ name: "Ann", tags: ["a"] });
    await fakeDb.doc("contacts/c1").update({ name: "Ann B" });
    snap = await fakeDb.doc("contacts/c1").get();
    expect(snap.data()?.name).toBe("Ann B");
    await fakeDb.doc("contacts/c1").delete();
    snap = await fakeDb.doc("contacts/c1").get();
    expect(snap.exists).toBe(false);
  });

  it("filters with where == and array-contains, respects limit", async () => {
    fakeDb.doc("contacts/c1").set({ subAccountId: "s1", tags: ["box1"] });
    fakeDb.doc("contacts/c2").set({ subAccountId: "s1", tags: [] });
    fakeDb.doc("contacts/c3").set({ subAccountId: "s2", tags: ["box1"] });
    const snap = await fakeDb
      .collection("contacts")
      .where("subAccountId", "==", "s1")
      .where("tags", "array-contains", "box1")
      .get();
    expect(snap.size).toBe(1);
    expect(snap.docs[0].id).toBe("c1");
    const limited = await fakeDb.collection("contacts").limit(2).get();
    expect(limited.size).toBe(2);
  });

  it("add() returns a ref with a generated id", async () => {
    const ref = await fakeDb.collection("deals").add({ title: "T" });
    const snap = await fakeDb.doc(`deals/${ref.id}`).get();
    expect(snap.data()?.title).toBe("T");
  });

  it("runTransaction exposes get/set/update", async () => {
    fakeDb.doc("k/u").set({ n: 1 });
    await fakeDb.runTransaction(async (tx) => {
      const s = await tx.get(fakeDb.doc("k/u"));
      tx.set(fakeDb.doc("k/u"), { n: (s.data()?.n as number) + 1 }, { merge: true });
    });
    expect((await fakeDb.doc("k/u").get()).data()?.n).toBe(2);
  });
});
