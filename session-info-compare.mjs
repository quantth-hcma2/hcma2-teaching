// GATE 2B-RT-FIX1: key-order-independent deep equality + optimistic-concurrency conflict check,
// extracted out of index.html's saveSessionInfo() so both the production code and this module's
// test suite import the exact same implementation — no drift, no eval/regex-extraction fragility.
//
// GATE 2B-RT-PROD production finding: the previous inline implementation compared object values
// via JSON.stringify(a)===JSON.stringify(b), which is key-order-sensitive. Firestore returns the
// SAME stored document with different field ordering depending on the read path (a transaction's
// tx.get() vs. a plain getDoc()), so two reads of an unchanged RichText value could stringify
// differently and trip a false "changed in another window" conflict — this blocked every second
// save of an already-Rich-formatted field. valuesEqualDeep now compares semantically: object key
// order is irrelevant, array order is significant, values are compared recursively by type/content.
//
// Audited call sites (GATE 2B-RT-FIX1, see index.html's saveSessionInfo): only the `edits` filter
// and the per-row conflict check. Real values reaching this module are always JSON-safe —
// string/number/boolean/null/undefined, or plain objects/arrays built from those
// (SESSION_INFO_FIELDS scalars: title/description/instructions/topic/targetSubmissions, or a
// validated RichText V1 value under instructionsRich/topicRich). No Firestore
// Timestamp/DocumentReference/GeoPoint or Date ever reaches it — none of those keys are ever
// assigned one. A non-plain object (anything with a prototype other than Object.prototype/null, or
// a class instance) is therefore deliberately NOT given invented equality semantics — it fails
// closed as unequal unless it is the exact same reference, the same conservative behavior as the
// code this replaces.
export function valuesEqualDeep(a,b){
  if(a===b) return true;
  if(typeof a==="number" && typeof b==="number") return Number.isNaN(a) && Number.isNaN(b);
  if(a===null || a===undefined || b===null || b===undefined) return false;
  if(typeof a!==typeof b) return false;
  if(typeof a!=="object") return false;
  const aIsArray=Array.isArray(a), bIsArray=Array.isArray(b);
  if(aIsArray!==bIsArray) return false;
  if(aIsArray){
    if(a.length!==b.length) return false;
    for(let i=0;i<a.length;i++) if(!valuesEqualDeep(a[i],b[i])) return false;
    return true;
  }
  const isPlainProto=p=>p===Object.prototype || p===null;
  if(!isPlainProto(Object.getPrototypeOf(a)) || !isPlainProto(Object.getPrototypeOf(b))) return false;
  const aKeys=Object.keys(a), bKeys=Object.keys(b);
  if(aKeys.length!==bKeys.length) return false;
  for(const k of aKeys){
    if(!Object.prototype.hasOwnProperty.call(b,k)) return false;
    if(!valuesEqualDeep(a[k],b[k])) return false;
  }
  return true;
}

// findConflictKey(patch, latest, original): the exact optimistic-concurrency decision
// saveSessionInfo's transaction makes for one row. `patch` is the set of fields this save is
// about to write; `latest` is the row's current server data (read inside the transaction);
// `original` is the row's data as it was when the edit modal was opened. A key is a genuine
// conflict only when the server's current value for it differs from BOTH what the modal started
// from AND what this save is about to write — i.e. some other write landed in between, and it
// didn't happen to already write the same value this save wants to write. Returns the first
// conflicting key found (object key order in `patch` is insertion order, matching the original
// inline loop's behavior), or null when there is no conflict.
export function findConflictKey(patch, latest, original){
  for(const key of Object.keys(patch)){
    if(!valuesEqualDeep(latest?.[key], original?.[key]) && !valuesEqualDeep(latest?.[key], patch[key]))
      return key;
  }
  return null;
}
