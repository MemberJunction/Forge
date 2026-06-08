/**
 * Password hygiene checks for paste artifacts.
 *
 * Forge captures the SQL password from a UI text field — almost always pasted —
 * and stores it byte-for-byte, with no trimming anywhere in the capture → IPC →
 * keychain → driver chain. The mssql/pg/mysql drivers handle genuine special
 * characters (@ # ! $ % &, etc.) natively, so those are NOT a problem.
 *
 * What IS a problem is invisible junk that rides along with a paste and is then
 * preserved verbatim: leading/trailing whitespace, an accidental trailing
 * newline, or Unicode look-alikes (curly quotes, en/em dashes, non-breaking
 * spaces) substituted by rich-text sources like Word, Slack, or PDFs. These
 * look identical on screen but are different bytes than the intended password,
 * producing a login failure that the server reports only as "Login failed".
 *
 * These checks are advisory — a password can legitimately contain any of these
 * characters — so callers warn, they never mutate or reject the value.
 *
 * IMPORTANT: messages here describe the *kind* of character found; they never
 * echo the password itself (per the project's no-sensitive-data-in-messages rule).
 */

export type PasswordHygieneIssueType =
  | 'leading-whitespace'
  | 'trailing-whitespace'
  | 'control-char'
  | 'smart-quotes'
  | 'dash'
  | 'nbsp'
  | 'non-ascii';

export interface PasswordHygieneIssue {
  type: PasswordHygieneIssueType;
  message: string;
}

export interface PasswordHygiene {
  /** True if any advisory issue was detected. */
  hasIssues: boolean;
  issues: PasswordHygieneIssue[];
  /** Character count of the password (useful for spotting truncation/extra chars). */
  length: number;
}

// Look-alike characters commonly substituted when copying from rich-text sources.
// Escapes are used (not literals) so these invisible/ambiguous codepoints survive
// editing intact. Smart single quotes (U+2018-201B), prime (U+2032), smart double
// quotes (U+201C-201F), double prime (U+2033).
const SMART_QUOTES = /[\u2018-\u201b\u2032\u201c-\u201f\u2033]/;
// En dash, em dash, and the Unicode minus sign masquerading as a hyphen-minus.
const DASHES = /[\u2013\u2014\u2212]/;
// Non-breaking space (U+00A0), the U+2000-200A space block, zero-width space
// (U+200B), narrow/medium math spaces (U+202F, U+205F), ideographic space
// (U+3000), and the BOM / zero-width no-break space (U+FEFF).
const NBSP_AND_UNICODE_SPACES = /[\u00a0\u2000-\u200b\u202f\u205f\u3000\ufeff]/;
// Control characters (newline, tab, CR, etc.) anywhere in the value.
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;

const MESSAGES: Record<PasswordHygieneIssueType, string> = {
  'leading-whitespace':
    'The password starts with a space or whitespace character — often an accidental paste artifact.',
  'trailing-whitespace':
    'The password ends with a space or whitespace character — often an accidental paste artifact.',
  'control-char':
    'The password contains a tab or line-break character — usually pasted in by accident.',
  'smart-quotes':
    'The password contains “smart” curly quotes (’ ” ‘ “) instead of straight quotes — common when copying from documents or chat apps.',
  dash: 'The password contains an en/em dash (– or —) instead of a regular hyphen-minus (-).',
  nbsp: 'The password contains a non-breaking or special Unicode space instead of a regular space.',
  'non-ascii':
    'The password contains non-standard Unicode characters that may differ from what you intended.',
};

/**
 * Inspect a password for likely copy/paste artifacts. Pure and side-effect free.
 */
export function analyzePasswordHygiene(password: string): PasswordHygiene {
  const issues: PasswordHygieneIssue[] = [];
  const add = (type: PasswordHygieneIssueType): void => {
    issues.push({ type, message: MESSAGES[type] });
  };

  if (!password) {
    return { hasIssues: false, issues, length: 0 };
  }

  // \s in JS includes Unicode whitespace (NBSP, etc.), so this catches a
  // trailing NBSP as whitespace too; the dedicated nbsp check below adds the
  // more specific explanation when one appears anywhere in the value.
  if (/^\s/.test(password)) add('leading-whitespace');
  if (/\s$/.test(password)) add('trailing-whitespace');

  if (CONTROL_CHARS.test(password)) add('control-char');

  if (SMART_QUOTES.test(password)) add('smart-quotes');
  if (DASHES.test(password)) add('dash');
  if (NBSP_AND_UNICODE_SPACES.test(password)) add('nbsp');

  // Any remaining non-ASCII codepoint that isn't already explained by a more
  // specific check above. Avoids double-reporting a labeled look-alike.
  for (const ch of password) {
    const code = ch.codePointAt(0) ?? 0;
    if (code > 0x7e) {
      if (SMART_QUOTES.test(ch) || DASHES.test(ch) || NBSP_AND_UNICODE_SPACES.test(ch)) continue;
      add('non-ascii');
      break;
    }
  }

  return { hasIssues: issues.length > 0, issues, length: password.length };
}

export interface DescribeOptions {
  /**
   * Prepend a line stating the password's character count. Used by the
   * post-login-failure diagnostic (#3) so a truncated or padded password is
   * obvious; omitted by the live form warning (#2).
   */
  includeLength?: boolean;
}

/**
 * Render the hygiene findings as human-readable lines. Returns an empty array
 * when the password is clean. Never includes the raw password text.
 */
export function describePasswordHygiene(password: string, opts: DescribeOptions = {}): string[] {
  const { issues, length } = analyzePasswordHygiene(password);
  if (issues.length === 0) return [];

  const lines: string[] = [];
  if (opts.includeLength) {
    lines.push(
      `The password Forge has stored is ${length} character${length === 1 ? '' : 's'} long — confirm that matches what you expect.`
    );
  }
  lines.push(...issues.map(i => i.message));
  return lines;
}
