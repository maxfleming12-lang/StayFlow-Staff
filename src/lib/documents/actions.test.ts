import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  MANAGER,
  createSupabaseStub,
  formData,
  hasFilter,
  type SupabaseStub,
} from "@/test/supabase-stub";

/**
 * Storage is not in the shared stub, because documents is the only module
 * that uses it. Records every call so a test can assert which bucket and
 * path an action reached for, and returns scripted results.
 */
interface StorageCall {
  bucket: string;
  method: string;
  args: unknown[];
}

function createStorageStub() {
  const calls: StorageCall[] = [];
  const queued = new Map<string, unknown[]>();

  const result = (method: string, fallback: unknown) => {
    const queue = queued.get(method);
    if (!queue || queue.length === 0) return fallback;
    return queue.length === 1 ? queue[0] : queue.shift();
  };

  return {
    calls,
    on(method: string, value: unknown) {
      const queue = queued.get(method) ?? [];
      queue.push(value);
      queued.set(method, queue);
    },
    callsFor(method: string) {
      return calls.filter((c) => c.method === method);
    },
    api: {
      from(bucket: string) {
        const record = (method: string, args: unknown[], fallback: unknown) => {
          calls.push({ bucket, method, args });
          return Promise.resolve(result(method, fallback));
        };
        return {
          createSignedUploadUrl: (...args: unknown[]) =>
            record("createSignedUploadUrl", args, {
              data: { path: String(args[0]), token: "signed-token" },
              error: null,
            }),
          list: (...args: unknown[]) =>
            record("list", args, { data: [{ name: "found" }], error: null }),
          remove: (...args: unknown[]) => record("remove", args, { error: null }),
        };
      },
    },
  };
}

let stub: SupabaseStub;
let storage: ReturnType<typeof createStorageStub>;

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({
  requireRole: vi.fn(async () => MANAGER),
  requireUser: vi.fn(async () => MANAGER),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => client()),
  createServiceRoleClient: vi.fn(() => client()),
}));

function client() {
  return { ...(stub.client as object), storage: storage.api };
}

beforeEach(() => {
  stub = createSupabaseStub();
  storage = createStorageStub();
  vi.clearAllMocks();
});

const {
  prepareDocumentUpload,
  finaliseDocumentUpload,
  acknowledgeDocument,
  archiveDocument,
} = await import("./actions");
const { requireRole } = await import("@/lib/auth/session");

const DOC = "11111111-1111-4111-8111-111111111111";
const PROPERTY = "33333333-3333-4333-8333-333333333333";
const ORG = MANAGER.organisationId;

const metadata = (over: Record<string, unknown> = {}) => ({
  title: "Fire and emergency procedure",
  folder: "Emergency",
  requiresAck: true,
  audience: "all",
  ...over,
});

const prepareInput = (over: Record<string, unknown> = {}) => ({
  ...metadata(),
  filename: "procedure.pdf",
  size: 12_345,
  mimeType: "application/pdf",
  ...over,
});

const finaliseInput = (over: Record<string, unknown> = {}) => ({
  ...metadata(),
  path: `${ORG}/abc-123.pdf`,
  size: 12_345,
  mimeType: "application/pdf",
  ...over,
});

describe("prepareDocumentUpload", () => {
  it("requires a manager", async () => {
    await prepareDocumentUpload(prepareInput());
    expect(requireRole).toHaveBeenCalledWith("manager");
  });

  it("chooses the path itself, under the caller's organisation", async () => {
    // The browser never supplies the path. If it could, a ticket could be
    // talked into writing over another document or into another
    // organisation's prefix.
    const result = await prepareDocumentUpload(prepareInput());

    const [path] = storage.callsFor("createSignedUploadUrl")[0].args as string[];
    expect(path.startsWith(`${ORG}/`)).toBe(true);
    expect(path.endsWith(".pdf")).toBe(true);
    expect(path).not.toContain("procedure");
    expect(result.ticket).toEqual({ path, token: "signed-token" });
  });

  it("does not build the path from the uploaded filename", async () => {
    await prepareDocumentUpload(
      prepareInput({ filename: "../../etc/passwd", mimeType: "application/pdf" }),
    );

    const [path] = storage.callsFor("createSignedUploadUrl")[0].args as string[];
    expect(path).toBe(`${ORG}/${path.split("/")[1]}`);
    expect(path).not.toContain("..");
    expect(path.endsWith(".bin")).toBe(true);
  });

  it("refuses a file type the bucket would reject, before any upload", async () => {
    const result = await prepareDocumentUpload(
      prepareInput({ mimeType: "application/x-msdownload", filename: "setup.exe" }),
    );

    expect(result.fieldErrors?.file).toBeTruthy();
    expect(storage.callsFor("createSignedUploadUrl")).toHaveLength(0);
  });

  it("refuses a file past the size limit", async () => {
    const result = await prepareDocumentUpload(
      prepareInput({ size: 26_214_401 }),
    );

    expect(result.fieldErrors?.file).toContain("25 MB");
    expect(storage.callsFor("createSignedUploadUrl")).toHaveLength(0);
  });

  it("reports which field is wrong rather than a bare failure", async () => {
    const result = await prepareDocumentUpload(prepareInput({ title: "  " }));
    expect(result.fieldErrors?.title).toBe("Give the document a title.");
    expect(result.ticket).toBeUndefined();
  });

  it("insists on a property when the document is for one property", async () => {
    const result = await prepareDocumentUpload(
      prepareInput({ audience: "property", propertyId: undefined }),
    );

    expect(result.fieldErrors?.propertyId).toBeTruthy();
    expect(storage.callsFor("createSignedUploadUrl")).toHaveLength(0);
  });

  it("names the likely cause when the bucket is missing", async () => {
    // The commonest failure on a fresh deployment by a wide margin, and one
    // nobody guesses from "could not start the upload".
    storage.on("createSignedUploadUrl", {
      data: null,
      error: { message: "Bucket not found" },
    });

    const result = await prepareDocumentUpload(prepareInput());

    expect(result.error).toContain("Bucket not found");
    expect(result.error).toContain("0016");
  });
});

describe("finaliseDocumentUpload", () => {
  it("refuses a path outside the caller's organisation", async () => {
    // The path comes back through the browser, so it is not trusted. Without
    // this a crafted call could attach a document row to another
    // organisation's file.
    const result = await finaliseDocumentUpload(
      finaliseInput({ path: "someone-else/abc-123.pdf" }),
    );

    expect(result.error).toBeTruthy();
    expect(stub.opsFor("documents", "insert")).toHaveLength(0);
  });

  it("confirms the file is really in the bucket before recording it", async () => {
    storage.on("list", { data: [], error: null });

    const result = await finaliseDocumentUpload(finaliseInput());

    expect(result.error).toContain("did not finish uploading");
    expect(stub.opsFor("documents", "insert")).toHaveLength(0);
  });

  it("records the document once the file is there", async () => {
    stub.on("documents", "insert", { data: { id: DOC }, error: null });

    const result = await finaliseDocumentUpload(finaliseInput());

    const insert = stub.onlyOp("documents", "insert").payload as Record<string, unknown>;
    expect(insert.organisation_id).toBe(ORG);
    expect(insert.storage_path).toBe(`${ORG}/abc-123.pdf`);
    expect(insert.created_by).toBe(MANAGER.id);
    expect(insert.requires_ack).toBe(true);
    expect(result.success).toBeTruthy();
  });

  it("leaves property_id null for an all-staff document", async () => {
    stub.on("documents", "insert", { data: { id: DOC }, error: null });

    await finaliseDocumentUpload(finaliseInput());

    const insert = stub.onlyOp("documents", "insert").payload as Record<string, unknown>;
    expect(insert.property_id).toBeNull();

    const permission = stub.onlyOp("document_permissions", "insert")
      .payload as Record<string, unknown>;
    expect(permission.role).toBe("staff");
    expect(permission.property_id).toBeUndefined();
  });

  it("scopes a property document to that property", async () => {
    stub.on("documents", "insert", { data: { id: DOC }, error: null });

    await finaliseDocumentUpload(
      finaliseInput({ audience: "property", propertyId: PROPERTY }),
    );

    const insert = stub.onlyOp("documents", "insert").payload as Record<string, unknown>;
    expect(insert.property_id).toBe(PROPERTY);

    const permission = stub.onlyOp("document_permissions", "insert")
      .payload as Record<string, unknown>;
    expect(permission.property_id).toBe(PROPERTY);
    expect(permission.role).toBeUndefined();
  });

  it("removes the row and the file when sharing fails", async () => {
    // A document with no permission row is invisible to everyone but
    // management, which is not what was asked for and gives no sign of
    // having gone wrong.
    stub.on("documents", "insert", { data: { id: DOC }, error: null });
    stub.on("document_permissions", "insert", {
      data: null,
      error: { message: "permission denied" },
    });

    const result = await finaliseDocumentUpload(finaliseInput());

    expect(result.error).toContain("removed");
    expect(hasFilter(stub.onlyOp("documents", "delete"), "eq", "id", DOC)).toBe(true);
    expect(storage.callsFor("remove")).toHaveLength(1);
  });

  it("removes the orphaned file when the row cannot be written", async () => {
    stub.on("documents", "insert", {
      data: null,
      error: { message: "null value in column" },
    });

    const result = await finaliseDocumentUpload(finaliseInput());

    expect(result.error).toContain("null value in column");
    expect(storage.callsFor("remove")).toHaveLength(1);
    expect(stub.opsFor("document_permissions", "insert")).toHaveLength(0);
  });
});

describe("acknowledgeDocument", () => {
  it("records the caller's own acknowledgement, not somebody else's", async () => {
    await acknowledgeDocument({}, formData({ id: DOC }));

    const upsert = stub.onlyOp("document_acknowledgements", "upsert")
      .payload as Record<string, unknown>;
    expect(upsert.user_id).toBe(MANAGER.id);
    expect(upsert.document_id).toBe(DOC);
    expect(upsert.organisation_id).toBe(ORG);
    expect(upsert.acknowledged_at).toBeTruthy();
  });

  it("is safe to press twice", async () => {
    // Upserting on (document, user) means a double tap on a phone records
    // one acknowledgement, not a duplicate-key error shown as a failure.
    await acknowledgeDocument({}, formData({ id: DOC }));

    const op = stub.onlyOp("document_acknowledgements", "upsert");
    expect(op.payload).toBeTruthy();
    expect(op.verb).toBe("upsert");
  });

  it("rejects an id that is not a document id", async () => {
    const result = await acknowledgeDocument({}, formData({ id: "not-a-uuid" }));

    expect(result.error).toBeTruthy();
    expect(stub.opsFor("document_acknowledgements")).toHaveLength(0);
  });
});

describe("archiveDocument", () => {
  it("archives rather than deleting, so acknowledgements keep their meaning", async () => {
    stub.on("documents", "update", { data: { id: DOC }, error: null });

    const result = await archiveDocument({}, formData({ id: DOC }));

    const update = stub.onlyOp("documents", "update");
    expect((update.payload as Record<string, unknown>).archived_at).toBeTruthy();
    expect(hasFilter(update, "eq", "id", DOC)).toBe(true);
    expect(stub.opsFor("documents", "delete")).toHaveLength(0);
    expect(result.success).toBeTruthy();
  });

  it("never removes the file from the bucket", async () => {
    stub.on("documents", "update", { data: { id: DOC }, error: null });

    await archiveDocument({}, formData({ id: DOC }));

    expect(storage.callsFor("remove")).toHaveLength(0);
  });

  it("will not archive a document twice", async () => {
    stub.on("documents", "update", { data: null, error: null });

    const result = await archiveDocument({}, formData({ id: DOC }));

    expect(result.error).toContain("already been removed");
    expect(
      hasFilter(stub.onlyOp("documents", "update"), "is", "archived_at", null),
    ).toBe(true);
  });

  it("requires a manager", async () => {
    stub.on("documents", "update", { data: { id: DOC }, error: null });

    await archiveDocument({}, formData({ id: DOC }));

    expect(requireRole).toHaveBeenCalledWith("manager");
  });
});
