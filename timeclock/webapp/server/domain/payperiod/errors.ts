export class EditGuardError extends Error {
  constructor(public code: string) {
    super(code);
  }
}
