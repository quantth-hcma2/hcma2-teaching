// Shared helpers for the P4-S4 suites (commit / recovery / rollback controller). Synthetic data only; the emulator suites run the REAL controller against the PRODUCTION Rules artifact.
import { startAfter, getDocFromServer, getDocsFromServer, runTransaction } from "firebase/firestore";
import {
  doc, setDoc, updateDoc, getDoc, getDocs, deleteDoc, collection, query, where, limit, orderBy, documentId, writeBatch, serverTimestamp, Timestamp
} from "../library-v2-p3-s1/helpers.mjs";
import { validateRaw } from "../library-v2-p4-s2/helpers.mjs";
import { prepareCommit } from "../../import-plan.mjs";

export const BATCH = "Ab12Cd34Ef56Gh78Ij90";
export const BASE_FS = { collection, doc, getDocFromServer, getDocsFromServer, runTransaction, query, where, limit, orderBy, startAfter, documentId, writeBatch, setDoc, updateDoc, deleteDoc, serverTimestamp };
export { doc, getDoc, getDocs, collection, query, where, limit, orderBy, documentId, setDoc, updateDoc, deleteDoc, serverTimestamp, Timestamp, writeBatch };

// big(3, 20) -> 3 subjects, 20 lessons each (63 nodes)
export const big = (subjectsCount, lessonsPer) => {
  const subjects = Array.from({ length: subjectsCount }, (_, i) => ["S" + i, "Môn " + i, i]);
  const lessons = [];
  for (let s = 0; s < subjectsCount; s++) for (let l = 0; l < lessonsPer; l++) lessons.push(["S" + s, "S" + s + "-L" + l, "Bài " + l, l]);
  return { subjects, lessons };
};
export function planFor(options, { batchId = BATCH, organization = "orgA", actorUid = "pa", status = "active" } = {}) {
  const r = validateRaw(options);
  if (!r.ok) throw new Error("fixture invalid: " + JSON.stringify(r.diagnostics));
  const prepared = prepareCommit(r.model, { organization: { id: organization, status }, batchId, actorUid });
  if (!prepared.ok) throw new Error("plan failed: " + JSON.stringify(prepared.diagnostics));
  return prepared.plan;
}
export const allowAlways = (actorUid) => Object.assign(async () => ({ allowed: true }), { actorUid });

// Fault injection around the Firestore functions the controller receives. `hooks.commit(ctx)` / `hooks.write(ctx)` may throw, hang (return a never-settling promise) or let the call proceed.
//   ctx.commitIndex counts atomic node/delete commits (1-based); ctx.ops = [{ type: "set"|"delete", path }]; ctx.perform() really performs the commit.
export function faulty(base, hooks = {}, counters = {}) {
  counters.commits = 0; counters.writes = 0; counters.reads = 0;
  return {
    ...base,
    getDocFromServer: (...args) => { counters.reads++; return base.getDocFromServer(...args); },
    getDocsFromServer: (...args) => { counters.reads++; return base.getDocsFromServer(...args); },
    // hooks.afterReads({ attempt }) runs INSIDE a transaction callback after the callback finished reading/queuing and before the SDK commits: the exact "read -> commit" interval
    runTransaction: (db, fn, options) => { counters.tx = 0; return base.runTransaction(db, async (tx) => { const attempt = ++counters.tx; const result = await fn(tx); if (hooks.afterReads) await hooks.afterReads({ attempt }); return result; }, options); },
    writeBatch: (db) => {
      const inner = base.writeBatch(db); const ops = [];
      return {
        set: (ref, data) => { ops.push({ type: "set", path: ref.path }); inner.set(ref, data); return undefined; },
        delete: (ref) => { ops.push({ type: "delete", path: ref.path }); inner.delete(ref); return undefined; },
        update: (ref, data) => { ops.push({ type: "update", path: ref.path }); inner.update(ref, data); return undefined; },
        commit: async () => { const ctx = { commitIndex: ++counters.commits, ops, perform: () => inner.commit() }; return hooks.commit ? hooks.commit(ctx) : ctx.perform(); }
      };
    },
    setDoc: (ref, data) => { const ctx = { op: "setDoc", path: ref.path, writeIndex: ++counters.writes, perform: () => base.setDoc(ref, data) }; return hooks.write ? hooks.write(ctx) : ctx.perform(); },
    updateDoc: (ref, data) => { const ctx = { op: "updateDoc", path: ref.path, data, writeIndex: ++counters.writes, perform: () => base.updateDoc(ref, data) }; return hooks.write ? hooks.write(ctx) : ctx.perform(); },
    deleteDoc: (ref) => { const ctx = { op: "deleteDoc", path: ref.path, writeIndex: ++counters.writes, perform: () => base.deleteDoc(ref) }; return hooks.write ? hooks.write(ctx) : ctx.perform(); }
  };
}
export const transientError = () => Object.assign(new Error("unavailable"), { code: "unavailable" });
export const never = () => new Promise(() => {});
export const noSleep = async () => {};
