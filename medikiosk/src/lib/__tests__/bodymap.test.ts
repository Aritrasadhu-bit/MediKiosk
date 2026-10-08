import { describe, expect, it } from "vitest";
import { BODY_REGIONS } from "@/components/BodyMap";
import { DEPARTMENTS } from "@/lib/data";

/**
 * The body map shows each organ's treating departments. Those names must be
 * the website's own departments (exact DEPARTMENTS entries) — a typo or a
 * renamed department would otherwise display (and route trust toward) a
 * department that does not exist.
 */
describe("body map department mapping", () => {
  it("maps every region to at least one department", () => {
    expect(BODY_REGIONS.length).toBeGreaterThan(0);
    for (const r of BODY_REGIONS) {
      expect(r.departments.length, `${r.id} has no departments`).toBeGreaterThan(0);
    }
  });

  it("uses only departments that exist on the website", () => {
    for (const r of BODY_REGIONS) {
      for (const d of r.departments) {
        expect(DEPARTMENTS, `${r.id} maps to unknown department ${d}`).toContain(d);
      }
    }
  });
});
