import type { PersonProfile } from "./config";

export type EnrolledPerson = PersonProfile & {
  faceDescriptors: number[][];
  enrolledAt: string;
  updatedAt: string;
};

export type EnrollmentStore = {
  version: 1;
  people: EnrolledPerson[];
};

export const enrollmentStorageKey = "surface-home-kiosk.enrollments.v1";

function emptyStore(): EnrollmentStore {
  return { version: 1, people: [] };
}

function normalizeStore(store: unknown): EnrollmentStore {
  const parsed = store as Partial<EnrollmentStore>;
  if (parsed.version !== 1 || !Array.isArray(parsed.people)) return emptyStore();

  return {
    version: 1,
    people: parsed.people.filter(
      (person): person is EnrolledPerson =>
        typeof person.id === "string" &&
        typeof person.displayName === "string" &&
        Array.isArray(person.faceDescriptors),
    ),
  };
}

export function descriptorToArray(descriptor: Float32Array | number[]) {
  return Array.from(descriptor, (value) => Number(value.toFixed(8)));
}

function loadLocalStorageEnrollments(): EnrollmentStore {
  try {
    const raw = window.localStorage.getItem(enrollmentStorageKey);
    if (!raw) return emptyStore();

    return normalizeStore(JSON.parse(raw));
  } catch (error) {
    console.warn("Could not load local face enrollments", error);
    return emptyStore();
  }
}

function saveLocalStorageEnrollments(store: EnrollmentStore) {
  window.localStorage.setItem(enrollmentStorageKey, JSON.stringify(store));
}

export async function loadEnrollments(): Promise<EnrollmentStore> {
  if (window.surfaceKiosk?.readEnrollments) {
    const store = normalizeStore(await window.surfaceKiosk.readEnrollments());
    if (store.people.length > 0) return store;

    const localStore = loadLocalStorageEnrollments();
    if (localStore.people.length > 0) {
      return normalizeStore(await window.surfaceKiosk.writeEnrollments(localStore));
    }

    return store;
  }

  if (window.location.protocol === "kiosk:" || window.location.protocol === "file:") {
    return emptyStore();
  }

  return loadLocalStorageEnrollments();
}

export async function saveEnrolledPerson(person: EnrolledPerson) {
  const store = await loadEnrollments();
  const withoutExisting = store.people.filter((candidate) => candidate.id !== person.id);
  const nextStore: EnrollmentStore = {
    version: 1,
    people: [...withoutExisting, person],
  };

  if (window.surfaceKiosk?.writeEnrollments) {
    return normalizeStore(await window.surfaceKiosk.writeEnrollments(nextStore));
  }

  if (window.location.protocol === "kiosk:" || window.location.protocol === "file:") {
    throw new Error("Desktop bridge unavailable. Reload the kiosk app and try again.");
  }

  saveLocalStorageEnrollments(nextStore);
  return nextStore;
}

export function mergePeople(
  configured: PersonProfile[],
  enrolled: EnrolledPerson[],
): PersonProfile[] {
  const byId = new Map<string, PersonProfile>();

  for (const person of configured) {
    byId.set(person.id, person);
  }

  for (const local of enrolled) {
    const existing = byId.get(local.id);
    byId.set(local.id, {
      ...existing,
      ...local,
      dashboardPath: local.dashboardPath ?? existing?.dashboardPath,
      dashboardUrl: local.dashboardUrl ?? existing?.dashboardUrl,
      referenceImageUrls: existing?.referenceImageUrls ?? local.referenceImageUrls,
      faceDescriptors: [
        ...(existing?.faceDescriptors ?? []),
        ...local.faceDescriptors,
      ],
    });
  }

  return Array.from(byId.values());
}
