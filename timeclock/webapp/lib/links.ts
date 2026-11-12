/** Manager → Entries opened at a person's day (optionally with the day editor open). */
export const entriesHref = (employeeId: string, day?: string, edit = false) =>
  `/manager/entries?employeeId=${employeeId}${day ? `&day=${day}` : ""}${edit ? "&edit=1" : ""}`;
