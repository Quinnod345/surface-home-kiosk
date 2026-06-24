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

export function descriptorToArray(descriptor: Float32Array | number[]) {
  return Array.from(descriptor, (value) => Number(value.toFixed(8)));
}

export function loadEnrollments(): EnrollmentStore {
  try {
    const raw = window.localStorage.getItem(enrollmentStorageKey);
    if (!raw) return emptyStore();

    const parsed = JSON.parse(raw) as Partial<EnrollmentStore>;
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
  } catch (error) {
    console.warn("Could not load local face enrollments", error);
    return emptyStore();
  }
}

export function saveEnrolledPerson(person: EnrolledPerson) {
  const store = loadEnrollments();
  const withoutExisting = store.people.filter((candidate) => candidate.id !== person.id);
  const nextStore: EnrollmentStore = {
    version: 1,
    people: [...withoutExisting, person],
  };
  window.localStorage.setItem(enrollmentStorageKey, JSON.stringify(nextStore));
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
