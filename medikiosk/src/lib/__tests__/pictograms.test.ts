import { describe, expect, it } from "vitest";
import { pictogramFor, pictogramSteps, pictogramText } from "@/lib/pictograms";

describe("pictogramFor", () => {
  it("generates correct English and Hindi captions for before-food medication", () => {
    const med = {
      name: "Pantoprazole 40mg",
      dosage: "40mg",
      frequency: "once daily",
      instructions: "take on empty stomach with water",
    };
    const pic = pictogramFor(med);
    expect(pic.meal).toBe("before");
    expect(pic.water).toBe(true);
    expect(pic.times).toEqual(["morning"]);
    expect(pic.captionEn).toBe("Morning on empty stomach · with water");
    expect(pic.captionHi).toBe("सुबह खाली पेट · पानी के साथ");
  });

  it("generates correct English and Hindi captions for after-food twice-daily medication", () => {
    const med = {
      name: "Amoxicillin 500mg",
      dosage: "500mg",
      frequency: "twice daily",
      instructions: "after meals",
    };
    const pic = pictogramFor(med);
    expect(pic.meal).toBe("after");
    expect(pic.times).toEqual(["morning", "night"]);
    expect(pic.captionEn).toBe("Morning, Night after food");
    expect(pic.captionHi).toBe("सुबह, रात भोजन के बाद");
  });

  it("maps dose times, food timing and water to ordered pictogram steps", () => {
    const med = {
      name: "Paracetamol",
      frequency: "twice daily",
      instructions: "after food with water",
    };
    const pic = pictogramFor(med);
    expect(pic.formIcon).toBe("pill");
    expect(pictogramSteps(pic).map((s) => s.icon)).toEqual(["sunrise", "moon", "bowl", "droplet"]);
    expect(pictogramSteps(pic).map((s) => s.label)).toEqual([
      "Morning",
      "Night",
      "After food",
      "With water",
    ]);
  });

  it("picks a form icon per dosage form", () => {
    expect(pictogramFor({ name: "Paracetamol syrup", frequency: "bd" }).formIcon).toBe("spoon");
    expect(pictogramFor({ name: "Tetanus vaccine", frequency: "once" }).formIcon).toBe("syringe");
    expect(pictogramFor({ name: "Chlorpheniramine eye drops", frequency: "od" }).formIcon).toBe("dropper");
    expect(pictogramFor({ name: "Betamethasone cream", frequency: "bd" }).formIcon).toBe("tube");
  });

  it("renders a plain-text instruction line with no pictogram glyphs", () => {
    const pic = pictogramFor({
      name: "Pantoprazole 40mg",
      frequency: "once daily",
      instructions: "before food with water",
    });
    expect(pictogramText(pic)).toBe("Morning, Empty stomach, With water");
  });
});
