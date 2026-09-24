const EMULATOR_PROJECT_ID = "demo-hcma2-production-prep";
const PRODUCTION_PROJECT_ID = "bo-phieu-hcma2";
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1"]);
const PRODUCTION_HOSTS = new Set(["teaching.quantth.vn"]);

const productionFirebaseConfig = Object.freeze({
  apiKey: "AIzaSyCLApl_uMpJFttUFjy4ZgFIyIq3y9XA8ZA",
  authDomain: "bo-phieu-hcma2.firebaseapp.com",
  projectId: PRODUCTION_PROJECT_ID,
  storageBucket: "bo-phieu-hcma2.firebasestorage.app",
  messagingSenderId: "233841168130",
  appId: "1:233841168130:web:a5fbe30520c55c4fae3c1b",
  measurementId: "G-GH9TNBMN4M"
});

const emulatorFirebaseConfig = Object.freeze({
  apiKey: "demo-key",
  authDomain: `${EMULATOR_PROJECT_ID}.firebaseapp.com`,
  projectId: EMULATOR_PROJECT_ID,
  // The Storage Emulator and @firebase/rules-unit-testing use the demo project id itself as
  // the default bucket. Keep browser E2E and Rules fixtures on the same local-only bucket.
  storageBucket: EMULATOR_PROJECT_ID,
  messagingSenderId: "000000000000",
  appId: "1:000000000000:web:demo"
});

function assertProject(config, expectedProjectId) {
  if (!config || config.projectId !== expectedProjectId) {
    throw new Error("Cấu hình Firebase không khớp môi trường HCMA2 Teaching.");
  }
}

export async function resolveCandidateEnvironment(locationLike) {
  const hostname = String(locationLike?.hostname || "").toLowerCase();
  const params = new URLSearchParams(locationLike?.search || "");
  const wantsEmulator = params.get("emulator") === "1";

  if (LOOPBACK_HOSTS.has(hostname)) {
    if (!wantsEmulator) throw new Error("Bản thử cục bộ bắt buộc có ?emulator=1.");
    assertProject(emulatorFirebaseConfig, EMULATOR_PROJECT_ID);
    return Object.freeze({
      name: "emulator",
      projectId: EMULATOR_PROJECT_ID,
      firebaseConfig: emulatorFirebaseConfig,
      useEmulators: true,
      emulator: Object.freeze({
        authUrl: "http://127.0.0.1:9099",
        firestoreHost: "127.0.0.1",
        firestorePort: 8080,
        storageHost: "127.0.0.1",
        storagePort: 9199
      }),
      aiGatewayUrl: "http://127.0.0.1:1/disabled-in-emulator-production-prep"
    });
  }

  if (PRODUCTION_HOSTS.has(hostname)) {
    if (wantsEmulator) throw new Error("Không cho phép tham số Emulator trên domain production.");
    assertProject(productionFirebaseConfig, PRODUCTION_PROJECT_ID);
    return Object.freeze({
      name: "production",
      projectId: PRODUCTION_PROJECT_ID,
      firebaseConfig: productionFirebaseConfig,
      useEmulators: false,
      emulator: null,
      aiGatewayUrl: "https://asia-southeast1-bo-phieu-hcma2.cloudfunctions.net/aiGateway"
    });
  }

  throw new Error("Bản chuẩn bị production chỉ được chạy trên Emulator cục bộ hoặc teaching.quantth.vn.");
}

export function candidateGroupJoinUrl(locationLike, code, environment) {
  const url = new URL(String(locationLike.href));
  url.hash = "";
  url.search = "";
  if (environment?.useEmulators) url.searchParams.set("emulator", "1");
  url.searchParams.set("group", String(code));
  return url.toString();
}

export const CANDIDATE_ENVIRONMENT_POLICY = Object.freeze({
  emulatorProjectId: EMULATOR_PROJECT_ID,
  productionProjectId: PRODUCTION_PROJECT_ID,
  productionHosts: Object.freeze([...PRODUCTION_HOSTS])
});
