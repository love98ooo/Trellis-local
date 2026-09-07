/**
 * Task directory naming.
 *
 * User-created task dirs follow the `MM-DD-slug` pattern produced by
 * `.trellis/scripts/common/task_store.py::cmd_create`:
 *
 *     <tasks-dir>/05-13-trellis-core-sdk-package/
 *
 * `MM` is the two-digit month, `DD` is the two-digit day, and `slug` is
 * a lower-kebab-case identifier composed of `[a-z0-9-]+` characters.
 */

const DATED_TASK_DIR_RE =
  /^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])-([a-z0-9]+(?:-[a-z0-9]+)*)$/;

export interface TaskDirParts {
  /** 日期前缀 MM-DD。 */
  prefix: string;
  month: string;
  day: string;
  slug: string;
}

/**
 * Validate a task directory base name (no slashes). Returns the parsed
 * components when valid, or `null` when the name does not match a canonical
 * task dir shape.
 *
 * Throws `TypeError` if `name` is not a string — guards downstream code
 * from accidentally validating `Buffer`, `Path`, or other inputs.
 */
export function validateTaskDirName(name: string): TaskDirParts | null {
  if (typeof name !== "string") {
    throw new TypeError("task directory name must be a string");
  }
  const dated = DATED_TASK_DIR_RE.exec(name);
  if (dated) {
    const [, month, day, slug] = dated;
    if (month === undefined || day === undefined || slug === undefined) {
      return null;
    }
    return { prefix: `${month}-${day}`, month, day, slug };
  }

  return null;
}

export function isValidTaskDirName(name: string): boolean {
  return validateTaskDirName(name) !== null;
}
