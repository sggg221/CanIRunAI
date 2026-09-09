import data from "./models.json" with { type: "json" };
import { ModelSchema } from "../protocol/index.ts";
export const models = ModelSchema.array().parse(data);
export function getModel(id: string) {
  const model = models.find((m) => m.id === id || m.variants.some((v) => v.tag === id));
  if (!model) throw new Error("Unknown model. Only verified registry models are permitted.");
  return model;
}
