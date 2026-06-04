/**
 * Utility function for combining class names
 * Similar to clsx/classnames
 */

export type ClassValue = string | undefined | null | false | Record<string, boolean | undefined | null> | ClassValue[]

export function cn(...inputs: ClassValue[]): string {
  const classes: string[] = []

  for (const input of inputs) {
    if (!input) continue

    if (typeof input === 'string') {
      classes.push(input)
    } else if (Array.isArray(input)) {
      const result = cn(...input)
      if (result) classes.push(result)
    } else if (typeof input === 'object') {
      for (const [key, value] of Object.entries(input)) {
        if (value) classes.push(key)
      }
    }
  }

  return classes.join(' ')
}