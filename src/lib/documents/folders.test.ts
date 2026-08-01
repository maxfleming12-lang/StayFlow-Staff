import { describe, expect, it } from "vitest";
import {
  ALLOWED_MIME_TYPES,
  DOCUMENT_FOLDERS,
  MAX_DOCUMENT_BYTES,
  checkFile,
  extensionOf,
  formatBytes,
  isDocumentFolder,
  storagePathFor,
} from "./folders";

const ORG = "11111111-1111-4111-8111-111111111111";
const DOC = "22222222-2222-4222-8222-222222222222";

describe("isDocumentFolder", () => {
  it("accepts the real folders", () => {
    for (const folder of DOCUMENT_FOLDERS) {
      expect(isDocumentFolder(folder)).toBe(true);
    }
  });

  it("rejects anything else arriving from a form", () => {
    for (const value of ["", "policies", "../etc", "constructor", null, 4]) {
      expect(isDocumentFolder(value)).toBe(false);
    }
  });
});

describe("checkFile", () => {
  const file = (over: Partial<{ size: number; type: string }> = {}) => ({
    size: 1024,
    type: "application/pdf",
    ...over,
  });

  it("accepts an ordinary policy PDF", () => {
    expect(checkFile(file())).toEqual({ ok: true });
  });

  it("accepts every type the bucket allows", () => {
    for (const type of ALLOWED_MIME_TYPES) {
      expect(checkFile(file({ type })), type).toEqual({ ok: true });
    }
  });

  it("refuses an empty file", () => {
    const result = checkFile(file({ size: 0 }));
    expect(result.ok).toBe(false);
  });

  it("refuses a file over the bucket's limit", () => {
    const result = checkFile(file({ size: MAX_DOCUMENT_BYTES + 1 }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/25 MB or smaller/);
  });

  it("accepts one exactly at the limit", () => {
    expect(checkFile(file({ size: MAX_DOCUMENT_BYTES }))).toEqual({ ok: true });
  });

  it("refuses a type the bucket would reject anyway", () => {
    // Better to say so before the upload than after it fails.
    for (const type of ["application/x-msdownload", "video/mp4", "text/html", ""]) {
      expect(checkFile(file({ type })).ok, type).toBe(false);
    }
  });
});

describe("storagePathFor", () => {
  it("puts the organisation first", () => {
    // One motel group's files must not be listable by guessing another's
    // prefix.
    expect(storagePathFor(ORG, DOC, "pdf").startsWith(`${ORG}/`)).toBe(true);
  });

  it("names the file by id, never by its title or original name", () => {
    // A predictable path is one guess away from a signed URL for a document
    // somebody may not read.
    expect(storagePathFor(ORG, DOC, "pdf")).toBe(`${ORG}/${DOC}.pdf`);
  });

  it("refuses to carry a strange extension into the path", () => {
    for (const extension of ["../../etc/passwd", "pdf/../../x", "", "a".repeat(20)]) {
      expect(storagePathFor(ORG, DOC, extension)).toBe(`${ORG}/${DOC}.bin`);
    }
  });

  it("lowercases the extension", () => {
    expect(storagePathFor(ORG, DOC, "PDF")).toBe(`${ORG}/${DOC}.pdf`);
  });
});

describe("extensionOf", () => {
  it("reads an ordinary filename", () => {
    expect(extensionOf("Fire safety policy.pdf")).toBe("pdf");
    expect(extensionOf("roster.XLSX")).toBe("xlsx");
  });

  it("falls back when there is nothing usable", () => {
    for (const name of ["noextension", "trailing.", ""]) {
      expect(extensionOf(name), name).toBe("bin");
    }
  });

  it("treats a dotfile's suffix as its extension", () => {
    // `.hidden` really does look like an extension, and it does not matter
    // which way this goes: the stored path is named by document id, and the
    // extension is sanitised to a short alphanumeric either way.
    expect(extensionOf(".hidden")).toBe("hidden");
  });

  it("takes only the last extension", () => {
    expect(extensionOf("archive.tar.gz")).toBe("gz");
  });
});

describe("formatBytes", () => {
  it("reads at a glance", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(2048)).toBe("2 KB");
    expect(formatBytes(5_242_880)).toBe("5.0 MB");
  });

  it("shows a dash rather than zero when the size is unknown", () => {
    expect(formatBytes(null)).toBe("—");
    expect(formatBytes(0)).toBe("—");
  });
});
