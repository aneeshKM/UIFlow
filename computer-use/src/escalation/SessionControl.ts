import type { ControlOwner } from "./types.js";

export class SessionControlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SessionControlError";
  }
}

export class SessionControl {
  private owner: ControlOwner = "AUTOMATION";

  getOwner(): ControlOwner {
    return this.owner;
  }

  giveToHuman(): void {
    this.assertAutomationControl();
    this.owner = "HUMAN";
  }

  giveToAutomation(): void {
    this.assertHumanControl();
    this.owner = "AUTOMATION";
  }

  assertAutomationControl(): void {
    this.assertOwner("AUTOMATION");
  }

  assertHumanControl(): void {
    this.assertOwner("HUMAN");
  }

  assertOwner(expected: ControlOwner): void {
    if (this.owner !== expected) {
      throw new SessionControlError(
        `${expected} cannot operate the browser while control belongs to ${this.owner}.`,
      );
    }
  }
}
