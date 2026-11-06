// Runs the whole generation loop. Pure logic: no DOM access.
// The UI talks to it through callbacks (onProgress, onLog, shouldStop).

import { generatePairs } from './generate.js';
import { validatePairs, dedupeGroups } from './validate.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const FATAL = /^API (400|401|403|404)\b/;

async function sleepUnlessStopped(ms, shouldStop) {
  const end = Date.now() + ms;
  while (Date.now() < end && !shouldStop()) {
    await sleep(Math.min(250, end - Date.now()));
  }
}

// Split `target` pairs across chunks in proportion to their token size, capped at maxPer each.
export function allocate(chunks, target, maxPer) {
  const alloc = new Array(chunks.length).fill(0);
  let remaining = Math.min(target, chunks.length * maxPer);

  while (remaining > 0) {
    const open = [];
    alloc.forEach((a, i) => { if (a < maxPer) open.push(i); });
    if (!open.length) break;

    const wsum = open.reduce((s, i) => s + chunks[i].tokens, 0);
    const shares = open.map((i) => ({ i, exact: (remaining * chunks[i].tokens) / wsum }));

    let given = 0;
    for (const s of shares) {
      const g = Math.min(Math.floor(s.exact), maxPer - alloc[s.i]);
      alloc[s.i] += g;
      given += g;
      s.frac = s.exact - Math.floor(s.exact);
    }
    let left = remaining - given;
    shares.sort((a, b) => b.frac - a.frac);
    for (const s of shares) {
      if (left <= 0) break;
      if (alloc[s.i] < maxPer) { alloc[s.i]++; left--; given++; }
    }
    if (given === 0) break;
    remaining -= given;
  }
  return alloc;
}

// Trim to the target by taking one pair from each chunk in turn (keeps topics balanced)
function selectToTarget(groups, target) {
  const total = groups.reduce((n, g) => n + g.length, 0);
  if (total <= target) return { pairs: groups.flat(), trimmed: 0 };

  const picked = groups.map(() => []);
  let count = 0;
  for (let round = 0; count < target; round++) {
    let any = false;
    for (let gi = 0; gi < groups.length && count < target; gi++) {
      if (round < groups[gi].length) {
        picked[gi].push(groups[gi][round]);
        count++;
        any = true;
      }
    }
    if (!any) break;
  }
  return { pairs: picked.flat(), trimmed: total - count };
}

export async function runPipeline({ chunks, apiKey, cfg, target, delayMs, onProgress, onLog, shouldStop }) {
  const maxPer = cfg.maxPairsPerChunk;
  const alloc = allocate(chunks, target, maxPer);
  const jobs = [];
  chunks.forEach((chunk, i) => {
    if (alloc[i] > 0) {
      jobs.push({
        n: jobs.length + 1,
        index: i,
        chunk,
        want: alloc[i],
        ask: Math.min(maxPer, Math.ceil(alloc[i] * cfg.overRequestFactor)),
      });
    }
  });

  const t0 = Date.now();
  const byChunk = new Map();   // chunk index -> valid pairs
  const rejectedTally = {};
  let failed = [];
  let done = 0;
  let consecutiveFails = 0;
  let stopReason = null;

  const log = (s) => onLog && onLog(s);
  const validCount = () => [...byChunk.values()].reduce((n, a) => n + a.length, 0);
  const emit = (status) =>
    onProgress && onProgress({
      done,
      total: jobs.length,
      valid: validCount(),
      target,
      startedAt: t0,
      avgJobMs: done ? (Date.now() - t0) / done : null,
      status,
      failedCount: failed.length,
    });

  async function runJob(job) {
    const res = await generatePairs(job.chunk, apiKey, { ...cfg, pairsPerChunk: job.ask });
    const { valid, rejected } = validatePairs(res.pairs, job.chunk, cfg);
    const reasons = {};
    for (const r of rejected) {
      rejectedTally[r.reason] = (rejectedTally[r.reason] || 0) + 1;
      reasons[r.reason] = (reasons[r.reason] || 0) + 1;
    }
    byChunk.set(job.index, valid);
    const why = Object.entries(reasons).map(([k, v]) => `${v}x ${k}`).join(', ');
    log(`✓ #${job.n}/${jobs.length} ${job.chunk.sectionPath}: kept ${valid.length} of ${res.pairs.length}` + (why ? `  (rejected: ${why})` : ''));
  }

  // ---- main pass ----
  for (let k = 0; k < jobs.length; k++) {
    if (shouldStop()) { stopReason = 'stopped by user'; break; }
    const job = jobs[k];
    emit(`Generating ${k + 1}/${jobs.length}: ${job.chunk.sectionPath}`);
    try {
      await runJob(job);
      consecutiveFails = 0;
    } catch (err) {
      failed.push({ job, error: err.message });
      consecutiveFails++;
      log(`✗ #${job.n}/${jobs.length} ${job.chunk.sectionPath}: ${err.message}`);
      if (FATAL.test(err.message)) {
        done++;
        stopReason = `stopped: ${err.message}`;
        break;
      }
      if (consecutiveFails >= 3) {
        done++;
        stopReason = 'stopped after 3 failures in a row (rate or quota limit? try a longer delay)';
        break;
      }
    }
    done++;
    emit(k < jobs.length - 1 ? 'Waiting before next request...' : 'Finishing...');
    if (k < jobs.length - 1) await sleepUnlessStopped(delayMs, shouldStop);
  }

  // ---- one retry pass for failed chunks ----
  if (!stopReason && failed.length) {
    const toRetry = failed;
    failed = [];
    for (let i = 0; i < toRetry.length; i++) {
      const f = toRetry[i];
      if (shouldStop()) {
        stopReason = 'stopped by user';
        failed.push(...toRetry.slice(i));
        break;
      }
      emit(`Retrying failed chunk ${f.job.n}: ${f.job.chunk.sectionPath}`);
      await sleepUnlessStopped(delayMs, shouldStop);
      try {
        await runJob(f.job);
      } catch (err) {
        failed.push({ job: f.job, error: err.message });
        log(`✗ retry failed, chunk ${f.job.n}: ${err.message}`);
      }
    }
  }

  // ---- finalize: dedupe, trim to target ----
  const groups = jobs.map((j) => byChunk.get(j.index) || []);
  const validBeforeDedupe = groups.reduce((n, g) => n + g.length, 0);
  const deduped = dedupeGroups(groups);
  const selected = selectToTarget(deduped.groups, target);

  return {
    pairs: selected.pairs,
    summary: {
      target,
      requests: jobs.length,
      validBeforeDedupe,
      duplicatesRemoved: deduped.removed,
      trimmed: selected.trimmed,
      final: selected.pairs.length,
      rejected: rejectedTally,
      failed: failed.map((f) => ({ chunkId: f.job.chunk.id, section: f.job.chunk.sectionPath, error: f.error })),
      stopReason,
      elapsedMs: Date.now() - t0,
    },
  };
}
