import { describe, expect, it } from "vitest";

import { getArtifactJsonSchema } from "./index.js";

function resolveLocalRef(
  schema: Record<string, any>,
  value: Record<string, any>,
): Record<string, any> {
  const reference = value.$ref as string | undefined;
  if (!reference) return value;
  const key = reference.replace("#/$defs/", "");
  return schema.$defs?.[key] as Record<string, any>;
}

describe("artifact JSON schemas", () => {
  it("exposes strict canonical camelCase fields to a fresh host", () => {
    const schema = getArtifactJsonSchema("ProblemFrame");
    expect(schema.type).toBe("object");
    expect(schema.required).toEqual(
      expect.arrayContaining(["schemaVersion", "id", "runId", "intentMode"]),
    );
    expect(schema.additionalProperties).toBe(false);
  });

  it("returns a defensive copy", () => {
    const first = getArtifactJsonSchema("WorkPlan");
    first.type = "string";
    expect(getArtifactJsonSchema("WorkPlan").type).toBe("object");
  });

  it("advertises the serial worker limit directly", () => {
    const schema = getArtifactJsonSchema("WorkPlan") as Record<string, any>;
    const executionMode = resolveLocalRef(
      schema,
      schema.properties.executionMode,
    );
    const globalBudgets = resolveLocalRef(
      schema,
      schema.properties.globalBudgets,
    );
    expect(executionMode.const).toBe("serial");
    expect(globalBudgets.properties.maximumParallelWorkers).toMatchObject({
      type: "number",
      const: 1,
    });
  });
});
