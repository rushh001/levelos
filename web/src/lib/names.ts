/**
 * Names as the teacher sees them: a child or class can carry its name in each interface language (Meena / मीना);
 * the app shows the one for the language it is in, else the English one (readable in every interface: a Hindi
 * class's मीना is Meena in the Kannada app), else the name as it was typed.
 */

type Named = { names?: Record<string, string> }

export function nameIn(x: Named, typed: string, ui: string): string {
  return x.names?.[ui] || x.names?.en || typed
}

/** Text written with the child's name as typed (a diagnosis summary), shown with the name in the interface language. */
export function withName(text: string, child: Named & { first_name: string }, ui: string): string {
  const shown = nameIn(child, child.first_name, ui)
  return shown === child.first_name ? text : text.split(child.first_name).join(shown)
}
