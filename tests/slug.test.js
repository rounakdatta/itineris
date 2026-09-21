import { describe, it, expect } from "vitest";
import { slugProblem, cleanSlug, slugFrom, galleryFromPath, RESERVED } from "../server/slug.js";

describe("a gallery's own name in the URL", () => {
  it("takes the shape of something you would type", () => {
    expect(slugProblem("singaporeeats")).toBeNull();
    expect(slugProblem("singapore-eats-2026")).toBeNull();
    expect(slugProblem("  SingaporeEats  ")).toBeNull();     // trimmed and lowercased first
    expect(cleanSlug("  SingaporeEats  ")).toBe("singaporeeats");
  });
  it("refuses what would make an ugly or ambiguous URL", () => {
    expect(slugProblem("")).toMatch(/give it a name/);
    expect(slugProblem("ab")).toMatch(/3 characters/);
    expect(slugProblem("a".repeat(41))).toMatch(/40 characters/);
    expect(slugProblem("-leading")).toMatch(/starting and ending/);
    expect(slugProblem("trailing-")).toMatch(/starting and ending/);
    expect(slugProblem("has space")).toMatch(/lowercase letters/);
    expect(slugProblem("Ünicode")).toMatch(/lowercase letters/);
    expect(slugProblem("under_score")).toMatch(/lowercase letters/);
    expect(slugProblem("a/b")).toMatch(/lowercase letters/);
  });
  it("refuses anything the site serves itself, now or later", () => {
    // These live at the root too. One of them as a slug is a broken site.
    for (const taken of ["creator", "admin", "data", "media", "assets", "healthz", "api", "auth", "login", "settings"]) {
      expect(slugProblem(taken)).toMatch(/reserved/);
    }
    // "g" is reserved too, but it never gets that far: it is also too short.
    expect(slugProblem("g")).toMatch(/3 characters/);
    expect(RESERVED.has("creator")).toBe(true);
    // ...and anything shaped like a file the server might hand over.
    expect(slugProblem("config.json")).toMatch(/filename/);
    expect(slugProblem("sw.js")).toMatch(/filename/);
    expect(slugProblem("favicon.ico")).toMatch(/filename/);
  });
  it("suggests one from the title without ever imposing it", () => {
    expect(slugFrom("Singapore, March 2026")).toBe("singapore-march-2026");
    expect(slugFrom("Café  &  Croissants!!")).toBe("cafe-croissants");
    expect(slugFrom("ap-south-east-1 fav eats!!!")).toBe("ap-south-east-1-fav-eats");
    expect(slugFrom("")).toBe("");
    expect(slugFrom("g")).toBe("");            // too short, and reserved anyway
    expect(slugFrom("Admin")).toBe("");        // would be refused, so suggest nothing
  });
});

describe("what a path is pointing at", () => {
  it("reads both the token URL and the pretty one", () => {
    expect(galleryFromPath("/g/2mro45eyznpc")).toEqual({ by: "token", id: "2mro45eyznpc" });
    expect(galleryFromPath("/g/2mro45eyznpc/")).toEqual({ by: "token", id: "2mro45eyznpc" });
    expect(galleryFromPath("/singaporeeats")).toEqual({ by: "slug", id: "singaporeeats" });
    // Forgiving about case: the published file is lowercase and so is the id
    // we hand back, so someone typing capitals still lands in the right place.
    expect(galleryFromPath("/SingaporeEats")).toEqual({ by: "slug", id: "singaporeeats" });
  });
  it("never mistakes the site's own paths for a gallery", () => {
    for (const p of ["/", "/creator/", "/creator", "/data/galleries/x.json", "/media/a.webp", "/sw.js", "/config.json", "/favicon.ico", "/assets/index-abc.js"]) {
      expect(galleryFromPath(p)).toBeNull();
    }
  });
  it("is not fooled by a deeper path", () => {
    expect(galleryFromPath("/singaporeeats/extra")).toBeNull();
    expect(galleryFromPath("/g/abc/extra")).toBeNull();
  });
});
