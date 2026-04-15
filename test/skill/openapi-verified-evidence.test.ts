import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const openApiPath = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "openapi.json");
const openApiSpec = JSON.parse(readFileSync(openApiPath, "utf-8"));

describe("OpenAPI verified evidence schema", () => {
  it("exposes verified evidence fields on score outputs", () => {
    const scoreOutput = openApiSpec.components.schemas.ScoreOutput;
    expect(scoreOutput.properties.verifiedEvidence.type).toBe("boolean");
    expect(scoreOutput.properties.evidenceMode.$ref).toBe("#/components/schemas/EvidenceMode");
    expect(scoreOutput.properties.proofType.type).toBe("integer");
    expect(scoreOutput.properties.commitment.$ref).toBe("#/components/schemas/EvidenceCommitment");
  });

  it("exposes compare-level verified evidence summary fields", () => {
    const compareResultItem = openApiSpec.components.schemas.CompareResultItem;
    expect(compareResultItem.properties.verifiedEvidence.type).toBe("boolean");
    expect(compareResultItem.properties.evidenceMode.$ref).toBe("#/components/schemas/EvidenceMode");
  });

  it("keeps evidenceMode enum stable for external consumers", () => {
    const evidenceMode = openApiSpec.components.schemas.EvidenceMode;
    expect(evidenceMode.enum).toEqual(["legacy-summary", "accepted-commitment"]);
  });
});
