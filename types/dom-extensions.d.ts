// types/dom-extensions.d.ts
import type { Component } from "obsidian";

export {};

declare global {
  interface HTMLElement {
    // Obsidian extends the DOM with a few helper methods in runtime.
    // We declare the ones your code uses. They are optional at runtime,
    // so code that checks with ?. will still run fine.
    empty?: () => void;
    createDiv?: (opts?: { cls?: string; attr?: Record<string, string> }) => HTMLElement;
    createEl?: (tag?: string, attrs?: Record<string, string>) => HTMLElement;
  }
}