import { readFileSync } from 'node:fs';
import { globSync } from 'node:fs';

/**
 * CHANNEL NAME DISCIPLINE.
 *
 * A channel name is an authorization boundary. Spelling one inline, somewhere
 * else, slightly differently, fails in the worst possible way: the publisher
 * writes to `conv:abc` and the subscriber listens on `conversation:abc`.
 *
 * Nothing errors. No test fails. Messages simply never arrive, and you spend a
 * day inside the WebSocket wondering why.
 *
 * Worse: `` `conv:${untrustedInput}` `` can place a subscriber on a channel
 * they were never granted. `channels.ts` validates ids; an inline template
 * literal does not.
 */
const SOURCES = ['src/**/*.ts', 'src/**/*.tsx'];
const BUILDER = 'src/lib/realtime/channels.ts';

/** `'conv:'`, `"notif:"`, `` `presence:user:${x}` `` … */
const INLINE_CHANNEL = /['"`](?:conv|notif|presence):/;

describe('channel name discipline', () => {
  const files = SOURCES.flatMap((p) => globSync(p).map((f) => f.toString())).filter(
    (f) => f !== BUILDER && !f.endsWith('.d.ts'),
  );

  it('the scan reaches src/ and excludes the builder itself', () => {
    expect(files.length).toBeGreaterThan(20);
    expect(files).not.toContain(BUILDER);
  });

  it('no channel name is spelled outside channels.ts', () => {
    const hits: Array<{ file: string; line: number; snippet: string }> = [];

    for (const file of files) {
      readFileSync(file, 'utf8')
        .split('\n')
        .forEach((line, i) => {
          const t = line.trim();
          if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) return;
          if (!INLINE_CHANNEL.test(line)) return;
          hits.push({ file, line: i + 1, snippet: t.slice(0, 80) });
        });
    }

    if (hits.length > 0) {
      const report = hits.map((h) => `  ${h.file}:${h.line}  ${h.snippet}`).join('\n');
      throw new Error(
        `${hits.length} inline channel name(s):\n${report}\n\n` +
          `A channel name is an AUTHORIZATION boundary. Spelling one inline fails silently —\n` +
          `the publisher writes conv:abc, the subscriber listens on conversation:abc, and\n` +
          `messages simply never arrive. Nothing errors.\n\n` +
          `And \`conv:\${untrustedInput}\` can put a subscriber on a channel they were never\n` +
          `granted. channels.ts validates the id; a template literal does not.\n\n` +
          `Fix: use conversationChannel() / notificationChannel() / presenceChannel().`,
      );
    }

    expect(hits).toHaveLength(0);
  });
});
