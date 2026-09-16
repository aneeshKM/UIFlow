import type { Locator, Page } from "playwright";
import type { LocatorSpec } from "./types.js";

export class LocatorResolver {
  resolve(page: Page, spec: LocatorSpec): Locator {
    switch (spec.strategy) {
      case "role":
        return page.getByRole(spec.role, spec.name === undefined ? undefined : { name: spec.name });
      case "label":
        return page.getByLabel(spec.label);
      case "placeholder":
        return page.getByPlaceholder(spec.placeholder);
      case "text":
        return page.getByText(spec.text);
      case "testId":
        return page.getByTestId(spec.testId);
      case "css":
        return page.locator(spec.selector);
    }
  }
}
