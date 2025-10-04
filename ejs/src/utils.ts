import { type ESTree } from "meriyah";
import { type DeepPartial } from "./types.ts";

export function matchesStructure<T extends ESTree.Node>(
  obj: ESTree.Node | ESTree.Node[],
  structure: DeepPartial<T> | readonly DeepPartial<T>[]
): boolean {
  if (Array.isArray(structure)) {
    if (!Array.isArray(obj)) {
      return false;
    }

    const len = structure.length;
    if (len !== obj.length) {
      return false;
    }

    for (let i = 0; i < len; i++) {
      if (!matchesStructure(obj[i], structure[i])) {
        return false;
      }
    }
    return true;
  }

  if (typeof structure === "object") {
    if (!obj) {
      return !structure;
    }

    if ("or" in structure) {
      const orOptions = (structure as { or: unknown[] }).or;
      for (const option of orOptions) {
        if (matchesStructure(obj, option)) {
          return true;
        }
      }
      return false;
    }

    for (const key in structure) {
      const value = structure[key as keyof typeof structure];
      if (!matchesStructure(obj[key as keyof typeof obj], value)) {
        return false;
      }
    }
    return true;
  }

  return structure === obj;
}

export function isOneOf<T>(value: unknown, ...of: readonly T[]): value is T {
  return of.includes(value as T);
}