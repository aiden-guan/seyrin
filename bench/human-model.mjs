// Synthetic human baseline: how long a person would take to do each demo task by hand.
// Every step is derived from a published rate where one exists, and is labelled an assumption where not.
// These are modeled estimates, not measurements; Seyrin's side of the comparison is measured.

import { readFileSync } from 'node:fs';

// Rates live in bench/rates.json, with where each comes from, so they can be checked and changed.
export const RATES = JSON.parse(readFileSync(new URL('./rates.json', import.meta.url), 'utf8'));

export const SOURCES = [
  ['Card, Moran & Newell (1980), The Keystroke-Level Model', 'https://en.wikipedia.org/wiki/Keystroke-level_model'],
  ['Brysbaert (2019), How many words do we read per minute?', 'https://doi.org/10.1016/j.jml.2019.104047'],
  ['Dhakal, Feit, Kristensson & Oulasvirta (CHI 2018), Observations on Typing from 136 Million Keystrokes: average 52 wpm', 'https://userinterfaces.aalto.fi/136Mkeystrokes/'],
  ['Karat et al. (1999): composing runs at about 0.58 of copying speed (used only as a ratio)', 'https://www.humanfactors.com/newsletters/human_interaction_speeds.html'],
  ['Mark, Gonzalez & Harris (2005), via Gallup: interrupted work resumed after 23 min 15 s on average', 'https://news.gallup.com/businessjournal/23146/too-many-interruptions-work.aspx'],
];

const { K, P, B, H, M } = RATES.klm;
const read = (words) => (words / RATES.readingWpm) * 60;
const compose = (words) => (words / RATES.composeWpm) * 60;
const type = (chars) => chars * K;
// One "go to a page and click" interaction in KLM terms: think, home to mouse, point, click.
const click = () => M + H + P + B;
const r = (n) => Math.round(n);

const W = RATES.writing;
/** Planning, drafting and refining a piece of writing, as three steps. */
function writeSteps(add, label, words, planSeconds) {
  add(`Think about what to say (${label})`, planSeconds, 'Assumption: planning before typing (see rates.json)', 0.5);
  add(`Draft ${label}: ${words} words`, compose(words), `${words} words at ${RATES.composeWpm} wpm composing`, 0.3);
  add(`Re-read and refine ${label}`, W.revisionPasses * read(words) + type(words * W.revisedShare * 5) + M * W.revisionPasses, `${W.revisionPasses} read-throughs at ${RATES.readingWpm} wpm plus retyping ${Math.round(W.revisedShare * 100)}% of it`, 0.5);
}

/** Steps for each task: [label, low, typical, high, basis]. */
export function humanSteps(task) {
  const emailWords = task.email.bodyText.split(/\s+/).filter(Boolean).length;
  const steps = [];
  const add = (label, typical, basis, spread = 0.35) => steps.push({ label, low: r(typical * (1 - spread)), typical: r(typical), high: r(typical * (1 + spread * 2)), basis });
  add('Read the email', read(emailWords) + M, `${emailWords} words at ${RATES.readingWpm} wpm`, 0.2);

  if (task.kind === 'bug_report') {
    add('Open the app at the reported page', click() + type(32) + M + 2, 'KLM: point, click, type the URL, page load (assumed 2 s)', 0.3);
    add('Follow the steps and try again a few times', 3 * (click() + 5) + 3 * M, 'KLM: 3 attempts, each a click plus about 5 s watching (assumption)', 0.5);
    add('Open devtools and check the console', click() * 2 + 15, 'KLM plus about 15 s reading the console (assumption)', 0.5);
    if (task.phase === 'done') {
      add('Find the code behind the button', 180, 'Assumption: search the repo for the handler in a small app', 0.6);
      add('Work out why it fails', 300, 'Assumption: a one-line bug (wrong data attribute) in a 30-line file', 0.7);
      add('Edit, save and reload', type(20) + click() * 2 + 5, 'KLM', 0.3);
      add('Re-test the customer’s steps', 3 * click() + 5 + M, 'KLM', 0.3);
      add('Write a regression test for it', 900, 'Assumption: a Playwright test for one flow, from scratch', 0.5);
    }
    writeSteps(add, 'the reply', 40, W.planEmailSeconds);
  } else if (task.kind === 'document') {
    const words = 300;
    add('Gather the facts (pricing, dates, contact)', 120, 'Assumption: look up pricing and re-read the request', 0.5);
    writeSteps(add, 'the one-pager', words, W.planDocSeconds);
    add('Format headings and check every section is there', 60 + click() * 6, 'KLM plus a minute of formatting (assumption)', 0.4);
    add('Check the numbers against the email', read(words) + read(emailWords), `Re-reading at ${RATES.readingWpm} wpm`, 0.3);
    add('Share the document', click() * 3, 'KLM', 0.3);
    writeSteps(add, 'the reply', 30, W.planEmailSeconds);
  } else if (task.kind === 'site_change') {
    add('Open the repo and find where the price is set', 120, 'Assumption: the price appears in the page and in the checkout script', 0.6);
    add('Edit both places and save', type(10) * 2 + click() * 4, 'KLM', 0.3);
    add('Run the site and check the pricing page and checkout', click() * 4 + 20, 'KLM plus about 20 s to start the server (assumption)', 0.5);
    writeSteps(add, 'the reply', 25, W.planEmailSeconds);
  }
  return steps;
}

/** What a person still does with Seyrin: read the card, approve, check the reply. */
export function seyrinAttention(task) {
  const steps = [];
  const add = (label, seconds, basis) => steps.push({ label, seconds: r(seconds), basis });
  add('Read Seyrin’s summary card', read(60) + M, `About 60 words at ${RATES.readingWpm} wpm`);
  if (task.policy.decision === 'approve' || task.work) add('Approve the plan or the fix', click(), 'KLM: one click');
  if (task.draftReply) add('Read the drafted reply and send it', read(task.draftReply.split(/\s+/).length) + click(), `Reading at ${RATES.readingWpm} wpm plus one click`);
  return steps;
}
