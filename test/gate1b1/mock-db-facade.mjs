// Minimal in-memory implementation of the db facade session-reader.mjs expects, for fast
// pure-fixture tests that need no Firestore emulator. Also tracks every path touched so
// tests can assert a legacy session never reads configVersions/enrollments.

export function createMockDb(initial) {
  const store = new Map(Object.entries(initial || {}));
  const touched = [];

  function matchWhere(data, where) {
    if (!where) return true;
    return where.every(([field, op, value]) => {
      const actual = data[field];
      if (op === "==" || !op) return actual === value;
      throw new Error(`mock db facade does not support operator ${op}`);
    });
  }

  return {
    touched,
    async getDoc(path) {
      touched.push({ op: "get", path });
      const exists = store.has(path);
      const data = exists ? { ...store.get(path) } : null;
      return { exists, data, id: path.split("/").pop() };
    },
    async listDocs(path, opts) {
      touched.push({ op: "list", path });
      const prefix = path.endsWith("/") ? path : path + "/";
      const results = [];
      for (const [key, value] of store.entries()) {
        if (!key.startsWith(prefix)) continue;
        const rest = key.slice(prefix.length);
        if (rest.includes("/")) continue; // direct children only
        results.push({ id: rest, data: { ...value } });
      }
      return results.filter(r => matchWhere(r.data, opts && opts.where));
    },
    _set(path, data) { store.set(path, data); },
    _delete(path) { store.delete(path); }
  };
}
